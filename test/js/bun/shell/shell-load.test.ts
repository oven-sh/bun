import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isCI, isDebug, isWindows } from "harness";
import path from "path";

describe("shell load", () => {
  // windows process spawning is a lot slower
  test.skipIf(isCI && isWindows)(
    "immediate exit",
    async () => {
      // Regression test for a crash when a spawned command exits before the
      // shell registers its exit watcher. 300 batches of 100 on a release
      // build; ASAN/debug slow the parent enough that 60 batches exercise the
      // same race at a fraction of the wall time.
      const outer = isASAN || isDebug ? 60 : process.platform === "darwin" ? 100 : 300;

      await using proc = Bun.spawn({
        cmd: [bunExe(), path.join(import.meta.dir, "shell-immediate-exit-fixture.js")],
        env: { ...bunEnv, SHELL_LOAD_OUTER: String(outer) },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      // console.count("Ran") fires on every tenth outer iteration.
      const expectedBatches = Math.floor((outer - 1) / 10) + 1;
      const lines = stdout.split("\n").filter(Boolean);
      expect(lines).toEqual(Array.from({ length: expectedBatches }, (_, i) => `Ran: ${i + 1}`));
      expect(exitCode).toBe(0);
    },
    {
      timeout: isASAN || isDebug ? 1000 * 45 : 1000 * 90,
    },
  );
});
