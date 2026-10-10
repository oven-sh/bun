import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
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

// The error printer receives these values through `run_error_handler`. A value
// that is not an `Error` is printed whole, so it follows the `console.log`
// depth (2 by default, `--console-depth`, bunfig `console.depth`) instead of
// the formatter's default depth of 8.
describe("an uncaught value that is not an Error is printed at the console depth", () => {
  // Four object levels. Depth 2 prints `a` and `b` and elides `c`.
  const value = "{ a: { b: { c: { d: 1 } } } }";

  async function run(args: string[], files: Record<string, string> = {}) {
    using dir = tempDir("uncaught-depth", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return {
      stdout: normalizeBunSnapshot(stdout, String(dir)),
      stderr: normalizeBunSnapshot(stderr, String(dir)),
      exitCode,
    };
  }

  const atDepth2 = `error
{
  a: {
    b: {
      c: [Object ...],
    },
  },
}

Bun v<bun-version>`;

  const atDepth3 = `error
{
  a: {
    b: {
      c: {
        d: 1,
      },
    },
  },
}

Bun v<bun-version>`;

  test.concurrent.each([
    ["reportError", `reportError(${value})`],
    ["unhandled rejection", `Promise.reject(${value})`],
    ["uncaught exception", `throw ${value}`],
    ["member of an uncaught AggregateError", `reportError(new AggregateError([${value}]))`],
  ])("%s", async (_, code) => {
    expect(await run(["-e", code])).toEqual({ stdout: "", stderr: atDepth2, exitCode: 1 });
  });

  test.concurrent("--console-depth 1 prints one level", async () => {
    expect(await run(["--console-depth", "1", "-e", `reportError(${value})`])).toEqual({
      stdout: "",
      stderr: `error
{
  a: {
    b: [Object ...],
  },
}

Bun v<bun-version>`,
      exitCode: 1,
    });
  });

  test.concurrent("--console-depth 3 prints three levels", async () => {
    expect(await run(["--console-depth", "3", "-e", `reportError(${value})`])).toEqual({
      stdout: "",
      stderr: atDepth3,
      exitCode: 1,
    });
  });

  test.concurrent("bunfig console.depth = 3 prints three levels", async () => {
    const files = { "bunfig.toml": "[console]\ndepth = 3\n" };
    expect(await run(["-e", `reportError(${value})`], files)).toEqual({
      stdout: "",
      stderr: atDepth3,
      exitCode: 1,
    });
  });

  test.concurrent("--console-depth 0 (unlimited) prints every level", async () => {
    // 12 levels of `o`, more than the formatter's default depth of 8.
    const levels = 12;
    const lines = ["error", "{"];
    for (let i = 1; i <= levels; i++) lines.push(`${"  ".repeat(i)}o: {`);
    lines.push(`${"  ".repeat(levels + 1)}leaf: 1,`);
    for (let i = levels; i >= 1; i--) lines.push(`${"  ".repeat(i)}},`);
    lines.push("}", "", "Bun v<bun-version>");
    const code = `let o = { leaf: 1 }; for (let i = 0; i < ${levels}; i++) o = { o }; reportError(o);`;
    expect(await run(["--console-depth", "0", "-e", code])).toEqual({
      stdout: "",
      stderr: lines.join("\n"),
      exitCode: 1,
    });
  });

  test.concurrent("--console-depth 0 on a value deeper than the stack: the script continues", async () => {
    // The property walk throws a stack overflow RangeError partway down. The
    // printer has to clear it, or reportError() throws it into the script.
    // The partial dump is several MB, so stderr is not captured.
    const code = `
      let o = { leaf: 1 };
      for (let i = 0; i < 20000; i++) o = { o };
      try {
        reportError(o);
        console.log("after");
      } catch (e) {
        console.log("caught " + e.name);
      }
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--console-depth", "0", "-e", code],
      env: bunEnv,
      stdout: "pipe",
      stderr: "ignore",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout).toBe("after\n");
    expect(proc.signalCode).toBeNull();
    expect(exitCode).toBe(1);
  });

  // An Error does not read the console depth: its own properties print at
  // depth 1, and every cause prints. A change that makes more of this output
  // follow the console depth has to update these on purpose.
  test.concurrent("an uncaught Error prints its properties and causes as before", async () => {
    const code = `
      const e = new Error("root", { cause: new Error("c1", { cause: new Error("c2", { cause: new Error("c3") }) }) });
      e.deep = { a: { b: { c: 1 } } };
      throw e;
    `;
    const { stdout, stderr, exitCode } = await run(["-e", code]);
    expect(stderr).toContain("error: root\n deep: {\n  a: [Object ...],\n},\n");
    expect(stderr.split("\n").filter(line => line.startsWith("error: "))).toEqual([
      "error: root",
      "error: c1",
      "error: c2",
      "error: c3",
    ]);
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  });

  test.concurrent("an uncaught AggregateError prints each Error member as before", async () => {
    const code = `throw new AggregateError([new Error("m1"), new Error("m2"), new Error("m3")], "agg");`;
    const { stdout, stderr, exitCode } = await run(["-e", code]);
    expect(stderr.split("\n").filter(line => line.startsWith("error: "))).toEqual([
      "error: m1",
      "error: m2",
      "error: m3",
    ]);
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  });

  test.concurrent(
    "bun test: a test that rejects with the value, and an unhandled rejection during a test",
    async () => {
      const files = {
        "depth.test.ts": `
        import { test } from "bun:test";
        const value = ${value};
        test("rejects with the value", async () => {
          throw value;
        });
        test("unhandled rejection while the test runs", async () => {
          Promise.reject(value);
          // The rejection is reported at the microtask checkpoint after the
          // callback returns, before this timer fires.
          await new Promise(resolve => setTimeout(resolve, 0));
        });
      `,
      };
      expect(await run(["test", "./depth.test.ts"], files)).toEqual({
        stdout: "bun test <version> (<revision>)",
        stderr: `depth.test.ts:
error
{
  a: {
    b: {
      c: [Object ...],
    },
  },
}
(fail) rejects with the value
error
{
  a: {
    b: {
      c: [Object ...],
    },
  },
}
(fail) unhandled rejection while the test runs

 0 pass
 2 fail
Ran 2 tests across 1 file.`,
        exitCode: 1,
      });
    },
  );
});
