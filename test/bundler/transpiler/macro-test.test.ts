import { escapeHTML } from "bun" with { type: "macro" };
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
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
  // Debug builds print "[macro] call <name>" to stdout before the script's own output.
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
  // Debug builds print "[macro] call <name>" to stdout before the script's own output.
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

  // `--no-macros`, and `macros = false` in bunfig.toml, are a switch for the whole process: a macro
  // call is refused by every VM, transpiler and bundler that the process starts, not only by its main VM.
  // A bun that the command starts to run a part of itself has the switch too.
  describe.concurrent("holds for the whole process", () => {
    // `bun install` looks up its registry when it starts. No case has a package to download.
    let registry: ReturnType<typeof Bun.serve>;
    beforeAll(() => {
      registry = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 404 }) });
    });
    afterAll(() => registry.stop(true));

    async function run(
      tree: Record<string, string>,
      cmd: readonly string[],
      { env, stdin }: { env?: Record<string, string>; stdin?: string } = {},
    ) {
      using dir = tempDir("no-macros", tree);
      await using proc = Bun.spawn({
        cmd: [bunExe(), ...cmd],
        env: {
          ...bunEnv,
          // No bunfig.toml or REPL history of whoever runs the test.
          HOME: String(dir),
          USERPROFILE: String(dir),
          BUN_CONFIG_REGISTRY: registry.url.href,
          ...env,
        },
        cwd: String(dir),
        stdin: stdin === undefined ? "ignore" : Buffer.from(stdin),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode, macroRan: existsSync(path.join(String(dir), "MACRO_RAN")) };
    }

    // For a case that is several VMs or more than one process. In a debug build the doors below take
    // 3 to 5 s alone (a `node:worker_threads` Worker is 1.2 s of it, each) and `bun lint` with its
    // configuration process 3 s. The default limit is 5 s. A release build takes 0.3 s for either.
    const slow = isDebug || isASAN ? 60_000 : undefined;

    const importInATest = `
      import { test } from "bun:test";
      test("imports a module that calls a macro", async () => {
        await import("./entry.ts");
      });
    `;
    const refused = { stderr: expect.stringContaining("Macros are disabled"), macroRan: false, exitCode: 1 };
    test.each([
      ["bun --no-macros <file>", {}, ["--no-macros", "entry.ts"], {}, refused],
      // `bun run` reads bunfig.toml after the flag. A `[macros]` table there does not turn macros back on.
      [
        "bun run --no-macros <file>, a [macros] table in bunfig.toml",
        { "bunfig.toml": `[macros]\nsomepkg = { thing = "./macro.ts" }\n` },
        ["run", "--no-macros", "entry.ts"],
        {},
        refused,
      ],
      [
        "bun test --no-macros, an import() in a test",
        { "entry.test.ts": importInATest },
        ["test", "--no-macros", "./entry.test.ts"],
        {},
        refused,
      ],
      [
        "bun --no-macros test, a call in the test file",
        {
          "call.test.ts": `
            import { test, expect } from "bun:test";
            import { f } from "./macro.ts" with { type: "macro" };
            test("calls a macro", () => expect(f()).toBe("INLINED_RESULT"));
          `,
        },
        ["--no-macros", "test", "./call.test.ts"],
        {},
        refused,
      ],
      [
        "bun test --no-macros --preload",
        { "empty.test.ts": `import { test } from "bun:test";\ntest("empty", () => {});\n` },
        ["test", "--no-macros", "--preload", "./entry.ts", "./empty.test.ts"],
        {},
        refused,
      ],
      [
        "bun test, macros = false in bunfig.toml",
        { "entry.test.ts": importInATest, "bunfig.toml": "macros = false\n" },
        ["test", "./entry.test.ts"],
        {},
        refused,
      ],
      [
        "bun repl --no-macros",
        {},
        ["repl", "--no-macros"],
        { stdin: `await import("./entry.ts");\n.exit\n` },
        { stdout: expect.stringContaining("Macros are disabled"), macroRan: false, exitCode: 0 },
      ],
      [
        "bun install --analyze --no-macros",
        { "package.json": JSON.stringify({ name: "analyze", version: "1.0.0" }) },
        ["install", "--analyze", "--no-macros", "./entry.ts"],
        {},
        refused,
      ],
      // The prompt has a parser of its own. What it prints for the refusal is not pinned.
      [
        "bun repl --no-macros, a macro call typed at the prompt",
        {},
        ["repl", "--no-macros"],
        { stdin: `import { f } from "./macro.ts" with { type: "macro" }; f()\n.exit\n` },
        { stdout: expect.not.stringContaining("INLINED_RESULT"), macroRan: false, exitCode: 0 },
      ],
      [
        "bun repl without the flag, a macro call typed at the prompt",
        {},
        ["repl"],
        { stdin: `import { f } from "./macro.ts" with { type: "macro" }; f()\n.exit\n` },
        { stdout: expect.stringContaining("INLINED_RESULT"), macroRan: true, exitCode: 0 },
      ],
    ] as const)("%s", async (_, tree, cmd, options, expected) => {
      expect(await run({ ...files, ...tree }, cmd, options)).toMatchObject(expected);
    });

    // These commands start another bun to run a part of themselves. It gets the flag.
    test.each([
      [
        "bun test --parallel --no-macros",
        { "a.test.ts": importInATest, "b.test.ts": importInATest },
        ["test", "--parallel", "--no-macros", "./a.test.ts", "./b.test.ts"],
        {},
        { ...refused, stdout: expect.stringContaining("PARALLEL") },
      ],
      ["bun run --no-macros --parallel <file>", {}, ["run", "--no-macros", "--parallel", "./entry.ts"], {}, refused],
      [
        "bun --no-macros run --sequential <file>",
        {},
        ["--no-macros", "run", "--sequential", "./entry.ts"],
        {},
        refused,
      ],
      [
        'bun run --no-macros --parallel "run <file>"',
        {},
        ["run", "--no-macros", "--parallel", "run ./entry.ts"],
        {},
        refused,
      ],
      [
        'bun run --no-macros --parallel "test <file>"',
        { "entry.test.ts": importInATest },
        ["run", "--no-macros", "--parallel", "test ./entry.test.ts"],
        {},
        refused,
      ],
      [
        "bun install --no-macros, a security scanner",
        {
          "package.json": JSON.stringify({ name: "scanned", version: "1.0.0", dependencies: { dep: "file:./dep" } }),
          "dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
          "bunfig.toml": `[install]\ncache = false\n\n[install.security]\nscanner = "./scanner.ts"\n`,
          "scanner.ts": `
            import { f } from "./macro.ts" with { type: "macro" };
            export const scanner = {
              version: "1",
              async scan() {
                console.error(f());
                return [];
              },
            };
          `,
        },
        ["install", "--no-macros"],
        {},
        refused,
      ],
      // A package script is a command line of its own. `BUN_OPTIONS` is what reaches the bun it starts.
      [
        "a package script, BUN_OPTIONS=--no-macros",
        { "package.json": JSON.stringify({ name: "scripted", scripts: { go: `${bunExe()} entry.ts` } }) },
        ["run", "go"],
        { env: { BUN_OPTIONS: "--no-macros" } },
        refused,
      ],
    ] as const)(
      "%s",
      async (_, tree, cmd, options, expected) => {
        expect(await run({ ...files, ...tree }, cmd, options)).toMatchObject(expected);
      },
      slow,
    );

    // The process of a file of `bun run --parallel` gets the other switch of the command the same way,
    // and at the level the command has: only `=strict` refuses `new vm.Script()`.
    test.each([
      ["--disallow-code-generation-from-strings", "--parallel", "eval refused"],
      ["--disallow-code-generation-from-strings", "--sequential", "eval refused"],
      ["--disallow-code-generation-from-strings=strict", "--parallel", "eval refused, vm.Script refused"],
    ] as const)(
      "bun run %s %s <file>: the process of the file has the flag",
      async (flag, how, printed) => {
        const tree = {
          "script.js": `
            const tried = make => {
              try {
                make();
                return "made";
              } catch {
                return "refused";
              }
            };
            console.log("eval " + tried(() => eval("1 + 1")) + ", vm.Script " + tried(() => new (require("node:vm").Script)("1")));
          `,
        };
        expect(await run(tree, ["run", flag, how, "./script.js"])).toMatchObject({
          stdout: expect.stringContaining(printed),
          exitCode: 0,
        });
      },
      slow,
    );

    // `bun create <component>` bundles the component to see what it imports, and a bundle runs macros.
    // The command reads its own flags, and `--` ends them.
    const component = {
      ...files,
      "App.tsx": `
        import { f } from "./macro.ts" with { type: "macro" };
        export default function App() { return <div>{f()}</div>; }
      `,
      "package.json": JSON.stringify({ name: "my-app", private: true }),
    };
    const wroteFiles = (stdout: string) => stdout.split("\n").some(line => line.startsWith(" create "));
    test.each([
      ["bun --no-macros create <component>", ["--no-macros", "create", "./App.tsx"], {}],
      ["bun create <component> --no-macros", ["create", "./App.tsx", "--no-macros"], {}],
      [
        "BUN_OPTIONS=--no-macros bun create <component>",
        ["create", "./App.tsx"],
        { env: { BUN_OPTIONS: "--no-macros" } },
      ],
    ] as const)("%s refuses the macro and writes no file", async (_, cmd, options) => {
      const result = await run(component, cmd, options);
      expect(result).toMatchObject(refused);
      expect(wroteFiles(result.stdout)).toBe(false);
    });

    // With no registry these end with exit code 1 after the files are written.
    // Windows: `bun create <component>` does not reach its install step there (see create-jsx.test.ts).
    test.todoIf(isWindows).each([
      ["bun create <component> without the flag", ["create", "./App.tsx"]],
      ["bun create <component> -- --no-macros", ["create", "./App.tsx", "--", "--no-macros"]],
    ] as const)(
      "%s runs the macro and writes the files",
      async (_, cmd) => {
        const result = await run(component, cmd);
        expect(result).toMatchObject({ macroRan: true });
        expect(wroteFiles(result.stdout)).toBe(true);
      },
      slow,
    );

    // A file gets the flag on its command line, as `bun --no-macros <file>` has it. A name that
    // `bun run --parallel` takes for a file can also start with a command of bun, and `bun x`, for one,
    // refuses a flag there: the process of such a name gets the flag in `BUN_OPTIONS`.
    test(
      "bun run --no-macros --parallel: how the process of a file, and of a name that starts with a command, gets the flag",
      async () => {
        const tree = {
          "print.js": `console.log(JSON.stringify([process.execArgv, process.env.BUN_OPTIONS ?? null]));\n`,
        };
        const [file, command] = await Promise.all([
          run(tree, ["run", "--no-macros", "--parallel", "./print.js"]),
          run(tree, ["run", "--no-macros", "--parallel", "run ./print.js"]),
        ]);
        expect(file.stdout).toContain(`./print.js | [["--no-macros"],null]\n`);
        expect(command.stdout).toContain(`run ./print.js | [["--no-macros"],"--no-macros"]\n`);
      },
      slow,
    );

    // The gate is at the call: an import alone, and a call in dead code, are not refused. Without the
    // flag a template tag loads the module of the macro before it fails, so the marker is at the top
    // level of that module.
    const loaded = `import { writeFileSync } from "node:fs";\nwriteFileSync("MACRO_RAN", "");\nexport function f() {\n  return "INLINED_RESULT";\n}\n`;
    test.each([
      [
        "a macro that is imported and never called",
        `import { f } from "./macro.ts" with { type: "macro" };\nconsole.log("no call");\n`,
        { stdout: "no call\n", macroRan: false, exitCode: 0 },
      ],
      [
        "a macro call in dead code",
        `import { f } from "./macro.ts" with { type: "macro" };\nif (false) console.log(f());\nconsole.log("dead call");\n`,
        { stdout: "dead call\n", macroRan: false, exitCode: 0 },
      ],
      [
        "a macro call as a template tag",
        "import { f } from './macro.ts' with { type: 'macro' };\nconsole.log(f`x`);\n",
        refused,
      ],
    ] as const)("bun --no-macros <file>: %s", async (_, main, expected) => {
      const tree = { "macro.ts": loaded, "main.ts": main };
      expect(await run(tree, ["--no-macros", "main.ts"])).toMatchObject(expected);
    });

    // A `[macros]` table in bunfig.toml makes a macro of an ordinary import. Under the flag the table is
    // dropped and the import stays ordinary, also where bunfig.toml is read after the flag (`bun run`).
    const remapped = {
      "node_modules/somepkg/package.json": JSON.stringify({ name: "somepkg", version: "1.0.0", type: "module" }),
      "node_modules/somepkg/index.js": `export function thing() { return "ordinary import"; }\n`,
      "macro.ts": `
        import { writeFileSync } from "node:fs";
        export function thing() {
          writeFileSync("MACRO_RAN", "macro executed");
          return "macro result";
        }
      `,
      "bunfig.toml": `[macros]\nsomepkg = { thing = "./macro.ts" }\n`,
      "main.ts": `
        import { thing } from "somepkg";
        console.log(thing());
      `,
    };
    const ordinary = { macroRan: false, exitCode: 0 };
    test.each([
      ["bun <file>", ["main.ts"], { stdout: expect.stringContaining("macro result"), macroRan: true, exitCode: 0 }],
      [
        "bun build",
        ["build", "main.ts"],
        { stdout: expect.stringContaining("macro result"), macroRan: true, exitCode: 0 },
      ],
      ["bun --no-macros <file>", ["--no-macros", "main.ts"], { stdout: "ordinary import\n", ...ordinary }],
      ["bun run --no-macros <file>", ["run", "--no-macros", "main.ts"], { stdout: "ordinary import\n", ...ordinary }],
      [
        "bun build --no-macros",
        ["build", "--no-macros", "main.ts"],
        { stdout: expect.stringContaining(`return "ordinary import"`), ...ordinary },
      ],
    ] as const)("a [macros] table in bunfig.toml: %s", async (_, cmd, expected) => {
      expect(await run(remapped, cmd)).toMatchObject(expected);
    });

    // Without the table the import is transpiled as an ordinary import. A run without the flag must not
    // read that from the transpiler cache, which takes files of 4 KiB and more.
    test(
      "a [macros] table in bunfig.toml: bun run --no-macros <file> leaves nothing in the transpiler cache",
      async () => {
        using dir = tempDir("no-macros-cache", {
          ...remapped,
          "main.ts": remapped["main.ts"] + `// ${Buffer.alloc(4096, "x").toString()}\n`,
        });
        const env = {
          ...bunEnv,
          HOME: String(dir),
          USERPROFILE: String(dir),
          BUN_RUNTIME_TRANSPILER_CACHE_PATH: path.join(String(dir), "cache"),
          BUN_DEBUG_ENABLE_RESTORE_FROM_TRANSPILER_CACHE: "1",
        };
        const printed: string[] = [];
        for (const flags of [["--no-macros"], []]) {
          await using proc = Bun.spawn({
            cmd: [bunExe(), "run", ...flags, "main.ts"],
            env,
            cwd: String(dir),
            stdout: "pipe",
            stderr: "pipe",
          });
          const [stdout] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          printed.push(stdout.trim().split("\n").at(-1)!);
        }
        expect(printed).toEqual(["ordinary import", "macro result"]);
      },
      slow,
    );

    // One module per way to reach a macro from inside a running process. Each calls the macro, which
    // leaves `ran.<door>` behind when it runs. `doors.ts` goes through all of them and prints what it saw.
    const doors = [
      "import",
      "require",
      "Worker",
      "worker_threads",
      "worker_threads_execArgv_empty",
      "Bun.build",
      "Bun.build_macros_true",
      "Bun.Transpiler.transformSync",
      "Bun.Transpiler.transformSync_macro_true",
      "Bun.Transpiler.transformSync_macro_map",
      "Bun.Transpiler.transform",
      "Bun.Transpiler.scan",
      "html",
      "html_development",
    ];
    const doorFiles = {
      "mark.ts": `
        import { writeFileSync } from "node:fs";
        import { join } from "node:path";
        export function mark(door: string) {
          writeFileSync(join(import.meta.dir, "ran." + door), "");
          return "macro result";
        }
      `,
      ...Object.fromEntries(
        doors.map(door => [
          `${door}.ts`,
          `import { mark } from "./mark.ts" with { type: "macro" };\nexport default mark("${door}");\n`,
        ]),
      ),
      // An ordinary import, which the `macro` option of the transpiler makes a macro.
      "Bun.Transpiler.transformSync_macro_map.ts": `import { mark } from "somepkg";\nexport default mark("Bun.Transpiler.transformSync_macro_map");\n`,
      "html.html": `<script type="module" src="./html.ts"></script>`,
      "html_development.html": `<script type="module" src="./html_development.ts"></script>`,
      "doors.ts": `
        import { existsSync } from "node:fs";
        import { join } from "node:path";
        import { Worker as NodeWorker } from "node:worker_threads";
        import html from "./html.html";
        import htmlDevelopment from "./html_development.html";

        const here = (name: string) => join(import.meta.dir, name);
        const source = (door: string) => Bun.file(here(door + ".ts")).text();
        const outcomes: Record<string, string> = {};
        // "ran" when the macro left its marker, "refused" when it did not and the door said why.
        function record(door: string, reported: unknown) {
          const text = Bun.inspect(reported);
          outcomes[door] = existsSync(here("ran." + door)) ? "ran" : text.includes("Macros are disabled") ? "refused" : text;
        }

        record("import", await import("./import.ts").catch(error => error));
        try {
          record("require", require("./require.ts"));
        } catch (error) {
          record("require", error);
        }

        for (const [door, options] of [
          ["Bun.Transpiler.transformSync", {}],
          ["Bun.Transpiler.transformSync_macro_true", { macro: true }],
          ["Bun.Transpiler.transformSync_macro_map", { macro: { somepkg: { mark: "./mark.ts" } } }],
        ] as const) {
          try {
            record(door, new Bun.Transpiler({ loader: "ts", ...options } as any).transformSync(await source(door)));
          } catch (error) {
            record(door, error);
          }
        }
        const transpiler = new Bun.Transpiler({ loader: "ts" });
        record(
          "Bun.Transpiler.transform",
          await transpiler.transform(await source("Bun.Transpiler.transform")).catch(error => error),
        );
        try {
          record("Bun.Transpiler.scan", transpiler.scan(await source("Bun.Transpiler.scan")));
        } catch (error) {
          record("Bun.Transpiler.scan", error);
        }

        const { promise: worker, resolve: workerDone } = Promise.withResolvers();
        const webWorker = new Worker(here("Worker.ts"));
        webWorker.addEventListener("error", event => workerDone(event.message));
        webWorker.addEventListener("close", workerDone);
        record("Worker", await worker);

        for (const [door, options] of [
          ["worker_threads", {}],
          ["worker_threads_execArgv_empty", { execArgv: [] }],
        ] as const) {
          const { promise, resolve } = Promise.withResolvers();
          const nodeWorker = new NodeWorker(here(door + ".ts"), options);
          nodeWorker.on("error", resolve);
          nodeWorker.on("exit", resolve);
          record(door, await promise);
        }

        for (const [door, options] of [
          ["Bun.build", {}],
          ["Bun.build_macros_true", { macros: true }],
        ] as const) {
          const build = await Bun.build({ entrypoints: [here(door + ".ts")], throw: false, ...options });
          record(door, build.logs);
        }

        // A page whose bundle fails is a 500. The development server says why in the page, not as text.
        for (const [door, page, development] of [
          ["html", html, false],
          ["html_development", htmlDevelopment, true],
        ] as const) {
          await using server = Bun.serve({ port: 0, development, routes: { "/": page } });
          const response = await fetch(server.url);
          const script = (await response.text()).match(/src="([^"]+)"/)?.[1];
          if (script) await (await fetch(new URL(script, server.url))).text();
          record(door, response.status === 500 ? "Macros are disabled" : response.status);
        }

        console.log(JSON.stringify(outcomes));
      `,
    };
    const atEveryDoor = (outcome: string) => Object.fromEntries(doors.map(door => [door, outcome]));

    // A Worker that ran a macro does not free its macro tables when it ends (#45439). The leak check of
    // the ASAN lane reports that, and it is not what the first case is for.
    const withoutLeakCheck = { ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":") };
    // One at a time: a case here is the most work of this file, and the cases above and below then do
    // not run beside each other.
    test.serial.each([
      ["without the flag, every door runs the macro", [], withoutLeakCheck, {}, atEveryDoor("ran")],
      ["--no-macros", ["--no-macros"], {}, {}, atEveryDoor("refused")],
      ["BUN_OPTIONS=--no-macros", [], { BUN_OPTIONS: "--no-macros" }, {}, atEveryDoor("refused")],
      ["macros = false in bunfig.toml", [], {}, { "bunfig.toml": "macros = false\n" }, atEveryDoor("refused")],
    ] as const)(
      "inside a running process: %s",
      async (_, flags, env, bunfig, expected) => {
        const { stdout, stderr, exitCode } = await run({ ...doorFiles, ...bunfig }, [...flags, "doors.ts"], { env });
        const printed = stdout.trim().split("\n").at(-1)!;
        expect({ outcomes: printed.startsWith("{") ? JSON.parse(printed) : stderr, exitCode }).toEqual({
          outcomes: expected,
          exitCode: 0,
        });
      },
      slow,
    );

    // `bun lint` loads a plugin that `jsPlugins` names in its own process. It reads a configuration file in
    // another process, which gets neither `BUN_OPTIONS` nor a bunfig.toml, and `bun fmt` does the same.
    const plugin = {
      "plugin.mjs": `
        import { f } from "./macro.ts" with { type: "macro" };
        const message = f();
        const says = { create: context => ({ Program: node => context.report({ node, message }) }) };
        export default { meta: { name: "own" }, rules: { says } };
      `,
      "a.js": "1;\n",
    };
    const lintPlugin = {
      ...plugin,
      ".oxlintrc.json": JSON.stringify({ jsPlugins: ["./plugin.mjs"], rules: { "own/says": "error" } }),
    };
    const lintConfiguration = {
      ...plugin,
      "eslint.config.mjs": `
        import own from "./plugin.mjs";
        export default [{ files: ["a.js"], plugins: { own }, rules: { "own/says": "error" } }];
      `,
    };
    const fmtConfiguration = {
      "prettier.config.mjs": `
        import { f } from "./macro.ts" with { type: "macro" };
        export default { semi: f() !== "INLINED_RESULT" };
      `,
      "a.js": "a;\n",
    };
    const macrosFalse = { "bunfig.toml": "macros = false\n" };
    const lint = ["lint", "--threads", "2", "-f", "unix", "a.js"];
    const viaBunOptions = { env: { BUN_OPTIONS: "--no-macros" } };
    const pluginRefused = { stdout: expect.stringContaining("Macros are disabled"), macroRan: false, exitCode: 1 };
    const configurationRefused = { ...refused, exitCode: 2 };
    test.each([
      ["bun --no-macros lint, a plugin", lintPlugin, ["--no-macros", ...lint], {}, pluginRefused],
      ["bun lint, macros = false in bunfig.toml, a plugin", { ...lintPlugin, ...macrosFalse }, lint, {}, pluginRefused],
      [
        "bun --no-macros lint, a configuration file",
        lintConfiguration,
        ["--no-macros", ...lint],
        {},
        configurationRefused,
      ],
      [
        "BUN_OPTIONS=--no-macros bun lint, a configuration file",
        lintConfiguration,
        lint,
        viaBunOptions,
        configurationRefused,
      ],
      [
        "bun lint, macros = false in bunfig.toml, a configuration file",
        { ...lintConfiguration, ...macrosFalse },
        lint,
        {},
        configurationRefused,
      ],
      [
        "bun fmt without the flag, a configuration file",
        fmtConfiguration,
        ["fmt", "a.js"],
        {},
        { macroRan: true, exitCode: 0 },
      ],
      [
        "bun --no-macros fmt, a configuration file",
        fmtConfiguration,
        ["--no-macros", "fmt", "a.js"],
        {},
        configurationRefused,
      ],
    ] as const)(
      "%s",
      async (_, tree, cmd, options, expected) => {
        expect(await run({ ...files, ...tree }, cmd, options)).toMatchObject(expected);
      },
      slow,
    );
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

// Each parse thread creates a macro VM on its first macro call, and that VM loads the cwd's `.env` files.
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
