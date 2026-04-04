import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

test("define should work with optional chaining expressions", async () => {
  using dir = tempDir("issue-7106", {
    "input.js": `console.log(process.env.NODE_ENV);
console.log(process.env?.NODE_ENV);
console.log(process?.env?.NODE_ENV);
console.log(process?.env.NODE_ENV);`,
  });

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "build",
      "--transform",
      "--define",
      'process.env.NODE_ENV="production"',
      join(String(dir), "input.js"),
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");

  // All optional chaining variants should be replaced by the define value
  expect(stdout).toContain('"production"');
  expect(stdout).not.toContain("process.env?.NODE_ENV");
  expect(stdout).not.toContain("process?.env?.NODE_ENV");
  expect(stdout).not.toContain("process?.env.NODE_ENV");
  expect(exitCode).toBe(0);
});

test("define should work with bracket notation and optional chaining", async () => {
  using dir = tempDir("issue-7106-2", {
    "input.js": `console.log(a.b.c);
console.log(a?.b.c);
console.log(a.b?.c);
console.log(a?.b?.c);`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--transform", "--define", 'a.b.c="replaced"', join(String(dir), "input.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  // All variants should be replaced
  expect(stdout).not.toContain("a.b.c");
  expect(stdout).not.toContain("a?.b.c");
  expect(stdout).not.toContain("a.b?.c");
  expect(stdout).not.toContain("a?.b?.c");
  expect(exitCode).toBe(0);
});
