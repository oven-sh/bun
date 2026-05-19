// Regression test for a macOS shutdown livelock: with a JS
// process.on('SIGABRT') listener installed, Bun__onExit's
// FSEvents.closeAndWait() pthread_join would spin forever at 100% CPU when
// the CFRunLoop thread abort()ed during _pthread_tsd_cleanup, because
// forwardSignal queued the SIGABRT for a JS loop parked in __ulock_wait and
// returned, and macOS __abort re-raises without ever resetting the handler.
//
// The fix resets every JS-installed signal handler to SIG_DFL at the top of
// Global.exit() (before libc exit()/quick_exit() runs any atexit callbacks,
// hence before Bun__onExit), so a late abort during teardown terminates the
// process instead of spinning. We reproduce the re-raise loop portably with
// a tiny shared library whose atexit/at_quick_exit callback does
// `for(;;) raise(SIGABRT);`.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix, tempDir } from "harness";
import fs from "node:fs";
import path from "node:path";

test.skipIf(!isPosix)("process.on('SIGABRT') does not livelock when a thread aborts after process.exit()", async () => {
  const helperSource = fs.readFileSync(path.join(import.meta.dirname, "exit-sigabrt-livelock-fixture.c"), "utf8");
  const lib = process.platform === "darwin" ? "helper.dylib" : "helper.so";

  const fixture = /* ts */ `
      import { dlopen } from "bun:ffi";
      import path from "node:path";
      const { symbols } = dlopen(path.join(import.meta.dirname, ${JSON.stringify(lib)}), {
        setup_exit_abort: { args: [], returns: "void" },
      });

      // Install forwardSignal for SIGABRT. Before the fix this stays
      // installed through libc exit() and swallows every raise().
      process.on("SIGABRT", () => {
        // Never runs — the JS loop doesn't tick again after process.exit().
        console.error("UNREACHABLE_JS_SIGABRT_HANDLER");
      });

      symbols.setup_exit_abort();
      process.stdout.write("calling process.exit\\n");
      process.exit(0);
    `;

  using dir = tempDir("exit-sigabrt-livelock", {
    "helper.c": helperSource,
    "fixture.ts": fixture,
  });
  const cwd = String(dir);

  // Build the helper shared library with the system toolchain.
  await using cc = Bun.spawn({
    cmd: ["cc", "-shared", "-fPIC", "-o", lib, "helper.c"],
    cwd,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [ccStderr, ccExit] = await Promise.all([cc.stderr.text(), cc.exited]);
  if (ccExit !== 0) console.error(ccStderr);
  expect(ccExit).toBe(0);

  // Run the fixture. Without the fix this livelocks in raise_abort_loop
  // and gets killed by the spawn timeout; with the fix it dies with
  // SIGABRT almost immediately.
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "fixture.ts"],
    cwd,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 3_000,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("calling process.exit\n");
  expect(stderr).not.toContain("UNREACHABLE_JS_SIGABRT_HANDLER");
  // With the fix the handler is SIG_DFL by the time raise_abort_loop
  // runs, so the first SIGABRT terminates the process. Without the fix
  // forwardSignal swallows every SIGABRT, the loop spins, and the spawn
  // timeout sends SIGTERM instead.
  expect({ signalCode: proc.signalCode, exitCode }).toEqual({
    signalCode: "SIGABRT",
    exitCode: 128 + 6,
  });
});
