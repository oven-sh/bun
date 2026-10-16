import { escapeHTML } from "bun" with { type: "macro" };
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir, type DirectoryTree } from "harness";
import { copyFileSync, existsSync, lstatSync, mkdirSync, realpathSync, renameSync, symlinkSync } from "node:fs";
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
} from "./macro.ts" with { type: "macro" };

import * as macros from "./macro.ts" with { type: "macro" };

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

// This file used `assert` for its own imports until TypeScript 7 made that a syntax error (TS2880).
test("the `assert { type: 'macro' }` spelling works for every form of import", async () => {
  using dir = tempDir("macro-import-assertion", {
    "macro.ts": `export function identity(arg: any) {\n  return arg;\n}\nexport default function () {\n  return "default";\n}\n`,
    "index.ts": `
      import { escapeHTML } from "bun" assert { type: "macro" };
      import defaultMacro, { identity, identity as alias, default as defaultAlias } from "./macro.ts" assert { type: "macro" };
      import * as macros from "./macro.ts" assert { type: "macro" };
      console.log(JSON.stringify([escapeHTML("<a>"), defaultMacro(), identity(1), alias(2), defaultAlias(), macros.identity(3)]));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--no-bundle", "index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // Every call is replaced by its result, so the macros ran at transpile time. Debug builds print
  // "[macro] call identity" to stdout first, so only the tail of stdout is matched.
  expect({ stdout: stdout.trim(), stderr, exitCode }).toMatchObject({
    stdout: expect.stringMatching(
      /console\.log\(JSON\.stringify\(\["&lt;a&gt;", "default", 1, 2, "default", 3\]\)\);$/,
    ),
    exitCode: 0,
  });
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

// A macro's `await` is serviced by the VM's macro event loop, so completions have to be routed by which
// loop was current when their work started: what the macro started goes to the macro loop (or the wait
// hangs), what the program started stays on the regular loop (or program callbacks run mid-transpile),
// and whatever a macro started but did not await is adopted by the regular loop once the macro returns
// (or it is stranded and its keep-alive holds the process open). These run the macro in the main VM:
// the entry file's macros, or a module require()d so it transpiles on the main thread.
describe("event loop routing around macros", () => {
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

// A dependency must not run code at build time, so a macro call in installed package code is
// refused. `bun install --backend=symlink` keeps the files of a package in the install cache and
// links each one into node_modules. The real path of such a file has no node_modules segment.
describe("macro calls in installed package code", () => {
  const refused = "For security reasons, macros cannot be run from node_modules.";

  const packageFiles = (name: string): DirectoryTree => ({
    "package.json": JSON.stringify({ name, version: "1.0.0", main: "index.js" }),
    "m.js": `
      import { writeFileSync } from "node:fs";
      export function stamp() {
        writeFileSync(process.env.MACRO_MARKER, "macro executed");
        return "INLINED_RESULT";
      }
    `,
    "index.js": `
      import { stamp } from "./m.js" with { type: "macro" };
      export default stamp();
    `,
    "tagged.js": `
      import { stamp } from "./m.js" with { type: "macro" };
      export default stamp\`\`;
    `,
    "relative.js": `export { default } from "./lib/inner.js";`,
    "lib": {
      "inner.js": `
        import { stamp } from "../m.js" with { type: "macro" };
        export default stamp();
      `,
    },
    "dead.js": `
      import { stamp } from "./m.js" with { type: "macro" };
      export default false ? stamp() : "DEAD_BRANCH";
    `,
  });

  const appFiles: DirectoryTree = {
    "call.js": `import v from "dep"; console.log(v);`,
    "tagged.js": `import v from "dep/tagged.js"; console.log(v);`,
    "relative.js": `import v from "dep/relative.js"; console.log(v);`,
    "dead.js": `import v from "dep/dead.js"; console.log(v);`,
  };

  // Puts every file of `from` into `to`, as a link to the file or as a copy of it.
  function place(layout: "linked" | "copied", from: string, to: string) {
    for (const file of new Bun.Glob("**").scanSync({ cwd: from })) {
      mkdirSync(path.dirname(path.join(to, file)), { recursive: true });
      if (layout === "linked") symlinkSync(path.join(from, file), path.join(to, file));
      else copyFileSync(path.join(from, file), path.join(to, file));
    }
  }

  // "linked" is the layout of `bun install --backend=symlink`: a real directory in node_modules
  // whose files are links to a store outside it. "copied" is the layout of the default backend.
  function install(layout: "linked" | "copied", app: DirectoryTree = {}) {
    const dir = tempDir(`macro-guard-${layout}`, {
      store: { dep: packageFiles("dep") },
      app: { ...appFiles, ...app },
    });
    place(layout, path.join(String(dir), "store", "dep"), path.join(String(dir), "app", "node_modules", "dep"));
    return dir;
  }

  async function bun(cwd: string, ...args: string[]) {
    const marker = path.join(cwd, "MACRO_RAN");
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      env: { ...bunEnv, MACRO_MARKER: marker },
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode, macroRan: existsSync(marker) };
  }

  const isRefused = { stderr: expect.stringContaining(refused), exitCode: 1, macroRan: false };

  // The package as an npm tarball.
  async function writeTarball(file: string) {
    const entries: Record<string, string> = {};
    const add = (tree: DirectoryTree, prefix: string) => {
      for (const [name, value] of Object.entries(tree)) {
        if (typeof value === "string") entries[prefix + name] = value;
        else add(value as DirectoryTree, `${prefix}${name}/`);
      }
    };
    add(packageFiles("dep"), "package/");
    await Bun.Archive.write(file, entries, { compress: "gzip" });
  }

  // The layout that the path test already refuses. Both macro call sites must keep that test.
  test.concurrent.each([
    ["a call", "call.js"],
    ["a tagged template", "tagged.js"],
  ])("copied into node_modules: bun build refuses %s", async (_, entry) => {
    using dir = install("copied");
    const app = path.join(String(dir), "app");
    expect(await bun(app, "build", `./${entry}`, "--outdir", "out")).toMatchObject(isRefused);
  });

  // Windows needs a privilege to create a file link, and `bun install` does not write this layout there.
  describe.skipIf(isWindows)("linked into node_modules", () => {
    test.concurrent.each([
      ["a call", "call.js"],
      ["a tagged template", "tagged.js"],
      ["a call in a file that the package reaches by a relative import", "relative.js"],
      ["a call in a package file that is the entry point", "node_modules/dep/index.js"],
    ])("bun build refuses %s", async (_, entry) => {
      using dir = install("linked");
      const app = path.join(String(dir), "app");
      expect(await bun(app, "build", `./${entry}`, "--outdir", "out")).toMatchObject(isRefused);
    });

    test.concurrent("bun run refuses the macro", async () => {
      using dir = install("linked");
      const app = path.join(String(dir), "app");
      expect(await bun(app, "run", "./call.js")).toMatchObject(isRefused);
    });

    test.concurrent("Bun.build refuses the macro", async () => {
      using dir = install("linked", {
        "build.ts": `
          const result = await Bun.build({ entrypoints: ["./call.js"], outdir: "./out", throw: false });
          console.log(JSON.stringify({ success: result.success, logs: result.logs.map(l => l.message) }));
        `,
      });
      const app = path.join(String(dir), "app");
      const { stdout, stderr, exitCode, macroRan } = await bun(app, "run", "build.ts");
      expect({ result: JSON.parse(stdout.trim().split("\n").pop()!), stderr, exitCode, macroRan }).toMatchObject({
        result: { success: false, logs: expect.arrayContaining([expect.stringContaining(refused)]) },
        exitCode: 0,
        macroRan: false,
      });
    });

    test.concurrent("--no-macros is reported before the package check", async () => {
      using dir = install("linked");
      const app = path.join(String(dir), "app");
      const result = await bun(app, "build", "--no-macros", "./call.js", "--outdir", "out");
      expect(result).toMatchObject({ stderr: expect.stringContaining("Macros are disabled"), exitCode: 1 });
      expect(result).toMatchObject({ stderr: expect.not.stringContaining(refused), macroRan: false });
    });

    test.concurrent("a call in dead code is removed without an error", async () => {
      using dir = install("linked");
      const app = path.join(String(dir), "app");
      expect(await bun(app, "build", "./dead.js", "--outdir", "out")).toMatchObject({ exitCode: 0, macroRan: false });
      expect(await Bun.file(path.join(app, "out", "dead.js")).text()).toContain("DEAD_BRANCH");
    });
  });

  test.concurrent.skipIf(isWindows)("bun install --backend=symlink: bun build refuses the macro", async () => {
    using dir = tempDir("macro-guard-symlink-backend", {
      app: { ...appFiles, "package.json": JSON.stringify({ name: "app", dependencies: { dep: "file:../dep.tgz" } }) },
    });
    const root = String(dir);
    const app = path.join(root, "app");
    await writeTarball(path.join(root, "dep.tgz"));

    await using install = Bun.spawn({
      cmd: [bunExe(), "install", "--backend=symlink"],
      env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: path.join(root, "cache") },
      cwd: app,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [installStdout, installStderr, installExitCode] = await Promise.all([
      install.stdout.text(),
      install.stderr.text(),
      install.exited,
    ]);
    expect({ installStdout, installStderr, installExitCode }).toMatchObject({ installExitCode: 0 });
    const installed = path.join(app, "node_modules", "dep", "index.js");
    expect({
      isLink: lstatSync(installed).isSymbolicLink(),
      realPathIsInNodeModules: realpathSync(installed).includes("node_modules"),
    }).toEqual({ isLink: true, realPathIsInNodeModules: false });

    expect(await bun(app, "build", "./relative.js", "--outdir", "out")).toMatchObject(isRefused);
  });

  // With no node_modules directory, the runtime installs a package into the install cache and
  // runs it from there.
  test.concurrent("an auto-installed package: bun run refuses the macro", async () => {
    using dir = tempDir("macro-guard-auto-install", { app: { "call.js": appFiles["call.js"] } });
    const root = String(dir);
    const app = path.join(root, "app");
    const tarball = path.join(root, "dep-1.0.0.tgz");
    await writeTarball(tarball);
    await using registry = Bun.serve({
      port: 0,
      fetch(req) {
        if (req.url.endsWith(".tgz")) return new Response(Bun.file(tarball));
        const version = { name: "dep", version: "1.0.0", dist: { tarball: `${registry.url}dep/-/dep-1.0.0.tgz` } };
        return Response.json({ name: "dep", "dist-tags": { latest: "1.0.0" }, versions: { "1.0.0": version } });
      },
    });
    await Bun.write(path.join(app, "bunfig.toml"), Bun.TOML.stringify({ install: { registry: registry.url.href } }));

    const marker = path.join(app, "MACRO_RAN");
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "./call.js"],
      env: { ...bunEnv, MACRO_MARKER: marker, BUN_INSTALL_CACHE_DIR: path.join(root, "cache") },
      cwd: app,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode, macroRan: existsSync(marker) }).toMatchObject(isRefused);
  });

  test.concurrent.skipIf(isWindows)("a file linked directly into node_modules is refused", async () => {
    using dir = tempDir("macro-guard-loose-link", {
      store: packageFiles("dep"),
      app: { "entry.js": `import v from "loose.js"; console.log(v);`, node_modules: {} },
    });
    const app = path.join(String(dir), "app");
    symlinkSync(path.join(String(dir), "store", "index.js"), path.join(app, "node_modules", "loose.js"));
    expect(await bun(app, "build", "./entry.js", "--outdir", "out")).toMatchObject(isRefused);
  });

  // A git or GitHub dependency can hold links, so its package.json can be a link to another of
  // its files. The directory of that other file is not the directory of the package.
  test.concurrent.skipIf(isWindows).each(["meta", "node_modules/meta"])(
    "a linked package whose package.json is a link to %s/package.json is refused",
    async inner => {
      using dir = install("linked");
      const store = path.join(String(dir), "store", "dep");
      mkdirSync(path.join(store, inner), { recursive: true });
      renameSync(path.join(store, "package.json"), path.join(store, inner, "package.json"));
      symlinkSync(`${inner}/package.json`, path.join(store, "package.json"));
      const app = path.join(String(dir), "app");
      expect(await bun(app, "build", "./call.js", "--outdir", "out")).toMatchObject(isRefused);
    },
  );

  // A workspace package and a `bun link` package are one directory link to the project's own code.
  test.concurrent.skipIf(isWindows).each([
    ["", false],
    [" and has a package.json that is a link", true],
  ])("a package that is one directory link%s still runs its macros", async (_, linkedPackageJson) => {
    using dir = tempDir("macro-guard-workspace", {
      packages: { dep: packageFiles("dep") },
      app: appFiles,
      node_modules: {},
    });
    const root = String(dir);
    const dep = path.join(root, "packages", "dep");
    if (linkedPackageJson) {
      renameSync(path.join(dep, "package.json"), path.join(dep, "package.real.json"));
      symlinkSync("package.real.json", path.join(dep, "package.json"));
    }
    symlinkSync(dep, path.join(root, "node_modules", "dep"), "dir");
    const app = path.join(root, "app");
    expect(await bun(app, "build", "./relative.js", "--outdir", "out")).toMatchObject({ exitCode: 0, macroRan: true });
    expect(await Bun.file(path.join(app, "out", "relative.js")).text()).toContain("INLINED_RESULT");
  });

  // `"lib": "file:../.."` under the symlink backend: node_modules links to the files of a folder
  // that holds the project. `viaLink` names the entry point through a directory link to the
  // project, so the resolver knows two paths for it.
  test.concurrent.skipIf(isWindows).each([
    ["", false],
    [", also when a directory link leads to the project", true],
  ])("a linked folder that holds the project does not stop the project's own macros%s", async (_, viaLink) => {
    using dir = tempDir("macro-guard-parent-folder", {
      real: {
        lib: {
          ...packageFiles("lib"),
          examples: {
            app: {
              "entry.js": `
                import { stamp } from "../../m.js" with { type: "macro" };
                import fromLib from "lib";
                console.log(stamp(), fromLib);
              `,
            },
          },
        },
      },
    });
    const root = String(dir);
    const lib = path.join(root, "real", "lib");
    for (const file of ["package.json", "index.js", "m.js"]) {
      mkdirSync(path.join(lib, "examples", "app", "node_modules", "lib"), { recursive: true });
      symlinkSync(path.join(lib, file), path.join(lib, "examples", "app", "node_modules", "lib", file));
    }
    symlinkSync(path.join(root, "real"), path.join(root, "link"), "dir");
    const entry = path.join(root, viaLink ? "link" : "real", "lib", "examples", "app", "entry.js");
    expect(await bun(root, "build", entry, "--outdir", "out")).toMatchObject({ exitCode: 0, macroRan: true });
    expect((await Bun.file(path.join(root, "out", "entry.js")).text()).split("INLINED_RESULT").length - 1).toBe(2);
  });
});
