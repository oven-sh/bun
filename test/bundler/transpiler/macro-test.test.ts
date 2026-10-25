import { escapeHTML } from "bun" with { type: "macro" };
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, compileFixture, isASAN, isCI, isDebug, isLinux, isMusl, tempDir } from "harness";
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

// A macro runs on the thread that parses the file that calls it, and that thread sleeps until the
// promise the macro returned settles. A module that is not the entry point used to be parsed on a
// thread of the work pool, and a waiting macro held that thread. Most macros wait for a task of
// that same pool (a file read, a DNS lookup, a hash), so with as many such modules as the pool
// has threads, every thread slept and no task ran. A file that imports a macro is now parsed on a
// thread of a second pool. Two threads are the smallest work pool, and what a machine with two
// CPUs gets without the variable.
describe("macros in more modules than the work pool has threads", () => {
  const poolEnv = { ...bunEnv, UV_THREADPOOL_SIZE: "2" };
  // A process that hangs is killed, so that the test says how it ended and leaves none behind.
  // On a busy machine one process of a debug build can need more than the 5 seconds that
  // `bun test` gives a test, so each test here names its time.
  const killAfter = isCI || isDebug || isASAN ? 60_000 : 4_000;
  const timeout = killAfter + 10_000;
  const readsAFile = `import { promises as fs } from "node:fs";\nexport async function m() {\n  return (await fs.readFile(import.meta.dir + "/data.txt", "utf8")).trim();\n}\n`;
  // A macro's runtime on a pool thread is never torn down. What the garbage in it owns (the Blob
  // of Bun.file() is one) then reads as leaked when the process exits, with one module too.
  const noLeakCheck = { ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":") };

  // `count` modules that each call the macro `m` (of one module, or of a module of their own),
  // and an entry that imports them all and prints how many values it got and which.
  function modules(count: number, macroSource: string, { use = "m()", macroPerModule = false }: Shape = {}) {
    const files: Record<string, string> = { "data.txt": "hello\n" };
    let entry = "";
    for (let i = 0; i < count; i++) {
      const macro = macroPerModule ? `m${i}.ts` : "m.ts";
      files[macro] = macroSource;
      files[`mod${i}.ts`] = `import { m } from "./${macro}" with { type: "macro" };\nexport const v = ${use};\n`;
      entry += `import { v as v${i} } from "./mod${i}.ts";\n`;
    }
    const values = Array.from({ length: count }, (_, i) => `v${i}`).join(", ");
    files["entry.ts"] = entry + `console.log([${values}].length, [...new Set([${values}])].join());\n`;
    return files;
  }

  async function run(files: Record<string, string>, entry: string, env: Record<string, string> = {}) {
    using dir = tempDir("macro-pool", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", entry],
      env: { ...poolEnv, ...env },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      timeout: killAfter,
      killSignal: "SIGKILL",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // Debug builds also print "[macro] call <name>" to stdout.
    const lines = stdout
      .trim()
      .split("\n")
      .filter(line => !line.startsWith("[macro]"));
    return { lines, stderr, exitCode, signalCode: proc.signalCode };
  }
  const printed = (...lines: string[]) => ({ lines, stderr: "", exitCode: 0, signalCode: null });

  type Shape = { use?: string; macroPerModule?: boolean; env?: Record<string, string> };
  const awaited: [name: string, macroSource: string, shape: Shape][] = [
    [
      "Bun.file().text()",
      `export async function m() {\n  return (await Bun.file(import.meta.dir + "/data.txt").text()).trim();\n}\n`,
      { env: noLeakCheck },
    ],
    ["fs.promises.readFile()", readsAFile, {}],
    [
      // Also a pool task where Bun.file() is not one (Windows reads it on the thread's own loop).
      "crypto.subtle.digest()",
      `export async function m() {\n  await crypto.subtle.digest("SHA-256", new Uint8Array(4096));\n  return "hello";\n}\n`,
      {},
    ],
    [
      "dns.promises.lookup()",
      `import { promises as dns } from "node:dns";\nexport async function m() {\n  await dns.lookup("localhost");\n  return "hello";\n}\n`,
      {},
    ],
    [
      // A thread evaluates a macro's module once, so each module gets a macro module of its own.
      "a top-level await in the macro's module",
      `import { promises as fs } from "node:fs";\nconst text = (await fs.readFile(import.meta.dir + "/data.txt", "utf8")).trim();\nexport function m() {\n  return text;\n}\n`,
      { macroPerModule: true },
    ],
    [
      "a promise inside the object it returns",
      `import { promises as fs } from "node:fs";\nexport function m() {\n  return { text: fs.readFile(import.meta.dir + "/data.txt", "utf8").then(text => text.trim()) };\n}\n`,
      { use: "m().text" },
    ],
  ];

  test.concurrent.each(awaited)(
    "a macro that waits for %s, through import",
    async (_name, macroSource, shape) => {
      expect(await run(modules(32, macroSource, shape), "entry.ts", shape.env)).toEqual(printed("32 hello"));
    },
    timeout,
  );

  // No promise is waited for here: the macro itself blocks its thread, and what wakes it is a
  // Worker that first waits for a task of the work pool.
  test.concurrent(
    "a macro that blocks in Atomics.wait() until a Worker got a hash",
    async () => {
      const files = modules(
        3,
        [
          `export function m() {`,
          `  const done = new Int32Array(new SharedArrayBuffer(4));`,
          `  const worker = new Worker(import.meta.dir + "/hash.ts");`,
          `  worker.postMessage(done);`,
          `  Atomics.wait(done, 0, 0);`,
          `  worker.terminate();`,
          `  return "hello";`,
          `}`,
        ].join("\n"),
      );
      files["hash.ts"] = [
        `onmessage = async event => {`,
        `  await crypto.subtle.digest("SHA-256", new Uint8Array(4096));`,
        `  Atomics.store(event.data, 0, 1);`,
        `  Atomics.notify(event.data, 0);`,
        `};`,
      ].join("\n");
      expect(await run(files, "entry.ts")).toEqual(printed("3 hello"));
    },
    timeout,
  );

  test.concurrent(
    "through import()",
    async () => {
      const files = modules(32, readsAFile);
      files["index.ts"] = [
        `const loaded = await Promise.all(Array.from({ length: 32 }, (_, i) => import("./mod" + i + ".ts")));`,
        `console.log(loaded.length, [...new Set(loaded.map(mod => mod.v))].join());`,
      ].join("\n");
      expect(await run(files, "index.ts")).toEqual(printed("32 hello"));
    },
    timeout,
  );

  // macOS and Windows read the files of a build on a third pool, which the variable forces here.
  const ioPool: Record<string, string>[] = [{}, { BUN_FEATURE_FLAG_FORCE_IO_POOL: "1" }];

  test.concurrent.each(ioPool)(
    "through Bun.build() %j",
    async env => {
      const files = modules(32, readsAFile);
      files["index.ts"] = [
        `const result = await Bun.build({ entrypoints: ["./entry.ts"] });`,
        `console.log(result.success, (await result.outputs[0].text()).split('"hello"').length - 1);`,
      ].join("\n");
      expect(await run(files, "index.ts", env)).toEqual(printed("true 32"));
    },
    timeout,
  );

  test.concurrent(
    "through Bun.Transpiler#transform()",
    async () => {
      const files = {
        "data.txt": "hello\n",
        "m.ts": readsAFile,
        "index.ts": [
          `const transpiler = new Bun.Transpiler({ loader: "ts" });`,
          `const code = "import { m } from " + JSON.stringify(import.meta.dir + "/m.ts") + ' with { type: "macro" };\\nexport const v = m();\\n';`,
          `const outputs = await Promise.all(Array.from({ length: 32 }, () => transpiler.transform(code)));`,
          `console.log(outputs.length, [...new Set(outputs.map(output => output.trim()))].join());`,
          // A warning rejects transform(). The parse that stops before the import logs this one
          // too, and only what the second parse logs is reported: one message, not a list of two.
          `const warned = await transpiler.transform("--> a legacy comment\\n" + code).catch(error => error);`,
          `console.log(warned.name + ": " + warned.message);`,
        ].join("\n"),
      };
      expect(await run(files, "index.ts")).toEqual(
        printed(
          `32 export const v = "hello";`,
          `BuildMessage: Treating "-->" as the start of a legacy HTML single-line comment`,
        ),
      );
    },
    timeout,
  );

  // The development server keeps the descriptor of each file it watches. The task that parses a
  // changed file opens one more, which is closed when the file is already watched, so a task that
  // is parsed a second time has to still know that it opened one.
  test.concurrent.each(ioPool)(
    "through a development server's HTML route, which rebuilds without leaking descriptors %j",
    async env => {
      const files = modules(8, readsAFile);
      files["index.html"] =
        `<!DOCTYPE html>\n<html><head><script type="module" src="./entry.ts"></script></head><body></body></html>\n`;
      files["index.ts"] = [
        `import { readdirSync, readlinkSync, writeFileSync } from "node:fs";`,
        `import html from "./index.html";`,
        `const server = Bun.serve({ port: 0, development: true, routes: { "/": html }, fetch: () => new Response("") });`,
        `const deadline = performance.now() + 30_000;`,
        `async function get(url: string | URL) {`,
        `  return await (await fetch(url, { signal: AbortSignal.timeout(30_000) })).text();`,
        `}`,
        `async function bundle() {`,
        `  return await get(new URL((await get(server.url)).match(/src="([^"]+)"/)![1], server.url));`,
        `}`,
        `const mod0 = import.meta.dir + "/mod0.ts";`,
        `function descriptorsOfMod0() {`,
        `  if (process.platform !== "linux") return 1;`,
        `  return readdirSync("/proc/self/fd").filter(fd => {`,
        `    try {`,
        `      return readlinkSync("/proc/self/fd/" + fd) === mod0;`,
        `    } catch {`,
        `      return false;`,
        `    }`,
        `  }).length;`,
        `}`,
        `console.log((await bundle()).split('"hello"').length - 1, descriptorsOfMod0());`,
        `for (let i = 0; i < 3; i++) {`,
        `  writeFileSync(mod0, 'import { m } from "./m.ts" with { type: "macro" };\\nexport const v = m() + "#rebuild' + i + '";\\n');`,
        `  while (!(await bundle()).includes("#rebuild" + i)) {`,
        `    if (performance.now() > deadline) throw new Error("the server did not rebuild");`,
        `  }`,
        `}`,
        `console.log(descriptorsOfMod0());`,
        `server.stop(true);`,
      ].join("\n");
      // The server reports each build on stderr.
      const { stderr: _, ...result } = await run(files, "index.ts", env);
      expect(result).toEqual({ lines: ["8 1", "1"], exitCode: 0, signalCode: null });
    },
    timeout,
  );

  // The jobs of a Worker's VM take the same way to the second pool as those of the main thread's.
  test.concurrent(
    "through the import() and the Bun.build() of a Worker",
    async () => {
      const files = modules(32, readsAFile);
      files["worker.ts"] = [
        `const loaded = await Promise.all(Array.from({ length: 32 }, (_, i) => import("./mod" + i + ".ts")));`,
        `const result = await Bun.build({ entrypoints: [import.meta.dir + "/entry.ts"] });`,
        `const built = (await result.outputs[0].text()).split('"hello"').length - 1;`,
        `postMessage([loaded.length, [...new Set(loaded.map(mod => mod.v))].join(), result.success, built].join(" "));`,
      ].join("\n");
      files["index.ts"] = [
        `const worker = new Worker(import.meta.dir + "/worker.ts");`,
        `worker.onmessage = event => {`,
        `  console.log(event.data);`,
        `  worker.terminate();`,
        `};`,
        `worker.onerror = event => console.log("error", event.message);`,
      ].join("\n");
      expect(await run(files, "index.ts")).toEqual(printed("32 hello true 32"));
    },
    timeout,
  );

  // An import that bunfig.toml or the `macro` option of Bun.Transpiler names binds a macro with
  // no import attribute: by its default export in half of the modules here, by a named one in
  // the others.
  test.concurrent(
    "macros that a remap binds",
    async () => {
      const files: Record<string, string> = {
        "data.txt": "hello\n",
        "bunfig.toml": `[macros]\nremapped = { "named" = "./m.ts", "default" = "./m.ts" }\n`,
        "m.ts": [
          `import { promises as fs } from "node:fs";`,
          `const read = async () => (await fs.readFile(import.meta.dir + "/data.txt", "utf8")).trim();`,
          `export const named = read;`,
          `export default read;`,
        ].join("\n"),
      };
      const sources = [
        `import byDefault from "remapped";\nexport const v = byDefault();\n`,
        `import { named } from "remapped";\nexport const v = named();\n`,
      ];
      let entry = "";
      for (let i = 0; i < 32; i++) {
        files[`mod${i}.ts`] = sources[i % 2];
        entry += `import { v as v${i} } from "./mod${i}.ts";\n`;
      }
      const values = Array.from({ length: 32 }, (_, i) => `v${i}`).join(", ");
      files["entry.ts"] = [
        entry + `console.log([${values}].length, [...new Set([${values}])].join());`,
        `const macro = { remapped: { named: import.meta.dir + "/m.ts", default: import.meta.dir + "/m.ts" } };`,
        `const transpiler = new Bun.Transpiler({ loader: "ts", macro });`,
        `const sources = ${JSON.stringify(sources)};`,
        `const outputs = await Promise.all(Array.from({ length: 32 }, (_, i) => transpiler.transform(sources[i % 2])));`,
        `console.log(outputs.length, [...new Set(outputs.map(output => output.trim()))].join());`,
      ].join("\n");
      expect(await run(files, "entry.ts")).toEqual(printed("32 hello", `32 export const v = "hello";`));
    },
    timeout,
  );

  // The threads of the second pool are named "Bun Macro <n>", those of the work pool "Bun Pool
  // <n>". A file that the JS thread parses keeps its macros on that thread.
  function macroOfEachHost() {
    const files: Record<string, string> = {
      "where.ts": [
        `import { readFileSync } from "node:fs";`,
        `export function where() {`,
        `  return Bun.isMainThread + ":" + readFileSync("/proc/thread-self/comm", "utf8").trim();`,
        `}`,
      ].join("\n"),
      "index.ts": [
        `import { v as imported } from "./mod0.ts";`,
        `const dynamic = (await import("./mod1.ts")).v;`,
        `const required = require("./mod2.ts").v;`,
        `const build = await Bun.build({ entrypoints: [import.meta.dir + "/mod3.ts"] });`,
        `const built = (await build.outputs[0].text()).match(/"([^"]+)"/)?.[1];`,
        `const transpiler = new Bun.Transpiler({ loader: "ts" });`,
        `const code = "import { where } from " + JSON.stringify(import.meta.dir + "/where.ts") + ' with { type: "macro" };\\nexport const v = where();\\n';`,
        `const transformed = (await transpiler.transform(code)).match(/"([^"]+)"/)?.[1];`,
        `const transformedSync = transpiler.transformSync(code).match(/"([^"]+)"/)?.[1];`,
        // \`bun build\` parses on a pool of its own, whose threads have the default name too.
        `const cli = Bun.spawnSync({ cmd: [process.execPath, "build", import.meta.dir + "/mod3.ts"], env: process.env });`,
        `const builtByTheCli = cli.stdout.toString().match(/"([^"]+)"/)?.[1];`,
        `const thread = (value: unknown) => String(value).replace(/^true:.*$/, "the JS thread").replace(/ \\d+$/, "");`,
        `const forms = { imported, dynamic, required, built, transformed, transformedSync, builtByTheCli };`,
        `for (const [form, value] of Object.entries(forms)) console.log(form + ": " + thread(value));`,
      ].join("\n"),
    };
    for (let i = 0; i < 4; i++) {
      files[`mod${i}.ts`] = `import { where } from "./where.ts" with { type: "macro" };\nexport const v = where();\n`;
    }
    return files;
  }
  const onThreads = (pool: string) => [
    `imported: false:${pool}`,
    `dynamic: false:${pool}`,
    "required: the JS thread",
    `built: false:${pool}`,
    `transformed: false:${pool}`,
    "transformedSync: the JS thread",
    "builtByTheCli: false:Bun Pool",
  ];

  test.concurrent.skipIf(!isLinux)(
    "the thread that a macro runs on",
    async () => {
      expect(await run(macroOfEachHost(), "index.ts")).toEqual(printed(...onThreads("Bun Macro")));
    },
    timeout,
  );

  // Refuses a thread to a work pool thread that asks for one with a pool thread's stack: the
  // first thread of the second pool. With REFUSE_WHILE, only while that file exists.
  const refusesAThread = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <pthread.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <unistd.h>

int pthread_create(pthread_t *thread, const pthread_attr_t *attr, void *(*start)(void *), void *arg) {
  char name[32] = "";
  size_t stack = 0;
  prctl(PR_GET_NAME, name, 0, 0, 0);
  if (attr) pthread_attr_getstacksize(attr, &stack);
  const char *flag = getenv("REFUSE_WHILE");
  if (strncmp(name, "Bun Pool", 8) == 0 && stack == 4 * 1024 * 1024 && (!flag || access(flag, F_OK) == 0)) {
    (void)!write(2, "refused a thread\\n", 17);
    return EAGAIN;
  }
  return ((int (*)(pthread_t *, const pthread_attr_t *, void *(*)(void *), void *))dlsym(RTLD_NEXT, "pthread_create"))(thread, attr, start, arg);
}
`;
  const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
  const preload = (shim: string) => ({ LD_PRELOAD: [shim, bunEnv.LD_PRELOAD].filter(Boolean).join(":") });

  // A job scheduled on a pool that has no thread would never run.
  describe.skipIf(!isLinux || isMusl || !cc)("when the OS refuses the first thread of the second pool", () => {
    test.concurrent(
      "a macro runs on the thread that parses its file",
      async () => {
        using shimDir = tempDir("macro-pool-shim", { "shim.c": refusesAThread });
        const shim = compileFixture(path.join(String(shimDir), "shim.c"), { flags: ["-ldl"] });
        const { stderr, ...result } = await run(macroOfEachHost(), "index.ts", preload(shim));
        expect({ ...result, refused: stderr.includes("refused a thread") }).toEqual({
          lines: onThreads("Bun Pool"),
          exitCode: 0,
          signalCode: null,
          refused: true,
        });
      },
      timeout,
    );

    // Such a macro can parse a file that imports a macro itself, with transformSync(). And a
    // work pool thread that ran a macro runs no more of them once the second pool has a thread.
    test.concurrent(
      "macros move to the second pool when it gets a thread",
      async () => {
        const thread = `readFileSync("/proc/thread-self/comm", "utf8").trim().replace(/ \\d+$/, "")`;
        const files: Record<string, string> = {
          "shim.c": refusesAThread,
          "refuse": "",
          "data.txt": "hello\n",
          "inner.ts": `import { readFileSync } from "node:fs";\nexport function inner() {\n  return ${thread};\n}\n`,
          "first.ts": [
            `import { readFileSync } from "node:fs";`,
            `export function first() {`,
            `  const code = "import { inner } from " + JSON.stringify(import.meta.dir + "/inner.ts") + ' with { type: "macro" };\\nexport const v = inner();\\n';`,
            `  const nested = new Bun.Transpiler({ loader: "ts" }).transformSync(code).match(/"([^"]+)"/)?.[1];`,
            `  return ${thread} + " > " + nested;`,
            `}`,
          ].join("\n"),
          "later.ts": [
            `import { promises as fs, readFileSync } from "node:fs";`,
            `export async function later() {`,
            `  await fs.readFile(import.meta.dir + "/data.txt", "utf8");`,
            `  return ${thread};`,
            `}`,
          ].join("\n"),
          "index.ts": [
            `import { rmSync } from "node:fs";`,
            `const values = (mods: { v: string }[]) => [...new Set(mods.map(mod => mod.v))].join();`,
            `console.log("refused:", values(await Promise.all([import("./first0.ts"), import("./first1.ts")])));`,
            `rmSync(import.meta.dir + "/refuse");`,
            `const later = Array.from({ length: 4 }, (_, i) => import("./later" + i + ".ts"));`,
            `console.log("allowed:", values(await Promise.all(later)));`,
          ].join("\n"),
        };
        for (let i = 0; i < 2; i++) {
          files[`first${i}.ts`] =
            `import { first } from "./first.ts" with { type: "macro" };\nexport const v = first();\n`;
        }
        for (let i = 0; i < 4; i++) {
          files[`later${i}.ts`] =
            `import { later } from "./later.ts" with { type: "macro" };\nexport const v = later();\n`;
        }
        using dir = tempDir("macro-pool-refused", files);
        const shim = compileFixture(path.join(String(dir), "shim.c"), { flags: ["-ldl"] });
        await using proc = Bun.spawn({
          cmd: [bunExe(), "run", "index.ts"],
          // The Bun.Transpiler of `first` stays in the runtime of a pool thread: see `noLeakCheck`.
          env: { ...poolEnv, ...noLeakCheck, ...preload(shim), REFUSE_WHILE: path.join(String(dir), "refuse") },
          cwd: String(dir),
          stdout: "pipe",
          stderr: "pipe",
          timeout: killAfter,
          killSignal: "SIGKILL",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect({
          lines: stdout.split("\n").filter(line => line && !line.startsWith("[macro]")),
          refused: stderr.includes("refused a thread"),
          exitCode,
          signalCode: proc.signalCode,
        }).toEqual({
          lines: ["refused: Bun Pool > Bun Pool", "allowed: Bun Macro"],
          refused: true,
          exitCode: 0,
          signalCode: null,
        });
      },
      timeout,
    );
  });

  // A file whose macros cannot run is parsed where it is: no thread of the second pool starts
  // for it.
  const countsMacroThreads = [
    `import { readdirSync, readFileSync } from "node:fs";`,
    // A thread that a pool thread starts has that thread's name until it takes its own.
    `function macroThreads() {`,
    `  const names = readdirSync("/proc/self/task").map(task => {`,
    `    try {`,
    `      return readFileSync("/proc/self/task/" + task + "/comm", "utf8");`,
    `    } catch {`,
    `      return "";`,
    `    }`,
    `  });`,
    `  return new Set(names.filter(name => name.startsWith("Bun Macro"))).size;`,
    `}`,
    `const messages = (build: { logs: { message: string }[] }) => build.logs.map(log => log.message).join();`,
    `const failure = (error: unknown) => String((error as Error)?.message ?? error).split("\\n")[0];`,
  ];
  const callsAMacro = `import { m } from "./m.ts" with { type: "macro" };\nexport const v = m();\n`;
  const returnsHello = `export function m() {\n  return "hello";\n}\n`;

  test.concurrent.skipIf(!isLinux)(
    "the second pool has no thread for macros that are disabled or in node_modules",
    async () => {
      const files = {
        "m.ts": returnsHello,
        "mod.ts": callsAMacro,
        "node_modules/pkg/m.ts": returnsHello,
        "node_modules/pkg/index.ts": callsAMacro,
        "index.ts": [
          ...countsMacroThreads,
          `const disabled = await Bun.build({ entrypoints: ["./mod.ts"], macros: false, throw: false });`,
          `console.log(messages(disabled) + ":", macroThreads());`,
          `const inNodeModules = await Bun.build({ entrypoints: ["./node_modules/pkg/index.ts"], throw: false });`,
          `console.log(messages(inNodeModules) + ":", macroThreads());`,
          `const enabled = await Bun.build({ entrypoints: ["./mod.ts"] });`,
          `console.log(enabled.success + ":", macroThreads() > 0);`,
        ].join("\n"),
      };
      expect(await run(files, "index.ts")).toEqual(
        printed(
          "Macros are disabled: 0",
          "For security reasons, macros cannot be run from node_modules.: 0",
          "true: true",
        ),
      );
    },
    timeout,
  );

  test.concurrent.skipIf(!isLinux)(
    "the second pool has no thread under --disallow-code-generation-from-strings=strict",
    async () => {
      const files = {
        "m.ts": returnsHello,
        "mod.ts": callsAMacro,
        "index.ts": [
          ...countsMacroThreads,
          `console.log((await import("./mod.ts").then(() => "imported", failure)) + ":", macroThreads());`,
          `const build = await Bun.build({ entrypoints: ["./mod.ts"], throw: false });`,
          `console.log(messages(build) + ":", macroThreads());`,
          `const code = ${JSON.stringify(callsAMacro)}.replace("./m.ts", import.meta.dir + "/m.ts");`,
          `const transformed = new Bun.Transpiler({ loader: "ts" }).transform(code);`,
          `console.log((await transformed.then(() => "transformed", failure)) + ":", macroThreads());`,
        ].join("\n"),
      };
      const refusal = "Macros cannot be used with --disallow-code-generation-from-strings=strict: 0";
      const strict = { BUN_OPTIONS: "--disallow-code-generation-from-strings=strict" };
      expect(await run(files, "index.ts", strict)).toEqual(printed(refusal, refusal, refusal));
    },
    timeout,
  );

  // The error is the one that the parse on the second pool logged.
  test.concurrent(
    "a macro that fails after it waited fails each use with its error",
    async () => {
      const files = modules(
        8,
        `import { promises as fs } from "node:fs";\nexport async function m() {\n  await fs.readFile(import.meta.dir + "/data.txt", "utf8");\n  return Symbol("not a value that a macro can return");\n}\n`,
      );
      files["index.ts"] = [
        `const message = (error: unknown) =>`,
        `  String((error as Error)?.message ?? error).split("\\n")[0].replace(/ \\(JSType\\(\\d+\\)\\)/, "");`,
        `console.log("import:", await import("./entry.ts").then(() => "resolved", message));`,
        `const build = await Bun.build({ entrypoints: [import.meta.dir + "/entry.ts"], throw: false });`,
        `console.log("build:", build.success, build.logs.length, [...new Set(build.logs.map(message))].join());`,
        `const transpiler = new Bun.Transpiler({ loader: "ts" });`,
        `const code = "import { m } from " + JSON.stringify(import.meta.dir + "/m.ts") + ' with { type: "macro" };\\nexport const v = m();\\n';`,
        `const transformed = await Promise.allSettled(Array.from({ length: 8 }, () => transpiler.transform(code)));`,
        `console.log("transform:", transformed.length, [...new Set(transformed.map(result => result.status + " " + message(result.reason)))].join());`,
      ].join("\n");
      const error = "cannot coerce symbol to Bun's AST. Please return a simpler type";
      expect(await run(files, "index.ts")).toEqual(
        printed(`import: ${error}`, `build: false 8 ${error}`, `transform: 8 rejected ${error}`),
      );
    },
    timeout,
  );

  // Such a file is parsed on a thread that runs macros, and still nothing loads the macro's module.
  test.concurrent(
    "a macro that is imported and not called is not loaded",
    async () => {
      const files = modules(32, `console.log("loaded");\nexport function m() {\n  return "called";\n}\n`, {
        use: `"hello"`,
      });
      expect(await run(files, "entry.ts")).toEqual(printed("32 hello"));
    },
    timeout,
  );
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
