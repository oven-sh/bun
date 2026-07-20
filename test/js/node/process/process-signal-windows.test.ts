// Windows console-control → signal mapping.
//
// libuv's uv__signal_control_handler (src/win/signal.c) maps:
//   CTRL_C_EVENT     → SIGINT
//   CTRL_BREAK_EVENT → SIGBREAK
//   CTRL_CLOSE_EVENT → SIGHUP
//
// process.on('SIGHUP'/'SIGBREAK') must therefore create a uv_signal_t on
// Windows so those console events reach JS, matching Node.js. Both names
// were missing from the Windows branch of signalNameToNumberMap, so they
// were treated as plain emitter events and never reached libuv.
//
// We can't reliably synthesise CTRL_CLOSE_EVENT in CI (it requires the user
// or UI automation to actually close a console window), so this test
// verifies the fix at the layer that changed: process.kill(pid, name)
// resolves `name` through the same signalNameToNumberMap that
// process.on(name, fn) uses to decide whether to create a uv_signal_t.
// Before the fix it threw ERR_UNKNOWN_SIGNAL for SIGHUP/SIGBREAK on Windows;
// after the fix the names resolve and uv_kill returns ENOSYS, which matches
// Node.js.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

test.skipIf(!isWindows)("SIGHUP and SIGBREAK are recognised as signal names on Windows", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const os = require("node:os");
      if (os.constants.signals.SIGHUP !== 1) throw new Error("SIGHUP constant wrong");
      if (os.constants.signals.SIGBREAK !== 21) throw new Error("SIGBREAK constant wrong");

      for (const sig of ["SIGHUP", "SIGBREAK"]) {
        // Registering a listener must not throw.
        const fn = () => {};
        process.on(sig, fn);
        process.off(sig, fn);

        // Resolving the name in process.kill must not throw ERR_UNKNOWN_SIGNAL.
        // (uv_kill returns ENOSYS for these on Windows, which matches Node.js.)
        try {
          process.kill(process.pid, sig);
          console.log(sig, "no error");
        } catch (e) {
          console.log(sig, e.code ?? e.message);
        }
      }
    `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).not.toContain("ERR_UNKNOWN_SIGNAL");
  expect(stdout.trim().split("\n")).toEqual(["SIGHUP ENOSYS", "SIGBREAK ENOSYS"]);
  expect(exitCode).toBe(0);
});
