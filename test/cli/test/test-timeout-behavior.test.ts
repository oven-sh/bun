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

// Only the processes the timed-out test or hook spawned are killed, not the ones spawned before it.
test.each([
  {
    name: "test",
    fixture: "process-kill-beforeall-fixture.ts",
    failing: "test timeout kills the processes this test spawned",
    passing: "process spawned in beforeAll and beforeEach survives the timeout",
  },
  {
    name: "beforeEach",
    fixture: "process-kill-hook-timeout-fixture.ts",
    failing: "beforeEach times out > hook timeout kills the processes the hook spawned",
    passing: "process spawned in beforeAll survives the hook timeout",
  },
  {
    name: "spawnSync",
    fixture: "process-kill-spawnsync-fixture.ts",
    failing: "test timeout kills the process spawnSync waits for",
    passing: "process spawned in beforeAll survives the timeout",
  },
  {
    name: "--isolate",
    fixture: "process-kill-module-scope-fixture.ts",
    args: ["--isolate"],
    failing: "test timeout kills the processes this test spawned",
    passing: "process spawned at the top of the file survives the timeout",
  },
  {
    name: "--parallel",
    fixture: "process-kill-module-scope-fixture.ts",
    args: ["--parallel"],
    failing: "test timeout kills the processes this test spawned",
    passing: "process spawned at the top of the file survives the timeout",
  },
])("$name timeout keeps processes spawned before it", async ({ fixture, args = [], failing, passing }) => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...args, path.join(import.meta.dir, fixture)],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const combined = out + err;
  expect(combined).toContain("killed 1 dangling process");
  expect(combined).toContain(`(fail) ${failing}`);
  expect(combined).toContain(`(pass) ${passing}`);
  expect(combined).toContain(" 1 pass");
  expect(combined).toContain(" 1 fail");
  expect(exitCode).toBe(1);
});

test("timeouts kill what the timed-out test or hook is responsible for", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", path.join(import.meta.dir, "process-kill-cleanup-fixture.ts")],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const combined = out + err;
  // a stuck afterEach or afterAll kills what its setup started; concurrent tests are killed when their group ends
  expect(combined).toContain("(pass) processes of timed-out tests and hooks are killed");
  // a stale timer doesn't kill the processes of a test without a timeout
  expect(combined).toContain("(pass) a test without a timeout keeps its processes");
  expect(exitCode).toBe(1);
});
