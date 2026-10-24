import { escapeHTML } from "bun" with { type: "macro" };
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { existsSync, readdirSync, symlinkSync } from "node:fs";
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

// https://github.com/oven-sh/bun/issues/8779
// A macro runs in Bun while the importing file is transpiled. Its import resolves for that environment: Bun's
// conditions plus "macro". The target of the output, with its conditions and the "browser" field, decides plain
// imports only. What the user sets for the whole build applies to both: `--conditions`, `--main-fields`.
describe("a macro import resolves for the macro environment", () => {
  const who = (label: string) =>
    `export function who() {\n  return ${JSON.stringify(label)};\n}\nexport default who;\n`;
  const whoCjs = (label: string) => `exports.who = function who() {\n  return ${JSON.stringify(label)};\n};\n`;

  // The file a macro import of each specifier runs in Bun's runtime. `expected()` has the cells that depend on the
  // conditions of the importer. No cell depends on its target.
  const macroCells: Record<string, string> = {
    // "macro" is the first key that matches.
    "macro-first": "macro-first/macro.js",
    "macro-dot": "macro-dot/macro.js",
    "macro-nested": "macro-nested/macro.mjs",
    "macro-subpath/sub": "macro-subpath/sub.macro.js",
    "#m": "m.macro.ts",
    // A tsconfig.json "paths" entry applies as it does to a plain import.
    "@paths/who": "paths/who.ts",
    // The first key that matches wins, like in Node. Here that is "import".
    "macro-last": "macro-last/index.js",
    // The "macro" entry holds conditions and none of them matches, so the next key decides.
    "macro-fallthrough": "macro-fallthrough/index.js",
    // No "macro" key. The import still resolves for Bun and not for the output.
    "env-conditions": "env-conditions/for-bun.js",
    "browser-field": "browser-field/index.js",
    "browser-map": "browser-map/index.js",
    "module-main": "module-main/main.cjs",
    "dev-condition": "dev-condition/index.js",
    "custom-condition": "custom-condition/index.js",
  };

  // What imports it: a bundle for one of the three targets, or Bun's runtime with no bundle.
  type Importer = "browser" | "bun" | "node" | "runtime";
  // The file a plain import of the same specifier takes. That one does depend on the importer.
  // prettier-ignore
  const plainCells: Record<string, Record<Importer, string>> = {
    "macro-first":    { browser: "macro-first/index.js",          bun: "macro-first/index.js",      node: "macro-first/index.js",       runtime: "macro-first/index.js" },
    "env-conditions": { browser: "env-conditions/for-browser.js", bun: "env-conditions/for-bun.js", node: "env-conditions/for-node.js", runtime: "env-conditions/for-bun.js" },
    "browser-field":  { browser: "browser-field/browser.js",      bun: "browser-field/index.js",    node: "browser-field/index.js",     runtime: "browser-field/index.js" },
    "browser-map":    { browser: "browser-map/browser.js",        bun: "browser-map/index.js",      node: "browser-map/index.js",       runtime: "browser-map/index.js" },
    "module-main":    { browser: "module-main/module.mjs",        bun: "module-main/module.mjs",    node: "module-main/main.cjs",       runtime: "module-main/main.cjs" },
    "dev-condition":  { browser: "dev-condition/dev.js",          bun: "dev-condition/dev.js",      node: "dev-condition/dev.js",       runtime: "dev-condition/index.js" },
    "#m":             { browser: "m.browser.ts",                  bun: "m.ts",                      node: "m.ts",                       runtime: "m.ts" },
  };

  const expected = (importer: Importer, conditions: readonly string[] = []) => ({
    macro: {
      ...macroCells,
      // A bundle that is not for production has the "development" condition. It is not a condition of the target.
      ...(importer !== "runtime" && { "dev-condition": "dev-condition/dev.js" }),
      ...(conditions.includes("custom") && { "custom-condition": "custom-condition/custom.js" }),
      // A condition that the user names applies to a macro import too, also when it is the name of a target.
      ...(conditions.includes("browser") && {
        "env-conditions": "env-conditions/for-browser.js",
        "macro-fallthrough": "macro-fallthrough/browser.js",
      }),
    },
    plain: Object.fromEntries(Object.entries(plainCells).map(([specifier, files]) => [specifier, files[importer]])),
  });

  // A module that calls `who()` of every cell: `cells.macro` at transpile time, `cells.plain` when it runs.
  const macroSpecifiers = Object.keys(macroCells);
  const plainSpecifiers = Object.keys(plainCells);
  const cellsSource = [
    ...macroSpecifiers.map((s, i) => `import { who as macro${i} } from ${JSON.stringify(s)} with { type: "macro" };`),
    ...plainSpecifiers.map((s, i) => `import { who as plain${i} } from ${JSON.stringify(s)};`),
    `export const cells = {`,
    `  macro: { ${macroSpecifiers.map((s, i) => `${JSON.stringify(s)}: macro${i}()`).join(", ")} },`,
    `  plain: { ${plainSpecifiers.map((s, i) => `${JSON.stringify(s)}: plain${i}()`).join(", ")} },`,
    `};`,
    ``,
  ].join("\n");

  // Every file says which file it is.
  function fixture(extra: Record<string, string> = {}) {
    const files: Record<string, string> = {
      "package.json": JSON.stringify({
        name: "app",
        imports: {
          "#m": { macro: "./m.macro.ts", browser: "./m.browser.ts", default: "./m.ts" },
          "#path": "node:path",
        },
      }),
      "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@paths/*": ["./paths/*"] } } }),
      "paths/who.ts": who("paths/who.ts"),
      "m.ts": who("m.ts"),
      "m.macro.ts": who("m.macro.ts"),
      "m.browser.ts": who("m.browser.ts"),
      "entry.ts": cellsSource,
    };
    const pkg = (name: string, json: object, sources: string[]) => {
      files[`node_modules/${name}/package.json`] = JSON.stringify({ name, ...json });
      for (const file of sources) {
        files[`node_modules/${name}/${file}`] = (file.endsWith(".cjs") ? whoCjs : who)(`${name}/${file}`);
      }
    };
    const index = "./index.js";
    pkg("macro-first", { exports: { macro: "./macro.js", import: index, require: index, default: index } }, [
      "macro.js",
      "index.js",
    ]);
    pkg("macro-dot", { exports: { ".": { macro: "./macro.js", default: index } } }, ["macro.js", "index.js"]);
    pkg(
      "macro-nested",
      { exports: { ".": { macro: { import: "./macro.mjs", require: "./macro.cjs" }, default: index } } },
      ["macro.mjs", "macro.cjs", "index.js"],
    );
    pkg("macro-subpath", { exports: { "./sub": { macro: "./sub.macro.js", default: "./sub.js" } } }, [
      "sub.macro.js",
      "sub.js",
    ]);
    pkg("macro-fallthrough", { exports: { macro: { browser: "./browser.js" }, default: index } }, [
      "browser.js",
      "index.js",
    ]);
    pkg("macro-null", { exports: { macro: null, default: index } }, ["index.js"]);
    pkg("macro-only", { exports: { macro: "./macro.js" } }, ["macro.js"]);
    pkg("browser-only", { exports: { browser: "./browser.js" } }, ["browser.js"]);
    pkg("bun-file", { exports: { bun: "./bun.js", default: index } }, ["bun.js", "index.js"]);
    pkg("macro-last", { exports: { import: index, require: index, default: index, macro: "./macro.js" } }, [
      "macro.js",
      "index.js",
    ]);
    pkg(
      "env-conditions",
      { exports: { browser: "./for-browser.js", bun: "./for-bun.js", node: "./for-node.js", default: index } },
      ["for-browser.js", "for-bun.js", "for-node.js", "index.js"],
    );
    pkg("browser-field", { main: index, browser: "./browser.js" }, ["index.js", "browser.js"]);
    pkg("browser-map", { main: index, browser: { "./index.js": "./browser.js" } }, ["index.js", "browser.js"]);
    pkg("module-main", { main: "./main.cjs", module: "./module.mjs" }, ["main.cjs", "module.mjs"]);
    pkg("dev-condition", { exports: { development: "./dev.js", default: index } }, ["dev.js", "index.js"]);
    pkg("custom-condition", { exports: { custom: "./custom.js", default: index } }, ["custom.js", "index.js"]);
    return { ...files, ...extra };
  }

  // The table above, derived: a macro import takes the file that Bun's runtime resolves with the "macro" condition,
  // with "development" where the importer is a bundle that is not for production, and with the user's conditions.
  test.concurrent("the cells are what `bun run --conditions=macro` resolves", async () => {
    using dir = tempDir(
      "macro-env-oracle",
      fixture({
        "oracle.ts": `
          import path from "node:path";
          const label = file => {
            const inPackage = path.relative(path.join(import.meta.dir, "node_modules"), file);
            const relative = inPackage.startsWith("..") ? path.relative(import.meta.dir, file) : inPackage;
            return relative.replaceAll(path.sep, "/");
          };
          const specifiers = ${JSON.stringify(macroSpecifiers)};
          const resolved = specifiers.map(specifier => [specifier, label(Bun.resolveSync(specifier, import.meta.dir))]);
          console.log(JSON.stringify(Object.fromEntries(resolved)));
        `,
      }),
    );
    const development = "--conditions=development";
    const [runtime, bundle, withBrowser] = await Promise.all([
      run(String(dir), "run", "--conditions=macro", "oracle.ts"),
      run(String(dir), "run", "--conditions=macro", development, "oracle.ts"),
      run(String(dir), "run", "--conditions=macro", development, "--conditions=browser", "oracle.ts"),
    ]);
    expect({ runtime, bundle, withBrowser }).toEqual({
      runtime: { result: expected("runtime").macro, stderr: "", exitCode: 0 },
      bundle: { result: expected("bun").macro, stderr: "", exitCode: 0 },
      withBrowser: { result: expected("browser", ["browser"]).macro, stderr: "", exitCode: 0 },
    });
  });

  const run = (cwd: string, ...args: string[]) => runWith(bunEnv, cwd, ...args);
  async function runWith(env: typeof bunEnv, cwd: string, ...args: string[]) {
    await using proc = Bun.spawn({ cmd: [bunExe(), ...args], env, cwd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // Debug builds also print "[macro] call <name>" to stdout. The result is the last line.
    const line = stdout.trim().split("\n").pop()!;
    let result: unknown = line;
    try {
      result = JSON.parse(line);
    } catch {}
    return { result, stderr, exitCode };
  }

  test.concurrent.each([
    ["bun build", [], "browser", []],
    ["bun build --target=bun --conditions=custom", ["--target=bun", "--conditions=custom"], "bun", ["custom"]],
    ["bun build --conditions=browser", ["--conditions=browser"], "browser", ["browser"]],
  ] as const)("%s", async (_, flags, target, conditions) => {
    using dir = tempDir("macro-env-build", fixture());
    const build = await run(String(dir), "build", "./entry.ts", "--outdir=out", ...flags);
    expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const bundle = await run(
      String(dir),
      "-e",
      `import { cells } from "./out/entry.js";\nconsole.log(JSON.stringify(cells));`,
    );
    expect(bundle.result).toEqual(expected(target, conditions));
  });

  // In its own process: the macro VM of a worker thread outlives the build that created it. Not concurrent: in a
  // debug build these four builds take most of the default timeout when the other tests run beside them.
  test("Bun.build(): each build's own target and conditions", async () => {
    using dir = tempDir(
      "macro-env-build-api",
      fixture({
        "late-entry.ts": `import { who } from "./late.macro.ts" with { type: "macro" };\nexport const cells = who();\n`,
        "build.ts": `
          const builds = {
            bun: { target: "bun", conditions: ["custom"] },
            browser: { target: "browser" },
            node: { target: "node", conditions: ["custom"] },
          };
          const results = {};
          for (const [name, options] of Object.entries(builds)) {
            await Bun.build({ entrypoints: ["./entry.ts"], outdir: "out-" + name, ...options });
            results[name] = (await import("./out-" + name + "/entry.js")).cells;
          }
          // A macro file that did not exist when the earlier builds listed the directory.
          await Bun.write("./late.macro.ts", ${JSON.stringify(who("late.macro.ts"))});
          await Bun.build({ entrypoints: ["./late-entry.ts"], outdir: "out-late" });
          results.late = (await import("./out-late/late-entry.js")).cells;
          console.log(JSON.stringify(results));
        `,
      }),
    );
    const { result, stderr, exitCode } = await run(String(dir), "run", "build.ts");
    expect({ result, stderr }).toEqual({
      result: {
        bun: expected("bun", ["custom"]),
        browser: expected("browser"),
        node: expected("node", ["custom"]),
        late: "late.macro.ts",
      },
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  // The entry point and a require()d module are transpiled on the main thread, an imported module on another thread.
  test.concurrent("bun run: the entry point, imported modules and a require()d module", async () => {
    using dir = tempDir(
      "macro-env-run",
      fixture({
        "imported.ts": cellsSource + `export { cells as next } from "./imported-next.ts";\n`,
        "imported-next.ts": cellsSource,
        "required.ts": cellsSource,
        // `require.extensions` gets ".macrots" after the macros of the entry point were resolved.
        "in-extension.macrots": who("in-extension.macrots"),
        "uses-extension.ts": `import { who } from "./in-extension" with { type: "macro" };\nexport const extension = who();\n`,
        "run.ts": [
          cellsSource,
          `import { cells as imported, next } from "./imported.ts";`,
          `const { cells: required } = require("./required.ts");`,
          `require.extensions[".macrots"] = require.extensions[".ts"];`,
          `const { extension } = require("./uses-extension.ts");`,
          `console.log(JSON.stringify({ entry: cells, imported, next, required, extension }));`,
          ``,
        ].join("\n"),
      }),
    );
    const flags = ["--conditions=custom", "--loader=.macrots:ts"];
    const { result, stderr, exitCode } = await run(String(dir), "run", ...flags, "run.ts");
    const cells = expected("runtime", ["custom"]);
    expect({ result, stderr }).toEqual({
      result: { entry: cells, imported: cells, next: cells, required: cells, extension: "in-extension.macrots" },
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("bun run: a Worker", async () => {
    using dir = tempDir(
      "macro-env-worker",
      fixture({
        "worker.ts": cellsSource + `postMessage(cells);\n`,
        "run.ts": [
          `const worker = new Worker(new URL("./worker.ts", import.meta.url).href);`,
          `const inWorker = await new Promise(resolve => (worker.onmessage = event => resolve(event.data)));`,
          `worker.terminate();`,
          `console.log(JSON.stringify(inWorker));`,
          ``,
        ].join("\n"),
      }),
    );
    // A worker that called a macro does not free its tables of macros when it ends, whatever the macro import resolved
    // to (https://github.com/oven-sh/bun/pull/46228). So leak checking is off for this child.
    const env = { ...bunEnv, ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":") };
    const { result, stderr, exitCode } = await runWith(env, String(dir), "run", "--conditions=custom", "run.ts");
    expect({ result, stderr }).toEqual({ result: expected("runtime", ["custom"]), stderr: "" });
    expect(exitCode).toBe(0);
  });

  test.concurrent("bun test", async () => {
    using dir = tempDir(
      "macro-env-test",
      fixture({
        "cells.test.ts": [
          cellsSource,
          `import { test } from "bun:test";`,
          `test("cells", () => console.log(JSON.stringify(cells)));`,
          ``,
        ].join("\n"),
      }),
    );
    const { result, exitCode } = await run(String(dir), "test", "./cells.test.ts");
    expect(result).toEqual(expected("runtime"));
    expect(exitCode).toBe(0);
  });

  // `Bun.Transpiler` does not bundle, so only the macro imports are resolved.
  test.concurrent("Bun.Transpiler: transformSync() and transform() with a browser target", async () => {
    const macrosOnly = [
      ...macroSpecifiers.map((s, i) => `import { who as macro${i} } from ${JSON.stringify(s)} with { type: "macro" };`),
      `export const cells = { ${macroSpecifiers.map((s, i) => `${JSON.stringify(s)}: macro${i}()`).join(", ")} };`,
      ``,
    ].join("\n");
    using dir = tempDir(
      "macro-env-transpiler",
      fixture({
        "macros-only.ts": macrosOnly,
        "transform.ts": `
          const code = await Bun.file("./macros-only.ts").text();
          const transpiler = new Bun.Transpiler({ loader: "ts", target: "browser" });
          await Bun.write("./sync.js", transpiler.transformSync(code));
          // Each call is a new macro context, with a macro resolver of its own.
          await Bun.write("./again.js", transpiler.transformSync(code));
          await Bun.write("./async.js", await transpiler.transform(code));
          const results = {
            transformSync: (await import("./sync.js")).cells,
            transformSyncAgain: (await import("./again.js")).cells,
            transform: (await import("./async.js")).cells,
          };
          console.log(JSON.stringify(results));
        `,
      }),
    );
    const { result, stderr, exitCode } = await run(String(dir), "run", "transform.ts");
    expect({ result, stderr }).toEqual({
      result: { transformSync: macroCells, transformSyncAgain: macroCells, transform: macroCells },
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  // Not concurrent: in a debug build these three processes take most of the default timeout when the other tests run
  // beside them.
  test("every spelling of a macro import, builtin modules, and packages with one file for a macro", async () => {
    using dir = tempDir(
      "macro-env-spellings",
      fixture({
        "bunfig.toml": `[macros]\nremapped = { who = "macro-first" }\n`,
        "spellings.ts": `
          import { who as withAttribute } from "macro-first" with { type: "macro" };
          import { who as assertAttribute } from "macro-first" assert { type: "macro" };
          import { who as prefix } from "macro:macro-first";
          import defaultImport from "macro-first" with { type: "macro" };
          import * as namespace from "macro-first" with { type: "macro" };
          import { who as remap } from "remapped";
          // A builtin module is the same module under every spelling, and through the "imports" of package.json.
          import { basename as builtin } from "node:path" with { type: "macro" };
          import { basename as builtinPrefix } from "macro:node:path";
          import { basename as builtinImports } from "#path" with { type: "macro" };
          // This package has no file for a plain import.
          import { who as macroOnly } from "macro-only" with { type: "macro" };
          // The file for Bun is named like the "bun" builtin module.
          import { who as bunFile } from "bun-file" with { type: "macro" };
          // An import that no live call uses is never resolved.
          import { who as unused } from "missing-package" with { type: "macro" };
          import { who as dead } from "missing-package" with { type: "macro" };
          if (false) dead();
          const spellings = {
            withAttribute: withAttribute(),
            assertAttribute: assertAttribute(),
            prefix: prefix(),
            defaultImport: defaultImport(),
            namespace: namespace.who(),
            remap: remap(),
            builtin: builtin("a/builtin.txt"),
            builtinPrefix: builtinPrefix("a/prefix.txt"),
            builtinImports: builtinImports("a/imports.txt"),
            macroOnly: macroOnly(),
            bunFile: bunFile(),
          };
          console.log(JSON.stringify(spellings));
        `,
      }),
    );
    const atRuntime = await run(String(dir), "run", "spellings.ts");
    const build = await run(String(dir), "build", "./spellings.ts", "--outdir=out");
    const bundle = await run(String(dir), "out/spellings.js");
    const macro = "macro-first/macro.js";
    const spellings = {
      withAttribute: macro,
      assertAttribute: macro,
      prefix: macro,
      defaultImport: macro,
      namespace: macro,
      remap: macro,
      builtin: "builtin.txt",
      builtinPrefix: "prefix.txt",
      builtinImports: "imports.txt",
      macroOnly: "macro-only/macro.js",
      bunFile: "bun-file/bun.js",
    };
    expect({
      run: atRuntime,
      build: { stderr: build.stderr, exitCode: build.exitCode },
      bundle,
    }).toEqual({
      run: { result: spellings, stderr: "", exitCode: 0 },
      build: { stderr: "", exitCode: 0 },
      bundle: { result: spellings, stderr: "", exitCode: 0 },
    });
  });

  // A package with a file only for the browser ran as a macro in a bundle for the browser before. A macro runs in
  // Bun, so now it is not found, unless the user names the condition for the whole build. A "macro" entry that gives
  // no file is not found either: as in Node, the resolver does not go on to the next key.
  test.concurrent("a package with no file for a macro is not found", async () => {
    using dir = tempDir(
      "macro-env-not-found",
      fixture({
        "browser-only.ts": `import { who } from "browser-only" with { type: "macro" };\nconsole.log(who());\n`,
        "macro-null.ts": `import { who } from "macro-null" with { type: "macro" };\nconsole.log(who());\n`,
      }),
    );
    const [browserOnly, withCondition, nullInBundle, nullAtRuntime] = await Promise.all([
      run(String(dir), "build", "./browser-only.ts", "--target=browser"),
      run(String(dir), "build", "./browser-only.ts", "--target=browser", "--conditions=browser"),
      run(String(dir), "build", "./macro-null.ts", "--target=browser"),
      run(String(dir), "run", "macro-null.ts"),
    ]);
    const notFound = (specifier: string, { stderr, exitCode }: { stderr: string; exitCode: number }) => ({
      notFound: stderr.includes(`error: Macro "${specifier}" not found`),
      exitCode,
    });
    expect({
      browserOnly: notFound("browser-only", browserOnly),
      withCondition,
      nullInBundle: notFound("macro-null", nullInBundle),
      nullAtRuntime: notFound("macro-null", nullAtRuntime),
    }).toEqual({
      browserOnly: { notFound: true, exitCode: 1 },
      withCondition: { result: `console.log("browser-only/browser.js");`, stderr: "", exitCode: 0 },
      nullInBundle: { notFound: true, exitCode: 1 },
      nullAtRuntime: { notFound: true, exitCode: 1 },
    });
  });

  // An HTML import makes a second graph in the same build: the page, for the browser. The resolver of that graph has
  // neither the user's conditions nor "development". A macro import of the page still has the user's conditions, as
  // the macro itself has when it runs. "development" follows the graph.
  test.concurrent("bun build: the page of an HTML import", async () => {
    using dir = tempDir(
      "macro-env-html",
      fixture({
        "index.html": `<!doctype html><html><head><script type="module" src="./page.ts"></script></head></html>`,
        "page.ts": cellsSource + `console.log(JSON.stringify(cells));\n`,
        "server.ts": [
          cellsSource,
          `import page from "./index.html";`,
          `if (!page) throw new Error("no page");`,
          `console.log(JSON.stringify(cells));`,
          ``,
        ].join("\n"),
      }),
    );
    const flags = ["--target=bun", "--conditions=custom", "--outdir=out"];
    const build = await run(String(dir), "build", "./server.ts", ...flags);
    expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const chunks = readdirSync(path.join(String(dir), "out")).filter(name => name.endsWith(".js"));
    expect(chunks.toSorted()).toEqual([expect.stringMatching(/^index-.+\.js$/), "server.js"]);
    const [server, page] = await Promise.all(
      ["server.js", chunks.find(name => name !== "server.js")!].map(name => run(String(dir), path.join("out", name))),
    );
    const ofPage = page.result as ReturnType<typeof expected>;
    expect({ server: server.result, page: ofPage.macro }).toEqual({
      server: expected("bun", ["custom"]),
      page: { ...expected("runtime", ["custom"]).macro, "dev-condition": ofPage.plain["dev-condition"] },
    });
  });

  // `--main-fields` replaces the list of the target, for a macro import too. The macro resolves its own imports with
  // the same list when it runs.
  test.concurrent("--main-fields also applies to a macro import", async () => {
    using dir = tempDir(
      "macro-env-main-fields",
      fixture({
        "main-fields.ts": `
          import { who as browserField } from "browser-field" with { type: "macro" };
          import { who as moduleMain } from "module-main" with { type: "macro" };
          console.log([browserField(), moduleMain()].join(" "));
        `,
      }),
    );
    const flags = ["--main-fields=browser", "--main-fields=module", "--main-fields=main"];
    const [atRuntime, bundle] = await Promise.all([
      run(String(dir), "run", ...flags, "main-fields.ts"),
      run(String(dir), "build", "./main-fields.ts", "--target=bun", ...flags),
    ]);
    expect({ atRuntime, bundle }).toEqual({
      atRuntime: { result: "browser-field/browser.js module-main/module.mjs", stderr: "", exitCode: 0 },
      bundle: {
        result: `console.log(["browser-field/browser.js", "module-main/module.mjs"].join(" "));`,
        stderr: "",
        exitCode: 0,
      },
    });
  });

  // A module that `import()` loads is transpiled on another thread, with a copy of the transpiler of the VM. The first
  // macro waits there until the main thread has replaced the list of `require.extensions`. Then the second macro
  // import resolves, through an extension that the list had when the import started.
  test.concurrent("require.extensions changes while another thread resolves a macro import", async () => {
    using dir = tempDir("macro-env-extensions-race", {
      "gate.macrots": `
        import { existsSync, writeFileSync } from "node:fs";
        export function first() {
          writeFileSync(import.meta.dir + "/started", "");
          while (!existsSync(import.meta.dir + "/replaced")) {}
          return "first";
        }
        export function second() {
          return "second";
        }
      `,
      "imported.ts": `
        import { first, second } from "./gate" with { type: "macro" };
        export const results = [first(), second()];
      `,
      "main.ts": `
        import { existsSync, writeFileSync } from "node:fs";
        require.extensions[".macrots"] = require.extensions[".ts"];
        const imported = import("./imported.ts");
        while (!existsSync(import.meta.dir + "/started")) await new Promise(resolve => setImmediate(resolve));
        require.extensions[".other"] = require.extensions[".ts"];
        writeFileSync(import.meta.dir + "/replaced", "");
        console.log(JSON.stringify((await imported).results));
      `,
    });
    const { result, stderr, exitCode } = await run(String(dir), "run", "--loader=.macrots:ts", "main.ts");
    expect({ result, stderr, exitCode }).toEqual({ result: ["first", "second"], stderr: "", exitCode: 0 });
  });

  // `--external` and `--packages=external` say what the bundle leaves out, and a macro import is inlined at build
  // time. The entries are in a folder with its own copy of the package: an import that the build marked external
  // used to reach the macro VM unresolved, and then resolved from the working directory. Not concurrent: in a debug
  // build these five processes take most of the default timeout when the other tests run beside them.
  test("--external and --packages=external do not apply to a macro import", async () => {
    const where = (label: string) => `export function where() {\n  return ${JSON.stringify(label)};\n}\n`;
    using dir = tempDir("macro-env-external", {
      "sub/package.ts": `import { where } from "macros" with { type: "macro" };\nconsole.log(where());\n`,
      "sub/relative.ts": `import { where } from "./macro.ts" with { type: "macro" };\nconsole.log(where());\n`,
      "sub/macro.ts": where("the relative file"),
      "sub/node_modules/macros/package.json": JSON.stringify({ name: "macros", main: "./index.js" }),
      "sub/node_modules/macros/index.js": where("the importer's copy"),
      "node_modules/macros/package.json": JSON.stringify({ name: "macros", main: "./index.js" }),
      "node_modules/macros/index.js": where("the working directory's copy"),
      "build-api.ts": `
        const lastLines = [];
        for (const options of [{ external: ["macros"] }, { packages: "external" }]) {
          const build = await Bun.build({ entrypoints: ["./sub/package.ts"], target: "bun", ...options });
          lastLines.push((await build.outputs[0].text()).trim().split("\\n").pop());
        }
        console.log(JSON.stringify(lastLines));
      `,
    });
    const builds = [
      ["./sub/package.ts", "--external=macros"],
      ["./sub/package.ts", "--packages=external"],
      ["./sub/package.ts", "--external=*"],
      // https://github.com/oven-sh/bun/issues/40626
      ["./sub/relative.ts", "--external=*"],
    ];
    // Without `--outdir` the bundle goes to stdout, and its last line is the `console.log()` of the entry.
    const bundles = await Promise.all([
      ...builds.map(([entry, flag]) => run(String(dir), "build", entry, "--target=bun", flag)),
      run(String(dir), "run", "build-api.ts"),
    ]);
    const importers = `console.log("the importer's copy");`;
    expect(bundles).toEqual([
      { result: importers, stderr: "", exitCode: 0 },
      { result: importers, stderr: "", exitCode: 0 },
      { result: importers, stderr: "", exitCode: 0 },
      { result: `console.log("the relative file");`, stderr: "", exitCode: 0 },
      { result: [importers, importers], stderr: "", exitCode: 0 },
    ]);
  });

  // The directory cache is shared, so the macro resolver reads symlinks the way the importing resolver does.
  test.concurrent("--preserve-symlinks also applies to a macro import", async () => {
    using dir = tempDir("macro-env-symlinks", {
      "linked-source/package.json": JSON.stringify({
        name: "linked",
        exports: { macro: "./macro.ts", default: "./index.ts" },
      }),
      "linked-source/index.ts": `export function where() {\n  return "not the file for a macro";\n}\n`,
      "linked-source/macro.ts": `
        import path from "node:path";
        export function where() {
          return path.relative(process.cwd(), import.meta.dir).replaceAll(path.sep, "/");
        }
      `,
      "node_modules/.keep": "",
      "entry.ts": `import { where } from "linked" with { type: "macro" };\nconsole.log(JSON.stringify(where()));\n`,
    });
    symlinkSync(path.join(String(dir), "linked-source"), path.join(String(dir), "node_modules", "linked"), "junction");
    const [followed, preserved] = await Promise.all([
      run(String(dir), "run", "entry.ts"),
      run(String(dir), "run", "--preserve-symlinks", "entry.ts"),
    ]);
    expect({ followed, preserved }).toEqual({
      followed: { result: "linked-source", stderr: "", exitCode: 0 },
      preserved: { result: "node_modules/linked", stderr: "", exitCode: 0 },
    });
  });
});
