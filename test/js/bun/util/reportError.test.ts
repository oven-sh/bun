import { spawnSync } from "bun";
import { expect, test } from "bun:test";
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

// The uncaught-error printer used to pass the result of a `getDirect` lookup
// of `AggregateError.errors` straight to the iteration machinery. When the own
// property was deleted, replaced with a non-iterable, or redefined as an
// accessor, it iterated an empty/garbage JSValue: a segfault (or a silently
// swallowed error) instead of the user's actual error. Tampered values must
// fall back to plain error printing.
const tamperedAggregateErrors = [
  ["deleted errors property", 'const e = new AggregateError([], "agg_boom"); delete e.errors; throw e;'],
  ["non-iterable errors value", 'const e = new AggregateError([], "agg_boom"); e.errors = 42; throw e;'],
  [
    "accessor errors property",
    'const e = new AggregateError([], "agg_boom"); Object.defineProperty(e, "errors", { get() { return [new Error("inner")]; } }); throw e;',
  ],
  [
    "unhandled rejection with deleted errors",
    'const e = new AggregateError([], "agg_boom"); delete e.errors; Promise.reject(e);',
  ],
  [
    "poisoned array iterator",
    'const e = new AggregateError([new Error("inner")], "agg_boom"); Object.defineProperty(Array.prototype, Symbol.iterator, { value() { throw new Error("poisoned"); } }); throw e;',
  ],
  [
    "setter-only errors property",
    'const e = new AggregateError([], "agg_boom"); Object.defineProperty(e, "errors", { set(v) {} }); throw e;',
  ],
  [
    "throwing getter on errors property",
    'const e = new AggregateError([], "agg_boom"); Object.defineProperty(e, "errors", { get() { throw new Error("getter_boom"); } }); throw e;',
  ],
  // A cyclic `errors` is an array, so it clears the shape check above: the
  // printer recurses into itself once per level until the native stack dies.
  ["self-referential errors array", 'const e = new AggregateError([], "agg_boom"); e.errors = [e]; throw e;'],
  [
    "mutually recursive errors arrays",
    'const a = new AggregateError([], "agg_boom"); const b = new AggregateError([a], "agg_inner"); a.errors = [b]; throw a;',
  ],
  [
    "unhandled rejection with self-referential errors",
    'const e = new AggregateError([], "agg_boom"); e.errors = [e]; Promise.reject(e);',
  ],
  // Wide cycle: a depth cap alone still visits fan_out^depth nodes, hanging
  // the printer; the shared unwrap budget must bound total work.
  [
    "wide self-referential errors array",
    'const e = new AggregateError([], "agg_boom"); e.errors = Array(8).fill(e); throw e;',
  ],
  // Sparse array: O(1) to build, length-linear to iterate; the per-level
  // length cap must make it fall through instead of walking 1e9 holes.
  [
    "sparse billion-length errors array",
    'const e = new AggregateError([], "agg_boom"); e.errors = Array(1e9); throw e;',
  ],
  // Own non-terminating iterator: indexed access must be used so the
  // user-supplied Symbol.iterator never runs (it would loop forever).
  [
    "own never-done Symbol.iterator on errors",
    'const e = new AggregateError([], "agg_boom"); const a = [new Error("inner")]; a[Symbol.iterator] = () => ({ next: () => ({ value: e, done: false }) }); e.errors = a; throw e;',
  ],
] as const;

test.concurrent.each(tamperedAggregateErrors)(
  "uncaught AggregateError with tampered `errors` does not crash the printer (%s)",
  async (_name, fixture) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: { ...bunEnv, NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // The user's real error is printed (to stderr, like every uncaught error)
    // instead of being replaced by a crash.
    expect(stderr).toContain("agg_boom");
    expect(stdout).toBe("");
    // Normal uncaught-error exit (1), no signal.
    expect(proc.signalCode).toBeNull();
    expect(exitCode).toBe(1);
  },
);

// console.log / Bun.inspect route through the same print_errorlike_object path
// as the uncaught-error printer. On the unfixed build, an accessor `errors`
// makes the formatter feed JSC's internal GetterSetter cell into
// forEachInIterable: debug/ASAN builds abort with
//   ASSERTION FAILED: isSymbol() (JSCJSValue.cpp, synthesizePrototype)
// and release builds throw a bogus "TypeError: Type error" out of console.log.
test.concurrent.each([
  [
    "accessor returning self-reference",
    'Object.defineProperty(e, "errors", { get() { return [e]; }, configurable: true });',
  ],
  ["setter-only accessor", 'Object.defineProperty(e, "errors", { set(v) {}, configurable: true });'],
  ["self-referential data array", "e.errors = [e];"],
] as const)("console.log / Bun.inspect of AggregateError with %s does not throw or crash", async (_name, mutate) => {
  const src = `
      const e = new AggregateError([], "agg_boom");
      ${mutate}
      console.log(e);
      const s = Bun.inspect(e);
      if (typeof s !== "string") throw new Error("Bun.inspect returned " + typeof s);
      process.stdout.write("done\\n");
    `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stderr, endsWithDone: stdout.endsWith("done\n") }).toEqual({ stderr: "", endsWithDone: true });
  expect(stdout).toContain("agg_boom");
  expect(proc.signalCode).toBeNull();
  expect(exitCode).toBe(0);
});

test("uncaught AggregateError with intact `errors` still prints each sub-error", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", 'throw new AggregateError([new Error("inner_a"), new Error("inner_b")], "agg_boom");'],
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Match the printed error headers: the echoed source line also contains the
  // bare marker names, so `toContain("inner_a")` alone can't fail.
  expect(stderr).toContain("error: inner_a");
  expect(stderr).toContain("error: inner_b");
  expect(stdout).toBe("");
  expect(proc.signalCode).toBeNull();
  expect(exitCode).toBe(1);
});

// Past the per-level cap (256), the printer truncates with an elision trailer
// instead of dropping every sub-error.
test("uncaught AggregateError with 300 sub-errors prints the first 256 and an elision trailer", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      'throw new AggregateError(Array.from({ length: 300 }, (_, i) => new Error("sub_" + i)), "agg_boom");',
    ],
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({
    first: stderr.includes("error: sub_0"),
    last: stderr.includes("error: sub_255"),
    truncated: !stderr.includes("error: sub_256"),
    trailer: stderr.includes("44 more errors"),
    stdout,
  }).toEqual({ first: true, last: true, truncated: true, trailer: true, stdout: "" });
  expect(proc.signalCode).toBeNull();
  expect(exitCode).toBe(1);
});

// An empty `errors` array is the untampered shape from `Promise.any([])` and
// `new AggregateError([], msg)`: zero sub-errors used to mean zero output, so
// the AggregateError's own message was swallowed.
test.concurrent.each([
  ["explicit empty AggregateError", 'throw new AggregateError([], "agg_boom");', "AggregateError: agg_boom"],
  // (Bun's Promise.any rejection carries an empty message, so match the header.)
  ["unhandled Promise.any with no promises", "Promise.any([]);", "AggregateError:"],
  // Nullish sub-errors are skipped, so an all-nullish array behaves like an
  // empty one and the AggregateError itself prints.
  [
    "all-nullish errors from Promise.any",
    "Promise.any([Promise.reject(), Promise.reject(null)]);",
    "AggregateError:",
  ],
] as const)(
  "uncaught AggregateError with empty `errors` prints the error itself (%s)",
  async (_name, fixture, expected) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: { ...bunEnv, NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain(expected);
    expect(stdout).toBe("");
    expect(proc.signalCode).toBeNull();
    expect(exitCode).toBe(1);
  },
);

// The depth cap that stops a cyclic `errors` must stay clear of any nesting a
// real program produces.
test("uncaught AggregateError nested several levels deep still unwraps to the leaf error", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      'let e = new Error("leaf_marker"); for (let i = 0; i < 5; i++) e = new AggregateError([e], "level_" + i); throw e;',
    ],
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Each level prints its children, so only the leaf surfaces. (`stderr` echoes
  // the source line, so match on the printed error header, not the bare name.)
  expect({
    leaf: stderr.includes("error: leaf_marker"),
    cappedEarly: stderr.includes("AggregateError: level_"),
    stdout,
  }).toEqual({ leaf: true, cappedEarly: false, stdout: "" });
  expect(proc.signalCode).toBeNull();
  expect(exitCode).toBe(1);
});
