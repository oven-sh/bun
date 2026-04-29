import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/18919
test("fs.watch works after previous watcher is closed", async () => {
  using dir = tempDir("issue-18919", {
    "test.txt": "A",
  });

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const fs = require('fs');
const path = require('path');
const file = path.join(process.cwd(), 'test.txt');

const watcher_first = fs.watch(file, () => {
  console.log('File changed');
  watcher_first.close();

  const watcher_second = fs.watch(file, () => {
    console.log('File changed again');
    watcher_second.close();
  });

  setTimeout(() => {
    fs.writeFileSync(file, 'C');
  }, 200);
});

setTimeout(() => {
  fs.writeFileSync(file, 'B');
}, 200);
`,
    ],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("File changed");
  expect(stdout).toContain("File changed again");
  expect(exitCode).toBe(0);
}, 10_000);
