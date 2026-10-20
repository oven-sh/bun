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

// Bun removes a macro import from the output and replaces only a call of it with the macro's result. A reference that
// is still counted after the visit pass names a binding that the output does not declare, so it is an error wherever
// the file is transpiled.
describe("a macro import that is used outside of a call", () => {
  const notDefined = (name: string) => `"${name}" is a macro import and is not defined at runtime`;
  // Where no identifier is left to point at: the error is at the import.
  const notDefinedInFile = (name: string) => `${notDefined(name)}, but this file uses it outside of a call`;
  const importNote = (name: string) => `Bun removes this macro import of "${name}" from "./m.ts"`;
  const advice = (name: string) =>
    `Bun replaces each direct call of a macro with its result. To inline a value, call a macro that returns it. To use "${name}" at runtime, add a regular import of it under another name.`;
  const typeofAdvice = (name: string) =>
    `"typeof ${name}" is always "undefined" at runtime. Remove the test: Bun replaces each direct call of "${name}" with its result.`;

  const macroFile = [
    `export function m(x?: unknown) { return 42; }`,
    `export function o() { return { a: 1, b: 2 }; }`,
    `export default function d() { return 7; }`,
    `export const K = [1, 2, 3].join(",");`,
    `export function boom() { throw new Error("boom"); }`,
    `export function failed() { return new Error("failed"); }`,
    ``,
  ].join("\n");
  const named = `import { m } from "./m.ts" with { type: "macro" };`;
  const star = `import * as ns from "./m.ts" with { type: "macro" };`;
  const dec = `function dec(...a: any[]) { return (..._: any[]) => {}; }`;

  // Each of these names the macro import `USE` once, on the line after the import. The error is at that identifier.
  // The extension is the loader: a `.js` file goes through the parser that has no TypeScript.
  const importOfUse = `import { m as USE } from "./m.ts" with { type: "macro" };\n`;
  const uses: Record<string, Record<string, string>> = {
    "operators and calls": {
      "alias.js": `const f = USE;`,
      "call-argument.js": `console.log(USE);`,
      "new-argument.js": `new Set(USE);`,
      "new-target.js": `new USE();`,
      "member.js": `console.log(USE.name);`,
      "index.js": `console.log(USE["name"]);`,
      "index-key.js": `console.log([1][USE]);`,
      "optional-member.js": `console.log(USE?.name);`,
      "method-call.js": `USE.call(null);`,
      "call-of-call.js": `console.log(USE.bind(null)()());`,
      "unary.js": `console.log(!USE);`,
      "typeof.js": `console.log(typeof USE);`,
      "binary-left.js": `console.log(USE + 1);`,
      "binary-right.js": `console.log(1 + USE);`,
      "logical.js": `console.log(globalThis.x || USE);`,
      "comma.js": `console.log((1, USE));`,
      "conditional-test.js": `console.log(USE ? 1 : 2);`,
      "conditional-yes.js": `console.log(globalThis.a ? USE : 1);`,
      "conditional-chain.js": `console.log(globalThis.a ? 1 : globalThis.b ? 2 : USE);`,
      "assignment-target.js": `USE = 1;`,
      "assignment-value.js": `let x; x = USE;`,
      "update.js": `USE++;`,
      "expression-statement.js": `USE;`,
      "satisfies.ts": `console.log(USE satisfies unknown);`,
      "non-null.ts": `console.log(USE!);`,
    },
    "literals and templates": {
      "array.js": `console.log([1, USE]);`,
      "spread.js": `console.log([...USE]);`,
      "object-value.js": `console.log({ a: USE });`,
      "object-shorthand.js": `console.log({ USE });`,
      "object-computed-key.js": `console.log({ [USE]: 1 });`,
      "object-spread.js": `console.log({ ...USE });`,
      "object-method.js": `console.log({ f() { return USE; } });`,
      "object-getter.js": `console.log({ get f() { return USE; } });`,
      "template.js": "console.log(`a${USE}b`);",
      "tagged-template.js": "console.log(String.raw`a${USE}b`);",
      "tag-member.js": "console.log(USE.raw`a`);",
      "dynamic-import.js": `import(USE);`,
      "import-options.js": `import("./m.ts", USE);`,
      "jsx-tag.jsx": `console.log(<USE />);`,
      "jsx-attribute.jsx": `console.log(<div a={USE} />);`,
      "jsx-child.jsx": `console.log(<div>{USE}</div>);`,
      // As deep to the left as it is long.
      "long-chain.js": `export const sum = USE${Buffer.alloc(2 * 5_000, "+x").toString()}; var x = 1;`,
      // Inside the depth limit of the walk that finds the identifier. `deep.js` below is outside of it.
      "nested.js": `console.log(${Buffer.alloc(400, "[").toString()}USE${Buffer.alloc(400, "]").toString()});`,
    },
    "functions and classes": {
      "arrow-body.js": `export const f = () => USE;`,
      "arrow-block.js": `export const f = () => { return USE; };`,
      "arrow-default.js": `export const f = (a = USE) => a;`,
      "function-body.js": `export function f() { return USE; }`,
      "function-default.js": `export function f(a = USE) { return a; }`,
      "function-expression.js": `export const f = function () { return USE; };`,
      "async.js": `export async function f() { return await USE; }`,
      "generator.js": `export function* f() { yield USE; }`,
      "destructuring-default.js": `export const { a = USE } = {};`,
      "array-destructuring-default.js": `export const [a = USE] = [];`,
      "nested-destructuring-default.js": `export const [[a = USE]] = [[]];`,
      "destructuring-computed-key.js": `export const { [USE]: a } = {};`,
      "parameter-destructuring-default.js": `export function f({ a = USE } = {}) { return a; }`,
      "class-extends.js": `export class A extends USE {}`,
      "default-class-extends.js": `export default class extends USE {}`,
      "class-field.js": `export class A { x = USE; }`,
      "class-static-field.js": `export class A { static x = USE; }`,
      "class-private-field.js": `export class A { #x = USE; get x() { return this.#x; } }`,
      "class-method.js": `export class A { f() { return USE; } }`,
      "class-computed-key.js": `export class A { [USE]() {} }`,
      "class-static-block.js": `export class A { static { console.log(USE); } }`,
      "class-expression.js": `export const A = class { x = USE; };`,
      "class-parameter-property.ts": `export class A { constructor(public x = USE) {} }`,
      // A lowered decorator is in the class and in the call that applies it. Each is one error.
      "class-decorator.ts": `${dec} @dec(USE) class A {} console.log(A);`,
      "field-decorator.ts": `${dec} class A { @dec(USE) x = 1; } console.log(A);`,
      "method-decorator.ts": `${dec} class A { @dec(USE) f() {} } console.log(A);`,
      "accessor-decorator.ts": `${dec} class A { @dec(USE) get g() { return 1; } } console.log(A);`,
      "parameter-decorator.ts": `${dec} class A { f(@dec(USE) x: any) {} } console.log(A);`,
      "constructor-parameter-decorator.ts": `${dec} class A { constructor(@dec(USE) x: any) {} } console.log(A);`,
      "decorated-computed-key.ts": `${dec} class A { @dec() [USE]() {} } console.log(A);`,
    },
    statements: {
      "if-test.js": `if (USE) console.log(1);`,
      "else-if.js": `if (globalThis.a) {} else if (globalThis.b) {} else if (USE) console.log(1);`,
      "if-body.js": `if (globalThis.a) { console.log(USE); }`,
      "for-init.js": `for (let i = USE; i < 1; i++) {}`,
      "for-test.js": `for (let i = 0; i < USE; i++) {}`,
      "for-update.js": `for (let i = 0; i < 1; i += USE) {}`,
      "for-body.js": `for (let i = 0; i < 1; i++) { console.log(USE); }`,
      "for-in.js": `for (const k in USE) {}`,
      "for-in-body.js": `for (const k in globalThis.a) { console.log(USE); }`,
      "for-of.js": `for (const k of USE) {}`,
      "for-of-body.js": `for (const k of globalThis.a) { console.log(USE); }`,
      "for-of-target.js": `for (USE of []) {}`,
      "while.js": `while (USE) {}`,
      "while-body.js": `while (globalThis.a) { console.log(USE); }`,
      "do-while.js": `do {} while (USE);`,
      "do-while-body.js": `do { console.log(USE); } while (globalThis.a);`,
      "switch-test.js": `switch (USE) {}`,
      "switch-case.js": `switch (globalThis.a) { case USE: break; }`,
      "switch-body.js": `switch (globalThis.a) { default: console.log(USE); }`,
      "try.js": `try { console.log(USE); } catch {}`,
      "catch.js": `try {} catch { console.log(USE); }`,
      "catch-binding-default.js": `try { globalThis.a(); } catch ({ a = USE }) {}`,
      "finally.js": `try {} finally { console.log(USE); }`,
      "throw.js": `throw USE;`,
      "label.js": `a: { console.log(USE); }`,
      "block.js": `{ console.log(USE); }`,
      "return.js": `export function f() { if (globalThis.a) return USE; }`,
    },
    "exports and TypeScript": {
      "export-clause.js": `export { USE };`,
      "export-clause-renamed.js": `export { USE as other };`,
      "export-default.js": `export default USE;`,
      "export-default-expression.js": `export default [USE];`,
      "export-const.js": `export const f = USE;`,
      "commonjs-export.js": `module.exports = USE;`,
      // The runtime wraps this file in a function.
      "commonjs-file.cjs": `module.exports = { f: USE };`,
      "export-equals.ts": `export = USE;`,
      "import-equals.ts": `import f = USE; console.log(f);`,
      "enum.ts": `enum E { A = USE as any } console.log(E.A);`,
      "namespace-block.ts": `namespace N { export const v = USE; } console.log(N.v);`,
    },
  };

  // Every spelling of the import. [source, ...the message of each error]
  const spellings: Record<string, [source: string, ...errors: string[]]> = {
    "constant.ts": [`import { K } from "./m.ts" with { type: "macro" }; console.log(K);`, notDefined("K")],
    "default.ts": [`import d from "./m.ts" with { type: "macro" }; console.log(d);`, notDefined("d")],
    "renamed.ts": [
      `import { m as renamed } from "./m.ts" with { type: "macro" }; console.log(renamed);`,
      notDefined("renamed"),
    ],
    "assert.ts": [`import { m } from "./m.ts" assert { type: "macro" }; console.log(m);`, notDefined("m")],
    "prefix.ts": [`import { m } from "macro:./m.ts"; console.log(m);`, notDefined("m")],
    // A file whose only macro import is a namespace, in JavaScript.
    "namespace.js": [`${star} console.log(Object.keys(ns));`, notDefined("ns")],
    "namespace-alias.js": [`${star} const f = ns; console.log(f);`, notDefined("ns")],
    "namespace-member.js": [`${star} const f = ns.m; console.log(f());`, notDefined("ns")],
    // The minifier does not inline a member, so this call is not one of a macro.
    "namespace-member-alias.js": [
      `${star} function g() { const f = ns.m; return 1 + f("x"); } console.log(g());`,
      notDefined("ns"),
    ],
    "namespace-member-of-member.js": [`${star} console.log(ns.m.call(null));`, notDefined("ns")],
  };

  // A reference beside a call, and a reference that the visit pass removes.
  const besideCalls: typeof spellings = {
    // A bundle counts a property of an import apart from the import.
    "property.ts": [`${named} console.log(m.name, m.call(null));`, notDefined("m"), notDefined("m")],
    // The linker used to panic on the property once the call beside it had removed the count of the import.
    "property-beside-call.ts": [`${named} console.log(m.name, m());`, notDefined("m")],
    // The same, where the visit pass also removes the function that reads the property.
    "removed-property-beside-call.ts": [
      `${named} export function g() { (() => m.name); return m(); }`,
      notDefinedInFile("m"),
    ],
    "two-imports.ts": [`${named} ${star} console.log(m, ns);`, notDefined("m"), notDefined("ns")],
    // Where the minifier inlines `f`, the call it leaves is not one that the macro replaced.
    "function-alias.ts": [`${named} function g() { const f = m; return f("x"); } console.log(g());`, notDefined("m")],
    // A bundle does not keep this function, and it is still an error.
    "uncalled-function.ts": [`${named} function uncalled() { return m; } console.log("loaded");`, notDefined("m")],
    "typeof-guard.ts": [`${named} console.log(typeof m === "function" ? "fn" : m());`, notDefined("m")],
    // Dead code that the output keeps can still name a macro import. That alone is not an error.
    "dead-beside-live.ts": [
      `import { m, o } from "./m.ts" with { type: "macro" }; if (false) { switch (o) {} } console.log(m);`,
      notDefined("m"),
    ],
    // A replaced call, live or dead, does not hide a use in another place.
    "beside-calls.ts": [
      `import fn, { m as renamed } from "./m.ts" with { type: "macro" }; ${star} export function later() { return [renamed(), ns.m()].map(renamed); } if (false) { console.log(fn()); } export { fn }; console.log(typeof ns, fn());`,
      notDefined("renamed"),
      notDefined("fn"),
      notDefined("ns"),
    ],
    // The visit pass counts a use before it removes the node that holds it. The count decides.
    "removed-node.ts": [`${named} export function g() { void m; }`, notDefinedInFile("m")],
    // The walk that finds the identifier stops at `MAX_DEPTH`. The error does not depend on it.
    "deep.js": [
      `${named} console.log(${Buffer.alloc(600, "[").toString()}m${Buffer.alloc(600, "]").toString()});`,
      notDefinedInFile("m"),
    ],
    // An error of the visit pass comes alone: the call that failed is not one more reference.
    "failed-call.ts": [
      `import { boom } from "./m.ts" with { type: "macro" }; console.log(boom, boom());`,
      expect.not.stringContaining("is a macro import"),
    ],
  };

  // The error follows what the visit pass replaces and removes, and that depends on how the file is transpiled.
  // `minified` is Bun.build() with `minify.syntax`, and `inspect` is an import under the inspector, which folds less.
  type Verdicts = { build: string[]; minified: string[]; import: string[]; inspect: string[]; transform: string[] };
  type Folded = Record<string, { source: string; stdout: string } & Verdicts>;
  const atIdentifier = [notDefined("m")];
  const atImport = [notDefinedInFile("m")];
  // A call that is replaced once its target is folded to the name of the import.
  const folded: Folded = {
    // The comma is folded away.
    "comma-call.ts": {
      source: `${named} console.log("comma-call", (0, m)());`,
      stdout: "comma-call 42",
      build: atIdentifier,
      minified: [],
      import: [],
      inspect: atIdentifier,
      transform: atIdentifier,
    },
    // The string index is folded to a member.
    "index-call.js": {
      source: `${star} console.log("index-call", ns["m"]());`,
      stdout: "index-call 42",
      build: [notDefined("ns")],
      minified: [],
      import: [],
      inspect: [notDefined("ns")],
      transform: [notDefined("ns")],
    },
    // The minifier inlines a local that is used once, and the visit of the result replaces the call.
    "alias-call.ts": {
      source: [
        `${named} ${star}`,
        `const binary = () => { const f = m; return 1 + f("x"); };`,
        `const conditional = (a: unknown) => { const f = m; return a ? f("x") : 0; };`,
        `const unary = () => { const f = m; return !f("x"); };`,
        `const namespace = () => { const f = ns; return 1 + f.m("x"); };`,
        `console.log("alias-call", binary(), conditional(1), unary(), namespace());`,
      ].join("\n"),
      stdout: "alias-call 43 42 false 43",
      build: [notDefined("m"), notDefined("m"), notDefined("m"), notDefined("ns")],
      minified: [],
      import: [],
      inspect: [notDefined("m"), notDefined("m"), notDefined("m"), notDefined("ns")],
      transform: [notDefined("m"), notDefined("m"), notDefined("m"), notDefined("ns")],
    },
    // A statement with no effect is removed, and its use with it where each statement is a part of its own.
    "void-statement.ts": {
      source: `${named} void m; console.log("void-statement", m());`,
      stdout: "void-statement 42",
      build: [],
      minified: [],
      import: [],
      inspect: [],
      transform: atImport,
    },
  };
  // The minifier removes what follows a `return`. The reference was counted before that, so the error stays.
  const removed: Folded = {
    "after-return.ts": {
      source: `${named} function g(a: unknown) { if (a) { return 1; console.log(m); } return m(); } console.log(g(0));`,
      stdout: "",
      build: atIdentifier,
      minified: atImport,
      import: atImport,
      inspect: atIdentifier,
      transform: atIdentifier,
    },
    // The linker used to panic on both bundles of this one.
    "property-after-return.ts": {
      source: `${named} function g(a: unknown) { if (a) { return 1; console.log(m.name); } return m(); } console.log(g(0));`,
      stdout: "",
      build: atIdentifier,
      minified: atImport,
      import: atImport,
      inspect: atIdentifier,
      transform: atIdentifier,
    },
  };

  // Each line of the first file prints one line, and keeps doing so.
  const accepted: [statement: string, stdout: string][] = [
    [`import d, { m, m as renamed, o } from "./m.ts" with { type: "macro" };`, ""],
    [`import * as ns from "./m.ts" with { type: "macro" };`, ""],
    [`import { m as asserted } from "./m.ts" assert { type: "macro" };`, ""],
    [`import { m as prefixed } from "macro:./m.ts";`, ""],
    [`import { m as unused } from "./m.ts" with { type: "macro" };`, ""],
    [`import * as unusedNamespace from "./m.ts" with { type: "macro" };`, ""],
    // What the note of the error says to do for a use at runtime.
    [`import { m as atRuntime } from "./m.ts";`, ""],
    [`console.log("call", m());`, "call 42"],
    [`console.log("optional-call", m?.());`, "optional-call 42"],
    [`console.log("parenthesized-call", (m)());`, "parenthesized-call 42"],
    [
      `console.log("type-assertions", (m as any)(), m!(), (<any>m)(), (m satisfies unknown)());`,
      "type-assertions 42 42 42 42",
    ],
    [`console.log("default-and-renamed", d(), renamed());`, "default-and-renamed 7 42"],
    [`console.log("assert-and-prefix", asserted(), prefixed());`, "assert-and-prefix 42 42"],
    [`console.log("namespace", ns.m(), ns?.m(), ns.default());`, "namespace 42 42 7"],
    [`console.log("use-before-import", late());`, "use-before-import 42"],
    [`console.log("at-runtime", typeof atRuntime, [1].map(atRuntime));`, "at-runtime function [ 42 ]"],
    [
      `type T = ReturnType<typeof m>; const typed: T = 1; let untyped: typeof m | undefined; console.log("type-only", typed, untyped);`,
      "type-only 1 undefined",
    ],
    [`const len = (m: string) => m.length; console.log("shadowed", len("abc"));`, "shadowed 3"],
    // An alias that is only a type. TypeScript removes the statement, and the check comes after that.
    [
      `import Alias = ns.K; let aliased: Alias | undefined; console.log("type-alias", aliased);`,
      "type-alias undefined",
    ],
    // A use in a branch that the visit pass knows is dead is not in the output.
    [`if (false) console.log(typeof m, m, ns); console.log("dead-branch");`, "dead-branch"],
    [`if (false) { console.log(m()); } false && m(); console.log("dead-call");`, "dead-call"],
    ['console.log("nested-calls", m(m()), [m(), m()].length, { a: m() }.a, `${m()}`);', "nested-calls 42 2 42 42"],
    [
      `class Fields { x = m(); static y = m(); #z = m(); get z() { return this.#z; } } console.log("class-fields", new Fields().x, Fields.y, new Fields().z);`,
      "class-fields 42 42 42",
    ],
    [
      `function withDefault(a = m()) { return a; } const arrowWithDefault = (a = m()) => a; console.log("default-parameters", withDefault(), arrowWithDefault());`,
      "default-parameters 42 42",
    ],
    [`const result = m(); const alias = result; console.log("result-alias", result + alias);`, "result-alias 84"],
    [
      `const { a, b } = o(); const [c] = [o().a]; console.log("destructured-result", a, b, c);`,
      "destructured-result 1 2 1",
    ],
    [`enum Enum { A = m(), B = A + 1 } console.log("enum", Enum.A, Enum.B);`, "enum 42 43"],
    [`namespace Block { export const v = m(); } console.log("namespace-block", Block.v);`, "namespace-block 42"],
    [`console.log("condition", m() ? "yes" : "no", m() && 1, m() ?? 2);`, "condition yes 1 42"],
    [`import { m as late } from "./m.ts" with { type: "macro" };`, ""],
  ];
  // A file whose only macro import is a namespace, in JavaScript.
  const acceptedStarOnly = `${star}\nconsole.log("star-only", ns.m(), ns?.m(), ns.default());`;
  const acceptedStdout = accepted.map(([, stdout]) => stdout).filter(line => line !== "");
  const acceptedSources: [string, string][] = [
    ["accepted.ts", accepted.map(([statement]) => statement).join("\n")],
    ["star-only.js", acceptedStarOnly],
  ];

  // An error as [message, line, column, ...notes], and a note as [message, line, column].
  const at = (position: any) => [position?.line ?? null, position?.column ?? null];
  const errorsOf = (errors: any[]) =>
    errors.map(error => [
      error.message,
      ...at(error.position),
      ...(error.notes ?? []).map((note: any) => [note.message, ...at(note.position)]),
    ]);
  const tsconfig = { compilerOptions: { experimentalDecorators: true } };
  const transpilerFor = (file: string) => new Bun.Transpiler({ loader: path.extname(file).slice(1) as "ts", tsconfig });
  // Prints, as its last line, the errors of each file in each directory.
  const driver = `
    import { readdirSync } from "node:fs";
    import path from "node:path";
    const at = ${at};
    const errorsOf = ${errorsOf};
    const tsconfig = ${JSON.stringify(tsconfig)};
    const transpilerFor = ${transpilerFor};
    const [how, ...directories] = process.argv.slice(2);
    const all: Record<string, Record<string, unknown[]>> = {};
    for (const directory of directories) {
      const files = readdirSync(directory).filter(file => file !== "m.ts").sort();
      const errors: Record<string, unknown[]> = Object.fromEntries(files.map(file => [file, []]));
      if (how === "build" || how === "minified") {
        const entrypoints = files.map(file => "./" + directory + "/" + file);
        const minify = { syntax: how === "minified" };
        const build = await Bun.build({ entrypoints, target: "bun", minify, outdir: "out/" + directory, throw: false });
        for (const log of build.logs) errors[path.basename(log.position?.file ?? "")]?.push(...errorsOf([log]));
        // A minified bundle that builds runs.
        if (how === "minified") for (const output of build.outputs) await import(output.path);
      } else {
        for (const file of files) {
          const source = "./" + directory + "/" + file;
          try {
            if (how === "import") await import(source);
            else transpilerFor(file).transformSync(await Bun.file(source).text());
          } catch (e: any) {
            errors[file] = errorsOf(e?.errors ?? [e]);
          }
        }
      }
      all[directory] = errors;
    }
    console.log(JSON.stringify(all));
  `;
  // Each directory holds its sources beside a copy of the macro file.
  type Sources = [file: string, source: string][];
  const fixture = (directories: Record<string, Sources>) => ({
    // The decorators in `uses` are TypeScript's.
    "tsconfig.json": JSON.stringify(tsconfig),
    "errors.ts": driver,
    // Bun.Transpiler has no path for its input, so it resolves "./m.ts" from the working directory.
    "m.ts": macroFile,
    ...Object.fromEntries(
      Object.entries(directories).flatMap(([directory, sources]) => [
        [`${directory}/m.ts`, macroFile],
        ...sources.map(([file, source]) => [`${directory}/${file}`, source + "\n"]),
      ]),
    ),
  });
  const sourcesOf = (table: Record<string, [source: string, ...unknown[]] | { source: string }>): Sources =>
    Object.entries(table).map(([file, row]) => [file, Array.isArray(row) ? row[0] : row.source]);

  async function run(cwd: string, ...args: string[]) {
    await using proc = Bun.spawn({ cmd: [bunExe(), ...args], env: bunEnv, cwd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // A debug build also prints "[macro] call <name>" to stdout.
    const lines = stdout
      .trim()
      .split("\n")
      .filter(line => !line.startsWith("[macro]"));
    return { lines, stderr, exitCode };
  }
  // The errors of each file of each directory, and what the files printed.
  async function transpile(directories: Record<string, Sources>, ...args: string[]) {
    using dir = tempDir("macro-value-use", fixture(directories));
    const { lines, stderr, exitCode } = await run(String(dir), ...args, ...Object.keys(directories));
    return { errors: JSON.parse(lines.at(-1)!), printed: lines.slice(0, -1), stderr, exitCode };
  }

  const messagesOf = (errors: Record<string, [message: string][]>) =>
    Object.fromEntries(Object.entries(errors).map(([file, errors]) => [file, errors.map(([message]) => message)]));
  const expectedOf = (table: typeof spellings) =>
    Object.fromEntries(Object.entries(table).map(([file, [, ...errors]]) => [file, errors]));

  // Bun.build(), the runtime and Bun.Transpiler each transpile with their own options. A debug build of Bun needs
  // seconds for a directory of files, so each of these tests takes one directory and they run one at a time.
  describe.each(Object.keys(uses))("each reference in %s is an error at its identifier", group => {
    const sources = Object.entries(uses[group]).map(([file, source]): Sources[0] => [file, importOfUse + source]);
    const expected = Object.fromEntries(
      Object.entries(uses[group]).map(([file, source]) => [
        file,
        [
          [
            notDefined("USE"),
            2,
            source.indexOf("USE") + 1,
            [importNote("USE"), 1, 10],
            [file === "typeof.js" ? typeofAdvice("USE") : advice("USE"), null, null],
          ],
        ],
      ]),
    );

    test.each(["build", "import"])("%s", async how => {
      const { errors, stderr, exitCode } = await transpile({ uses: sources }, "errors.ts", how);
      expect({ errors: errors.uses, stderr }).toEqual({ errors: expected, stderr: "" });
      expect(exitCode).toBe(0);
    });

    // No call is in these files, so nothing resolves the macro and the transpiler of this process does.
    test("transform", () => {
      const errors = sources.map(([file, source]) => {
        try {
          transpilerFor(file).transformSync(source);
          return [file, []];
        } catch (e: any) {
          return [file, errorsOf(e?.errors ?? [e])];
        }
      });
      expect(Object.fromEntries(errors)).toEqual(expected);
    });
  });

  describe("each spelling of the import is an error", () => {
    test("build", async () => {
      const { errors, printed, stderr, exitCode } = await transpile(
        { spellings: sourcesOf(spellings) },
        "errors.ts",
        "build",
      );
      expect({ errors: messagesOf(errors.spellings), printed, stderr }).toEqual({
        errors: expectedOf(spellings),
        printed: [],
        stderr: "",
      });
      expect(exitCode).toBe(0);
    });
  });
  describe("a reference beside a call is an error", () => {
    test("build", async () => {
      const { errors, printed, stderr, exitCode } = await transpile(
        { beside: sourcesOf(besideCalls) },
        "errors.ts",
        "build",
      );
      expect({ errors: messagesOf(errors.beside), printed, stderr }).toEqual({
        errors: expectedOf(besideCalls),
        printed: [],
        stderr: "",
      });
      expect(exitCode).toBe(0);
    });
  });
  test.each(["import", "transform"])("%s: each spelling, and a reference beside a call, is an error", async how => {
    const directories = { spellings: sourcesOf(spellings), beside: sourcesOf(besideCalls) };
    const { errors, printed, stderr, exitCode } = await transpile(directories, "errors.ts", how);
    expect({ spellings: messagesOf(errors.spellings), beside: messagesOf(errors.beside), printed, stderr }).toEqual({
      spellings: expectedOf(spellings),
      beside: expectedOf(besideCalls),
      printed: [],
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  // [the arguments of bun, whether the files with no error run]
  const ways: Record<keyof Verdicts, [args: string[], runs: boolean]> = {
    build: [["errors.ts", "build"], false],
    minified: [["errors.ts", "minified"], true],
    import: [["errors.ts", "import"], true],
    inspect: [["--inspect=127.0.0.1:0", "errors.ts", "import"], true],
    transform: [["errors.ts", "transform"], false],
  };
  test.each(["build", "import", "transform"] as const)("%s: a call is not an error", async way => {
    const [args, runs] = ways[way];
    const { errors, printed, stderr, exitCode } = await transpile({ accepted: acceptedSources }, ...args);
    expect({ errors: errors.accepted, printed, stderr }).toEqual({
      errors: { "accepted.ts": [], "star-only.js": [] },
      printed: runs ? [...acceptedStdout, "star-only 42 42 7"] : [],
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });
  test.each(Object.keys(ways) as (keyof Verdicts)[])(
    "%s: what counts as a call follows what is replaced",
    async way => {
      const [args, runs] = ways[way];
      const { errors, printed, exitCode } = await transpile(
        { folded: sourcesOf(folded), removed: sourcesOf(removed) },
        ...args,
      );
      const verdictsOf = (table: Folded) =>
        Object.fromEntries(Object.entries(table).map(([file, row]) => [file, row[way]]));
      expect({ folded: messagesOf(errors.folded), removed: messagesOf(errors.removed), printed }).toEqual({
        folded: verdictsOf(folded),
        removed: verdictsOf(removed),
        // The driver takes the files in the order of their names.
        printed: runs
          ? Object.keys(folded)
              .sort()
              .filter(file => folded[file][way].length === 0)
              .map(file => folded[file].stdout)
          : [],
      });
      expect(exitCode).toBe(0);
    },
  );

  test.concurrent("a bundle of the accepted forms runs", async () => {
    using dir = tempDir("macro-value-use", fixture({ accepted: acceptedSources }));
    const build = await run(String(dir), "build", "./accepted/accepted.ts", "--target=bun", "--outdir", "out");
    expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const { lines, stderr, exitCode } = await run(String(dir), "out/accepted.js");
    expect({ lines, stderr }).toEqual({ lines: acceptedStdout, stderr: "" });
    expect(exitCode).toBe(0);
  });

  // With --no-macros a call of a macro is an error. Any other reference is still the name of a removed binding.
  test.concurrent("a reference that is not a call is an error with --no-macros too", async () => {
    using dir = tempDir("macro-value-use", {
      "m.ts": macroFile,
      "alias.js": `${named} const f = m; console.log(f("x"));\n`,
    });
    const { stderr, exitCode } = await run(String(dir), "build", "--no-macros", "--no-bundle", "./alias.js");
    expect(stderr).toContain(notDefined("m"));
    expect(exitCode).toBe(1);
  });

  // A macro that returns an Error leaves its call in place, and that call was visited as a call. The minifier then
  // moves it, and the second visit must not take the count of the reference beside it.
  test.concurrent("a call that failed and that the minifier moves does not hide a reference beside it", async () => {
    using dir = tempDir("macro-value-use", {
      "m.ts": macroFile,
      "moved.js": `import { failed } from "./m.ts" with { type: "macro" }; function g() { const x = failed(); return 1 + x; } console.log(failed, g);\n`,
    });
    const { stderr, exitCode } = await run(String(dir), "build", "--minify-syntax", "--target=bun", "./moved.js");
    expect(stderr).toContain(notDefined("failed"));
    expect(exitCode).toBe(1);
  });

  // `bun repl` runs its input at once. For an input that does not transpile it prints the engine's error for the
  // untranspiled source, so the check is off there: a reference that runs is the ReferenceError that it was.
  test.concurrent("bun repl runs an input with a reference as before", async () => {
    using dir = tempDir("macro-value-use", { "m.ts": macroFile });
    const [dead, alias] = await Promise.all([
      run(String(dir), "repl", "-e", `${named} if (false) console.log(m); console.log("dead", m());`),
      run(String(dir), "repl", "-e", `${named} const f = m; console.log("alias", f);`),
    ]);
    expect({ lines: dead.lines, stderr: dead.stderr }).toEqual({ lines: ["dead 42"], stderr: "" });
    expect(alias.stderr).toContain("ReferenceError: m is not defined");
    expect([dead.exitCode, alias.exitCode]).toEqual([0, 1]);
  });

  // The module format of the dev server moves each export into an object before the check.
  test.concurrent("the module format of the dev server has the same errors", async () => {
    using dir = tempDir("macro-value-use", {
      "m.ts": macroFile,
      "alias.js": `${named}\nconst f = m;\nconsole.log(f("x"));\n`,
      "exports.js": `${named}\nexport { m };\nexport default m;\nexport const f = m;\n`,
      "accepted.ts": `${named}\n${star}\nimport Alias = ns.K;\nlet aliased: Alias | undefined;\nconsole.log(m(), aliased);\n`,
    });
    const files = ["alias.js", "exports.js", "accepted.ts"];
    const builds = await Promise.all(
      files.map(file => run(String(dir), "build", "--format=internal_bake_dev", "--target=browser", `./${file}`)),
    );
    // Each error as "<message> at <file>:<line>:<column>".
    const errorsIn = (stderr: string) =>
      [...stderr.matchAll(/^error: (.*)\n +at .*[\\/]([^\\/\n]+)$/gm)].map(
        ([, message, where]) => `${message} at ${where}`,
      );
    expect(Object.fromEntries(files.map((file, i) => [file, errorsIn(builds[i].stderr).sort()]))).toEqual({
      "alias.js": [`${notDefined("m")} at alias.js:2:11`],
      "exports.js": [
        `${notDefined("m")} at exports.js:2:10`,
        `${notDefined("m")} at exports.js:3:16`,
        `${notDefined("m")} at exports.js:4:18`,
      ],
      "accepted.ts": [],
    });
    expect(builds.map(build => build.exitCode)).toEqual([1, 1, 0]);
  });

  // A macro remap replaces a plain import of a package. The package has the export at runtime, and Bun removes the
  // binding all the same.
  test.concurrent("an import that a macro remap replaces is an error too", async () => {
    using dir = tempDir("macro-value-use", {
      "bunfig.toml": `[macros]\nfakepkg = { "m" = "./m.ts" }\n`,
      "m.ts": macroFile,
      "node_modules/fakepkg/package.json": JSON.stringify({ name: "fakepkg", version: "1.0.0", type: "module" }),
      "node_modules/fakepkg/index.js": [
        `export function m() { return "m at runtime"; }`,
        `export function other() { return "other at runtime"; }`,
        ``,
      ].join("\n"),
      "value.ts": `import { m as local, other } from "fakepkg";\nconst f = local;\nconsole.log(f, other());\n`,
      // What the note of the error says to write.
      "namespace.ts": `import * as pkg from "fakepkg";\nconsole.log(pkg.m(), pkg.other());\n`,
      "load.ts": `
        const at = ${at};
        const errorsOf = ${errorsOf};
        try {
          await import("./value.ts");
        } catch (e: any) {
          console.log(JSON.stringify(errorsOf(e?.errors ?? [e])));
        }
        await import("./namespace.ts");
      `,
    });
    const { lines, stderr, exitCode } = await run(String(dir), "load.ts");
    expect({ errors: JSON.parse(lines[0]), printed: lines.slice(1), stderr }).toEqual({
      errors: [
        [
          notDefined("local"),
          2,
          11,
          [`Bun removes this import of "local" because a macro remap replaces it with "./m.ts"`, 1, 10],
          [
            `Bun replaces each direct call of a macro with its result. To use "m" of the package at runtime, read it from a namespace import of the package, or remove the macro remap.`,
            null,
            null,
          ],
        ],
      ],
      printed: ["m at runtime other at runtime"],
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  // These read the same parse as transformSync() and print nothing. scanImports() does not visit the file.
  test("Bun.Transpiler: scan() and transform() have the error, and scanImports() does not", async () => {
    const transpiler = new Bun.Transpiler({ loader: "js" });
    const source = `${named}\nconst f = m;\nconsole.log(f, m);\n`;
    const errors = (e: any) => (e?.errors ?? [e]).map((error: any) => [error?.message, error?.notes?.length]);
    const thrownBy = (call: () => unknown) => {
      try {
        call();
      } catch (e) {
        return e;
      }
    };
    // The advice is a note of the first error of a binding only.
    const expected = [
      [notDefined("m"), 2],
      [notDefined("m"), 1],
    ];
    expect(errors(thrownBy(() => transpiler.scan(source)))).toEqual(expected);
    expect(errors(thrownBy(() => transpiler.transformSync(source)))).toEqual(expected);
    expect(errors(await transpiler.transform(source).catch(e => e))).toEqual(expected);
    expect(transpiler.scanImports(source)).toEqual([{ kind: "import-statement", path: "./m.ts" }]);
  });

  // A type that is named like a macro import is not a reference to it. The metadata of a decorated member names the
  // type, and a macro import has no value there.
  test.concurrent("a type named like a macro import is not an error with emitDecoratorMetadata", async () => {
    const body = (label: string) => [
      `const types: Record<string, unknown> = {};`,
      `(Reflect as any).metadata = (key: string, value: unknown) => (_: unknown, name: string) => {`,
      `  types[name + ":" + key] = value;`,
      `};`,
      `function field(..._: unknown[]) {}`,
      `class Holder {`,
      `  @field plain: Settings = Settings();`,
      `  @field dotted!: ns.Settings;`,
      `  @field regular!: other.Settings;`,
      `  @field method(a: Settings): ns.Settings { return a; }`,
      `}`,
      `const is = (key: string) => types[key] === Object;`,
      `console.log("${label}", JSON.stringify(new Holder().plain), is("plain:design:type"), is("dotted:design:type"),`,
      `  (types["method:design:paramtypes"] as unknown[])[0] === Object, is("method:design:returntype"));`,
    ];
    const imports = [
      `import { Settings } from "./settings.ts" with { type: "macro" };`,
      `import * as ns from "./settings.ts" with { type: "macro" };`,
      `import * as other from "./settings.ts";`,
    ];
    using dir = tempDir("macro-value-use", {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true },
      }),
      "settings.ts": `export interface Settings { a: number }\nexport function Settings(): Settings { return { a: 1 }; }\n`,
      // The type is a macro import when the import comes first, and a name that is not bound yet when it comes last.
      "import-first.ts": [...imports, ...body("import-first"), ``].join("\n"),
      "type-first.ts": [...body("type-first"), ...imports, ``].join("\n"),
      // One bundle of both files: a debug build of Bun needs a second for each.
      "check.ts": `
        const files = ["./import-first.ts", "./type-first.ts"];
        for (const file of files) await import(file);
        const build = await Bun.build({ entrypoints: files, target: "bun", throw: false });
        if (!build.success) console.log(build.logs.join("\\n"));
        for (const output of build.outputs) {
          const lines = (await output.text()).split("\\n").filter(line => line.includes("__legacyMetadataTS("));
          console.log(JSON.stringify(lines.map(line => line.trim())));
        }
      `,
    });
    // The parser leaks the list of names of a dotted type in decorator metadata, with or without a macro import. This
    // process has such types, so it runs without the leak check of an ASAN build.
    const env = { ...bunEnv, ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":") };
    await using proc = Bun.spawn({
      cmd: [bunExe(), "check.ts"],
      env,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const lines = stdout
      .trim()
      .split("\n")
      .filter(line => !line.startsWith("[macro]"));
    const metadata = [
      `__legacyMetadataTS("design:type", Object)`,
      `__legacyMetadataTS("design:type", Object)`,
      // A type from a regular import still reads its value.
      expect.stringMatching(/^__legacyMetadataTS\("design:type", typeof .+\.Settings\)$/),
      `__legacyMetadataTS("design:type", Function),`,
      `__legacyMetadataTS("design:paramtypes", [`,
      `__legacyMetadataTS("design:returntype", Object)`,
    ];
    expect({ lines: lines.map(line => (line.startsWith("[") ? JSON.parse(line) : line)), stderr }).toEqual({
      lines: [`import-first {"a":1} true true true true`, `type-first {"a":1} true true true true`, metadata, metadata],
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  // Inside a macro no call is replaced, so a module that a macro loads is not checked. What is transpiled there still
  // names the macro import, so a later load outside of a macro must not read it from the transpiler cache.
  test.concurrent(
    "a module that a macro loads is not checked, and is not cached for a load outside of a macro",
    async () => {
      using dir = tempDir("macro-value-use", {
        "m.ts": macroFile,
        "shared.ts": [
          named,
          `export function helper() { return "helper"; }`,
          `export function uncalled() { return m; }`,
          // Large enough for the transpiler cache to keep.
          `// ${Buffer.alloc(8 * 1024, "-").toString()}`,
          ``,
        ].join("\n"),
        "outer.ts": `import { helper } from "./shared.ts";\nexport function outer() { return helper(); }\n`,
        "inside.ts": `import { outer } from "./outer.ts" with { type: "macro" };\nconsole.log("inside", outer());\n`,
        "outside.ts": `import { helper } from "./shared.ts";\nconsole.log("outside", helper());\n`,
        "cache": {},
      });
      const env = {
        ...bunEnv,
        BUN_RUNTIME_TRANSPILER_CACHE_PATH: path.join(String(dir), "cache"),
        // A debug build reads the cache only with this.
        BUN_DEBUG_ENABLE_RESTORE_FROM_TRANSPILER_CACHE: "1",
      };
      for (const [file, expected] of [
        ["inside.ts", { lines: ["inside helper"], stderr: "", exitCode: 0 }],
        ["outside.ts", { lines: [""], stderr: expect.stringContaining(notDefined("m")), exitCode: 1 }],
      ] as const) {
        await using proc = Bun.spawn({ cmd: [bunExe(), file], env, cwd: String(dir), stdout: "pipe", stderr: "pipe" });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        const lines = stdout
          .trim()
          .split("\n")
          .filter(line => !line.startsWith("[macro]"));
        expect({ file, lines, stderr, exitCode }).toEqual({ file, ...expected });
      }
    },
  );
});
