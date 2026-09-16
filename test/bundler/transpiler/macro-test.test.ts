import { escapeHTML } from "bun" assert { type: "macro" };
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { existsSync } from "node:fs";
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
  symbolKeys,
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

// A Symbol key has no source form. The inlined object keeps the string keys
// only, like JSON.stringify, instead of a string key named by the description.
test("object with Symbol keys", () => {
  const value = symbolKeys();
  expect(value).toEqual({ v: 2 });
  expect(Reflect.ownKeys(value)).toEqual(["v"]);
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

// A Response or Blob returned from a macro is inlined by its content type: JSON is parsed into an object
// literal, text becomes a string, anything else becomes a base64 data URL. The type has to be classified
// with its parameters stripped: `Response.json()` and most servers send `application/json;charset=utf-8`.
test("a macro that returns a JSON or text Response or Blob is inlined by its content type", async () => {
  await using server = Bun.serve({ port: 0, fetch: () => Response.json({ from: "server" }) });
  using dir = tempDir("macro-response-content-type", {
    "m.ts": [
      `export function json() {`,
      `  return Response.json({ a: 1, b: [true, null, "x"] });`,
      `}`,
      `export function jsonHeader() {`,
      `  return new Response('{"b":2}', { headers: { "content-type": "application/json" } });`,
      `}`,
      `export function fetched() {`,
      `  return fetch(process.env.MACRO_TEST_URL!);`,
      `}`,
      `export function text() {`,
      `  return new Response("hello", { headers: { "content-type": "text/plain; charset=utf-8" } });`,
      `}`,
      `export function blobJson() {`,
      `  return new Blob(['{"c":3}'], { type: "application/json; charset=utf-8" });`,
      `}`,
      `export function binary() {`,
      `  return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "application/octet-stream" } });`,
      `}`,
    ].join("\n"),
    "index.ts": [
      `import { json, jsonHeader, fetched, text, blobJson, binary } from "./m.ts" with { type: "macro" };`,
      `console.log(JSON.stringify([json(), jsonHeader(), fetched(), text(), blobJson(), binary()]));`,
      ``,
    ].join("\n"),
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "index.ts"],
    env: { ...bunEnv, MACRO_TEST_URL: server.url.href },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // Debug builds print "[macro] call <name>" to stdout before the script's own output.
  expect({ lastLine: stdout.trim().split("\n").pop(), stderr }).toEqual({
    lastLine: JSON.stringify([
      { a: 1, b: [true, null, "x"] },
      { b: 2 },
      { from: "server" },
      "hello",
      { c: 3 },
      "data:application/octet-stream;base64,AQID",
    ]),
    stderr: "",
  });
  expect(exitCode).toBe(0);
});

// The classification follows the MIME essence, not the category table the runtime uses for blob types:
// any `+json` suffix or `/json` subtype is JSON, and the JavaScript and XML `application/*` types are text.
// The data URL keeps the raw content type, parameters included.
test("a Response or Blob returned from a macro is classified by its MIME essence", async () => {
  const json = '{"a":1}';
  const cases: [type: string, body: string, expected: unknown][] = [
    ["application/json", json, { a: 1 }],
    ["application/json; charset=utf-8", json, { a: 1 }],
    ["application/vnd.api+json", json, { a: 1 }],
    ["application/ld+json", json, { a: 1 }],
    ["application/ld+json; charset=utf-8", json, { a: 1 }],
    ["application/manifest+json", json, { a: 1 }],
    ["application/geo+json", json, { a: 1 }],
    ["text/json", json, { a: 1 }],
    ["application/javascript", "1+1", "1+1"],
    ["application/javascript; charset=utf-8", "1+1", "1+1"],
    ["application/x-javascript", "1+1", "1+1"],
    ["application/ecmascript", "1+1", "1+1"],
    ["application/xml", "<a/>", "<a/>"],
    ["text/plain", "hi", "hi"],
    ["text/html", "<b>hi</b>", "<b>hi</b>"],
    ["text/javascript", "1+1", "1+1"],
    ["text/xml", "<a/>", "<a/>"],
    ["image/png", "png", "data:image/png;base64,cG5n"],
    ["application/octet-stream", "bin", "data:application/octet-stream;base64,Ymlu"],
    ["application/wasm", "wasm", "data:application/wasm;base64,d2FzbQ=="],
    ["application/x-ndjson", '{"a":1}\n{"a":2}\n', "data:application/x-ndjson;base64,eyJhIjoxfQp7ImEiOjJ9Cg=="],
  ];
  using dir = tempDir("macro-mime-essence", {
    "m.ts": [
      `export function resp(type: string, body: string) {`,
      `  return new Response(body, { headers: { "content-type": type } });`,
      `}`,
      `export function blob(type: string, body: string) {`,
      `  return new Blob([body], { type });`,
      `}`,
    ].join("\n"),
    "index.ts": [
      `import { resp, blob } from "./m.ts" with { type: "macro" };`,
      `console.log(JSON.stringify([`,
      ...cases.map(([type, body]) => `  resp(${JSON.stringify(type)}, ${JSON.stringify(body)}),`),
      ...cases.map(([type, body]) => `  blob(${JSON.stringify(type)}, ${JSON.stringify(body)}),`),
      `]));`,
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
  const expected = cases.map(([, , expected]) => expected);
  // Debug builds print "[macro] call <name>" to stdout before the script's own output.
  expect({ lastLine: stdout.trim().split("\n").pop(), stderr }).toEqual({
    lastLine: JSON.stringify([...expected, ...expected]),
    stderr: "",
  });
  expect(exitCode).toBe(0);
});

// Runs index.ts from `files` with `bun run`: its own macros, and those of any module it require()s,
// run in the main VM.
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

// A macro's `await` is serviced by the VM's macro event loop, so completions have to be routed by which
// loop was current when their work started: what the macro started goes to the macro loop (or the wait
// hangs), what the program started stays on the regular loop (or program callbacks run mid-transpile),
// and whatever a macro started but did not await is adopted by the regular loop once the macro returns
// (or it is stranded and its keep-alive holds the process open). These run the macro in the main VM:
// the entry file's macros, or a module require()d so it transpiles on the main thread.
describe("event loop routing around macros", () => {
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
      // The continuation runs on the macro loop if the work finishes while the macro is still being waited
      // on and on the regular loop otherwise, so its position relative to the entry module's output varies.
      expect({ lines: lines.sort(), stderr }).toEqual({ lines: ["settled", "value 1"], stderr: "" });
      expect(exitCode).toBe(0);
    },
  );

  // The program's digest finishes (microseconds, on the work queue) while the macro is parked in its
  // 200 ms wait. Its callback belongs to the program: it must run after require() returns, not inside
  // the macro's wait underneath the transpiler, so the macro never sees "program" in the log.
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
    expect({ lines, stderr }).toEqual({ lines: [`[] ["required","program"]`], stderr: "" });
    expect(exitCode).toBe(0);
  });

  // If a program callback did run mid-macro, work it started there would be routed to the macro loop and,
  // finishing after the macro returned, would need the regular loop to adopt it. Either way the chain
  // must complete and the process must exit.
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

// require() of an ES module loads the whole graph without yielding: the module loader's promise
// reactions go to a queue that only that require() drains. A macro that runs before the require()
// returns (a dependency is transpiled, or the module calls the transpiler while it evaluates) loads
// its own module with the asynchronous loader and waits for it. Its reactions must still reach the
// microtask queue that the wait drains, or the wait spins forever. These are not concurrent: the
// runner only kills a timed-out test's child, here one that spins, when the test runs alone.
describe("a macro that runs beneath require() of an ES module", () => {
  const macro = `export function value() {\n  return "from-macro";\n}\n`;
  const withMacro = `import { value } from "./m.ts" with { type: "macro" };\nexport const inlined = value();\n`;
  const index = `const { seen } = require("./importer.ts");\nconsole.log(seen);\n`;

  test("in a static dependency of the module", async () => {
    const { lines, stderr, exitCode } = await run({
      "m.ts": macro,
      "with-macro.ts": withMacro,
      "importer.ts": `import { inlined } from "./with-macro.ts";\nexport const seen = inlined + "!";\n`,
      "index.ts": index,
    });
    expect({ lines, stderr }).toEqual({ lines: ["from-macro!"], stderr: "" });
    expect(exitCode).toBe(0);
  });

  test("in a module that the module require()s while it evaluates", async () => {
    const { lines, stderr, exitCode } = await run({
      "m.ts": macro,
      "with-macro.ts": withMacro,
      "importer.ts": `export const seen = import.meta.require("./with-macro.ts").inlined + "!";\n`,
      "index.ts": index,
    });
    expect({ lines, stderr }).toEqual({ lines: ["from-macro!"], stderr: "" });
    expect(exitCode).toBe(0);
  });

  test("in source that the module gives to Bun.Transpiler while it evaluates", async () => {
    const { lines, stderr, exitCode } = await run({
      "m.ts": macro,
      "importer.ts": [
        `const source = ${JSON.stringify(withMacro)};`,
        `export const seen = new Bun.Transpiler({ loader: "ts" }).transformSync(source).trim();`,
      ].join("\n"),
      "index.ts": index,
    });
    expect({ lines, stderr }).toEqual({ lines: [`export const inlined = "from-macro";`], stderr: "" });
    expect(exitCode).toBe(0);
  });

  // The macro's wait has to poll for the timer, and the reactions of the import() and of the
  // top-level await arrive between polls.
  test("an async macro that awaits import() and a timer, in a module with top-level await", async () => {
    const { lines, stderr, exitCode } = await run({
      "suffix.ts": `export const suffix = "macro";\n`,
      "m.ts": [
        `const prefix = await Promise.resolve("from");`,
        `export async function value() {`,
        `  const { suffix } = await import("./suffix.ts");`,
        `  await Bun.sleep(1);`,
        `  return prefix + "-" + suffix;`,
        `}`,
      ].join("\n"),
      "with-macro.ts": withMacro,
      "importer.ts": `import { inlined } from "./with-macro.ts";\nexport const seen = inlined + "!";\n`,
      "index.ts": index,
    });
    expect({ lines, stderr }).toEqual({ lines: ["from-macro!"], stderr: "" });
    expect(exitCode).toBe(0);
  });

  // The top-level await settles from the thread pool: the wait polls, and the reactions of the
  // module's evaluation arrive with the completion.
  test("a macro module that reads a file at the top level", async () => {
    const { lines, stderr, exitCode } = await run({
      "value.txt": "from-macro",
      "m.ts": [
        `import { promises as fs } from "node:fs";`,
        `const text = await fs.readFile(import.meta.dir + "/value.txt", "utf8");`,
        `export function value() {`,
        `  return text;`,
        `}`,
      ].join("\n"),
      "with-macro.ts": withMacro,
      "importer.ts": `import { inlined } from "./with-macro.ts";\nexport const seen = inlined + "!";\n`,
      "index.ts": index,
    });
    expect({ lines, stderr }).toEqual({ lines: ["from-macro!"], stderr: "" });
    expect(exitCode).toBe(0);
  });

  test("a macro module that throws while it loads fails the require()", async () => {
    const { lines, stderr, exitCode } = await run({
      "m.ts": `throw new Error("macro module threw");\nexport function value() {\n  return 1;\n}\n`,
      "with-macro.ts": withMacro,
      "importer.ts": `import { inlined } from "./with-macro.ts";\nexport const seen = inlined + "!";\n`,
      "index.ts": index,
    });
    expect(stderr).toContain("error: macro module threw");
    expect({ lines, exitCode }).toEqual({ lines: [""], exitCode: 1 });
  });

  // What the macro started and did not await is still parked when the macro returns. It moves to the
  // require()'s queue, so the import() completes. Where its output lands relative to the program's is
  // not fixed.
  test("a macro that starts an import() and does not await it", async () => {
    const { lines, stderr, exitCode } = await run({
      "side.ts": `console.log("side evaluated");\nexport {};\n`,
      "m.ts": [
        `export function value() {`,
        `  import("./side.ts").then(() => console.log("side loaded"));`,
        `  return "from-macro";`,
        `}`,
      ].join("\n"),
      "with-macro.ts": withMacro,
      "importer.ts": `import { inlined } from "./with-macro.ts";\nexport const seen = inlined + "!";\n`,
      "index.ts": index,
    });
    expect({ lines: lines.sort(), stderr }).toEqual({
      lines: ["from-macro!", "side evaluated", "side loaded"],
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  // importer.ts has started to load shared.ts and node:path when the macro's module asks for them, so
  // the macro's load completes them, and importer.ts's own continuation for each runs inside the
  // macro's wait, while JSModuleLoader::innerModuleLoading still iterates importer.ts's requests up
  // the stack.
  test("with modules that the require() already started to load", async () => {
    const { lines, stderr, exitCode } = await run({
      "shared.ts": `globalThis.evaluations = (globalThis.evaluations ?? 0) + 1;\nexport const shared = "shared";\n`,
      "m.ts": [
        `import { shared } from "./shared.ts";`,
        `import { sep } from "node:path";`,
        `export function value() {`,
        `  return [shared, typeof sep].join("-");`,
        `}`,
      ].join("\n"),
      "with-macro.ts": withMacro,
      "importer.ts": [
        `import { shared } from "./shared.ts";`,
        `import { sep } from "node:path";`,
        `import { inlined } from "./with-macro.ts";`,
        `export const seen = [inlined, shared, typeof sep, globalThis.evaluations].join(" ");`,
      ].join("\n"),
      "index.ts": index,
    });
    expect({ lines, stderr }).toEqual({ lines: ["shared-string shared string 1"], stderr: "" });
    expect(exitCode).toBe(0);
  });

  // The macro's entry module loads the macro's file with import(). In the tests below the require()'s
  // graph already holds that file, and what would settle the file's own fetch or load promise is
  // parked in the require()'s queue. The import() must not wait for that promise.
  test("with the macro's file imported earlier by the same module", async () => {
    const { lines, stderr, exitCode } = await run({
      "m.ts": macro + `export const helper = "helper";\n`,
      "with-macro.ts": withMacro,
      "importer.ts": [
        `import { helper } from "./m.ts";`,
        `import { inlined } from "./with-macro.ts";`,
        `export const seen = inlined + "!" + helper;`,
      ].join("\n"),
      "index.ts": index,
    });
    expect({ lines, stderr }).toEqual({ lines: ["from-macro!helper"], stderr: "" });
    expect(exitCode).toBe(0);
  });

  // The macro's import() completes importer.ts's request for m.ts while importer.ts's request for
  // with-macro.ts is in progress. The failure of the second request must still fail the require().
  test("a macro that fails, with the macro's file imported earlier by the same module", async () => {
    const { lines, stderr, exitCode } = await run({
      "m.ts": [
        `export function value() {`,
        `  console.log("macro ran");`,
        `  throw new Error("macro threw");`,
        `}`,
        `export const helper = "helper";`,
      ].join("\n"),
      "with-macro.ts": withMacro,
      "importer.ts": [
        `import { helper } from "./m.ts";`,
        `import { inlined } from "./with-macro.ts";`,
        `export const seen = inlined + "!" + helper;`,
      ].join("\n"),
      "index.ts": index,
    });
    expect(stderr).toContain("with-macro.ts:2:24");
    expect({ lines, exitCode }).toEqual({ lines: ["macro ran"], exitCode: 1 });
  });

  test("with the macro's file imported earlier by an ancestor", async () => {
    const { lines, stderr, exitCode } = await run({
      "m.ts": macro + `export const helper = "helper";\n`,
      "with-macro.ts": withMacro,
      "child.ts": `import { inlined } from "./with-macro.ts";\nexport const child = inlined + "!";\n`,
      "importer.ts": [
        `import { helper } from "./m.ts";`,
        `import { child } from "./child.ts";`,
        `export const seen = child + helper;`,
      ].join("\n"),
      "index.ts": index,
    });
    expect({ lines, stderr }).toEqual({ lines: ["from-macro!helper"], stderr: "" });
    expect(exitCode).toBe(0);
  });

  // Each macro function has its own entry module, so the file is imported once per function. The
  // second import() finds the file in the list of modules that the realm already loaded.
  test("with two macros from a file that an ancestor imported earlier", async () => {
    const { lines, stderr, exitCode } = await run({
      "m.ts": macro + `export function other() {\n  return "other-macro";\n}\nexport const helper = "helper";\n`,
      "with-macro.ts": [
        `import { value, other } from "./m.ts" with { type: "macro" };`,
        `export const inlined = value() + "+" + other();`,
      ].join("\n"),
      "child.ts": `import { inlined } from "./with-macro.ts";\nexport const child = inlined + "!";\n`,
      "importer.ts": [
        `import { helper } from "./m.ts";`,
        `import { child } from "./child.ts";`,
        `export const seen = child + helper;`,
      ].join("\n"),
      "index.ts": index,
    });
    expect({ lines, stderr }).toEqual({ lines: ["from-macro+other-macro!helper"], stderr: "" });
    expect(exitCode).toBe(0);
  });

  test("with a macro from a builtin module that the same module imported earlier", async () => {
    const { lines, stderr, exitCode } = await run({
      "with-macro.ts": [
        `import { basename } from "node:path" with { type: "macro" };`,
        `export const inlined = basename("/a/from-macro");`,
      ].join("\n"),
      "importer.ts": [
        `import { sep } from "node:path";`,
        `import { inlined } from "./with-macro.ts";`,
        `export const seen = inlined + "!" + typeof sep;`,
      ].join("\n"),
      "index.ts": index,
    });
    expect({ lines, stderr }).toEqual({ lines: ["from-macro!string"], stderr: "" });
    expect(exitCode).toBe(0);
  });

  // A macro's module is transpiled without macro expansion. The require() has already transpiled
  // m.ts and shared.ts for the program, with their own macro calls inlined, and that source has to
  // stay the one that the program runs. A second transpile for the macro must not replace it.
  const two = `export function two() {\n  return { a: 2 };\n}\n`;

  test("with a macro's file that calls a macro itself, imported earlier by the same module", async () => {
    const { lines, stderr, exitCode } = await run({
      "two.ts": two,
      "m.ts": [
        `import { two } from "./two.ts" with { type: "macro" };`,
        `export const helper = two();`,
        `export function value() {`,
        `  return "from-macro";`,
        `}`,
      ].join("\n"),
      "with-macro.ts": withMacro,
      "importer.ts": [
        `import { helper } from "./m.ts";`,
        `import { inlined } from "./with-macro.ts";`,
        `export const seen = inlined + "!" + JSON.stringify(helper);`,
      ].join("\n"),
      "index.ts": index,
    });
    expect({ lines, stderr }).toEqual({ lines: [`from-macro!{"a":2}`], stderr: "" });
    expect(exitCode).toBe(0);
  });

  test("with a module that calls a macro, requested earlier, that the macro's module imports", async () => {
    const { lines, stderr, exitCode } = await run({
      "two.ts": two,
      "shared.ts": `import { two } from "./two.ts" with { type: "macro" };\nexport const shared = two();\n`,
      "m.ts": `import { shared } from "./shared.ts";\nexport function value() {\n  return "from-macro:" + shared.a;\n}\n`,
      "with-macro.ts": withMacro,
      "importer.ts": [
        `import { shared } from "./shared.ts";`,
        `import { inlined } from "./with-macro.ts";`,
        `export const seen = inlined + "!" + JSON.stringify(shared);`,
      ].join("\n"),
      "index.ts": index,
    });
    expect({ lines, stderr }).toEqual({ lines: [`from-macro:2!{"a":2}`], stderr: "" });
    expect(exitCode).toBe(0);
  });

  // The second request for shared.ts must not transpile it a second time.
  test("a module that two siblings import runs its macro once", async () => {
    const { lines, stderr, exitCode } = await run({
      "count.ts": `let calls = 0;\nexport function count() {\n  return ++calls;\n}\n`,
      "shared.ts": `import { count } from "./count.ts" with { type: "macro" };\nexport const calls = count();\n`,
      "a.ts": `import { calls } from "./shared.ts";\nexport const a = calls;\n`,
      "b.ts": `import { calls } from "./shared.ts";\nexport const b = calls;\n`,
      "importer.ts": `import { a } from "./a.ts";\nimport { b } from "./b.ts";\nexport const seen = a + " " + b;\n`,
      "index.ts": index,
    });
    expect({ lines, stderr }).toEqual({ lines: ["1 1"], stderr: "" });
    expect(exitCode).toBe(0);
  });

  // A require() in the macro is a graph load of its own. It links when the load promise of shared.ts
  // is fulfilled, and what fulfills that promise is parked in the outer require()'s queue, so the
  // require() reports shared.ts as an async module. 1.3.13 runs this.
  test.todo("a macro that require()s a module that the require() already started to load", async () => {
    const { lines, stderr, exitCode } = await run({
      "shared.ts": `export const shared = "shared";\n`,
      "m.ts": `export function value() {\n  return "from-macro:" + import.meta.require("./shared.ts").shared;\n}\n`,
      "with-macro.ts": withMacro,
      "child.ts": `import { inlined } from "./with-macro.ts";\nexport const child = inlined + "!";\n`,
      "importer.ts": [
        `import { shared } from "./shared.ts";`,
        `import { child } from "./child.ts";`,
        `export const seen = child + shared;`,
      ].join("\n"),
      "index.ts": index,
    });
    expect({ lines, stderr }).toEqual({ lines: ["from-macro:shared!shared"], stderr: "" });
    expect(exitCode).toBe(0);
  });
});

// A module that is not the entry point is transpiled on a worker thread, where no VM exists yet. The
// macro VM created there has to take the CLI's transform options, or the macro module never sees
// `--define`.
test("a macro in a module transpiled off the main thread sees --define", async () => {
  using dir = tempDir("macro-off-thread-define", {
    "m.ts": `export function mode() {\n  return process.env.MODE ?? "none";\n}\n`,
    "lib.ts": `import { mode } from "./m.ts" with { type: "macro" };\nexport const x = mode();\n`,
    "index.ts": `import { x } from "./lib.ts";\nconsole.log(x);\n`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--define", 'process.env.MODE:"prod"', "index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ lastLine: stdout.trim().split("\n").pop(), stderr }).toEqual({ lastLine: "prod", stderr: "" });
  expect(exitCode).toBe(0);
});

// `Bun.build()` parses on the process-wide worker pool. The macro VM a worker creates takes the
// options of the build that creates it and lives on after that build, so this runs in its own
// process: an earlier build in the same process would otherwise decide what the macro sees.
test("Bun.build() passes define and loader to the macro VM", async () => {
  using dir = tempDir("macro-build-api-options", {
    "entry.ts": `import { mode, banner } from "./macro.ts" with { type: "macro" };\nconsole.log(mode(), banner());\n`,
    "macro.ts": [
      `import banner_ from "./banner.dat";`,
      `export function mode() {\n  return process.env.MODE ?? "none";\n}`,
      `export function banner() {\n  return banner_;\n}`,
      ``,
    ].join("\n"),
    "banner.dat": "hello from a text loader",
    "build.ts": `
      const result = await Bun.build({
        entrypoints: ["./entry.ts"],
        target: "bun",
        define: { "process.env.MODE": '"prod"' },
        loader: { ".dat": "text" },
      });
      console.log(await result.outputs[0].text());
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
  expect({ lastLine: stdout.trim().split("\n").pop(), stderr }).toEqual({
    lastLine: `console.log("prod", "hello from a text loader");`,
    stderr: "",
  });
  expect(exitCode).toBe(0);
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
