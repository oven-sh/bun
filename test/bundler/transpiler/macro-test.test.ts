import { escapeHTML } from "bun" with { type: "macro" };
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
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

// Bun replaces the macro call with its result, and the rest of the program runs as written. So each module below
// must export what it exports when `m.ts` is imported without the macro attribute.
describe("a macro result that is bound to a name", () => {
  const names = "num, hello, yes, nul, undef, undefs, obj, arr, holes, keys, twice";
  const macros = `
    export const num = () => 21;
    export const hello = () => "Hello";
    export const yes = () => true;
    export const nul = () => null;
    export const undef = () => undefined;
    export const undefs = () => [undefined, null];
    export const obj = () => ({ a: 1, b: { c: 2 }, list: [1, 2] });
    export const arr = () => [1, "two", [3]];
    export const holes = () => ({ a: undefined, b: 4, c: null });
    export const keys = () => ({ xx: 1, x: 5, 0: "zero" });
    export const twice = () => {
      const o = { a: 1, b: 2 };
      return { p: o, q: o };
    };
  `;

  // Modules with the value that each must export.
  const written: [body: string, exported: unknown][] = [
    [`let s = hello(); s += " World"; export default s;`, "Hello World"],
    [`let n = num(); n = 5; export default n;`, 5],
    [`var v = num(); v++; export default v;`, 22],
    [`let { a, b } = obj(); a = 99; export default [a, b];`, [99, { c: 2 }]],
    [`const [u = 5, n = 6] = undefs(); export default [u, n];`, [5, null]],
    [`const { a = 10, b = 20, c = 30 } = holes(); export default [a, b, c];`, [10, 4, null]],
    [`const key = () => "b"; const { a, [key()]: computed } = obj(); export default [a, computed];`, [1, { c: 2 }]],
    [`const { ["x" + "x"]: joined, x } = keys(); export default [joined, x];`, [1, 5]],
    [`const { 0: zero, x } = keys(); export default [zero, x];`, ["zero", 5]],
    [`const { b: { c }, b } = obj(); export default [c, b];`, [2, { c: 2 }]],
    [`const { p: { a }, q } = twice(); export default [a, q];`, [1, { a: 1, b: 2 }]],
    [`const { list: [first], list } = obj(); export default [first, list];`, [1, [1, 2]]],
    [`const n = num(); const s = hello(); export default [n + n, s + s.length];`, [42, "Hello5"]],
    [`export default [obj().b.c, arr()[2][0], arr().length, hello().length, num() + num()];`, [2, 3, 3, 5, 42]],
  ];

  // Modules from cross products of the declaration kind, the value and the use. No exported value is stored for
  // them: the plain import is the oracle.
  const generated: string[] = [];
  // A read of a `const` that holds a macro object or array is a new copy of the object (#7196). A module that
  // can tell the copy from the object does not run for `const`.
  const copied = (kind: string, seesCopy: boolean) => kind === "const" && seesCopy;
  for (const kind of ["const", "let", "var"]) {
    const add = (body: string, seesCopy = false) => copied(kind, seesCopy) || generated.push(body);
    for (const value of ["num", "hello", "yes", "nul", "undef", "obj", "arr"]) {
      const x = `${kind} x = ${value}();`;
      add(`${x} export default [x, typeof x];`);
      add(`${x} const read = () => x; export default [read(), read()];`);
      add(`${x} export default String(x) + JSON.stringify([x]);`);
      if (kind === "const") continue;
      add(`${x} x = 5; export default x;`);
      add(`${x} x ??= "fallback"; export default x;`);
      add(`${x} x += "!"; export default x;`);
      add(`${x} [x] = ["array target"]; export default x;`);
      add(`${x} ({ x } = { x: "object target" }); export default x;`);
      add(`${x} for (x of ["loop target"]) {} export default x;`);
    }

    const o = `${kind} x = obj();`;
    add(`${o} export default [x.a, x.b.c, x.list[1], x.list.length, Object.keys(x), "a" in x];`);
    add(`${o} const { a, b: { c } } = x; export default [a, c];`);
    add(`${o} export default JSON.stringify({ ...x, extra: 1 });`);
    add(`${o} export default x === x;`, true);
    add(`${o} x.a = 9; x.b.c = 8; x.list.push(3); delete x.list; export default x;`, true);
    add(`${o} const y = x; y.added = true; export default [y === x, x.added];`, true);
    add(`${o} export default new Map([[x, "found"]]).get(x);`, true);

    const a = `${kind} x = arr();`;
    add(`${a} export default [x[0], x[1], x[2][0], x.length, x.map(v => typeof v), x.includes("two")];`);
    add(`${a} const [first, , [third]] = x; export default [first, third];`);
    add(`${a} export default [...x, ...x].length;`);
    add(`${a} x.push(4); x[0] = 0; export default [x, x.length];`, true);
    add(`${a} const y = x; y.length = 1; export default [y === x, x];`, true);
    add(`${a} export default new Set([x]).has(x);`, true);

    add(`${kind} { a, b: { c }, list: [first, second] } = obj(); export default [a, c, first, second];`);
    add(
      `${kind} { a: renamed, missing = "d", b: { c = 0, gone = "g" } } = obj(); export default [renamed, missing, c, gone];`,
    );
    add(`${kind} { list, ...rest } = obj(); export default [list, rest];`);
    add(`${kind} { list: [, second = 0, third = "t"] } = obj(); export default [second, third];`);
    add(`${kind} [p, q, [r]] = arr(); export default [p, q, r];`);
    add(`${kind} [p = 0, , [t] = [], u = "u"] = arr(); export default [p, t, u];`);
    add(`${kind} [head, ...tail] = arr(); export default [head, tail];`);
    add(`${kind} { b, list } = obj(); b.c = 9; list.push(3); export default [b, list, b === b];`, true);
    if (kind === "const") continue;
    add(`${kind} { a, b } = obj(); a = 5; b = null; export default [a, b];`);
    add(`${kind} [p, q] = arr(); p += 1; [q] = ["target"]; export default [p, q];`);
    add(`${kind} { b: { c }, list: [first] } = obj(); c = "c"; first = "f"; export default [c, first];`);
  }

  // A debug build is 10 to 100 times slower, so it runs a sample of the generated modules, always the same one.
  const every = isDebug || isASAN ? 16 : 1;
  const bodies = [...written.map(([body]) => body), ...generated.filter((_, i) => i % every === 0)];

  const files: Record<string, string> = {
    "m.ts": macros,
    // Imports each module by itself, so that a module that cannot load does not hide the other modules.
    "observe.ts": `
      const [dir, ext, count] = process.argv.slice(2);
      const seen = [];
      for (let i = 0; i < Number(count); i++) {
        try {
          seen.push((await import("./" + dir + "/" + i + "." + ext)).default);
        } catch (e) {
          seen.push("threw " + e?.name);
        }
      }
      console.log(JSON.stringify(seen, (key, value) => (value === undefined ? "undefined" : value)));
    `,
  };
  bodies.forEach((body, i) => {
    files[`plain/${i}.ts`] = `import { ${names} } from "../m.ts";\n${body}\n`;
    files[`macro/${i}.ts`] = `import { ${names} } from "../m.ts" with { type: "macro" };\n${body}\n`;
  });

  // A door builds and loads each module, which takes a debug build more than the default 5 seconds under load.
  const doorLimit = 60_000;

  // One directory serves each door. The doors read the same modules and write to their own folders.
  let fixture: ReturnType<typeof tempDir>;
  // What each module exports with a plain import.
  let plain: Awaited<ReturnType<typeof observe>>;
  beforeAll(async () => {
    fixture = tempDir("macro-bound", files);
    plain = await observe("plain", "ts");
    // Each written module has its value, and no generated module throws.
    expect(Object.values(plain.seen).slice(0, written.length)).toEqual(written.map(([, exported]) => exported));
    expect(Object.values(plain.seen).filter(value => String(value).startsWith("threw "))).toEqual([]);
  }, doorLimit);
  afterAll(() => fixture[Symbol.dispose]());

  async function observe(dir: string, ext: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "observe.ts", dir, ext, String(bodies.length)],
      env: bunEnv,
      cwd: String(fixture),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // Debug builds print "[macro] call <name>" to stdout before the script's own output.
    const seen: unknown[] = JSON.parse(stdout.trim().split("\n").pop()!);
    return { seen: Object.fromEntries(bodies.map((body, i) => [`${i}: ${body}`, seen[i]])), stderr, exitCode };
  }

  test.concurrent(
    "bun run",
    async () => {
      expect(await observe("macro", "ts")).toEqual(plain);
    },
    doorLimit,
  );

  // `--no-bundle --target=bun` and `--minify` turn the inliner on. The plain build leaves it off.
  test.concurrent.each([
    ["bun build", []],
    ["bun build --no-bundle", ["--no-bundle"]],
    ["bun build --minify", ["--minify"]],
  ])(
    "%s",
    async (door, flags) => {
      const outdir = door.replaceAll(" ", "-");
      await using build = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          ...flags,
          ...bodies.map((_, i) => `./macro/${i}.ts`),
          "--target=bun",
          "--outdir=" + outdir,
          // Without a name pattern, 9 or more entry points go to a `macro/` folder (#38732).
          "--entry-naming=[name].[ext]",
        ],
        env: bunEnv,
        cwd: String(fixture),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, buildErr, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
      expect({ buildErr, buildExit }).toEqual({ buildErr: "", buildExit: 0 });
      expect(await observe(outdir, "js")).toEqual(plain);
    },
    doorLimit,
  );

  // The inliner takes a `const` primitive from a macro at each position. It takes no `let` and no `var`: the
  // program can assign to them.
  test.concurrent("the inliner takes a const primitive and no let or var", async () => {
    const from = `import { num, hello, no, pagePath } from "./m.ts" with { type: "macro" };\n`;
    using dir = tempDir("macro-bound-inline", {
      "m.ts": `
        export const num = () => 21;
        export const hello = () => "Hello";
        export const no = () => false;
        export const pagePath = () => "./page.ts";
      `,
      "page.ts": `export default "the page";`,
      "first.ts": from + `const n = num(); const s = hello(); export default [n, n, s, s];`,
      "below.ts": from + `globalThis.effect = 1; const n = num(); const s = hello(); export default [n, n, s, s];`,
      "plain.ts": from + `globalThis.effect = 1; const k = 5; export default [k, k];`,
      "let.ts": from + `let n = num(); export default [n, n];`,
      "after-let.ts": from + `let i = num(); const k = 5; export default [i, k, k];`,
      "flag-const.ts": from + `const DEV = no(); export default DEV ? "dev" : "prod";`,
      "flag-var.ts": from + `var DEV = no(); export default DEV ? "dev" : "prod";`,
      "import-const.ts": from + `const page = pagePath(); export default import(page);`,
      "import-let.ts": from + `let page = pagePath(); export default import(page);`,
    });
    const entries = [
      "first",
      "below",
      "plain",
      "let",
      "after-let",
      "flag-const",
      "flag-var",
      "import-const",
      "import-let",
    ];
    await using build = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        ...entries.map(name => `./${name}.ts`),
        "--target=bun",
        "--minify-syntax",
        "--outdir=out",
        "--entry-naming=[name].[ext]",
      ],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, buildErr, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
    expect({ buildErr, buildExit }).toEqual({ buildErr: "", buildExit: 0 });
    const out = (name: string) => Bun.file(path.join(String(dir), "out", name + ".js")).text();

    expect(await out("first")).toContain(`[21, 21, "Hello", "Hello"]`);
    // A macro result is a literal at each position. An ordinary `const` below a statement is not inlined.
    expect(await out("below")).toContain(`[21, 21, "Hello", "Hello"]`);
    expect(await out("plain")).toContain(`[k, k]`);
    expect(await out("let")).toContain(`[n, n]`);
    // A `let` that holds a macro result does not end the run of `const` declarations that the inliner takes.
    expect(await out("after-let")).toContain(`[i, 5, 5]`);
    expect(await out("flag-const")).toContain(`= "prod"`);
    expect(await out("flag-var")).toContain(`DEV ? "dev" : "prod"`);
    // The bundler follows an `import()` of a `const` string. It cannot follow a `let`.
    expect(await out("import-const")).toContain(`"the page"`);
    expect(await out("import-let")).toContain(`import(page)`);
  });

  // A macro argument is evaluated at build time. The program can assign to a `let` before the call, so only a
  // `const` has a build-time value. A `let` that holds a macro result does not hide the `const` below it.
  test.concurrent("a macro argument can name a const primitive and cannot name a let", async () => {
    const from = `import { num, hello, id, greet } from "./m.ts" with { type: "macro" };\n`;
    using dir = tempDir("macro-bound-argument", {
      "m.ts": `
        export const num = () => 21;
        export const hello = () => "Hello";
        export const id = (x: any) => x;
        export const greet = (name: string) => "hello " + name;
      `,
      "const.ts":
        from +
        `let counter = num();\nconst name = "world";\nconst h = hello();\nconsole.log(greet(name), id(h), counter);`,
      "let.ts": from + `let h = hello();\nconsole.log(id(h));`,
    });
    async function run(file: string) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), file],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { lastLine: stdout.trim().split("\n").pop(), stderr, exitCode };
    }
    expect(await run("const.ts")).toEqual({ lastLine: "hello world Hello 21", stderr: "", exitCode: 0 });
    const rejected = await run("let.ts");
    expect(rejected.stderr).toContain(`"Cannot convert identifier to JS. Try a statically-known value" error in macro`);
    expect(rejected.exitCode).toBe(1);
  });

  // The pattern still tells which properties the program can read, for a `let` too.
  test.concurrent("a let pattern drops the properties that it does not bind", async () => {
    using dir = tempDir("macro-bound-let-pattern", {
      "m.ts": `export const big = () => ({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 });`,
      "entry.ts": `
        import { big } from "./m.ts" with { type: "macro" };
        let { a } = big();
        a += 100;
        console.log(a);
      `,
    });
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "entry.ts", "--target=bun", "--minify", "--outfile=out.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, buildErr, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
    expect({ buildErr, buildExit }).toEqual({ buildErr: "", buildExit: 0 });
    const out = await Bun.file(path.join(String(dir), "out.js")).text();
    expect(out).toContain("a:1");
    expect(out).not.toContain("b:2");
    expect(out).not.toContain("h:8");

    await using run = Bun.spawn({
      cmd: [bunExe(), "out.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({ stdout: "101", stderr: "", exitCode: 0 });
  });
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
