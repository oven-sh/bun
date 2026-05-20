import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDirWithFiles } from "harness";
import { chmodSync } from "node:fs";
import { join } from "node:path";

// On Linux, JSC's GC uses SIGPWR to suspend/resume threads for conservative
// stack scanning. Bun.openInEditor spawns the editor via the sync spawn path,
// which installs signal-forwarding handlers for the duration of the spawn. If
// SIGPWR is in that set, a concurrent GC's pthread_kill(SIGPWR) goes to the
// forwarding handler instead of the suspend/resume handler, which either
// deadlocks the GC (the semaphore is never posted) or, because the forwarding
// handler uses SA_RESETHAND, resets SIGPWR to SIG_DFL so the next GC suspend
// terminates the process with signal 30.
test.skipIf(!isLinux)("Bun.openInEditor does not hijack the GC suspend/resume signal", async () => {
  const dir = tempDirWithFiles("open-in-editor-gc", {
    // The short sleep keeps the signal-forwarding window open long enough to
    // overlap a GC on the main thread.
    "code": "#!/bin/sh\nsleep 0.01\nexit 0\n",
    "repro.js": `
      for (let i = 0; i < 200; i++) {
        try { Bun.openInEditor("/tmp/whatever", 1); } catch {}
        Bun.gc(true);
      }
      console.log("survived");
    `,
  });
  chmodSync(join(dir, "code"), 0o755);

  await using proc = Bun.spawn({
    cmd: [bunExe(), join(dir, "repro.js")],
    env: {
      ...bunEnv,
      PATH: `${dir}:${bunEnv.PATH ?? process.env.PATH}`,
      EDITOR: undefined,
      VISUAL: undefined,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(proc.signalCode).toBeNull();
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("survived");
  expect(exitCode).toBe(0);
});
