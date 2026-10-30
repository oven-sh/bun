import { expect, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, isWindows, normalizeBunSnapshot, tempDir, tempDirWithBunTypes } from "harness";
import { join } from "path";
import { run as runCommand } from "./harness/run";
import { describe, test } from "./supported";

// `bun run --debug-aot` and `bun test --debug-aot` compile the program as `bun compile` does and then run it. They write no executable.
// `--aot` on the two commands only checks the program and then runs it from its source: aot-flag-runs-from-source.test.ts.
const flags = ["--debug-aot"];
setDefaultTimeout(120_000);

const compilerOptions = {
  strict: true,
  target: "ESNext",
  module: "Preserve",
  moduleResolution: "bundler",
  allowImportingTsExtensions: true,
  noEmit: true,
};
const tsconfig = JSON.stringify({ compilerOptions });

// BUN_AOT_VERBOSE=1: a process that runs compiled code says so on stderr, "[aot] image: .." with a size and an address and
// "[aot] module: .." with a path. `compiled` is whether it said so. `stderr` is all else that it said, as
// normalizeBunSnapshot() leaves it: `<dir>` for `cwd`, no durations.
async function spawned(cmd: string[], cwd: string, env: Record<string, string> = {}) {
  const { stdout, stderr, exitCode } = await runCommand(cmd, cwd, { ...bunEnv, BUN_AOT_VERBOSE: "1", ...env });
  return {
    stdout,
    stderr: normalizeBunSnapshot(stderr.replace(/^\[aot\] (?:image|module): .*\r?\n/gm, ""), cwd),
    compiled: /^\[aot\] module: /m.test(stderr),
    exitCode,
  };
}
async function ran(
  files: Record<string, string>,
  args: string[],
  env: Record<string, string> = {},
  createFolder = tempDir,
) {
  using dir = createFolder("run-aot", { "tsconfig.json": tsconfig, ...files });
  return await spawned([bunExe(), ...args], String(dir), env);
}
const run = (text: string) =>
  ran({ "main.ts": `declare const console: { log(...values: unknown[]): void };\n` + text }, [
    "run",
    ...flags,
    "main.ts",
  ]);
// For a program that names what only @types/bun declares: bun:test, bun:bundle.
const ranWithBunTypes = (files: Record<string, string>, args: string[]) =>
  ran(
    { "tsconfig.json": JSON.stringify({ compilerOptions: { ...compilerOptions, types: ["bun"] } }), ...files },
    args,
    {},
    tempDirWithBunTypes,
  );
const attempt = (statement: string) => `try { ${statement} } catch (e) { console.log(String(e)); }`;

describe.concurrent("before the program starts", () => {
  test("a type error ends the process and nothing runs", async () => {
    const { stderr, ...rest } = await run(`console.log("ran"); const port: number = "8080"; console.log(port);`);
    expect(stderr).toMatchInlineSnapshot(`
      "2 | console.log("ran"); const port: number = "8080"; console.log(port);
                                    ^
      error: TS2322: Type 'string' is not assignable to type 'number'.
          at <dir>/main.ts:2:27"
    `);
    expect(rest).toEqual({ stdout: "", compiled: false, exitCode: 1 });
  });
  test("--define and --feature behave as in bun build", async () => {
    const files = {
      "main.ts": `
        import { feature } from "bun:bundle";
        declare const LIMIT: number;
        function wrong(n: number): number { return n; }
        if (feature("EXTRA")) console.log("extra", LIMIT + 1);
        else console.log(wrong("never checked, never run"));`,
    };
    expect(
      await ranWithBunTypes(files, ["run", ...flags, "--define", "LIMIT=41", "--feature=EXTRA", "main.ts"]),
    ).toEqual({ stdout: "extra 42\n", stderr: "", compiled: true, exitCode: 0 });
    const { stderr, ...without } = await ranWithBunTypes(files, ["run", ...flags, "--define", "LIMIT=41", "main.ts"]);
    expect(stderr).toMatchInlineSnapshot(`
      "6 |         else console.log(wrong("never checked, never run"));
                                         ^
      error: TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.
          at <dir>/main.ts:6:32"
    `);
    expect(without).toEqual({ stdout: "", compiled: false, exitCode: 1 });
  });
  test.each([
    [
      "--watch",
      ["--watch", ...flags, "main.ts"],
      "--aot does not support --watch: the program is compiled once, before it starts",
    ],
    [
      "--hot",
      ["--hot", ...flags, "main.ts"],
      "--aot does not support --hot: the program is compiled once, before it starts",
    ],
    [
      "--inspect",
      ["--inspect", ...flags, "main.ts"],
      "--aot does not support the debugger (--inspect, BUN_INSPECT) for a program that is compiled",
    ],
    [
      "-e",
      [...flags, "-e", `console.log("ran")`],
      "--aot can't compile code passed with -e, -p or --interactive. Pass a file instead",
    ],
    [
      "-p",
      [...flags, "-p", `"ran"`],
      "--aot can't compile code passed with -e, -p or --interactive. Pass a file instead",
    ],
  ])("%s cannot be combined with --aot", async (_, args, message) => {
    expect(await ran({ "main.ts": `console.log("ran");` }, args)).toEqual({
      stdout: "",
      stderr: `error: ${message}`,
      compiled: false,
      exitCode: 1,
    });
  });
  test("BUN_INSPECT cannot be combined with --aot, and BUN_INSPECT_CONNECT_TO, which editors set in their terminals, is ignored", async () => {
    const files = { "main.ts": `console.log("ran");` };
    expect(await ran(files, [...flags, "main.ts"], { BUN_INSPECT: "ws://127.0.0.1:0/run-aot" })).toEqual({
      stdout: "",
      stderr: "error: --aot does not support the debugger (--inspect, BUN_INSPECT) for a program that is compiled",
      compiled: false,
      exitCode: 1,
    });
    expect(
      await ran(files, [...flags, "main.ts"], { BUN_INSPECT_CONNECT_TO: "unix:///nobody-listens-here.sock" }),
    ).toEqual({ stdout: "ran\n", stderr: "", compiled: true, exitCode: 0 });
  });
});

describe.concurrent("at run time", () => {
  test("the program is compiled before it starts", async () => {
    expect(await run(`console.log("ran");`)).toEqual({ stdout: "ran\n", stderr: "", compiled: true, exitCode: 0 });
  });
  test("a value that doesn't match its declared type throws nothing", async () => {
    expect(
      await run(`console.log("ran"); function double(n: number) { return n * 2; } console.log(double("4" as any));`),
    ).toEqual({ stdout: "ran\n8\n", stderr: "", compiled: true, exitCode: 0 });
  });
  test("TypeScript files of dependencies are compiled at any depth and a type-only import is not evaluated", async () => {
    const manifest = (name: string) => JSON.stringify({ name, version: "1.0.0", main: "index.ts", types: "index.ts" });
    const said = await ran(
      {
        "main.ts": `import { one } from "one"; declare const console: { log(...values: unknown[]): void }; console.log(one(1)); ${attempt(`console.log(one(JSON.parse('"1"')));`)}`,
        "node_modules/one/package.json": manifest("one"),
        "node_modules/one/index.ts": `import { inner } from "./inner.ts"; import { two } from "two"; export function one(n: number): number { return inner(n) + two(n); }`,
        "node_modules/one/inner.ts": `export function inner(n: number): number { return n + 1; }`,
        "node_modules/two/package.json": manifest("two"),
        "node_modules/two/index.ts": `import { three } from "three"; import type { Only } from "only-types"; export function two(n: number): number { const only: Only = n; return three(only) * 2; }`,
        "node_modules/three/package.json": manifest("three"),
        "node_modules/three/index.ts": `export function three(n: number): number { return n * 3; }`,
        "node_modules/only-types/package.json": manifest("only-types"),
        "node_modules/only-types/index.ts": `export type Only = number; console.log("it is run");`,
      },
      ["run", ...flags, "main.ts"],
    );
    expect(said).toEqual({ stdout: "8\n116\n", stderr: "", compiled: true, exitCode: 0 });
  });
  test("a module that the constant parts of a dynamic path match is compiled", async () => {
    const { stderr, ...rest } = await ran(
      {
        "main.ts": `declare const console: { log(...values: unknown[]): void }; declare const process: { argv: string[] };
          const late = await import("./la" + (process.argv.length > 0 ? "te" : "") + ".ts");
          ${attempt(`console.log(late.twice(JSON.parse('"4"')));`)}`,
        "late.ts": `export function twice(n: number): number { return n * 2; }`,
      },
      ["run", ...flags, "main.ts"],
    );
    expect(stderr).toMatchInlineSnapshot(`
      "2 |           const late = await import("./la" + (process.argv.length > 0 ? "te" : "") + ".ts");
                                       ^
      warn: TS100064: this import path isn't a constant. If it resolves to code that isn't in the executable, the import throws at run time (data files still load). Add the file as an entry point, or build with --aot-allow-code-from-disk
         at <dir>/main.ts:2:30"
    `);
    expect(rest).toEqual({ stdout: "8\n", compiled: true, exitCode: 0 });
  });
  const importsDynamicPath = {
    "main.ts": `declare const console: { log(...values: unknown[]): void }; declare const process: { cwd(): string; env: Record<string, string> };
      try { const late = await import(process.cwd() + process.env.LATE); console.log(late.twice(JSON.parse('"4"'))); } catch (e: any) { console.log(e.code + ": " + e.message); }`,
    "late.ts": `export function twice(n: number): number { return n * 2; }`,
  };
  test("the import of a module that only a dynamic path leads to throws, and the build warns", async () => {
    const { stderr, ...rest } = await ran(importsDynamicPath, ["run", ...flags, "main.ts"], { LATE: "/late.ts" });
    expect(stderr).toMatchInlineSnapshot(`
      "2 |       try { const late = await import(process.cwd() + process.env.LATE); console.log(late.twice(JSON.parse('"4"'))); } catch (e: any) { console.log(e.code + ": " + e.message); }
                                         ^
      warn: TS100064: this import path isn't a constant. If it resolves to code that isn't in the executable, the import throws at run time (data files still load). Add the file as an entry point, or build with --aot-allow-code-from-disk
         at <dir>/main.ts:2:32"
    `);
    expect(rest).toEqual({
      stdout: expect.stringMatching(
        /^ERR_MODULE_NOT_FOUND: Cannot load '[^']*late\.ts': it isn't in this executable, which only runs code that was compiled into it\. Pass the file to bun compile as another entry point, or build with --aot-allow-code-from-disk\.\n$/,
      ),
      compiled: true,
      exitCode: 0,
    });
  });
  test("an executable built with --compile-inspector loads such a module from disk", async () => {
    using dir = tempDir("run-aot", { "tsconfig.json": tsconfig, ...importsDynamicPath });
    const build = await spawned(
      [
        bunExe(),
        "build",
        "--compile",
        "--aot",
        "--compile-inspector",
        // On Windows a function of the library makes process.env, which the program reads.
        ...(isWindows ? [] : ["--no-builtin-modules"]),
        "main.ts",
        "--outfile",
        "main",
      ],
      String(dir),
    );
    expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({
      stderr: expect.not.stringMatching(/^error\b|TS100064/m),
      exitCode: 0,
    });
    expect(
      await spawned([join(String(dir), isWindows ? "main.exe" : "main")], String(dir), { LATE: "/late.ts" }),
    ).toEqual({ stdout: "8\n", stderr: "", compiled: true, exitCode: 0 });
  });
  test("a value of any kind passes where a string is declared", async () => {
    const { stdout, ...rest } = await run(
      `class Point { x = 1 }
      function args(..._: unknown[]): unknown { return (function (..._: unknown[]) { return arguments; })(1); }
      const given: (() => any)[] = [() => ({ a: 1 }), () => -0, () => Object.create({ a: 1 }), () => args(), () => new TypeError("t"), () => (function () {}).bind(null), () => (function* () {})(), () => class {}, () => Point, () => new Point(), () => new Map(), () => [1], () => JSON.parse("{}"), () => ({ title() {} }).title, () => Math.max];
      function take(v: any): unknown { const x: string = v; return x; }
      for (const make of given) { try { console.log(typeof take(make())); } catch (e) { console.log(String(e)); } }`,
    );
    expect(stdout.split("\n")).toEqual([
      "object",
      "number",
      "object",
      "object",
      "object",
      "function",
      "object",
      "function",
      "function",
      "object",
      "object",
      "object",
      "object",
      "function",
      "function",
      "",
    ]);
    expect(rest).toEqual({ stderr: "", compiled: true, exitCode: 0 });
  });
  test("a function passes where a Map, a Date or a typed array is declared", async () => {
    const said = await run(
      `const given: any[] = [() => 1, class {}, function () {}];
      function asMap(v: any): unknown { const x: Map<string, number> = v; return x; }
      function asDate(v: any): unknown { const x: Date = v; return x; }
      function asBytes(v: any): unknown { const x: Uint8Array = v; return x; }
      function asFunction(v: any): unknown { const x: Function = v; return x; }
      for (const take of [asMap, asDate, asBytes, asFunction]) for (const v of given) { try { console.log(take.name, typeof take(v)); } catch (e) { console.log(take.name, String(e).split(", got")[0]); } }`,
    );
    expect(said).toEqual({
      stdout: ["asMap function", "asDate function", "asBytes function", "asFunction function"]
        .map(line => (line + "\n").repeat(3))
        .join(""),
      stderr: "",
      compiled: true,
      exitCode: 0,
    });
  });
  test("a wrong argument to an async function neither throws to the caller nor rejects the promise", async () => {
    const said = await run(
      `async function size(list: number[]): Promise<number> { return list.length; }
      const arrow = async (list: number[]): Promise<number> => list.length;
      const untyped: any[] = [size, arrow];
      for (const f of untyped) { let promise: Promise<unknown>; try { promise = f(5); } catch { console.log("thrown to the caller"); continue; } await promise.then(() => console.log("fulfilled"), e => console.log("rejected", String(e).split(" (bun")[0])); }`,
    );
    expect(said).toEqual({ stdout: "fulfilled\n".repeat(2), stderr: "", compiled: true, exitCode: 0 });
  });
  test("for...of over a sparse array of length 4294967295 ends at break and runs an element getter", async () => {
    const said = await run(
      `const sparse: number[] = [1, 2, 3]; sparse[4294967294] = 4; let seen = 0; for (const value of sparse) { if (seen++ > 4) break; } console.log(seen, sparse.length);
      const withGetter: number[] = [1, 2, 3]; withGetter[4294967294] = 4; Object.defineProperty(withGetter, 1, { get() { return 5; } }); for (const value of withGetter) { console.log(value); if (value === 3) break; }`,
    );
    expect(said).toEqual({ stdout: "6 4294967295\n1\n5\n3\n", stderr: "", compiled: true, exitCode: 0 });
  });
  test("an argument, a variable and a result that don't match their declared types behave as in plain Bun", async () => {
    const { stdout, ...rest } = await run(`
      function double(n: number) { return n * 2; }
      const body: any = JSON.parse('{"visits":"3","name":5}');
      ${attempt(`console.log(double(body.visits));`)}
      ${attempt(`const name: string = body.name; console.log(typeof name);`)}
      function read(text: string): number { return JSON.parse(text); }
      ${attempt(`console.log(typeof read('"x"'));`)}
      console.log(double(JSON.parse("4")));`);
    expect(stdout.split("\n")).toEqual(["6", "number", "string", "8", ""]);
    expect(rest).toEqual({ stderr: "", compiled: true, exitCode: 0 });
  });
  test("--aot-log-type-mismatches logs the argument that doesn't match, and the program continues", async () => {
    const files = {
      "main.ts": `declare const console: { log(...values: unknown[]): void };\nfunction double(n: number) { return n * 2; }\nconst body: any = JSON.parse('{"visits":"3"}');\nconsole.log(double(body.visits));`,
    };
    expect(await ran(files, ["run", "--aot-log-type-mismatches", "main.ts"])).toEqual({
      stdout: "6\n",
      // No `m` flag: this line is all of it.
      stderr: expect.stringMatching(
        /^\[aot\] type-mismatch [0-9a-f]{12} argument \S*main\.ts:2:17 \(double\): expected number, got string; continued; count 1\b.*$/,
      ),
      compiled: true,
      exitCode: 0,
    });
    expect(await ran(files, ["run", ...flags, "main.ts"])).toEqual({
      stdout: "6\n",
      stderr: "",
      compiled: true,
      exitCode: 0,
    });
  });
  test("`as` neither tests nor converts a primitive", async () => {
    const { stdout, ...rest } = await run(`
      const query: any = JSON.parse('{"page":"2","size":3}');
      ${attempt(`console.log((query.page as number) + 1);`)}
      console.log((query.size as number) + 1);
      const five: unknown = JSON.parse("5");
      ${attempt(`console.log((five as string) + 1);`)}
      console.log(typeof five);`);
    expect(stdout.split("\n")).toEqual(["21", "4", "6", "number", ""]);
    expect(rest).toEqual({ stderr: "", compiled: true, exitCode: 0 });
  });
  test("`x!` and `let x!: T` check nothing", async () => {
    const said = await run(`
      const names = new Map<string, string>();
      ${attempt(`const name: string = names.get("bob")!; console.log(name);`)}
      let size!: number;
      function read() { return size + 1; }
      ${attempt(`console.log(read());`)}`);
    expect(said).toEqual({ stdout: "undefined\nNaN\n", stderr: "", compiled: true, exitCode: 0 });
  });
  test("an array-like object and a Proxy pass where an array is declared", async () => {
    const said = await run(`
      function first(list: number[]) { return list[0]; }
      const like: any = { 0: 7, length: 1 }, proxy: any = new Proxy([7], {});
      ${attempt(`console.log(first(like));`)}
      ${attempt(`console.log(first(proxy));`)}
      console.log(first([7]));`);
    expect(said).toEqual({ stdout: "7\n7\n7\n", stderr: "", compiled: true, exitCode: 0 });
  });
  // The place that each warning of an assignment to a locked member names. Whatever else a build said stays in the list.
  const placesWarnedOf = (stderr: string) =>
    stderr
      .replace(
        /^.*\n *\^\nwarn: TS100014: this assignment throws if it runs: built-in objects are read-only in a compiled executable\n +at <dir>\//gm,
        "",
      )
      .split("\n\n");
  test("a locked member of a built-in keeps its value, and what is not locked can be written", async () => {
    const { stdout, stderr, ...rest } = await ran(
      {
        "main.mjs": `
          const tried = f => { try { f(); return "done"; } catch (e) { return e.name; } };
          const push = Array.prototype.push;
          console.log(tried(() => { Array.prototype.push = () => 0; }), Array.prototype.push === push);
          console.log(tried(() => { Object.prototype.extra = 1; }), ({}).extra);
          console.log(tried(() => { delete Array.prototype.push; }), Array.prototype.push === push);
          console.log(tried(() => { Object.defineProperty(Array.prototype, "push", { value: 1 }); }), Array.prototype.push === push);
          console.log(tried(() => { String.prototype.shout = function () { return this.toUpperCase() + "!"; }; }), "a".shout());
          console.log(tried(() => { Math.floor = () => 0; }), Math.floor(1.5));
          console.log(tried(() => { globalThis.Math = {}; }), typeof Math.floor);
          console.log(tried(() => { Math.random = () => 0.5; }), Math.random());
          console.log(tried(() => { Math.half = x => x / 2; }), Math.half(4));
          console.log(tried(() => { Object.keys = () => []; }), Object.keys({ a: 1 }).length);
          console.log(tried(() => { globalThis.Array = class {}; }), Array.isArray([]));
          console.log(tried(() => { Object.assign = Object.assign || (() => 0); }), typeof Object.assign);
          console.log(tried(() => { JSON.parse = () => 7; }), JSON.parse("1"));
          const log = console.log; console.log = (...values) => log("mine:", ...values); console.log("x");`,
      },
      ["run", ...flags, "main.mjs"],
    );
    expect(stdout.split("\n")).toEqual([
      "TypeError true",
      "TypeError undefined",
      "TypeError true",
      "TypeError true",
      "done A!",
      "TypeError 1",
      "TypeError function",
      "done 0.5",
      "done 2",
      "TypeError 1",
      "TypeError true",
      "done function",
      "done 7",
      "mine: x",
      "",
    ]);
    expect(placesWarnedOf(stderr)).toEqual(
      ["4:43", "5:44", "6:60", "7:44", "9:37", "10:37", "13:37", "14:37"].map(place => `main.mjs:${place}`),
    );
    expect(rest).toEqual({ compiled: true, exitCode: 0 });
  });
  test("in sloppy code too a refused change of a built-in throws", async () => {
    const { stdout, stderr, ...rest } = await ran(
      {
        "main.cjs": `
          const tried = f => { try { f(); return "done"; } catch (e) { return e.name; } };
          const push = Array.prototype.push;
          console.log(tried(() => { Array.prototype.push = () => 0; }), Array.prototype.push === push);
          console.log(tried(() => { Object.prototype.extra = 1; }), ({}).extra);
          console.log(tried(() => { Math.floor = () => 0; }), Math.floor(1.5));
          console.log(tried(() => { Math.random = () => 0.5; }), Math.random());
          console.log(tried(() => { Object.keys = () => []; }), Object.keys({ a: 1 }).length);
          console.log(tried(() => { return delete Array.prototype.push; }), Array.prototype.push === push);
          console.log(tried(() => { Object.defineProperty(Array.prototype, "push", { value: 1 }); }), Array.prototype.push === push);
          console.log(tried(() => { Object.defineProperty(Object.freeze({ a: 1 }), "a", { value: 2 }); }));`,
      },
      ["run", ...flags, "main.cjs"],
    );
    expect(stdout.split("\n")).toEqual([
      "TypeError true",
      "TypeError undefined",
      "TypeError 1",
      "done 0.5",
      "TypeError 1",
      "TypeError true",
      "TypeError true",
      "TypeError",
      "",
    ]);
    expect(placesWarnedOf(stderr)).toEqual(
      ["4:43", "5:44", "6:37", "8:37", "9:67", "10:44"].map(place => `main.cjs:${place}`),
    );
    expect(rest).toEqual({ compiled: true, exitCode: 0 });
  });
  test("a function called through another function type takes whatever it is passed", async () => {
    const said = await ran(
      {
        "main.ts": `
          function count(list: string[]): number { let n = 0; for (const s of list) n += s.length; return n; }
          const kept = [count] as unknown as ((s: string) => number)[];
          ${attempt(`console.log(kept[0]("abc"));`)}
          console.log(count(["ab", "c"]));`,
      },
      ["run", ...flags, "main.ts"],
    );
    expect(said).toEqual({ stdout: "3\n3\n", stderr: "", compiled: true, exitCode: 0 });
  });
  test("a property of undefined or null: the words of the executable", async () => {
    const { stdout, ...rest } = await ran(
      {
        "main.js": `
          const tried = f => { try { return f(); } catch (e) { return String(e); } };
          const o = { a: null };
          console.log(tried(() => o.a.c));
          console.log(tried(() => o.b.length));
          console.log(tried(() => o.b.method()));
          console.log(tried(() => { o.a.c = 1; }));
          console.log(tried(() => { o.b.c = 1; }));`,
      },
      ["run", ...flags, "main.js"],
    );
    expect(stdout.split("\n")).toEqual([
      "TypeError: null is not an object (evaluating 'null.c')",
      "TypeError: undefined is not an object (evaluating 'undefined.length')",
      "TypeError: undefined is not an object (evaluating 'undefined.method')",
      "TypeError: null is not an object (evaluating 'null.c')",
      "TypeError: undefined is not an object (evaluating 'undefined.c')",
      "",
    ]);
    expect(rest).toEqual({ stderr: "", compiled: true, exitCode: 0 });
  });
  test("a context made at run time has built-ins of its own, which are not locked", async () => {
    const said = await ran(
      {
        "main.js": `const vm = require("node:vm"); console.log(vm.runInNewContext("Array.prototype.extra = 1; [].extra"), [].extra);`,
      },
      ["run", ...flags, "main.js"],
    );
    expect(said).toEqual({ stdout: "1 undefined\n", stderr: "", compiled: true, exitCode: 0 });
  });
  test("what comes by the other arm of ||, ?. and a comma is as in plain Bun", async () => {
    const said = await ran(
      {
        "main.ts": `
          const flags: Record<string, boolean> = { a: true };
          function either(k: string) { const found: boolean = flags[k] || flags[k + k]; return [found]; }
          class Account { constructor(public cents: number) {} get isEmpty(): boolean { return this.cents === 0; } }
          function isEmpty(a: Account | undefined): boolean | undefined { return a?.isEmpty; }
          const counter = { n: 0, bump() { return ++this.n; } };
          function tried(f: () => unknown): string { try { return String(f()); } catch (e) { return (e as Error).constructor.name; } }
          console.log(either("z"), either("a"), isEmpty(undefined), isEmpty(new Account(0)), (counter.bump)(), tried(() => (0, counter.bump)()));`,
      },
      ["run", ...flags, "main.ts"],
    );
    expect(said).toEqual({
      stdout: "[ undefined ] [ true ] undefined true 1 TypeError\n",
      stderr: "",
      compiled: true,
      exitCode: 0,
    });
  });
  test("a deep chain of tail calls with typed results runs in constant space, and a result of another type comes back", async () => {
    const said = await ran(
      {
        "main.ts": `
          const steps: Array<(n: number, sum: number) => number> = [];
          steps.push(function even(n: number, sum: number): number { return n === 0 ? sum : steps[1](n - 1, sum + 1); });
          steps.push(function odd(n: number, sum: number): number { return n === 0 ? sum : steps[0](...([n - 1, sum + 2] as [number, number])); });
          console.log(steps[0](400000, 0));
          const last: any = () => "text";
          function ends(n: number): number { return n === 0 ? last() : again[0](n - 1); }
          const again: Array<(n: number) => number> = [ends];
          try { console.log(ends(100000)); } catch (e) { console.log(String(e).split(" (bun")[0]); }`,
      },
      ["run", ...flags, "main.ts"],
    );
    expect(said).toEqual({ stdout: "600000\ntext\n", stderr: "", compiled: true, exitCode: 0 });
  });
  test("a deep tail recursion finishes, as it does in the executable", async () => {
    const said = await run(
      `function sum(n: number, total = 0): number { if (n === 0) return total; return sum(n - 1, total + n); } console.log(sum(1_000_000));`,
    );
    expect(said).toEqual({ stdout: "500000500000\n", stderr: "", compiled: true, exitCode: 0 });
  });
});

describe.concurrent("bun test", () => {
  const price = {
    "price.ts": `export function price(id: string): number { return id.length; }\nexport const rate = { of(id: string): number { return id.length * 2; } };`,
  };
  // On stdout `bun test` prints its version, and these test files print nothing.
  const version = expect.stringMatching(/^bun test v.*\n$/);
  test("mock.module throws for a module that was compiled", async () => {
    const { stderr, ...rest } = await ranWithBunTypes(
      {
        ...price,
        "one.test.ts": `import { expect, mock, test } from "bun:test";\nimport { price } from "./price.ts";\ntest("not replaced", () => { expect(() => mock.module("./price.ts", () => ({ price: () => 42 }))).toThrow("cannot replace a module that was compiled ahead of time"); expect(price("abc")).toBe(3); });`,
      },
      ["test", ...flags, "one.test.ts"],
    );
    expect(stderr).toMatchInlineSnapshot(`
      "one.test.ts:
      (pass) not replaced

       1 pass
       0 fail
       2 expect() calls
      Ran 1 test across 1 file."
    `);
    expect(rest).toEqual({ stdout: version, compiled: true, exitCode: 0 });
  });
  test("spyOn replaces a method of an object of the program and gives it back", async () => {
    const { stderr, ...rest } = await ranWithBunTypes(
      {
        ...price,
        "two.test.ts": `import { expect, spyOn, test } from "bun:test";\nimport { rate } from "./price.ts";\ntest("spied", () => { const spy = spyOn(rate, "of").mockReturnValue(7); expect(rate.of("abc")).toBe(7); expect(spy).toHaveBeenCalledWith("abc"); spy.mockRestore(); expect(rate.of("abc")).toBe(6); });`,
      },
      ["test", ...flags, "two.test.ts"],
    );
    expect(stderr).toMatchInlineSnapshot(`
      "two.test.ts:
      (pass) spied

       1 pass
       0 fail
       3 expect() calls
      Ran 1 test across 1 file."
    `);
    expect(rest).toEqual({ stdout: version, compiled: true, exitCode: 0 });
  });
  test("a mock function passes as a typed callback, and a result of another type comes back", async () => {
    const { stderr, ...rest } = await ranWithBunTypes(
      {
        "three.test.ts": `import { expect, jest, mock, test } from "bun:test";\nfunction twice(f: (n: number) => number): number { return f(1) + f(2); }\ntest("called", () => { const f = mock((n: number) => n * 10); expect(twice(f)).toBe(30); expect(f).toHaveBeenCalledTimes(2); const g = jest.fn((n: number) => n); expect(twice(g)).toBe(3); });\ntest("joined", () => { const wrong: any = mock(() => "text"); expect(String(twice(wrong))).toBe("texttext"); });`,
      },
      ["test", ...flags, "three.test.ts"],
    );
    expect(stderr).toMatchInlineSnapshot(`
      "three.test.ts:
      (pass) called
      (pass) joined

       2 pass
       0 fail
       4 expect() calls
      Ran 2 tests across 1 file."
    `);
    expect(rest).toEqual({ stdout: version, compiled: true, exitCode: 0 });
  });
  test("spyOn throws for a method of a built-in prototype", async () => {
    const { stderr, ...rest } = await ranWithBunTypes(
      {
        "main.test.ts": `import { expect, spyOn, test } from "bun:test";\ntest("not replaced", () => { expect(() => spyOn(String.prototype, "normalize")).toThrow("Cannot spy on 'normalize' because this property of a built-in object is read-only in a compiled executable"); expect("e".normalize()).toBe("e"); });`,
      },
      ["test", ...flags, "./main.test.ts"],
    );
    expect(stderr).toMatchInlineSnapshot(`
      "2 | test("not replaced", () => { expect(() => spyOn(String.prototype, "normalize")).toThrow("Cannot spy on 'normalize' because this property of a built-in object is read-only in a compiled executable"); expect("e".normalize()).toBe("e"); });
                                                    ^
      warn: TS100014: this assignment throws if it runs: built-in objects are read-only in a compiled executable
         at <dir>/main.test.ts:2:43

      main.test.ts:
      (pass) not replaced

       1 pass
       0 fail
       2 expect() calls
      Ran 1 test across 1 file."
    `);
    expect(rest).toEqual({ stdout: version, compiled: true, exitCode: 0 });
  });
  test("a type error in a test file ends the run", async () => {
    const { stderr, ...rest } = await ranWithBunTypes(
      { "four.test.ts": `import { test } from "bun:test";\nconst n: number = "x";\ntest("never", () => {});` },
      ["test", ...flags, "four.test.ts"],
    );
    expect(stderr).toMatchInlineSnapshot(`
      "2 | const n: number = "x";
                ^
      error: TS2322: Type 'string' is not assignable to type 'number'.
          at <dir>/four.test.ts:2:7"
    `);
    expect(rest).toEqual({ stdout: version, compiled: false, exitCode: 1 });
  });
});
