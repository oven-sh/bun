/**
 * Concurrency, connection-pool, and memory stress for the proxy tunnel.
 *
 * The tunnel pool (HTTPContext::PooledSocket) keys on (proxy addr, target
 * host:port, proxy_auth_hash, established_with_reject_unauthorized), and
 * there is one pool per TLS context: the default one plus one per `tls`
 * option that needs its own context (ca / cert / key ...). These tests churn
 * those pools: a subprocess leak probe per (proxy flavour, mode) cell, many
 * parallel requests to one target, many targets through one proxy, reuse out
 * of both kinds of context, and interleaved aborts.
 *
 * Every test builds its own proxy and origin, so every test is
 * `test.concurrent`; the file-level hooks only clear the ambient proxy
 * environment once. The proxy records one entry per accepted connection, and
 * the number of connections a scenario opens is the property under test here,
 * so the tests assert the exact connection list rather than a count.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN } from "harness";
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
// Subprocess leak / UAF probe: one child per (proxy flavour, mode) cell, each
// running ITERATIONS fetch (and abort) cycles through a CONNECT proxy to an
// https origin. proxy-stress-memory-fixture.ts documents the summary line it
// prints. A bug shows up as:
//   - a crash (UAF under ASAN, debug assert, segfault): stderr + exit code;
//   - an object that is never freed: on the ASAN lanes the runner turns
//     LeakSanitizer on for this file, and the child inherits that, so the
//     report lands in stderr and the child exits non-zero after the very
//     first leaked object;
//   - a tunnel that is never released, reachable or not: each tunnel owns one
//     SSL_CTX, so `sslCtxGrowth` comes back as one per request made after the
//     warm-up (200 and more per cell) in every build;
//   - anything else that grows per request: `rssGrowth`, release builds only.
// None of these get more sensitive with more iterations; the abort modes only
// get more samples of their race. 300 is the count the ASAN lanes (the ones
// that would catch a UAF) have always run, and the most macOS and Windows can
// take: they have 16k ephemeral ports, and every request leaves 2 loopback
// connections in TIME_WAIT across 12 concurrent children (#33898, #33941).
// The count is part of the expected outcomes below, so it is the same
// everywhere.
//
// This block comes first in the file on purpose: under ASAN `bun test` runs
// at most 5 tests at a time and these children are the long pole, so they
// take the slots first and the in-process tests below fill in as they exit.
// The slowest modes are listed first for the same reason.
// ─────────────────────────────────────────────────────────────────────────────

describe("memory probe (subprocess)", () => {
  const ITERATIONS = 300;
  const HALF = ITERATIONS / 2;

  type Outcome = { completed: number; failed: number; errors: Record<string, number> };
  const allComplete: Outcome = { completed: ITERATIONS, failed: 0, errors: {} };
  const allAborted: Outcome = { completed: 0, failed: ITERATIONS, errors: { AbortError: ITERATIONS } };

  // `connects` is the number of CONNECT requests the child's proxy saw. A
  // request aborted on the microtask after fetch() races the HTTP thread to
  // the proxy, so for those two modes only the bounds are fixed (observed:
  // anywhere from none to 98% of the aborted requests reach the proxy,
  // depending on the build and on whether the proxy itself is TLS).
  const EXPECTED: Record<string, { outcome: Outcome; connects: number | [min: number, max: number] }> = {
    // Origin redirects once per request; keepalive is off, so each hop is its own tunnel.
    "redirect": { outcome: allComplete, connects: 2 * ITERATIONS },
    "complete": { outcome: allComplete, connects: ITERATIONS },
    "concurrent-32": { outcome: allComplete, connects: ITERATIONS },
    // 32 in flight, the odd-numbered half aborted on the next microtask.
    "concurrent-32-abort": {
      outcome: { completed: HALF, failed: HALF, errors: { AbortError: HALF } },
      connects: [HALF, ITERATIONS],
    },
    // Aborted once the proxy has read the CONNECT head: exactly one CONNECT each.
    "abort-after-connect": { outcome: allAborted, connects: ITERATIONS },
    "abort-immediate": { outcome: allAborted, connects: [0, ITERATIONS] },
  };

  for (const { mode, proxyTls } of cartesian({
    mode: Object.keys(EXPECTED),
    proxyTls: [true, false] as const,
  })) {
    test.concurrent(
      `${proxyTls ? "https" : "http"}-proxy → https-origin mode=${mode} ×${ITERATIONS}`,
      async () => {
        await using proc = Bun.spawn({
          cmd: [
            bunExe(),
            join(import.meta.dir, "proxy-stress-memory-fixture.ts"),
            proxyTls ? "https" : "http",
            mode,
            String(ITERATIONS),
          ],
          env: {
            ...bunEnv,
            ...proxyFreeEnv,
            TLS_CERT: tlsCert.cert,
            TLS_KEY: tlsCert.key,
            // UAFs on the HTTP thread must abort the process rather
            // than race the main thread's clean exit.
            ASAN_OPTIONS: (bunEnv.ASAN_OPTIONS ?? "") + ":abort_on_error=1:halt_on_error=1",
          },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

        // Anything on stderr is a crash, a sanitizer report, or a fixture
        // error; asserting it first puts the actual report in the failure.
        expect(stderr).toBe("");
        const { connects, sslCtxGrowth, sslCtxInFlight, rssGrowth, ...outcome } = JSON.parse(stdout);

        const want = EXPECTED[mode];
        expect(outcome).toEqual(want.outcome);
        if (typeof want.connects === "number") {
          expect(connects).toBe(want.connects);
        } else {
          expect(connects).toBeWithin(want.connects[0], want.connects[1] + 1);
        }

        // Steady state is 0 (the fixture waits for the last tunnel's context
        // to be freed). A tunnel that is never released adds one per request
        // made after the warm-up: 200 and more per cell, twice that in
        // redirect mode. `sslCtxInFlight` is the proof that this detector
        // works: while tunnels were in flight the live count stood above the
        // idle count by the number of tunnels (1 in the sequential modes, up
        // to 32 in concurrent-32). If tunnels ever stop owning a context,
        // this fails instead of the growth check going silent.
        expect(sslCtxGrowth).toBeLessThanOrEqual(2);
        if (want.outcome.completed > 0) expect(sslCtxInFlight).toBeGreaterThanOrEqual(1);

        // RSS growth over the 200-odd requests after the warm-up. On a
        // release build every cell measures 0 to 9 MB of allocator and JIT
        // creep; 32 MB trips on anything from about 150 KB per request up,
        // such as a response or TLS buffer kept per request. Per-request
        // leaks of a few KB are what LeakSanitizer and `sslCtxGrowth` are
        // for. Under ASAN freed memory sits in the quarantine, so RSS says
        // nothing there.
        if (!isASAN) expect(rssGrowth).toBeLessThan(32 * 1024 * 1024);

        expect(exitCode).toBe(0);
      },
      120_000,
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Parallel requests to one origin through one proxy. All N are dispatched
// before the proxy (which runs on this thread) can relay anything, and N is
// below the client's in-flight cap (256, BUN_CONFIG_MAX_HTTP_REQUESTS), so
// none of them can reuse a pooled connection: the proxy must see exactly N
// connections, whatever the keepalive setting.
// ─────────────────────────────────────────────────────────────────────────────

describe("parallel requests, single origin", () => {
  const N = 32;
  for (const { proxyTls, originTls, keepalive } of cartesian({
    proxyTls: [false, true] as const,
    originTls: [false, true] as const,
    keepalive: [false, true] as const,
  })) {
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

        // Every request got its own response body back: no cross-talk.
        expect(results).toEqual(Array.from({ length: N }, (_, i) => ({ status: 200, body: String(i) })));
        // All N went through the proxy: CONNECT tunnels to an https origin,
        // absolute-form requests to an http one.
        expect(proxy.connections.map(c => c.method)).toEqual(Array(N).fill(originTls ? "CONNECT" : "GET"));
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
    test.concurrent(
      `${proxyTls ? "https" : "http"}-proxy → https-origin, 5 sequential requests reuse one CONNECT`,
      async () => {
        await using origin = Bun.serve({
          port: 0,
          tls: tlsCert,
          fetch: () => new Response("reused"),
        });
        await using proxy = await createAdversarialProxy({ tls: proxyTls });

        const responses: Array<{ status: number; body: string }> = [];
        for (let i = 0; i < 5; i++) {
          const res = await fetch(origin.url, { proxy: proxy.url, keepalive: true, tls: laxTls });
          responses.push({ status: res.status, body: await res.text() });
        }
        expect(responses).toEqual(Array(5).fill({ status: 200, body: "reused" }));
        // laxTls carries a `ca`, so the connection to the proxy lives in that
        // config's own TLS context. The finished tunnel must be pooled into
        // that same context (where the next request looks for it), so a
        // single CONNECT serves all five requests for both proxy flavours.
        expect(proxy.connections.map(c => c.method)).toEqual(["CONNECT"]);
      },
    );

    test.concurrent(
      `${proxyTls ? "https" : "http"}-proxy → https-origin, different auth hashes use separate tunnels`,
      async () => {
        await using origin = Bun.serve({ port: 0, tls: tlsCert, fetch: () => new Response("ok") });
        await using proxy = await createAdversarialProxy({ tls: proxyTls });

        const creds = ["a:1", "b:2", "a:1"]; // third reuses the first tunnel
        const statuses: number[] = [];
        for (const c of creds) {
          const res = await fetch(origin.url, {
            proxy: `${proxyTls ? "https" : "http"}://${c}@127.0.0.1:${proxy.port}`,
            keepalive: true,
            tls: laxTls,
          });
          statuses.push(res.status);
          await res.arrayBuffer();
        }
        expect(statuses).toEqual([200, 200, 200]);
        // One CONNECT per distinct credential, each carrying its own
        // Proxy-Authorization; the repeat of the first credentials found the
        // first tunnel in the pool instead of opening a third.
        expect(proxy.connections.map(c => [c.method, c.headers["proxy-authorization"]])).toEqual([
          ["CONNECT", `Basic ${btoa("a:1")}`],
          ["CONNECT", `Basic ${btoa("b:2")}`],
        ]);
      },
    );
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
        expect({ connects: proxy.connections.map(c => c.method), originConnections: origin.connections }).toEqual({
          connects: ["CONNECT"],
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
  const N_ORIGINS = 12;
  for (const proxyTls of [false, true] as const) {
    test.concurrent(
      `${proxyTls ? "https" : "http"}-proxy → ${N_ORIGINS} https origins, interleaved`,
      async () => {
        const origins = Array.from({ length: N_ORIGINS }, (_, i) =>
          Bun.serve({ port: 0, tls: tlsCert, fetch: () => new Response(`origin-${i}`) }),
        );
        await using proxy = await createAdversarialProxy({ tls: proxyTls });

        try {
          // Two rounds so each origin is reused once.
          const responses: Array<{ status: number; body: string }> = [];
          for (let round = 0; round < 2; round++) {
            for (const origin of origins) {
              const res = await fetch(origin.url, { proxy: proxy.url, keepalive: true, tls: laxTls });
              responses.push({ status: res.status, body: await res.text() });
            }
          }
          const round = origins.map((_, i) => ({ status: 200, body: `origin-${i}` }));
          expect(responses).toEqual([...round, ...round]);
          // Round one opened one CONNECT per origin, in order, and round two
          // found every one of those tunnels in the pool: nothing bypassed
          // the proxy and nothing was dialed twice, for both proxy flavours.
          expect(proxy.connections.map(c => [c.method, c.target])).toEqual(
            origins.map(origin => ["CONNECT", origin.url.host]),
          );
        } finally {
          for (const origin of origins) origin.stop(true);
        }
      },
      45_000,
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// reject_unauthorized stickiness: a tunnel established with
// rejectUnauthorized=false must not be reused by a later strict request.
// ─────────────────────────────────────────────────────────────────────────────

describe("reject_unauthorized pool gate", () => {
  for (const proxyTls of [false, true] as const) {
    test.concurrent(
      `${proxyTls ? "https" : "http"}-proxy → https-origin: lax then strict opens a fresh CONNECT`,
      async () => {
        await using origin = Bun.serve({ port: 0, tls: tlsCert, fetch: () => new Response("g") });
        await using proxy = await createAdversarialProxy({ tls: proxyTls });

        const lax = { rejectUnauthorized: false };
        const strict = { ca: tlsCert.cert, rejectUnauthorized: true };
        const steps: Array<{ status: number; connects: number }> = [];
        for (const tlsOption of [lax, strict, strict]) {
          const res = await fetch(origin.url, { proxy: proxy.url, keepalive: true, tls: tlsOption });
          await res.arrayBuffer();
          steps.push({ status: res.status, connects: proxy.connectCount() });
        }
        // 1: lax pools a tunnel. 2: strict must not reuse it and opens its
        // own. 3: strict again reuses the strict tunnel. With an https proxy
        // the strict tunnel lives in the `ca` config's own TLS context; it
        // must have been pooled there, not in the default context.
        expect(steps).toEqual([
          { status: 200, connects: 1 },
          { status: 200, connects: 2 },
          { status: 200, connects: 2 },
        ]);
      },
      30_000,
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Large bidirectional body through the tunnel: upload and echo 4MB in one
// request, N times concurrently. Exercises the ProxyBody upload path and
// the streaming download path together under load.
// ─────────────────────────────────────────────────────────────────────────────

describe("large bidirectional", () => {
  const SIZE = 4 * 1024 * 1024;
  const N = 4;
  for (const proxyTls of [false, true] as const) {
    test.concurrent(
      `${proxyTls ? "https" : "http"}-proxy → https-origin, ${N}× concurrent ${SIZE}B echo`,
      async () => {
        await using origin = Bun.serve({
          port: 0,
          tls: tlsCert,
          fetch: async req => new Response(await req.arrayBuffer()),
        });
        await using proxy = await createAdversarialProxy({ tls: proxyTls });

        const payload = makeBody(SIZE, "L");
        const results = await Promise.all(
          Array.from({ length: N }, () =>
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
        expect(results).toEqual(Array(N).fill({ status: 200, len: SIZE, ok: true }));
        // One tunnel per request, each of which relayed the whole payload
        // in both directions (plus TLS framing).
        expect(
          proxy.connections.map(c => ({ method: c.method, relayedBothWays: c.bytesUp > SIZE && c.bytesDown > SIZE })),
        ).toEqual(Array(N).fill({ method: "CONNECT", relayedBothWays: true }));
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

test.concurrent("idle pooled tunnel receiving data is evicted", async () => {
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
  const proxy = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;

  try {
    // First request: pools the tunnel.
    let res = await fetch(origin.url, { proxy, keepalive: true, tls: laxTls });
    expect({ body: await res.text(), connects }).toEqual({ body: "ok", connects: 1 });

    // Tunnel is now parked. Push a stray byte into the one live client
    // socket from the proxy side. The client's idle-data handler evicts
    // the pooled entry, which RSTs the proxy connection (so the socket may
    // emit "error" before "close"; only "close" is awaited).
    expect(liveClients.size).toBe(1);
    const [parked] = liveClients;
    const closed = new Promise<void>(resolve => parked.once("close", () => resolve()));
    parked.write(Buffer.from([0x17, 0x03, 0x03, 0x00, 0x01, 0x00]));
    await closed;

    // Second request: must open a fresh CONNECT and succeed.
    res = await fetch(origin.url, { proxy, keepalive: true, tls: laxTls });
    expect({ body: await res.text(), connects }).toEqual({ body: "ok", connects: 2 });
  } finally {
    for (const c of liveClients) c.destroy();
    server.close();
  }
});
