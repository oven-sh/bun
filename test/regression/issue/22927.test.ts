import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test for #22927: Segfault in HTTP server route handler after
// server.stop() + GC. When the server's JS wrapper is garbage collected,
// route handlers must not crash accessing the null JSHTTPServer pointer.

test("server does not crash when requests arrive after stop() + GC", async () => {
  // We run this in a subprocess because the crash is a segfault that would
  // kill the test runner process.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      let server = Bun.serve({
        port: 0,
        fetch(req) {
          return new Response("OK");
        },
      });

      const url = server.url;

      // Establish a keep-alive connection and consume the response body
      const warmup = await fetch(url);
      await warmup.text();

      // Stop the server (downgrades JS ref to weak) and drop the strong reference
      server.stop();
      server = null;

      // Force GC to collect the weak reference
      Bun.gc(true);
      Bun.gc(true);

      // Try making requests - these may arrive on keep-alive connections
      // after the JS wrapper has been collected
      const results = await Promise.allSettled(
        Array.from({ length: 20 }, () => fetch(url))
      );

      // All requests should have either failed or returned non-200
      // since the server is stopped
      for (const r of results) {
        if (r.status === "fulfilled") {
          await r.value.text();
        }
      }

      // We got here without crashing
      console.log("OK");
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("OK");
  expect(exitCode).toBe(0);
});

test("server.fetch() does not crash after stop() + GC", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      let server = Bun.serve({
        port: 0,
        fetch(req) {
          return new Response("OK");
        },
      });

      // Keep a reference to call server.fetch() later
      const fetchFn = server.fetch.bind(server);

      // Stop the server and drop the strong reference
      server.stop();
      server = null;

      // Force GC to collect the weak reference
      Bun.gc(true);
      Bun.gc(true);

      // Try using server.fetch() after GC - should reject, not segfault
      try {
        const res = await fetchFn(new Request("http://localhost/"));
        // If it somehow resolves, consume the body
        await res.text();
      } catch (e) {
        // Expected to reject with "Server is no longer available"
      }

      console.log("OK");
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("OK");
  expect(exitCode).toBe(0);
});
