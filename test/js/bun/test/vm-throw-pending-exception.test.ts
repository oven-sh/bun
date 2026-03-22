import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression: when a termination exception (e.g. from vm timeout watchdog)
// fires during error object creation inside ErrorCodeCache::createError,
// tryClearException fails to clear it and the exception stays pending on the
// VM. The subsequent call to VM.throwError would then hit assertNoException
// and crash with SIGABRT in debug/ASAN builds.
//
// The fix checks global_object.hasException() in VM.throwError and returns
// early if an exception is already pending instead of trying to throw on top.
//
// Note: the crash only manifests in debug/ASAN builds where ci_assert is
// enabled. In release builds assertNoException is a no-op, so this test
// passes on both fixed and unfixed release binaries. CI debug/ASAN jobs
// are the authoritative regression guard.
test("VM.throwError does not crash when a termination exception is already pending", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const vm = require("node:vm");
      const fs = require("node:fs");

      // fs.readFileSync with invalid arg type triggers ERR_INVALID_ARG_TYPE
      // through the Zig Error.throw() -> throwValue -> VM.throwError path.
      // When the vm watchdog fires during ErrorInstance::create (inside the
      // error object construction for ERR_INVALID_ARG_TYPE), a termination
      // exception is left pending on the VM. Without the fix, the next
      // VM.throwError call would hit assertNoException and abort.
      const ctx = vm.createContext({
        triggerError: function() { fs.readFileSync(123); }
      });

      for (let i = 0; i < 10; i++) {
        try {
          vm.runInContext(
            'while (true) { try { triggerError(); } catch(e) {} }',
            ctx,
            { timeout: 1 },
          );
        } catch (e) {
          // ERR_SCRIPT_EXECUTION_TIMEOUT expected
        }
      }
      console.log("OK");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
});
