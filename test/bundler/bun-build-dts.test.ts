import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

async function bun(cwd: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd,
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const project = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: { strict: true, module: "esnext", moduleResolution: "bundler", target: "esnext", types: [] },
  }),
  "package.json": JSON.stringify({ name: "greeter", version: "1.0.0" }),
  "src/index.ts": `import { join } from "./join";
export interface Options {
  name: string;
  times: number;
}
export function greet(options: Options): string {
  return join("hello", options.name).repeat(options.times);
}
`,
  "src/join.ts": `export function join(first: string, second: string): string {
  return first + " " + second;
}
`,
};

describe.concurrent("bun build --dts", () => {
  test("writes the bundle, its declaration files and the bundle with its types kept", async () => {
    using dir = tempDir("build-dts", project);
    const built = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out", "--dts");
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(readdirSync(join(String(dir), "out")).sort()).toEqual([
      "index.aot.ts",
      "index.d.ts",
      "index.js",
      "join.d.ts",
    ]);
    const read = (name: string) => readFileSync(join(String(dir), "out", name), "utf8");
    expect(read("index.d.ts")).toContain("export declare function greet(options: Options): string;");
    expect(read("index.aot.ts")).toContain("function greet(options: Options): string {");
    expect(read("index.aot.ts")).toContain("function join(first: string, second: string): string {");
    expect(read("index.js")).toContain("function greet(options) {");
    expect(read("index.js")).not.toContain("debugId");
    expect(readFileSync(join(String(dir), "package.json"), "utf8")).toBe(project["package.json"]);
  });

  test.each([
    ["says nothing", undefined, true],
    ["says something else", { strict: true }, true],
    ["says the same", { strict: true, strictNullChecks: false, noUncheckedIndexedAccess: true }, false],
    ["says the same in other words", { strictNullChecks: false, noUncheckedIndexedAccess: true }, false],
  ])("sources that are not strict, and a package.json that %s", async (_, compilerOptions, warns) => {
    using dir = tempDir("build-dts-options", {
      ...project,
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strictNullChecks: false, noUncheckedIndexedAccess: true, types: [] },
      }),
      "package.json": JSON.stringify({ name: "greeter", version: "1.0.0", compilerOptions }),
    });
    const built = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out", "--dts");
    expect(built.exitCode).toBe(0);
    expect(built.stderr).toBe(
      warns
        ? `warn: package.json needs "compilerOptions": {"strict":true,"strictNullChecks":false,"noUncheckedIndexedAccess":true}: --aot type checks a package's .aot.ts files under them, and as strict without them\n`
        : "",
    );
    expect(readdirSync(join(String(dir), "out"))).toContain("index.aot.ts");
  });

  test("a type error fails the build", async () => {
    using dir = tempDir("build-dts-error", {
      ...project,
      "src/join.ts": project["src/join.ts"].replace("): string", "): number"),
    });
    const built = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out", "--dts");
    expect(built.stderr).toContain("TS2322");
    expect(built.exitCode).toBe(1);
  });

  test("needs --outdir", async () => {
    using dir = tempDir("build-dts-outdir", project);
    const built = await bun(String(dir), "build", "./src/index.ts", "--dts");
    expect(built.stderr).toContain("--dts requires --outdir, and cannot be used with --compile");
    expect(built.exitCode).toBe(1);
  });

  test("--minify: the declaration files, and a warning about the rest", async () => {
    using dir = tempDir("build-dts-minify", project);
    const built = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out", "--dts", "--minify");
    expect(built.stderr).toBe(
      "warn: the .aot.ts files that --aot compiles a package from are left out: they do not support --minify-identifiers yet\n",
    );
    expect(built.exitCode).toBe(0);
    expect(readdirSync(join(String(dir), "out")).sort()).toEqual(["index.d.ts", "index.js", "join.d.ts"]);
  });

  test("--minify-syntax --minify-whitespace: every file", async () => {
    using dir = tempDir("build-dts-minify-syntax", project);
    const flags = ["--dts", "--minify-syntax", "--minify-whitespace"];
    const built = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out", ...flags);
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(readFileSync(join(String(dir), "out/index.aot.ts"), "utf8")).toContain(
      "function greet(options: Options): string{return join(",
    );
  });

  test("a statement that never runs is left out", async () => {
    using dir = tempDir("build-dts-dead", {
      ...project,
      "src/join.ts": `declare const __DEV__: boolean;
export function join(first: string, second: string): string {
  if (__DEV__ && first.length === 0) throw new Error("empty");
  return first + " " + second;
}
`,
    });
    const flags = ["--dts", "--define", "__DEV__=false"];
    const built = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out", ...flags);
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(readFileSync(join(String(dir), "out/index.js"), "utf8")).toContain(
      'function join(first, second) {\n  return first + " " + second;\n}',
    );
    expect(readFileSync(join(String(dir), "out/index.aot.ts"), "utf8")).not.toContain("__DEV__");
  });

  test("a build without it writes what it always did", async () => {
    using dir = tempDir("build-without-dts", project);
    const built = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out");
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(readdirSync(join(String(dir), "out"))).toEqual(["index.js"]);
  });

  // A `//` comment ends at its line break, so the type stays on the line after it.
  test("a comment before the type of an optional parameter property is kept", async () => {
    using dir = tempDir("build-dts-comment", {
      ...project,
      "src/index.ts": `export class Box {
  constructor(
    public size?: // in pixels
    number,
  ) {}
}
`,
    });
    const built = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out", "--dts");
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(readFileSync(join(String(dir), "out/index.aot.ts"), "utf8")).toContain(
      "  public size?: // in pixels\n    number | undefined;\n",
    );
  });

  // The React Compiler prints `(first = 1)` as `(t0) { let first = t0 === undefined ? 1 : t0`.
  const hooks = {
    ...project,
    "src/state.ts": `export function useState<T>(initial: T): [T] {\n  return [initial];\n}\n`,
    "src/index.tsx": `import { useState } from "./state";
export function useBoth(first: number = 1, second: number = 2): number {
  const [value] = useState(first);
  return value + second;
}
export function useRange(start: number = 0, end: number): number {
  const [value] = useState(start);
  return value + end;
}
export function useFormat(format: (value: number) => string = String, value: number): string {
  const [text] = useState(format(value));
  return text;
}
export function useTotal(items: string[]) {
  const [n] = useState(items.length);
  return items.reduce((total: number = 0, item) => total + item.length + n, 0);
}
export function useAdder(base: number) {
  const [n] = useState(base);
  return (a: number, b: number = 2) => a + b + n;
}
`,
  };
  const withCompiler = ["build", "./src/index.tsx", "--outdir", "out", "--dts", "--react-compiler", "--target=bun"];

  test("--react-compiler: a parameter whose default value is in the function body can be left out", async () => {
    using dir = tempDir("build-dts-moved-default", {
      ...hooks,
      "src/index.tsx": hooks["src/index.tsx"] + "console.log(useBoth());\n",
    });
    const built = await bun(String(dir), ...withCompiler);
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(readFileSync(join(String(dir), "out/index.aot.ts"), "utf8")).toContain(
      "function useBoth(t0?: number, t1?: number): number {",
    );
  });

  test("--react-compiler: a function with such a parameter has the type that index.d.ts says", async () => {
    using dir = tempDir("build-dts-moved-default-same", {
      ...hooks,
      "same.ts": `import * as declared from "./out/index";
import * as typed from "./out/index.aot";
type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
export const useBoth: Same<typeof typed.useBoth, typeof declared.useBoth> = true;
export const useRange: Same<typeof typed.useRange, typeof declared.useRange> = true;
export const useFormat: Same<typeof typed.useFormat, typeof declared.useFormat> = true;
export const useTotal: Same<typeof typed.useTotal, typeof declared.useTotal> = true;
export const useAdder: Same<typeof typed.useAdder, typeof declared.useAdder> = true;
`,
    });
    const built = await bun(String(dir), ...withCompiler);
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(await bun(String(dir), "check", "--no-pretty", "same.ts")).toMatchObject({ stdout: "", exitCode: 0 });
  });

  // TypeScript infers the type arguments of a call from an annotated parameter of a callback, where a default value
  // adds no `undefined` and a `?` does. Main writes the typed file of this build: only `useBeside` has another type there.
  test("--react-compiler: a hook keeps its type where a call gives the parameter of a callback a type", async () => {
    const callees = {
      fold: "fold(items, (total: number = 0) => count(n, total), 0)",
      foldItem: "fold(items, (total: number = 0, item: string) => count(n, total, item), 0)",
      on: "on((payload: number = 0) => use(n, payload))",
      useReducer: "useReducer((state: number = 0) => count(n, state), 0)",
      useReducerOf: "useReducer((state: Counter = { count: 0 }) => ({ count: count(n, state) }), { count: n })",
      store: "new Store((state: number = 0) => count(n, state), 0).state",
      configure: "configure({ initial: n, onChange: (value: number = 0) => use(n, value) })",
      pipeline: "pipeline(0, (value: number = 0) => count(n, value), (value: number = 0) => count(n, value))",
      memoize: "memoize((argument: number = 0) => count(n, argument))",
      watch: "watch((previous: number = 0) => count(n, previous), 0)",
      curried: "curried((first: number = 0) => (second: number) => second + count(n, first))",
      reduce: "items.reduce((total: number = 0, item) => total + item.length + n, 0)",
    };
    const names = Object.keys(callees).map(name => "use" + name[0].toUpperCase() + name.slice(1));
    using dir = tempDir("build-dts-moved-default-callback", {
      ...project,
      "src/lib.ts": `export function useState<T>(initial: T): [T] {
  return [initial];
}
export function count(...values: unknown[]): number {
  return values.length;
}
export function use(...values: unknown[]): void {}
export interface Counter {
  count: number;
}
export function fold<U>(items: string[], step: (total: U, item: string, index: number) => U, initial: U): U {
  return items.reduce((total, item, index) => step(total, item, index), initial);
}
export function on<T>(handler: (payload: T, meta: { at: number }) => void): T[] {
  return [];
}
export type AnyActionArg = [] | [any];
export function useReducer<S, A extends AnyActionArg>(
  reducer: (prevState: S, ...args: A) => S,
  initialState: S,
): [S, (...args: A) => void] {
  return [initialState, () => {}];
}
export class Store<T> {
  constructor(
    public reduce: (state: T, action: string) => T,
    public state: T,
  ) {}
}
export function configure<T>(options: { initial: T; onChange: (value: T, previous: T) => void }): T {
  return options.initial;
}
export function pipeline<T>(initial: T, ...steps: Array<(value: T, index: number) => T>): T {
  return steps.reduce((value, step, index) => step(value, index), initial);
}
export function memoize<A, R>(compute: (argument: A, cache: Map<A, R>) => R): (argument: A) => R {
  const cache = new Map<A, R>();
  return argument => compute(argument, cache);
}
export function watch<T>(get: (previous: T, tick: number) => T, initial: T): T;
export function watch(get: (previous: string, tick: number) => string): string;
export function watch(get: (previous: any, tick: number) => any, initial?: any): any {
  return get(initial, 0);
}
export function curried<T>(make: (first: T, label: string) => (second: T) => T): T | undefined {
  return undefined;
}
`,
      "src/index.tsx": `import { Counter, Store, configure, count, curried, fold, memoize, on, pipeline, use, useReducer, useState, watch } from "./lib";
${names
  .map(
    (name, index) => `export function ${name}(items: string[]) {
  const [n] = useState(items.length);
  return ${Object.values(callees)[index]};
}
`,
  )
  .join("")}export function useBeside(first: number = 1, second: number = 2): number {
  const [value] = useState(first);
  return value + second;
}
`,
      "same.ts": `import * as declared from "./out/index";
import * as typed from "./out/index.aot";
type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
${[...names, "useBeside"]
  .map(name => `export const ${name}: Same<typeof typed.${name}, typeof declared.${name}> = true;\n`)
  .join("")}`,
    });
    const built = await bun(String(dir), ...withCompiler);
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(await bun(String(dir), "check", "--no-pretty", "same.ts")).toMatchObject({ stdout: "", exitCode: 0 });
  });
});
