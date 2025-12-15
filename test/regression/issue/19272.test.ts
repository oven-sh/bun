import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "path";

test("bun init --react=shadcn should not have TypeScript errors", async () => {
  using dir = tempDir("issue-19272", {});

  // Create shadcn project
  await using initProc = Bun.spawn({
    cmd: [bunExe(), "init", "--react=shadcn"],
    cwd: String(dir),
    env: bunEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  await initProc.exited;

  // Install TypeScript for type checking
  await using installProc = Bun.spawn({
    cmd: [bunExe(), "add", "--dev", "typescript"],
    cwd: String(dir),
    env: bunEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  await installProc.exited;

  // Run TypeScript compiler to check for errors
  await using tscProc = Bun.spawn({
    cmd: [bunExe(), "x", "tsc", "--noEmit"],
    cwd: String(dir),
    env: bunEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([tscProc.stdout.text(), tscProc.stderr.text(), tscProc.exited]);

  // TypeScript should not report any errors
  expect(stdout).not.toContain("error TS");
  expect(stderr).not.toContain("error TS");
  expect(exitCode).toBe(0);

  // Verify tsconfig excludes build.ts
  const tsconfig = await Bun.file(path.join(String(dir), "tsconfig.json")).json();
  expect(tsconfig.exclude).toContain("build.ts");
}, 60_000);

test("bun init --react=tailwind should not have TypeScript errors", async () => {
  using dir = tempDir("issue-19272-tailwind", {});

  // Create tailwind project
  await using initProc = Bun.spawn({
    cmd: [bunExe(), "init", "--react=tailwind"],
    cwd: String(dir),
    env: bunEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  await initProc.exited;

  // Install TypeScript for type checking
  await using installProc = Bun.spawn({
    cmd: [bunExe(), "add", "--dev", "typescript"],
    cwd: String(dir),
    env: bunEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  await installProc.exited;

  // Run TypeScript compiler to check for errors
  await using tscProc = Bun.spawn({
    cmd: [bunExe(), "x", "tsc", "--noEmit"],
    cwd: String(dir),
    env: bunEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([tscProc.stdout.text(), tscProc.stderr.text(), tscProc.exited]);

  // TypeScript should not report any errors
  expect(stdout).not.toContain("error TS");
  expect(stderr).not.toContain("error TS");
  expect(exitCode).toBe(0);

  // Verify tsconfig excludes build.ts
  const tsconfig = await Bun.file(path.join(String(dir), "tsconfig.json")).json();
  expect(tsconfig.exclude).toContain("build.ts");
}, 60_000);
