import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test for a Windows segfault (address 0xCC) in
// dns.internal.workPoolCallback. The internal DNS cache could deinit a
// Request whose getaddrinfo() was still queued on the thread pool if the
// socket-side refcount was over-released while the cache was near its
// eviction threshold. This stresses that path by issuing many concurrent
// connects to distinct hostnames (each a cache miss → new Request +
// work-pool task) and tearing them down before the worker runs, while
// pushing the cache past its 80%-full eviction threshold.
test("internal DNS: aborting many concurrent connects does not free pending work-pool requests", async () => {
  const script = /* js */ `
    const net = require("node:net");

    // MAX_ENTRIES in the global DNS cache is 256; eviction starts at 80%.
    // Use enough distinct hostnames to force freeaddrinfo/tryPush into the
    // eviction path while earlier Requests still have their work-pool
    // callback queued. .invalid is reserved (RFC 2606) so getaddrinfo()
    // runs on the worker thread without any successful connection.
    const HOSTS = 300;
    const ROUNDS = 2;

    async function round(r) {
      const closers = [];
      for (let i = 0; i < HOSTS; i++) {
        const host = "abort-" + r + "-" + i + ".invalid";
        try {
          const sock = net.connect({ host, port: 1 });
          sock.on("error", () => {});
          closers.push(sock);
        } catch {
          // Hitting a per-process socket/handle limit is fine; we only
          // need the cache past its eviction threshold, not every connect
          // to succeed.
        }
      }
      // Let us_socket_context_connect enqueue each Request on the work
      // pool, then race the worker by destroying every connecting socket
      // (Bun__addrinfo_cancel + Bun__addrinfo_freeRequest).
      await new Promise(resolve => setImmediate(resolve));
      for (const sock of closers) sock.destroy();
      await new Promise(resolve => setImmediate(resolve));
    }

    (async () => {
      for (let r = 0; r < ROUNDS; r++) await round(r);
      // Give late work-pool callbacks a window to run so a UAF would
      // surface here rather than after exit.
      await Bun.sleep(50);
      console.log("ok");
      // getaddrinfo() for .invalid names may still be blocked inside the
      // OS resolver on the work-pool thread; force exit so the test does
      // not wait for every resolver timeout.
      process.exit(0);
    })().catch(e => {
      console.error(e);
      process.exit(1);
    });
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // stderr is captured for diagnostics but not asserted empty: the OS
  // resolver (Windows DNS client, glibc nss) can emit noise for bogus
  // hostnames that is unrelated to the UAF this test targets. The UAF
  // manifests as a crash, which stdout/exitCode catch below.
  expect({ stdout: stdout.trim(), stderr }).toMatchObject({ stdout: "ok" });
  expect(exitCode).toBe(0);
}, 60_000);
