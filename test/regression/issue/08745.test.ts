import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/8745
// Raw tagged template literals should preserve non-ASCII characters verbatim,
// not convert them to \uXXXX escape sequences.

test("raw template literal preserves non-ASCII characters", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "function what({ raw }) { console.log(JSON.stringify(raw)); } what`弟気`"],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe('["弟気"]');
  expect(exitCode).toBe(0);
});

test("raw template literal non-ASCII characters have correct length", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "function what({ raw }) { console.log(raw[0].length); } what`弟気`"],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("2");
  expect(exitCode).toBe(0);
});

test("String.raw preserves non-ASCII characters", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "console.log(String.raw`弟気`)"],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("弟気");
  expect(exitCode).toBe(0);
});

test("raw template literal with mixed ASCII and non-ASCII", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "function what({ raw }) { console.log(JSON.stringify(raw)); } what`hello弟気world`"],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe('["hello弟気world"]');
  expect(exitCode).toBe(0);
});

test("raw template literal with emoji characters", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "function what({ raw }) { console.log(JSON.stringify(raw)); } what`🍕🎉`"],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe('["🍕🎉"]');
  expect(exitCode).toBe(0);
});

test("raw template literal with interpolation and non-ASCII", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "function what({ raw }) { console.log(JSON.stringify(raw)); } what`弟${1}気`"],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe('["弟","気"]');
  expect(exitCode).toBe(0);
});
