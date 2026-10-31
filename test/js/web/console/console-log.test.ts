import { file, spawn } from "bun";
import { beforeAll, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

it("should log to console correctly", async () => {
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), join(import.meta.dir, "console-log.js")],
    stdin: "inherit",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const exitCode = await exited;
  const err = (await stderr.text()).replaceAll("\r\n", "\n");
  const out = (await stdout.text()).replaceAll("\r\n", "\n");
  const expected = (await new Response(file(join(import.meta.dir, "console-log.expected.txt"))).text()).replaceAll(
    "\r\n",
    "\n",
  );

  const errMatch = err === "uh oh\n";
  const outmatch = out === expected;

  if (errMatch && outmatch && exitCode === 0) {
    expect().pass();
    return;
  }

  console.error(err);
  console.log("Length of output:", out.length);
  console.log("Length of expected:", expected.length);
  console.log("Exit code:", exitCode);

  expect(out).toBe(expected);
  expect(err).toBe("uh oh\n");
  expect(exitCode).toBe(0);
});

it("long arrays get cutoff", () => {
  // console.log(x) === Bun.inspect(x) + "\n" written to stdout.
  expect(Bun.inspect(Array(1000).fill(0))).toEqual(
    "[\n" +
      "  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,\n" +
      "  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,\n" +
      "  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,\n" +
      "  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,\n" +
      "  ... 900 more items\n" +
      "]",
  );
});

it("long arrays get cutoff at a nested indent", () => {
  const row = "          4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4,\n";
  expect(Bun.inspect([[[[Array(1000).fill(4)]]]], { depth: 5 })).toEqual(
    "[\n  [\n    [\n      [\n        [\n" +
      row +
      row +
      row +
      row +
      "          4, 4, 4, 4,\n" +
      "          ... 900 more items\n" +
      "        ]\n      ]\n    ]\n  ]\n]",
  );
});

it("console.dir treats a BigInt depth like the same number", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `let o = {}, c = o; for (let i = 0; i < 40; i++) { c.n = {}; c = c.n; }
       for (const depth of [7n, 7, -1n, -1]) {
         console.dir(o, { depth, colors: false });
         console.log("--");
       }`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const [big7, num7, bigNegative, numNegative] = stdout.split("--\n");
  expect(big7).toBe(num7);
  expect(bigNegative).toBe(numNegative);
  expect(exitCode).toBe(0);
});

it("console.group", async () => {
  const filepath = join(import.meta.dir, "console-group.fixture.js").replaceAll("\\", "/");
  const proc = Bun.spawnSync({
    cmd: [bunExe(), filepath],
    env: { ...bunEnv, "BUN_JSC_showPrivateScriptsInStackTraces": "0" },
    stdio: ["inherit", "pipe", "pipe"],
  });
  expect(proc.exitCode).toBe(0);
  let stdout = proc.stdout
    .toString("utf8")
    .replaceAll("\r\n", "\n")
    .replaceAll("\\", "/")
    .trim()
    .replaceAll(filepath, "<file>");
  let stderr = proc.stderr
    .toString("utf8")
    .replaceAll("\r\n", "\n")
    .replaceAll("\\", "/")
    .trim()
    .replaceAll(filepath, "<file>")
    // Normalize line numbers for consistency between debug and release builds
    .replace(/\(\d+:\d+\)/g, "(N:NN)")
    .replace(/<file>:\d+:\d+/g, "<file>:NN:NN");
  expect(stdout).toMatchInlineSnapshot(`
"Basic group
  Inside basic group
Outer group
  Inside outer group
  Inner group
    Inside inner group
  Back to outer group
Level 1
  Level 2
    Level 3
      Deep inside
undefined
Empty nested
Test extra end
  Inside
Different logs
  Regular log
  Info log
  Debug log
Complex types
  {
    a: 1,
    b: 2,
  }
  [ 1, 2, 3 ]
null
  undefined
    0
      false
        
          Inside falsy groups
🎉 Unicode!
  Inside unicode group
  Tab\tNewline
Quote"Backslash
    Special chars"
`);
  expect(stderr).toMatchInlineSnapshot(`
"Warning log
  warn: console.warn an error
      at <file>:NN:NN

  52 | console.group("Different logs");
53 | console.log("Regular log");
54 | console.info("Info log");
55 | console.warn("Warning log");
56 | console.warn(new Error("console.warn an error"));
57 | console.error(new Error("console.error an error"));
                       ^
error: console.error an error
      at <file>:NN:NN

  53 | console.log("Regular log");
54 | console.info("Info log");
55 | console.warn("Warning log");
56 | console.warn(new Error("console.warn an error"));
57 | console.error(new Error("console.error an error"));
58 | console.error(new NamedError("console.error a named error"));
                   ^
NamedError: console.error a named error
      at <file>:NN:NN

  NamedError: console.warn a named error
      at <file>:NN:NN

  Error log"
`);
});

it("console.groupCollapsed starts a group, as console.group does", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `console.groupCollapsed("Collapsed");
       console.log("in collapsed");
       console.warn("warn in collapsed");
       console.groupCollapsed();
       console.log("in collapsed with no label");
       console.groupEnd();
       console.group("Group in collapsed");
       console.log("in group in collapsed");
       console.groupEnd();
       console.groupEnd();
       console.group("Group");
       console.groupCollapsed("Collapsed in group");
       console.log("in collapsed in group");
       console.error("error in collapsed in group");
       console.groupEnd();
       console.groupCollapsed(undefined);
       console.log("in collapsed with an undefined label");
       console.groupEnd();
       console.log("back in group");
       console.groupEnd();
       console.groupCollapsed("%s has %d args", "label", 3);
       console.groupEnd();
       console.groupCollapsed();
       console.groupEnd();
       console.log("after");`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({
    stdout: stdout.replaceAll("\r\n", "\n"),
    stderr: stderr.replaceAll("\r\n", "\n"),
    exitCode,
  }).toEqual({
    stdout: [
      "Collapsed",
      "  in collapsed",
      "    in collapsed with no label",
      "  Group in collapsed",
      "    in group in collapsed",
      "Group",
      "  Collapsed in group",
      "    in collapsed in group",
      "  undefined",
      "    in collapsed with an undefined label",
      "  back in group",
      "label has 3 args",
      "after",
      "",
    ].join("\n"),
    stderr: ["  warn in collapsed", "    error in collapsed in group", ""].join("\n"),
    exitCode: 0,
  });
});

it("console.log with SharedArrayBuffer", () => {
  // console.log(x) === Bun.inspect(x) + "\n" written to stdout.
  expect(Bun.inspect(new ArrayBuffer(0))).toBe("ArrayBuffer(0) []");
  expect(Bun.inspect(new SharedArrayBuffer(0))).toBe("SharedArrayBuffer(0) []");
  expect(Bun.inspect(new ArrayBuffer(3))).toBe("ArrayBuffer(3) [ 0, 0, 0 ]");
  expect(Bun.inspect(new SharedArrayBuffer(3))).toBe("SharedArrayBuffer(3) [ 0, 0, 0 ]");
});

// https://github.com/oven-sh/bun/issues/7125
describe("console.error with colors", () => {
  const red = "\x1b[0m\x1b[31m";
  const reset = "\x1b[0m";

  const redLines = {
    "a string, then an object": `console.error("This is an error message", { withExtra: true, properties: "yes" })`,
    "a string, then an array": `console.error("errors: ", [1])`,
    "a string after a number": `console.error("count:", 3, "items")`,
    "an object first": `console.error({ a: 1 }, "after")`,
    "%o": `console.error("a %o b", { x: 1 })`,
    "%s of a RegExp": `console.error("a %s b", /re/g)`,
    "nested values": `console.error("nested", { outer: [1, "two", null, undefined, true, 1n, Symbol("s")] }, new Map([["k", 1]]), new Set([1]))`,
    "console.assert with data": `console.assert(false, "assert msg", { a: 1 })`,
    "a Response": `console.error("bad response:", new Response("body", { status: 500 }), "tail")`,
    "an inspector that calls options.stylize": `console.error("label", { [custom]: (depth, options) => options.stylize("styled", "number") }, "tail")`,
    "a String object": `console.error(new String("boxed"))`,
    "one string": `console.error("just a string")`,
  };
  // Each of these prints an error after a label. The value names the call that prints the same error alone.
  const errorLines = {
    [`console.error("request failed:", err, "tail")`]: `console.error(err)`,
    [`console.error("x", { err })`]: `console.error(err)`,
    [`console.error("a %o b", err)`]: `console.error(err)`,
    [`console.error("build failed:", buildMessage, "tail")`]: `console.error(buildMessage)`,
    [`console.error("resolve failed:", resolveMessage, "tail")`]: `console.error(resolveMessage)`,
  };
  const throwingInspector = `console.error("label", { [custom]() { throw new Error("inspector threw"); } }, "tail")`;
  // Each of these never starts the red. The value is the console.log call that prints the same bytes.
  const sameAsLog = {
    "console.error({ a: 1 })": "console.log({ a: 1 })",
    "console.error(42)": "console.log(42)",
    [`console.warn("msg", { a: 1 })`]: `console.log("msg", { a: 1 })`,
  };
  const calls = [
    ...new Set([
      ...Object.values(redLines),
      ...Object.entries(errorLines).flat(),
      throwingInspector,
      ...Object.entries(sameAsLog).flat(),
    ]),
  ];

  let colored: Record<string, string>;
  let plain: Record<string, string>;

  beforeAll(async () => {
    using dir = tempDir("console-error-color", {
      "syntax-error.js": "const x = ;\n",
      "fixture.js": `
        const { writeSync } = require("node:fs");
        const custom = Symbol.for("nodejs.util.inspect.custom");
        function fail() {
          return new Error("boom");
        }
        const err = fail();
        let buildMessage, resolveMessage;
        try { require("./syntax-error.js"); } catch (e) { buildMessage = e; }
        try { require.resolve("./does-not-exist"); } catch (e) { resolveMessage = e; }
        const calls = [${calls.map(call => `() => ${call}`).join(",\n")}];
        for (const call of calls) {
          try { call(); } catch {}
          writeSync(1, "\\0");
          writeSync(2, "\\0");
        }
      `,
    });
    // Every call writes to one stream only, so the two streams join into that call's output.
    async function run(env: Record<string, string | undefined>) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "fixture.js"],
        cwd: String(dir),
        env: { ...bunEnv, ...env },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const out = stdout.replaceAll("\r\n", "\n").split("\0");
      const err = stderr.replaceAll("\r\n", "\n").split("\0");
      expect({ out: out.length, err: err.length, exitCode }).toEqual({
        out: calls.length + 1,
        err: calls.length + 1,
        exitCode: 0,
      });
      return Object.fromEntries(calls.map((call, i) => [call, out[i] + err[i]]));
    }
    [colored, plain] = await Promise.all([run({ NO_COLOR: undefined, FORCE_COLOR: "1" }), run({})]);
  });

  /** The visible characters of `text` that a terminal does not draw in red. */
  function notRed(text: string) {
    let foreground = 0;
    let found = "";
    for (const [, codes, char] of text.matchAll(/\x1b\[([\d;]*)m|(\S)/g)) {
      if (char !== undefined) {
        if (foreground !== 31) found += char;
        continue;
      }
      for (const code of codes.split(";").map(Number)) {
        if (code === 0 || code === 39) foreground = 0;
        else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) foreground = code;
      }
    }
    return found;
  }

  it.each(Object.entries(redLines))("%s: the line is red from start to end", (_, call) => {
    expect(Bun.stripANSI(colored[call])).toBe(plain[call]);
    expect(notRed(colored[call])).toBe("");
    expect(colored[call]).toStartWith(red);
    expect(colored[call]).toEndWith(reset + "\n");
  });

  it.each(Object.entries(errorLines))("%s: the error keeps its own colors", (call, alone) => {
    // console.error(err) writes the error, then the newline that ends the call.
    const error = reset + colored[alone].slice(0, -1) + red;
    expect(Bun.stripANSI(colored[call])).toBe(plain[call]);
    expect(colored[call]).toContain(error);
    expect(notRed(colored[call].replace(error, ""))).toBe("");
    expect(colored[call]).toStartWith(red);
    expect(colored[call]).toEndWith(reset + "\n");
  });

  it("an inspector that throws does not leave the terminal red", () => {
    expect(colored[throwingInspector]).toMatch(/^\x1b\[0m\x1b\[31mlabel \x1b\[0m\n?$/);
  });

  it.each(Object.entries(sameAsLog))("%s prints the same bytes as %s", (call, log) => {
    expect(colored[call]).toBe(colored[log]);
    expect(colored[call]).not.toContain("\x1b[31m");
  });
});
