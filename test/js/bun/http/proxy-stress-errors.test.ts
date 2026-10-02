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
import zlib from "node:zlib";
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

/**
 * What the proxy itself answered. A refused CONNECT rejects with
 * `ERR_PROXY_TUNNEL` carrying the proxy's status and headers (its reply is not
 * the https origin's response); an absolute-form request to an http origin
 * resolves with the proxy's reply like any other response.
 */
async function proxyReply(url: string, init: BunFetchRequestInit) {
  try {
    const res = await fetch(url, init);
    return { via: "response" as const, status: res.status, headers: res.headers };
  } catch (e: any) {
    if (e?.code !== "ERR_PROXY_TUNNEL") throw e;
    return { via: "ERR_PROXY_TUNNEL" as const, status: e.status as number, headers: e.headers as Headers };
  }
}

describe("CONNECT failure status", () => {
  const STATUSES = [400, 403, 407, 500, 502, 503, 504] as const;
  for (const { proxyTls, status } of cartesian({
    proxyTls: [false, true] as const,
    status: STATUSES,
  })) {
    test.concurrent(
      `${proxyTls ? "https" : "http"}-proxy CONNECT → ${status} rejects with the proxy's status`,
      async () => {
        await using origin = await createAdversarialOrigin({ tls: true, body: "unreachable" });
        await using proxy = await createAdversarialProxy({
          tls: proxyTls,
          connectStatus: status,
          connectStatusBody: `proxy-said-${status}`,
        });

        const reply = await proxyReply(origin.url, {
          proxy: proxy.url,
          keepalive: false,
          tls: laxTls,
          signal: AbortSignal.timeout(15_000),
        });
        // The proxy's reply never resolves as the origin's response, and the
        // client does NOT tunnel through.
        expect({ via: reply.via, status: reply.status }).toEqual({ via: "ERR_PROXY_TUNNEL", status });
        // The origin must never have been reached.
        expect(origin.requests.length).toBe(0);
      },
    );
  }

  // A 3xx CONNECT reply rejects and is not followed (already covered for 307
  // in proxy.test.ts; here we add 301/302 and assert the Location is not
  // interpreted).
  for (const status of [301, 302] as const) {
    test.concurrent(`CONNECT → ${status} with Location is not followed`, async () => {
      await using origin = await createAdversarialOrigin({ tls: true, body: "unreachable" });
      await using bait = await createAdversarialOrigin({ tls: false, body: "bait" });
      await using proxy = await createAdversarialProxy({
        connectStatus: status,
        connectReplyHeaders: { Location: bait.url },
      });

      const reply = await proxyReply(origin.url, { proxy: proxy.url, keepalive: false, tls: laxTls });
      expect({ via: reply.via, status: reply.status, location: reply.headers.get("location") }).toEqual({
        via: "ERR_PROXY_TUNNEL",
        status,
        location: bait.url,
      });
      expect(bait.requests.length).toBe(0);
      expect(origin.requests.length).toBe(0);
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
        ).rejects.toMatchObject({ code: "ERR_PROXY_TUNNEL", status: 101 });
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
      const reply = await proxyReply(`https://127.0.0.1:${dead.port}/`, {
        proxy: proxy.url,
        keepalive: false,
        tls: laxTls,
        signal: AbortSignal.timeout(15_000),
      });
      expect({ via: reply.via, status: reply.status }).toEqual({ via: "ERR_PROXY_TUNNEL", status: 502 });
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
      const reply = await proxyReply(origin.url, { proxy: proxy.url, keepalive: false, tls: laxTls });
      expect({ via: reply.via, status: reply.status }).toEqual({
        via: originTls ? "ERR_PROXY_TUNNEL" : "response",
        status: 407,
      });
      expect(reply.headers.get("proxy-authenticate")).toContain("Basic");
      expect(origin.requests.length).toBe(0);
    });

    test.concurrent(`${route}: wrong auth → 403`, async () => {
      await using origin = await createAdversarialOrigin({ tls: originTls, body: "secret" });
      await using proxy = await createAdversarialProxy({
        tls: proxyTls,
        auth: { user: "alice", pass: "s3cret" },
      });
      const reply = await proxyReply(origin.url, {
        proxy: `${proxyTls ? "https" : "http"}://alice:wrong@127.0.0.1:${proxy.port}`,
        keepalive: false,
        tls: laxTls,
      });
      expect({ via: reply.via, status: reply.status }).toEqual({
        via: originTls ? "ERR_PROXY_TUNNEL" : "response",
        status: 403,
      });
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

// ─────────────────────────────────────────────────────────────────────────────
// A compressed body that is damaged inside whole HTTP framing. The client
// ends the request itself when its decoder fails. Through a tunnel that close
// must not read as the origin ending a complete body.
// ─────────────────────────────────────────────────────────────────────────────

describe("damaged compressed body through a CONNECT tunnel", () => {
  const payload = Buffer.alloc(108_000, "line of an honest download\n");

  const codecs = {
    gzip: { compress: zlib.gzipSync, error: "ZlibError" },
    deflate: { compress: zlib.deflateSync, error: "ZlibError" },
    br: { compress: zlib.brotliCompressSync, error: "BrotliDecompressionError" },
    zstd: { compress: zlib.zstdCompressSync, error: "ZstdDecompressionError" },
  } as const;
  type Encoding = keyof typeof codecs;
  type Framing = "chunked" | "close-delimited";

  const damages = {
    /** The whole stream. */
    none: (stream: Buffer) => stream,
    /** The stream stops in the middle. */
    cut: (stream: Buffer) => stream.subarray(0, stream.length >> 1),
    /** One bit of the trailing checksum is flipped: CRC-32 for gzip, Adler-32 for deflate. */
    checksum: (stream: Buffer, encoding: Encoding) => {
      const damaged = Buffer.from(stream);
      damaged[damaged.length - (encoding === "gzip" ? 5 : 1)] ^= 1;
      return damaged;
    },
    /** Not a compressed stream at all. */
    garbage: () => Buffer.from("this is no compressed stream at all"),
  };
  type Damage = keyof typeof damages;

  /**
   * An https origin that answers with the response head, then holds the body
   * until `release()`. The caller releases it once `fetch()` has resolved, so
   * the body reaches the client in a socket read of its own.
   */
  async function createHeldBodyOrigin(encoding: Encoding, framing: Framing, body: Buffer) {
    const { promise: released, resolve: release } = Promise.withResolvers<void>();
    const server = tls.createServer(tlsCert, sock => {
      sock.on("error", () => {});
      sock.once("data", async () => {
        sock.write(
          `HTTP/1.1 200 OK\r\nContent-Encoding: ${encoding}\r\n` +
            (framing === "chunked" ? "Transfer-Encoding: chunked\r\n\r\n" : "Connection: close\r\n\r\n"),
        );
        await released;
        if (framing === "chunked") {
          // The framing is whole: one chunk, then the last chunk.
          sock.write(
            Buffer.concat([Buffer.from(`${body.length.toString(16)}\r\n`), body, Buffer.from("\r\n0\r\n\r\n")]),
          );
        } else {
          sock.end(body);
        }
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    return {
      url: `https://localhost:${(server.address() as net.AddressInfo).port}`,
      release,
      async [Symbol.asyncDispose]() {
        server.close();
      },
    };
  }

  /** How reading the body through the tunnel ends: with this many bytes, or with this error code. */
  async function readBody(encoding: Encoding, framing: Framing, damage: Damage, proxyTls: boolean) {
    const body = damages[damage](codecs[encoding].compress(payload), encoding);
    await using origin = await createHeldBodyOrigin(encoding, framing, body);
    await using proxy = await createAdversarialProxy({ tls: proxyTls });
    const res = await fetch(origin.url, { proxy: proxy.url, keepalive: false, tls: laxTls });
    expect(proxy.connectCount()).toBe(1);
    origin.release();
    try {
      return { bytes: (await res.arrayBuffer()).byteLength };
    } catch (e) {
      return { error: errcode(e) };
    }
  }

  const cells: Array<{ encoding: Encoding; damage: Damage }> = [
    ...cartesian({ encoding: ["gzip", "deflate", "br", "zstd"], damage: ["none", "cut", "garbage"] } as const),
    // Only gzip and deflate end in a checksum.
    ...cartesian({ encoding: ["gzip", "deflate"], damage: ["checksum"] } as const),
  ];

  for (const { encoding, damage } of cells) {
    for (const framing of ["chunked", "close-delimited"] as const) {
      test.concurrent(`${encoding}, ${framing}, ${damage}`, async () => {
        expect(await readBody(encoding, framing, damage, false)).toEqual(
          damage === "none" ? { bytes: payload.length } : { error: codecs[encoding].error },
        );
      });
    }
  }

  // The failure closes the socket to the proxy: one case for each kind, in each body stage.
  test.concurrent("https proxy: gzip, chunked, cut", async () => {
    expect(await readBody("gzip", "chunked", "cut", true)).toEqual({ error: "ZlibError" });
  });
  test.concurrent("https proxy: gzip, close-delimited, garbage", async () => {
    expect(await readBody("gzip", "close-delimited", "garbage", true)).toEqual({ error: "ZlibError" });
  });
});
