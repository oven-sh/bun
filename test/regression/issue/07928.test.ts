// https://github.com/oven-sh/bun/issues/7928
// A '?' in a directory name was being treated as a query-string separator by
// the module resolver/loader, so files under that directory could not be
// loaded. Windows does not allow '?' in path names, so these tests only run on
// POSIX.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, normalizeBunSnapshot, tempDir } from "harness";

test.skipIf(isWindows)("`bun test` runs tests from a directory whose name contains '?'", async () => {
  using dir = tempDir("issue-7928-test", {
    "some-path?/my.test.js": `
      import { test, expect } from "bun:test";
      test("inside dir with ?", () => { expect(1 + 1).toBe(2); });
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "my.test.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const out = normalizeBunSnapshot(stdout + stderr, dir);
  expect(out).toContain("(pass) inside dir with ?");
  expect(out).toContain("1 pass");
  expect(out).not.toContain("Module not found");
  expect(out).not.toContain("FileNotFound");
  expect(exitCode).toBe(0);
});

test.skipIf(isWindows)("`bun <file>` runs a file under a directory whose name contains '?'", async () => {
  using dir = tempDir("issue-7928-run", {
    "some-path?/main.js": `console.log("ran from dir with ?");`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "./some-path?/main.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("ran from dir with ?\n");
  expect(exitCode).toBe(0);
});

test.skipIf(isWindows)("import resolves across a directory whose name contains '?'", async () => {
  using dir = tempDir("issue-7928-import", {
    "dir?/dep.js": `export const value = 42;`,
    "dir?/entry.js": `
      import { value } from "./dep.js";
      console.log(JSON.stringify({ value, url: import.meta.url }));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "./dir?/entry.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const { value, url } = JSON.parse(stdout.trim());
  expect(value).toBe(42);
  expect(decodeURIComponent(url)).toEndWith("dir?/entry.js");
  expect(exitCode).toBe(0);
});

test.skipIf(isWindows)("query-string suffix still works when a parent directory contains '?'", async () => {
  using dir = tempDir("issue-7928-query", {
    "dir?/dep.js": `export const url = import.meta.url;`,
    "dir?/entry.js": `
      const a = await import("./dep.js");
      const b = await import("./dep.js?v=1");
      console.log(JSON.stringify({ a: a.url, b: b.url, distinct: a !== b }));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "./dir?/entry.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const { a, b, distinct } = JSON.parse(stdout.trim());
  expect(decodeURIComponent(a)).toEndWith("dir?/dep.js");
  expect(decodeURIComponent(b)).toEndWith("dir?/dep.js?v=1");
  expect(distinct).toBe(true);
  expect(exitCode).toBe(0);
});
