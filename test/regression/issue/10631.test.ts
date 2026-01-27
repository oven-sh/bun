import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/10631
// When code splitting is enabled and a file is both an entry point and imported
// by another entry point, the bundler was generating duplicate export statements.
test("code splitting does not produce duplicate exports when entry point is also imported", async () => {
  using dir = tempDir("issue-10631", {
    "index.ts": `import { logStuff } from "./other";
logStuff();`,
    "other.ts": `export function logStuff() {
  console.log("Logging Stuff");
};`,
  });

  // Bundle with splitting enabled
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "index.ts", "other.ts", "--outdir=dist/", "--target=bun", "--splitting"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);

  // Read the generated other.js file
  const otherJs = await Bun.file(`${dir}/dist/other.js`).text();

  // Count how many times "export {" appears - should be exactly once
  const exportMatches = otherJs.match(/export\s*\{/g);
  expect(exportMatches?.length).toBe(1);

  // Verify the file can be executed without errors
  await using execProc = Bun.spawn({
    cmd: [bunExe(), `${dir}/dist/index.js`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [execStdout, execStderr, execExitCode] = await Promise.all([
    execProc.stdout.text(),
    execProc.stderr.text(),
    execProc.exited,
  ]);

  expect(execStdout).toBe("Logging Stuff\n");
  expect(execStderr).toBe("");
  expect(execExitCode).toBe(0);
});

test("code splitting works correctly with multiple cross-chunk imports", async () => {
  using dir = tempDir("issue-10631-multi", {
    "entry1.ts": `import { shared } from "./shared";
console.log("entry1:", shared());`,
    "entry2.ts": `import { shared } from "./shared";
console.log("entry2:", shared());`,
    "shared.ts": `export function shared() {
  return "shared value";
}`,
  });

  // Bundle with splitting enabled
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "entry1.ts", "entry2.ts", "--outdir=dist/", "--target=bun", "--splitting"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);

  // Verify entry1 works
  await using exec1 = Bun.spawn({
    cmd: [bunExe(), `${dir}/dist/entry1.js`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [exec1Stdout, exec1Stderr, exec1ExitCode] = await Promise.all([
    exec1.stdout.text(),
    exec1.stderr.text(),
    exec1.exited,
  ]);

  expect(exec1Stdout).toBe("entry1: shared value\n");
  expect(exec1Stderr).toBe("");
  expect(exec1ExitCode).toBe(0);

  // Verify entry2 works
  await using exec2 = Bun.spawn({
    cmd: [bunExe(), `${dir}/dist/entry2.js`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [exec2Stdout, exec2Stderr, exec2ExitCode] = await Promise.all([
    exec2.stdout.text(),
    exec2.stderr.text(),
    exec2.exited,
  ]);

  expect(exec2Stdout).toBe("entry2: shared value\n");
  expect(exec2Stderr).toBe("");
  expect(exec2ExitCode).toBe(0);
});

test("code splitting with entry point as both exporter and importer", async () => {
  using dir = tempDir("issue-10631-complex", {
    "index.ts": `import { logStuff } from "./other";
logStuff();
export const fromIndex = "index value";`,
    "other.ts": `export function logStuff() {
  console.log("Logging Stuff");
};
export const fromOther = "other value";`,
  });

  // Bundle with splitting enabled, both files as entry points
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "index.ts", "other.ts", "--outdir=dist/", "--target=bun", "--splitting"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);

  // Read the generated other.js file and verify no duplicate exports
  const otherJs = await Bun.file(`${dir}/dist/other.js`).text();
  const exportMatches = otherJs.match(/export\s*\{/g);
  expect(exportMatches?.length).toBe(1);

  // Verify both exports are present in other.js
  expect(otherJs).toContain("logStuff");
  expect(otherJs).toContain("fromOther");

  // Verify index.js can be executed
  await using execProc = Bun.spawn({
    cmd: [bunExe(), `${dir}/dist/index.js`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [execStdout, execStderr, execExitCode] = await Promise.all([
    execProc.stdout.text(),
    execProc.stderr.text(),
    execProc.exited,
  ]);

  expect(execStdout).toBe("Logging Stuff\n");
  expect(execStderr).toBe("");
  expect(execExitCode).toBe(0);
});
