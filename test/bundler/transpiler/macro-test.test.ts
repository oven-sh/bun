import { escapeHTML } from "bun" with { type: "macro" };
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, forEachLine, tempDir } from "harness";
import { existsSync, symlinkSync, writeFileSync } from "node:fs";
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

async function bun(args: string[], files: Record<string, string>, env: Record<string, string> = {}) {
  using dir = tempDir("macro-run", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    env: { ...bunEnv, ...env },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { lines: stdout.trim().split("\n"), stderr, exitCode, signalCode: proc.signalCode };
}

async function run(files: Record<string, string>, env: Record<string, string> = {}) {
  const { lines, stderr, exitCode } = await bun(["run", "index.ts"], files, env);
  return { lines, stderr, exitCode };
}

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
  // Every call is replaced by its result, so the macros ran at transpile time.
  expect({ stdout: stdout.trim(), stderr, exitCode }).toMatchObject({
    stdout: `console.log(JSON.stringify(["&lt;a&gt;", "default", 1, 2, "default", 3]));`,
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
  // the diff if the child aborts.
  expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toMatchObject({
    stdout: "200000\n",
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

// A `const` initialized with a macro result is inlined at each use, so every use shares one AST object.
test("spreading a macro result into JSX doesn't change the other uses of its const", async () => {
  using dir = tempDir("macro-jsx-spread-run", {
    "m.ts": `export function m() {\n  return { a: 1, b: [2] };\n}\n`,
    "node_modules/react/jsx-dev-runtime.js": `export const jsxDEV = (type, props) => props;\n`,
    "index.jsx": [
      `import { m } from "./m.ts" with { type: "macro" };`,
      `const x = m();`,
      `const before = x;`,
      `const child = <div {...x}>kid</div>;`,
      `const spread = <div {...x} />;`,
      `console.log(JSON.stringify([before, child, spread, x]));`,
      ``,
    ].join("\n"),
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "index.jsx"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.trim().split("\n").pop()).toBe(
    `[{"a":1,"b":[2]},{"a":1,"b":[2],"children":"kid"},{"a":1,"b":[2]},{"a":1,"b":[2]}]`,
  );
  expect(exitCode).toBe(0);
});

// A value returned only by a getter can be collected once the walk moves on, and a later value can reuse its address.
test("inlines every new array, object or promise returned by a macro result's getters", async () => {
  const count = 12;
  using dir = tempDir("macro-getter-made-values", {
    "m.ts": `
      // Each read of target[i] creates a new value. Every third read runs the GC first.
      function lazy(target: object, make: (i: number) => unknown) {
        for (let i = 0; i < ${count}; i++) {
          Object.defineProperty(target, i, {
            enumerable: true,
            get() {
              if (i % 3 === 0) Bun.gc(true);
              return make(i);
            },
          });
        }
        return target;
      }
      export function objects() {
        return lazy({}, i => ({ id: i }));
      }
      export function arrays() {
        return lazy([], i => [i, i + 1]);
      }
      export function promises() {
        return lazy({}, i => Promise.resolve(i));
      }
    `,
    "index.ts": `
      import { objects, arrays, promises } from "./m.ts" with { type: "macro" };
      console.log(JSON.stringify({ objects: objects(), arrays: arrays(), promises: promises() }));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const indices = Array.from({ length: count }, (_, i) => i);
  expect(JSON.parse(stdout.trim().split("\n").pop()!)).toEqual({
    objects: Object.fromEntries(indices.map(i => [i, { id: i }])),
    arrays: indices.map(i => [i, i + 1]),
    promises: Object.fromEntries(indices.map(i => [i, i])),
  });
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

test.concurrent("the JSON of a Blob or Response is still inlined after a later macro collects it", async () => {
  const result = await run({
    "m.ts": `
      const json = (letter: string) => JSON.stringify({ text: Buffer.alloc(4096, letter).toString() });
      export const blob = (letter: string) => new Blob([json(letter)], { type: "application/json" });
      export const response = (letter: string) =>
        new Response(json(letter), { headers: { "content-type": "application/json" } });
      const kept: Blob[] = [];
      export function collect() {
        Bun.gc(true);
        // These take the memory that was freed.
        for (let i = 0; i < 64; i++) kept.push(blob("Z"));
        return 0;
      }
    `,
    "index.ts": `
      import { blob, response, collect } from "./m.ts" with { type: "macro" };
      const values = [blob("a"), response("b"), blob("c"), response("d"), blob("e"), response("f")];
      collect();
      console.log(values.map(({ text }) => text.length + [...new Set(text)].join("")).join());
    `,
  });
  expect(result).toEqual({ lines: ["4096a,4096b,4096c,4096d,4096e,4096f"], stderr: "", exitCode: 0 });
});

// Both parse an empty JSON document. A Worker parses the defines again.
test.concurrent("a macro that returns an empty JSON Blob doesn't change what an empty --define is", async () => {
  using dir = tempDir("macro-empty-json", {
    "m.ts": `export const empty = () => new Blob([], { type: "application/json" });`,
    "worker.ts": `const object = EMPTY;\nobject.key = 1;\nconsole.log(object.key, object === object);`,
    "index.ts": `
      import { empty } from "./m.ts" with { type: "macro" };
      console.log(JSON.stringify(empty()));
      new Worker("./worker.ts");
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--define", "EMPTY=", "index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ lastLines: stdout.trim().split("\n").slice(-2), stderr, exitCode }).toEqual({
    lastLines: ["{}", "1 true"],
    stderr: "",
    exitCode: 0,
  });
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
  expect({ lastLine: stdout.trim().split("\n").pop(), stderr }).toEqual({
    lastLine: JSON.stringify([...expected, ...expected]),
    stderr: "",
  });
  expect(exitCode).toBe(0);
});

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
      // JSC's DeferredWorkTimer: the completion is delivered from a JSC helper thread.
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
      // The continuation runs on the macro thread, so its position relative to the entry module's output varies.
      expect({ lines: lines.sort(), stderr }).toEqual({ lines: ["settled", "value 1"], stderr: "" });
      expect(exitCode).toBe(0);
    },
  );

  // The program's digest finishes (microseconds, on the work queue) while the macro is parked in its
  // 200 ms wait. Its callback belongs to the program: it must run after require() returns.
  test.concurrent("a program completion that arrives during a macro waits for the macro to return", async () => {
    const { lines, stderr, exitCode } = await run({
      "m.ts": `export async function probe() {\n  await Bun.sleep(200);\n  return 1;\n}\n`,
      "with-macro.ts": `import { probe } from "./m.ts" with { type: "macro" };\nexport const value = probe();\n`,
      "index.ts": [
        `const log = [];`,
        `const digest = crypto.subtle.digest("SHA-256", new Uint8Array(4096)).then(() => log.push("program"));`,
        `const { value } = require("./with-macro.ts");`,
        `log.push("required");`,
        `await digest;`,
        `console.log(value, JSON.stringify(log));`,
      ].join("\n"),
    });
    expect({ lines, stderr }).toEqual({ lines: [`1 ["required","program"]`], stderr: "" });
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

describe.concurrent("the thread that runs macros", () => {
  const ok = (...lines: string[]) => ({ lines, stderr: "", exitCode: 0, signalCode: null });
  const calls = (name: string, from = "./m.ts") =>
    `import { ${name} } from ${JSON.stringify(from)} with { type: "macro" };\nexport const value = ${name}();\n`;
  const twoThreads = { UV_THREADPOOL_SIZE: "2" };
  const range = (length: number) => Array.from({ length }, (_, i) => i);
  const callers = (count: number, name: string) => ({
    ...Object.fromEntries(range(count).map(i => [`c${i}.ts`, calls(name)])),
    "all.ts":
      range(count)
        .map(i => `import { value as v${i} } from "./c${i}.ts";\n`)
        .join("") + `console.log(JSON.stringify([${range(count).map(i => `v${i}`)}].sort((a, b) => a - b)));\n`,
  });

  // Each of these has to have the value of the macro before it can return.
  const blocking: [name: string, setup: string, call: string][] = [
    ["require()", ``, `require("./calls.ts")`],
    ["transformSync()", `const text = readFileSync("calls.ts", "utf8");`, `new Bun.Transpiler().transformSync(text)`],
    ["scan()", `const text = readFileSync("calls.ts", "utf8");`, `new Bun.Transpiler().scan(text)`],
    [
      "require() of what a plugin loads",
      `Bun.plugin({ name: "p", setup(b) { b.onLoad({ filter: /\\.custom$/ }, () => ({ contents: readFileSync("calls.ts", "utf8"), loader: "ts" })); } });`,
      `require("./file.custom")`,
    ],
    ["require.extensions", `require.extensions[".custom"] = require.extensions[".ts"];`, `require("./file.custom")`],
  ];

  describe.each(["the main thread", "a Worker"])("on %s", thread => {
    test.each(blocking)("%s runs nothing of the program while it waits for a macro", async (_, setup, call) => {
      const program = `
        import { readFileSync } from "node:fs";
        ${setup}
        const log = [];
        const done = Promise.all([
          new Promise(resolve => setTimeout(resolve, 1)).then(() => log.push("timer")),
          new Promise(resolve => setImmediate(resolve)).then(() => log.push("immediate")),
          new Promise(resolve => process.nextTick(resolve)).then(() => log.push("tick")),
          Promise.resolve().then(() => log.push("microtask")),
        ]);
        ${call};
        console.log(JSON.stringify(log));
        await done;
      `;
      const result = await bun(["index.ts"], {
        // Due after the timer of the program.
        "m.ts": `export const later = () => new Promise(resolve => setTimeout(resolve, 10, 1));`,
        "calls.ts": calls("later"),
        "file.custom": calls("later"),
        "program.ts": program,
        "index.ts": thread === "a Worker" ? `new Worker("./program.ts");` : program,
      });
      expect(result).toEqual(ok("[]"));
    });
  });

  test("macros do not see the globals of the program, and the program does not see theirs", async () => {
    const result = await bun(["index.ts"], {
      "m.ts": `export function swap() {\n  globalThis.fromMacro = 1;\n  return typeof globalThis.fromProgram;\n}`,
      "calls.ts": calls("swap"),
      "index.ts": `globalThis.fromProgram = 1;\nconsole.log(require("./calls.ts").value, typeof globalThis.fromMacro);`,
    });
    expect(result).toEqual(ok("undefined undefined"));
  });

  describe("runs every macro in the same context", () => {
    const counter = `let count = 0;\nexport const next = () => ++count;`;
    const expected = JSON.stringify(range(16).map(i => i + 1));

    test("across the files of a program", async () => {
      expect(await bun(["all.ts"], { "m.ts": counter, ...callers(16, "next") })).toEqual(ok(expected));
    });

    test.each([
      ["bun build", `Bun.spawnSync([process.execPath, "build", "all.ts"]).stdout.toString()`],
      ["Bun.build()", `await (await Bun.build({ entrypoints: ["all.ts"] })).outputs[0].text()`],
    ])("across the files of %s", async (_, build) => {
      const files = { "m.ts": counter, ...callers(16, "next"), "index.ts": `(0, eval)(${build});` };
      expect(await bun(["index.ts"], files)).toEqual(ok(expected));
    });

    test("however the code that calls them is transpiled", async () => {
      const result = await bun(["index.ts"], {
        "m.ts": counter,
        "imported.ts": calls("next"),
        "required.ts": calls("next"),
        "realm.ts": calls("next"),
        "index.ts": `
          import { next } from "./m.ts" with { type: "macro" };
          const text = ${JSON.stringify(calls("next"))};
          const value = code => Number(code.match(/value = (\\d+)/)[1]);
          console.log(
            next(),
            (await import("./imported.ts")).value,
            require("./required.ts").value,
            value(new Bun.Transpiler().transformSync(text)),
            value(await new Bun.Transpiler().transform(text)),
            await new ShadowRealm().importValue(import.meta.dir + "/realm.ts", "value"),
          );
        `,
      });
      expect(result).toEqual(ok("1 2 3 4 5 6"));
    });

    test("but each Worker and each build has its own", async () => {
      const files = {
        "m.ts": counter,
        "calls.ts": calls("next"),
        "worker.ts": `import { value } from "./calls.ts";\npostMessage(value);`,
        "index.ts": `
          import { value } from "./calls.ts";
          const inWorker = () => new Promise(resolve => (new Worker("./worker.ts").onmessage = event => resolve(event.data)));
          const inBuild = async () => (await (await Bun.build({ entrypoints: ["calls.ts"] })).outputs[0].text()).match(/value = (\\d+)/)[1];
          console.log(value, await inWorker(), await inWorker(), await inBuild(), await inBuild());
        `,
      };
      expect(await bun(["index.ts"], files, twoThreads)).toEqual(ok("1 1 1 1 1"));
    });
  });

  test("each Bun.build() runs the macro that is on disk, with its own define", async () => {
    const files = {
      "calls.ts": calls("version"),
      "index.ts": `
        for (const version of [1, 2, 3]) {
          await Bun.write("m.ts", "export const version = () => [" + version + ", DEFINED].join();");
          const { outputs } = await Bun.build({ entrypoints: ["calls.ts"], define: { DEFINED: String(version * 10) } });
          console.log((await outputs[0].text()).match(/value = (.*);/)[1]);
        }
      `,
    };
    expect(await bun(["index.ts"], files, twoThreads)).toEqual(ok(`"1,10"`, `"2,20"`, `"3,30"`));
  });

  test.each(["--hot", "--watch", "build --watch"])("%s runs the macro again when its module changes", async flags => {
    const macro = (version: number) =>
      `import { dep } from "./dep.ts";\nlet calls = 0;\nexport const version = () => [${version}, dep, ++calls].join();`;
    using dir = tempDir("macro-reload", {
      "m.ts": macro(1),
      "dep.ts": `export const dep = "a";`,
      "calls.ts": calls("version"),
      "index.ts": `import { value } from "./calls.ts";\nconsole.log(value);`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...flags.split(" "), "--no-clear-screen", "index.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "inherit",
    });
    const steps: [value: string, file: string, contents: string][] = [
      ["1,a,1", "m.ts", macro(2)],
      ["2,a,1", "dep.ts", `export const dep = "b";`],
    ];
    const seen = new Set<string>();
    for await (const line of forEachLine(proc.stdout)) {
      const value = line.match(/\d,[ab],\d/)?.[0];
      if (value) seen.add(value);
      if (value === "2,b,1") break;
      if (value && value === steps[0]?.[0]) {
        const [, file, contents] = steps.shift()!;
        writeFileSync(path.join(String(dir), file), contents);
      }
    }
    expect([...seen]).toEqual(["1,a,1", "2,a,1", "2,b,1"]);
  });

  // More files wait for the macro than the pool has threads, and the macro waits for the pool.
  describe("a macro that awaits the thread pool", () => {
    const files = {
      "m.ts": `import { stat } from "node:fs/promises";\nexport const size = async () => (await stat(import.meta.dir + "/sized")).size;`,
      "sized": "12345",
      ...callers(8, "size"),
      "build.ts": `(0, eval)(await (await Bun.build({ entrypoints: ["all.ts"] })).outputs[0].text());`,
      "transform.ts": `
        const texts = await Promise.all(Array.from({ length: 8 }, () => new Bun.Transpiler().transform(${JSON.stringify(calls("size"))})));
        console.log(JSON.stringify(texts.map(text => Number(text.match(/value = (\\d+)/)[1]))));
      `,
    };
    test.each([
      ["imported files", "all.ts"],
      ["Bun.build()", "build.ts"],
      ["transform()", "transform.ts"],
    ])("finishes for %s", async (_, entry) => {
      expect(await bun([entry], files, twoThreads)).toEqual(ok("[5,5,5,5,5,5,5,5]"));
    });
  });

  test("asynchronous macros of different files overlap", async () => {
    const result = await bun(["all.ts"], {
      "m.ts": `
        const { promise, resolve } = Promise.withResolvers();
        let waiting = 0;
        export function meet() {
          if (++waiting === 2) resolve(waiting);
          // Until the other file has been read, this is all that says that the promise can settle.
          const timer = setInterval(() => {}, 1000);
          return promise.finally(() => clearInterval(timer));
        }
      `,
      ...callers(2, "meet"),
    });
    expect(result).toEqual(ok("[2,2]"));
  });

  describe("process.env", () => {
    const files = {
      "m.ts": `
        export const read = () => JSON.stringify([process.env.A, Bun.env.B, import.meta.env.C]);
        export const write = () => (process.env.A = "from the macro");
      `,
      "read.ts": calls("read"),
      "helpers.ts": `
        const text = name => 'import * as m from "./m.ts" with { type: "macro" }; export const value = m.' + name + '();';
        const value = code => (0, eval)(code.match(/value = (.*);/)[1]);
        export const transformSync = (name = "read") => value(new Bun.Transpiler().transformSync(text(name)));
        export const transform = async () => value(await new Bun.Transpiler().transform(text("read")));
        export const build = async () => value(await (await Bun.build({ entrypoints: ["read.ts"] })).outputs[0].text());
        let count = 0;
        export const imported = async () => (await import("./read.ts?" + count++)).value;
      `,
    };

    test.each(["transformSync", "transform", "build", "imported"])("follows the program's in %s", async route => {
      const program = `
        import { ${route} as read } from "./helpers.ts";
        console.log(await read());
        process.env.A = "set";
        process.env.B = "é";
        console.log(await read());
        delete process.env.A;
        delete process.env.C;
        console.log(await read());
        process.env = { ...process.env, A: "replaced", C: 1 };
        console.log(await read());
      `;
      expect(await bun(["index.ts"], { ...files, "index.ts": program }, { A: "a", C: "c" })).toEqual(
        ok(`["a",null,"c"]`, `["set","é","c"]`, `[null,"é",null]`, `["replaced","é","1"]`),
      );
    });

    test("has what the program wrote before the first macro", async () => {
      const program = `process.env.A = "set";\ndelete process.env.C;\nconsole.log(require("./read.ts").value);`;
      expect(await bun(["index.ts"], { ...files, "index.ts": program }, { C: "c" })).toEqual(ok(`["set",null,null]`));
    });

    test.each([
      ["a copy", `undefined`, `["a",null,"main"]`],
      ["an object", `{ A: "option" }`, `["option",null,null]`],
      ["SHARE_ENV", `SHARE_ENV`, `["a",null,"main"]`],
    ])("is that of a Worker whose env is %s", async (_, env, expected) => {
      const program = `
        import { SHARE_ENV, Worker } from "node:worker_threads";
        process.env.C = "main";
        new Worker("./worker.ts", { env: ${env} });
      `;
      const worker = `import { value } from "./read.ts";\nconsole.log(value);`;
      expect(await bun(["index.ts"], { ...files, "worker.ts": worker, "index.ts": program }, { A: "a" })).toEqual(
        ok(expected),
      );
    });

    test("is not written back to the program, and later macros keep what a macro wrote", async () => {
      const program = `
        import { transformSync } from "./helpers.ts";
        console.log(transformSync("write"), process.env.A, transformSync());
      `;
      expect(await bun(["index.ts"], { ...files, "index.ts": program }, { A: "a" })).toEqual(
        ok(`from the macro a ["from the macro",null,null]`),
      );
    });

    test("decides NODE_ENV in a macro of Bun.build()", async () => {
      const result = await bun(["index.ts"], {
        "m.ts": `export const mode = () => process.env.NODE_ENV;`,
        "calls.ts": calls("mode"),
        "index.ts": `
          process.env.NODE_ENV = "production";
          const { outputs } = await Bun.build({ entrypoints: ["calls.ts"] });
          console.log((await outputs[0].text()).match(/value = (.*);/)[1]);
        `,
      });
      expect(result).toEqual(ok(`"production"`));
    });

    test("is read without running getters or Proxy traps", async () => {
      const program = `
        import { transformSync } from "./helpers.ts";
        const trap = name => (...args) => (console.log(name), Reflect[name](...args));
        const target = { A: "target", get B() { console.log("getter"); return "b"; } };
        process.env = new Proxy(target, Object.fromEntries(Reflect.ownKeys(Reflect).map(name => [name, trap(name)])));
        console.log(transformSync());
      `;
      expect(await bun(["index.ts"], { ...files, "index.ts": program })).toEqual(ok(`["target",null,null]`));
    });

    test("is read without running the traps of a node:vm context", async () => {
      const program = `
        import { createContext, runInContext } from "node:vm";
        import { transformSync } from "./helpers.ts";
        const sandbox = new Proxy({}, { ownKeys: () => (console.log("ownKeys"), []) });
        process.env = runInContext("globalThis", createContext(sandbox));
        console.log(transformSync());
      `;
      expect(await bun(["index.ts"], { ...files, "index.ts": program })).toEqual(ok(`[null,null,null]`));
    });

    test("has the .env files of the program", async () => {
      const result = await bun(["--env-file=custom.env", "index.ts"], {
        ...files,
        ".env": "B=default",
        "custom.env": "A=custom",
        "index.ts": `import { value } from "./read.ts";\nconsole.log(value);`,
      });
      expect(result).toEqual(ok(`["custom",null,null]`));
    });
  });

  test("process.argv, Bun.main and process.cwd() are those of the program", async () => {
    const result = await bun(["index.ts", "--flag", "value"], {
      "m.ts": `
        import { basename } from "node:path";
        export const read = () => [...process.argv.slice(1), Bun.main, process.cwd()].map(it => basename(it)).join();
      `,
      "first/calls.ts": calls("read", "../m.ts"),
      "second/calls.ts": calls("read", "../m.ts"),
      "index.ts": `
        for (const name of ["first", "second"]) {
          process.chdir(import.meta.dir + "/" + name);
          console.log((await import("./" + name + "/calls.ts")).value);
        }
      `,
    });
    expect(result).toEqual(ok("index.ts,--flag,value,index.ts,first", "index.ts,--flag,value,index.ts,second"));
  });

  test.each([
    ["--no-addons", `process.dlopen({ exports: {} }, "missing.node")`, "ERR_DLOPEN_DISABLED"],
    ["--no-ffi-cc", `cc({ source: "missing.c", symbols: {} })`, "ERR_FFI_CC_DISABLED"],
  ])("%s applies to macros", async (flag, load, code) => {
    const result = await bun([flag, "index.ts"], {
      "m.ts": `import { cc } from "bun:ffi";\nexport function load() {\n  try {\n    ${load};\n  } catch (error) {\n    return error.code;\n  }\n}`,
      "calls.ts": calls("load"),
      "index.ts": `
        console.log((await (await Bun.build({ entrypoints: ["calls.ts"] })).outputs[0].text()).match(/value = "(.*)"/)[1]);
        console.log((await import("./calls.ts")).value);
      `,
    });
    expect(result).toEqual(ok(code, code));
  });

  test.each([`require("./calls.ts")`, `await import("./calls.ts")`])(
    "process.cwd() follows process.chdir() in a macro after %s",
    async load => {
      const result = await bun(["index.ts"], {
        "m.ts": `export const enter = () => process.chdir(import.meta.dir + "/inner");`,
        "calls.ts": calls("enter"),
        "inner/.keep": "",
        "index.ts": `import { basename } from "node:path";\nprocess.cwd();\n${load};\nconsole.log(basename(process.cwd()));`,
      });
      expect(result).toEqual(ok("inner"));
    },
  );

  describe("the context argument of transformSync()", () => {
    const files = {
      "m.ts": `export const take = (a, context) => JSON.stringify([a, context.map.get(1), ++context.n]);`,
    };
    const text = JSON.stringify(
      `import { take } from "./m.ts" with { type: "macro" }; take("a"); export default [take("b")];`,
    );

    test("is copied for each call", async () => {
      const program = `
        const context = { map: new Map([[1, "one"]]), n: 0 };
        console.log(new Bun.Transpiler().transformSync(${text}, context).match(/\\[.*\\]/)[0], context.n);
      `;
      expect(await bun(["index.ts"], { ...files, "index.ts": program })).toEqual(ok(`['["b","one",1]'] 0`));
    });

    test("throws if it cannot be copied, unless no macro is called", async () => {
      const program = `
        const transpiler = new Bun.Transpiler();
        console.log(transpiler.transformSync("f();", { f() {} }).trim());
        try {
          transpiler.transformSync(${text}, { f() {} });
        } catch (error) {
          console.log(error.name);
        }
      `;
      expect(await bun(["index.ts"], { ...files, "index.ts": program })).toEqual(ok("f();", "DataCloneError"));
    });
  });

  test("what a macro posts to a BroadcastChannel arrives before Bun.build() resolves", async () => {
    const result = await bun(["index.ts"], {
      "m.ts": `const channel = new BroadcastChannel("macro");\nexport const post = () => (channel.postMessage(1), 0);`,
      ...callers(8, "post"),
      "index.ts": `
        const channel = new BroadcastChannel("macro");
        let received = 0;
        channel.onmessage = () => received++;
        await Bun.build({ entrypoints: ["all.ts"] });
        console.log(received);
        channel.close();
      `,
    });
    expect(result).toEqual(ok("8"));
  });

  test("what a macro prints comes before what the code that calls it prints", async () => {
    const result = await bun(["index.ts"], {
      "m.ts": `
        export function print() {
          console.log("console.log");
          process.stdout.write("process.stdout\\n");
          Promise.resolve().then(() => console.log("microtask"));
        }
      `,
      "calls.ts": calls("print"),
      "index.ts": `console.log("before");\nrequire("./calls.ts");\nconsole.log("after");`,
    });
    expect(result).toEqual(ok("before", "console.log", "process.stdout", "microtask", "after"));
  });

  test("keeps running timers between calls", async () => {
    const result = await bun(["index.ts"], {
      "m.ts": `export const start = () => void setTimeout(() => new BroadcastChannel("macro").postMessage("fired"), 1);`,
      "calls.ts": calls("start"),
      "index.ts": `
        const channel = new BroadcastChannel("macro");
        channel.onmessage = event => (console.log(event.data), channel.close());
        require("./calls.ts");
      `,
    });
    expect(result).toEqual(ok("fired"));
  });

  describe.each([
    ["bun run", ["calls.ts"]],
    ["bun build", ["build", "calls.ts", "--outfile=out.js"]],
    ["Bun.build()", ["-e", `await Bun.build({ entrypoints: ["calls.ts"] })`]],
    ["a Worker", ["-e", `new (require("node:worker_threads").Worker)("./calls.ts")`]],
    ["bun test", ["test", "./calls.ts"]],
  ])("%s", (_, args) => {
    test.each([
      ["an interval", `setInterval(() => {}, 1)`],
      ["a server", `Bun.serve({ port: 0, fetch() {} })`],
      ["a Worker", `new Worker("data:text/javascript,setInterval(() => {}, 1000)")`],
      ["a watcher", `watch(".")`],
    ])("exits although a macro left %s open", async (_, open) => {
      const macro = `import { watch } from "node:fs";\nexport const open = () => void ${open};`;
      const files = { "m.ts": macro, "calls.ts": calls("open") };
      expect(await bun(args, files)).toMatchObject({ exitCode: 0, signalCode: null });
    });

    test("fails if nothing can settle the promise of a macro", async () => {
      const files = { "m.ts": `export const never = () => new Promise(() => {});`, "calls.ts": calls("never") };
      expect(await bun(args, files)).toMatchObject({
        stderr: expect.stringContaining("This macro never finished"),
        exitCode: 1,
        signalCode: null,
      });
    });

    test("prints what a macro throws", async () => {
      const files = {
        "m.ts": `export function fail() {\n  throw new Error("the reason");\n}`,
        "calls.ts": calls("fail"),
      };
      expect(await bun(args, files)).toMatchObject({
        stderr: expect.stringContaining("error: the reason"),
        exitCode: 1,
        signalCode: null,
      });
    });
  });

  test("fails if nothing can settle the top-level await of the module of a macro", async () => {
    const files = { "m.ts": `await new Promise(() => {});\nexport const m = () => 1;`, "index.ts": calls("m") };
    expect(await bun(["index.ts"], files)).toMatchObject({
      stderr: expect.stringContaining("This macro never finished"),
      exitCode: 1,
      signalCode: null,
    });
  });

  test.each([
    ["setImmediate()", `setImmediate(resolve)`],
    ["process.nextTick()", `process.nextTick(resolve)`],
    [
      "a MessageChannel",
      `{ const { port1, port2 } = new MessageChannel(); port1.onmessage = resolve; port2.postMessage(1); }`,
    ],
    ["a Worker", `{ new Worker("data:text/javascript,postMessage(1)").onmessage = resolve; }`],
    ["a subprocess", `Bun.spawn([process.execPath, "-v"], { stdout: "ignore", onExit: resolve })`],
    ["Atomics.waitAsync()", `Atomics.waitAsync(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1).value.then(resolve)`],
    ["Bun.password", `Bun.password.hash("a", { algorithm: "bcrypt", cost: 4 }).then(resolve)`],
    ["import()", `import("./other.ts").then(resolve)`],
  ])("a macro can wait for %s", async (_, settle) => {
    const files = (open: string) => ({
      "m.ts": `${open};\nexport const wait = () => new Promise(resolve => ${settle}).then(() => "settled");`,
      "other.ts": `export {};`,
      "index.ts": calls("wait") + `console.log(value);`,
    });
    const results = await Promise.all(
      ["", `Bun.serve({ port: 0, fetch() {} })`].map(open => bun(["index.ts"], files(open))),
    );
    expect(results).toEqual([ok("settled"), ok("settled")]);
  });

  test.each([
    ["an Error", `new Error("the reason")`],
    ["an Error inside an object", `({ a: new Error("the reason") })`],
    ["a getter that throws", `({ get a() { throw new Error("the reason"); } })`],
    ["a promise that rejects inside an array", `[Promise.reject(new Error("the reason"))]`],
  ])("a macro that returns %s fails", async (_, value) => {
    const { stderr, exitCode } = await bun(["build", "calls.ts"], {
      "m.ts": `export const m = () => ${value};`,
      "calls.ts": calls("m"),
    });
    expect(stderr.match(/^error: .*/gm)).toEqual(["error: the reason", "error: macro threw exception"]);
    expect(exitCode).toBe(1);
  });

  test("a macro that returns getters without end fails", async () => {
    const files = { "m.ts": `export const m = () => ({ get next() { return m(); } });`, "index.ts": calls("m") };
    expect(await bun(["index.ts"], files)).toMatchObject({
      stderr: expect.stringContaining("The value returned by this macro is nested too deeply"),
      exitCode: 1,
      signalCode: null,
    });
  });

  test("an error that belongs to no call is printed, and macros keep working", async () => {
    const { lines, stderr, exitCode } = await bun(["index.ts"], {
      "m.ts": `
        export function m() {
          setTimeout(() => { throw new Error("uncaught"); }, 1);
          Promise.reject(new Error("unhandled"));
          return new Promise(resolve => setTimeout(resolve, 2, 1));
        }
      `,
      "index.ts": `import { m } from "./m.ts" with { type: "macro" };\nconsole.log(m(), m());\nsetImmediate(console.log, "alive");`,
    });
    expect({ lines, errors: stderr.match(/^error: .*/gm)?.sort(), exitCode }).toEqual({
      lines: ["1 1", "alive"],
      errors: ["error: uncaught", "error: uncaught", "error: unhandled", "error: unhandled"],
      exitCode: 0,
    });
  });

  describe("process.exit() in a macro", () => {
    const files = {
      "m.ts": `export function exit() {\n  process.stdout.write("macro\\n");\n  process.exit(7);\n}`,
      "calls.ts": calls("exit") + `console.log("evaluated");`,
    };
    const routes: [name: string, code: string][] = [
      ["require()", `require("./calls.ts")`],
      ["import()", `await import("./calls.ts")`],
      ["transformSync()", `new Bun.Transpiler().transformSync(${JSON.stringify(calls("exit"))})`],
      ["transform()", `await new Bun.Transpiler().transform(${JSON.stringify(calls("exit"))})`],
      ["Bun.build()", `await Bun.build({ entrypoints: ["calls.ts"] })`],
    ];
    const program = (code: string) => `
      process.on("exit", code => console.log("exit", code));
      try {
        ${code};
      } finally {
        console.log("returned");
      }
    `;

    test.each(routes)("ends the process under %s", async (_, code) => {
      expect(await bun(["index.ts"], { ...files, "index.ts": program(code) })).toEqual({
        ...ok("macro", "exit 7"),
        exitCode: 7,
      });
    });

    test.each(routes)("ends the Worker under %s", async (_, code) => {
      const result = await bun(["index.ts"], {
        ...files,
        "worker.ts": program(code),
        "index.ts": `
          import { Worker } from "node:worker_threads";
          new Worker("./worker.ts").on("exit", code => console.log("worker", code));
        `,
      });
      expect(result).toEqual(ok("macro", "exit 7", "worker 7"));
    });

    test.each([[["calls.ts"]], [["build", "calls.ts"]]])("ends bun %j", async args => {
      expect(await bun(args, files)).toEqual({ ...ok("macro"), exitCode: 7 });
    });
  });

  describe.each([
    ["spins", `for (;;);`],
    ["awaits", `setInterval(() => {}, 1000);\nawait new Promise(() => {});`],
  ])("while a macro %s", (_, body) => {
    const files = {
      "m.ts": `
        export async function stuck() {
          new BroadcastChannel("macro").postMessage("started");
          ${body}
        }
        export const works = () => "works";
      `,
      "calls.ts": calls("stuck"),
      "works.ts": calls("works"),
    };

    test.each([
      ["require()", `require("./calls.ts")`],
      ["import()", `import("./calls.ts")`],
      ["transform()", `new Bun.Transpiler().transform(${JSON.stringify(calls("stuck"))})`],
      ["Bun.build()", `Bun.build({ entrypoints: ["calls.ts"] })`],
    ])("terminate() ends a Worker that waits in %s", async (_, code) => {
      const result = await bun(["index.ts"], {
        ...files,
        "worker.ts": code,
        "index.ts": `
          import { Worker } from "node:worker_threads";
          const channel = new BroadcastChannel("macro");
          const started = new Promise(resolve => (channel.onmessage = resolve));
          const worker = new Worker("./worker.ts");
          await started;
          channel.close();
          console.log(await worker.terminate());
        `,
      });
      expect(result).toEqual(ok("1"));
    });

    test("the timeout of node:vm ends a require()", async () => {
      const result = await bun(["index.ts"], {
        ...files,
        "index.ts": `
          import { runInThisContext } from "node:vm";
          globalThis.load = () => require("./calls.ts");
          try {
            runInThisContext("load()", { timeout: 100 });
          } catch (error) {
            console.log(error.code);
          }
          console.log(require("./works.ts").value);
        `,
      });
      expect(result).toEqual(ok("ERR_SCRIPT_EXECUTION_TIMEOUT", "works"));
    });

    test("process.exit() ends the program", async () => {
      const result = await bun(["index.ts"], {
        ...files,
        "index.ts": `
          new BroadcastChannel("macro").onmessage = () => process.exit(3);
          import("./calls.ts");
        `,
      });
      expect(result).toEqual({ ...ok(""), exitCode: 3 });
    });
  });

  test("terminate() ends a Worker while an 'exit' listener of a macro spins", async () => {
    const result = await bun(["index.ts"], {
      "m.ts": `
        export function listen() {
          process.on("exit", () => {
            new BroadcastChannel("macro").postMessage("started");
            for (;;);
          });
        }
      `,
      "calls.ts": calls("listen"),
      "worker.ts": `Bun.build({ entrypoints: ["calls.ts"] });`,
      "index.ts": `
        import { Worker } from "node:worker_threads";
        const channel = new BroadcastChannel("macro");
        const started = new Promise(resolve => (channel.onmessage = resolve));
        const worker = new Worker("./worker.ts");
        await started;
        channel.close();
        console.log(await worker.terminate());
      `,
    });
    expect(result).toEqual(ok("1"));
  });

  test.each([
    ["the entry point", ["--preload=./server.ts", "index.ts"]],
    ["a preload", ["--preload=./server.ts", "--preload=./index.ts", "empty.ts"]],
    ["a test file", ["test", "--preload=./server.ts", "./index.ts"]],
    ["the entry point of a Worker", ["-e", `new Worker("./index.ts", { preload: ["./server.ts"] })`]],
  ])("a macro in %s can fetch from a server that the program started", async (_, args) => {
    const { lines, exitCode, signalCode } = await bun(args, {
      "server.ts": `
        const server = Bun.serve({ port: 0, fetch: () => new Response("from the program") });
        server.unref();
        process.env.MACRO_TEST_URL = server.url.href;
      `,
      "m.ts": `export const get = () => fetch(process.env.MACRO_TEST_URL!).then(response => response.text());`,
      "index.ts": calls("get") + `console.log(value);`,
      "empty.ts": ``,
    });
    expect({ last: lines.at(-1), exitCode, signalCode }).toEqual({
      last: "from the program",
      exitCode: 0,
      signalCode: null,
    });
  });

  describe("an entry point that calls a macro", () => {
    const one = `export const one = () => 1;`;

    test.each([
      ["index.ts", {}],
      ["index.mjs", { "package.json": `{ "type": "commonjs" }` }],
      ["index.js", { "package.json": `{ "type": "module" }` }],
      ["index", {}],
    ])("is still the main module: %s", async (name, files) => {
      const result = await bun([name], {
        ...files,
        "m.ts": one,
        [name]: `
          import { one } from "./m.ts" with { type: "macro" };
          console.log(one(), import.meta.main, Bun.main === import.meta.path);
        `,
      });
      expect(result).toEqual(ok("1 true true"));
    });

    test.each([
      ["bun:test", `import { test, expect, mock } from "bun:test";`, `mock.module`],
      ["vitest", `import { test, expect, vi } from "vitest";`, `vi.mock`],
      ["globals", ``, `jest.mock`],
    ])("is still a test file: %s", async (_, imports, mock) => {
      const { stderr, exitCode } = await bun(["test", "./a.test.ts"], {
        "m.ts": one,
        "mocked.ts": `export const value = "original";`,
        "a.test.ts": `
          ${imports}
          import { one } from "./m.ts" with { type: "macro" };
          import { value } from "./mocked.ts";
          ${mock}("./mocked.ts", () => ({ value: "mocked" }));
          test("passes", () => expect([one(), value]).toEqual([1, "mocked"]));
        `,
      });
      expect(stderr).toContain(" 1 pass\n 0 fail\n");
      expect(exitCode).toBe(0);
    });

    test.each([
      ["on another thread", {}],
      ["on the main thread", { NODE_COMPILE_CACHE: "cache" }],
    ])("pauses under --inspect-brk when it is transpiled %s", async (_, env) => {
      using dir = tempDir("macro-inspect-brk", { "m.ts": one, "index.ts": calls("one") + `console.log(value);` });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--inspect-brk=127.0.0.1:0/macro", "index.ts"],
        env: { ...bunEnv, ...env },
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      let url: string | undefined;
      for await (const line of forEachLine(proc.stderr)) {
        if ((url = line.match(/ws:\/\/\S+/)?.[0])) break;
      }
      const socket = new WebSocket(url!);
      let id = 0;
      const send = (method: string, params = {}) => socket.send(JSON.stringify({ id: ++id, method, params }));
      const pauses: string[] = [];
      socket.onopen = () => {
        send("Inspector.enable");
        send("Debugger.enable");
        send("Debugger.setBreakpointsActive", { active: true });
        send("Debugger.setPauseOnDebuggerStatements", { enabled: true });
        send("Inspector.initialized");
      };
      socket.onmessage = event => {
        const { method, params } = JSON.parse(event.data);
        if (method !== "Debugger.paused") return;
        pauses.push(params.reason);
        send("Debugger.resume");
      };
      for await (const line of forEachLine(proc.stdout)) {
        expect({ line, pauses }).toEqual({ line: "1", pauses: ["DebuggerStatement"] });
        break;
      }
      socket.close();
      expect(await proc.exited).toBe(0);
    });

    test("does not change how a file of an unknown type is imported while it waits", async () => {
      const result = await bun(["--preload=./preload.ts", "index.ts"], {
        "file.unknown": `not a script`,
        "preload.ts": `
          import { basename } from "node:path";
          const channel = new BroadcastChannel("macro");
          channel.onmessage = async () => {
            channel.postMessage(await import("./file.unknown").then(file => basename(file.default), String));
            channel.close();
          };
        `,
        "m.ts": `
          export function ask() {
            const channel = new BroadcastChannel("macro");
            channel.postMessage("waiting");
            return new Promise(resolve => (channel.onmessage = event => resolve(event.data)));
          }
        `,
        "index.ts": calls("ask") + `console.log(value);`,
      });
      expect(result).toEqual(ok("file.unknown"));
    });

    test.each([
      ["-e", `console.log(one())`],
      ["-p", `one()`],
    ])("works with %s", async (flag, code) => {
      const source = `import { one } from "./m.ts" with { type: "macro" };\n${code}`;
      expect(await bun([flag, source], { "m.ts": one })).toEqual(ok("1"));
    });
  });

  test("mock.module() does not apply to the modules of macros", async () => {
    const { stderr, exitCode } = await bun(["test", "./a.test.ts"], {
      "dep.ts": `export const dep = "original";`,
      "m.ts": `import { dep } from "./dep.ts";\nexport const read = () => dep;`,
      "calls.ts": calls("read"),
      "a.test.ts": `
        import { expect, mock, test } from "bun:test";
        mock.module("./dep.ts", () => ({ dep: "mocked" }));
        test("passes", () => expect(require("./calls.ts").value).toBe("original"));
      `,
    });
    expect(stderr).toContain(" 1 pass\n 0 fail\n");
    expect(exitCode).toBe(0);
  });

  describe("a macro that transpiles", () => {
    test.each(["transformSync", "transform"])("a call of another macro with %s() gets its value", async method => {
      const result = await bun(["index.ts"], {
        "inner.ts": `export const inner = async () => "inner";`,
        "m.ts": `export const outer = () => new Bun.Transpiler().${method}(${JSON.stringify(calls("inner", "./inner.ts"))});`,
        "index.ts": calls("outer") + `console.log(value.trim());`,
      });
      expect(result).toEqual(ok(`export const value = "inner";`));
    });

    test("a call of itself fails", async () => {
      const result = await bun(["index.ts"], {
        "m.ts": `export const again = () => new Bun.Transpiler().transformSync(${JSON.stringify(calls("again"))});`,
        "index.ts": calls("again"),
      });
      expect(result).toMatchObject({
        stderr: expect.stringContaining("Macros that transpile calls of other macros are nested too deeply"),
        exitCode: 1,
        signalCode: null,
      });
    });
  });
});

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

  test.concurrent.each([
    ["a Worker", "./entry.ts"],
    ["a Worker of a Worker", "./worker.ts"],
  ])("bun --no-macros refuses to run macros in %s", async (_, worker) => {
    const { lines, stderr, exitCode } = await bun(["--no-macros", "index.ts"], {
      ...files,
      "worker.ts": `import { Worker } from "node:worker_threads";\nnew Worker("./entry.ts");`,
      "index.ts": `
        import { existsSync } from "node:fs";
        import { Worker } from "node:worker_threads";
        new Worker("${worker}");
        process.on("exit", () => console.log(existsSync("MACRO_RAN")));
      `,
    });
    expect(lines).toEqual(["false"]);
    expect(stderr).toContain("Macros are disabled");
    expect(exitCode).toBe(1);
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

describe("macros in data: URL modules", () => {
  const macroSource = `
    import { writeFileSync } from "node:fs";
    export function f() {
      writeFileSync("MACRO_RAN", "macro executed");
      return "INLINED_RESULT";
    }
  `;
  const callerSource = (dir: string) =>
    `import { f } from ${JSON.stringify(path.join(dir, "macro.ts"))} with { type: "macro" }; console.log(f(), f\`\`);`;
  const toDataUrl = (code: string) => "data:text/javascript;base64," + Buffer.from(code).toString("base64");

  describe.each([
    ["direct import", (dir: string) => toDataUrl(callerSource(dir))],
    ["nested data: URL", (dir: string) => toDataUrl(`import ${JSON.stringify(toDataUrl(callerSource(dir)))};`)],
  ])("%s", (_, getSpecifier) => {
    test.concurrent.each([
      ["bun build", ["build", "./entry.ts", "--outdir", "dist"]],
      ["bun run", ["run", "./entry.ts"]],
    ])("%s errors", async (_, args) => {
      using dir = tempDir("macro-data-url", { "macro.ts": macroSource });
      await Bun.write(path.join(String(dir), "entry.ts"), `import ${JSON.stringify(getSpecifier(String(dir)))};\n`);
      await using proc = Bun.spawn({
        cmd: [bunExe(), ...args],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr.split('error: Macros cannot be run from a "data:" URL module.').length - 1).toBe(2);
      expect(existsSync(path.join(String(dir), "MACRO_RAN"))).toBe(false);
      expect(exitCode).toBe(1);
    });
  });
});

describe("macros in dependency paths", () => {
  const isCaseInsensitive = existsSync(import.meta.path.toUpperCase());
  const macroFiles = (folder: string) => ({
    [`${folder}/caller.js`]: `import { f } from "./macro.js" with { type: "macro" };\nexport const value = f();\n`,
    [`${folder}/macro.js`]: `import { writeFileSync } from "node:fs";\nexport function f() {\n  writeFileSync("MACRO_RAN", "");\n  return "INLINED";\n}\n`,
  });
  async function runBuild(dir: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "./entry.js", "--target=browser", "--outdir=dist"],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stderr, exitCode, ran: existsSync(path.join(dir, "MACRO_RAN")) };
  }
  const refused = {
    stderr: expect.stringContaining("macros cannot be run from node_modules"),
    exitCode: 1,
    ran: false,
  };
  const allowed = { stderr: "", exitCode: 0, ran: true };

  test.concurrent.each([
    "Node_Modules/dep",
    "NODE_MODULES/@scope/dep",
    "cache/dep@1.0.0@@@1",
    "cache/@scope/dep@1.0.0@@@1/lib",
    "cache/dep@1.0.0@@registry.example.com@@@1",
    "cache/dep@1.0.0@@@1_patch_hash=0123456789abcdef",
    "cache/@G@0123456789abcdef0123456789abcdef01234567",
    "cache/@GH@owner-dep-0123456@@@1",
    "cache/@T@0123456789abcdef@@@1",
  ])("errors in %s", async folder => {
    using dir = tempDir("macro-dependency", {
      "entry.js": `import "dep";\n`,
      "node_modules/dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
      "node_modules/dep/index.js": `try { require("../../${folder}/caller.js") } catch {}\n`,
      ...macroFiles(folder),
    });
    expect(await runBuild(String(dir))).toEqual(refused);
  });

  test.concurrent.skipIf(!isCaseInsensitive)("errors for a path with different case", async () => {
    using dir = tempDir("macro-dependency-case", {
      "entry.js": `import "dep";\n`,
      "node_modules/dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
      "node_modules/dep/index.js": `import "../../Node_Modules/dep/caller.js";\n`,
      ...macroFiles("node_modules/dep"),
    });
    expect(await runBuild(String(dir))).toEqual(refused);
  });

  test.concurrent.each(["src", "node_modules_old", "my-node_modules/x", "a@@b"])("allowed in %s", async folder => {
    using dir = tempDir("macro-project", { "entry.js": `import "./${folder}/caller.js";\n`, ...macroFiles(folder) });
    expect(await runBuild(String(dir))).toEqual(allowed);
  });

  test.concurrent("allowed in linked packages", async () => {
    using dir = tempDir("macro-linked", {
      "entry.js": `import "dep";\n`,
      "node_modules/dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
      "node_modules/dep/index.js": `import "linked";\n`,
      ...macroFiles("packages/linked"),
      "packages/linked/package.json": JSON.stringify({ name: "linked", version: "1.0.0", main: "caller.js" }),
    });
    symlinkSync(path.join(String(dir), "packages/linked"), path.join(String(dir), "node_modules/linked"), "junction");
    expect(await runBuild(String(dir))).toEqual(allowed);
  });
});

test("bun build of a macro call next to a property read of the same import", async () => {
  using dir = tempDir("bundler-macro-property-read", {
    "macro.ts": `export function m() {\n  return 42;\n}\n`,
    "entry.ts": `import { m } from "./macro.ts" with { type: "macro" };\nconsole.log(m.name, m());\n`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "./entry.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toContain("console.log(m.name, 42);");
  expect(exitCode).toBe(0);
});

test("bun build reports a macro result that is nested too deeply", async () => {
  using dir = tempDir("bundler-macro-deep-result", {
    "macro.ts": `export function m() {\n  let list = null;\n  for (let i = 0; i < 100000; i++) list = { i, next: list };\n  return list;\n}\n`,
    "entry.ts": `import { m } from "./macro.ts" with { type: "macro" };\nexport const list = m();\n`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "./entry.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("error: The value returned by this macro is nested too deeply");
  expect(exitCode).toBe(1);
});

// The macro VM of `bun build` loads the cwd's `.env` files.
describe("macro VM env loader", () => {
  const macroModules = 8;
  const files: Record<string, string> = {
    ".env": Array.from({ length: 5000 }, (_, i) => `VAR_${i}=value_number_${i}`).join("\n") + "\n",
    "macro.ts": `export function value(name: string) {\n  return name;\n}\n`,
    "entry.ts":
      Array.from({ length: macroModules }, (_, i) => `import m${i} from "./m${i}.ts";`).join("\n") +
      `\nconsole.log(${Array.from({ length: macroModules }, (_, i) => `m${i}`).join(", ")});\n`,
  };
  for (let i = 0; i < macroModules; i++) {
    files[`m${i}.ts`] = `import { value } from "./macro.ts" with { type: "macro" };\nexport default value("m${i}");\n`;
  }

  test("bun build doesn't crash with several macro modules and a .env", async () => {
    using dir = tempDir("macro-env-loader-race", files);
    const builds = 4;
    const results = await Promise.all(
      Array.from({ length: builds }, async (_, i) => {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "build", "./entry.ts", "--target=bun", "--outdir", `out${i}`],
          env: { ...bunEnv, UV_THREADPOOL_SIZE: "8" },
          cwd: String(dir),
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        return { stderr, exitCode };
      }),
    );
    expect(results).toEqual(results.map(() => ({ stderr: "", exitCode: 0 })));
    for (let i = 0; i < builds; i++) {
      const out = await Bun.file(path.join(String(dir), `out${i}`, "entry.js")).text();
      for (let m = 0; m < macroModules; m++) {
        expect(out).toContain(`var m${m}_default = "m${m}";`);
      }
    }
  }, 60_000);

  // `bun build` without `--env` doesn't read `.env`.
  test.concurrent("the .env loaded for a macro doesn't affect the build's resolver", async () => {
    using dir = tempDir("macro-env-loader-isolated", {
      "vendor/dep/index.ts": `export const dep = "from NODE_PATH";\n`,
      "macro.ts": `export function value(name: string) {\n  return name;\n}\n`,
      "with-macro.ts": `import { value } from "./macro.ts" with { type: "macro" };\nimport { dep } from "dep";\nconsole.log(value("a"), dep);\n`,
      "without-macro.ts": `import { dep } from "dep";\nconsole.log("b", dep);\n`,
    });
    await Bun.write(path.join(String(dir), ".env"), `NODE_PATH=${path.join(String(dir), "vendor")}\n`);
    const build = async (entry: string) => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", entry, "--target=bun"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return {
        resolved: stdout.includes("from NODE_PATH"),
        unresolved: stderr.includes('Could not resolve: "dep"'),
        exitCode,
      };
    };
    const [withMacro, withoutMacro] = await Promise.all([build("./with-macro.ts"), build("./without-macro.ts")]);
    expect(withoutMacro).toEqual({ resolved: false, unresolved: true, exitCode: 1 });
    expect(withMacro).toEqual(withoutMacro);
  });
});
