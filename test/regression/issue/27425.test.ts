import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/27425
// import.meta in .cjs files should throw a SyntaxError, matching Node.js behavior

test("import.meta in .cjs file throws a SyntaxError", async () => {
  using dir = tempDir("issue-27425-simple", {
    "simple.cjs": `console.log(import.meta.url);`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "simple.cjs"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("Cannot use 'import.meta' outside a module");
  expect(exitCode).not.toBe(0);
});

test("import.meta in .cjs file with CJS features throws a SyntaxError", async () => {
  using dir = tempDir("issue-27425-cjs-features", {
    "foo.cjs": `
Object.defineProperty(exports, "__esModule", { value: true });
const module_1 = require('module');
const require2 = (0, module_1.createRequire)(import.meta.url);
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "foo.cjs"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("Cannot use 'import.meta' outside a module");
  expect(exitCode).not.toBe(0);
});

test("import.meta in .cjs file caught by require() throws a SyntaxError", async () => {
  using dir = tempDir("issue-27425-require", {
    "foo.cjs": `
Object.defineProperty(exports, "__esModule", { value: true });
const module_1 = require('module');
const require2 = (0, module_1.createRequire)(import.meta.url);
`,
    "bar.cjs": `
try {
  require('./foo.cjs');
  console.log('no error');
} catch (err) {
  console.log('got an error', err.constructor.name);
}
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "bar.cjs"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("got an error");
  expect(stdout).not.toContain("no error");
});

test("import.meta in .cts file throws a SyntaxError", async () => {
  using dir = tempDir("issue-27425-cts", {
    "simple.cts": `console.log(import.meta.url);`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "simple.cts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("Cannot use 'import.meta' outside a module");
  expect(exitCode).not.toBe(0);
});

test("import.meta in .mjs file still works", async () => {
  using dir = tempDir("issue-27425-mjs", {
    "simple.mjs": `console.log(typeof import.meta.url);`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "simple.mjs"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("string");
  expect(exitCode).toBe(0);
});
