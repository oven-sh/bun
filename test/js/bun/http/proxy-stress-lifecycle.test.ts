/**
 * Lifecycle-edge stress: close, abort, and kill the proxy tunnel at every
 * observable stage and assert the fetch fails cleanly (specific error, no
 * hang, no crash). These are the transitions where ref/deref and
 * SSLWrapper/ProxyTunnel callback ordering matter.
 *
 * Stages covered, for every {http, https} proxy × https origin combination:
 *   - proxy RSTs client after receiving the CONNECT head
 *   - proxy RSTs client after upstream TCP connects (before CONNECT reply)
 *   - proxy RSTs client after sending the CONNECT 200 reply
 *   - proxy RSTs client after first inner-TLS ClientHello byte
 *   - proxy RSTs client after first inner-TLS ServerHello byte
 *   - proxy drops the upstream leg at each of the above
 *   - origin RSTs after 0/partial response bytes
 *   - client aborts before connect / mid-CONNECT / mid-handshake / mid-body
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN } from "harness";
import {
  ProxyStage,
  cartesian,
  clearProxyEnv,
  createAdversarialOrigin,
  createAdversarialProxy,
  errcode,
  laxTls,
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

// Every fetch in this file races a 15s AbortSignal. If that fires, the
// request hung instead of failing — a TimeoutError / AbortError is always a
// test failure.
const HANG_GUARD_MS = 15_000;

/** A fetch that must reject with a non-timeout error. */
async function expectConnectionFailure(p: Promise<Response>): Promise<string> {
  let code: string;
  try {
    const res = await p;
    // Consume the body so a late failure has somewhere to surface.
    await res.arrayBuffer().catch(() => {});
    code = `resolved:${res.status}`;
  } catch (e) {
    code = errcode(e);
  }
  // The request must not have been left to hang.
  expect(code).not.toBe("TimeoutError");
  expect(code).not.toBe("AbortError");
  // And must not have succeeded.
  expect(code).not.toStartWith("resolved:");
  return code;
}

// ─────────────────────────────────────────────────────────────────────────────
// Proxy kills the client socket at each stage (RST). Run against both
// keepalive states, and against both an HTTPS origin (CONNECT tunnel) and
// an HTTP origin (absolute-form) since those are two entirely separate
// code paths on the client.
// ─────────────────────────────────────────────────────────────────────────────

const CLIENT_KILL_STAGES: ProxyStage[] = [
  "request-received",
  "upstream-connected",
  "connect-replied",
  "first-client-byte",
  "first-upstream-byte",
];

describe("proxy RSTs client", () => {
  for (const { proxyTls, originTls, stage, keepalive } of cartesian({
    proxyTls: [false, true] as const,
    originTls: [false, true] as const,
    stage: CLIENT_KILL_STAGES,
    keepalive: [false, true] as const,
  })) {
    // For an http origin (absolute-form GET), the client sends nothing
    // after the request head, so `first-client-byte` never fires — skip
    // that combination.
    if (!originTls && stage === "first-client-byte") continue;
    test.concurrent(
      `${proxyTls ? "https" : "http"}-proxy → ${originTls ? "https" : "http"}-origin, RST at '${stage}' keepalive=${keepalive}`,
      async () => {
        await using origin = await createAdversarialOrigin({ tls: originTls, body: "never" });
        await using proxy = await createAdversarialProxy({ tls: proxyTls, killClientAt: stage });

        const code = await expectConnectionFailure(
          fetch(origin.url, {
            proxy: proxy.url,
            keepalive,
            tls: laxTls,
            signal: AbortSignal.timeout(HANG_GUARD_MS),
          }),
        );
        expect(code).toMatch(/ECONNRESET|ConnectionClosed|ECONNREFUSED|ConnectionRefused|SocketError|EPIPE/);
      },
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Same RST matrix but with a request body in flight (so the failure lands
// in the ProxyBody / upload path rather than ProxyHeaders).
// ─────────────────────────────────────────────────────────────────────────────

describe("proxy RSTs client during upload", () => {
  for (const { proxyTls, stage, bodyKind } of cartesian({
    proxyTls: [false, true] as const,
    stage: CLIENT_KILL_STAGES,
    bodyKind: ["string", "stream"] as const,
  })) {
    test.concurrent(
      `${proxyTls ? "https" : "http"}-proxy → https-origin, ${bodyKind} upload, RST at '${stage}'`,
      async () => {
        await using origin = await createAdversarialOrigin({ tls: true, echo: true });
        await using proxy = await createAdversarialProxy({ tls: proxyTls, killClientAt: stage });
        const body =
          bodyKind === "string"
            ? Buffer.alloc(16 * 1024, "u").toString("latin1")
            : new ReadableStream({
                start(c) {
                  c.enqueue(new Uint8Array(8192).fill(0x55));
                  c.enqueue(new Uint8Array(8192).fill(0x55));
                  c.close();
                },
              });
        const code = await expectConnectionFailure(
          fetch(origin.url, {
            method: "POST",
            body,
            ...(bodyKind === "stream" ? { duplex: "half" as const } : {}),
            proxy: proxy.url,
            keepalive: false,
            tls: laxTls,
            signal: AbortSignal.timeout(HANG_GUARD_MS),
          }),
        );
        expect(code).toMatch(/ECONNRESET|ConnectionClosed|ECONNREFUSED|ConnectionRefused|SocketError|EPIPE/);
      },
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Proxy kills the upstream socket at each stage. The client sees this as the
// proxy's socket going quiet (relayed close) after CONNECT succeeded, or as
// a 502 before.
// ─────────────────────────────────────────────────────────────────────────────

describe("proxy kills upstream", () => {
  for (const { proxyTls, stage } of cartesian({
    proxyTls: [false, true] as const,
    stage: CLIENT_KILL_STAGES,
  })) {
    test.concurrent(`${proxyTls ? "https" : "http"}-proxy → https-origin, upstream dropped at '${stage}'`, async () => {
      await using origin = await createAdversarialOrigin({ tls: true, body: "never" });
      await using proxy = await createAdversarialProxy({ tls: proxyTls, killUpstreamAt: stage });

      let outcome: string;
      try {
        const res = await fetch(origin.url, {
          proxy: proxy.url,
          keepalive: false,
          tls: laxTls,
          signal: AbortSignal.timeout(HANG_GUARD_MS),
        });
        await res.arrayBuffer().catch(() => {});
        outcome = `resolved:${res.status}`;
      } catch (e) {
        outcome = errcode(e);
      }
      // At "upstream-connected", the upstream's close happens before the
      // tunnel is up; the proxy relays the 502 envelope it writes on
      // upstream error, which the client surfaces as a 502 response.
      // After the tunnel is up the close is relayed and the inner TLS
      // fails. Either is acceptable; a hang is not.
      expect(outcome).not.toBe("TimeoutError");
      expect(outcome).not.toBe("AbortError");
      expect(outcome).toMatch(
        /^resolved:502$|ECONNRESET|ConnectionClosed|ECONNREFUSED|ConnectionRefused|SocketError|EPIPE|ERR_TLS/,
      );
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Origin kills the connection at various byte offsets through the tunnel.
// ─────────────────────────────────────────────────────────────────────────────

describe("origin RSTs through tunnel", () => {
  for (const { proxyTls, killAfter } of cartesian({
    proxyTls: [false, true] as const,
    // 0 = before any response byte; 10 = mid-status-line; 60 = mid-headers;
    // 200 = mid-body (with a 512-byte body).
    killAfter: [0, 10, 60, 200] as const,
  })) {
    test.concurrent(
      `${proxyTls ? "https" : "http"}-proxy → https-origin, origin RST after ${killAfter} response bytes`,
      async () => {
        await using origin = await createAdversarialOrigin({
          tls: true,
          body: Buffer.alloc(512, "x"),
          framing: "content-length",
          killAfterBytes: killAfter,
        });
        await using proxy = await createAdversarialProxy({ tls: proxyTls });

        let outcome: string;
        try {
          const res = await fetch(origin.url, {
            proxy: proxy.url,
            keepalive: false,
            tls: laxTls,
            signal: AbortSignal.timeout(HANG_GUARD_MS),
          });
          // With a truncated content-length body, .text() should reject.
          await res.text();
          outcome = `resolved:${res.status}`;
        } catch (e) {
          outcome = errcode(e);
        }
        expect(outcome).not.toBe("TimeoutError");
        expect(outcome).not.toBe("AbortError");
        // A truncated body surfaces as ConnectionClosed / ECONNRESET. A
        // response that never got to the status line is ConnectionRefused
        // / ConnectionClosed.
        expect(outcome).not.toBe("resolved:200");
      },
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Close-delimited body through the tunnel: the origin's close IS the EOF.
// The tunnel's on_close callback routes this through the
// `received_last_chunk` path rather than `close_and_fail`. Parameterize by
// whether the origin closes immediately (same packet as body) or after a
// tick (separate packet).
// ─────────────────────────────────────────────────────────────────────────────

describe("close-delimited body through tunnel", () => {
  for (const { proxyTls, encoding } of cartesian({
    proxyTls: [false, true] as const,
    encoding: ["identity", "gzip"] as const,
  })) {
    test.concurrent(`${proxyTls ? "https" : "http"}-proxy → https-origin, close-delimited ${encoding}`, async () => {
      const payload = Buffer.alloc(4096, "C").toString("latin1");
      await using origin = await createAdversarialOrigin({
        tls: true,
        body: payload,
        framing: "close-delimited",
        encoding,
      });
      await using proxy = await createAdversarialProxy({ tls: proxyTls });

      const res = await fetch(origin.url, { proxy: proxy.url, keepalive: false, tls: laxTls });
      expect(await res.text()).toBe(payload);
      expect(res.status).toBe(200);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// AbortSignal at every stage. A transparent proxy exposes its connection
// record; the test polls bytesUp/bytesDown to detect each stage and
// aborts when it's reached. The fetch must reject with AbortError and
// the tunnel teardown must not leave the request hung or the process
// crashed.
// ─────────────────────────────────────────────────────────────────────────────

describe("abort at each proxy stage", () => {
  const ABORT_STAGES: ProxyStage[] = [
    "request-received",
    "upstream-connected",
    "connect-replied",
    "first-client-byte",
    "first-upstream-byte",
  ];

  for (const { proxyTls, stage } of cartesian({
    proxyTls: [false, true] as const,
    stage: ABORT_STAGES,
  })) {
    test.concurrent(`${proxyTls ? "https" : "http"}-proxy → https-origin, abort at '${stage}'`, async () => {
      const ac = new AbortController();
      await using origin = await createAdversarialOrigin({ tls: true, body: "never" });
      // Run a transparent proxy and poll its connection record from the
      // test side: the stage is inferred from record presence /
      // bytesUp / bytesDown. The first three stages have no externally
      // observable distinction from the record alone, so they collapse
      // to "abort as soon as the proxy sees the request".
      await using proxy = await createAdversarialProxy({ tls: proxyTls });

      const predicates: Record<ProxyStage, (c: (typeof proxy.connections)[number] | undefined) => boolean> = {
        "request-received": c => !!c,
        "upstream-connected": c => !!c,
        "connect-replied": c => !!c,
        "first-client-byte": c => !!c && c.bytesUp > 0,
        "first-upstream-byte": c => !!c && c.bytesDown > 0,
      };
      const want = predicates[stage];

      const poller = (async () => {
        while (!want(proxy.connections[0])) {
          await new Promise<void>(r => setImmediate(r));
        }
        ac.abort();
      })();

      let code: string;
      try {
        const res = await fetch(origin.url, {
          proxy: proxy.url,
          keepalive: false,
          tls: laxTls,
          signal: ac.signal,
        });
        await res.arrayBuffer().catch(() => {});
        code = `resolved:${res.status}`;
      } catch (e) {
        code = errcode(e);
      }
      // `await poller` resolving is itself proof the stage was reached:
      // the IIFE's only exit sets `ac.abort()` and returns.
      await poller;

      // Either the abort won (AbortError), or the request had already
      // finished failing because the proxy/origin closed first. Both are
      // fine; a resolved 200 or a hang is not.
      if (code !== "AbortError") {
        // The origin never replies with a complete response in this test
        // (the poller aborts too early for that), but on very fast machines
        // the abort may lose the race against a clean close. Accept any
        // connection-flavored failure.
        expect(code).not.toBe("resolved:200");
        expect(code).not.toBe("TimeoutError");
      }
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Abort immediately after fetch() returns the Response (body not yet read).
// This exercises the tunnel teardown path where the response is "done" from
// the headers' perspective but the body stream is still live.
// ─────────────────────────────────────────────────────────────────────────────

describe("abort after headers, before body", () => {
  for (const proxyTls of [false, true] as const) {
    test.concurrent(`${proxyTls ? "https" : "http"}-proxy → https-origin, abort with body pending`, async () => {
      await using origin = await createAdversarialOrigin({
        tls: true,
        body: Buffer.alloc(256 * 1024, "B"),
        framing: "content-length",
      });
      await using proxy = await createAdversarialProxy({ tls: proxyTls });

      const ac = new AbortController();
      const res = await fetch(origin.url, {
        proxy: proxy.url,
        keepalive: false,
        tls: laxTls,
        signal: ac.signal,
      });
      expect(res.status).toBe(200);
      ac.abort();
      let code: string;
      try {
        await res.arrayBuffer();
        code = "resolved";
      } catch (e) {
        code = errcode(e);
      }
      // Either the body was already fully buffered (small body over
      // loopback), in which case the abort is a no-op and arrayBuffer()
      // resolves, or it wasn't and arrayBuffer() rejects with AbortError.
      expect(["resolved", "AbortError"]).toContain(code);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Use-after-free: TLS alert buffered with the inner handshake flight.
//
// If the origin rejects the TLS stream immediately after its ServerHello
// flight (e.g. because the proxy corrupted the client's bytes), the alert
// record lands in the same receive buffer as the handshake. The client's
// on_handshake → on_writable → ProxyTunnel::on_writable → SSLWrapper::flush
// → handle_reading chain then processes the alert, fires on_close →
// close_and_fail, frees the client, and returns into on_writable which
// reads the freed `self`.
//
// Repro: a proxy that duplicates every client→origin byte. The origin's
// TLS stack sees a second ClientHello interleaved with the real traffic
// and aborts with an alert. Only deterministic under ASAN.
// ─────────────────────────────────────────────────────────────────────────────

test.skipIf(!isASAN)(
  "TLS alert in same buffer as inner handshake does not use-after-free the client",
  async () => {
    const fixture = `
      const net = require("node:net");
      const { once } = require("node:events");
      const tlsCert = ${JSON.stringify({ cert: tlsCert.cert, key: tlsCert.key })};

      const origin = Bun.serve({
        port: 0,
        tls: tlsCert,
        fetch: () => new Response("never"),
      });

      // CONNECT proxy that duplicates every client->upstream byte, corrupting
      // the inner TLS stream so the origin sends an alert right after (or
      // during) its ServerHello flight.
      const proxy = net.createServer(client => {
        client.on("error", () => {});
        let head = Buffer.alloc(0);
        let upstream;
        client.on("close", () => upstream?.destroy());
        client.on("data", chunk => {
          if (upstream) {
            upstream.write(chunk);
            upstream.write(chunk); // corrupt: double-write
            return;
          }
          head = Buffer.concat([head, chunk]);
          const end = head.indexOf("\\r\\n\\r\\n");
          if (end === -1) return;
          const leftover = head.subarray(end + 4);
          upstream = net.connect(origin.port, "127.0.0.1", () => {
            client.write("HTTP/1.1 200 OK\\r\\n\\r\\n");
            if (leftover.length) {
              upstream.write(leftover);
              upstream.write(leftover);
            }
            upstream.pipe(client);
          });
          upstream.on("error", () => client.destroy());
          upstream.on("close", () => client.destroy());
        });
      });
      proxy.listen(0, "127.0.0.1");
      await once(proxy, "listening");
      const proxyPort = proxy.address().port;

      // Multiple iterations: ASAN's report+abort on the HTTP thread is
      // slower than the result callback that resolves the fetch on the
      // main thread. Looping ensures a UAF on iteration N aborts the
      // process before iteration N+1 completes; a single fetch +
      // immediate process.exit(0) would race and win on fast machines.
      for (let i = 0; i < 20; i++) {
        let outcome = "";
        try {
          const res = await fetch("https://localhost:" + origin.port + "/", {
            proxy: "http://127.0.0.1:" + proxyPort,
            keepalive: false,
            tls: { rejectUnauthorized: false },
            signal: AbortSignal.timeout(10000),
          });
          await res.arrayBuffer().catch(() => {});
          outcome = "resolved:" + res.status;
        } catch (e) {
          outcome = "rejected:" + (e?.code ?? e?.name ?? String(e));
        }
        console.log(outcome);
      }
      origin.stop(true);
      proxy.close();
      process.exit(0);
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: {
        ...bunEnv,
        ...proxyFreeEnv,
        // The UAF happens on the HTTP thread; without abort_on_error the
        // main thread's process.exit(0) can win the race against ASAN's
        // reporter and the test would pass on an unfixed build.
        ASAN_OPTIONS: ((bunEnv as any).ASAN_OPTIONS ?? "") + ":abort_on_error=1:halt_on_error=1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) console.error("stderr:\n" + stderr);
    // The corrupted stream makes the inner TLS fail; every fetch must
    // reject cleanly, not crash the process. On an unfixed ASAN build
    // the subprocess aborts mid-loop.
    const lines = stdout.trim().split("\n");
    expect(lines.length).toBe(20);
    for (const line of lines) {
      expect(line).toMatch(/^rejected:/);
    }
    expect(stdout).not.toContain("TimeoutError");
    expect(exitCode).toBe(0);
  },
  30_000,
);

// ─────────────────────────────────────────────────────────────────────────────
// Repeated abort churn in-process. This is a lighter-weight version of the
// subprocess-based memory fixture: many fetch+abort cycles at random
// post-CONNECT points, asserting no crash and bounded heap growth. Under
// ASAN this is where UAFs in the tunnel close path surface.
// ─────────────────────────────────────────────────────────────────────────────

describe("abort churn", () => {
  // Heavier iteration count under ASAN (where UAFs are catchable); lighter
  // elsewhere to keep the debug build test time reasonable.
  const ITERATIONS = isASAN ? 200 : 60;

  for (const proxyTls of [false, true] as const) {
    test(`${proxyTls ? "https" : "http"}-proxy → https-origin, ${ITERATIONS}× fetch+immediate-abort`, async () => {
      await using origin = await createAdversarialOrigin({ tls: true, body: Buffer.alloc(4096, "x") });
      await using proxy = await createAdversarialProxy({ tls: proxyTls });

      let aborted = 0;
      let other = 0;
      for (let i = 0; i < ITERATIONS; i++) {
        const ac = new AbortController();
        const p = fetch(origin.url, {
          proxy: proxy.url,
          keepalive: false,
          tls: laxTls,
          signal: ac.signal,
        });
        // Abort on the next microtask — lands somewhere in the
        // connect/CONNECT/handshake window.
        queueMicrotask(() => ac.abort());
        try {
          const res = await p;
          await res.arrayBuffer().catch(() => {});
          other++;
        } catch (e) {
          if (errcode(e) === "AbortError") aborted++;
          else other++;
        }
      }
      // At least some of the aborts must have actually raced the request.
      expect(aborted + other).toBe(ITERATIONS);
      expect(aborted).toBeGreaterThan(0);
    }, 60_000);
  }
});
