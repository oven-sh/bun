import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/27283
// prompt() should handle multi-byte UTF-8 characters correctly.
test("prompt() handles multi-byte UTF-8 input", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `const input = prompt("Enter:"); process.stderr.write(input);`],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  proc.stdin.write("笨蛋\n");
  await proc.stdin.flush();
  proc.stdin.end();

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("笨蛋");
  expect(exitCode).toBe(0);
});

test("prompt() handles mixed ASCII and multi-byte UTF-8 input", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `const input = prompt("Enter:"); process.stderr.write(input);`],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  proc.stdin.write("hello世界bye\n");
  await proc.stdin.flush();
  proc.stdin.end();

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("hello世界bye");
  expect(exitCode).toBe(0);
});

test("prompt() handles emoji input", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `const input = prompt("Enter:"); process.stderr.write(input);`],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  proc.stdin.write("🎉🚀\n");
  await proc.stdin.flush();
  proc.stdin.end();

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("🎉🚀");
  expect(exitCode).toBe(0);
});
