import { escapeHTML } from "bun" assert { type: "macro" };
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import defaultMacro, {
  addStrings,
  addStringsUTF16,
  default as defaultMacroAlias,
  escape,
  identity,
  identity as identity1,
  identity as identity2,
  ireturnapromise,
} from "./macro.ts" assert { type: "macro" };

import * as macros from "./macro.ts" assert { type: "macro" };

test("bun builtins can be used in macros", async () => {
  expect(escapeHTML("abc!")).toBe("abc!");
});

test("latin1 string", () => {
  expect(identity("©")).toBe("©");
});

test("ascii string", () => {
  expect(identity("abc")).toBe("abc");
});

test("type coercion", () => {
  expect(identity({ a: 1 })).toEqual({ a: 1 });
  expect(identity([1, 2, 3])).toEqual([1, 2, 3]);
  expect(identity(undefined)).toBe(undefined);
  expect(identity(null)).toBe(null);
  expect(identity(1.5)).toBe(1.5);
  expect(identity(1)).toBe(1);
  expect(identity(true)).toBe(true);
});

test("escaping", () => {
  expect(identity("\\")).toBe("\\");
  expect(identity("\f")).toBe("\f");
  expect(identity("\n")).toBe("\n");
  expect(identity("\r")).toBe("\r");
  expect(identity("\t")).toBe("\t");
  expect(identity("\v")).toBe("\v");
  expect(identity("\0")).toBe("\0");
  expect(identity("'")).toBe("'");
  expect(identity('"')).toBe('"');
  expect(identity("`")).toBe("`");
  // prettier-ignore
  expect(identity("\'")).toBe("\'");
  // prettier-ignore
  expect(identity('\"')).toBe('\"');
  // prettier-ignore
  expect(identity("\`")).toBe("\`");
  expect(identity("$")).toBe("$");
  expect(identity("\x00")).toBe("\x00");
  expect(identity("\x0B")).toBe("\x0B");
  expect(identity("\x0C")).toBe("\x0C");

  expect(identity("\\")).toBe("\\");

  expect(escape()).toBe("\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C");

  expect(addStrings("abc")).toBe("abc\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C©");
  expect(addStrings("\n")).toBe("\n\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C©");
  expect(addStrings("\r")).toBe("\r\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C©");
  expect(addStrings("\t")).toBe("\t\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C©");
  expect(addStrings("©")).toBe("©\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C©");
  expect(addStrings("\x00")).toBe("\x00\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C©");
  expect(addStrings("\x0B")).toBe("\x0B\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C©");
  expect(addStrings("\x0C")).toBe("\x0C\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C©");
  expect(addStrings("\\")).toBe("\\\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C©");
  expect(addStrings("\f")).toBe("\f\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C©");
  expect(addStrings("\v")).toBe("\v\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C©");
  expect(addStrings("\0")).toBe("\0\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C©");
  expect(addStrings("'")).toBe("'\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C©");
  expect(addStrings('"')).toBe('"\\\f\n\r\t\v\0\'"`$\x00\x0B\x0C©');
  expect(addStrings("`")).toBe("`\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C©");
  expect(addStrings("😊")).toBe("😊\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C©");

  expect(addStringsUTF16("abc")).toBe("abc\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C😊");
  expect(addStringsUTF16("\n")).toBe("\n\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C😊");
  expect(addStringsUTF16("\r")).toBe("\r\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C😊");
  expect(addStringsUTF16("\t")).toBe("\t\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C😊");
  expect(addStringsUTF16("©")).toBe("©\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C😊");
  expect(addStringsUTF16("\x00")).toBe("\x00\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C😊");
  expect(addStringsUTF16("\x0B")).toBe("\x0B\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C😊");
  expect(addStringsUTF16("\x0C")).toBe("\x0C\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C😊");
  expect(addStringsUTF16("\\")).toBe("\\\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C😊");
  expect(addStringsUTF16("\f")).toBe("\f\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C😊");
  expect(addStringsUTF16("\v")).toBe("\v\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C😊");
  expect(addStringsUTF16("\0")).toBe("\0\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C😊");
  expect(addStringsUTF16("'")).toBe("'\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C😊");
  expect(addStringsUTF16('"')).toBe('"\\\f\n\r\t\v\0\'"`$\x00\x0B\x0C😊');
  expect(addStringsUTF16("`")).toBe("`\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C😊");
  expect(addStringsUTF16("😊")).toBe("😊\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C😊");
});

test("utf16 string", () => {
  expect(identity("😊 Smiling Face with Smiling Eyes Emoji")).toBe("😊 Smiling Face with Smiling Eyes Emoji");
});

test("import aliases", () => {
  expect(identity1({ a: 1 })).toEqual({ a: 1 });
  expect(identity1([1, 2, 3])).toEqual([1, 2, 3]);
  expect(identity2({ a: 1 })).toEqual({ a: 1 });
  expect(identity2([1, 2, 3])).toEqual([1, 2, 3]);
});

test("default import", () => {
  expect(defaultMacro()).toBe("defaultdefaultdefault");
  expect(defaultMacroAlias()).toBe("defaultdefaultdefault");
});

test("namespace import", () => {
  expect(macros.identity({ a: 1 })).toEqual({ a: 1 });
  expect(macros.identity([1, 2, 3])).toEqual([1, 2, 3]);
  expect(macros.escape()).toBe("\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C");
});

// test("template string ascii", () => {
//   expect(identity(`A${""}`)).toBe("A");
// });

// test("template string latin1", () => {
//   expect(identity(`©${""}`)).toBe("©");
// });

test("ireturnapromise", async () => {
  expect(await ireturnapromise()).toEqual("aaa");
});

// Every test from here on works in its own temp dir (a bun child, or Bun.build in this process), so
// they all run concurrently. Debug builds print "[macro] call <name>" to stdout for each macro call;
// it is dropped so stdout can be matched exactly.
async function runBun(cwd: string, cmd: string[], env: Record<string, string> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...cmd],
    env: { ...bunEnv, ...env },
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return {
    stdout: stdout
      .split("\n")
      .filter(line => !line.startsWith("[macro]"))
      .join("\n"),
    stderr,
    exitCode,
    signalCode: proc.signalCode,
  };
}

// A numeric key >= 100000 (JSC's MIN_SPARSE_ARRAY_INDEX) makes the property put inside
// JSC__JSValue__putToPropertyKey take a path that can throw, so the binding must check for
// an exception. BUN_JSC_validateExceptionChecks=1 aborts the child if the check is missing.
test.concurrent("object argument with a sparse numeric key", async () => {
  using dir = tempDir("macro-sparse-key", {
    "take.ts": `export function take(o: any) {\n  return Object.keys(o).join(",");\n}\n`,
    "index.ts": `import { take } from "./take.ts" with { type: "macro" };\nconsole.log(take({ 200000: 1 }));\n`,
  });
  // One combined assertion so stderr (where JSC prints the exception check failure) shows up in
  // the diff if the child aborts.
  expect(await runBun(String(dir), ["run", "index.ts"], { BUN_JSC_validateExceptionChecks: "1" })).toEqual({
    stdout: "200000\n",
    stderr: "",
    exitCode: 0,
    signalCode: null,
  });
});

test.concurrent(
  "object destructuring of a macro result keeps every bound property regardless of key order or repeated keys",
  async () => {
    using dir = tempDir("macro-destructure-object", {
      "m.ts": `export function m() {\n  return { a: 1, c: 2 };\n}\n`,
      "index.ts": [
        `import { m } from "./m.ts" with { type: "macro" };`,
        `const { c, a } = m();`,
        `const { a: x, a: y, c: z } = m();`,
        `console.log(JSON.stringify([c, a, x, y, z]));`,
        ``,
      ].join("\n"),
    });
    expect(await runBun(String(dir), ["run", "index.ts"])).toEqual({
      stdout: "[2,1,1,1,2]\n",
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  },
);

// A macro's `await` is serviced by the VM's macro event loop, so completions have to be routed by which
// loop was current when their work started: what the macro started goes to the macro loop (or the wait
// hangs), what the program started stays on the regular loop (or program callbacks run mid-transpile),
// and whatever a macro started but did not await is adopted by the regular loop once the macro returns
// (or it is stranded and its keep-alive holds the process open). These run the macro in the main VM:
// the entry file's macros, or a module require()d so it transpiles on the main thread.
describe.concurrent("event loop routing around macros", () => {
  const unawaited: [name: string, macroSource: string][] = [
    [
      "an fs.promises call inside the macro",
      [
        `import { promises as fs } from "node:fs";`,
        `export function m() {`,
        `  fs.stat(import.meta.dir).then(() => console.log("settled"));`,
        `  return 1;`,
        `}`,
      ].join("\n"),
    ],
    [
      "an fs.promises call at the macro module's top level",
      [
        `import { promises as fs } from "node:fs";`,
        `fs.stat(import.meta.dir).then(() => console.log("settled"));`,
        `export function m() {`,
        `  return 1;`,
        `}`,
      ].join("\n"),
    ],
    [
      "a fetch() inside the macro",
      [
        `export function m() {`,
        `  fetch(process.env.MACRO_TEST_URL!).then(res => res.text()).then(body => console.log(body));`,
        `  return 1;`,
        `}`,
      ].join("\n"),
    ],
    [
      // 64 bytes or more are hashed on the WebCrypto work queue; its reply and keep-alive release come
      // back through the pool task's ticket rather than a thread-pool job like the cases above.
      "a crypto.subtle.digest() inside the macro",
      [
        `export function m() {`,
        `  crypto.subtle.digest("SHA-256", new Uint8Array(4096)).then(() => console.log("settled"));`,
        `  return 1;`,
        `}`,
      ].join("\n"),
    ],
    [
      // JSC's DeferredWorkTimer: the keep-alive and the completion are registered against the loop
      // current at WebAssembly.compile() and delivered from a JSC helper thread.
      "a WebAssembly.compile() inside the macro",
      [
        `export function m() {`,
        `  WebAssembly.compile(new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0])).then(() => console.log("settled"));`,
        `  return 1;`,
        `}`,
      ].join("\n"),
    ],
  ];

  test.each(unawaited)("%s that it does not await still lets the process exit", async (_name, macroSource) => {
    await using server = Bun.serve({ port: 0, fetch: () => new Response("settled") });
    using dir = tempDir("macro-loops", {
      "m.ts": macroSource,
      "index.ts": `import { m } from "./m.ts" with { type: "macro" };\nconsole.log("value", m());\n`,
    });
    const { stdout, ...rest } = await runBun(String(dir), ["run", "index.ts"], {
      MACRO_TEST_URL: server.url.href,
    });
    // The continuation runs on the macro loop if the work finishes while the macro is still being waited
    // on and on the regular loop otherwise, so its position relative to the entry module's output varies.
    expect({ lines: stdout.trim().split("\n").sort(), ...rest }).toEqual({
      lines: ["settled", "value 1"],
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  // The program's digest finishes (microseconds, on the work queue) while the macro is parked in its
  // 200 ms wait. Its callback belongs to the program: it must run after require() returns, not inside
  // the macro's wait underneath the transpiler, so the macro never sees "program" in the log.
  test("a program completion that arrives during a macro waits for the macro to return", async () => {
    using dir = tempDir("macro-loops", {
      "m.ts": [
        `export async function probe() {`,
        `  await Bun.sleep(200);`,
        `  return JSON.stringify(globalThis.log);`,
        `}`,
      ].join("\n"),
      "with-macro.ts": `import { probe } from "./m.ts" with { type: "macro" };\nexport const seen = probe();\n`,
      "index.ts": [
        `globalThis.log = [];`,
        `const digest = crypto.subtle.digest("SHA-256", new Uint8Array(4096)).then(() => globalThis.log.push("program"));`,
        `const { seen } = require("./with-macro.ts");`,
        `globalThis.log.push("required");`,
        `await digest;`,
        `console.log(seen, JSON.stringify(globalThis.log));`,
      ].join("\n"),
    });
    expect(await runBun(String(dir), ["run", "index.ts"])).toEqual({
      stdout: `[] ["required","program"]\n`,
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  // If a program callback did run mid-macro, work it started there would be routed to the macro loop and,
  // finishing after the macro returned, would need the regular loop to adopt it. Either way the chain
  // must complete and the process must exit.
  test("work chained off a program completion across a macro completes", async () => {
    using dir = tempDir("macro-loops", {
      "m.ts": `export async function probe() {\n  await Bun.sleep(200);\n  return 1;\n}\n`,
      "with-macro.ts": `import { probe } from "./m.ts" with { type: "macro" };\nexport const value = probe();\n`,
      "index.ts": [
        `import { promises as fs } from "node:fs";`,
        `const chained = crypto.subtle`,
        `  .digest("SHA-256", new Uint8Array(4096))`,
        `  .then(() => fs.stat(import.meta.dir))`,
        `  .then(() => "chained");`,
        `const { value } = require("./with-macro.ts");`,
        `console.log(value, await chained);`,
      ].join("\n"),
    });
    expect(await runBun(String(dir), ["run", "index.ts"])).toEqual({
      stdout: "1 chained\n",
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });
});

describe.concurrent("--no-macros", () => {
  // The macro leaves MACRO_RAN next to itself when it runs, so whether it ran is checked on disk and
  // not only through the bundle text.
  const files = {
    "macro.ts": [
      `import { writeFileSync } from "node:fs";`,
      `import { join } from "node:path";`,
      `export function f() {`,
      `  writeFileSync(join(import.meta.dir, "MACRO_RAN"), "macro executed");`,
      `  return "INLINED_RESULT";`,
      `}`,
    ].join("\n"),
    "entry.ts": `import { f } from "./macro.ts" with { type: "macro" };\nconsole.log(f());\n`,
  };

  test("bun build --no-macros refuses to run macros", async () => {
    using dir = tempDir("bundler-no-macros-cli", files);
    const { stdout, stderr, exitCode } = await runBun(String(dir), [
      "build",
      "--no-macros",
      "./entry.ts",
      "--outdir",
      "dist",
    ]);
    expect(normalizeBunSnapshot(stderr, String(dir))).toMatchInlineSnapshot(`
      "2 | console.log(f());
                      ^
      error: Macros are disabled
          at <dir>/entry.ts:2:13"
    `);
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
    // Neither the macro's side effect nor the bundle was written.
    expect(readdirSync(String(dir)).sort()).toEqual(["entry.ts", "macro.ts"]);
  });

  test.each([
    [
      "{ macros: false } refuses to run macros",
      { macros: false },
      {
        success: false,
        logs: [{ message: "Macros are disabled", file: "entry.ts", line: 2, column: 13 }],
        outputs: [],
        macroRan: false,
      },
    ],
    [
      "no macros option runs macros",
      {},
      {
        success: true,
        logs: [],
        outputs: [`console.log("INLINED_RESULT");\n`],
        macroRan: true,
      },
    ],
  ])("Bun.build() with %s", async (_name, options, expected) => {
    using dir = tempDir("bundler-no-macros-api", files);
    const result = await Bun.build({
      entrypoints: [path.join(String(dir), "entry.ts")],
      // Without minify the bundle starts with a "// <path>" comment relative to the cwd.
      minify: true,
      throw: false,
      ...options,
    });
    expect({
      success: result.success,
      logs: result.logs.map(log => ({
        message: log.message,
        file: path.basename(log.position!.file),
        line: log.position!.line,
        column: log.position!.column,
      })),
      outputs: await Promise.all(result.outputs.map(output => output.text())),
      macroRan: existsSync(path.join(String(dir), "MACRO_RAN")),
    }).toEqual(expected);
  });
});
