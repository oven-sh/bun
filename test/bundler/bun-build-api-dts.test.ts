import { describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, symlinkSync } from "fs";
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
export function useMake(make: new () => Date = Date, year: number): number {
  const [made] = useState(new make());
  return made.getFullYear() + year;
}
export function useName({ name }: { name: string } = { name: "x" }, [first] = ["a"], suffix: string = "!"): string {
  const [value] = useState(name);
  return value + first + suffix;
}
export function useOver(first?: number): number;
export function useOver(first: string, second?: number): number;
export function useOver(first: number | string = 1, second: number = 2): number {
  const [value] = useState(first);
  return Number(value) + second;
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
console.log(useMake(undefined, 1), useName(), useOver(), useOver("a"), useArrow(), useLabel("a"), plain());
`;
  // A hook beside the ones of a test. Main writes it with parameters that have to be passed.
  const useBeside = `export function useBeside(first: number = 1, second: number = 2): number {
  const [value] = useState(first);
  return value + second;
}
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
      useMake: "t0: (new () => Date) | undefined, year: number",
      // The annotation of a pattern is not copied: the parameter takes the `?` alone.
      useName: "t0?, t1?, t2?: string",
      useOver: "t0?: number | string, t1?: number",
      useArrow: "t0?: number, t1?",
      useLabel: "label: string, size?: number",
      // What the compiler leaves as it is written keeps its default values.
      plain: "first: number = 1, second: number = 2",
    });
  });

  // What reads a function as a value is an identifier of the output. A property with its name, or an export of it, is none.
  test("can be left out of a function that a module exports, and whose name a property has", async () => {
    const typed = await typedFile({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { ...JSON.parse(project["tsconfig.json"]).compilerOptions, jsx: "react-jsx" },
      }),
      "package.json": JSON.stringify({ name: "hooks", compilerOptions: { strict: true, jsx: "react-jsx" } }),
      // The bundler writes `var thing_default = useThing` for the last line.
      "src/thing.tsx": `import { useState } from "./state";
function useThing(first: number = 1): number {
  const [value] = useState(first);
  return value;
}
export default useThing;
`,
      "src/index.tsx": `import { useState } from "./state";
import thing from "./thing";
const info = { useBeside: 1, useMain: 2 };
${useBeside}export default function useMain(first: number = 1): number {
  const [value] = useState(first);
  return value;
}
function useInner(first: number = 1): number {
  const [value] = useState(first);
  return value;
}
export { useInner as useOuter, thing };
console.log(info.useBeside, info.useMain, useBeside(), useMain(), useInner(), thing());
`,
    });
    expect(parametersIn(typed)).toEqual({
      useState: "initial: T",
      useThing: "t0?: number",
      useBeside: "t0?: number, t1?: number",
      useMain: "t0?: number",
      useInner: "t0?: number",
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
export function useRequired(first: number = 1, second: typeof first): string {
  const [value] = useState(first);
  return (value + second).toFixed(1);
}
export function useQueried(first: number = 1, point: [number, number] = [0, 0]): number {
  const [seen] = useState(first);
  const origin: typeof point = [seen, seen];
  return take(origin) + point[0];
}
export function useTyped(first: number = 1): number {
  const [value] = useState(first);
  return value;
}
export const useAlike: typeof useTyped = (first: number = 1) => {
  const [value] = useState(first);
  return value + 1;
};
`;
  // `typeof first` is the type of `first` with its default value, which has no `undefined`. A parameter with a `?` has.
  // Main writes the typed file of this build too: only `useBeside` has other parameters there.
  test("stays as the output has it in a function with a `typeof` of it, or of its parameter", async () => {
    const typed = await typedFile({ "src/index.tsx": queried + useBeside });
    expect(typed).toContain("const useAlike: typeof useTyped = (t0: number) => {");
    expect(parametersIn(typed)).toEqual({
      useState: "initial: T",
      take: "point: [number, number]",
      useSigned: "t0: number, t1: typeof t0",
      useRequired: "t0: number, second: typeof t0",
      useQueried: "t0: number, t1: [number, number]",
      useTyped: "t0: number",
      useBeside: "t0?: number, t1?: number",
    });
  });

  // Now, as on main: the typed files are left out, "TS2554: Expected 2 arguments, but got 0."
  test.todo("can be left out of a function with a `typeof` of it", async () => {
    const typed = await typedFile({ "src/index.tsx": queried + "console.log(useSigned(), useQueried());\n" });
    expect(parametersIn(typed)).toMatchObject({ useSigned: expect.stringMatching(/^t0\?: number, t1\?: /) });
  });

  const callees = `function pick<T>(make: (label: string, seed: T) => T, seed: T): T {
  return make("a", seed);
}
function pick3<T>(make: (seed: T, label: string, extra: number) => T, seed: T): T {
  return make(seed, "a", 0);
}
interface Counter {
  count: number;
}
function useReducer<S, A>(reducer: (state: S, action: A) => S, initial: S): S {
  return initial;
}
function useReduced<S, R extends (state: S, action: string) => S>(reducer: R): [S, (action: string) => void] {
  return [reducer(undefined as S, "init"), () => {}];
}
function keepT<F extends (x: T, y: string) => void, T>(visit: F): T[] {
  return [];
}
function run(task: () => number): number {
  return task();
}
`;
  // TypeScript infers type arguments from the type of a function that is a value, and from an annotated parameter of
  // a callback, where a default value adds no `undefined` and a `?` does. So only a function that a build calls by its
  // name takes the `?`. Main writes the typed file of this build too: only `useBeside` has other parameters there.
  test("stays as the output has it in a function that is a value", async () => {
    const typed = await typedFile({
      "src/index.tsx": `import { useState } from "./state";
${callees}
export function useTotal(items: string[]) {
  const [n] = useState(items.length);
  return items.reduce((total: number = 0, item) => total + item.length + n, 0);
}
export function useLengths(items: string[]) {
  const [n] = useState(items.length);
  return items.reduce((total: number = 0, item) => total + item.length, 0) + n;
}
export function useSizes(items: Array<{ size: number }>) {
  const [n] = useState(items.length);
  return items.reduce((total: number = 0, { size }: { size: number }) => total + size + n, 0);
}
export function useSum(items: Array<{ size: number }>) {
  const [n] = useState(items.length);
  const add = (total: number = 0, { size }: { size: number }) => total + size + n;
  return items.reduce(add, 0);
}
export function usePicked(start: number) {
  const [n] = useState(start);
  return pick((label, seed: number = 1) => seed + n + label.length, n);
}
export function usePickedFirst(start: number) {
  const [n] = useState(start);
  return pick3((seed: number = 1, label: string) => seed + n + label.length, n);
}
export function useCounter(start: number) {
  const [n] = useState(start);
  return useReducer((state: Counter = { count: 0 }) => ({ count: state.count + n }), { count: n });
}
export function useCount(step: number) {
  const [n] = useState(step);
  const [count] = useReduced((state: number = 0, action) => state + n + action.length);
  return count * 2;
}
export function useSeen(start: number) {
  const [n] = useState(start);
  return keepT((x: number = 1, y) => void (x + y.length + n));
}
export function useStep(base: number) {
  const [n] = useState(base);
  let step = (by: number = 1) => n + by;
  if (n > 10) {
    step = (by: number = 2) => n - by;
  }
  return step(1);
}
${useBeside}`,
    });
    expect(typed).toContain("return items.reduce((t0: number, item) => {");
    expect(typed).toMatch(/^function _temp\(t0: number, item(?:: any)?\) \{$/m);
    expect(typed).toContain("return items.reduce((t0: number, t1) => {");
    expect(typed).toMatch(/let add = \(t0: number, t1(?:: any)?\) => \{/);
    expect(typed).toContain("return pick((label, t0: number) => {");
    expect(typed).toContain("return pick3((t0: number, label: string) => {");
    expect(typed).toContain("return useReducer((t0: Counter) => {");
    expect(typed).toContain("let [count] = useReduced((t0: number, action) => {");
    expect(typed).toContain("return keepT((t0: number, y)");
    expect(typed).toContain("let step = (t0: number) => {");
    expect(typed).toContain("step = (t1: number) => {");
    expect(typed).toContain("function useBeside(t0?: number, t1?: number): number {");
  });

  // The bundler gives a function one name in the outputs: `items.reduce(useAdd, 0)` for `import useOther from "./add"`.
  // Main writes the typed file of this build too: only `useBeside` has other parameters there.
  test("stays as the output has it in a function that another module has as a value under another name", async () => {
    const hook = (head: string, tail = "") => `import { useState } from "./state";
${head}(total: number = 0, { size }: { size: number }) {
  const [n] = useState(size);
  return total + n;
}
${tail}`;
    const typed = await typedFile({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { ...JSON.parse(project["tsconfig.json"]).compilerOptions, jsx: "react-jsx", allowJs: true },
      }),
      "package.json": JSON.stringify({ name: "hooks", compilerOptions: { strict: true, jsx: "react-jsx" } }),
      "src/add.tsx": hook("export default function useAdd"),
      "src/scaled.tsx": hook("export function useScaled"),
      "src/spread.tsx": hook("export function useSpread"),
      "src/queried.tsx": hook("export default function useQueried"),
      "src/mapped.tsx": hook("function useMapped", "export default useMapped;\n"),
      "src/held.tsx": hook("function useHeld", "export default useHeld;\n"),
      "src/typed.tsx": hook("function useTyped", "export default useTyped;\n"),
      "src/first.ts": `const alias = 5;\nexport const five = alias + 0;\n`,
      "src/renamed.tsx": hook(
        "export function useRenamed",
        `export const alias = useRenamed;
export function sumRenamed(items: Array<{ size: number }>): number {
  const other: typeof alias = (total = 0, { size }) => total - size;
  return items.reduce(other, 0);
}
`,
      ),
      "src/pick.ts": `export function pick<T>(make: (seed: T, item: { size: number }) => T, seed: T): T {
  return make(seed, { size: 1 });
}
`,
      "src/glue.js": `import { pick } from "./pick";
import { useScaled } from "./scaled";
export const picked = pick(useScaled, 0);
`,
      "src/index.tsx": `import { five } from "./first";
import useOther from "./add";
import { picked } from "./glue.js";
import held from "./held";
import mapped from "./mapped";
import useAlias from "./queried";
import { alias as renamed, sumRenamed } from "./renamed";
import * as spread from "./spread";
import { useState } from "./state";
import typed from "./typed";
const { useSpread: taken } = spread;
export const alias = held;
export { renamed };
export function sum(items: Array<{ size: number }>): number {
  const add: typeof useAlias = (total = 0, { size }) => total + size;
  const other: typeof alias = (total = 0, { size }) => total - size;
  const third: typeof typed = (total = 0, { size }) => total * size;
  const sums = [useOther, taken, add, other, third, mapped].map(each => items.reduce(each, 0));
  const called = useAlias(1, { size: 1 }) + held(1, { size: 1 }) + typed(1, { size: 1 });
  return sums.length + called + picked + sumRenamed(items) + five;
}
${useBeside}`,
    });
    expect(parametersIn(typed)).toMatchObject({
      // `import useOther from "./add"`, then `useOther` as a value.
      useAdd: "t0: number, t1",
      // A JavaScript module gives it to a call.
      useScaled: "t0: number, t1",
      // `const { useSpread: taken } = spread`, for `import * as spread from "./spread"`.
      useSpread: "t0: number, t1",
      // `typeof useAlias`, for `import useAlias from "./queried"`.
      useQueried: "t0: number, t1",
      // `mapped_default` as a value, for `var mapped_default = useMapped`.
      useMapped: "t0: number, t1",
      // `typeof alias`, for `const alias = held_default`.
      useHeld: "t0: number, t1",
      // `typeof typed`, for `import typed from "./typed"`.
      useTyped: "t0: number, t1",
      // `typeof alias`, for `const alias = useRenamed` that the bundler writes as `alias2`.
      useRenamed: "t0: number, t1",
      useBeside: "t0?: number, t1?: number",
    });
  });

  // React's `useCallback` is not in the output: its callback is where the call was, as an argument of `pick`.
  test("stays as the output has it in a callback that the compiler takes out of useCallback", async () => {
    const typed = await typedFile(
      {
        "src/index.tsx": `import { useCallback, useState } from "react";
function pick<T>(make: (label: string, seed: T) => T, seed: T): T {
  return make("a", seed);
}
export function usePicked(start: number) {
  const [n] = useState(start);
  return pick(
    useCallback((label, seed: number = 1) => seed + n + label.length, [n]),
    n,
  );
}
${useBeside}`,
        "node_modules/react/package.json": JSON.stringify({
          name: "react",
          version: "19.0.0",
          exports: { ".": { types: "./index.d.ts", default: "./index.js" } },
        }),
        "node_modules/react/index.js": `export const useState = initial => [initial];\nexport const useCallback = callback => callback;\n`,
        "node_modules/react/index.d.ts": `export declare function useState<T>(initial: T): [T];
export declare function useCallback<T extends Function>(callback: T, deps: readonly unknown[]): T;
`,
      },
      { external: ["react"] },
    );
    expect(typed).toContain("return pick((label, t0: number) => {");
    expect(typed).toContain("function useBeside(t0?: number, t1?: number): number {");
  });

  // Now, as on main: the typed files are left out, "TS2345: Argument of type '(t0: number) => number' is not assignable
  // to parameter of type '() => number'."
  test.todo("can be left out of a callback", async () => {
    const typed = await typedFile({
      "src/index.tsx": `import { useState } from "./state";
${callees}
export function useRun(start: number): number {
  const [n] = useState(start);
  return run((extra: number = 1) => n + extra);
}
`,
    });
    expect(typed).toContain("return run((t0?: number) => {");
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

  test("in a module that is not checked", async () => {
    const typed = await typedFile({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { ...JSON.parse(project["tsconfig.json"]).compilerOptions, jsx: "react-jsx" },
      }),
      "package.json": JSON.stringify({ name: "hooks", compilerOptions: { strict: true, jsx: "react-jsx" } }),
      "src/index.tsx": `export { useLoose } from "./loose";\n`,
      "src/loose.tsx": `// @ts-nocheck
import { useState } from "./state";
export function useLoose(first: number = 1, second: number = 2, third = 3) {
  const [value] = useState(first);
  return value + second + third;
}
`,
    });
    expect(parametersIn(typed)).toEqual({ useState: "initial: T", useLoose: "t0?, t1?, t2?" });
  });

  // The checker has no types of a module that it reaches through node_modules: the rule reads the syntax alone.
  test("in a module of another package of the workspace", async () => {
    using dir = tempDir("build-api-dts-moved-default-workspace", {
      "app/tsconfig.json": JSON.stringify({
        compilerOptions: { ...JSON.parse(project["tsconfig.json"]).compilerOptions, jsx: "react-jsx" },
      }),
      "app/package.json": JSON.stringify({ name: "app", compilerOptions: { strict: true, jsx: "react-jsx" } }),
      "app/src/index.tsx": `import { useTotal } from "hooks";
export function useAll(items: string[]): number {
  return useTotal(items);
}
`,
      "packages/hooks/package.json": JSON.stringify({
        name: "hooks",
        version: "1.0.0",
        exports: { ".": "./index.tsx" },
      }),
      "packages/hooks/index.tsx": `${state}export function useTotal(items: string[], first: number = 1): number {
  const [n] = useState(items.length);
  return items.reduce((total: number = 0, item) => total + item.length + n, first);
}
`,
    });
    const root = String(dir);
    mkdirSync(join(root, "app/node_modules"));
    symlinkSync(join(root, "packages/hooks"), join(root, "app/node_modules/hooks"), "junction");
    const built = await Bun.build({
      entrypoints: [join(root, "app/src/index.tsx")],
      outdir: join(root, "app/out"),
      tsconfig: join(root, "app/tsconfig.json"),
      target: "bun",
      reactCompiler: true,
      dts: true,
    });
    expect(built.logs).toEqual([]);
    const typed = readFileSync(join(root, "app/out/index.aot.ts"), "utf8");
    expect(typed).toContain("return items.reduce((t1: number, item) => {");
    expect(parametersIn(typed)).toEqual({
      useState: "initial: T",
      useTotal: "items: string[], t0?: number",
      useAll: "items: string[]",
    });
  });

  // The rule reads the text that the compiler had, which is not the text on the disk here.
  test("in a module that a plugin changes", async () => {
    const typed = await typedFile(
      {
        "src/index.tsx": `import { useState } from "./state";
export function useSigned(first: number = 1, second: typeof first = 2): number {
  const [value] = useState(first);
  return value + second;
}
${useBeside}`,
      },
      {
        plugins: [
          {
            name: "banner",
            setup(build) {
              build.onLoad({ filter: /index\.tsx$/ }, async ({ path }) => ({
                contents: "// a line that a plugin adds\n" + (await Bun.file(path).text()),
                loader: "tsx",
              }));
            },
          },
        ],
      },
    );
    expect(parametersIn(typed)).toMatchObject({
      useSigned: expect.stringMatching(/^t0: number, t1: typeof /),
      useBeside: "t0?: number, t1?: number",
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

  test("with two entry points, splitting, and a file that import() loads", async () => {
    using dir = tempDir("build-api-dts-moved-default-splitting", {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { ...JSON.parse(project["tsconfig.json"]).compilerOptions, jsx: "react-jsx" },
      }),
      "package.json": JSON.stringify({ name: "hooks", compilerOptions: { strict: true, jsx: "react-jsx" } }),
      "src/state.ts": state,
      "src/hooks.tsx": `import { useState } from "./state";
${useBeside}export function useOther(first: number = 1): number {
  const [value] = useState(first);
  return value;
}
`,
      "src/lazy.tsx": `import { useState } from "./state";
export function useFar(first: number = 1): number {
  const [value] = useState(first);
  return value + useNear();
}
function useNear(first: number = 1): number {
  const [value] = useState(first);
  return value;
}
export default function useLazy(first: number = 1): number {
  const [value] = useState(first);
  return value;
}
`,
      "src/a.tsx": `import { useBeside } from "./hooks";
export function useA(first: number = 1): number {
  return useBeside(first);
}
export async function far(items: number[]): Promise<number[]> {
  const lazy = await import("./lazy");
  return items.map(lazy.useFar).concat(items.map(lazy.default));
}
console.log(useA(), useBeside());
`,
      "src/b.tsx": `import { useBeside, useOther } from "./hooks";
export function useB(start: number = 0, end: number): number {
  return useBeside(start, end);
}
export const hooks = [useOther];
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
      // `import("./lazy")` gives every export of that file as a value.
      { useFar: "t0: number", useNear: "t0?: number", useLazy: "t0: number" },
      // Another file of the build has `useOther` as a value.
      { useState: "initial: T", useBeside: "t0?: number, t1?: number", useOther: "t0: number" },
    ]);
  });

  // Each output has its own copy of `thing.tsx`: what one output reads as a value, the other output does not.
  test("with two entry points that each have a copy of a module", async () => {
    using dir = tempDir("build-api-dts-moved-default-copies", {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { ...JSON.parse(project["tsconfig.json"]).compilerOptions, jsx: "react-jsx" },
      }),
      "package.json": JSON.stringify({ name: "hooks", compilerOptions: { strict: true, jsx: "react-jsx" } }),
      "src/state.ts": state,
      "src/thing.tsx": `import { useState } from "./state";
function useThing(first: number = 1): number {
  const [value] = useState(first);
  return value;
}
export default useThing;
${useBeside}`,
      "src/a.tsx": `import thing, { useBeside } from "./thing";
export const a = thing() + useBeside();
`,
      "src/b.tsx": `import thing, { useBeside } from "./thing";
export const b = thing() + [1].map(useBeside).length;
`,
    });
    const root = String(dir);
    const built = await Bun.build({
      entrypoints: [join(root, "src/a.tsx"), join(root, "src/b.tsx")],
      outdir: join(root, "out"),
      tsconfig: join(root, "tsconfig.json"),
      target: "bun",
      reactCompiler: true,
      dts: true,
    });
    expect(built.logs).toEqual([]);
    const typed = (name: string) => parametersIn(readFileSync(join(root, "out", name), "utf8"));
    expect({ a: typed("a.aot.ts"), b: typed("b.aot.ts") }).toEqual({
      a: { useState: "initial: T", useThing: "t0?: number", useBeside: "t0?: number, t1?: number" },
      b: { useState: "initial: T", useThing: "t0?: number", useBeside: "t0: number, t1: number" },
    });
  });
});
