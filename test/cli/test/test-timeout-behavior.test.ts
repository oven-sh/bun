import { expect, test } from "bun:test";
import { bunEnv, bunExe, isFlaky, isLinux, tempDir } from "harness";
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

test.concurrent("a test with no timeout keeps its processes when the deadline of an earlier test passes", async () => {
  using dir = tempDir("test-no-timeout-keeps-processes", {
    "a.test.ts": `
      import { test } from "bun:test";
      test("has a deadline", () => {}, 50);
      test("has no deadline", async () => {
        const child = Bun.spawn({ cmd: [process.execPath, "-e", "setInterval(() => {}, 100000)"], stdio: ["ignore", "ignore", "ignore"] });
        // The deadline of the first test is earlier than this timer, so the test timer fires first.
        await new Promise(resolve => setTimeout(resolve, 100));
        console.log("alive:", child.exitCode === null && child.signalCode === null);
        child.kill();
      }, 0);
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ alive: stdout.includes("alive: true"), killed: /killed \d+ dangling process/.exec(stderr)?.[0] }).toEqual({
    alive: true,
    killed: undefined,
  });
  expect(exitCode).toBe(0);
});
