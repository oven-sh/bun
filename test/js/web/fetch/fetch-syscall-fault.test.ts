import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { afterEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tls as certs, isWindows } from "harness";

const skip = !fault.available() || isWindows;

afterEach(() => fault.clear());

// fetch() is the client; the server runs in the parent test process and the
// fetch (with the fault armed) runs in a subprocess so faults only affect the
// client side of the connection.

async function runClientFetch(
  url: string,
  rule: import("bun:internal-for-testing").SocketFaultRule | null,
  opts: { ca?: string; readBytes?: number; abort?: boolean } = {},
) {
  const fixture = /* js */ `
    const { socketFaultInjection: fault } = require("bun:internal-for-testing");
    const rule = ${JSON.stringify(rule)};
    if (rule) fault.set(rule);
    try {
      const res = await fetch(${JSON.stringify(url)}, {
        ${opts.ca ? `tls: { ca: process.env.CA },` : ""}
      });
      ${
        opts.abort
          ? `
        const reader = res.body.getReader();
        let n = 0;
        while (n < ${opts.readBytes ?? 1024}) {
          const { value, done } = await reader.read();
          if (done) break;
          n += value.length;
        }
        await reader.cancel();
        console.log(JSON.stringify({ ok: true, status: res.status, n }));
      `
          : `
        const buf = await res.arrayBuffer();
        console.log(JSON.stringify({ ok: true, status: res.status, length: buf.byteLength }));
      `
      }
    } catch (e) {
      console.log(JSON.stringify({ ok: false, code: e?.code, name: e?.name, message: String(e?.message ?? e) }));
    } finally {
      fault.clear();
    }
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: "1", ...(opts.ca ? { CA: opts.ca } : {}) },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { ...JSON.parse(stdout.trim() || "{}"), stderr, exitCode, signal: proc.signalCode };
}

describe.skipIf(skip)("fetch() under injected syscall faults (http)", () => {
  test("recv → ECONNRESET on response rejects with a connection error", async () => {
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => new Response(Buffer.alloc(8192, "a")),
    });
    const r = await runClientFetch(server.url.href, {
      syscall: "recv",
      action: "errno",
      errno: "ECONNRESET",
      repeat: -1,
    });
    expect(r.signal).toBeNull();
    expect(r.ok).toBe(false);
    expect(["ECONNRESET", "ConnectionClosed"]).toContain(r.code);
  });

  test("recv → short reads (1 byte) deliver complete body", async () => {
    const body = Buffer.alloc(8192, "z");
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => new Response(body),
    });
    const r = await runClientFetch(server.url.href, { syscall: "recv", action: "short", bytes: 1, repeat: -1 });
    expect(r).toMatchObject({ ok: true, status: 200, length: body.length, signal: null, exitCode: 0 });
  });

  test("recv → short reads (1 byte) deliver complete chunked (Transfer-Encoding) body", async () => {
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(Buffer.alloc(100, "a"));
              c.enqueue(Buffer.alloc(200, "b"));
              c.enqueue(Buffer.alloc(50, "c"));
              c.close();
            },
          }),
        ),
    });
    const r = await runClientFetch(server.url.href, { syscall: "recv", action: "short", bytes: 1, repeat: -1 });
    expect(r).toMatchObject({ ok: true, status: 200, length: 350, signal: null, exitCode: 0 });
  });

  test("send → short writes (1 byte) on the request still gets a response", async () => {
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => new Response("ok"),
    });
    const r = await runClientFetch(server.url.href, { syscall: "send", action: "short", bytes: 1, repeat: -1 });
    expect(r).toMatchObject({ ok: true, status: 200, length: 2, signal: null, exitCode: 0 });
  });

  test("connect → ECONNREFUSED rejects with ECONNREFUSED", async () => {
    using server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("x") });
    const r = await runClientFetch(server.url.href, {
      syscall: "connect",
      action: "errno",
      errno: "ECONNREFUSED",
      repeat: -1,
    });
    expect(r.signal).toBeNull();
    expect(r.ok).toBe(false);
    // fetch wraps connect failure as a generic open-socket error.
    expect(["ECONNREFUSED", "FailedToOpenSocket", "ConnectionRefused"]).toContain(r.code);
  });

  test("recv → 0 (peer closed) before any byte rejects cleanly (no hang)", async () => {
    using server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response(Buffer.alloc(1024)) });
    const r = await runClientFetch(server.url.href, { syscall: "recv", action: "zero", repeat: -1 });
    expect(r.signal).toBeNull();
    expect(r.ok).toBe(false);
    expect(r.exitCode).toBe(0);
  });

  // `send` faults the request-write path; `recv` faults the response-read path
  // that the cancel is racing against. Both must settle without a leak/hang.
  test.each(["send", "recv"] as const)("body reader cancel under 1-byte %s settles cleanly", async syscall => {
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => new Response(Buffer.alloc(64 * 1024, "q")),
    });
    const r = await runClientFetch(
      server.url.href,
      { syscall, action: "short", bytes: 1, repeat: -1 },
      { abort: true, readBytes: 256 },
    );
    expect(r).toMatchObject({ ok: true, status: 200, signal: null, exitCode: 0 });
  });

  test("re-arming rules from JS during an in-flight fetch keeps the rule coherent", async () => {
    const body = Buffer.alloc(32 * 1024, "r");
    using server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response(body) });
    // Regression: us_fault_set() published the rule with a plain struct write
    // while the HTTP-client thread read it concurrently in us_fault_hit(), so
    // a re-arm during a download could observe a torn rule. Hammer set() while
    // the body streams and require the bytes to still arrive intact. The clamp
    // floor of 8 keeps the syscall count bounded on slow ASan runners.
    const fixture = /* js */ `
      const { socketFaultInjection: fault } = require("bun:internal-for-testing");
      fault.set({ syscall: "recv", action: "short", bytes: 16, repeat: -1 });
      const done = fetch(${JSON.stringify(server.url.href)}).then(r => r.arrayBuffer());
      let flips = 0;
      const rearm = setInterval(() => {
        flips++;
        fault.set({ syscall: "recv", action: "short", bytes: 8 + (flips % 56), repeat: -1 });
        fault.set({ syscall: "send", action: "short", bytes: 8 + (flips % 8), repeat: -1 });
      }, 0);
      const buf = await done;
      clearInterval(rearm);
      fault.clear();
      console.log(JSON.stringify({ ok: true, length: buf.byteLength, flips }));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: "1" },
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // Assert the output before the exit code so a failure shows what the fixture printed.
    expect(JSON.parse(stdout.trim() || "{}")).toMatchObject({ ok: true, length: body.length });
    expect(proc.signalCode).toBeNull();
    expect(exitCode).toBe(0);
  });
});

describe.skipIf(skip)("fetch() under injected syscall faults (https)", () => {
  test("TLS handshake under 3-byte sends still succeeds and body decrypts", async () => {
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      tls: { key: certs.key, cert: certs.cert },
      fetch: () => new Response("hello-tls"),
    });
    const r = await runClientFetch(
      server.url.href,
      { syscall: "send", action: "short", bytes: 3, repeat: -1 },
      { ca: certs.cert },
    );
    expect(r).toMatchObject({ ok: true, status: 200, length: 9, signal: null, exitCode: 0 });
  });

  test("recv → ECONNRESET during TLS handshake rejects (no hang)", async () => {
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      tls: { key: certs.key, cert: certs.cert },
      fetch: () => new Response("x"),
    });
    const r = await runClientFetch(
      server.url.href,
      { syscall: "recv", action: "errno", errno: "ECONNRESET", repeat: -1 },
      { ca: certs.cert },
    );
    expect(r.signal).toBeNull();
    expect(r.ok).toBe(false);
    expect(r.exitCode).toBe(0);
  });

  test("recv → 5-byte short reads (TLS record header boundary) deliver complete body", async () => {
    const body = Buffer.alloc(2048, "T");
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      tls: { key: certs.key, cert: certs.cert },
      fetch: () => new Response(body),
    });
    const r = await runClientFetch(
      server.url.href,
      { syscall: "recv", action: "short", bytes: 5, repeat: -1 },
      { ca: certs.cert },
    );
    expect(r).toMatchObject({ ok: true, status: 200, length: body.length, signal: null, exitCode: 0 });
  });
});

describe.skipIf(skip)("fetch() seeded short-I/O fuzz", () => {
  const seed = Number(process.env.BUN_SOCKET_FUZZ_SEED ?? 0x4e7c) >>> 0 || 1;
  function makePrng(s: number) {
    return () => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return (s >>> 0) / 0x1_0000_0000;
    };
  }

  test("randomized short recv/send still deliver intact body", async () => {
    const rand = makePrng(seed);
    const body = Buffer.alloc(4096, "F");
    using server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response(body) });
    for (let i = 0; i < 4; i++) {
      const sc = rand() < 0.5 ? "recv" : "send";
      const bytes = 1 + Math.floor(rand() * 32);
      const r = await runClientFetch(server.url.href, { syscall: sc, action: "short", bytes, repeat: -1 });
      expect(r).toMatchObject({ ok: true, status: 200, length: body.length, signal: null, exitCode: 0 });
    }
  });
});
