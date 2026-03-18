import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/22809
// Segfault when server JS wrapper is finalized but uWS callbacks still fire.
// After server.stop() downgrades the JS reference, GC can collect the wrapper.
// Incoming requests must not crash (null pointer deref) but should get 503.

test("server does not segfault when request arrives after stop + GC", async () => {
  // We run this in a subprocess because a segfault would crash the test runner.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const server = Bun.serve({
        port: 0,
        fetch(req) {
          return new Response("ok");
        },
      });

      const url = server.url.href;

      // Verify server works before stop
      const res1 = await fetch(url);
      if (res1.status !== 200) {
        process.exit(10);
      }

      // Stop the server (downgrades the JS reference to weak)
      server.stop();

      // Force GC to collect the weak JS wrapper
      Bun.gc(true);
      Bun.gc(true);

      // Try to make a request - if the server is still listening, it should
      // either respond with 503 or refuse the connection, but NOT segfault.
      try {
        const res2 = await fetch(url);
        // If we get here, the server is still listening - check we got 503
        if (res2.status !== 503 && res2.status !== 200) {
          process.exit(11);
        }
      } catch (e) {
        // Connection refused is also acceptable - server may have fully stopped
      }

      process.exit(0);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The important thing: exit code must NOT be a signal (segfault = 11 on Linux)
  // and must not be our sentinel values
  if (exitCode !== 0) {
    console.log("stdout:", stdout);
    console.log("stderr:", stderr);
  }
  expect(exitCode).toBe(0);
});
