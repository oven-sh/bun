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
  const state = `export function useState<T>(initial: T): [T] {\n  return [initial];\n}\n`;
  const hooks = `import { useState } from "./state";
export enum Unit {
  Px,
  Em,
}
export function useBoth(first: number = 1, second: number = 2): number {
  const [value] = useState(first);
  return value + second;
}
export function useStep(first: number = 1, step = 2): number {
  const [value] = useState(first);
  return value + step;
}
export function useRange(first: number = 1, start: number = 0, end: number): number {
  const [value] = useState(first);
  return value + start + end;
}
export function useFormat(first: number = 1, format: (value: number) => string = String, value: number): string {
  const [text] = useState(format(value + first));
  return text;
}
export function useName(first: number = 1, { name }: { name: string } = { name: "x" }, suffix: string = "!"): string {
  const [value] = useState(name);
  return value + suffix + first;
}
export function usePoint(first: number = 1, point: [number, number] = [0, 0]): [number, number] {
  const [value] = useState(point);
  return [value[0] + first, value[1]];
}
export function useUnit(first: number = 1, unit = Unit.Px): string {
  const [value] = useState(first);
  return value + Unit[unit];
}
export function usePadded(first: number = 1, unit = Unit.Em, pad = 2, text: string): string {
  const [value] = useState(text);
  return value.padStart(pad + first) + Unit[unit];
}
export function useNested(base: number): number {
  const [value] = useState(base);
  const add = (first: number = 0, right: number = 1): number => first + right;
  return add(value);
}
function pad(value: string): string;
function pad(value: number): number;
function pad(value: any): any {
  return value;
}
type Step = (base: number, scale?: number, by?: number) => number;
export function useStepper(n: number): Step {
  const [value] = useState(n);
  const step: Step = (base, scale = 1, by = value) => {
    const next: number = pad(by);
    return base * scale + next;
  };
  return step;
}
export function useLabel(label: string, size?: number): string {
  const [value] = useState(label);
  return value + (size ?? 0);
}
export function plain(first: number = 1, second: number = 2): number {
  return first + second;
}
`;
  // What the sources accept. With these in the bundle, a typed file that asks for more is left out with a warning.
  const calls = `console.log(useBoth(), useBoth(5), useStep(), useRange(undefined, undefined, 5), useFormat(undefined, undefined, 1));
console.log(useName(), usePoint(), useUnit(), usePadded(undefined, undefined, undefined, "a"), useNested(1));
console.log(useStepper(2)(1), useStepper(2)(1, 2, 3), useLabel("a"), plain());
`;
  // The parameters of each function, from the second one on where the first one is the compiler's. The first default
  // value of a list is where the `length` of the function ends, and how the compiler prints it is not the subject here.
  // Nor is the `: any` that the check of the typed files writes behind a parameter that has no type.
  const parametersIn = (typed: string) =>
    Object.fromEntries(
      Array.from(typed.matchAll(/^function (\w+)(?:<[^>]*>)?\((.*)\)(?:: [^{\n]+)? \{$/gm), ([, name, list]) => [
        name,
        list.replace(/^t0[^,]*, /, "").replaceAll("?: any", "?"),
      ]),
    );
  const build = (root: string, options: Partial<Bun.BuildConfig> = {}) =>
    Bun.build({
      entrypoints: [join(root, "src/index.tsx")],
      outdir: join(root, "out"),
      tsconfig: join(root, "tsconfig.json"),
      target: "bun",
      reactCompiler: true,
      dts: true,
      ...options,
    });

  const parameters = {
    useState: "initial: T",
    _temp: "t1?: number",
    useBoth: "t1?: number",
    // The type checker says what `step = 2` is.
    useStep: "t1?: number",
    // A `?` before a parameter that has to be passed is an error.
    useRange: "t1: number | undefined, end: number",
    useFormat: "t1: ((value: number) => string) | undefined, value: number",
    // The annotation of a pattern is where the pattern is.
    useName: "t1?, t2?: string",
    usePoint: "t1?: [number, number]",
    // `Unit.Px` is `0` in the bundle, and the parameter has the type of the enum.
    useUnit: expect.stringMatching(/^t1\?: Unit\d*$/),
    usePadded: expect.stringMatching(/^t1: Unit\d* \| undefined, t2: number \| undefined, text: string$/),
    useNested: "base: number",
    pad: "value: any",
    useStepper: "n: number",
    useLabel: "label: string, size?: number",
    // What the compiler leaves as it is written keeps its default values.
    plain: "first: number = 1, second: number = 2",
  };

  test.each([
    ["a call in the bundle that leaves it out", calls],
    ["no call in the bundle", ""],
  ])("can be left out, and keeps its type: %s", async (_, calls) => {
    using dir = tempDir("build-api-dts-moved-default", {
      "tsconfig.json": project["tsconfig.json"],
      "src/state.ts": state,
      "src/index.tsx": hooks + calls,
    });
    const root = String(dir);
    const built = await build(root);
    expect(built.logs).toEqual([]);
    const typed = readFileSync(join(root, "out/index.aot.ts"), "utf8");
    expect(parametersIn(typed)).toEqual(parameters);
    // The default value has its type from the annotation.
    expect(typed).toContain("let point: [number, number] = t1 === undefined ? [");
    // Without an annotation, a callback takes the type of its parameter from where it is passed to.
    expect(typed).toMatch(/let step: Step = \(base, t0[^,]*, t1\?\) => \{/);
  });

  test("in a module that is not checked", async () => {
    using dir = tempDir("build-api-dts-moved-default-unchecked", {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { ...JSON.parse(project["tsconfig.json"]).compilerOptions, allowJs: true, jsx: "react-jsx" },
      }),
      "package.json": JSON.stringify({ name: "hooks", compilerOptions: { strict: true, jsx: "react-jsx" } }),
      "src/state.ts": state,
      "src/index.tsx": `export { useLoose } from "./loose";\nexport { plainJs, useJs } from "./hooks.js";\n`,
      "src/loose.tsx": `// @ts-nocheck
import { useState } from "./state";
export function useLoose(first: number = 1, second: number = 2, third = 3) {
  const [value] = useState(first);
  return value + second + third;
}
`,
      "src/hooks.js": `import { useState } from "./state";
export function useJs(first = 1, { second } = { second: 2 }, third = 3) {
  const [value] = useState(first);
  return value + second + third;
}
export function plainJs(first, second) {
  return first + second;
}
`,
    });
    const root = String(dir);
    const built = await build(root);
    expect(built.logs).toEqual([]);
    expect(parametersIn(readFileSync(join(root, "out/index.aot.ts"), "utf8"))).toEqual({
      useState: "initial: T",
      useLoose: "t1?, t2?",
      useJs: "t1?, t2?",
      plainJs: "first, second",
    });
  });

  test("in the output for a browser, which keeps what a function computes from one call to the next", async () => {
    using dir = tempDir("build-api-dts-moved-default-client", {
      "tsconfig.json": project["tsconfig.json"],
      "src/index.tsx": `import { useState } from "react";
export function usePoint(first: number = 1, point: [number, number] = [0, 0], scale = 2): number {
  const [value] = useState(point);
  return (value[0] + value[1]) * scale + first;
}
console.log(usePoint(), usePoint(1, [1, 2]), usePoint(1, [1, 2], 3));
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
    });
    const root = String(dir);
    const built = await build(root, { target: "browser", external: ["react", "react/*"] });
    expect(built.logs).toEqual([]);
    const typed = readFileSync(join(root, "out/index.aot.ts"), "utf8");
    expect(typed).toContain(`import { c as _c } from "react/compiler-runtime";`);
    expect(parametersIn(typed)).toEqual({ usePoint: "t1?: [number, number], t2?: number" });
  });

  test("with minify.syntax, which puts the variables of a function into one statement", async () => {
    using dir = tempDir("build-api-dts-moved-default-minify", {
      "tsconfig.json": project["tsconfig.json"],
      "src/state.ts": state,
      "src/index.tsx": hooks + calls,
    });
    const root = String(dir);
    const built = await build(root, { minify: { syntax: true } });
    expect(built.logs).toEqual([]);
    const typed = readFileSync(join(root, "out/index.aot.ts"), "utf8");
    expect(parametersIn(typed)).toEqual(parameters);
    expect(typed).toContain(", second: number = t1 === void 0 ? 2 : t1,");
  });
});
