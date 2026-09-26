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

// The uncaught exception printer used to recurse into a deeply nested value
// until the native stack overflowed and the process died with SIGSEGV. Each
// shape recurses through a different path: arrays through the value formatter,
// a Proxy through its target (a tag the formatter does not track for circular
// references), error.cause through the error printer itself.
describe("native error printer survives a deeply nested uncaught value", () => {
  // Depths are sized so that an unfixed printer overflows on every platform,
  // including the 18 MB main thread stack of the macOS and Windows builds (Linux
  // has 8 MB): a release build spends at least about 175 bytes of stack per
  // array or Proxy level, so 18 MB holds at most about 105k of them, and
  // several KB per error level. A fixed printer stops at the stack limit, so
  // the depth does not change how much it prints.
  const cases: [name: string, src: string][] = [
    ["throw array", "let a = []; for (let i = 0; i < 150_000; i++) a = [a]; throw a;"],
    ["reject with array", "let a = []; for (let i = 0; i < 150_000; i++) a = [a]; Promise.reject(a);"],
    [
      "throw Proxy chain",
      "const handler = {}; let a = {}; for (let i = 0; i < 150_000; i++) a = new Proxy(a, handler); throw a;",
    ],
    [
      "throw error.cause chain",
      "let e = new Error('root'); for (let i = 0; i < 10_000; i++) e = new Error('wrap', { cause: e }); throw e;",
    ],
  ];

  test.concurrent.each(cases)("%s", async (_, src) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stdout: "ignore",
      // Everything that fits on the stack is still printed. For the array that
      // is hundreds of megabytes of indentation on a release build, so don't
      // pipe it; the assertion is that the printer gave up instead of crashing.
      stderr: "ignore",
    });
    await proc.exited;
    expect(proc.signalCode).toBeNull();
    expect(proc.exitCode).toBe(1);
  });
});
