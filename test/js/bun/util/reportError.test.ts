import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
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

// `AggregateError.prototype.errors` is an own data property, so user code can
// delete it or swap it for something that is not an array. The printer used to
// hand whatever `getDirect` returned straight to JSC's `forEachInIterable`:
// a deleted `errors` yields an empty JSValue (a null cell), which segfaults at
// address 0x5 reading `JSCell::m_type`.
describe("native error printer with a broken AggregateError.errors", () => {
  const mutations: [name: string, source: string][] = [
    ["deleted", `Reflect.deleteProperty(e, "errors");`],
    ["number", `e.errors = 5;`],
    ["undefined", `e.errors = undefined;`],
    ["non-iterable object", `e.errors = {};`],
    ["accessor", `Object.defineProperty(e, "errors", { get: () => [] });`],
    ["self-referential", `e.errors = [e];`],
  ];

  const fixture = (mutation: string, raise: string) =>
    `const e = new AggregateError([], "AGG_MARKER"); ${mutation} ${raise}`;

  describe.each([
    ["uncaught throw", `throw e;`],
    ["unhandled rejection", `Promise.reject(e);`],
  ])("%s", (_entry, raise) => {
    test.each(mutations)("prints the AggregateError when errors is %s", async (_name, mutation) => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", fixture(mutation, raise)],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        proc.stdout.text(),
        proc.stderr.text(),
        proc.exited,
      ]);

      // The error must still reach the user rather than vanishing into the
      // AggregateError fast path.
      expect({ stdout, stderr: stderr.includes("AggregateError: AGG_MARKER") }).toEqual({
        stdout: "",
        stderr: true,
      });
      // Printer must not have crashed: normal uncaught-error exit (1), no signal.
      expect(proc.signalCode).toBeNull();
      expect(exitCode).toBe(1);
    });
  });

  test("bun test reports an unhandled rejection with a deleted errors property", async () => {
    using dir = tempDir("aggregate-error-errors", {
      "agg.test.ts": `
        import { test } from "bun:test";
        test("t", () => {
          const e = new AggregateError([], "AGG_MARKER");
          Reflect.deleteProperty(e, "errors");
          Promise.reject(e);
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "agg.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // The rejection is attributed to the test, so it fails rather than crashing
    // the runner.
    expect({
      aggregate: stderr.includes("AggregateError: AGG_MARKER"),
      failed: stderr.includes("1 fail"),
      stdout,
    }).toEqual({ aggregate: true, failed: true, stdout: expect.stringContaining("bun test") });
    expect(proc.signalCode).toBeNull();
    expect(exitCode).toBe(1);
  });

  test("a well-formed errors array is still unwrapped down to the leaf error", async () => {
    const fixture = `
      let e = new Error("LEAF_MARKER");
      for (let i = 0; i < 5; i++) e = new AggregateError([e], "level-" + i);
      throw e;
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Each AggregateError level prints its children, not itself.
    expect({
      leaf: stderr.includes("error: LEAF_MARKER"),
      aggregate: stderr.includes("AggregateError:"),
      stdout,
    }).toEqual({ leaf: true, aggregate: false, stdout: "" });
    expect(proc.signalCode).toBeNull();
    expect(exitCode).toBe(1);
  });
});
