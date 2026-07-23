import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

// https://github.com/oven-sh/bun/issues/5206
// `bun build <files> --no-bundle --outdir <dir>` used to fail with
// `error: failed to write file ''` because the transpiled outputs never got a
// destination path. Each entry should be transpiled in place into the outdir.
test("bun build --no-bundle --outdir writes transpiled files", async () => {
  using dir = tempDir("issue-05206", {
    "a.ts": `console.log('hello world!');`,
    "b.ts": `console.log('foo bar baz');`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "a.ts", "b.ts", "--no-bundle", "--outdir", "out"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("failed to write file");

  const aOut = await Bun.file(join(String(dir), "out", "a.js")).text();
  const bOut = await Bun.file(join(String(dir), "out", "b.js")).text();
  expect(aOut).toContain("console.log");
  expect(aOut).toContain("hello world!");
  expect(bOut).toContain("foo bar baz");

  // Surface stderr on failure, then assert the exit code last.
  if (exitCode !== 0) expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("bun build --no-bundle --outdir . transpiles in place", async () => {
  using dir = tempDir("issue-05206-inplace", {
    "a.ts": `export const x: number = 1;`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "a.ts", "--no-bundle", "--outdir", "."],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("failed to write file");

  const out = await Bun.file(join(String(dir), "a.js")).text();
  expect(out).toContain("export const x = 1");

  // Surface stderr on failure, then assert the exit code last.
  if (exitCode !== 0) expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
