import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/30298
//
// Node reports stack trace filenames for ES module frames as `file://` URLs,
// while CJS frames use an absolute filesystem path. Bun previously used the
// absolute path for both, diverging from Node's v8 stack trace shape
// (https://nodejs.org/api/errors.html#errorstack). This affects both the
// rendered `Error.stack` text and the `CallSite.getFileName()` method exposed
// via `Error.prepareStackTrace`.
describe.concurrent("issue/30298 — ESM stack frames use file:// URLs", () => {
  test("Error.stack top frame for .mjs entrypoint uses file:// URL", async () => {
    using dir = tempDir("30298-stack-top", {
      "foo.mjs": `console.log(new Error().stack);\n`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "foo.mjs"],
      env: bunEnv,
      cwd: String(dir),
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(exitCode).toBe(0);
    const lines = stdout.trim().split("\n");
    expect(lines[0]).toBe("Error");
    // First frame must be a file:// URL, not a raw path.
    expect(lines[1]).toMatch(/^ {4}at file:\/\/.+\/foo\.mjs:1:\d+$/);
  });

  test("Error.stack uses file:// URL for function frame declared in ESM", async () => {
    using dir = tempDir("30298-stack-function", {
      "func.mjs": `function doIt() { throw new Error("boom"); }\ntry { doIt(); } catch (e) { console.log(e.stack); }\n`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "func.mjs"],
      env: bunEnv,
      cwd: String(dir),
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(exitCode).toBe(0);
    // Every file frame in an ESM-rooted trace should be a file:// URL.
    const frameLines = stdout
      .trim()
      .split("\n")
      .slice(1) // drop "Error: boom"
      .filter(l => l.includes("func.mjs"));
    expect(frameLines.length).toBeGreaterThan(0);
    for (const line of frameLines) {
      expect(line).toContain("file://");
      expect(line).toContain("func.mjs");
    }
  });

  test("CallSite.getFileName() returns file:// URL for ESM frame", async () => {
    using dir = tempDir("30298-callsite-getfilename", {
      "bar.mjs": `
        const dummy = {};
        const oldErrorPrepareStackTrace = Error.prepareStackTrace;
        Error.prepareStackTrace = (_, callsites) => callsites;
        Error.captureStackTrace(dummy);
        const stack = dummy.stack;
        Error.prepareStackTrace = oldErrorPrepareStackTrace;
        console.log(stack[0].getFileName());
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "bar.mjs"],
      env: bunEnv,
      cwd: String(dir),
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(exitCode).toBe(0);
    const fileName = stdout.trim();
    expect(fileName.startsWith("file://")).toBe(true);
    expect(fileName.endsWith("/bar.mjs")).toBe(true);
  });

  test("CJS frames still use absolute paths (not file:// URLs)", async () => {
    using dir = tempDir("30298-cjs-untouched", {
      "foo.cjs": `console.log(new Error().stack);\n`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "foo.cjs"],
      env: bunEnv,
      cwd: String(dir),
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(exitCode).toBe(0);
    const lines = stdout.trim().split("\n");
    expect(lines[0]).toBe("Error");
    // CJS frame should be a raw path, no file:// scheme.
    expect(lines[1]).toMatch(/^ {4}at <anonymous> \(\/.+\/foo\.cjs:1:\d+\)$/);
    expect(lines[1]).not.toContain("file://");
  });

  test("CJS frame calling into ESM: CJS frame is raw path, ESM frame is file:// URL", async () => {
    using dir = tempDir("30298-mixed", {
      "sub.mjs": `export function foo() { console.log(new Error().stack); }\n`,
      "entry.cjs": `(async () => { const m = await import("./sub.mjs"); m.foo(); })();\n`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.cjs"],
      env: bunEnv,
      cwd: String(dir),
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(exitCode).toBe(0);
    const out = stdout.trim();
    // ESM frame must be file:// URL.
    expect(out).toMatch(/at foo \(file:\/\/.+\/sub\.mjs:1:\d+\)/);
    // CJS frame must NOT be wrapped in file://.
    const cjsLine = out.split("\n").find(l => l.includes("entry.cjs"));
    expect(cjsLine).toBeDefined();
    expect(cjsLine!).not.toContain("file://");
  });

  test("getFileName() for CJS frame stays as absolute path", async () => {
    using dir = tempDir("30298-callsite-cjs", {
      "bar.cjs": `
        const dummy = {};
        const oldErrorPrepareStackTrace = Error.prepareStackTrace;
        Error.prepareStackTrace = (_, callsites) => callsites;
        Error.captureStackTrace(dummy);
        const stack = dummy.stack;
        Error.prepareStackTrace = oldErrorPrepareStackTrace;
        console.log(stack[0].getFileName());
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "bar.cjs"],
      env: bunEnv,
      cwd: String(dir),
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(exitCode).toBe(0);
    const fileName = stdout.trim();
    expect(fileName.startsWith("file://")).toBe(false);
    expect(fileName.endsWith("/bar.cjs")).toBe(true);
  });
});
