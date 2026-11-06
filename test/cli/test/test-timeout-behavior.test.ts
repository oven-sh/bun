import { expect, test } from "bun:test";
import { bunEnv, bunExe, isFlaky, isLinux } from "harness";
import path from "path";

if (isFlaky && isLinux) {
  test.todo("processes get killed");
} else {
  // "node": the spawnSync of node:child_process, which has an entry point of its own into the spawn.
  test.concurrent.each([true, false, "node"] as const)(`processes get killed (sync: %p)`, async sync => {
    const fixture =
      sync === "node"
        ? "process-kill-fixture-node-sync.ts"
        : sync
          ? "process-kill-fixture-sync.ts"
          : "process-kill-fixture.ts";
    const { exited, stdout, stderr } = Bun.spawn({
      cmd: [bunExe(), "test", path.join(import.meta.dir, fixture)],
      stdout: "pipe",
      stderr: "pipe",
      stdin: "inherit",
      env: bunEnv,
    });
    const [out, err, exitCode] = await Promise.all([stdout.text(), stderr.text(), exited]);
    // merge outputs so that this test still works if we change which things are printed to stdout
    // and which to stderr
    const combined = out + err;
    // exit code should indicate failed tests, not abort or anything
    expect(exitCode).toBe(1);
    expect(combined).not.toContain("This should not be printed!");
    expect(combined).toContain("killed 1 dangling process");
    // we should not expose the termination exception
    expect(combined).not.toContain("Unhandled error between tests");
    expect(combined).not.toContain("JavaScript execution terminated");
    // both tests should have run with the expected result
    expect(combined).toContain("(fail) test timeout kills dangling processes");
    expect(combined).toContain("(pass) slow test after test timeout");
  });
}
