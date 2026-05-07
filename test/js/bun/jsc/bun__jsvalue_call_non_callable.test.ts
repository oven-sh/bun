import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test for an ASSERT crash in Bun__JSValue__call when a Zig
// caller invokes .call() on a non-callable JSValue. In debug/ASAN builds
// (ASSERT_ENABLED) this used to abort the process; the fix turns it into
// a JS TypeError that the Zig caller can report as an unhandled error.
//
// Bun.RedisClient's `onclose` setter does NOT validate callability, so we
// can stash any value there and have the internal close path call it. The
// .call() site that used to assert is
// src/runtime/valkey_jsc/js_valkey.zig:1026 -> Bun__JSValue__call.
//
// We run this in a subprocess because:
//   - Without the fix, ASSERT aborts (SIGABRT on POSIX, non-zero exit
//     code with no stdout on Windows).
//   - With the fix, the subprocess exits cleanly.
test("Bun__JSValue__call on non-callable value does not abort", async () => {
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
        const client = new Bun.RedisClient(
          "redis://127.0.0.1:" + server.port,
          { autoReconnect: false, maxRetries: 0, connectionTimeout: 5000 },
        );
        // Non-callable. The internal close path will try to .call() this.
        client.onclose = {};
        // Swallow the unhandled TypeError the fix produces.
        process.on("uncaughtException", () => {});
        try { await client.connect(); } catch {}
        // Give the close microtask a chance to fire.
        await Bun.sleep(50);
        console.log("OK");
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // With the fix: clean exit, "OK" printed.
  // Without the fix: the subprocess aborts (SIGABRT / non-zero exit),
  // and "OK" never gets printed.
  expect({ stdout, stderr, exitCode }).toMatchObject({
    stdout: expect.stringContaining("OK"),
    exitCode: 0,
  });
});
