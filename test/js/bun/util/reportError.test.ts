import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "path";

test("reportError", () => {
  const cwd = import.meta.dir;
  const { stderr } = spawnSync({
    cmd: [bunExe(), join(import.meta.dir, "reportError.ts")],
    cwd,
    env: {
      ...bunEnv,
      // this is default enabled in debug, affects output.
      BUN_JSC_showPrivateScriptsInStackTraces: "0",
    },
  });
  let output = stderr.toString().replaceAll(cwd, "").replaceAll("\\", "/");
  // remove bun version from output
  output = output.split("\n").slice(0, -2).join("\n");

  expect(output.replaceAll("\\", "/").replaceAll("/reportError.ts", "[file]")).toMatchInlineSnapshot(
    `
"1 | reportError(new Error("reportError Test!"));
                    ^
error: reportError Test!
      at [file]:1:17
error: true
true
error: false
false
error: null
null
error: 123
123
error: Infinity
Infinity
error: NaN
NaN
error: NaN
NaN
error

error
Uint8Array(1) [ 0 ]
error
Uint8Array(0) []
error
ArrayBuffer(0) []
error
ArrayBuffer(1) [ 0 ]
error: string
string
error
[]
error
[ 123, null ]
error
{}
error
[
  {}
]
"
`,
  );
});

// Regression: Zig's `bun.String.format` (string.zig:508 → ZigString.zig:609 →
// fmt.zig `formatUTF16Type` → unicode.zig `copyUTF16IntoUTF8`) emits the WTF-8
// bytes for an unpaired surrogate as the replacement char EF BF BD and writes
// them byte-safely. The Rust `Display for bun.String` (bun_core/string/mod.rs)
// instead does `core::str::from_utf8_unchecked` on the result of
// `to_utf8_without_ref()` — if that ever yields a non-UTF-8 byte (e.g. raw
// WTF-8 ED A0 80 from `toUTF8Alloc`, see immutable.zig:2312), formatting is UB.
// This pins the Zig-observable contract: an uncaught Error whose message AND a
// stack-frame function name both contain a lone surrogate must (a) not crash
// the printer and (b) render each lone surrogate as exactly U+FFFD (EF BF BD).
test("native error printer handles lone surrogates in message and stack frame name as U+FFFD", async () => {
  // The fixture is built so the surrogate is *between* ASCII sentinels — that
  // way we can assert the exact byte sequence regardless of ANSI coloring or
  // path formatting around it.
  const fixture = String.raw`
    function thrower() { throw new Error("MSG_PRE\uD800MSG_POST"); }
    // Force the native ZigStackFrame NameFormatter path: give the frame a
    // function_name containing a lone high surrogate. (src/jsc/ZigStackFrame.zig
    // NameFormatter.format -> "{f}" on bun.String)
    Object.defineProperty(thrower, "name", { value: "FN_PRE\uD800FN_POST" });
    thrower();
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: { ...bunEnv, GITHUB_ACTIONS: undefined, CI: undefined, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderrBuf, exitCode] = await Promise.all([
    new Response(proc.stderr).arrayBuffer().then(b => Buffer.from(b)),
    proc.exited,
  ]);

  // U+FFFD encoded as UTF-8.
  const FFFD = Buffer.from([0xef, 0xbf, 0xbd]);
  // Raw WTF-8 encoding of U+D800 — *never* valid UTF-8. If this appears,
  // the Rust Display path fed non-UTF-8 bytes through from_utf8_unchecked.
  const WTF8_D800 = Buffer.from([0xed, 0xa0, 0x80]);

  // Zig spec: message line is printed via `printErrorNameAndMessage`
  // (VirtualMachine.zig) using `{f}` on the bun.String, yielding EF BF BD.
  const wantMsg = Buffer.concat([Buffer.from("MSG_PRE"), FFFD, Buffer.from("MSG_POST")]);
  expect(stderrBuf.indexOf(wantMsg)).toBeGreaterThanOrEqual(0);

  // Zig spec: stack frame name is printed via NameFormatter `{f}` on the
  // bun.String, yielding EF BF BD.
  const wantFn = Buffer.concat([Buffer.from("FN_PRE"), FFFD, Buffer.from("FN_POST")]);
  expect(stderrBuf.indexOf(wantFn)).toBeGreaterThanOrEqual(0);

  // Must NOT contain raw WTF-8 surrogate bytes anywhere in the output.
  expect(stderrBuf.indexOf(WTF8_D800)).toBe(-1);

  // Printer must not have crashed: normal uncaught-error exit (1), no signal.
  expect(proc.signalCode).toBeNull();
  expect(exitCode).toBe(1);
});

// https://github.com/oven-sh/bun/issues/32390
// When user code assigns a custom string to `error.stack`, the error-printing
// paths (uncaught exception, console.log/console.error, Bun.inspect) must use
// that string verbatim instead of regenerating a trace, matching Node.
describe.concurrent("custom Error.stack string", () => {
  const CUSTOM_STACK = "oh no\nSome very useful information about the origin of the error";
  // The second line is never present in Bun's regenerated output, so its
  // presence proves the custom value was used; "error: oh no" / "  at " are
  // only emitted by the regenerated trace the bug produced.
  const UNIQUE_LINE = "Some very useful information about the origin of the error";

  test("uncaught exception prints the user-assigned stack string", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `const e = new Error("oh no"); e.stack = ${JSON.stringify(CUSTOM_STACK)}; throw e;`],
      env: { ...bunEnv, NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain(UNIQUE_LINE);
    expect(stderr).not.toContain("error: oh no");
    expect(stderr).not.toContain("  at ");
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  });

  test("console.log and console.error use the user-assigned stack string", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const e = new Error("oh no"); e.stack = ${JSON.stringify(CUSTOM_STACK)}; console.log(e); console.error(e);`,
      ],
      env: { ...bunEnv, NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain(UNIQUE_LINE);
    expect(stderr).toContain(UNIQUE_LINE);
    expect(stdout).not.toContain("error: oh no");
    expect(exitCode).toBe(0);
  });

  test("Bun.inspect renders a user-assigned stack string verbatim", () => {
    const e = new Error("oh no");
    e.stack = CUSTOM_STACK;
    expect(Bun.inspect(e)).toBe(CUSTOM_STACK + "\n");
  });

  test("a custom stack keeps other own properties like .code", () => {
    // Node prints the custom stack followed by the remaining own properties,
    // so `.code` must still appear even though the stack is rendered verbatim.
    const e = new Error("boom");
    e.code = "ERR_SOMETHING";
    e.stack = "boom\ncustom info";
    const out = Bun.inspect(e);
    expect(out).toContain("custom info");
    expect(out).toContain("ERR_SOMETHING");
  });

  test("a custom stack in V8 frame format is still shown", async () => {
    // When the custom string does parse as frames, that info must survive too.
    const v8Stack = "Error: boom\n    at myFrame (/fake/path.js:99:7)";
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `const e = new Error("boom"); e.stack = ${JSON.stringify(v8Stack)}; throw e;`],
      env: { ...bunEnv, NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("myFrame");
    expect(stderr).toContain("/fake/path.js:99:7");
    expect(exitCode).toBe(1);
  });

  test("an error without a custom stack still shows the generated trace", async () => {
    // Guards against the custom-stack path leaking into normal errors.
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `throw new Error("plain error");`],
      env: { ...bunEnv, NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("error: plain error");
    expect(stderr).toContain(" at ");
    expect(exitCode).toBe(1);
  });

  test("stackTraceLimit = 0 keeps the generated format and .code", async () => {
    // With Error.stackTraceLimit = 0, `.stack` is undefined (not a string), so
    // the custom-stack path must not trigger; the error keeps its normal
    // rendering and the .code annotation is still printed.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `Error.stackTraceLimit = 0; const e = new Error("boom"); e.code = "ERR_SOMETHING"; console.log(e);`,
      ],
      env: { ...bunEnv, NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("boom");
    expect(stdout).toContain("ERR_SOMETHING");
    expect(exitCode).toBe(0);
  });
});
