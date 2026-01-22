import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/26371
// Minified bundler output missing semicolon between statements when
// using both default and named imports from "bun" module

test("minified bun import with default and named imports produces valid syntax", async () => {
  using dir = tempDir("issue-26371", {
    "index.ts": `import bun, { embeddedFiles } from "bun"
console.log(typeof embeddedFiles)
console.log(typeof bun.argv)
`,
  });

  // Build with minification
  await using buildProc = Bun.spawn({
    cmd: [bunExe(), "build", "--minify", "--target=bun", "--outdir=dist", "index.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [buildStdout, buildStderr, buildExitCode] = await Promise.all([
    buildProc.stdout.text(),
    buildProc.stderr.text(),
    buildProc.exited,
  ]);

  expect(buildStdout).toContain("index.js");
  expect(buildStderr).not.toContain("error");
  expect(buildExitCode).toBe(0);

  // Run the built output to verify it's valid JavaScript
  await using runProc = Bun.spawn({
    cmd: [bunExe(), "dist/index.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [runStdout, runStderr, runExitCode] = await Promise.all([
    runProc.stdout.text(),
    runProc.stderr.text(),
    runProc.exited,
  ]);

  expect(runStderr).not.toContain("SyntaxError");
  expect(runStdout).toContain("object");
  expect(runExitCode).toBe(0);
});

test("minified bun import with namespace and named imports produces valid syntax", async () => {
  using dir = tempDir("issue-26371-namespace", {
    "index.ts": `import * as bun from "bun"
import { embeddedFiles } from "bun"
console.log(typeof embeddedFiles)
console.log(typeof bun.argv)
`,
  });

  // Build with minification
  await using buildProc = Bun.spawn({
    cmd: [bunExe(), "build", "--minify", "--target=bun", "--outdir=dist", "index.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [buildStdout, buildStderr, buildExitCode] = await Promise.all([
    buildProc.stdout.text(),
    buildProc.stderr.text(),
    buildProc.exited,
  ]);

  expect(buildStdout).toContain("index.js");
  expect(buildStderr).not.toContain("error");
  expect(buildExitCode).toBe(0);

  // Run the built output to verify it's valid JavaScript
  await using runProc = Bun.spawn({
    cmd: [bunExe(), "dist/index.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [runStdout, runStderr, runExitCode] = await Promise.all([
    runProc.stdout.text(),
    runProc.stderr.text(),
    runProc.exited,
  ]);

  expect(runStderr).not.toContain("SyntaxError");
  expect(runStdout).toContain("object");
  expect(runExitCode).toBe(0);
});

test("minified bun import with namespace, default and named imports produces valid syntax", async () => {
  using dir = tempDir("issue-26371-all", {
    "index.ts": `import bun, * as bunNs from "bun"
import { embeddedFiles } from "bun"
console.log(typeof embeddedFiles)
console.log(typeof bun.argv)
console.log(typeof bunNs.argv)
`,
  });

  // Build with minification
  await using buildProc = Bun.spawn({
    cmd: [bunExe(), "build", "--minify", "--target=bun", "--outdir=dist", "index.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [buildStdout, buildStderr, buildExitCode] = await Promise.all([
    buildProc.stdout.text(),
    buildProc.stderr.text(),
    buildProc.exited,
  ]);

  expect(buildStdout).toContain("index.js");
  expect(buildStderr).not.toContain("error");
  expect(buildExitCode).toBe(0);

  // Run the built output to verify it's valid JavaScript
  await using runProc = Bun.spawn({
    cmd: [bunExe(), "dist/index.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [runStdout, runStderr, runExitCode] = await Promise.all([
    runProc.stdout.text(),
    runProc.stderr.text(),
    runProc.exited,
  ]);

  expect(runStderr).not.toContain("SyntaxError");
  expect(runStdout).toContain("object");
  expect(runExitCode).toBe(0);
});
