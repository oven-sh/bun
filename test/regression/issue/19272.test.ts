import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "path";

test.concurrent.each([
  { template: "shadcn", dirName: "issue-19272-shadcn" },
  { template: "tailwind", dirName: "issue-19272-tailwind" },
])("bun init --react=$template should not have TypeScript errors", async ({ template, dirName }) => {
  using dir = tempDir(dirName, {});

  // Create React project with specified template
  await using initProc = Bun.spawn({
    cmd: [bunExe(), "init", `--react=${template}`],
    cwd: String(dir),
    env: bunEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const [initStdout, initStderr, initExitCode] = await Promise.all([
    initProc.stdout.text(),
    initProc.stderr.text(),
    initProc.exited,
  ]);
  expect(initExitCode, `Init failed for ${template} template.\nstdout: ${initStdout}\nstderr: ${initStderr}`).toBe(0);

  // Install TypeScript for type checking
  await using installProc = Bun.spawn({
    cmd: [bunExe(), "add", "--dev", "typescript"],
    cwd: String(dir),
    env: bunEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const [installStdout, installStderr, installExitCode] = await Promise.all([
    installProc.stdout.text(),
    installProc.stderr.text(),
    installProc.exited,
  ]);
  expect(
    installExitCode,
    `TypeScript install failed for ${template} template.\nstdout: ${installStdout}\nstderr: ${installStderr}`,
  ).toBe(0);

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
  expect(
    exitCode,
    `TypeScript compilation failed for ${template} template.\nstdout: ${stdout}\nstderr: ${stderr}`,
  ).toBe(0);

  // Verify tsconfig excludes build.ts
  const tsconfigPath = path.join(String(dir), "tsconfig.json");
  expect(await Bun.file(tsconfigPath).exists()).toBe(true);
  const tsconfig = await Bun.file(tsconfigPath).json();
  expect(Array.isArray(tsconfig.exclude)).toBe(true);
  expect(tsconfig.exclude).toContain("build.ts");
});
