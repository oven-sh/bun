// Behavior-preservation tests for `createErrorInstance` / `throwPretty` in
// `src/jsc/JSGlobalObject.zig`. These paths share a single `noinline` body
// with a type-erased per-format printer; this test pins the observable
// output so that refactor stays honest.

import { test, expect, describe } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

const ESC = "\x1b";

describe("createErrorInstance message formatting", () => {
  test("TypeError / RangeError / Error messages are formatted with args", async () => {
    const src = `
      const out = [];
      try { require('util').getSystemErrorName('nope'); } catch (e) { out.push(e.constructor.name + ': ' + e.message); }
      try { Buffer.alloc(-1); } catch (e) { out.push(e.constructor.name + ': ' + e.message); }
      try { new TextDecoder('no-such-encoding-xyz'); } catch (e) { out.push(e.constructor.name + ': ' + e.message); }
      process.stdout.write(JSON.stringify(out));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const out = JSON.parse(stdout);
    expect(out).toEqual([
      `TypeError: The "err" argument must be of type number. Received type string ('nope')`,
      `RangeError: The value of "size" is out of range. It must be >= 0 and <= 4294967296. Received -1`,
      `RangeError: Unsupported encoding label "no-such-encoding-xyz"`,
    ]);
    expect(exitCode).toBe(0);
  });
});

describe("throwPretty color handling", () => {
  // `expect(1).toBe(2)` fails via `throwPretty` with a format string that
  // contains <d>/<r>/<green>/<red> markup.
  async function run(extraEnv: Record<string, string | undefined>) {
    using dir = tempDir("throw-pretty", {
      "t.test.ts": `
        import { test, expect } from "bun:test";
        test("t", () => { expect(1).toBe(2); });
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "t.test.ts"],
      env: { ...bunEnv, ...extraEnv },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text()]);
    return stdout + stderr;
  }

  test("NO_COLOR strips all ANSI SGR sequences from the error message", async () => {
    const out = await run({ NO_COLOR: "1", FORCE_COLOR: undefined });
    // The error body must be present...
    expect(out).toContain("expect(received).toBe(expected)");
    expect(out).toContain("Expected: 2");
    expect(out).toContain("Received: 1");
    // ...and contain no escape bytes at all.
    expect(out.includes(ESC)).toBe(false);
  });

  test("FORCE_COLOR keeps ANSI SGR sequences in the error message", async () => {
    const out = await run({ FORCE_COLOR: "1", NO_COLOR: undefined });
    // `received` is wrapped in <red>...</r>; `expected` in <green>...</r>.
    expect(out).toContain(`${ESC}[31mreceived`);
    expect(out).toContain(`${ESC}[32mexpected`);
    expect(out).toContain(`${ESC}[32m2${ESC}[0m`);
    expect(out).toContain(`${ESC}[31m1${ESC}[0m`);
  });

  test("NO_COLOR output matches prettyFmt(fmt, false) exactly for the error body", async () => {
    const out = await run({ NO_COLOR: "1", FORCE_COLOR: undefined });
    // This is the exact text `Output.prettyFmt(fmt, false)` would have
    // produced for the toBe failure format string. It must survive the
    // strip-after-format path unchanged.
    const expectedBody = "expect(received).toBe(expected)\n\nExpected: 2\nReceived: 1\n";
    expect(out).toContain(expectedBody);
  });
});
