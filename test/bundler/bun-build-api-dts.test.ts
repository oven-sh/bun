import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { tempDir } from "harness";
import { join } from "path";

const project = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: { strict: true, module: "esnext", moduleResolution: "bundler", target: "esnext", types: [] },
  }),
  "src/index.ts": `import { join } from "./join";
export interface Options {
  name: string;
  times: number;
}
export function greet(options: Options): string {
  return join("hello", options.name).repeat(options.times);
}
export { join };
`,
  "src/join.ts": `export function join(first: string, second: string): string {
  return first + " " + second;
}
`,
};

const WRITTEN = ["index.aot.ts", "index.d.ts", "index.js", "join.d.ts"];
const filesIn = (folder: string) => readdirSync(folder, { recursive: true }).map(String).sort();
const described = (root: string, outputs: Bun.BuildArtifact[]) =>
  outputs
    .map(({ path, kind, loader }) => [path.replace(root, "").replaceAll("\\", "/").replace(/^\.\//, ""), kind, loader])
    .sort();

describe("Bun.build({ dts: true })", () => {
  test("writes the bundle, its declaration files and the bundle with its types kept to outdir", async () => {
    using dir = tempDir("build-api-dts", project);
    const root = String(dir);
    const built = await Bun.build({
      entrypoints: [join(root, "src/index.ts")],
      outdir: join(root, "out"),
      tsconfig: join(root, "tsconfig.json"),
      dts: true,
    });
    expect(built.logs).toEqual([]);
    expect(filesIn(join(root, "out"))).toEqual(WRITTEN);
    expect(described(root, built.outputs)).toEqual([
      ["/out/index.aot.ts", "asset", "ts"],
      ["/out/index.d.ts", "asset", "ts"],
      ["/out/index.js", "entry-point", "ts"],
      ["/out/join.d.ts", "asset", "ts"],
    ]);
    for (const output of built.outputs) expect(await output.text()).toBe(readFileSync(output.path, "utf8"));
    const read = (name: string) => readFileSync(join(root, "out", name), "utf8");
    expect(read("index.d.ts")).toBe(`import { join } from "./join.js";
export interface Options {
    name: string;
    times: number;
}
export declare function greet(options: Options): string;
export { join };
`);
    expect(read("index.aot.ts")).toContain("function greet(options: Options): string {");
    expect(read("index.aot.ts")).toContain("function join(first: string, second: string): string {");
    expect(read("index.js")).toContain("function greet(options) {");
    expect(read("index.js")).not.toContain("debugId");
    const plain = await Bun.build({ entrypoints: [join(root, "src/index.ts")], tsconfig: join(root, "tsconfig.json") });
    expect(read("index.js")).toBe(await plain.outputs[0].text());
  });

  test("without outdir, the files are in outputs and nothing is written", async () => {
    using dir = tempDir("build-api-dts-memory", project);
    const root = String(dir);
    const before = filesIn(root);
    const built = await Bun.build({
      entrypoints: [join(root, "src/index.ts")],
      tsconfig: join(root, "tsconfig.json"),
      dts: true,
    });
    expect(built.logs).toEqual([]);
    expect(described(root, built.outputs)).toEqual([
      ["index.aot.ts", "asset", "ts"],
      ["index.d.ts", "asset", "ts"],
      ["index.js", "entry-point", "ts"],
      ["join.d.ts", "asset", "ts"],
    ]);
    const typed = built.outputs.find(output => output.path.endsWith("index.aot.ts"))!;
    expect(await typed.text()).toContain("function greet(options: Options): string {");
    expect(filesIn(root)).toEqual(before);
  });

  test("a source map that was asked for is kept", async () => {
    using dir = tempDir("build-api-dts-sourcemap", project);
    const root = String(dir);
    const built = await Bun.build({
      entrypoints: [join(root, "src/index.ts")],
      outdir: join(root, "out"),
      tsconfig: join(root, "tsconfig.json"),
      sourcemap: "external",
      dts: true,
    });
    expect(built.logs).toEqual([]);
    expect(filesIn(join(root, "out"))).toEqual([...WRITTEN, "index.js.map"].sort());
  });

  test("a type error fails the build", async () => {
    using dir = tempDir("build-api-dts-error", {
      ...project,
      "src/join.ts": project["src/join.ts"].replace("): string", "): number"),
    });
    const root = String(dir);
    const built = await Bun.build({
      entrypoints: [join(root, "src/index.ts")],
      outdir: join(root, "out"),
      tsconfig: join(root, "tsconfig.json"),
      dts: true,
      throw: false,
    });
    expect(built.success).toBe(false);
    expect(built.logs.map(log => log.message).join("\n")).toContain("TS2322");
    expect(filesIn(root)).not.toContain("out");
  });

  test("minify: the declaration files, and a warning about the rest", async () => {
    using dir = tempDir("build-api-dts-minify", project);
    const root = String(dir);
    const built = await Bun.build({
      entrypoints: [join(root, "src/index.ts")],
      outdir: join(root, "out"),
      tsconfig: join(root, "tsconfig.json"),
      minify: true,
      dts: true,
    });
    expect(built.logs.map(log => [log.level, log.message])).toEqual([
      [
        "warn",
        "the .aot.ts files that --aot compiles a package from are left out: they do not support minify.identifiers yet",
      ],
    ]);
    expect(filesIn(join(root, "out"))).toEqual(["index.d.ts", "index.js", "join.d.ts"]);
  });

  test("minify.syntax and minify.whitespace: every file", async () => {
    using dir = tempDir("build-api-dts-minify-syntax", project);
    const root = String(dir);
    const built = await Bun.build({
      entrypoints: [join(root, "src/index.ts")],
      outdir: join(root, "out"),
      tsconfig: join(root, "tsconfig.json"),
      minify: { syntax: true, whitespace: true },
      dts: true,
    });
    expect(built.logs).toEqual([]);
    expect(filesIn(join(root, "out"))).toContain("index.aot.ts");
  });

  test("two builds at once keep their files apart", async () => {
    using dir = tempDir("build-api-dts-twice", {
      ...Object.fromEntries(Object.entries(project).map(([path, text]) => ["a/" + path, text])),
      "b/tsconfig.json": project["tsconfig.json"],
      "b/src/index.ts": `export const other: number = 1;\n`,
    });
    const root = String(dir);
    const build = (name: string) =>
      Bun.build({
        entrypoints: [join(root, name, "src/index.ts")],
        outdir: join(root, name, "out"),
        tsconfig: join(root, name, "tsconfig.json"),
        dts: true,
      });
    const [a, b] = await Promise.all([build("a"), build("b")]);
    expect([a.logs, b.logs]).toEqual([[], []]);
    expect(filesIn(join(root, "a/out"))).toEqual(WRITTEN);
    expect(filesIn(join(root, "b/out"))).toEqual(WRITTEN.filter(path => path !== "join.d.ts"));
    expect(readFileSync(join(root, "b/out/index.d.ts"), "utf8")).toBe("export declare const other: number;\n");
  });

  test("cannot be used with compile", () => {
    expect(() => Bun.build({ entrypoints: ["./index.ts"], compile: true, dts: true })).toThrow(
      "dts cannot be used with compile",
    );
  });
});

// The React Compiler prints `function useStep(step = 1) {` as `function useStep(t0) { let step = t0 === undefined ? 1 : t0;`.
describe("Bun.build({ dts: true, reactCompiler: true }): a parameter whose default value is in the function body", () => {
  const state = `export function useState<T>(initial: T): [T, (next: T) => void] {
  return [initial, () => {}];
}
`;
  const hooks = `import { useState } from "./state";
export function useBoth(first: number = 1, second: number = 2): number {
  const [value] = useState(first);
  return value + second;
}
export function useStep(step = 2): number {
  const [value] = useState(step);
  return value;
}
export function useRange(start: number = 0, size = 1, end: number): number {
  const [value] = useState(start);
  return value + size + end;
}
export function useFormat(format: (value: number) => string = String, value: number): string {
  const [text] = useState(format(value));
  return text;
}
export function useName({ name }: { name: string } = { name: "x" }, [first] = ["a"], suffix: string = "!"): string {
  const [value] = useState(name);
  return value + first + suffix;
}
export const useArrow = (first: number = 1, second = 2): number => useState(first)[0] + second;
export function useLabel(label: string, size?: number): string {
  const [value] = useState(label);
  return value + (size ?? 0);
}
export function plain(first: number = 1, second: number = 2): number {
  return first + second;
}
`;
  // What the sources accept. With these in the bundle, a typed file that asks for more is left out with a warning.
  const calls = `console.log(useBoth(), useBoth(5), useStep(), useRange(undefined, undefined, 5), useFormat(undefined, 1));
console.log(useName(), useArrow(), useLabel("a"), plain());
`;
  // A hook beside the ones of a test: its parameters show that the build is one that moves default values.
  const useBeside = `export function useBeside(first: number = 1, second: number = 2): number {
  const [value] = useState(first);
  return value + second;
}
console.log(useBeside());
`;
  // The parameters of each function. The check of the typed files writes `: any` behind a parameter that has no type.
  const parametersIn = (typed: string) =>
    Object.fromEntries(
      Array.from(
        typed.matchAll(/^(?:function|const) (\w+)(?:<[^>]*>)?(?: = )?\((.*)\)(?:: [^{\n]+)? \{$/gm),
        ([, name, list]) => [name, list.replaceAll(": any", "")],
      ),
    );
  const typedFile = async (files: Record<string, string>, options: Partial<Bun.BuildConfig> = {}) => {
    using dir = tempDir("build-api-dts-moved-default", {
      "tsconfig.json": project["tsconfig.json"],
      "src/state.ts": state,
      ...files,
    });
    const root = String(dir);
    const built = await Bun.build({
      entrypoints: [join(root, "src/index.tsx")],
      outdir: join(root, "out"),
      tsconfig: join(root, "tsconfig.json"),
      target: "bun",
      reactCompiler: true,
      dts: true,
      ...options,
    });
    expect(built.logs).toEqual([]);
    return readFileSync(join(root, "out/index.aot.ts"), "utf8");
  };

  test("can be left out", async () => {
    expect(parametersIn(await typedFile({ "src/index.tsx": hooks + calls }))).toEqual({
      useState: "initial: T",
      useBoth: "t0?: number, t1?: number",
      // Without an annotation it has the type of a parameter without one.
      useStep: "t0?",
      // A `?` before a parameter that has to be passed is an error.
      useRange: "t0: number | undefined, t1, end: number",
      useFormat: "t0: ((value: number) => string) | undefined, value: number",
      // The annotation of a pattern is where the pattern is.
      useName: "t0?, t1?, t2?: string",
      useArrow: "t0?: number, t1?",
      useLabel: "label: string, size?: number",
      // What the compiler leaves as it is written keeps its default values.
      plain: "first: number = 1, second: number = 2",
    });
  });

  const queried = `import { useState } from "./state";
function take(point: [number, number]): number {
  return point[0] + point[1];
}
export function useSigned(first: number = 1, second: typeof first = 2): number {
  const [value] = useState(first);
  return value + second;
}
export function useQueried(first: number = 1, point: [number, number] = [0, 0]): number {
  const [seen] = useState(first);
  const origin: typeof point = [seen, seen];
  return take(origin) + point[0];
}
`;
  // `typeof first` is the type of `first` with its default value, which has no `undefined`. A parameter with a `?` has.
  test("stays as the output has it in a function with a `typeof` of it", async () => {
    expect(parametersIn(await typedFile({ "src/index.tsx": queried + useBeside }))).toEqual({
      useState: "initial: T",
      take: "point: [number, number]",
      useSigned: "t0: number, t1: typeof t0",
      useQueried: "t0: number, t1: [number, number]",
      useBeside: "t0?: number, t1?: number",
    });
  });

  test.todo("can be left out of a function with a `typeof` of it", async () => {
    const typed = await typedFile({ "src/index.tsx": queried + "console.log(useSigned(), useQueried());\n" });
    expect(parametersIn(typed)).toMatchObject({ useSigned: expect.stringMatching(/^t0\?: number, t1\?: /) });
  });

  // TypeScript infers the type arguments of a call from an annotated parameter of a callback. There a default value
  // adds no `undefined` and a `?` does, so the parameter stays as it is where the call gives its place a type.
  test("stays as the output has it in a callback, where the call gives it a type without undefined", async () => {
    const typed = await typedFile({
      "src/index.tsx": `import { useState } from "./state";
function pick<T>(make: (label: string, seed: T) => T, seed: T): T {
  return make("a", seed);
}
interface Counter {
  count: number;
}
function useReducer<S, A>(reducer: (state: S, action: A) => S, initial: S): S {
  return initial;
}
function run(task: () => number): number {
  return task();
}
function each(items: string[], visit: (item: string, index?: number) => void): void {
  items.forEach((item, index) => visit(item, index));
}
function useCallback<T extends Function>(callback: T): T {
  return callback;
}
export function useTotal(items: string[]) {
  const [n] = useState(items.length);
  return items.reduce((total: number = 0, item) => total + item.length + n, 0);
}
export function usePicked(start: number): number {
  const [n] = useState(start);
  return pick((label, seed: number = 1) => seed + n + label.length, n);
}
export function useCounter(start: number): Counter {
  const [n] = useState(start);
  return useReducer((state: Counter = { count: 0 }, action) => ({ count: state.count + n }), { count: n });
}
export function useRun(start: number): number {
  const [n] = useState(start);
  return run((extra: number = 1) => n + extra);
}
export function useEach(items: string[]): number {
  const [n] = useState(items.length);
  let seen = n;
  each(items, (item, index: number = 0) => {
    seen += item.length + index;
  });
  return seen;
}
export function useAdder(base: number) {
  const [n] = useState(base);
  return useCallback((a: number, b: number = 2) => a + b + n);
}
${useBeside}`,
    });
    expect(typed).toContain("return items.reduce((t0: number, item) => {");
    expect(typed).toContain("return pick((label, t0: number) => {");
    expect(typed).toContain("return useReducer((t0: Counter, action) => {");
    // The call gives these no type there, or one with `undefined`.
    expect(typed).toContain("return run((t0?: number) => {");
    expect(typed).toContain("each(items, (item, t0?: number) => {");
    expect(typed).toContain("return useCallback((a: number, t0?: number) => {");
    expect(typed).toContain("function useBeside(t0?: number, t1?: number): number {");
  });

  test("keeps a comment that is before its type", async () => {
    const typed = await typedFile({
      "src/index.tsx": `import { useState } from "./state";
export function useComment(
  first: // how many
  number = 1,
  n: number,
): number {
  const [value] = useState(first);
  return value + n;
}
export function useFormat(
  format: // how
  (value: number) => string = String,
  value: number,
): string {
  const [seen] = useState(value);
  return format(seen);
}
export function useMode(
  mode:
    // the default
    | "light"
    | "dark" = "light",
  n: number,
): string {
  const [value] = useState(mode);
  return value + n;
}
console.log(useComment(undefined, 1), useFormat(undefined, 1), useMode(undefined, 1), useMode("light", 1));
`,
    });
    expect(typed).toContain("function useComment(t0: // how many\n  number | undefined, n: number): number {");
    expect(typed).toContain(
      "function useFormat(t0: // how\n  ((value: number) => string) | undefined, value: number): string {",
    );
    expect(typed).toContain(
      'function useMode(t0:\n    // the default\n    | "light"\n    | "dark" | undefined, n: number): string {',
    );
  });

  // A `>` in the text of a JSX element is an error for tsc and none for Bun.
  test("in a module that is not checked", async () => {
    const typed = await typedFile(
      {
        "tsconfig.json": JSON.stringify({
          compilerOptions: { ...JSON.parse(project["tsconfig.json"]).compilerOptions, jsx: "react-jsx" },
        }),
        "package.json": JSON.stringify({ name: "hooks", compilerOptions: { strict: true, jsx: "react-jsx" } }),
        "src/index.tsx": `export { useLoose } from "./loose";\nexport { plainJs, useJs, useJsBefore } from "./hooks.jsx";\n`,
        "src/loose.tsx": `// @ts-nocheck
import { useState } from "./state";
export function useLoose(first: number = 1, second: number = 2, third = 3) {
  const [value] = useState(first);
  return value + second + third;
}
`,
        "src/hooks.d.ts": `export declare function useJs(first?: number, second?: [number], third?: number): number;
export declare function useJsBefore(first: number | undefined, last: number): number;
export declare function plainJs(first: number, second: number): number;
`,
        "src/hooks.jsx": `import { useState } from "./state";
export function useJs(first = 1, [second] = [2], third = 3) {
  const [value] = useState(first);
  return value + second + third;
}
export function useJsBefore(first = 1, last) {
  const [value] = useState(first);
  return value + last;
}
export function plainJs(first, second) {
  return first + second;
}
function Crumb() {
  return <span>Home > Docs</span>;
}
`,
      },
      { packages: "external" },
    );
    expect(parametersIn(typed)).toEqual({
      useState: "initial: T",
      useLoose: "t0?, t1?, t2?",
      useJs: "t0?, t1?, t2?",
      useJsBefore: "t0, last",
      plainJs: "first, second",
    });
  });

  // The stand-in declares `c`. The `react/compiler-runtime` of `@types/react` declares nothing, and the typed files of a
  // browser build are left out against it (TS2305), with this parameter list or another.
  test("in the output for a browser, which keeps what a function computes from one call to the next", async () => {
    const typed = await typedFile(
      {
        "src/index.tsx": `import { useState } from "react";
export function usePair(first: number = 1, second: number = 2): number[] {
  const [value] = useState(first);
  return [value, second];
}
console.log(usePair(), usePair(1), usePair(1, 2));
`,
        "node_modules/react/package.json": JSON.stringify({
          name: "react",
          version: "19.0.0",
          exports: {
            ".": { types: "./index.d.ts", default: "./index.js" },
            "./compiler-runtime": { types: "./compiler-runtime.d.ts", default: "./compiler-runtime.js" },
          },
        }),
        "node_modules/react/index.js": `export const useState = initial => [initial];\n`,
        "node_modules/react/index.d.ts": `export declare function useState<T>(initial: T): [T];\n`,
        "node_modules/react/compiler-runtime.js": `export const c = size => new Array(size);\n`,
        "node_modules/react/compiler-runtime.d.ts": `export declare function c(size: number): any[];\n`,
      },
      { target: "browser", external: ["react", "react/*"] },
    );
    expect(typed).toContain(`import { c as _c } from "react/compiler-runtime";`);
    expect(parametersIn(typed)).toEqual({ usePair: "t0?: number, t1?: number" });
  });

  test("with minify.syntax and minify.whitespace", async () => {
    const typed = await typedFile({ "src/index.tsx": hooks + calls }, { minify: { syntax: true, whitespace: true } });
    expect(typed).toContain("function useBoth(t0?: number,t1?: number): number{");
    expect(typed).toContain("function useFormat(t0: ((value: number) => string) | undefined,value: number): string{");
  });

  test("with two entry points and splitting", async () => {
    using dir = tempDir("build-api-dts-moved-default-splitting", {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { ...JSON.parse(project["tsconfig.json"]).compilerOptions, jsx: "react-jsx" },
      }),
      "package.json": JSON.stringify({ name: "hooks", compilerOptions: { strict: true, jsx: "react-jsx" } }),
      "src/state.ts": state,
      "src/hooks.tsx": `import { useState } from "./state";\n${useBeside}`,
      "src/a.tsx": `import { useBeside } from "./hooks";
export function useA(first: number = 1): number {
  return useBeside(first);
}
console.log(useA(), useBeside());
`,
      "src/b.tsx": `import { useBeside } from "./hooks";
export function useB(start: number = 0, end: number): number {
  return useBeside(start, end);
}
console.log(useB(undefined, 1), useBeside());
`,
    });
    const root = String(dir);
    const built = await Bun.build({
      entrypoints: [join(root, "src/a.tsx"), join(root, "src/b.tsx")],
      outdir: join(root, "out"),
      tsconfig: join(root, "tsconfig.json"),
      target: "bun",
      reactCompiler: true,
      splitting: true,
      dts: true,
    });
    expect(built.logs).toEqual([]);
    const typed = filesIn(join(root, "out"))
      .filter(path => path.endsWith(".aot.ts"))
      .map(path => readFileSync(join(root, "out", path), "utf8"));
    expect(typed.map(parametersIn).sort((a, b) => Object.keys(a)[0].localeCompare(Object.keys(b)[0]))).toEqual([
      { useA: "t0?: number" },
      { useB: "t0: number | undefined, end: number" },
      { useState: "initial: T", useBeside: "t0?: number, t1?: number" },
    ]);
  });
});
