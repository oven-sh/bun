// Regression test: SSLConfig intern/deref race (UAF) — see PR #27838, #27863
//
// Non-deterministic by nature: the race window between deref()'s fetchSub(1→0)
// and destroy()'s mutex.lock() is ~10 CPU cycles in release. On debug+ASAN
// builds, debug.deinit() in ref_count.zig widens the window enough for ~60%
// catch rate without special env vars. On release builds, this is a best-effort
// regression guard that will catch reintroduction across enough CI runs.
//
// For deterministic reproduction (debug+ASAN + BUN_DEBUG_SSLConfig=1), see #27863.
//
// Structure: subprocess fixture runs a setImmediate loop calling fetch+abort
// (intern on JS thread, deref on HTTP thread) while a serial driver loop
// cycles the refcount through 0. If the race triggers, the subprocess crashes
// (debugAssert / assertValid / ASAN) → non-zero exit → test fails.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tls as tlsCert } from "harness";
import { once } from "node:events";
import net from "node:net";
import { join } from "node:path";

async function createConnectProxy() {
  const server = net.createServer(client => {
    let head = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      head = Buffer.concat([head, chunk]);
      const headerEnd = head.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      client.removeListener("data", onData);
      const firstLine = head.subarray(0, head.indexOf("\r\n")).toString("latin1");
      const [, hostPort] = firstLine.split(" ");
      const colon = hostPort!.lastIndexOf(":");
      const host = hostPort!.slice(0, colon);
      const port = Number(hostPort!.slice(colon + 1));
      const upstream = net.connect(port, host, () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        const extra = head.subarray(headerEnd + 4);
        if (extra.length > 0) upstream.write(extra);
        client.pipe(upstream);
        upstream.pipe(client);
      });
      upstream.on("error", () => client.destroy());
      client.on("error", () => upstream.destroy());
    };
    client.on("data", onData);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { server, port: (server.address() as net.AddressInfo).port };
}

test("SSLConfig intern/deref race does not cause use-after-free", async () => {
  using backend = Bun.serve({
    port: 0,
    tls: tlsCert,
    fetch() {
      return new Response("ok");
    },
  });

  const proxy = await createConnectProxy();

  try {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "fetch-proxy-tls-intern-race-fixture.ts")],
      env: {
        ...bunEnv,
        BACKEND_PORT: String(backend.port),
        PROXY_PORT: String(proxy.port),
        HARD_CAP_MS: "5000",
        // bunEnv strips BUN_DEBUG_* vars. On debug builds, this scoped log
        // widens the race window from ~10 cycles to ~100μs+ via stderr
        // writes in deref()/destroy(). No-op in release builds (enable_logs
        // is compile-time false).
        BUN_DEBUG_SSLConfig: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // If the race triggered, the subprocess crashed (non-zero exit).
    // Surface stderr for debugging before asserting the exit code.
    if (exitCode !== 0) {
      console.error("Fixture stderr:", stderr);
    }
    expect(exitCode).toBe(0);

    // Sanity-check the fixture actually ran. Scoped debug logging goes to
    // stdout in debug builds, so the JSON result is on the last line.
    const lines = stdout.trim().split("\n");
    const result = JSON.parse(lines[lines.length - 1]);
    // Both the driver and the probe should have done work (verifies the
    // race conditions were actually being exercised).
    expect(result.driverOk).toBeGreaterThan(0);
    expect(result.probes).toBeGreaterThan(100);
  } finally {
    proxy.server.close();
    proxy.server.unref();
  }
}, 30_000);
