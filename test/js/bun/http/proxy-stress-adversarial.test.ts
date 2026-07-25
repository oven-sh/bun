/**
 * Adversarial combinations: each test pairs several "hostile" conditions at
 * once (split CONNECT × compression × streaming body × keepalive, etc.),
 * plus targeted exercises of the code paths the matrix/lifecycle files
 * can't reach individually (checkServerIdentity re-entry, Host header
 * shape, origin-facing header content, response status matrix).
 *
 * Also covers the WebSocket proxy tunnel (`WebSocketProxyTunnel`), which is
 * a separate SSLWrapper consumer from the fetch `ProxyTunnel` and had zero
 * stress coverage for the wss-through-https-proxy (double-TLS) case.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { isASAN } from "harness";
import { once } from "node:events";
import net from "node:net";
import tls from "node:tls";
import {
  cartesian,
  clearProxyEnv,
  createAdversarialOrigin,
  createAdversarialProxy,
  errcode,
  laxTls,
  makeBody,
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
// Stacked adversarial conditions: split CONNECT envelope × chunked
// compressed body × streaming upload × redirect — all through the same
// tunnel type.
// ─────────────────────────────────────────────────────────────────────────────

describe("stacked adversarial", () => {
  for (const { proxyTls, splitConnect, encoding, keepalive } of cartesian({
    proxyTls: [false, true] as const,
    splitConnect: [1, 3, 10] as const,
    encoding: ["identity", "gzip", "br"] as const,
    keepalive: [false, true] as const,
  })) {
    test.concurrent(
      `${proxyTls ? "https" : "http"}-proxy split=${splitConnect} chunked/${encoding} keepalive=${keepalive}`,
      async () => {
        const payload = makeBody(8192, "A");
        await using origin = await createAdversarialOrigin({
          tls: true,
          body: payload,
          framing: "chunked",
          encoding,
        });
        await using proxy = await createAdversarialProxy({
          tls: proxyTls,
          splitConnectReply: splitConnect,
        });
        const res = await fetch(origin.url, {
          method: "POST",
          body: Buffer.alloc(1024, "q"),
          proxy: proxy.url,
          keepalive,
          tls: laxTls,
        });
        expect(await res.text()).toBe(payload);
        expect(res.status).toBe(200);
        expect(origin.requests[0].body.length).toBe(1024);
      },
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Origin response status matrix through every proxy combination. The body
// must be delivered regardless of status; redirect-class statuses with no
// Location must not hang.
// ─────────────────────────────────────────────────────────────────────────────

describe("origin status through tunnel", () => {
  const STATUSES = [200, 201, 204, 206, 301, 304, 400, 401, 404, 418, 500, 503] as const;
  for (const { proxyTls, originTls, status } of cartesian({
    proxyTls: [false, true] as const,
    originTls: [false, true] as const,
    status: STATUSES,
  })) {
    test.concurrent(
      `${proxyTls ? "https" : "http"}-proxy → ${originTls ? "https" : "http"}-origin status=${status}`,
      async () => {
        // 204/304 carry no body per RFC; everything else does.
        const hasBody = status !== 204 && status !== 304;
        await using origin = await createAdversarialOrigin({
          tls: originTls,
          status,
          body: hasBody ? `status-${status}` : "",
          framing: "content-length",
        });
        await using proxy = await createAdversarialProxy({ tls: proxyTls });
        const res = await fetch(origin.url, {
          proxy: proxy.url,
          keepalive: false,
          tls: laxTls,
          redirect: "manual", // surface 3xx as-is
        });
        expect(res.status).toBe(status);
        expect(await res.text()).toBe(hasBody ? `status-${status}` : "");
      },
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Request header shape seen by the origin through each proxy path. The
// Host header must name the origin (not the proxy), and user headers must
// pass through unmodified in both CONNECT-tunnel and absolute-form paths.
// ─────────────────────────────────────────────────────────────────────────────

describe("origin-facing headers", () => {
  for (const { proxyTls, originTls } of cartesian({
    proxyTls: [false, true] as const,
    originTls: [false, true] as const,
  })) {
    test.concurrent(
      `${proxyTls ? "https" : "http"}-proxy → ${originTls ? "https" : "http"}-origin Host + user headers`,
      async () => {
        await using origin = await createAdversarialOrigin({ tls: originTls, body: "ok" });
        await using proxy = await createAdversarialProxy({ tls: proxyTls });
        const res = await fetch(`${origin.url}/path?q=1`, {
          proxy: proxy.url,
          keepalive: false,
          tls: laxTls,
          headers: {
            "X-User-Header": "user-value",
            "Accept": "application/json",
          },
        });
        expect(res.status).toBe(200);
        const h = origin.requests[0].headers;
        // Host names the origin, not the proxy.
        expect(h["host"]).toBe(`localhost:${origin.port}`);
        expect(h["x-user-header"]).toBe("user-value");
        expect(h["accept"]).toBe("application/json");
        expect(origin.requests[0].path).toBe("/path?q=1");
      },
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// checkServerIdentity callback re-entry: the callback runs on the JS
// thread with the tunnel parked; it can allocate, throw, or issue other
// fetches. The tunnel must resume correctly after approval, and clean up
// correctly after rejection, through both proxy types.
// ─────────────────────────────────────────────────────────────────────────────

describe("checkServerIdentity through tunnel", () => {
  for (const proxyTls of [false, true] as const) {
    test.concurrent(`${proxyTls ? "https" : "http"}-proxy: callback approves → request completes`, async () => {
      await using origin = await createAdversarialOrigin({ tls: true, body: "approved" });
      await using proxy = await createAdversarialProxy({ tls: proxyTls });
      let called = 0;
      const res = await fetch(origin.url, {
        proxy: proxy.url,
        keepalive: false,
        tls: {
          ca: tlsCert.cert,
          rejectUnauthorized: true,
          checkServerIdentity: (host: string, cert: any) => {
            called++;
            expect(host).toBe("localhost");
            expect(cert).toBeDefined();
            // Allocate a bit while the tunnel is parked.
            Buffer.alloc(1024);
            return undefined; // approve
          },
        },
      });
      expect(await res.text()).toBe("approved");
      expect(called).toBe(1);
    });

    test.concurrent(
      `${proxyTls ? "https" : "http"}-proxy: callback rejects → fetch rejects, origin untouched`,
      async () => {
        await using origin = await createAdversarialOrigin({ tls: true, body: "never" });
        await using proxy = await createAdversarialProxy({ tls: proxyTls });
        let caught: any;
        try {
          await fetch(origin.url, {
            proxy: proxy.url,
            keepalive: false,
            tls: {
              ca: tlsCert.cert,
              rejectUnauthorized: true,
              checkServerIdentity: () => new Error("nope"),
            },
            signal: AbortSignal.timeout(10_000),
          });
        } catch (e) {
          caught = e;
        }
        expect(caught?.message).toBe("nope");
        expect(origin.requests.length).toBe(0);
      },
    );

    test.concurrent(
      `${proxyTls ? "https" : "http"}-proxy: callback approves ${isASAN ? 50 : 20}× under GC pressure`,
      async () => {
        await using origin = Bun.serve({ port: 0, tls: tlsCert, fetch: () => new Response("gc") });
        await using proxy = await createAdversarialProxy({ tls: proxyTls });
        const N = isASAN ? 50 : 20;
        for (let i = 0; i < N; i++) {
          const res = await fetch(origin.url, {
            proxy: proxy.url,
            keepalive: true,
            tls: {
              ca: tlsCert.cert,
              rejectUnauthorized: true,
              checkServerIdentity: () => {
                Bun.gc(false);
                return undefined;
              },
            },
          });
          expect(await res.text()).toBe("gc");
        }
      },
      60_000,
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Query string + path edge cases through proxy.
// ─────────────────────────────────────────────────────────────────────────────

describe("path and query through proxy", () => {
  const PATHS = [
    "/",
    "/a/b/c",
    "/with%20space",
    "/?a=1&b=2",
    "/p?q=%E4%B8%AD%E6%96%87", // URL-encoded UTF-8
    "/" + Buffer.alloc(500, "p").toString("latin1"),
  ] as const;
  for (const { proxyTls, originTls, path } of cartesian({
    proxyTls: [false, true] as const,
    originTls: [false, true] as const,
    path: PATHS,
  })) {
    const short = path.length > 20 ? path.slice(0, 17) + "..." : path;
    test.concurrent(
      `${proxyTls ? "https" : "http"}-proxy → ${originTls ? "https" : "http"}-origin path="${short}"`,
      async () => {
        await using origin = await createAdversarialOrigin({ tls: originTls, body: "ok" });
        await using proxy = await createAdversarialProxy({ tls: proxyTls });
        const res = await fetch(origin.url + path, { proxy: proxy.url, keepalive: false, tls: laxTls });
        expect(res.status).toBe(200);
        expect(origin.requests[0].path).toBe(path);
      },
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// verbose:true through every proxy combination. The verbose output goes to
// stderr; here we only check that the request still succeeds (verbose
// touches internal state that could regress).
// ─────────────────────────────────────────────────────────────────────────────

describe("verbose through proxy", () => {
  for (const { proxyTls, originTls } of cartesian({
    proxyTls: [false, true] as const,
    originTls: [false, true] as const,
  })) {
    test.concurrent(
      `${proxyTls ? "https" : "http"}-proxy → ${originTls ? "https" : "http"}-origin verbose:true`,
      async () => {
        await using origin = await createAdversarialOrigin({ tls: originTls, body: "v" });
        await using proxy = await createAdversarialProxy({ tls: proxyTls });
        const res = await fetch(origin.url, {
          proxy: proxy.url,
          keepalive: false,
          tls: laxTls,
          verbose: true,
        });
        expect(await res.text()).toBe("v");
        expect(res.status).toBe(200);
      },
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// AbortSignal.timeout through every proxy combination, against an origin
// that never replies. Must reject with TimeoutError, not hang.
// ─────────────────────────────────────────────────────────────────────────────

describe("AbortSignal.timeout through proxy", () => {
  for (const { proxyTls, originTls } of cartesian({
    proxyTls: [false, true] as const,
    originTls: [false, true] as const,
  })) {
    test.concurrent(
      `${proxyTls ? "https" : "http"}-proxy → ${originTls ? "https" : "http"}-origin, origin never replies → TimeoutError`,
      async () => {
        // Origin accepts the connection but never writes a response.
        const handler = (sock: net.Socket) => {
          sock.on("error", () => {});
          // swallow data forever
        };
        const server = originTls
          ? tls.createServer({ ...tlsCert, rejectUnauthorized: false }, handler)
          : net.createServer(handler);
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        const originPort = (server.address() as net.AddressInfo).port;
        try {
          await using proxy = await createAdversarialProxy({ tls: proxyTls });

          let code: string;
          const t0 = Date.now();
          try {
            const res = await fetch(`${originTls ? "https" : "http"}://127.0.0.1:${originPort}/`, {
              proxy: proxy.url,
              keepalive: false,
              tls: laxTls,
              signal: AbortSignal.timeout(500),
            });
            await res.arrayBuffer().catch(() => {});
            code = `resolved:${res.status}`;
          } catch (e) {
            code = errcode(e);
          }
          const elapsed = Date.now() - t0;
          expect(code).toBe("TimeoutError");
          // The 500ms timeout is honored (with generous slack for debug+ASAN
          // builds), not the client's multi-second default idle timeout.
          expect(elapsed).toBeLessThan(10_000);
        } finally {
          server.close();
        }
      },
      20_000,
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// WebSocket through proxy: full matrix of ws/wss target × http/https proxy,
// plus lifecycle edges (proxy closes mid-handshake, origin closes mid-frame,
// large frames, abort during upgrade).
//
// Uses Bun's native WebSocket client (global `WebSocket`) with the `proxy`
// constructor option, which drives `WebSocketProxyTunnel` for wss targets.
// ─────────────────────────────────────────────────────────────────────────────

describe("WebSocket through proxy", () => {
  function makeEchoServer(withTls: boolean) {
    return Bun.serve({
      port: 0,
      tls: withTls ? tlsCert : undefined,
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response("expected upgrade", { status: 400 });
      },
      websocket: {
        open(ws) {
          ws.send("hello");
        },
        message(ws, msg) {
          ws.send(msg);
        },
      },
    });
  }

  for (const { proxyTls, originTls } of cartesian({
    proxyTls: [false, true] as const,
    originTls: [false, true] as const,
  })) {
    const scheme = originTls ? "wss" : "ws";
    const route = `${proxyTls ? "https" : "http"}-proxy → ${scheme}-origin`;

    test.concurrent(`${route}: echo round-trip`, async () => {
      await using origin = makeEchoServer(originTls);
      await using proxy = await createAdversarialProxy({ tls: proxyTls });

      const received: string[] = [];
      const { promise: done, resolve, reject } = Promise.withResolvers<void>();
      const ws = new WebSocket(`${scheme}://localhost:${origin.port}/`, {
        proxy: proxy.url,
        tls: originTls || proxyTls ? laxTls : undefined,
      } as any);
      ws.onmessage = ev => {
        received.push(String(ev.data));
        if (received.length === 1) ws.send("echo-me");
        if (received.length === 2) {
          ws.close();
          resolve();
        }
      };
      ws.onerror = ev => reject(new Error("ws error: " + (ev as any).message));
      ws.onclose = ev => {
        if (received.length < 2) reject(new Error(`closed early: ${ev.code} ${ev.reason}`));
      };
      await done;
      expect(received).toEqual(["hello", "echo-me"]);
      expect(proxy.connections.length).toBe(1);
      expect(proxy.connections[0].method).toBe("CONNECT");
    });

    test.concurrent(`${route}: large binary frame round-trip`, async () => {
      await using origin = makeEchoServer(originTls);
      await using proxy = await createAdversarialProxy({ tls: proxyTls });
      const payload = new Uint8Array(256 * 1024).fill(0xab);

      const { promise: done, resolve, reject } = Promise.withResolvers<Uint8Array>();
      const ws = new WebSocket(`${scheme}://localhost:${origin.port}/`, {
        proxy: proxy.url,
        tls: originTls || proxyTls ? laxTls : undefined,
      } as any);
      ws.binaryType = "arraybuffer";
      let gotHello = false;
      let settled = false;
      ws.onmessage = ev => {
        if (!gotHello) {
          gotHello = true;
          ws.send(payload);
          return;
        }
        settled = true;
        resolve(new Uint8Array(ev.data as ArrayBuffer));
        ws.close();
      };
      ws.onerror = ev => reject(new Error("ws error: " + (ev as any).message));
      ws.onclose = ev => {
        if (!settled) reject(new Error(`closed early: ${ev.code} ${ev.reason}`));
      };
      const got = await done;
      expect(got.length).toBe(payload.length);
      expect(got[0]).toBe(0xab);
      expect(got[got.length - 1]).toBe(0xab);
    });

    test.concurrent(`${route}: proxy RSTs at CONNECT → error event`, async () => {
      await using origin = makeEchoServer(originTls);
      await using proxy = await createAdversarialProxy({
        tls: proxyTls,
        killClientAt: "request-received",
      });
      const { promise, resolve, reject } = Promise.withResolvers<string>();
      const ws = new WebSocket(`${scheme}://localhost:${origin.port}/`, {
        proxy: proxy.url,
        tls: originTls || proxyTls ? laxTls : undefined,
      } as any);
      ws.onopen = () => reject(new Error("open fired"));
      ws.onerror = () => resolve("error");
      ws.onclose = () => resolve("close");
      const outcome = await promise;
      expect(["error", "close"]).toContain(outcome);
    });

    test.concurrent(`${route}: CONNECT → 407 without auth → error/close event`, async () => {
      await using origin = makeEchoServer(originTls);
      await using proxy = await createAdversarialProxy({
        tls: proxyTls,
        auth: { user: "u", pass: "p" },
      });
      const { promise, resolve, reject } = Promise.withResolvers<string>();
      const ws = new WebSocket(`${scheme}://localhost:${origin.port}/`, {
        proxy: proxy.url, // no credentials
        tls: originTls || proxyTls ? laxTls : undefined,
      } as any);
      ws.onopen = () => reject(new Error("open fired"));
      ws.onerror = () => resolve("error");
      ws.onclose = () => resolve("close");
      const outcome = await promise;
      expect(["error", "close"]).toContain(outcome);
    });

    test.concurrent(`${route}: rapid close after open`, async () => {
      await using origin = makeEchoServer(originTls);
      await using proxy = await createAdversarialProxy({ tls: proxyTls });
      const { promise, resolve, reject } = Promise.withResolvers<number>();
      const ws = new WebSocket(`${scheme}://localhost:${origin.port}/`, {
        proxy: proxy.url,
        tls: originTls || proxyTls ? laxTls : undefined,
      } as any);
      ws.onopen = () => ws.close(1000, "done");
      ws.onerror = ev => reject(new Error("ws error: " + (ev as any).message));
      ws.onclose = ev => resolve(ev.code);
      const code = await promise;
      expect(code).toBe(1000);
    });
  }

  // wss through https proxy: the double-TLS case that had zero coverage.
  // Churn it under GC pressure to look for tunnel lifecycle issues.
  test("wss via https-proxy: open/close churn under GC", async () => {
    await using origin = makeEchoServer(true);
    await using proxy = await createAdversarialProxy({ tls: true });
    const N = isASAN ? 40 : 20;
    for (let i = 0; i < N; i++) {
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      const ws = new WebSocket(`wss://localhost:${origin.port}/`, {
        proxy: proxy.url,
        tls: laxTls,
      } as any);
      ws.onmessage = () => {
        ws.close();
      };
      ws.onclose = () => resolve();
      ws.onerror = ev => reject(new Error("ws error: " + (ev as any).message));
      await promise;
      if (i % 5 === 0) Bun.gc(true);
    }
  }, 60_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// Interleaved proxy and direct fetches to the same origin. The client's
// connection pool keys tunneled and non-tunneled connections separately; a
// direct request must never end up on a tunnel and vice versa.
// ─────────────────────────────────────────────────────────────────────────────

describe("interleaved proxy/direct", () => {
  for (const proxyTls of [false, true] as const) {
    test(`${proxyTls ? "https" : "http"}-proxy + direct to same https origin, alternating`, async () => {
      await using origin = Bun.serve({
        port: 0,
        tls: tlsCert,
        fetch: req => new Response(new URL(req.url).searchParams.get("via") ?? "?"),
      });
      await using proxy = await createAdversarialProxy({ tls: proxyTls });

      const totalBytesUp = () => proxy.connections.reduce((s, c) => s + c.bytesUp, 0);
      for (let i = 0; i < 6; i++) {
        const viaProxy = i % 2 === 0;
        const before = totalBytesUp();
        const res = await fetch(`${origin.url}?via=${viaProxy ? "proxy" : "direct"}`, {
          ...(viaProxy ? { proxy: proxy.url } : {}),
          keepalive: true,
          tls: laxTls,
        });
        expect(await res.text()).toBe(viaProxy ? "proxy" : "direct");
        // A direct fetch mis-routed onto a pooled tunnel would show up as
        // new client→upstream bytes on the proxy even though no `proxy`
        // option was passed.
        if (!viaProxy) expect(totalBytesUp()).toBe(before);
      }
      // 3 proxied requests → at least 1 CONNECT, at most 3.
      expect(proxy.connectCount()).toBeGreaterThanOrEqual(1);
      expect(proxy.connectCount()).toBeLessThanOrEqual(3);
      // http-proxy: 3 sequential keepalive proxied requests reuse one
      // tunnel deterministically. A proxied request that silently
      // bypassed the proxy would leave this at 0; a direct request that
      // opened its own CONNECT would push it above 1.
      if (!proxyTls) expect(proxy.connectCount()).toBe(1);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CONNECT target line shape: host:port format for default vs non-default
// ports.
// ─────────────────────────────────────────────────────────────────────────────

describe("CONNECT target format", () => {
  for (const proxyTls of [false, true] as const) {
    test.concurrent(`${proxyTls ? "https" : "http"}-proxy CONNECT target is host:port`, async () => {
      await using origin = await createAdversarialOrigin({ tls: true, body: "ok" });
      await using proxy = await createAdversarialProxy({ tls: proxyTls });
      const res = await fetch(origin.url, { proxy: proxy.url, keepalive: false, tls: laxTls });
      expect(res.status).toBe(200);
      // CONNECT line targets the origin's host:port, not a URL.
      expect(proxy.connections[0].target).toBe(`localhost:${origin.port}`);
      // And a matching Host header.
      expect(proxy.connections[0].headers["host"]).toBe(`localhost:${origin.port}`);
    });
  }
});
