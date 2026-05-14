import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

// When a child process exits while its stdout/stderr pipe still has pending
// activity, onProcessExit keeps the Subprocess JSRef Strong. The pipe later
// drains and PipeReader.onReaderDone → Subprocess.onCloseIO converts the
// Readable from `.pipe` to `.buffer`, but previously did not call
// updateHasPendingActivity(), so the JSRef stayed Strong forever and the
// JSSubprocess (plus its buffered output) leaked.
//
// To reproduce deterministically we need the stdout drain to complete
// asynchronously, *after* onProcessExit returns. On POSIX the read() issued
// from onProcessExit normally drains the pipe to EOF synchronously, so we
// force EAGAIN by having a grandchild inherit stdout and keep the write end
// open past the direct child's exit. The exit notification then arrives
// while the pipe is still pending, and onCloseIO runs later from the event
// loop — the path that leaked.
//
// Windows uses a different pipe/process model; the scenario is POSIX-shaped.
test.skipIf(isWindows)(
  "Subprocess is collectable when stdout pipe drains asynchronously after process exit",
  async () => {
    const script = /* js */ `
      let collected = 0;
      const registry = new FinalizationRegistry(() => {
        collected++;
      });

      const ITERS = 10;

      // The child spawns a detached grandchild that inherits stdout and writes
      // after a short delay, then the child exits immediately. The grandchild
      // keeps the write end of the pipe open past the child's exit, so
      // onProcessExit's read() hits EAGAIN and the drain completes later.
      const childScript =
        "const { spawn } = require('child_process');" +
        "spawn(process.execPath, ['-e', 'setTimeout(() => process.stdout.write(Buffer.alloc(1024, 88)), 30)']," +
        "  { stdio: ['ignore', 'inherit', 'ignore'], detached: true }).unref();";

      async function once() {
        const proc = Bun.spawn({
          cmd: [process.execPath, "-e", childScript],
          env: process.env,
          stdout: "pipe",
          stderr: "ignore",
          stdin: "ignore",
        });
        await proc.exited;
        // Intentionally never touch proc.stdout — onCloseIO will convert the
        // pipe to a buffered Readable that nobody references.
        registry.register(proc, undefined);
      }

      for (let i = 0; i < ITERS; i++) {
        await once();
      }

      // Give grandchildren time to write, exit, and for the pipes to reach
      // EOF and fire onReaderDone → onCloseIO on the event loop. Then GC.
      for (let i = 0; i < 60 && collected < ITERS; i++) {
        await Bun.sleep(25);
        Bun.gc(true);
      }

      console.log(JSON.stringify({ collected, iters: ITERS }));
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const stderrLines = stderr
      .split("\n")
      .filter(l => l && !l.startsWith("WARNING: ASAN interferes"))
      .join("\n");
    expect(stderrLines).toBe("");
    const { collected, iters } = JSON.parse(stdout.trim());
    // Without the fix, zero Subprocess wrappers are collected because their
    // JSRef is never downgraded. With the fix they are all collectable.
    expect(collected).toBe(iters);
    expect(exitCode).toBe(0);
  },
  60_000,
);
