import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/25234
// Console output should use single quotes when string contains double quotes
// to avoid ugly escaping like: "{\"test\":{\"pretty\":\"pretty\"}}"

test("console.log uses single quotes for strings containing double quotes", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", 'console.log({ test: JSON.stringify({ test: { pretty: "pretty" } }) });'],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Should use single quotes to avoid escaping double quotes
  expect(stdout).toContain("'");
  expect(stdout).not.toContain('\\"');
  expect(exitCode).toBe(0);
});

test("console.log uses double quotes for strings containing single quotes", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `console.log({ a: "hello 'world'" });`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Should use double quotes to avoid escaping single quotes
  expect(stdout).toContain("\"hello 'world'\"");
  expect(exitCode).toBe(0);
});

test("console.log uses double quotes by default", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", 'console.log({ a: "hello world" });'],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Default should be double quotes
  expect(stdout).toContain('"hello world"');
  expect(exitCode).toBe(0);
});
