import { escapeHTML } from "bun" assert { type: "macro" };
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { existsSync } from "node:fs";
import path from "node:path";
import defaultMacro, {
  addStrings,
  addStringsUTF16,
  bigints,
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

test("BigInt return values become BigInt literals, and BigInt literals can be arguments", () => {
  expect(bigints()).toEqual({
    big: 18446744073709551617n,
    negative: -1180591620717411303424n,
    zero: 0n,
    nested: [1n, { two: 2n }],
  });
  expect(identity(123n)).toBe(123n);
  expect(identity(-0x10n)).toBe(-16n);
  expect(identity(1_000_000n)).toBe(1000000n);
  expect(identity([0o7n, 0b11n])).toEqual([7n, 3n]);
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

// A numeric key >= 100000 (JSC's MIN_SPARSE_ARRAY_INDEX) makes the property put inside
// JSC__JSValue__putToPropertyKey take a path that can throw, so the binding must check for
// an exception. BUN_JSC_validateExceptionChecks=1 aborts the child if the check is missing.
test("object argument with a sparse numeric key", async () => {
  using dir = tempDir("macro-sparse-key", {
    "take.ts": `export function take(o: any) {\n  return Object.keys(o).join(",");\n}\n`,
    "index.ts": `import { take } from "./take.ts" with { type: "macro" };\nconsole.log(take({ 200000: 1 }));\n`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "index.ts"],
    env: { ...bunEnv, BUN_JSC_validateExceptionChecks: "1" },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // One combined assertion so stderr (where JSC prints the exception check failure) shows up in
  // the diff if the child aborts. Debug builds print "[macro] call take" to stdout before the
  // script's own output, so only the tail of stdout is matched.
  expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toMatchObject({
    stdout: expect.stringMatching(/200000\n$/),
    exitCode: 0,
    signalCode: null,
  });
});

test("object destructuring of a macro result keeps every bound property regardless of key order or repeated keys", async () => {
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
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ lastLine: stdout.trim().split("\n").pop(), stderr }).toEqual({ lastLine: "[2,1,1,1,2]", stderr: "" });
  expect(exitCode).toBe(0);
});

// Macros run in the macro host's own VM and event loop while the transpiling thread waits. Work a macro
// starts but does not await keeps running there and must neither hold the process open nor be waited for
// at exit; work the *program* started must not run underneath the transpile, and must still run after it.
// These exercise the main thread as the waiting caller: the entry file's macros, or a module require()d
// so it transpiles on the main thread.
describe("macros and the program's event loop", () => {
  async function run(files: Record<string, string>, env: Record<string, string> = {}) {
    using dir = tempDir("macro-loops", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "index.ts"],
      env: { ...bunEnv, ...env },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // Debug builds also print "[macro] call <name>" to stdout.
    const lines = stdout
      .trim()
      .split("\n")
      .filter(line => !line.startsWith("[macro]"));
    return { lines, stderr, exitCode };
  }

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

  test.concurrent.each(unawaited)(
    "%s that it does not await still lets the process exit",
    async (_name, macroSource) => {
      await using server = Bun.serve({ port: 0, fetch: () => new Response("settled") });
      const { lines, stderr, exitCode } = await run(
        {
          "m.ts": macroSource,
          "index.ts": `import { m } from "./m.ts" with { type: "macro" };\nconsole.log("value", m());\n`,
        },
        { MACRO_TEST_URL: server.url.href },
      );
      // Whether the unawaited work finishes before the process exits is up to timing; either way the
      // program's output is there, nothing is reported, and the process exits.
      expect({ lines: lines.filter(line => line !== "settled"), stderr }).toEqual({ lines: ["value 1"], stderr: "" });
      expect(exitCode).toBe(0);
    },
  );

  // The program's digest finishes (microseconds, on the work queue) while the macro is in its 200 ms
  // wait. Its callback belongs to the program: it runs after require() returns, not while the main
  // thread is waiting on the macro. The macro runs in its own VM and does not see the program's globals.
  test.concurrent("a program completion that arrives during a macro waits for the macro to return", async () => {
    const { lines, stderr, exitCode } = await run({
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
    expect({ lines, stderr }).toEqual({ lines: [`undefined ["required","program"]`], stderr: "" });
    expect(exitCode).toBe(0);
  });

  test.concurrent("work chained off a program completion across a macro completes", async () => {
    const { lines, stderr, exitCode } = await run({
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
    expect({ lines, stderr }).toEqual({ lines: ["1 chained"], stderr: "" });
    expect(exitCode).toBe(0);
  });
});

// Every macro in the process runs in one dedicated VM on its own thread; the transpiling thread (the main
// thread, a bundler worker, the runtime transpiler pool) waits for the answer.
describe("the macro host", () => {
  async function run(files: Record<string, string>, cmd: string[]) {
    using dir = tempDir("macro-host", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...cmd],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const lines = stdout
      .trim()
      .split("\n")
      .filter(line => line && !line.startsWith("[macro]"));
    return { lines, stderr, exitCode, dir: String(dir) };
  }

  // Eight files are parsed on the bundler's worker pool; the macro they all call keeps a counter on its
  // globalThis. One VM serves them all, so the eight results are the numbers 0..7 in some order.
  test.concurrent("files transpiled on different threads share one macro VM", async () => {
    const files: Record<string, string> = {
      "counter.ts": `export function next() { globalThis.count ??= 0; return globalThis.count++; }`,
      "build.ts": [
        `const result = await Bun.build({ entrypoints: [0,1,2,3,4,5,6,7].map(i => "./e" + i + ".ts") });`,
        `if (!result.success) throw new AggregateError(result.logs);`,
        `const values = await Promise.all(result.outputs.map(async o => Number(/value = (\\d+)/.exec(await o.text())![1])));`,
        `console.log(JSON.stringify(values.sort((a, b) => a - b)));`,
      ].join("\n"),
    };
    for (let i = 0; i < 8; i++) {
      files[`e${i}.ts`] = `import { next } from "./counter.ts" with { type: "macro" };\nexport const value = next();\n`;
    }
    const { lines, stderr, exitCode } = await run(files, ["run", "build.ts"]);
    expect({ lines, stderr }).toEqual({ lines: ["[0,1,2,3,4,5,6,7]"], stderr: "" });
    expect(exitCode).toBe(0);
  });

  // The transpiling thread is a bundler worker here, which has no event loop of its own to run the
  // macro's timer and fetch on: they run on the macro host's loop while the worker waits.
  test.concurrent("an async macro completes when the file is transpiled off the main thread", async () => {
    await using server = Bun.serve({ port: 0, fetch: () => new Response("from the server") });
    const { lines, stderr, exitCode } = await run(
      {
        "m.ts": [
          `export async function slow(url: string) {`,
          `  await Bun.sleep(20);`,
          `  return await (await fetch(url)).text();`,
          `}`,
        ].join("\n"),
        "entry.ts": `import { slow } from "./m.ts" with { type: "macro" };\nexport const text = slow(${JSON.stringify(server.url.href)});\n`,
        "build.ts": [
          `const result = await Bun.build({ entrypoints: ["./entry.ts"] });`,
          `if (!result.success) throw new AggregateError(result.logs);`,
          `console.log(/text = "([^"]*)"/.exec(await result.outputs[0].text())![1]);`,
        ].join("\n"),
      },
      ["run", "build.ts"],
    );
    expect({ lines, stderr }).toEqual({ lines: ["from the server"], stderr: "" });
    expect(exitCode).toBe(0);
  });

  test.concurrent("a macro that throws fails the build with the error at the call site", async () => {
    const { lines, stderr, exitCode } = await run(
      {
        "m.ts": `export function boom() { throw new TypeError("no thanks"); }`,
        "index.ts": `import { boom } from "./m.ts" with { type: "macro" };\nconsole.log("value", boom());\n`,
      },
      ["run", "index.ts"],
    );
    expect(lines).toEqual([]);
    expect(stderr).toContain("TypeError: no thanks");
    expect(stderr).toContain("index.ts:2:22");
    expect(exitCode).toBe(1);
  });

  test.concurrent("a rejected macro module fails the build with the error at the call site", async () => {
    const { stderr, exitCode } = await run(
      {
        "m.ts": `throw new Error("while loading");\nexport function f() { return 1; }`,
        "index.ts": `import { f } from "./m.ts" with { type: "macro" };\nconsole.log("value", f());\n`,
      },
      ["run", "index.ts"],
    );
    expect(stderr).toContain("while loading");
    expect(stderr).toContain("index.ts:2:22");
    expect(exitCode).toBe(1);
  });

  test.concurrent("a macro module that does not parse reports its parse errors at the call site", async () => {
    const { stderr, exitCode } = await run(
      {
        "m.ts": `export function f( { return 1 }\n`,
        "index.ts": `import { f } from "./m.ts" with { type: "macro" };\nconsole.log(f());\n`,
      },
      ["run", "index.ts"],
    );
    expect(stderr).toContain(`Expected "}" but found "1"`);
    expect(stderr).toContain("m.ts:1:");
    expect(stderr).toContain("index.ts:2:13");
    expect(exitCode).toBe(1);
  });

  test.concurrent("process.exit() inside a macro fails the macro instead of exiting", async () => {
    const { stderr, exitCode } = await run(
      {
        "m.ts": `export function quit() { process.exit(0); }`,
        "index.ts": `import { quit } from "./m.ts" with { type: "macro" };\nconsole.log("value", quit());\n`,
      },
      ["run", "index.ts"],
    );
    expect(stderr).toContain("process.exit() cannot be called from a macro");
    expect(exitCode).toBe(1);
  });

  test.concurrent("a macro cannot invoke another macro", async () => {
    const { stderr, exitCode } = await run(
      {
        "inner.ts": `export function inner() { return 1; }`,
        "outer.ts": `import { inner } from "./inner.ts" with { type: "macro" };\nexport function outer() { return inner() + 1; }`,
        "index.ts": `import { outer } from "./outer.ts" with { type: "macro" };\nconsole.log("value", outer());\n`,
      },
      ["run", "index.ts"],
    );
    expect(stderr).toContain("Macros cannot be invoked from inside a macro");
    expect(exitCode).toBe(1);
  });

  test.concurrent("transformSync(code, context) hands the macro a clone of the context object", async () => {
    const { lines, stderr, exitCode } = await run(
      {
        "m.ts": `export function last(...args: unknown[]) { return args[args.length - 1]; }`,
        "index.ts": [
          `import { join } from "node:path";`,
          `const source = "import { last } from " + JSON.stringify(join(import.meta.dir, "m.ts")) + " with { type: 'macro' };\\nexport const v = last(1, 2);";`,
          `const context = { hello: "world", nested: { list: [1, 2, 3] } };`,
          `const code = new Bun.Transpiler({ loader: "ts" }).transformSync(source, context);`,
          `console.log(code.replace(/\\s+/g, " ").trim());`,
        ].join("\n"),
      },
      ["run", "index.ts"],
    );
    expect({ lines, stderr }).toEqual({
      lines: [`export const v = { hello: "world", nested: { list: [ 1, 2, 3 ] } };`],
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  // The worker is this VM's child, so exit joins it; it is busy, then transpiles a file that calls a
  // macro — a request that reaches the host after it stopped. It must be answered, not stranded.
  test.concurrent("exit does not hang on a Worker a macro started that is itself waiting on a macro", async () => {
    const { lines, exitCode } = await run(
      {
        "inner.ts": `export function one() { return 1; }`,
        "uses.ts": `import { one } from "./inner.ts" with { type: "macro" };\nexport const v = one();\n`,
        "worker.ts": `const t = Date.now(); while (Date.now() - t < 300) {}\npostMessage(require("./uses.ts").v);\n`,
        "m.ts": `export function spawn() { new Worker(new URL("./worker.ts", import.meta.url).href); return 1; }`,
        "index.ts": `import { spawn } from "./m.ts" with { type: "macro" };\nconsole.log("value", spawn());\n`,
      },
      ["run", "index.ts"],
    );
    expect(lines).toEqual(["value 1"]);
    expect(exitCode).toBe(0);
  });

  test.concurrent("a macro may not return a RegExp or another object with no literal form", async () => {
    const { stderr, exitCode } = await run(
      {
        "m.ts": `export const re = () => /a/g;\nexport const map = () => ({ m: new Map() });`,
        "index.ts": `import { re, map } from "./m.ts" with { type: "macro" };\nconsole.log(re(), map());\n`,
      },
      ["run", "index.ts"],
    );
    expect(stderr).toContain("cannot coerce RegExp");
    expect(stderr).toContain("cannot coerce Map");
    expect(exitCode).toBe(1);
  });

  test.concurrent("a macro may not return a pending Promise nested inside its result", async () => {
    const { stderr, exitCode } = await run(
      {
        "m.ts": `export function f() { return { later: new Promise(() => {}) }; }`,
        "index.ts": `import { f } from "./m.ts" with { type: "macro" };\nconsole.log(f());\n`,
      },
      ["run", "index.ts"],
    );
    expect(stderr).toContain("await it inside the macro");
    expect(exitCode).toBe(1);
  });
});

describe("--no-macros", () => {
  const files = {
    "macro.ts": `
      import { writeFileSync } from "node:fs";
      export function f() {
        writeFileSync("MACRO_RAN", "macro executed");
        return "INLINED_RESULT";
      }
    `,
    "entry.ts": `
      import { f } from "./macro.ts" with { type: "macro" };
      console.log(f());
    `,
  };

  test("bun build --no-macros refuses to run macros", async () => {
    using dir = tempDir("bundler-no-macros-cli", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--no-macros", "./entry.ts", "--outdir", "dist"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toMatchObject({
      stderr: expect.stringContaining("Macros are disabled"),
      exitCode: 1,
    });
    expect(existsSync(path.join(String(dir), "MACRO_RAN"))).toBe(false);
    expect(existsSync(path.join(String(dir), "dist", "entry.js"))).toBe(false);
  });

  test("Bun.build({ macros: false }) refuses to run macros", async () => {
    using dir = tempDir("bundler-no-macros-api", {
      ...files,
      "build.ts": `
        const result = await Bun.build({
          entrypoints: ["./entry.ts"],
          outdir: "./dist",
          macros: false,
          throw: false,
        });
        console.log(JSON.stringify({
          success: result.success,
          logs: result.logs.map(l => l.message),
        }));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "build.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const parsed = JSON.parse(stdout.trim().split("\n").pop()!);
    expect({ parsed, stderr, exitCode }).toMatchObject({
      parsed: {
        success: false,
        logs: expect.arrayContaining([expect.stringContaining("Macros are disabled")]),
      },
      exitCode: 0,
    });
    expect(existsSync(path.join(String(dir), "MACRO_RAN"))).toBe(false);
  });

  test("bun build without --no-macros still runs macros", async () => {
    using dir = tempDir("bundler-macros-enabled", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "./entry.ts", "--outdir", "dist"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });
    const out = await Bun.file(path.join(String(dir), "dist", "entry.js")).text();
    expect(out).toContain("INLINED_RESULT");
    expect(existsSync(path.join(String(dir), "MACRO_RAN"))).toBe(true);
  });
});
