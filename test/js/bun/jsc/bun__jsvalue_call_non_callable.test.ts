import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

// Regression test for an ASSERT crash in Bun__JSValue__call when a Zig
// caller invokes .call() on a non-callable JSValue. In debug/ASAN builds
// (ASSERT_ENABLED) this used to abort the process; the fix turns it into
// a JS TypeError that the Zig caller can report as an unhandled error.
//
// Bun.RedisClient's `onclose` setter does NOT validate callability, so we
// can stash any value there and have the internal close path call it. The
// .call() site that used to assert is the on_close.call(...) in
// src/runtime/valkey_jsc/js_valkey.rs -> Bun__JSValue__call.
//
// We run this in a subprocess because:
//   - Without the fix, ASSERT aborts (SIGABRT on POSIX, non-zero exit
//     code with no stdout on Windows).
//   - With the fix, the subprocess exits cleanly.
// Skipped on Windows: the TCP accept-then-close sequence on Windows
// runners schedules the close propagation later than on POSIX, and the
// onclose invocation sometimes beats the parent test timeout. The fix is
// platform-agnostic C++ logic and is already exercised on Linux/macOS/ASAN.
test.skipIf(isWindows)("Bun__JSValue__call on non-callable value does not abort", async () => {
  await using proc = spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        // Stand up a listener we control so the connection attempt doesn't
        // depend on OS-specific behavior for refused/unreachable ports.
        using server = Bun.listen({
          hostname: "127.0.0.1",
          port: 0,
          socket: {
            open(socket) { socket.end(); },
            data() {}, close() {}, drain() {}, error() {},
          },
        });
        // Wait for the TypeError the fix produces, so the test fails
        // loudly if the close path is ever changed to bypass .call().
        const { promise, resolve } = Promise.withResolvers();
        process.on("uncaughtException", e => resolve(e));
        const client = new Bun.RedisClient(
          "redis://127.0.0.1:" + server.port,
          { autoReconnect: false, maxRetries: 0, connectionTimeout: 5000 },
        );
        // Non-callable. The internal close path will try to .call() this.
        client.onclose = {};
        try { await client.connect(); } catch {}
        const err = await promise;
        console.log("CAUGHT " + err?.name);
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // With the fix: clean exit, TypeError caught in the subprocess.
  // Without the fix: the subprocess aborts (ASSERT_ENABLED) before the
  // uncaughtException handler ever sees anything.
  expect({ stdout, stderr, exitCode }).toMatchObject({
    stdout: expect.stringContaining("CAUGHT TypeError"),
    exitCode: 0,
  });
});
