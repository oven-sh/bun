/**
 * Concurrency, connection-pool, and memory stress for the proxy tunnel.
 *
 * The tunnel pool (HTTPContext::PooledSocket) keys on (proxy addr, target
 * host:port, proxy_auth_hash, established_with_reject_unauthorized), and
 * there is one pool per TLS context: the default one plus one per `tls`
 * option that needs its own context (ca / cert / key ...). These tests churn
 * those pools: many parallel requests to one target, many targets through one
 * proxy, reuse out of both kinds of context, interleaved aborts, and a
 * subprocess leak probe that watches RSS over thousands of iterations.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isCI, isMacOS, isWindows } from "harness";
import { once } from "node:events";
import net from "node:net";
import { join } from "node:path";
import tls from "node:tls";
import {
  cartesian,
  clearProxyEnv,
  createAdversarialProxy,
  laxTls,
  makeBody,
  proxyFreeEnv,
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
// Parallel requests to one origin through one proxy.
// ─────────────────────────────────────────────────────────────────────────────

describe("parallel requests, single origin", () => {
  for (const { proxyTls, originTls, keepalive } of cartesian({
    proxyTls: [false, true] as const,
    originTls: [false, true] as const,
    keepalive: [false, true] as const,
  })) {
    const N = 32;
    test.concurrent(
      `${N}× parallel ${proxyTls ? "https" : "http"}-proxy → ${originTls ? "https" : "http"}-origin keepalive=${keepalive}`,
      async () => {
        // Use Bun.serve here so keepalive reuse actually works on the
        // origin side (the raw adversarial origin closes after each
        // response, which defeats the pool).
        await using origin = Bun.serve({
          port: 0,
          tls: originTls ? tlsCert : undefined,
          fetch: req => new Response(new URL(req.url).searchParams.get("i") ?? "?"),
        });
        await using proxy = await createAdversarialProxy({ tls: proxyTls });

        const results = await Promise.all(
          Array.from({ length: N }, (_, i) =>
            fetch(`${origin.url}?i=${i}`, {
              proxy: proxy.url,
              keepalive,
              tls: laxTls,
            }).then(async r => ({ status: r.status, body: await r.text() })),
          ),
        );

        // Every request got its own response body back — no cross-talk.
        for (let i = 0; i < N; i++) {
          expect(results[i]).toEqual({ status: 200, body: String(i) });
        }

        // All traffic went through the proxy.
        expect(proxy.connections.length).toBeGreaterThanOrEqual(1);
        if (originTls) {
          expect(proxy.connections.every(c => c.method === "CONNECT")).toBe(true);
        }
      },
      30_000,
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Sequential keep-alive reuse of the CONNECT tunnel: N requests to the same
// https origin, with keepalive on, should result in exactly one CONNECT.
// The double-TLS path (https proxy → https origin) is what's missing from
// proxy.test.ts's reuse coverage.
// ─────────────────────────────────────────────────────────────────────────────

describe("tunnel reuse", () => {
  for (const proxyTls of [false, true] as const) {
    test(`${proxyTls ? "https" : "http"}-proxy → https-origin, 5 sequential requests reuse one CONNECT`, async () => {
      await using origin = Bun.serve({
        port: 0,
        tls: tlsCert,
        fetch: () => new Response("reused"),
      });
      await using proxy = await createAdversarialProxy({ tls: proxyTls });

      for (let i = 0; i < 5; i++) {
        const res = await fetch(origin.url, { proxy: proxy.url, keepalive: true, tls: laxTls });
        expect(await res.text()).toBe("reused");
        expect(res.status).toBe(200);
      }
      // laxTls carries a `ca`, so the connection to the proxy lives in that
      // config's own TLS context. The finished tunnel must be pooled into
      // that same context (where the next request looks for it), so a
      // single CONNECT serves all five requests for both proxy flavours.
      expect(proxy.connectCount()).toBe(1);
    });

    test(`${proxyTls ? "https" : "http"}-proxy → https-origin, different auth hashes use separate tunnels`, async () => {
      await using origin = Bun.serve({ port: 0, tls: tlsCert, fetch: () => new Response("ok") });
      await using proxy = await createAdversarialProxy({ tls: proxyTls });

      const creds = ["a:1", "b:2", "a:1"]; // third reuses the first tunnel
      for (const c of creds) {
        const res = await fetch(origin.url, {
          proxy: `${proxyTls ? "https" : "http"}://${c}@127.0.0.1:${proxy.port}`,
          keepalive: true,
          tls: laxTls,
        });
        expect(res.status).toBe(200);
        await res.arrayBuffer();
      }
      // Different auth hashes must never share a tunnel; the repeat of the
      // first credentials must find the first tunnel in the pool.
      expect(proxy.connectCount()).toBe(2);
      // The two CONNECTs carried different Proxy-Authorization.
      const auths = proxy.connections.map(r => r.headers["proxy-authorization"]);
      expect(auths[0]).not.toBe(auths[1]);
    });
  }

  // A `tls` option that needs its own TLS context (`ca` here; cert/key etc.
  // behave the same) connects to an https proxy inside that context, and the
  // next request with the same option only searches that context's pool, so
  // the finished tunnel must be released into it. The client releases a
  // tunnel from two different places, and each response shape pins one down:
  //   - "content-length" (head + body in one record) and "204" (no body)
  //     are released while the response head is being parsed;
  //   - "chunked" only gets its body after fetch() resolved, i.e. after the
  //     head was parsed, so it is released from the body path.
  // The "default" context (rejectUnauthorized alone) is the control.
  type Shape = "content-length" | "204" | "chunked";
  const RESPONSES: Record<Shape, { status: number; body: string }> = {
    "content-length": { status: 200, body: "reused" },
    "204": { status: 204, body: "" },
    "chunked": { status: 200, body: "reused" },
  };

  // Raw HTTP/1.1 keep-alive origin: answers every request on the connection
  // it arrived on, so end-to-end tunnel reuse shows up as a single accepted
  // connection serving every request.
  async function keepAliveOrigin(shape: Shape) {
    const accepted = new Set<tls.TLSSocket>();
    let releaseBody: (() => void) | undefined;
    const server = tls.createServer(tlsCert, sock => {
      accepted.add(sock);
      sock.on("error", () => {});
      let buf = "";
      sock.on("data", chunk => {
        buf += chunk.toString("latin1");
        let end: number;
        while ((end = buf.indexOf("\r\n\r\n")) !== -1) {
          buf = buf.slice(end + 4);
          switch (shape) {
            case "content-length":
              sock.write("HTTP/1.1 200 OK\r\nContent-Length: 6\r\n\r\nreused");
              break;
            case "204":
              sock.write("HTTP/1.1 204 No Content\r\n\r\n");
              break;
            case "chunked":
              releaseBody = () => {
                releaseBody = undefined;
                sock.write("6\r\nreused\r\n0\r\n\r\n");
              };
              sock.write("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n");
              break;
          }
        }
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as net.AddressInfo).port;
    return {
      url: `https://localhost:${port}/`,
      get connections() {
        return accepted.size;
      },
      releaseBody() {
        releaseBody!();
      },
      [Symbol.asyncDispose]: async () => {
        for (const sock of accepted) sock.destroy();
        server.close();
      },
    };
  }

  for (const { proxyTls, context, shape } of cartesian({
    proxyTls: [false, true] as const,
    context: ["custom", "default"] as const,
    shape: ["content-length", "204", "chunked"] as const,
  })) {
    test.concurrent(
      `${proxyTls ? "https" : "http"}-proxy, ${context} TLS context, ${shape} responses: 3 requests share one tunnel`,
      async () => {
        await using origin = await keepAliveOrigin(shape);
        await using proxy = await createAdversarialProxy({ tls: proxyTls });
        const tlsOption = context === "custom" ? { ca: tlsCert.cert } : { rejectUnauthorized: false };

        const responses: Array<{ status: number; body: string }> = [];
        for (let i = 0; i < 3; i++) {
          const res = await fetch(origin.url, { proxy: proxy.url, keepalive: true, tls: tlsOption });
          if (shape === "chunked") origin.releaseBody();
          responses.push({ status: res.status, body: await res.text() });
        }

        expect(responses).toEqual([RESPONSES[shape], RESPONSES[shape], RESPONSES[shape]]);
        expect({ connects: proxy.connectCount(), originConnections: origin.connections }).toEqual({
          connects: 1,
          originConnections: 1,
        });
      },
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Many origins through one proxy. This churns the pool's target-key map.
// ─────────────────────────────────────────────────────────────────────────────

describe("many origins, one proxy", () => {
  for (const proxyTls of [false, true] as const) {
    test(`${proxyTls ? "https" : "http"}-proxy → 12 https origins, interleaved`, async () => {
      const N_ORIGINS = 12;
      const origins: Array<{ url: string; stop: () => void }> = [];
      for (let i = 0; i < N_ORIGINS; i++) {
        const body = `origin-${i}`;
        const s = Bun.serve({ port: 0, tls: tlsCert, fetch: () => new Response(body) });
        origins.push({ url: String(s.url), stop: () => s.stop(true) });
      }
      await using proxy = await createAdversarialProxy({ tls: proxyTls });

      try {
        // Two rounds so each origin is reused once.
        for (let round = 0; round < 2; round++) {
          for (let i = 0; i < N_ORIGINS; i++) {
            const res = await fetch(origins[i].url, { proxy: proxy.url, keepalive: true, tls: laxTls });
            expect(await res.text()).toBe(`origin-${i}`);
            expect(res.status).toBe(200);
          }
        }
        // Every request went through the proxy as a CONNECT (none
        // bypassed it), and round two reused every tunnel round one
        // pooled, for both proxy flavours.
        expect(proxy.connectCount()).toBe(N_ORIGINS);
      } finally {
        for (const o of origins) o.stop();
      }
    }, 45_000);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// reject_unauthorized stickiness: a tunnel established with
// rejectUnauthorized=false must not be reused by a later strict request.
// ─────────────────────────────────────────────────────────────────────────────

describe("reject_unauthorized pool gate", () => {
  for (const proxyTls of [false, true] as const) {
    test(`${proxyTls ? "https" : "http"}-proxy → https-origin: lax then strict opens a fresh CONNECT`, async () => {
      await using origin = Bun.serve({ port: 0, tls: tlsCert, fetch: () => new Response("g") });
      await using proxy = await createAdversarialProxy({ tls: proxyTls });

      // 1: lax
      let res = await fetch(origin.url, {
        proxy: proxy.url,
        keepalive: true,
        tls: { rejectUnauthorized: false },
      });
      expect(res.status).toBe(200);
      await res.arrayBuffer();
      expect(proxy.connectCount()).toBe(1);

      // 2: strict with matching CA — must not reuse the lax tunnel.
      res = await fetch(origin.url, {
        proxy: proxy.url,
        keepalive: true,
        tls: { ca: tlsCert.cert, rejectUnauthorized: true },
      });
      expect(res.status).toBe(200);
      await res.arrayBuffer();
      expect(proxy.connectCount()).toBe(2);

      // 3: strict again, reuses the strict tunnel. With an https proxy the
      // strict tunnel lives in the `ca` config's own TLS context; it must
      // have been pooled there, not in the default context.
      res = await fetch(origin.url, {
        proxy: proxy.url,
        keepalive: true,
        tls: { ca: tlsCert.cert, rejectUnauthorized: true },
      });
      expect(res.status).toBe(200);
      await res.arrayBuffer();
      expect(proxy.connectCount()).toBe(2);
    }, 30_000);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Large bidirectional body through the tunnel: upload and echo 4MB in one
// request, N times concurrently. Exercises the ProxyBody upload path and
// the streaming download path together under load.
// ─────────────────────────────────────────────────────────────────────────────

describe("large bidirectional", () => {
  const SIZE = 4 * 1024 * 1024;
  for (const proxyTls of [false, true] as const) {
    test.concurrent(
      `${proxyTls ? "https" : "http"}-proxy → https-origin, 4× concurrent ${SIZE}B echo`,
      async () => {
        await using origin = Bun.serve({
          port: 0,
          tls: tlsCert,
          fetch: async req => new Response(await req.arrayBuffer()),
        });
        await using proxy = await createAdversarialProxy({ tls: proxyTls });

        const payload = makeBody(SIZE, "L");
        const results = await Promise.all(
          Array.from({ length: 4 }, () =>
            fetch(origin.url, {
              method: "POST",
              body: payload,
              proxy: proxy.url,
              keepalive: false,
              tls: laxTls,
            }).then(async r => {
              const t = await r.text();
              return { status: r.status, len: t.length, ok: t === payload };
            }),
          ),
        );
        for (const r of results) {
          expect(r).toEqual({ status: 200, len: SIZE, ok: true });
        }
      },
      60_000,
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Pooled tunnel receives unsolicited data while idle: the proxy pushes a
// byte into the client after the first request fully completes and the
// tunnel has been parked. The client should evict the tunnel rather than
// letting the stale byte reach the next request.
// ─────────────────────────────────────────────────────────────────────────────

test("idle pooled tunnel receiving data is evicted", async () => {
  await using origin = Bun.serve({ port: 0, tls: tlsCert, fetch: () => new Response("ok") });

  // Custom proxy that exposes each live client socket so the test can
  // inject a stray byte AFTER the first request has been fully consumed
  // (i.e. once the tunnel is definitely parked in the pool).
  const liveClients = new Set<net.Socket>();
  let connects = 0;
  const server = net.createServer(client => {
    connects++;
    liveClients.add(client);
    client.on("close", () => liveClients.delete(client));
    client.on("error", () => {});
    let head = Buffer.alloc(0);
    let upstream: net.Socket | undefined;
    client.on("data", chunk => {
      if (upstream) {
        upstream.write(chunk);
        return;
      }
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf("\r\n\r\n");
      if (end === -1) return;
      const leftover = head.subarray(end + 4);
      upstream = net.connect(origin.port, "127.0.0.1", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (leftover.length) upstream!.write(leftover);
        upstream!.pipe(client, { end: false });
      });
      upstream.on("error", () => client.destroy());
      client.on("close", () => upstream?.destroy());
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const proxyPort = (server.address() as net.AddressInfo).port;

  try {
    // First request: pools the tunnel.
    let res = await fetch(origin.url, {
      proxy: `http://127.0.0.1:${proxyPort}`,
      keepalive: true,
      tls: laxTls,
    });
    expect(await res.text()).toBe("ok");
    expect(connects).toBe(1);

    // Tunnel is now parked. Push a stray byte into every live client
    // socket from the proxy side. The client's idle-data handler evicts
    // the pooled entry, which RSTs the proxy connection.
    const parked = [...liveClients];
    expect(parked.length).toBe(1);
    const closed = Promise.all(
      parked.map(
        c =>
          new Promise<void>(resolve => {
            if (c.destroyed) return resolve();
            c.once("close", () => resolve());
          }),
      ),
    );
    for (const c of parked) c.write(Buffer.from([0x17, 0x03, 0x03, 0x00, 0x01, 0x00]));
    await closed;

    // Second request: must open a fresh CONNECT and succeed.
    res = await fetch(origin.url, {
      proxy: `http://127.0.0.1:${proxyPort}`,
      keepalive: true,
      tls: laxTls,
    });
    expect(await res.text()).toBe("ok");
    expect(connects).toBe(2);
  } finally {
    for (const c of liveClients) c.destroy();
    server.close();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Subprocess-based memory / leak / UAF probe.
//
// Run a child that issues thousands of fetch/abort cycles through a proxy
// to an https origin across every stage of the tunnel, tracking RSS. The
// child exits non-zero on any crash (ASAN UAF, debug assert, segfault) and
// reports RSS growth ratio so the test can fail on leaks.
// ─────────────────────────────────────────────────────────────────────────────

describe("memory probe (subprocess)", () => {
  const MODES = [
    "complete", // let every request finish
    "abort-immediate", // abort on next microtask
    "abort-after-connect", // abort once the proxy sees the CONNECT
    "concurrent-32", // 32 in flight at once, all complete
    "concurrent-32-abort", // 32 in flight, abort half at random
    "redirect", // origin redirects once per request
  ] as const;

  for (const { proxyTls, mode } of cartesian({
    proxyTls: [false, true] as const,
    mode: MODES,
  })) {
    // ASAN inflates RSS and slows everything down; use fewer iterations
    // there but still enough to surface a UAF. Windows and macOS are capped
    // for a different reason: both use a 16,384-port ephemeral range
    // (49152-65535), and 12 concurrent subprocesses x 1200 iterations x 2
    // loopback connections each leave ~15k entries in TIME_WAIT (120s drain
    // on Windows, 30s on macOS). On Windows that poisons later tests in the
    // shard (listen(0)/connect() recycling into stale TIME_WAIT 4-tuples,
    // observed as ERR_POSTGRES_CONNECTION_REFUSED / WSAENOTCONN in
    // test/js/sql/postgres-binary-array-bounds.test.ts); on macOS the
    // https-proxy fixtures themselves see a single ConnectionRefused at
    // ~i=550 once TIME_WAIT passes ~15k.
    const iterations = isASAN || isWindows || isMacOS ? 300 : isCI ? 1200 : 600;

    test.concurrent(
      `${proxyTls ? "https" : "http"}-proxy → https-origin mode=${mode} ×${iterations}`,
      async () => {
        await using proc = Bun.spawn({
          cmd: [
            bunExe(),
            join(import.meta.dir, "proxy-stress-memory-fixture.ts"),
            proxyTls ? "https" : "http",
            mode,
            String(iterations),
          ],
          env: {
            ...bunEnv,
            ...proxyFreeEnv,
            // UAFs on the HTTP thread must abort the process rather
            // than race the main thread's clean exit.
            ASAN_OPTIONS: ((bunEnv as any).ASAN_OPTIONS ?? "") + ":abort_on_error=1:halt_on_error=1",
          },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        if (exitCode !== 0) console.error("fixture stderr:\n" + stderr);

        // Surface the child's final stats line before asserting.
        const lines = stdout.trim().split("\n");
        const lastLine = lines[lines.length - 1];
        let result: {
          completed: number;
          failed: number;
          firstError?: string;
          rssStart: number;
          rssEnd: number;
          rssMax: number;
        };
        try {
          result = JSON.parse(lastLine);
        } catch {
          console.error("fixture stdout:\n" + stdout);
          throw new Error("fixture did not emit a JSON summary line");
        }

        expect(exitCode).toBe(0);
        expect(result.completed + result.failed).toBe(iterations);
        // Non-abort modes must complete every request; abort modes must
        // have actually aborted something.
        if (mode.includes("abort")) {
          expect(result.failed).toBeGreaterThan(0);
        } else {
          // Carry `firstError` in the diff so a CI failure shows the
          // actual fetch error, not just the count.
          expect({ failed: result.failed, firstError: result.firstError }).toEqual({
            failed: 0,
            firstError: undefined,
          });
          expect(result.completed).toBe(iterations);
        }

        // RSS leak check: after a warm-up, RSS should plateau. Allow a
        // generous 3× growth factor (ASAN, fragmentation, per-target pool
        // entries) — a real leak of one tunnel/request shows as 10×+ with
        // these iteration counts. Skip the threshold under ASAN because
        // LeakSanitizer's shadow memory makes RSS non-representative; a
        // UAF there shows up as a crash, not a slow leak.
        if (!isASAN) {
          const growth = result.rssEnd / Math.max(1, result.rssStart);
          // Carry `mode` + the rounded ratio in the failing diff.
          expect({ mode, growth: Number(growth.toFixed(2)), withinBound: growth < 3.0 }).toEqual({
            mode,
            growth: expect.any(Number),
            withinBound: true,
          });
        }
      },
      120_000,
    );
  }
});
