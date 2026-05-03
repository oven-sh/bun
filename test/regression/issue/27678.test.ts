import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/27678
// styleText should respect NO_COLOR and FORCE_COLOR environment variables

test("styleText respects NO_COLOR environment variable", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `import { styleText } from "node:util"; console.log(JSON.stringify(styleText("green", "hello")));`,
    ],
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe('"hello"');
  expect(exitCode).toBe(0);
});

test("styleText respects FORCE_COLOR=0 environment variable", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `import { styleText } from "node:util"; console.log(JSON.stringify(styleText("green", "hello")));`,
    ],
    env: { ...bunEnv, FORCE_COLOR: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe('"hello"');
  expect(exitCode).toBe(0);
});

test("styleText respects FORCE_COLOR=1 to enable colors", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `import { styleText } from "node:util"; console.log(JSON.stringify(styleText("green", "hello")));`,
    ],
    env: { ...bunEnv, FORCE_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe('"\\u001b[32mhello\\u001b[39m"');
  expect(exitCode).toBe(0);
});

test("styleText respects NO_COLOR set at runtime via process.env", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `import { styleText } from "node:util"; process.env.NO_COLOR = "1"; console.log(JSON.stringify(styleText("green", "hello")));`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe('"hello"');
  expect(exitCode).toBe(0);
});

test("styleText with validateStream: false ignores NO_COLOR", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `import { styleText } from "node:util"; console.log(JSON.stringify(styleText("green", "hello", { validateStream: false })));`,
    ],
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe('"\\u001b[32mhello\\u001b[39m"');
  expect(exitCode).toBe(0);
});

test("styleText 'none' format returns plain text", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `import { styleText } from "node:util"; console.log(JSON.stringify(styleText("none", "hello")));`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe('"hello"');
  expect(exitCode).toBe(0);
});

test("styleText throws ERR_INVALID_ARG_TYPE for invalid stream", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `import { styleText } from "node:util"; try { styleText("red", "text", { stream: {} }); console.log("no-throw"); } catch(e) { console.log(e.code); }`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("ERR_INVALID_ARG_TYPE");
  expect(exitCode).toBe(0);
});
