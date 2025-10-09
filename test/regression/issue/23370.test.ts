import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

test("cat should not panic on delayed reader chunks (issue #23370)", async () => {
  const dir = tempDirWithFiles("cat-race", {
    "file1.txt": "a".repeat(1024 * 1024), // 1MB
    "file2.txt": "b".repeat(1024 * 1024), // 1MB
    "file3.txt": "c".repeat(1024 * 1024), // 1MB
    "test.js": `
      const { $ } = require("bun");
      await $\`cat file1.txt file2.txt file3.txt\`;
    `,
  });

  const proc = Bun.spawn({
    cmd: [bunExe(), "test.js"],
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [exitCode, stderr] = await Promise.all([proc.exited, proc.stderr.text()]);

  expect(stderr).not.toContain("panic");
  expect(stderr).not.toContain("Invalid state");
  expect(exitCode).toBe(0);
}, 10000);

test("cat in package script should not panic", async () => {
  const dir = tempDirWithFiles("cat-pkgscript", {
    "file.txt": "x".repeat(1024 * 1024), // 1MB
    "package.json": JSON.stringify({
      name: "test",
      scripts: {
        test: "cat file.txt",
      },
    }),
  });

  const proc = Bun.spawn({
    cmd: [bunExe(), "run", "test"],
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [exitCode, stderr] = await Promise.all([proc.exited, proc.stderr.text()]);

  expect(stderr).not.toContain("panic");
  expect(stderr).not.toContain("Invalid state");
  expect(exitCode).toBe(0);
}, 10000);
