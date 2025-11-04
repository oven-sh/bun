import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("issue #8768: describe.todo() doesn't fail when todo test passes", async () => {
  using dir = tempDir("issue-08768", {
    "describe-todo.test.js": `
import { describe, test, expect } from "bun:test";

describe.todo("E", () => {
    test("E", () => { expect("hello").toBe("hello") })
});
    `.trim(),
    "test-todo.test.js": `
import { test, expect } from "bun:test";

test.todo("E", () => { expect("hello").toBe("hello") });
    `.trim(),
  });

  // Run describe.todo() with --todo flag
  await using proc1 = Bun.spawn({
    cmd: [bunExe(), "test", "--todo", "describe-todo.test.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout1, stderr1, exitCode1] = await Promise.all([proc1.stdout.text(), proc1.stderr.text(), proc1.exited]);

  // Run test.todo() with --todo flag for comparison
  await using proc2 = Bun.spawn({
    cmd: [bunExe(), "test", "--todo", "test-todo.test.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout2, stderr2, exitCode2] = await Promise.all([proc2.stdout.text(), proc2.stderr.text(), proc2.exited]);

  // test.todo() correctly fails when the test passes (expected behavior)
  expect(exitCode2).not.toBe(0);
  const output2 = stdout2 + stderr2;
  expect(output2).toContain("todo");
  expect(output2).toMatch(/this test is marked as todo but passes/i);
  expect(exitCode1).toBe(1);

  const output1 = stdout1 + stderr1;
  expect(output1).toContain("todo");
  expect(output1).toMatch(/this test is marked as todo but passes/i);
});
