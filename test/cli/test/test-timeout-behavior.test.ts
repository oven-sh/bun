import { expect, test } from "bun:test";
import { bunEnv, bunExe, isFlaky, isLinux } from "harness";
import path from "path";

if (isFlaky && isLinux) {
  test.todo("processes get killed");
} else {
  test.concurrent.each([true, false])(`processes get killed (sync: %p)`, async sync => {
    const { exited, stdout, stderr } = Bun.spawn({
      cmd: [
        bunExe(),
        "test",
        path.join(import.meta.dir, sync ? "process-kill-fixture-sync.ts" : "process-kill-fixture.ts"),
      ],
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

// A test's timeout kills only what the test spawned, not processes from hooks or the top of the file (#46373).
test.each([
  { name: "default", args: [] },
  { name: "--isolate", args: ["--isolate"] },
  { name: "--parallel", args: ["--parallel"] },
])("test timeout keeps processes spawned before the test ($name)", async ({ args }) => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...args, path.join(import.meta.dir, "process-kill-only-own-fixture.ts")],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const combined = out + err;
  expect(combined).toContain("killed 1 dangling process");
  expect(combined).toContain("(fail) test timeout kills the processes this test spawned");
  expect(combined).toContain("(pass) processes spawned before the test survive its timeout");
  expect(exitCode).toBe(1);
});
