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

test("template string ascii", () => {
  expect(identity(`A${""}`)).toBe("A");
});

// A macro runs when this file is transpiled, so a call that fails cannot stand in a test body.
// identity(`©${""}`) needs the join of a non-ASCII piece: #42019.
test.todo("template string latin1");

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

// docs/bundler/macros.mdx, "Arguments": a macro argument may be a constant or the result of
// another macro. The runtime transpiler and `--minify-syntax` inline constants, plain
// `bun build` does not, so each mode takes a different path to the same answer.
describe("constant arguments", () => {
  const macroFile = `
    export function id(x) { return x; }
    export function getFoo() { return "foo"; }
    export function getObj() { return { a: 1, b: "two" }; }
    export function getUndefined() { return { a: undefined, list: [undefined, 2] }; }
  `;
  const header = `import { id, getFoo, getObj, getUndefined } from "./m.ts" with { type: "macro" };\n`;
  const identifierError = '"Cannot convert identifier to JS. Try a statically-known value" error in macro';
  const argumentError = '"Cannot convert argument type to JS" error in macro';

  async function bun(cwd: string, ...args: string[]) {
    await using proc = Bun.spawn({ cmd: [bunExe(), ...args], env: bunEnv, cwd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  const modes = [
    { mode: "bun run", build: null },
    { mode: "bun build", build: ["--target=bun"] },
    { mode: "bun build --minify-syntax", build: ["--target=bun", "--minify-syntax"] },
  ];
  const plainBuild = modes[1].build;

  // Debug builds print "[macro] call id" to stdout, so only the last line is compared.
  async function lastLineOf(
    entry: string,
    build: string[] | null,
    files: Record<string, string> = {},
    entryFile = "entry.ts",
  ) {
    using dir = tempDir("macro-constant-arguments", { "m.ts": macroFile, [entryFile]: entry, ...files });
    let file = entryFile;
    if (build) {
      const built = await bun(String(dir), "build", ...build, entryFile, "--outfile=out.js");
      if (built.exitCode !== 0) return built;
      file = "out.js";
    }
    const ran = await bun(String(dir), "run", file);
    return { ...ran, stdout: ran.stdout.trimEnd().split("\n").at(-1) };
  }

  const accepted = `
    import { fromOther } from "./other.ts";
    const out = [];
    const lead = 5;
    out.push(id(lead));
    const fromMacro = getFoo();
    out.push(id(fromMacro), id({ test: { animationName: fromMacro } }));
    const { a } = getObj();
    out.push(id(a));
    console.log("a statement");
    const N = 5;
    out.push(id(N), id(N + 1), id({ a: N, b: [N] }));
    out.push(id(id(N)), id([id(N), id({ N })]));
    const foo = getFoo();
    out.push(id(foo), id(\`https://example.com/\${foo}\`), id("a/" + foo));
    out.push(id("a/" + getFoo()), id(\`x\${getFoo()}y\`), id("a/" + getObj().b));
    const n = 42;
    out.push(id(\`n=\${n}\`));
    {
      const M = 7;
      out.push(id(N + M));
    }
    function inFunction() {
      console.log("a statement");
      const data = 40;
      return id(data);
    }
    out.push(inFunction());
    // A const that a macro argument and ordinary code both read.
    function mixed() {
      const K = 5;
      const q = id(K);
      console.log("a statement");
      const L = 6;
      return [q, K, id(L), L, L];
    }
    out.push(mixed(), fromOther);
    // A declaration in an argument that folds away.
    out.push(id(typeof (() => { console.log("a statement"); const y = 5; return id(y); })));
    console.log(JSON.stringify(out));
  `;
  const acceptedFiles = {
    "other.ts": `
      import { id } from "./m.ts" with { type: "macro" };
      console.log("a statement");
      const K = 9;
      export const fromOther = [id(K), K];
    `,
  };
  const acceptedOutput = JSON.stringify([
    5,
    "foo",
    { test: { animationName: "foo" } },
    1,
    5,
    6,
    { a: 5, b: [5] },
    5,
    [5, { N: 5 }],
    "foo",
    "https://example.com/foo",
    "a/foo",
    "a/foo",
    "xfooy",
    "a/two",
    "n=42",
    12,
    40,
    [5, 5, 6, 6, 6],
    [9, 9],
    "function",
  ]);

  test.concurrent.each(modes)("$mode accepts a const in any statement position", async ({ build }) => {
    expect(await lastLineOf(header + accepted, build, acceptedFiles)).toEqual({
      stdout: acceptedOutput,
      stderr: expect.any(String),
      exitCode: 0,
    });
  });

  test.concurrent("Bun.build and Bun.Transpiler accept a const in any statement position", async () => {
    using dir = tempDir("macro-constant-arguments-api", {
      "m.ts": macroFile,
      "entry.ts": header + accepted.replace(`import { fromOther } from "./other.ts";`, "const fromOther = [9, 9];"),
      "api.ts": `
        const built = await Bun.build({ entrypoints: ["./entry.ts"], target: "bun", outdir: "./dist" });
        if (!built.success) throw new AggregateError(built.logs);
        const source = await Bun.file("entry.ts").text();
        const options = { "default": {}, "inline": { inline: true }, "minify": { minify: { syntax: true } } };
        for (const [name, option] of Object.entries(options)) {
          await Bun.write("transpiled-" + name + ".js", new Bun.Transpiler({ loader: "ts", ...option }).transformSync(source));
        }
        for (const file of ["./dist/entry.js", ...Object.keys(options).map(name => "./transpiled-" + name + ".js")]) {
          await import(file);
        }
      `,
    });
    const { stdout, stderr, exitCode } = await bun(String(dir), "run", "api.ts");
    expect({ lines: stdout.split("\n").filter(line => line.startsWith("[5,")), stderr, exitCode }).toEqual({
      lines: [acceptedOutput, acceptedOutput, acceptedOutput, acceptedOutput],
      stderr: expect.any(String),
      exitCode: 0,
    });
  });

  test.concurrent("the example of docs/bundler/macros.mdx builds", async () => {
    const files = {
      "getText.ts": `export function getText(url) { return "<" + url + ">"; }`,
      "getFoo.ts": `export function getFoo() { return "foo"; }`,
    };
    const entry = `
      import { getText } from "./getText.ts" with { type: "macro" };
      import { getFoo } from "./getFoo.ts" with { type: "macro" };

      export function howLong() {
        // this works because getFoo() is statically known
        const foo = getFoo();
        const text = getText(\`https://example.com/\${foo}\`);
        console.log("The page is", text.length, "characters long");
      }
      howLong();
    `;
    expect(await lastLineOf(entry, plainBuild, files)).toEqual({
      stdout: "The page is 25 characters long",
      stderr: expect.any(String),
      exitCode: 0,
    });
  });

  // A macro call is replaced when the file is built. It does not read the binding when the
  // program runs, so the TDZ of the const does not apply to it: plain JS throws in both.
  test.concurrent.each(modes)("$mode: an argument is a value at build time", async ({ build }) => {
    const entry = `
      const early = below();
      console.log("a statement");
      const N = 5;
      function below() { return id(N); }
      function pick(x) {
        switch (x) {
          case 1:
            console.log("a statement");
            const K = 7;
            return 0;
          case 2:
            return id(K);
        }
      }
      console.log(JSON.stringify([early, pick(2)]));
    `;
    expect(await lastLineOf(header + entry, build)).toMatchObject({ stdout: "[5,7]", exitCode: 0 });
  });

  // The macro gives undefined, so the binding holds its default when the program runs.
  test.concurrent.each(modes)("$mode: a binding that takes its default holds the default", async ({ build }) => {
    const entry = `
      const { a = 5 } = getUndefined();
      const { list: [x = 8, y = 9] } = getUndefined();
      const { a: random = Math.random() } = getUndefined();
      const { a: object = getObj() } = getUndefined();
      let { a: changed = 5 } = getUndefined();
      changed = 9;
      const own = [typeof random, random === random, object.a, object === object, changed];
      console.log(JSON.stringify([id(a), a, id(x), x, id(y), y, ...own]));
    `;
    expect(await lastLineOf(header + entry, build)).toMatchObject({
      stdout: '[5,5,8,8,2,2,"number",true,1,true,9]',
      exitCode: 0,
    });
  });

  // A module is strict, so a var that a direct eval declares stays inside the eval.
  test.concurrent.each(modes)("$mode: a direct eval does not hide the const", async ({ build }) => {
    const entry = `
      function helper(s) { return eval(s); }
      console.log("a statement");
      const N = 5;
      const out = [id(N), helper("1 + 1")];
      { eval("0"); out.push(id(N)); }
      function sameFunction() { eval("var N = 7"); return id(N); }
      out.push(sameFunction());
      console.log(JSON.stringify(out));
    `;
    expect(await lastLineOf(header + entry, build, {}, "entry.js")).toMatchObject({ stdout: "[5,2,5,5]", exitCode: 0 });
  });

  test.concurrent("a joined flag name in an argument is read whole", async () => {
    const entry = `
      import { feature } from "bun:bundle";
      console.log("a statement");
      const F = "SUPER";
      console.log(id(feature(F + "_SECRET") ? 1 : 2));
    `;
    const [whole, firstPiece] = await Promise.all([
      lastLineOf(header + entry, [...plainBuild, "--feature=SUPER_SECRET"]),
      lastLineOf(header + entry, [...plainBuild, "--feature=SUPER"]),
    ]);
    expect(whole).toMatchObject({ stdout: "1", exitCode: 0 });
    expect(firstPiece).toMatchObject({ stdout: "2", exitCode: 0 });
  });

  const rejected = [
    { what: "a let binding", entry: `let N = 5; console.log(id(N));`, error: identifierError },
    { what: "a var binding", entry: `var N = 5; console.log(id(N));`, error: identifierError },
    {
      what: "a let binding that holds a macro result",
      entry: `let x = getFoo(); x = "bar"; console.log(id(x));`,
      error: identifierError,
    },
    {
      what: "a const with a value that is not known",
      entry: `const foo = Math.random() ? "foo" : "bar"; console.log(id(foo));`,
      error: identifierError,
    },
    {
      what: "a template that holds such a const",
      entry: `const foo = Math.random() ? "foo" : "bar"; console.log(id(\`https://example.com/\${foo}\`));`,
      error: argumentError,
    },
    { what: "a loop const", entry: `for (const i of [1, 2]) console.log(id(i));`, error: identifierError },
    {
      what: "an array const with an item that is not known",
      entry: `const c = [getFoo(), Math.random()]; console.log(id(c));`,
      error: identifierError,
    },
    {
      what: "a const that stands below the call",
      entry: `const g = () => id(N); const N = 5; console.log(g());`,
      error: identifierError,
    },
    {
      what: "a function that declares a const",
      entry: `console.log(id(() => { const K = 1; return K; }));`,
      error: argumentError,
    },
    {
      what: "a let binding that holds a macro result, in an argument that folds away",
      entry: `console.log(id(typeof (() => { let x = getFoo(); x = "bar"; return id(x); })));`,
      error: identifierError,
    },
    // The program can change the object after the macro returned it.
    {
      what: "an object that a macro returned, by name",
      entry: `const o = getObj(); o.a = 2; console.log(id(o));`,
      error: identifierError,
    },
    // The binding takes its default, and the build does not know that value.
    {
      what: "a binding that takes a default that is not known",
      entry: `const { a = Math.random() } = getUndefined(); console.log(id(a));`,
      error: identifierError,
    },
    // The program reads a property that the object does not have from its prototype.
    {
      what: "a binding of a property that the macro result does not have",
      entry: `const { toString = 5 } = getObj(); console.log(id(toString));`,
      error: identifierError,
    },
    {
      what: "a const that a with object can shadow",
      entry: `console.log("a statement"); const N = 5; with ({ N: 6 }) { console.log(id(N)); }`,
      error: identifierError,
      entryFile: "entry.js",
    },
  ];

  test.concurrent.each(rejected)("bun build rejects $what", async ({ entry, error, entryFile }) => {
    expect(await lastLineOf(header + entry, plainBuild, {}, entryFile)).toMatchObject({
      stderr: expect.stringContaining(error),
      exitCode: 1,
    });
  });

  // The table that macro arguments read must not change what happens to other code in the
  // same file: a const below a statement is not inlined there, so its TDZ error stays.
  test.concurrent("code outside the arguments keeps the rules of the inliner", async () => {
    const tdz = `
      let result;
      try { read(); result = "no throw"; } catch (e) { result = e.name; }
      const N = 5;
      function read() { return N; }
      console.log(result, id(N));
    `;
    const assignment = `
      console.log("a statement");
      const N = 5;
      N = 6;
      console.log(id(N));
    `;
    const specifiers = `
      const x = "foo";
      console.log(id(x));
      export const p = () => import(\`./a/\${x}.js\`);
      export const q = () => require(\`./b/\${x}.js\`);
      export const r = () => require("./c/" + getFoo() + ".js");
    `;
    using dir = tempDir("macro-constant-arguments-specifiers", { "m.ts": macroFile, "entry.ts": header + specifiers });
    const [tdzResult, assignmentResult, specifiersResult] = await Promise.all([
      lastLineOf(header + tdz, null),
      lastLineOf(header + assignment, null),
      bun(String(dir), "build", "--target=bun", "entry.ts"),
    ]);
    expect(tdzResult).toMatchObject({ stdout: "ReferenceError 5", exitCode: 0 });
    expect(assignmentResult).toMatchObject({
      stderr: expect.stringContaining('This assignment will throw because "N" is a constant'),
      exitCode: 1,
    });
    expect(specifiersResult).toMatchObject({
      stdout: expect.stringMatching(
        /import\(`\.\/a\/\$\{x\}\.js`\)[^]*require\(`\.\/b\/\$\{x\}\.js`\)[^]*require\("\.\/c\/" \+ "foo" \+ "\.js"\)/,
      ),
      exitCode: 0,
    });
  });

  // Under inlining Bun puts a macro result at every use of a let, a var or a destructured
  // binding, and a function that an argument holds can fold away.
  test.concurrent.each([modes[0], modes[2]])("$mode keeps what inlining accepts", async ({ build }) => {
    const entry = `
      let x = getFoo();
      var v = getFoo();
      let { a } = getObj();
      const base = "https://example.com";
      const url = base + "/api";
      console.log(JSON.stringify([
        id(x), id(v), id(a), id(url),
        id(typeof (() => { const y = getFoo(); return id(y); })),
        id(typeof function () { const K = 5; return id(K); }),
        id((() => { const y = getFoo(); return id(y); }, 5)),
        id(typeof (() => { console.log("a statement"); const K = 5; return id(K); })),
      ]));
    `;
    expect(await lastLineOf(header + entry, build)).toMatchObject({
      stdout: '["foo","foo",1,"https://example.com/api","function","function",5,"function"]',
      exitCode: 0,
    });
  });

  // The join of a non-ASCII piece belongs to the string folds: #42019.
  test.todo("a template or a + with a non-ASCII piece");
});
