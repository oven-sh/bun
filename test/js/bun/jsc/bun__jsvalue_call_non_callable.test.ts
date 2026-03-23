import { expect, test } from "bun:test";
import { spawn } from "bun";
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
//   - Without the fix, ASSERT aborts with SIGABRT (exit signal != 0).
//   - With the fix, the subprocess exits cleanly (TypeError is reported
//     and swallowed by the catch in the Zig caller, then we exit 0).
test("Bun__JSValue__call on non-callable value does not abort", async () => {
  await using proc = spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const client = new Bun.RedisClient("redis://127.0.0.1:1", {
          autoReconnect: false,
          maxRetries: 0,
          connectionTimeout: 50,
        });
        // Non-callable. The internal close path will try to .call() this.
        client.onclose = {};
        // Swallow the unhandled TypeError the fix produces.
        process.on("uncaughtException", () => {});
        try { await client.connect(); } catch {}
        // If we got here without aborting, the fix is in place.
        console.log("OK");
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, exitCode, signalCode] = await Promise.all([
    proc.stdout.text(),
    proc.exited,
    (async () => {
      await proc.exited;
      return proc.signalCode;
    })(),
  ]);

  // Without the fix: SIGABRT from the ASSERT (signalCode === "SIGABRT").
  // With the fix: clean exit, OK printed.
  expect(signalCode).toBeNull();
  expect(stdout).toContain("OK");
  expect(exitCode).toBe(0);
});
