import { expect, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir, tempDirWithBunTypes } from "harness";
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

async function spawned(cmd: string[], cwd: string, env: Record<string, string> = {}) {
  const { stdout, stderr, exitCode } = await runCommand(cmd, cwd, { ...bunEnv, BUN_AOT_VERBOSE: "1", ...env });
  return { stdout, stderr, exitCode };
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

describe("before the program starts", () => {
  test("a type error ends the process and nothing runs", async () => {
    const { stdout, stderr, exitCode } = await run(
      `console.log("ran"); const port: number = "8080"; console.log(port);`,
    );
    expect(stderr).toContain("TS2322");
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
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
    const { stdout, stderr, exitCode } = await ranWithBunTypes(files, [
      "run",
      ...flags,
      "--define",
      "LIMIT=41",
      "--feature=EXTRA",
      "main.ts",
    ]);
    expect({ stdout, stderr: stderr.includes("TS2345"), exitCode }).toEqual({
      stdout: "extra 42\n",
      stderr: false,
      exitCode: 0,
    });
    const without = await ranWithBunTypes(files, ["run", ...flags, "--define", "LIMIT=41", "main.ts"]);
    expect({ stderr: without.stderr.includes("TS2345"), exitCode: without.exitCode }).toEqual({
      stderr: true,
      exitCode: 1,
    });
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
    const { stdout, stderr, exitCode } = await ran({ "main.ts": `console.log("ran");` }, args);
    expect(stderr).toContain(message);
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
  });
  test("BUN_INSPECT cannot be combined with --aot, and BUN_INSPECT_CONNECT_TO, which editors set in their terminals, is ignored", async () => {
    const files = { "main.ts": `console.log("ran");` };
    const rejected = await ran(files, [...flags, "main.ts"], { BUN_INSPECT: "ws://127.0.0.1:0/run-aot" });
    expect(rejected.stderr).toContain("--aot does not support the debugger (--inspect, BUN_INSPECT)");
    expect({ stdout: rejected.stdout, exitCode: rejected.exitCode }).toEqual({ stdout: "", exitCode: 1 });
    const ignored = await ran(files, [...flags, "main.ts"], {
      BUN_INSPECT_CONNECT_TO: "unix:///nobody-listens-here.sock",
    });
    expect({ stdout: ignored.stdout, exitCode: ignored.exitCode }).toEqual({ stdout: "ran\n", exitCode: 0 });
  });
});

describe("at run time", () => {
  test("the program is compiled before it starts", async () => {
    const { stdout, stderr, exitCode } = await run(`console.log("ran");`);
    expect(stderr).toContain("[aot] module: ");
    expect({ stdout, exitCode }).toEqual({ stdout: "ran\n", exitCode: 0 });
  });
  test("a value that doesn't match its declared type throws nothing", async () => {
    const { stdout, stderr, exitCode } = await run(
      `console.log("ran"); function double(n: number) { return n * 2; } console.log(double("4" as any));`,
    );
    expect(stderr).not.toContain("TypeError");
    expect({ stdout, exitCode }).toEqual({ stdout: "ran\n8\n", exitCode: 0 });
  });
  test("TypeScript files of dependencies are compiled at any depth and a type-only import is not evaluated", async () => {
    const manifest = (name: string) => JSON.stringify({ name, version: "1.0.0", main: "index.ts", types: "index.ts" });
    const { stdout, exitCode } = await ran(
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
    expect({ stdout, exitCode }).toEqual({ stdout: "8\n116\n", exitCode: 0 });
  });
  test("a module that the constant parts of a dynamic path match is compiled", async () => {
    const { stdout, exitCode } = await ran(
      {
        "main.ts": `declare const console: { log(...values: unknown[]): void }; declare const process: { argv: string[] };
          const late = await import("./la" + (process.argv.length > 0 ? "te" : "") + ".ts");
          ${attempt(`console.log(late.twice(JSON.parse('"4"')));`)}`,
        "late.ts": `export function twice(n: number): number { return n * 2; }`,
      },
      ["run", ...flags, "main.ts"],
    );
    expect({ stdout, exitCode }).toEqual({ stdout: "8\n", exitCode: 0 });
  });
  const importsDynamicPath = {
    "main.ts": `declare const console: { log(...values: unknown[]): void }; declare const process: { cwd(): string; env: Record<string, string> };
      try { const late = await import(process.cwd() + process.env.LATE); console.log(late.twice(JSON.parse('"4"'))); } catch (e: any) { console.log(e.code + ": " + e.message); }`,
    "late.ts": `export function twice(n: number): number { return n * 2; }`,
  };
  test("the import of a module that only a dynamic path leads to throws, and the build warns", async () => {
    const { stdout, stderr, exitCode } = await ran(importsDynamicPath, ["run", ...flags, "main.ts"], {
      LATE: "/late.ts",
    });
    expect(stderr).toContain(
      "warn: TS100064: this import path isn't a constant. If it resolves to code that isn't in the executable, the import throws at run time",
    );
    expect(stdout).toMatch(
      /^ERR_MODULE_NOT_FOUND: Cannot load '[^']*late\.ts': it isn't in this executable, which only runs code that was compiled into it\. Pass the file to bun compile as another entry point, or build with --aot-allow-code-from-disk\.\n$/,
    );
    expect(exitCode).toBe(0);
  });
  test("an executable built with --compile-inspector loads such a module from disk", async () => {
    using dir = tempDir("run-aot", { "tsconfig.json": tsconfig, ...importsDynamicPath });
    const build = await spawned(
      [bunExe(), "build", "--compile", "--aot", "--compile-inspector", "main.ts", "--outfile", "main"],
      String(dir),
    );
    expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({
      stderr: expect.not.stringMatching(/^error\b|TS100064/m),
      exitCode: 0,
    });
    const { stdout, exitCode } = await spawned([join(String(dir), isWindows ? "main.exe" : "main")], String(dir), {
      LATE: "/late.ts",
    });
    expect({ stdout, exitCode }).toEqual({ stdout: "8\n", exitCode: 0 });
  });
  test("a value of any kind passes where a string is declared", async () => {
    const { stdout, exitCode } = await run(
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
    expect(exitCode).toBe(0);
  });
  test("a function passes where a Map, a Date or a typed array is declared", async () => {
    const { stdout, exitCode } = await run(
      `const given: any[] = [() => 1, class {}, function () {}];
      function asMap(v: any): unknown { const x: Map<string, number> = v; return x; }
      function asDate(v: any): unknown { const x: Date = v; return x; }
      function asBytes(v: any): unknown { const x: Uint8Array = v; return x; }
      function asFunction(v: any): unknown { const x: Function = v; return x; }
      for (const take of [asMap, asDate, asBytes, asFunction]) for (const v of given) { try { console.log(take.name, typeof take(v)); } catch (e) { console.log(take.name, String(e).split(", got")[0]); } }`,
    );
    expect(stdout).toBe(
      ["asMap function", "asDate function", "asBytes function", "asFunction function"]
        .map(line => (line + "\n").repeat(3))
        .join(""),
    );
    expect(exitCode).toBe(0);
  });
  test("a wrong argument to an async function neither throws to the caller nor rejects the promise", async () => {
    const { stdout, exitCode } = await run(
      `async function size(list: number[]): Promise<number> { return list.length; }
      const arrow = async (list: number[]): Promise<number> => list.length;
      const untyped: any[] = [size, arrow];
      for (const f of untyped) { let promise: Promise<unknown>; try { promise = f(5); } catch { console.log("thrown to the caller"); continue; } await promise.then(() => console.log("fulfilled"), e => console.log("rejected", String(e).split(" (bun")[0])); }`,
    );
    expect(stdout).toBe("fulfilled\n".repeat(2));
    expect(exitCode).toBe(0);
  });
  test("for...of over a sparse array of length 4294967295 ends at break and runs an element getter", async () => {
    const { stdout, exitCode } = await run(
      `const sparse: number[] = [1, 2, 3]; sparse[4294967294] = 4; let seen = 0; for (const value of sparse) { if (seen++ > 4) break; } console.log(seen, sparse.length);
      const withGetter: number[] = [1, 2, 3]; withGetter[4294967294] = 4; Object.defineProperty(withGetter, 1, { get() { return 5; } }); for (const value of withGetter) { console.log(value); if (value === 3) break; }`,
    );
    expect({ stdout, exitCode }).toEqual({ stdout: "6 4294967295\n1\n5\n3\n", exitCode: 0 });
  });
  test("an argument, a variable and a result that don't match their declared types behave as in plain Bun", async () => {
    const { stdout, exitCode } = await run(`
      function double(n: number) { return n * 2; }
      const body: any = JSON.parse('{"visits":"3","name":5}');
      ${attempt(`console.log(double(body.visits));`)}
      ${attempt(`const name: string = body.name; console.log(typeof name);`)}
      function read(text: string): number { return JSON.parse(text); }
      ${attempt(`console.log(typeof read('"x"'));`)}
      console.log(double(JSON.parse("4")));`);
    expect(stdout.split("\n")).toEqual(["6", "number", "string", "8", ""]);
    expect(exitCode).toBe(0);
  });
  test("--aot-log-type-mismatches logs the argument that doesn't match, and the program continues", async () => {
    const files = {
      "main.ts": `declare const console: { log(...values: unknown[]): void };\nfunction double(n: number) { return n * 2; }\nconst body: any = JSON.parse('{"visits":"3"}');\nconsole.log(double(body.visits));`,
    };
    const logged = await ran(files, ["run", "--aot-log-type-mismatches", "main.ts"]);
    expect(logged.stderr).toMatch(
      /^\[aot\] type-mismatch [0-9a-f]{12} argument \S*main\.ts:\d+:\d+ \([^)]*\): expected number, got string; continued; count 1\b/m,
    );
    expect({ stdout: logged.stdout, exitCode: logged.exitCode }).toEqual({ stdout: "6\n", exitCode: 0 });
    const silent = await ran(files, ["run", ...flags, "main.ts"]);
    expect(silent.stderr).not.toContain("type-mismatch");
    expect({ stdout: silent.stdout, exitCode: silent.exitCode }).toEqual({ stdout: "6\n", exitCode: 0 });
  });
  test("`as` neither tests nor converts a primitive", async () => {
    const { stdout } = await run(`
      const query: any = JSON.parse('{"page":"2","size":3}');
      ${attempt(`console.log((query.page as number) + 1);`)}
      console.log((query.size as number) + 1);
      const five: unknown = JSON.parse("5");
      ${attempt(`console.log((five as string) + 1);`)}
      console.log(typeof five);`);
    expect(stdout.split("\n")).toEqual(["21", "4", "6", "number", ""]);
  });
  test("`x!` and `let x!: T` check nothing", async () => {
    const { stdout } = await run(`
      const names = new Map<string, string>();
      ${attempt(`const name: string = names.get("bob")!; console.log(name);`)}
      let size!: number;
      function read() { return size + 1; }
      ${attempt(`console.log(read());`)}`);
    expect(stdout).toBe("undefined\nNaN\n");
  });
  test("an array-like object and a Proxy pass where an array is declared", async () => {
    const { stdout } = await run(`
      function first(list: number[]) { return list[0]; }
      const like: any = { 0: 7, length: 1 }, proxy: any = new Proxy([7], {});
      ${attempt(`console.log(first(like));`)}
      ${attempt(`console.log(first(proxy));`)}
      console.log(first([7]));`);
    expect(stdout).toBe("7\n7\n7\n");
  });
  test("a locked member of a built-in keeps its value, and what is not locked can be written", async () => {
    const { stdout } = await ran(
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
  });
  test("in sloppy code too a refused change of a built-in throws", async () => {
    const { stdout } = await ran(
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
  });
  test("a function called through another function type takes whatever it is passed", async () => {
    const { stdout, exitCode } = await ran(
      {
        "main.ts": `
          function count(list: string[]): number { let n = 0; for (const s of list) n += s.length; return n; }
          const kept = [count] as unknown as ((s: string) => number)[];
          ${attempt(`console.log(kept[0]("abc"));`)}
          console.log(count(["ab", "c"]));`,
      },
      ["run", ...flags, "main.ts"],
    );
    expect({ stdout, exitCode }).toEqual({ stdout: "3\n3\n", exitCode: 0 });
  });
  test("a property of undefined or null: the words of the executable", async () => {
    const { stdout } = await ran(
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
  });
  test("a context made at run time has built-ins of its own, which are not locked", async () => {
    const { stdout } = await ran(
      {
        "main.js": `const vm = require("node:vm"); console.log(vm.runInNewContext("Array.prototype.extra = 1; [].extra"), [].extra);`,
      },
      ["run", ...flags, "main.js"],
    );
    expect(stdout).toBe("1 undefined\n");
  });
  test("what comes by the other arm of ||, ?. and a comma is as in plain Bun", async () => {
    const { stdout, exitCode } = await ran(
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
    expect({ stdout, exitCode }).toEqual({
      stdout: "[ undefined ] [ true ] undefined true 1 TypeError\n",
      exitCode: 0,
    });
  });
  test("a deep chain of tail calls with typed results runs in constant space, and a result of another type comes back", async () => {
    const { stdout, exitCode } = await ran(
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
    expect({ stdout, exitCode }).toEqual({ stdout: "600000\ntext\n", exitCode: 0 });
  });
  test("a deep tail recursion finishes, as it does in the executable", async () => {
    const { stdout } = await run(
      `function sum(n: number, total = 0): number { if (n === 0) return total; return sum(n - 1, total + n); } console.log(sum(1_000_000));`,
    );
    expect(stdout).toBe("500000500000\n");
  });
});

describe("bun test", () => {
  const price = {
    "price.ts": `export function price(id: string): number { return id.length; }\nexport const rate = { of(id: string): number { return id.length * 2; } };`,
  };
  test("mock.module throws for a module that was compiled", async () => {
    const { stderr, exitCode } = await ranWithBunTypes(
      {
        ...price,
        "one.test.ts": `import { expect, mock, test } from "bun:test";\nimport { price } from "./price.ts";\ntest("not replaced", () => { expect(() => mock.module("./price.ts", () => ({ price: () => 42 }))).toThrow("cannot replace a module that was compiled ahead of time"); expect(price("abc")).toBe(3); });`,
      },
      ["test", ...flags, "one.test.ts"],
    );
    expect(stderr).toContain("1 pass");
    expect(exitCode).toBe(0);
  });
  test("spyOn replaces a method of an object of the program and gives it back", async () => {
    const { stderr, exitCode } = await ranWithBunTypes(
      {
        ...price,
        "two.test.ts": `import { expect, spyOn, test } from "bun:test";\nimport { rate } from "./price.ts";\ntest("spied", () => { const spy = spyOn(rate, "of").mockReturnValue(7); expect(rate.of("abc")).toBe(7); expect(spy).toHaveBeenCalledWith("abc"); spy.mockRestore(); expect(rate.of("abc")).toBe(6); });`,
      },
      ["test", ...flags, "two.test.ts"],
    );
    expect(stderr).toContain("1 pass");
    expect(exitCode).toBe(0);
  });
  test("a mock function passes as a typed callback, and a result of another type comes back", async () => {
    const { stderr, exitCode } = await ranWithBunTypes(
      {
        "three.test.ts": `import { expect, jest, mock, test } from "bun:test";\nfunction twice(f: (n: number) => number): number { return f(1) + f(2); }\ntest("called", () => { const f = mock((n: number) => n * 10); expect(twice(f)).toBe(30); expect(f).toHaveBeenCalledTimes(2); const g = jest.fn((n: number) => n); expect(twice(g)).toBe(3); });\ntest("joined", () => { const wrong: any = mock(() => "text"); expect(String(twice(wrong))).toBe("texttext"); });`,
      },
      ["test", ...flags, "three.test.ts"],
    );
    expect(stderr).toContain("2 pass");
    expect(exitCode).toBe(0);
  });
  test("spyOn throws for a method of a built-in prototype", async () => {
    const { stderr, exitCode } = await ranWithBunTypes(
      {
        "main.test.ts": `import { expect, spyOn, test } from "bun:test";\ntest("not replaced", () => { expect(() => spyOn(String.prototype, "normalize")).toThrow("Cannot spy on 'normalize' because this property of a built-in object is read-only in a compiled executable"); expect("e".normalize()).toBe("e"); });`,
      },
      ["test", ...flags, "./main.test.ts"],
    );
    expect(stderr).toContain("1 pass");
    expect(exitCode).toBe(0);
  });
  test("a type error in a test file ends the run", async () => {
    const { stderr, exitCode } = await ranWithBunTypes(
      { "four.test.ts": `import { test } from "bun:test";\nconst n: number = "x";\ntest("never", () => {});` },
      ["test", ...flags, "four.test.ts"],
    );
    expect(stderr).toContain("TS2322");
    expect(stderr).not.toContain("1 pass");
    expect(exitCode).toBe(1);
  });
});
