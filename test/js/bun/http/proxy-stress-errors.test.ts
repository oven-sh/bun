/**
 * Proxy error-path coverage.
 *
 * These tests assert what the client surfaces when something in the proxy
 * pipeline fails in an expected way: a non-200 CONNECT, an unreachable
 * proxy or upstream, wrong/missing proxy auth, inner-TLS verification
 * failure, unsupported protocol/feature combinations.
 *
 * Unlike the lifecycle file (which asserts "no hang/crash"), here we assert
 * the *shape* of the surfaced response/error because it's part of the
 * observable API.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { once } from "node:events";
import net from "node:net";
import tls from "node:tls";
import {
  cartesian,
  clearProxyEnv,
  createAdversarialOrigin,
  createAdversarialProxy,
  deadPort,
  errcode,
  laxTls,
  restoreProxyEnv,
  tlsCert,
} from "./proxy-stress-helpers";

let savedEnv: Record<string, string | undefined>;
beforeAll(() => {
  savedEnv = clearProxyEnv();
});
afterAll(() => {
  restoreProxyEnv(savedEnv);
});

// ─────────────────────────────────────────────────────────────────────────────
// CONNECT failure status codes.
// ─────────────────────────────────────────────────────────────────────────────

describe("CONNECT failure status", () => {
  const STATUSES = [400, 403, 407, 500, 502, 503, 504] as const;
  for (const { proxyTls, status } of cartesian({
    proxyTls: [false, true] as const,
    status: STATUSES,
  })) {
    test.concurrent(`${proxyTls ? "https" : "http"}-proxy CONNECT → ${status} rejects the fetch`, async () => {
      await using origin = await createAdversarialOrigin({ tls: true, body: "unreachable" });
      await using proxy = await createAdversarialProxy({
        tls: proxyTls,
        connectStatus: status,
        connectStatusBody: `proxy-said-${status}`,
      });

      // The proxy's reply came over the plaintext client→proxy hop with no
      // TLS handshake to the origin; it must never surface as a Response
      // attributed to the https origin. The proxy's status code is carried
      // in the error message so auth/gateway failures are still debuggable.
      await expect(
        fetch(origin.url, {
          proxy: proxy.url,
          keepalive: false,
          tls: laxTls,
          signal: AbortSignal.timeout(15_000),
        }),
      ).rejects.toMatchObject({
        code: "ProxyConnectFailed",
        message: expect.stringContaining(String(status)),
      });
      // The origin must never have been reached.
      expect(origin.requests.length).toBe(0);
    });
  }

  // A 3xx CONNECT reply rejects the fetch and its Location is never followed.
  for (const status of [301, 302] as const) {
    test.concurrent(`CONNECT → ${status} with Location is not followed`, async () => {
      await using origin = await createAdversarialOrigin({ tls: true, body: "unreachable" });
      await using bait = await createAdversarialOrigin({ tls: false, body: "bait" });
      await using proxy = await createAdversarialProxy({
        connectStatus: status,
        connectReplyHeaders: { Location: bait.url },
      });

      await expect(fetch(origin.url, { proxy: proxy.url, keepalive: false, tls: laxTls })).rejects.toMatchObject({
        code: "ProxyConnectFailed",
        message: expect.stringContaining(String(status)),
      });
      expect(bait.requests.length).toBe(0);
      expect(origin.requests.length).toBe(0);
    });
  }

  // RFC 9110 §9.3.6: any 2xx to CONNECT switches to tunnel mode. A proxy
  // that sends a body alongside a non-200 2xx is violating the spec; the
  // client must treat the post-header bytes as tunnel payload (so the inner
  // TLS handshake fails), never as an https-origin Response body.
  for (const proxyTls of [false, true] as const) {
    test.concurrent(`${proxyTls ? "https" : "http"}-proxy CONNECT → 201 is treated as tunnel-established`, async () => {
      await using origin = await createAdversarialOrigin({ tls: true, body: "unreachable" });
      await using proxy = await createAdversarialProxy({
        tls: proxyTls,
        connectStatus: 201,
        connectStatusBody: "BODY201x",
      });

      let outcome: { status: number; ok: boolean; body: string } | string;
      try {
        const res = await fetch(origin.url, {
          proxy: proxy.url,
          keepalive: false,
          tls: laxTls,
          signal: AbortSignal.timeout(15_000),
        });
        outcome = { status: res.status, ok: res.ok, body: await res.text() };
      } catch (e) {
        outcome = errcode(e);
      }
      // The proxy's plaintext body must not surface as origin content. The
      // bytes after the 2xx header feed the TLS handshake, which fails; the
      // exact error depends on whether the proxy hangs up first.
      expect(outcome).not.toEqual({ status: 201, ok: true, body: "BODY201x" });
      expect(typeof outcome).toBe("string");
      expect(outcome).not.toBe("TimeoutError");
      expect(origin.requests.length).toBe(0);
    });
  }

  // The CONNECT reply's status and headers must not write `self.state` that
  // then leaks into the origin leg (ProxyTunnel does not reset state between
  // the two). Cover the three cases the header/status loop used to leak:
  // 204 → content_length=Some(0), Content-Encoding → encoding=Gzip,
  // Transfer-Encoding → transfer_encoding=Chunked.
  for (const { name, reply } of [
    { name: "202", reply: "HTTP/1.1 202 Accepted\r\n\r\n" },
    { name: "204", reply: "HTTP/1.1 204 No Content\r\n\r\n" },
    { name: "200 + Content-Encoding: gzip", reply: "HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\n\r\n" },
    { name: "200 + Transfer-Encoding: chunked", reply: "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n" },
  ] as const) {
    test.concurrent(`CONNECT → ${name} establishes the tunnel and the origin body arrives intact`, async () => {
      await using origin = await createAdversarialOrigin({ tls: true, body: "hello-through-2xx-tunnel" });

      const sockets = new Set<net.Socket>();
      const proxy = net.createServer(client => {
        sockets.add(client);
        client.on("close", () => sockets.delete(client));
        client.on("error", () => {});
        let head = "";
        const onHead = (d: Buffer) => {
          head += d.toString("latin1");
          const end = head.indexOf("\r\n\r\n");
          if (end < 0) return;
          client.removeListener("data", onHead);
          const [, target] = head.split("\r\n")[0].split(" ");
          const colon = target.lastIndexOf(":");
          const upstream = net.connect(Number(target.slice(colon + 1)), "127.0.0.1");
          sockets.add(upstream);
          upstream.on("close", () => (sockets.delete(upstream), client.end()));
          upstream.on("error", () => client.destroy());
          upstream.once("connect", () => {
            client.write(reply);
            client.pipe(upstream);
            upstream.pipe(client);
          });
        };
        client.on("data", onHead);
      });
      proxy.listen(0, "127.0.0.1");
      await once(proxy, "listening");
      const port = (proxy.address() as net.AddressInfo).port;

      try {
        const res = await fetch(origin.url, {
          proxy: `http://127.0.0.1:${port}`,
          keepalive: false,
          tls: laxTls,
          signal: AbortSignal.timeout(15_000),
        });
        expect(await res.text()).toBe("hello-through-2xx-tunnel");
        expect(res.status).toBe(200);
        expect(res.headers.get("content-length")).toBe(String("hello-through-2xx-tunnel".length));
        expect(origin.requests.length).toBe(1);
      } finally {
        for (const s of sockets) s.destroy();
        proxy.close();
      }
    });
  }

  for (const proxyTls of [false, true] as const) {
    test.concurrent(
      `${proxyTls ? "https" : "http"}-proxy CONNECT → 101 fails even when the request asked to upgrade`,
      async () => {
        await using origin = await createAdversarialOrigin({ tls: true, body: "unreachable" });
        await using proxy = await createAdversarialProxy({
          tls: proxyTls,
          connectStatus: 101,
          connectStatusBody: "from-the-proxy",
        });

        await expect(
          fetch(origin.url, {
            proxy: proxy.url,
            keepalive: false,
            tls: laxTls,
            headers: { Connection: "Upgrade", Upgrade: "websocket" },
          }),
        ).rejects.toMatchObject({ code: "UnrequestedUpgrade" });
        expect(origin.requests.length).toBe(0);
      },
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Proxy unreachable.
// ─────────────────────────────────────────────────────────────────────────────

describe("proxy unreachable", () => {
  for (const originTls of [false, true] as const) {
    test.concurrent(`proxy port refused, ${originTls ? "https" : "http"} origin`, async () => {
      await using origin = await createAdversarialOrigin({ tls: originTls, body: "unreachable" });
      using dead = await deadPort();
      let code: string;
      try {
        const res = await fetch(origin.url, {
          proxy: `http://127.0.0.1:${dead.port}`,
          keepalive: false,
          tls: laxTls,
          signal: AbortSignal.timeout(15_000),
        });
        await res.arrayBuffer().catch(() => {});
        code = `resolved:${res.status}`;
      } catch (e) {
        code = errcode(e);
      }
      expect(code).toMatch(/ECONNREFUSED|ConnectionRefused/);
      expect(origin.requests.length).toBe(0);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Upstream unreachable via proxy: the proxy dials a refused port and the
// client sees the proxy's 502.
// ─────────────────────────────────────────────────────────────────────────────

describe("upstream unreachable via proxy", () => {
  for (const proxyTls of [false, true] as const) {
    test.concurrent(`${proxyTls ? "https" : "http"}-proxy, CONNECT upstream refused → 502`, async () => {
      using dead = await deadPort();
      await using proxy = await createAdversarialProxy({ tls: proxyTls });

      // Point at a refused port directly — the client will CONNECT to it,
      // the proxy will fail to dial, and return 502.
      await expect(
        fetch(`https://127.0.0.1:${dead.port}/`, {
          proxy: proxy.url,
          keepalive: false,
          tls: laxTls,
          signal: AbortSignal.timeout(15_000),
        }),
      ).rejects.toMatchObject({
        code: "ProxyConnectFailed",
        message: expect.stringContaining("502"),
      });
    });

    test.concurrent(`${proxyTls ? "https" : "http"}-proxy, absolute-form upstream refused → 502`, async () => {
      using dead = await deadPort();
      await using proxy = await createAdversarialProxy({ tls: proxyTls });
      const res = await fetch(`http://127.0.0.1:${dead.port}/`, {
        proxy: proxy.url,
        keepalive: false,
        tls: laxTls,
        signal: AbortSignal.timeout(15_000),
      });
      expect(res.status).toBe(502);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Proxy authentication.
// ─────────────────────────────────────────────────────────────────────────────

describe("proxy authentication", () => {
  for (const { proxyTls, originTls } of cartesian({
    proxyTls: [false, true] as const,
    originTls: [false, true] as const,
  })) {
    const route = `${proxyTls ? "https" : "http"}-proxy → ${originTls ? "https" : "http"}-origin`;

    test.concurrent(`${route}: missing auth → 407`, async () => {
      await using origin = await createAdversarialOrigin({ tls: originTls, body: "secret" });
      await using proxy = await createAdversarialProxy({
        tls: proxyTls,
        auth: { user: "alice", pass: "s3cret" },
      });
      const req = fetch(origin.url, { proxy: proxy.url, keepalive: false, tls: laxTls });
      if (originTls) {
        // CONNECT denied: fetch rejects, status carried in the message.
        await expect(req).rejects.toMatchObject({
          code: "ProxyConnectFailed",
          message: expect.stringContaining("407"),
        });
      } else {
        // Absolute-form http:// proxying: the 407 is a real Response.
        const res = await req;
        expect(res.status).toBe(407);
        expect(res.headers.get("proxy-authenticate")).toContain("Basic");
      }
      expect(origin.requests.length).toBe(0);
    });

    test.concurrent(`${route}: wrong auth → 403`, async () => {
      await using origin = await createAdversarialOrigin({ tls: originTls, body: "secret" });
      await using proxy = await createAdversarialProxy({
        tls: proxyTls,
        auth: { user: "alice", pass: "s3cret" },
      });
      const req = fetch(origin.url, {
        proxy: `${proxyTls ? "https" : "http"}://alice:wrong@127.0.0.1:${proxy.port}`,
        keepalive: false,
        tls: laxTls,
      });
      if (originTls) {
        await expect(req).rejects.toMatchObject({
          code: "ProxyConnectFailed",
          message: expect.stringContaining("403"),
        });
      } else {
        const res = await req;
        expect(res.status).toBe(403);
      }
      expect(origin.requests.length).toBe(0);
    });

    test.concurrent(`${route}: correct auth → 200`, async () => {
      await using origin = await createAdversarialOrigin({ tls: originTls, body: "secret" });
      await using proxy = await createAdversarialProxy({
        tls: proxyTls,
        auth: { user: "alice", pass: "s3cret" },
      });
      const res = await fetch(origin.url, {
        proxy: `${proxyTls ? "https" : "http"}://alice:s3cret@127.0.0.1:${proxy.port}`,
        keepalive: false,
        tls: laxTls,
      });
      expect(await res.text()).toBe("secret");
      expect(res.status).toBe(200);
      expect(proxy.connections[0].headers["proxy-authorization"]).toBe(
        "Basic " + Buffer.from("alice:s3cret").toString("base64"),
      );
    });

    test.concurrent(`${route}: auth via proxy.headers`, async () => {
      await using origin = await createAdversarialOrigin({ tls: originTls, body: "secret" });
      await using proxy = await createAdversarialProxy({
        tls: proxyTls,
        auth: { user: "alice", pass: "s3cret" },
      });
      const basic = "Basic " + Buffer.from("alice:s3cret").toString("base64");
      const res = await fetch(origin.url, {
        proxy: { url: proxy.url, headers: { "Proxy-Authorization": basic } },
        keepalive: false,
        tls: laxTls,
      });
      expect(await res.text()).toBe("secret");
      expect(res.status).toBe(200);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Inner-TLS verification through the tunnel.
// ─────────────────────────────────────────────────────────────────────────────

describe("inner TLS verification", () => {
  for (const proxyTls of [false, true] as const) {
    test.concurrent(
      `${proxyTls ? "https" : "http"}-proxy → https-origin, rejectUnauthorized=true with matching CA`,
      async () => {
        await using origin = await createAdversarialOrigin({ tls: true, body: "verified" });
        await using proxy = await createAdversarialProxy({ tls: proxyTls });
        const res = await fetch(origin.url, {
          proxy: proxy.url,
          keepalive: false,
          tls: { ca: tlsCert.cert, rejectUnauthorized: true },
        });
        expect(await res.text()).toBe("verified");
        expect(res.status).toBe(200);
      },
    );

    test.concurrent(
      `${proxyTls ? "https" : "http"}-proxy → https-origin, rejectUnauthorized=true without CA fails`,
      async () => {
        await using origin = await createAdversarialOrigin({ tls: true, body: "verified" });
        await using proxy = await createAdversarialProxy({ tls: proxyTls });
        let code: string;
        try {
          const res = await fetch(origin.url, {
            proxy: proxy.url,
            keepalive: false,
            tls: { rejectUnauthorized: true },
            signal: AbortSignal.timeout(15_000),
          });
          await res.arrayBuffer().catch(() => {});
          code = `resolved:${res.status}`;
        } catch (e) {
          code = errcode(e);
        }
        expect(code).not.toBe("resolved:200");
        expect(code).not.toBe("TimeoutError");
        expect(code).toMatch(/CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY|DEPTH_ZERO/);
        // Inner handshake failed, so the origin saw no decrypted request.
        expect(origin.requests.length).toBe(0);
        // For an HTTP proxy the outer leg has no TLS; the CONNECT must
        // have been sent and the failure is the inner handshake. For an
        // HTTPS proxy the same rejectUnauthorized:true + no CA would
        // also reject the outer self-signed proxy cert before CONNECT;
        // either way the fetch must not succeed, but only the http-proxy
        // case proves the inner-TLS path specifically.
        if (!proxyTls) {
          expect(proxy.connectCount()).toBe(1);
        }
      },
    );

    test.concurrent(`${proxyTls ? "https" : "http"}-proxy → https-origin, checkServerIdentity rejects`, async () => {
      await using origin = await createAdversarialOrigin({ tls: true, body: "verified" });
      await using proxy = await createAdversarialProxy({ tls: proxyTls });
      let code: string;
      try {
        const res = await fetch(origin.url, {
          proxy: proxy.url,
          keepalive: false,
          tls: {
            ca: tlsCert.cert,
            rejectUnauthorized: true,
            checkServerIdentity: () => new Error("pinned"),
          },
          signal: AbortSignal.timeout(15_000),
        });
        await res.arrayBuffer().catch(() => {});
        code = `resolved:${res.status}`;
      } catch (e) {
        const any = e as any;
        code = any?.message ?? errcode(e);
      }
      expect(code).toBe("pinned");
      expect(origin.requests.length).toBe(0);
      // The tunnel was established before checkServerIdentity ran (it
      // runs on the inner handshake, not the outer). The proxy saw the
      // CONNECT; the origin saw no request.
      expect(proxy.connectCount()).toBe(1);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Protocol rejection: unsupported proxy schemes.
// ─────────────────────────────────────────────────────────────────────────────

describe("unsupported proxy scheme", () => {
  for (const scheme of ["ftp", "socks4", "socks5", "socks5h", "ws"] as const) {
    test.concurrent(`${scheme}:// proxy is rejected with UnsupportedProxyProtocol`, async () => {
      await using origin = await createAdversarialOrigin({ tls: false, body: "ok" });
      await expect(fetch(origin.url, { proxy: `${scheme}://127.0.0.1:1`, keepalive: false })).rejects.toMatchObject({
        code: "UnsupportedProxyProtocol",
      });
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// HTTP/2 is not offered through a proxy. The client must negotiate
// http/1.1 in the inner-TLS ALPN even against an h2-capable origin.
// ─────────────────────────────────────────────────────────────────────────────

describe("HTTP/2 not offered through proxy", () => {
  for (const proxyTls of [false, true] as const) {
    test.concurrent(`${proxyTls ? "https" : "http"}-proxy → h2-capable https origin negotiates http/1.1`, async () => {
      // A raw TLS server that advertises both h2 and http/1.1 and echoes
      // back the protocol it actually negotiated with the client. A
      // Bun.serve origin can't expose the ALPN result to its handler, so
      // observe it at the socket level instead.
      const server = tls.createServer({ ...tlsCert, ALPNProtocols: ["h2", "http/1.1"] }, sock => {
        sock.on("error", () => {});
        sock.once("data", () => {
          const negotiated = sock.alpnProtocol || "none";
          const body = `alpn=${negotiated}`;
          sock.write(
            `HTTP/1.1 200 OK\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
          );
          sock.end();
        });
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const originPort = (server.address() as net.AddressInfo).port;
      await using proxy = await createAdversarialProxy({ tls: proxyTls });
      try {
        const res = await fetch(`https://localhost:${originPort}/`, {
          proxy: proxy.url,
          keepalive: false,
          tls: laxTls,
        });
        // If the client offered h2 in the inner ALPN, the origin would have
        // selected it (h2 is first in ALPNProtocols) and this assertion
        // would read "alpn=h2".
        expect(await res.text()).toBe("alpn=http/1.1");
        expect(res.status).toBe(200);
        expect(proxy.connections[0].method).toBe("CONNECT");
      } finally {
        server.close();
      }
    });
  }
});
