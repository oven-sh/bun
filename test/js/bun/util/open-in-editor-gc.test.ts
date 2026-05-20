import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux } from "harness";

// On Linux, JavaScriptCore uses SIGPWR to suspend and resume threads during
// garbage collection. Bun.openInEditor() spawns the editor via bun.spawnSync
// on a detached background thread, which installs signal-forwarding handlers
// for the duration of the spawn. Those handlers must not replace JSC's SIGPWR
// handler, otherwise a concurrent GC will terminate the process with SIGPWR.
test.skipIf(!isLinux)("Bun.openInEditor concurrent with GC does not terminate the process with SIGPWR", () => {
  const script = `
    for (let k = 0; k < 50; k++) {
      try { Bun.openInEditor("foo" + k); } catch {}
    }
    for (let i = 0; i < 200; i++) Bun.gc(true);
  `;
  const { exitCode, signalCode } = Bun.spawnSync({
    cmd: [bunExe(), "-e", script],
    env: { ...bunEnv, EDITOR: undefined, VISUAL: undefined },
    stdout: "ignore",
    stderr: "ignore",
  });
  expect(signalCode).toBeUndefined();
  expect(exitCode).toBe(0);
});
