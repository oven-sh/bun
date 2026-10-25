import { escapeHTML } from "bun" with { type: "macro" };
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

// A module that is not the entry point is transpiled on a worker thread, which has no VM. The macro
// VM that its macro call starts has to take the CLI's transform options, or the macro module never
// sees `--define`.
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

// `Bun.build()` parses on the process-wide worker pool. The first macro call of the process starts
// the macro VM with the options of its build, and that VM lives on after the build. So this runs in
// its own process: an earlier build in the same process would otherwise decide what the macro sees.
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

// The first macro call from a parse thread starts the macro VM, and that VM loads the cwd's `.env` files.
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

// A thread with no VM does not run a macro itself: a work pool thread that transpiles an imported
// module or runs `transform()`, and every thread of `bun build`. It sends the call to the macro
// thread, which owns the one macro VM of the process, and copies the result back.
describe("the macro thread", () => {
  async function run(files: Record<string, string>, cmd: string[], env: Record<string, string | undefined> = bunEnv) {
    using dir = tempDir("macro-thread", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...cmd],
      env,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // Debug builds also print "[macro] call <name>" to stdout.
    const lines = stdout.split("\n").filter(line => line !== "" && !line.startsWith("[macro]"));
    return { lines, stderr, exitCode };
  }

  // The environment of the ASAN lane: the process destroys its VMs when it exits, and LeakSanitizer
  // then turns what is left into a report on stderr and a failed exit. A build without ASAN ignores
  // the two options and checks the behaviour only.
  const leakCheckedEnv = {
    ...bunEnv,
    BUN_DESTRUCT_VM_ON_EXIT: "1",
    ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=1"].filter(Boolean).join(":"),
    LSAN_OPTIONS:
      bunEnv.LSAN_OPTIONS ??
      `print_suppressions=0:suppressions=${path.join(import.meta.dir, "..", "..", "leaksan.supp")}`,
  };

  describe("leaves nothing of a macro for LeakSanitizer", () => {
    // Each macro makes an object with native memory behind it. `banner` drops it, the other two keep it.
    const files = {
      "banner.txt": "hello",
      "macro.ts": [
        `import { promises as fs } from "node:fs";`,
        `export function banner() {`,
        `  Bun.file(import.meta.dir + "/banner.txt");`,
        `  return "not returned";`,
        `}`,
        `export function kept() {`,
        `  ((globalThis as any).kept ??= []).push(Bun.file(import.meta.dir + "/banner.txt"));`,
        `  return "kept";`,
        `}`,
        `export async function read() {`,
        `  const bytes = await fs.readFile(import.meta.dir + "/banner.txt");`,
        `  ((globalThis as any).kept ??= []).push(bytes);`,
        `  return bytes.length;`,
        `}`,
      ].join("\n"),
      ...Object.fromEntries(
        [0, 1, 2, 3].map(i => [
          `lib${i}.ts`,
          `import { banner } from "./macro.ts" with { type: "macro" };\nexport default banner();\n`,
        ]),
      ),
      "lib-kept.ts": `import { kept } from "./macro.ts" with { type: "macro" };\nexport default kept();\n`,
      "lib-read.ts": `import { read } from "./macro.ts" with { type: "macro" };\nexport default await read();\n`,
      "static.ts": [
        `import a from "./lib0.ts";`,
        `import b from "./lib1.ts";`,
        `import c from "./lib2.ts";`,
        `import d from "./lib3.ts";`,
        `console.log(JSON.stringify([a, b, c, d]));`,
      ].join("\n"),
      "dynamic.ts": `console.log((await import("./lib0.ts")).default);\n`,
      "transform.ts": [
        'const code = `import { banner } from ${JSON.stringify(import.meta.dir + "/macro.ts")} with { type: "macro" };\\nexport default banner();`;',
        `console.log((await new Bun.Transpiler({ loader: "ts" }).transform(code)).trim());`,
      ].join("\n"),
      "worker.ts": [
        `const worker = new Worker(new URL(process.argv[2], import.meta.url).href);`,
        `worker.onmessage = event => {`,
        `  console.log(event.data);`,
        `  worker.terminate();`,
        `};`,
      ].join("\n"),
      "worker-imports.ts": `import value from "./lib0.ts";\npostMessage(value);\n`,
      "worker-calls.ts": `import { banner } from "./macro.ts" with { type: "macro" };\npostMessage(banner());\n`,
      "kept.ts": `import value from "./lib-kept.ts";\nconsole.log(value);\n`,
      "read.ts": `import value from "./lib-read.ts";\nconsole.log(value);\n`,
      "build-api.ts": [
        `const result = await Bun.build({ entrypoints: [import.meta.dir + "/kept.ts"] });`,
        `const text = await result.outputs[0].text();`,
        `console.log(text.split("\\n").find(line => line.includes('"kept"')));`,
      ].join("\n"),
    };

    // A build that leaks spends seconds on the symbols of each report, in a symbolizer that takes
    // over 1 GB. So these have the time to show the report, and they do not run at the same time.
    test.each([
      [
        "the modules that the entry file imports",
        ["run", "static.ts"],
        '["not returned","not returned","not returned","not returned"]',
      ],
      ["a module that import() loads", ["run", "dynamic.ts"], "not returned"],
      ["Bun.Transpiler#transform()", ["run", "transform.ts"], 'export default "not returned";'],
      ["a module that a Worker imports", ["run", "worker.ts", "./worker-imports.ts"], "not returned"],
      // This one runs in the Worker's own VM, which freed no macro table when it ended.
      ["the entry file of a Worker", ["run", "worker.ts", "./worker-calls.ts"], "not returned"],
      ["bun build --no-bundle", ["build", "--no-bundle", "./lib0.ts"], 'export default "not returned";'],
      ["an object that the macro keeps, in an imported module", ["run", "kept.ts"], "kept"],
      ["an object that the macro keeps, in Bun.build()", ["run", "build-api.ts"], 'var lib_kept_default = "kept";'],
      ["an object that the macro keeps, in bun build", ["build", "./kept.ts"], 'var lib_kept_default = "kept";'],
      ["what an async macro read and keeps", ["run", "read.ts"], "5"],
    ])(
      "%s",
      async (_, cmd, line) => {
        const { lines, stderr, exitCode } = await run(files, cmd, leakCheckedEnv);
        expect(stderr).toBe("");
        expect(lines).toContain(line);
        expect(exitCode).toBe(0);
      },
      60_000,
    );
  });

  // The next four tests do not run at the same time as other tests. Each one has a child that
  // never exits if the behaviour breaks, and the runner kills the child of a test that timed out
  // only when that test runs alone.

  // Each call waits until the other one arrived, so neither returns unless the macro VM runs the
  // second call while the first one waits.
  test("runs the macros of other files while a macro waits for a promise", async () => {
    const { lines, stderr, exitCode } = await run(
      {
        "gate.ts": [
          `const arrived: string[] = [];`,
          `let open!: () => void;`,
          `const both = new Promise<void>(resolve => (open = resolve));`,
          `export async function gate(name: string) {`,
          `  arrived.push(name);`,
          `  if (arrived.length === 2) open();`,
          `  await both;`,
          `  return arrived.length;`,
          `}`,
        ].join("\n"),
        "a.ts": `import { gate } from "./gate.ts" with { type: "macro" };\nexport default await gate("a");\n`,
        "b.ts": `import { gate } from "./gate.ts" with { type: "macro" };\nexport default await gate("b");\n`,
        "index.ts": `import a from "./a.ts";\nimport b from "./b.ts";\nconsole.log(a, b);\n`,
      },
      ["run", "index.ts"],
      // Each of the two calls keeps the pool thread of its module until it returns.
      { ...bunEnv, UV_THREADPOOL_SIZE: "4" },
    );
    expect({ lines, stderr }).toEqual({ lines: ["2 2"], stderr: "" });
    expect(exitCode).toBe(0);
  });

  // The result of `outer` holds a promise that settles only after a pool thread got `inner` from the
  // macro thread, which at that time waits for this promise.
  test("serves a macro call that the result it waits for depends on", async () => {
    const { lines, stderr, exitCode } = await run(
      {
        "macro.ts": [
          `export function inner() {`,
          `  return "inner";`,
          `}`,
          `export function outer() {`,
          '  const code = `import { inner } from ${JSON.stringify(import.meta.path)} with { type: "macro" };\\nexport default inner();`;',
          `  return { code: new Bun.Transpiler({ loader: "ts" }).transform(code) };`,
          `}`,
        ].join("\n"),
        "lib.ts": `import { outer } from "./macro.ts" with { type: "macro" };\nexport default outer();\n`,
        "index.ts": `import value from "./lib.ts";\nconsole.log(JSON.stringify(value));\n`,
      },
      ["run", "index.ts"],
    );
    expect({ lines, stderr }).toEqual({ lines: [JSON.stringify({ code: 'export default "inner";\n' })], stderr: "" });
    expect(exitCode).toBe(0);
  });

  // `outer` transpiles a call of `b` on the macro thread itself, so that thread loads `b.ts` and
  // waits. `b.ts` waits for a pool thread, which has to get `c` from the macro thread.
  test("serves a macro call that the module of another macro waits for", async () => {
    const { lines, stderr, exitCode } = await run(
      {
        "c.ts": `export function c() {\n  return "c";\n}\n`,
        "b.ts": [
          'const code = `import { c } from ${JSON.stringify(import.meta.dir + "/c.ts")} with { type: "macro" };\\nexport default c();`;',
          `const transpiled = await new Bun.Transpiler({ loader: "ts" }).transform(code);`,
          `export function b() {`,
          `  return transpiled.trim();`,
          `}`,
        ].join("\n"),
        "a.ts": [
          `export function outer() {`,
          '  const code = `import { b } from ${JSON.stringify(import.meta.dir + "/b.ts")} with { type: "macro" };\\nexport default b();`;',
          `  return new Bun.Transpiler({ loader: "ts" }).transformSync(code).trim();`,
          `}`,
        ].join("\n"),
        "lib.ts": `import { outer } from "./a.ts" with { type: "macro" };\nexport default outer();\n`,
        "index.ts": `import value from "./lib.ts";\nconsole.log(value);\n`,
      },
      ["run", "index.ts"],
    );
    expect({ lines, stderr }).toEqual({ lines: [`export default 'export default "c";';`], stderr: "" });
    expect(exitCode).toBe(0);
  });

  // `BUN_DESTRUCT_VM_ON_EXIT` makes the exit wait for the work that left the main thread. The macro
  // never returns, so the exit has to stop the macro thread to get the transpile of `lib.ts` back.
  test("stops a macro that is still running when the process exits", async () => {
    const { lines, stderr, exitCode } = await run(
      {
        "macro.ts": [
          `import { writeFileSync } from "node:fs";`,
          `export async function never() {`,
          `  writeFileSync(import.meta.dir + "/started", "");`,
          `  await new Promise(() => {});`,
          `}`,
        ].join("\n"),
        "lib.ts": `import { never } from "./macro.ts" with { type: "macro" };\nexport default await never();\n`,
        "index.ts": [
          `import { existsSync } from "node:fs";`,
          `import("./lib.ts");`,
          `while (!existsSync(import.meta.dir + "/started")) await Bun.sleep(1);`,
          `console.log("exiting");`,
          `process.exit(0);`,
        ].join("\n"),
      },
      ["run", "index.ts"],
      leakCheckedEnv,
    );
    expect({ lines, stderr }).toEqual({ lines: ["exiting"], stderr: "" });
    expect(exitCode).toBe(0);
  });

  test.concurrent("gives a macro in an imported module the result it has in the entry file", async () => {
    const files = {
      "shapes.ts": [
        `const shared = { n: 1 };`,
        `export const text = () => "caf\\u00e9 \\u4f60\\u597d \\u{1F600}";`,
        `export const numbers = () => [0, -0, 1.5, -7, 2 ** 40, 1e300];`,
        `export const nested = () => ({ a: [1, { b: [true, false, null, undefined] }], "key with space": {}, 3: "three", list: [] });`,
        `export const twice = () => ({ x: shared, y: shared, z: [shared] });`,
        `export const getter = () => ({ get list() { return [1, 2]; } });`,
        `export const json = () => new Response(JSON.stringify({ ok: [1, "two"] }), { headers: { "content-type": "application/json" } });`,
        `export const plain = () => new Response("plain text");`,
        `export const bytes = () => new Blob([new Uint8Array([0, 1, 2, 255])], { type: "application/octet-stream" });`,
        `export const later = async () => { await Bun.sleep(1); return { late: true }; };`,
        `export const promised = () => ({ inner: Promise.resolve("done") });`,
        `export const nothing = () => undefined;`,
      ].join("\n"),
      "use.ts": [
        `import { text, numbers, nested, twice, getter, json, plain, bytes, later, promised, nothing } from "./shapes.ts" with { type: "macro" };`,
        `console.log(JSON.stringify({`,
        `  text: text(),`,
        `  numbers: numbers().map(n => (Object.is(n, -0) ? "-0" : n)),`,
        `  nested: nested(),`,
        `  twice: twice(),`,
        `  getter: getter(),`,
        `  json: json(),`,
        `  plain: plain(),`,
        `  bytes: bytes(),`,
        `  later: await later(),`,
        `  promised: promised(),`,
        `  nothing: [nothing()].length,`,
        `}));`,
      ].join("\n"),
      "imports-use.ts": `import "./use.ts";\n`,
    };
    // `use.ts` as the entry file is transpiled on the main thread, so its macros run in the main VM.
    const [inEntryFile, inImportedModule] = await Promise.all([
      run(files, ["run", "use.ts"]),
      run(files, ["run", "imports-use.ts"]),
    ]);
    expect(inEntryFile).toEqual({
      lines: [
        JSON.stringify({
          text: "café 你好 😀",
          numbers: [0, "-0", 1.5, -7, 2 ** 40, 1e300],
          nested: { 3: "three", a: [1, { b: [true, false, null, null] }], "key with space": {}, list: [] },
          twice: { x: { n: 1 }, y: { n: 1 }, z: [{ n: 1 }] },
          getter: { list: [1, 2] },
          json: { ok: [1, "two"] },
          plain: "plain text",
          bytes: "data:application/octet-stream;base64,AAEC/w==",
          later: { late: true },
          promised: { inner: "done" },
          nothing: 1,
        }),
      ],
      stderr: "",
      exitCode: 0,
    });
    expect(inImportedModule).toEqual(inEntryFile);
  });

  // The getter throws while the macro thread reads the result. The macro VM reports that exception
  // and is ready for the next call.
  test.concurrent("runs the next macro after a result that throws when it is read", async () => {
    const { lines, stderr, exitCode } = await run(
      {
        "macro.ts": [
          `export const throwsInGetter = () => ({`,
          `  get x() {`,
          `    throw new Error("getter boom");`,
          `  },`,
          `});`,
          `export const fine = () => "fine";`,
        ].join("\n"),
        "a.ts": `import { throwsInGetter } from "./macro.ts" with { type: "macro" };\nexport default throwsInGetter();\n`,
        "b.ts": `import { fine } from "./macro.ts" with { type: "macro" };\nexport default fine();\n`,
        "index.ts": [
          `const failed = await import("./a.ts").then(() => false, () => true);`,
          `console.log(failed, (await import("./b.ts")).default);`,
        ].join("\n"),
      },
      ["run", "index.ts"],
    );
    expect(stderr).toContain("error: getter boom");
    expect(lines).toEqual(["true fine"]);
    expect(exitCode).toBe(0);
  });

  test.concurrent("exits with the code that a macro gives process.exit()", async () => {
    const { lines, stderr, exitCode } = await run(
      {
        "macro.ts": `export function exit3() {\n  process.exit(3);\n}\n`,
        "lib.ts": `import { exit3 } from "./macro.ts" with { type: "macro" };\nexport default exit3();\n`,
        "index.ts": `import value from "./lib.ts";\nconsole.log("not reached", value);\n`,
      },
      ["run", "index.ts"],
    );
    expect({ lines, stderr }).toEqual({ lines: [], stderr: "" });
    expect(exitCode).toBe(3);
  });

  // A bundler thread that is done with a build has the macro VM collect what the build's macros left.
  test.concurrent("collects the garbage of a Bun.build() when the build is over", async () => {
    const { lines, stderr, exitCode } = await run(
      {
        "macro.ts": [
          `let last: WeakRef<object> | undefined;`,
          `export function probe() {`,
          `  const state = last === undefined ? "first" : last.deref() === undefined ? "collected" : "alive";`,
          `  last = new WeakRef({});`,
          `  return state;`,
          `}`,
        ].join("\n"),
        "entry.ts": `import { probe } from "./macro.ts" with { type: "macro" };\nconsole.log(probe());\n`,
        "build.ts": [
          `import { bundlerWorkerLiveCount } from "bun:internal-for-testing";`,
          `async function build() {`,
          `  const result = await Bun.build({ entrypoints: [import.meta.dir + "/entry.ts"] });`,
          `  const text = await result.outputs[0].text();`,
          `  // The threads of a build let go of it after the build has its result.`,
          `  while (bundlerWorkerLiveCount() > 0) await Bun.sleep(1);`,
          `  return text.trim().split("\\n").at(-1);`,
          `}`,
          `console.log(await build());`,
          `console.log(await build());`,
        ].join("\n"),
      },
      ["run", "build.ts"],
    );
    expect({ lines, stderr }).toEqual({ lines: ['console.log("first");', 'console.log("collected");'], stderr: "" });
    expect(exitCode).toBe(0);
  });
});
