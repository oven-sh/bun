// https://github.com/oven-sh/bun/issues/23183
// Test that accessing process.title doesn't crash on Windows
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

test("process.title should not crash on Windows", async () => {
  const proc = Bun.spawn({
    cmd: [bunExe(), "-e", "console.log(typeof process.title)"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    Bun.readableStreamToText(proc.stdout),
    Bun.readableStreamToText(proc.stderr),
    proc.exited,
  ]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  expect(stdout.trim()).toBe("string");
});

test("process.title should return a non-empty string or fallback to 'bun'", async () => {
  const proc = Bun.spawn({
    cmd: [bunExe(), "-e", "console.log(process.title)"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    Bun.readableStreamToText(proc.stdout),
    Bun.readableStreamToText(proc.stderr),
    proc.exited,
  ]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  const title = stdout.trim();
  expect(title.length).toBeGreaterThan(0);
  if (isWindows) {
    // On Windows, we should get either a valid console title or "bun"
    expect(typeof title).toBe("string");
  } else {
    expect(title).toBe("bun");
  }
});
