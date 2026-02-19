import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/19355
// @__PURE__ annotations inside line comments should not cause
// the next call expression to be removed during runtime execution.
// @__PURE__ is a bundler tree-shaking hint, not a runtime directive.

test("@__PURE__ inside line comment does not strip next call", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `// /* @__PURE__ */\n//\nprocess.exit(0);\nconsole.log("hiii");`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("");
  expect(exitCode).toBe(0);
});

test("// @__PURE__ does not strip next call at runtime", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `// @__PURE__\nprocess.exit(0);\nconsole.log("hiii");`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("");
  expect(exitCode).toBe(0);
});

test("// #__PURE__ does not strip next call at runtime", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `// #__PURE__\nprocess.exit(0);\nconsole.log("hiii");`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("");
  expect(exitCode).toBe(0);
});

test("/* @__PURE__ */ does not strip next call at runtime", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `/* @__PURE__ */ process.exit(0);\nconsole.log("hiii");`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("");
  expect(exitCode).toBe(0);
});

test("@__PURE__ is ignored in --no-bundle mode", async () => {
  const dir = tempDir("pure-no-bundle", {
    "index.js": `// @__PURE__\nconsole.log("hello");\nconsole.log("world");`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--no-bundle", dir + "/index.js"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // With --no-bundle, @__PURE__ should be ignored (not strip the call)
  expect(stdout).toContain("hello");
  expect(stdout).toContain("world");
  expect(exitCode).toBe(0);
});
