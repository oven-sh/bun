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

// What the native printer shows for an uncaught error is where the *error* came
// from — its own frames, or failing that its `.stack` — and only falls back to
// where the JSC::Exception was thrown when the error carries neither.
describe("native error printer describes an uncaught error by its origin", () => {
  async function run(fixture: Record<string, string>, entry: string) {
    using dir = tempDir("report-error-origin", fixture);
    await using proc = Bun.spawn({
      cmd: [bunExe(), entry],
      cwd: String(dir),
      env: { ...bunEnv, NO_COLOR: "1", BUN_JSC_showPrivateScriptsInStackTraces: "0" },
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    const frames = stderr
      .replaceAll("\\", "/")
      .split("\n")
      .filter(l => l.trimStart().startsWith("at "))
      .map(l => l.trim().replaceAll(String(dir).replaceAll("\\", "/") + "/", ""));
    return { stderr, frames, exitCode };
  }

  test.concurrent("an error created in one place and thrown from another", async () => {
    const { stderr, frames, exitCode } = await run(
      {
        "main.js": `
          const { EventEmitter } = require("node:events");
          function makeError() { const e = new Error("made here"); e.tag = 1; return e; }
          const err = makeError();
          if (process.argv[2] === "materialized") void err.stack;
          setImmediate(function rethrowSite() { new EventEmitter().emit("error", err); });
        `,
      },
      "main.js",
    );
    expect(stderr).toContain("error: made here");
    expect(frames[0]).toStartWith("at makeError (main.js:3:");
    expect(frames.join("\n")).not.toContain("rethrowSite");
    expect(frames.join("\n")).not.toContain("emitError");
    expect(exitCode).toBe(1);
  });

  test.concurrent("...also once its frames have been materialized into .stack", async () => {
    const { frames, exitCode } = await run(
      {
        "main.js": `
          function makeError() { const e = new Error("made here"); e.tag = 1; return e; }
          const err = makeError();
          void err.stack;
          setImmediate(function rethrowSite() { throw err; });
        `,
      },
      "main.js",
    );
    expect(frames[0]).toStartWith("at makeError (main.js:2:");
    expect(frames.join("\n")).not.toContain("rethrowSite");
    expect(exitCode).toBe(1);
  });

  test.concurrent("an error whose only location is an assigned .stack (e.g. after structuredClone)", async () => {
    const { stderr, frames, exitCode } = await run(
      {
        "origin.js": `// line 1\nexports.boom = function boom() { null.foo; };\n`,
        "main.js": `
          let err;
          try { require("./origin.js").boom(); } catch (e) { err = structuredClone(e); }
          setImmediate(function rethrowSite() { throw err; });
        `,
      },
      "main.js",
    );
    // The source preview is read back from the file the parsed frame points at.
    expect(stderr).toContain("2 | exports.boom = function boom() { null.foo; };");
    expect(frames[0]).toStartWith("at boom (origin.js:2:");
    expect(frames.join("\n")).not.toContain("rethrowSite");
    expect(exitCode).toBe(1);
  });

  test.concurrent("the throw site is still used for an error with no stack of its own", async () => {
    const { frames, exitCode } = await run(
      {
        "main.js": `
          const err = new Error("no stack");
          void err.stack; // frames -> string
          Object.defineProperty(err, "stack", { value: undefined }); // string -> nothing
          setImmediate(function rethrowSite() { throw err; });
        `,
      },
      "main.js",
    );
    expect(frames[0]).toStartWith("at rethrowSite (main.js:5:");
    expect(exitCode).toBe(1);
  });

  test.concurrent("a thrown BuildMessage prints as the diagnostic, then where it was thrown", async () => {
    const { stderr, frames, exitCode } = await run(
      {
        "bad.js": "// line 1\nconst y = ;\n",
        "main.mjs": `
          const diagnostic = await import("./bad.js").catch(e => e);
          setImmediate(function rethrowSite() { throw diagnostic; });
        `,
      },
      "main.mjs",
    );
    expect(stderr).toContain("2 | const y = ;");
    expect(stderr).toContain("error: Unexpected ;");
    expect(frames).toEqual([
      expect.stringMatching(/^at bad\.js:2:11$/),
      expect.stringMatching(/^at rethrowSite \(main\.mjs:3:/),
    ]);
    expect(exitCode).toBe(1);
  });
});
