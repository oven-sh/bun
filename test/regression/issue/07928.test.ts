// https://github.com/oven-sh/bun/issues/7928
// A '?' in a directory name was being treated as a query-string separator by
// the module resolver/loader, so files under that directory could not be
// loaded. Windows does not allow '?' in path names, so these tests only run on
// POSIX.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, normalizeBunSnapshot, tempDir } from "harness";
import path from "node:path";

describe.concurrent("issue 7928: '?' in a directory name", () => {
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

  test.skipIf(isWindows)("import resolves and import.meta is correct under a '?'-named directory", async () => {
    using dir = tempDir("issue-7928-import", {
      "dir?/dep.js": `export const value = 42;`,
      "dir?/entry.js": `
      import { value } from "./dep.js";
      console.log(JSON.stringify({
        value,
        url: import.meta.url,
        path: import.meta.path,
        dir: import.meta.dir,
        file: import.meta.file,
      }));
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
    const meta = JSON.parse(stdout.trim());
    expect(meta).toEqual({
      value: 42,
      url: Bun.pathToFileURL(path.join(String(dir), "dir?", "entry.js")).href,
      path: path.join(String(dir), "dir?", "entry.js"),
      dir: path.join(String(dir), "dir?"),
      file: "entry.js",
    });
    expect(new URL(meta.url).pathname).toEndWith("dir%3F/entry.js");
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

  test("query string containing '/' still splits at the '?'", async () => {
    using dir = tempDir("issue-7928-slash-in-query", {
      "dep.js": `export const url = import.meta.url;`,
      "entry.js": `
      const m = await import("./dep.js?path=/a/b");
      console.log(JSON.stringify({ url: m.url }));
    `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const { url } = JSON.parse(stdout.trim());
    expect(decodeURIComponent(url)).toEndWith("dep.js?path=/a/b");
    expect(exitCode).toBe(0);
  });

  test.skipIf(isWindows)("require('./x.node') under a '?'-named directory reaches process.dlopen", async () => {
    using dir = tempDir("issue-7928-napi", {
      "dir?/addon.node": "",
      "dir?/entry.cjs": `
      const out = [];
      for (const spec of ["./addon.node", "./addon.node?v=1"]) {
        try { require(spec); out.push(null); }
        catch (e) { out.push(e.constructor.name + ": " + e.message); }
      }
      console.log(JSON.stringify(out));
    `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "./dir?/entry.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const [plain, withQuery] = JSON.parse(stdout.trim());
    // An empty .node file can't be dlopen'd; both spellings must fail with the
    // same dlopen error (proving the '?' in the directory name reached dlopen as
    // part of the path, not as a query separator).
    expect(plain).not.toContain("Node-API");
    expect(plain).not.toContain("Module not found");
    expect(withQuery).toBe(plain);
    expect(exitCode).toBe(0);
  });

  // Pin the accepted trade-off: on POSIX a '?' immediately followed by '/' is a
  // path byte, so a query string that literally begins with '/' is not split.
  // Windows has no such ambiguity ('?' is invalid in paths) and keeps splitting.
  test("import('./dep.js?/x') treats ?/ as a path byte on POSIX", async () => {
    using dir = tempDir("issue-7928-query-leading-slash", {
      "dep.js": `export const url = import.meta.url;`,
      "entry.js": `
      try {
        const m = await import("./dep.js?/x");
        console.log(JSON.stringify({ ok: true, url: m.url }));
      } catch (e) {
        console.log(JSON.stringify({ ok: false, msg: String(e) }));
      }
    `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const out = JSON.parse(stdout.trim());
    if (isWindows) {
      expect(out.ok).toBe(true);
      expect(decodeURIComponent(out.url)).toEndWith("dep.js?/x");
    } else {
      expect(out.ok).toBe(false);
    }
    expect(exitCode).toBe(0);
  });
});
