import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/11100
// `using` syntax should work in CommonJS modules

test("using works in .cjs file", async () => {
  using dir = tempDir("issue-11100", {
    "test.cjs": `
using server = { [Symbol.dispose]() { console.log("disposed"); } };
console.log("hello");
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toBe("hello\ndisposed\n");
  expect(exitCode).toBe(0);
});

test("using works in .js file with require (CJS detection)", async () => {
  using dir = tempDir("issue-11100", {
    "test.js": `
const path = require("path");
using server = { [Symbol.dispose]() { console.log("disposed"); } };
console.log("hello", path.join("a", "b"));
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toContain("hello");
  expect(stdout).toContain("disposed");
  expect(exitCode).toBe(0);
});

test("await using works in .cjs file", async () => {
  using dir = tempDir("issue-11100", {
    "test.cjs": `
async function main() {
  await using server = { [Symbol.asyncDispose]() { console.log("async disposed"); return Promise.resolve(); } };
  console.log("hello");
}
main();
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toBe("hello\nasync disposed\n");
  expect(exitCode).toBe(0);
});

test("bun build --no-bundle emits require for bun:wrap in CJS", async () => {
  using dir = tempDir("issue-11100", {
    "test.cjs": `
using server = { [Symbol.dispose]() { console.log("disposed"); } };
console.log("hello");
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--no-bundle", "test.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Should use require() not import for CJS files
  expect(stdout).toContain("require(");
  expect(stdout).not.toContain("import ");
  expect(exitCode).toBe(0);
});
