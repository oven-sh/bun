import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("bundler should generate valid syntax for void import() expressions - issue #24709", async () => {
  using dir = tempDir("issue-24709", {
    "bug.ts": `export function main() {
      void import("./bug.ts");
    }`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "bug.ts", "--format=esm"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The output should contain valid JavaScript
  // It should NOT contain invalid syntax like `() => )`
  expect(stdout).not.toContain("() => )");

  // When there's nothing to import (self-import with void), it should emit void 0
  expect(stdout).toContain("void 0");

  // The bundled output should be syntactically valid
  // Try to parse it by running it through Bun
  await using parseProc = Bun.spawn({
    cmd: [bunExe(), "-e", stdout],
    env: bunEnv,
    stderr: "pipe",
  });

  const parseExitCode = await parseProc.exited;
  expect(parseExitCode).toBe(0);

  expect(exitCode).toBe(0);
});

test("bundler should preserve import for side effects in void import()", async () => {
  using dir = tempDir("issue-24709-external", {
    "entry.ts": `export function loadModule() {
      void import("some-external-module");
    }`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "entry.ts", "--format=esm", "--external", "some-external-module"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  // External imports should be preserved as actual import() calls
  expect(stdout).toContain('import("some-external-module")');

  expect(exitCode).toBe(0);
});

test("bundler should execute side effects when bundling void import() with multiple files", async () => {
  using dir = tempDir("issue-24709-side-effects", {
    "entry.ts": `export function loadOther() {
      void import("./other.ts");
    }`,
    "other.ts": `console.log("Side effect executed!");
export const value = 42;`,
    "test.ts": `import { loadOther } from "./bundle.js";
loadOther();
await Bun.sleep(0);`,
  });

  // First, bundle entry.ts
  await using buildProc = Bun.spawn({
    cmd: [bunExe(), "build", "entry.ts", "--format=esm", "--outfile=bundle.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  await buildProc.exited;

  // Then run the test to ensure side effects execute
  await using runProc = Bun.spawn({
    cmd: [bunExe(), "test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([runProc.stdout.text(), runProc.exited]);

  // The side effect should have executed
  expect(stdout).toContain("Side effect executed!");

  expect(exitCode).toBe(0);
});
