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
      const server = Bun.serve({
        port: 0,
        fetch(req) {
          return new Response("OK");
        },
      });

      const url = server.url;

      // Establish a keep-alive connection
      await fetch(url);

      // Stop the server (downgrades JS ref to weak)
      server.stop();

      // Force GC to potentially collect the weak reference
      Bun.gc(true);
      Bun.gc(true);

      // Try making requests - these may arrive on keep-alive connections
      // after the JS wrapper has been collected
      const results = await Promise.allSettled(
        Array.from({ length: 20 }, () => fetch(url).catch(() => null))
      );

      // We don't care about the results, just that we didn't crash
      console.log("OK");
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("panic");
  expect(stderr).not.toContain("Segmentation fault");
  expect(stdout).toContain("OK");
  // The process should exit cleanly (0) or at worst with a connection error,
  // but never with a signal-based crash (segfault = 139 on Linux, 134 for abort)
  expect(exitCode).not.toBe(139);
  expect(exitCode).not.toBe(134);
  expect(exitCode).toBe(0);
});

test("server.fetch() does not crash after stop() + GC", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const server = Bun.serve({
        port: 0,
        fetch(req) {
          return new Response("OK");
        },
      });

      // Stop the server
      server.stop();

      // Force GC
      Bun.gc(true);
      Bun.gc(true);

      // Try using server.fetch() after GC - should not segfault
      try {
        await server.fetch(new Request("http://localhost/"));
      } catch (e) {
        // Expected to fail, but not crash
      }

      console.log("OK");
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("Segmentation fault");
  expect(stdout).toContain("OK");
  expect(exitCode).toBe(0);
});
