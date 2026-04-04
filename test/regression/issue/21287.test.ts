import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("bun build --splitting with --format=cjs should error, not crash", async () => {
  using dir = tempDir("issue-21287", {
    "shared.ts": `export function sharedFn() { return "shared"; }`,
    "entry1.ts": `import { sharedFn } from "./shared"; export const a = sharedFn();`,
    "entry2.ts": `import { sharedFn } from "./shared"; export const b = sharedFn();`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "entry1.ts", "entry2.ts", "--splitting", "--format=cjs", "--outdir=out"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("Cannot use");
  expect(stderr).toContain("splitting");
  expect(exitCode).not.toBe(0);
});

test("bun build --splitting with --format=iife should error, not crash", async () => {
  using dir = tempDir("issue-21287", {
    "shared.ts": `export function sharedFn() { return "shared"; }`,
    "entry1.ts": `import { sharedFn } from "./shared"; export const a = sharedFn();`,
    "entry2.ts": `import { sharedFn } from "./shared"; export const b = sharedFn();`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "entry1.ts", "entry2.ts", "--splitting", "--format=iife", "--outdir=out"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("Cannot use");
  expect(stderr).toContain("splitting");
  expect(exitCode).not.toBe(0);
});

test("Bun.build splitting with format cjs should throw", () => {
  using dir = tempDir("issue-21287-api", {
    "entry.ts": `export const a = 1;`,
  });

  expect(() => {
    Bun.build({
      entrypoints: [dir + "/entry.ts"],
      splitting: true,
      format: "cjs",
      outdir: dir + "/out",
    });
  }).toThrow(/splitting/i);
});

test("bun build --splitting with --format=esm should succeed", async () => {
  using dir = tempDir("issue-21287", {
    "shared.ts": `export function sharedFn() { return "shared"; }`,
    "entry1.ts": `import { sharedFn } from "./shared"; export const a = sharedFn();`,
    "entry2.ts": `import { sharedFn } from "./shared"; export const b = sharedFn();`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "entry1.ts", "entry2.ts", "--splitting", "--format=esm", "--outdir=out"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
