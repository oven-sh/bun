import { escapeHTML } from "bun" with { type: "macro" };
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
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
    return { lines, stderr, exitCode, signalCode: proc.signalCode };
  }

  const entry = `import { m } from "./m.ts" with { type: "macro" };\nconsole.log("value", m());\n`;
  const macro = (...body: string[]) =>
    ["export function m() {", ...body.map(line => "  " + line), "  return 1;", "}"].join("\n");
  const leftover = macro(`setImmediate(() => console.log("settled"));`);
  const withMacro = `import { m } from "./m.ts" with { type: "macro" };\nexport const value = m();\n`;

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
    [
      // An immediate is queued on the loop current at setImmediate(), with no thread involved, and
      // its keep-alive is counted on the platform loop both loops share.
      "a setImmediate() inside the macro",
      leftover,
    ],
    [
      "a setImmediate() inside an async macro that settles in the same turn",
      [`export async function m() {`, `  setImmediate(() => console.log("settled"));`, `  return 1;`, `}`].join("\n"),
    ],
    ["a setImmediate() at the macro module's top level", `setImmediate(() => console.log("settled"));\n` + macro()],
    [
      "a chain of setImmediate() calls started inside the macro",
      macro(
        `let hops = 0;`,
        `setImmediate(function hop() {`,
        `  if (++hops < 3) setImmediate(hop);`,
        `  else console.log("settled");`,
        `});`,
      ),
    ],
    [
      "a second setImmediate() after one the macro awaited",
      [
        `export async function m() {`,
        `  await new Promise(resolve => setImmediate(resolve));`,
        `  setImmediate(() => console.log("settled"));`,
        `  return 1;`,
        `}`,
      ].join("\n"),
    ],
    [
      "a timers/promises setImmediate() inside the macro",
      `import { setImmediate } from "node:timers/promises";\n` +
        macro(`setImmediate().then(() => console.log("settled"));`),
    ],
    [
      "an unref'd setImmediate() the macro ref()s again",
      macro(`setImmediate(() => console.log("settled")).unref().ref();`),
    ],
  ];

  test.concurrent.each(unawaited)(
    "%s that it does not await still lets the process exit",
    async (_name, macroSource) => {
      await using server = Bun.serve({ port: 0, fetch: () => new Response("settled") });
      const { lines, stderr, exitCode } = await run(
        {
          "m.ts": macroSource,
          "index.ts": entry,
        },
        { MACRO_TEST_URL: server.url.href },
      );
      // The continuation runs on the macro loop if the work finishes while the macro is still being waited
      // on and on the regular loop otherwise, so its position relative to the entry module's output varies.
      expect({ lines: lines.sort(), stderr }).toEqual({ lines: ["settled", "value 1"], stderr: "" });
      expect(exitCode).toBe(0);
    },
  );

  // An immediate queued while a macro ran sits on the macro loop. The regular loop runs it from that
  // loop's own queue, after its own immediates of that turn. Until it has run, a later macro that awaits
  // it still reaches it. What its callback queues belongs to the regular loop.
  const laterMacro = {
    "m.ts": [
      `let started: Promise<string>;`,
      `export function first() {`,
      `  started = new Promise(resolve => setImmediate(resolve, "ready"));`,
      `  return 1;`,
      `}`,
      `export async function second() {`,
      `  return await started;`,
      `}`,
    ].join("\n"),
    "a.ts": `import { first } from "./m.ts" with { type: "macro" };\nexport const a = first();\n`,
    "b.ts": `import { second } from "./m.ts" with { type: "macro" };\nexport const b = second();\n`,
  };
  const leftovers: [name: string, files: Record<string, string>, lines: string[]][] = [
    [
      "in a require()d module runs",
      {
        "m.ts": leftover,
        "with-macro.ts": withMacro,
        "index.ts": `const { value } = require("./with-macro.ts");\nconsole.log("value", value);\n`,
      },
      ["value 1", "settled"],
    ],
    [
      "in a Worker's entry file runs and the Worker exits",
      {
        "m.ts": leftover,
        "worker.ts": entry,
        "index.ts": `new Worker(new URL("./worker.ts", import.meta.url).href);\n`,
      },
      ["value 1", "settled"],
    ],
    [
      "under Bun.Transpiler#transformSync runs",
      {
        "m.ts": leftover,
        "index.ts": [
          `const source = 'import { m } from "./m.ts" with { type: "macro" };\\nexport const value = m();\\n';`,
          `const output = new Bun.Transpiler({ loader: "ts" }).transformSync(source);`,
          `console.log("value", /value = (\\d+)/.exec(output)?.[1]);`,
        ].join("\n"),
      },
      ["value 1", "settled"],
    ],
    [
      "in a module imported while a plugin is registered runs",
      {
        "m.ts": leftover,
        "with-macro.ts": withMacro,
        "index.ts": [
          `Bun.plugin({`,
          `  name: "matches nothing",`,
          `  setup(build) {`,
          `    build.onLoad({ filter: /\\.nothing$/ }, () => ({ contents: "" }));`,
          `  },`,
          `});`,
          `const { value } = await import("./with-macro.ts");`,
          `console.log("value", value);`,
        ].join("\n"),
      },
      ["value 1", "settled"],
    ],
    [
      // A top-level await turns the loop through auto_tick, the other rows through auto_tick_active.
      "is run for a program that awaits it at top level",
      {
        "m.ts": macro(`globalThis.leftover = new Promise(resolve => setImmediate(resolve, "ready"));`),
        "index.ts": entry + `console.log(await globalThis.leftover);\n`,
      },
      ["value 1", "ready"],
    ],
    [
      "by a program timer that fired inside a macro's wait runs",
      {
        "m.ts": `export async function m() {\n  await globalThis.release.promise;\n  return 1;\n}\n`,
        "with-macro.ts": withMacro,
        "index.ts": [
          `globalThis.release = Promise.withResolvers();`,
          `setTimeout(() => {`,
          `  setImmediate(() => console.log("settled"));`,
          `  globalThis.release.resolve();`,
          `}, 1);`,
          `const { value } = require("./with-macro.ts");`,
          `console.log("value", value);`,
        ].join("\n"),
      },
      ["value 1", "settled"],
    ],
    [
      "runs while the program queues an immediate of its own on every turn",
      {
        "m.ts": macro(`setImmediate(() => (globalThis.settled = true));`),
        "index.ts":
          entry +
          [
            `let hops = 0;`,
            `setImmediate(function hop() {`,
            `  if (globalThis.settled || ++hops === 1000) console.log("program hops before it ran:", hops);`,
            `  else setImmediate(hop);`,
            `});`,
          ].join("\n"),
      },
      ["value 1", "program hops before it ran: 1"],
    ],
    [
      "and whose callback starts another macro runs, and so does what that macro left",
      {
        "m.ts": [
          `export function first() {`,
          `  setImmediate(() => {`,
          `    setImmediate(() => console.log("A"));`,
          `    console.log("second", globalThis.loadSecond());`,
          `    setImmediate(() => console.log("C"));`,
          `  });`,
          `  return 1;`,
          `}`,
          `export function second() {`,
          `  setImmediate(() => console.log("B"));`,
          `  return 2;`,
          `}`,
        ].join("\n"),
        "a.ts": laterMacro["a.ts"],
        "b.ts": laterMacro["b.ts"],
        "index.ts": `globalThis.loadSecond = () => require("./b.ts").b;\nconsole.log("first", require("./a.ts").a);\n`,
      },
      ["first 1", "second 2", "A", "C", "B"],
    ],
    [
      "does not leave the loop polling once it ran",
      {
        "m.ts": leftover,
        "index.ts":
          `import { getEventLoopStats } from "bun:internal-for-testing";\n` +
          entry +
          [
            `setTimeout(() => {`,
            `  const before = getEventLoopStats().iteration;`,
            `  // The measurement: a loop that does not block in its poll turns thousands of times in this window.`,
            `  setTimeout(() => console.log("idle", getEventLoopStats().iteration - before < 10), 100);`,
            `}, 1);`,
          ].join("\n"),
      },
      ["value 1", "settled", "idle true"],
    ],
    [
      "runs after the program's own immediates of that turn",
      { "m.ts": leftover, "index.ts": entry + `setImmediate(() => console.log("program"));\n` },
      ["value 1", "program", "settled"],
    ],
    [
      "and unref'd runs while a program timer holds the loop",
      {
        "m.ts": macro(`setImmediate(() => console.log("settled")).unref();`),
        "index.ts": entry + `setTimeout(() => console.log("timer"), 20);\n`,
      },
      ["value 1", "settled", "timer"],
    ],
    [
      "and unref'd runs once the program ref()s it",
      {
        "m.ts": macro(`globalThis.leftover = setImmediate(() => console.log("settled")).unref();`),
        "index.ts": entry + `globalThis.leftover.ref();\n`,
      },
      ["value 1", "settled"],
    ],
    [
      "does not run once the program clears it",
      {
        "m.ts": macro(`globalThis.leftover = setImmediate(() => console.log("settled"));`),
        "index.ts": entry + `clearImmediate(globalThis.leftover);\n`,
      },
      ["value 1"],
    ],
    [
      "and unref'd, cleared or disposed does not run and does not hold the process",
      {
        "m.ts": macro(
          `setImmediate(() => console.log("unref'd")).unref();`,
          `clearImmediate(setImmediate(() => console.log("cleared")));`,
          `setImmediate(() => console.log("disposed"))[Symbol.dispose]();`,
        ),
        "index.ts": entry,
      },
      ["value 1"],
    ],
    [
      "is still run by a later macro in the same file that awaits it",
      {
        ...laterMacro,
        "index.ts": `import { first, second } from "./m.ts" with { type: "macro" };\nconsole.log(first(), second());\n`,
      },
      ["1 ready"],
    ],
    [
      "is still run by a later macro that a program immediate starts",
      {
        ...laterMacro,
        "index.ts": `const { a } = require("./a.ts");\nsetImmediate(() => console.log(a, require("./b.ts").b));\n`,
      },
      ["1 ready"],
    ],
    [
      "is still run by a later macro that an fs callback starts",
      {
        ...laterMacro,
        "index.ts": [
          `import fs from "node:fs";`,
          `const { a } = require("./a.ts");`,
          `fs.stat(import.meta.dir, () => console.log(a, require("./b.ts").b));`,
        ].join("\n"),
      },
      ["1 ready"],
    ],
  ];

  test.concurrent.each(leftovers)("an immediate left on the macro loop %s", async (_name, files, expected) => {
    const { lines, stderr, exitCode, signalCode } = await run(files);
    expect({ lines, stderr }).toEqual({ lines: expected, stderr: "" });
    expect({ exitCode, signalCode }).toEqual({ exitCode: 0, signalCode: null });
  });

  test.concurrent("an immediate left on the macro loop that throws is reported and ends the process", async () => {
    const { lines, stderr, exitCode, signalCode } = await run({
      "m.ts": macro(`setImmediate(() => {`, `  throw new Error("leftover threw");`, `});`),
      "index.ts": entry,
    });
    expect(lines).toEqual(["value 1"]);
    expect(stderr).toContain("error: leftover threw");
    expect({ exitCode, signalCode }).toEqual({ exitCode: 1, signalCode: null });
  });

  // The leftover's callback writes to a sink, which registers its flush on the current loop, and then
  // throws. The checkpoint after the batch has to be the regular loop's: the timer, kept due by the
  // spin, reads the file before any later checkpoint runs. On Windows the flush is asynchronous.
  test.concurrent.skipIf(isWindows)(
    "an immediate left on the macro loop that throws takes its checkpoint on the regular loop",
    async () => {
      const { lines, stderr, exitCode, signalCode } = await run({
        "m.ts": macro(
          `setImmediate(() => {`,
          `  globalThis.sink = Bun.file("out.txt").writer();`,
          `  globalThis.sink.write("data");`,
          `  const until = performance.now() + 10;`,
          `  while (performance.now() < until);`,
          `  throw new Error("leftover threw");`,
          `});`,
        ),
        "index.ts": [
          `import { m } from "./m.ts" with { type: "macro" };`,
          `import fs from "node:fs";`,
          `process.on("uncaughtException", error => console.log("caught", error.message));`,
          `console.log("value", m());`,
          `setTimeout(() => {`,
          `  console.log("file", JSON.stringify(fs.readFileSync("out.txt", "utf8")));`,
          `  globalThis.sink.end();`,
          `}, 1);`,
        ].join("\n"),
      });
      expect({ lines, stderr }).toEqual({ lines: ["value 1", "caught leftover threw", 'file "data"'], stderr: "" });
      expect({ exitCode, signalCode }).toEqual({ exitCode: 0, signalCode: null });
    },
  );

  // Reads the keep-alive count in a process that stays alive, for five ends of a leftover. The
  // top-level awaits turn the loop through auto_tick.
  test.concurrent("the keep-alive of an immediate left on the macro loop is released in a live process", async () => {
    const stage = (name: string) =>
      `import { ${name} } from "./m.ts" with { type: "macro" };\nexport const value = ${name}();\n`;
    const { lines, stderr, exitCode, signalCode } = await run({
      "m.ts": [
        `export function ran() {`,
        `  setImmediate(() => {});`,
        `  return 1;`,
        `}`,
        `export function threw() {`,
        `  setImmediate(() => {`,
        `    throw new Error("leftover threw");`,
        `  });`,
        `  return 1;`,
        `}`,
        `export function chained() {`,
        `  let hops = 0;`,
        `  setImmediate(function hop() {`,
        `    if (++hops < 3) setImmediate(hop);`,
        `  });`,
        `  return 1;`,
        `}`,
        `export function cleared() {`,
        `  globalThis.leftover = setImmediate(() => {});`,
        `  return 1;`,
        `}`,
        `export function unrefd() {`,
        `  setImmediate(() => {}).unref();`,
        `  return 1;`,
        `}`,
      ].join("\n"),
      "ran.ts": stage("ran"),
      "threw.ts": stage("threw"),
      "chained.ts": stage("chained"),
      "cleared.ts": stage("cleared"),
      "unrefd.ts": stage("unrefd"),
      "index.ts": [
        `import { getEventLoopStats } from "bun:internal-for-testing";`,
        `process.on("uncaughtException", () => {});`,
        `const hold = setInterval(() => {}, 2 ** 30);`,
        `const baseline = getEventLoopStats().numPolls;`,
        `const held = () => getEventLoopStats().numPolls - baseline;`,
        `const turns = n =>`,
        `  new Promise(resolve =>`,
        `    setImmediate(function turn() {`,
        `      if (--n) setImmediate(turn);`,
        `      else resolve();`,
        `    }),`,
        `  );`,
        `const counts = {};`,
        `for (const name of ["ran", "threw", "chained", "cleared", "unrefd"]) {`,
        `  require("./" + name + ".ts");`,
        `  const queued = held();`,
        `  if (name === "cleared") clearImmediate(globalThis.leftover);`,
        `  await turns(5);`,
        `  const after = held();`,
        `  // A new immediate takes the keep-alive again only when the count is at zero, not below it.`,
        `  const next = setImmediate(() => {});`,
        `  counts[name] = { queued, after, next: held() };`,
        `  clearImmediate(next);`,
        `}`,
        `console.log(JSON.stringify(counts));`,
        `if (held() !== 0) process.exit(1);`,
        `clearInterval(hold);`,
      ].join("\n"),
    });
    expect({ counts: JSON.parse(lines.at(-1)!), stderr }).toEqual({
      counts: {
        ran: { queued: 1, after: 0, next: 1 },
        threw: { queued: 1, after: 0, next: 1 },
        chained: { queued: 1, after: 0, next: 1 },
        cleared: { queued: 1, after: 0, next: 1 },
        unrefd: { queued: 0, after: 0, next: 1 },
      },
      stderr: "",
    });
    expect({ exitCode, signalCode }).toEqual({ exitCode: 0, signalCode: null });
  });

  // A completion can reach the macro loop's queue, wake the platform loop and have that wake-up used
  // by the macro's own poll, all before the macro settles. The regular loop has to see it without
  // another wake-up: the listening socket keeps the loop alive with no timer armed, and the spin gives
  // the thread pool the time to post. Not concurrent: next to twenty other children the thread pool
  // posts after the spin, and the row then passes whether or not the loop looks.
  test("a completion left on the macro loop is adopted with no further wake-up", async () => {
    const { lines, stderr, exitCode, signalCode } = await run(
      {
        "m.ts": [
          `import fs from "node:fs";`,
          `export async function m() {`,
          `  const timer = new Promise(resolve => setTimeout(resolve, 50, 1));`,
          `  setImmediate(() => {`,
          `    fs.promises.stat(import.meta.dir).then(() => globalThis.settled());`,
          `    const until = performance.now() + 200;`,
          `    while (performance.now() < until);`,
          `  });`,
          `  return await timer;`,
          `}`,
        ].join("\n"),
        "with-macro.ts": withMacro,
        "index.ts": [
          `const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });`,
          `globalThis.settled = () => {`,
          `  console.log("settled");`,
          `  server.stop(true);`,
          `};`,
          `setImmediate(() => console.log("value", require("./with-macro.ts").value));`,
        ].join("\n"),
      },
      { BUN_GC_TIMER_DISABLE: "1" },
    );
    expect({ lines, stderr }).toEqual({ lines: ["value 1", "settled"], stderr: "" });
    expect({ exitCode, signalCode }).toEqual({ exitCode: 0, signalCode: null });
  });

  // `bun test` drains a file's immediates when the file is done. What a macro left in file A runs
  // there too, not while file B loads.
  test.concurrent("bun test runs an immediate left on the macro loop in the file that queued it", async () => {
    using dir = tempDir("macro-loops-test", {
      "m.ts": leftover,
      "with-macro.ts": withMacro,
      "a.test.ts": [
        `import { expect, test } from "bun:test";`,
        `test("a", () => {`,
        `  expect(require("./with-macro.ts").value).toBe(1);`,
        `});`,
      ].join("\n"),
      "b.test.ts": [
        `import { expect, test } from "bun:test";`,
        `console.log("b loads");`,
        `test("b", () => {`,
        `  expect(1).toBe(1);`,
        `});`,
      ].join("\n"),
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "./a.test.ts", "./b.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const lines = stdout.split("\n").filter(line => line === "settled" || line === "b loads");
    expect({ lines, passed: stderr.includes(" 2 pass"), failed: stderr.includes(" 0 fail") }).toEqual({
      lines: ["settled", "b loads"],
      passed: true,
      failed: true,
    });
    expect({ exitCode, signalCode: proc.signalCode }).toEqual({ exitCode: 0, signalCode: null });
  });

  // Observed with this shape: the child prints nothing and stays in the poll. The regular loop runs
  // the first hop before the timer fires, so the second hop is the regular loop's, and the wait of the
  // macro the timer starts ticks only the macro loop. The same holds for any loop-routed work a
  // leftover's callback starts (a fetch, an fs call), and since #39905 for cross-thread completions.
  test.todo("a later macro that awaits work a leftover's callback started on the regular loop", async () => {
    const { lines, stderr, exitCode, signalCode } = await run({
      "m.ts": [
        `let done: Promise<string>;`,
        `export function first() {`,
        `  done = new Promise(resolve => setImmediate(() => setImmediate(resolve, "ready")));`,
        `  return 1;`,
        `}`,
        `export async function second() {`,
        `  return await done;`,
        `}`,
      ].join("\n"),
      "a.ts": laterMacro["a.ts"],
      "b.ts": laterMacro["b.ts"],
      "index.ts": [
        `const { a } = require("./a.ts");`,
        `setTimeout(() => console.log(a, require("./b.ts").b), 0);`,
        `const until = performance.now() + 5;`,
        `while (performance.now() < until);`,
      ].join("\n"),
    });
    expect({ lines, stderr }).toEqual({ lines: ["1 ready"], stderr: "" });
    expect({ exitCode, signalCode }).toEqual({ exitCode: 0, signalCode: null });
  });

  // destroy() emits 'close' from a setImmediate(). Not concurrent: the child loads node:net, which takes
  // a debug build about two seconds alone and more than the test timeout next to twenty other children.
  test("the 'close' of a node:net socket a macro destroyed is emitted and the process exits", async () => {
    await using server = Bun.serve({ port: 0, fetch: () => new Response() });
    const { lines, stderr, exitCode, signalCode } = await run(
      {
        "m.ts": [
          `import net from "node:net";`,
          `export function m() {`,
          `  const { promise, resolve } = Promise.withResolvers();`,
          `  const socket = net.connect(Number(process.env.MACRO_TEST_PORT), "127.0.0.1", () => {`,
          `    socket.on("close", () => console.log("settled"));`,
          `    socket.destroy();`,
          `    resolve(1);`,
          `  });`,
          `  return promise;`,
          `}`,
        ].join("\n"),
        "index.ts": entry,
      },
      { MACRO_TEST_PORT: String(server.port) },
    );
    expect({ lines: lines.sort(), stderr }).toEqual({ lines: ["settled", "value 1"], stderr: "" });
    expect({ exitCode, signalCode }).toEqual({ exitCode: 0, signalCode: null });
  });

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

  // The same for an immediate the program queued before the wait: it stays on the regular loop, which
  // is why the macro loop has a queue of its own. The macro awaits two immediates of its own.
  test.concurrent("a program immediate queued before a macro's wait does not run inside it", async () => {
    const { lines, stderr, exitCode } = await run({
      "m.ts": [
        `export async function probe() {`,
        `  await new Promise(resolve => setImmediate(resolve));`,
        `  await new Promise(resolve => setImmediate(resolve));`,
        `  return JSON.stringify(globalThis.log);`,
        `}`,
      ].join("\n"),
      "with-macro.ts": `import { probe } from "./m.ts" with { type: "macro" };\nexport const seen = probe();\n`,
      "index.ts": [
        `globalThis.log = [];`,
        `setImmediate(() => globalThis.log.push("program"));`,
        `const { seen } = require("./with-macro.ts");`,
        `globalThis.log.push("required");`,
        `setImmediate(() => console.log(seen, JSON.stringify(globalThis.log)));`,
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
