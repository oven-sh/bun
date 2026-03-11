import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("seq inf does not hang", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `import { $ } from "bun"; $.throws(false); const r = await $\`seq inf\`; process.exit(r.exitCode)`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("invalid argument");
  expect(exitCode).toBe(1);
}, 10_000);

test("seq nan does not hang", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `import { $ } from "bun"; $.throws(false); const r = await $\`seq nan\`; process.exit(r.exitCode)`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("invalid argument");
  expect(exitCode).toBe(1);
}, 10_000);

test("seq -inf does not hang", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `import { $ } from "bun"; $.throws(false); const r = await $\`seq -- -inf\`; process.exit(r.exitCode)`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("invalid argument");
  expect(exitCode).toBe(1);
}, 10_000);

test('[[ -d "" ]] does not crash', async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `import { $ } from "bun"; $.throws(false); const r = await $\`[[ -d "" ]]\`; process.exit(r.exitCode)`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(1);
}, 10_000);

test('[[ -f "" ]] does not crash', async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `import { $ } from "bun"; $.throws(false); const r = await $\`[[ -f "" ]]\`; process.exit(r.exitCode)`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(1);
}, 10_000);
