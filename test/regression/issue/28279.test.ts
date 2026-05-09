import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/28279
// On Windows, `import.meta.main` is false when the extension name is omitted
// and the letter case does not strictly match the filename on disk.

test("import.meta.main is true when extension is omitted", async () => {
  using dir = tempDir("issue-28279", {
    "aaa.ts": `console.log(import.meta.main);`,
  });

  // Run without extension
  await using proc = Bun.spawn({
    cmd: [bunExe(), "aaa"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("true");
  expect(exitCode).toBe(0);
});

test("import.meta.main is true when extension is provided", async () => {
  using dir = tempDir("issue-28279", {
    "aaa.ts": `console.log(import.meta.main);`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "aaa.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("true");
  expect(exitCode).toBe(0);
});
