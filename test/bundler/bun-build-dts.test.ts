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
});

// `index.aot.ts` is `index.js` with the types of the sources put back. An annotation belongs to one binding and a cast to
// one value. Each test here builds many shapes at once and reads where the build wrote each of them.
describe.concurrent("bun build --dts: an annotation or a cast stays where it was written", () => {
  const base = { "tsconfig.json": project["tsconfig.json"], "package.json": project["package.json"] };
  const withoutSpaces = (text: string) => text.replace(/\s+/g, "");
  // The files of a build that wrote every file, and said nothing.
  async function built(dir: unknown, entry: string, ...flags: string[]) {
    const result = await bun(String(dir), "build", entry, "--outdir", "out", "--dts", ...flags);
    expect({ stderr: result.stderr, exitCode: result.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const read = (name: string) => readFileSync(join(String(dir), "out", name), "utf8");
    return { typed: read("index.aot.ts"), javascript: read("index.js") };
  }
  // The parts of `expected` that `typed` does not have. Spaces and line breaks do not count: the flags move them.
  const missingIn = (typed: string, expected: string[]) =>
    expected.filter(part => !withoutSpaces(typed).includes(withoutSpaces(part)));

  // The printer can write `const a = row.id, b = row.name` as `const { id: a, name: b } = row`. A pattern has one place
  // for an annotation and its value has one place for a cast, so a build with --dts keeps the declarators.
  test.each([
    ["no other flag", []],
    ["--minify-syntax", ["--minify-syntax"]],
    ["--minify-syntax --minify-whitespace", ["--minify-syntax", "--minify-whitespace"]],
  ])("declarators that read one object keep their own annotations and casts: %s", async (_, flags) => {
    using dir = tempDir("build-dts-declarators", {
      ...base,
      "src/index.ts": `type Row = { id: number; name: string; extra: unknown };
export function oneStatement(row: Row): string {
  const a: number = row.id, b: string = row.name;
  return b + a;
}
export function twoStatements(row: Row): string {
  const c: number = row.id;
  const d: string = row.name;
  return d + c;
}
export function forHead(row: Row): number {
  let total = 0;
  for (let from: number = row.id, label: string = row.name; from < label.length; from++) total += from;
  return total;
}
export function cast(row: Row): number {
  const first = row.extra as { size: number }, second = row.id;
  return first.size + second;
}
export function notNull(ring: { read?: number; write?: number }): number {
  const read = ring.read!;
  const write = ring.write!;
  return read + write;
}
export function widerThanItsValue(row: Row): number | string {
  let wide: number | string = row.id, narrow: string = row.name;
  wide = narrow;
  return wide;
}
export function typeOfEachMember(keys: { left: "l"; right: "r" }): string {
  const left: typeof keys.left = keys.left, right: typeof keys.right = keys.right;
  return left + right;
}
`,
    });
    const { typed, javascript } = await built(dir, "./src/index.ts", "--target=bun", ...flags);
    expect(
      missingIn(typed, [
        "a: number = row.id",
        "b: string = row.name",
        "c: number = row.id",
        "d: string = row.name",
        "from: number = row.id",
        "label: string = row.name",
        "first = row.extra as { size: number }",
        "second = row.id",
        "read = ring.read!",
        "write = ring.write!",
        "wide: number | string = row.id",
        "narrow: string = row.name",
        "left: typeof keys.left = keys.left",
        "right: typeof keys.right = keys.right",
      ]),
    ).toEqual([]);
    const code = (text: string, loader: "ts" | "js") =>
      withoutSpaces(new Bun.Transpiler({ loader, target: "node" }).transformSync(text).replace(/\/\/.*$/gm, ""));
    expect(code(typed, "ts")).toBe(code(javascript, "js"));
  });

  // The React Compiler declares a binding again in another shape: `{ mode = "x" }: T` becomes `{ mode: t1 }: T` and a
  // variable `mode`, `[[inner]]: T` becomes `[t1]: T` and `[inner]`, and a memo block declares a name ahead of its value.
  // --target=browser is the mode that memoizes. `react/compiler-runtime` is a stand-in for the package.
  test.each([
    ["--target=bun", []],
    ["--target=bun", ["--minify-syntax"]],
    ["--target=browser", []],
    ["--target=browser", ["--minify-syntax"]],
  ])(
    "what the React Compiler declares again has the annotation and the cast of its own shape: %s %j",
    async (target, flags) => {
      using dir = tempDir("build-dts-react-compiler", {
        ...base,
        "node_modules/react/package.json": JSON.stringify({
          name: "react",
          version: "19.0.0",
          exports: { "./compiler-runtime": { types: "./compiler-runtime.d.ts", default: "./compiler-runtime.js" } },
        }),
        "node_modules/react/compiler-runtime.d.ts": `export function c(size: number): any[];\n`,
        "node_modules/react/compiler-runtime.js": `export function c(size) {
  return new Array(size).fill(Symbol.for("react.memo_cache_sentinel"));
}
`,
        "src/state.ts": `export function useState<T>(initial: T): [T] {
  return [initial];
}
`,
        "src/index.tsx": `import { useState } from "./state";
declare function parse(text: string): unknown;
declare function make(n: number): unknown;
declare function compute(n: number): { rows: number[]; label: string };
interface Props {
  title?: string;
  size?: number;
}
export function useMode({ mode = "x" }: { mode?: "x" | "y" }): "x" | "y" {
  const [held] = useState(0);
  return held ? mode : mode;
}
export function Card({ title = "t", size = 1 }: Props): string {
  const [held] = useState(0);
  return held ? title + size : title;
}
export function useFirst([first = 1]: [number?]): number {
  const [held] = useState(0);
  return held ? first : first + 1;
}
export function useBody(props: { mode?: "x" | "y" }): "x" | "y" {
  const [held] = useState(0);
  const { mode = "x" }: { mode?: "x" | "y" } = props;
  return held ? mode : mode;
}
export function useNested([[inner]]: [[number]]): number {
  const [held] = useState(0);
  return held ? inner : inner + 1;
}
export function useRenamed({ a: { b: renamed } }: { a: { b: number } }): number {
  const [held] = useState(0);
  return held ? renamed : renamed + 1;
}
export function useKept(props: { point: { x: number; y: number } }): number {
  const [held] = useState(0);
  const { x: left, y: top }: { x: number; y: number } = props.point;
  return held ? left : top;
}
export function useSplit(props: { text: string }): number {
  const [held] = useState(0);
  const [[part]] = parse(props.text) as [[number]];
  return held ? part : part + 1;
}
export function useRows(props: { n: number }): [number[], string] {
  const [held] = useState(0);
  const { rows, label }: { rows: number[]; label: string } = compute(props.n + held);
  rows.push(1);
  return [rows, label];
}
export function useList(props: { n: number }): number[] {
  const [held] = useState(0);
  const list = make(props.n + held) as number[];
  list.push(1);
  return list;
}
export function useParts(props: { n: number }): [number[], string] {
  const [held] = useState(0);
  const { rows: kept, label: text } = make(props.n + held) as { rows: number[]; label: string };
  kept.push(1);
  return [kept, text];
}
export function usePair(props: { n: number }): [number[], string] {
  const [held] = useState(0);
  const [items, name] = make(props.n + held) as [number[], string];
  items.push(1);
  return [items, name];
}
`,
      });
      const { typed } = await built(dir, "./src/index.tsx", target, "--react-compiler", ...flags);
      const undefinedAsPrinted = flags.includes("--minify-syntax") ? "void 0" : "undefined";
      const memoizes = target === "--target=browser";
      expect(
        missingIn(typed, [
          // A default value inside a pattern: the pattern keeps the annotation, the variable of the default has none.
          `{ mode: t1 }: { mode?: "x" | "y" } = t0`,
          `mode = t1 === ${undefinedAsPrinted} ? "x" : t1`,
          `{ title: t1, size: t2 }: Props = t0`,
          `title = t1 === ${undefinedAsPrinted} ? "t" : t1`,
          `size = t2 === ${undefinedAsPrinted} ? 1 : t2`,
          `[t1]: [number?] = t0`,
          `first = t1 === ${undefinedAsPrinted} ? 1 : t1`,
          `{ mode: t0 }: { mode?: "x" | "y" } = props`,
          `mode = t0 === ${undefinedAsPrinted} ? "x" : t0`,
          // A pattern inside a pattern is declared in two steps: the first has the annotation, the second has none.
          `[t1]: [[number]] = t0`,
          `[inner] = t1`,
          `{ a: t1 }: { a: { b: number } } = t0`,
          `{ b: renamed } = t1`,
          // A pattern that the compiler keeps.
          `{ x: left, y: top }: { x: number; y: number } = props.point`,
          // The cast on the value of such a pattern is in the first step, on that value.
          ...(memoizes
            ? [`[t1] = t0 as [[number]]`, `[part] = t1;`]
            : [`[t0] = parse(props.text) as [[number]]`, `[part] = t0;`]),
          // A memo block declares the names ahead of the pattern that assigns them.
          ...(memoizes ? [`label, rows;`] : []),
          // A memo block assigns the name in a statement. The cast is on the value, not around the statement.
          `list = make(props.n + held) as number[]`,
          // A memo block assigns a pattern in a statement too.
          `{ rows: kept, label: text } = make(props.n + held) as { rows: number[]; label: string }`,
          `[items, name] = make(props.n + held) as [number[], string]`,
        ]),
      ).toEqual([]);
    },
  );

  // A module that `import()` loads is wrapped: its names are declared ahead of the code that assigns them.
  test.each([
    ["no other flag", []],
    ["--minify-syntax", ["--minify-syntax"]],
  ])(
    "a name that a wrapped module declares ahead of its pattern does not take the annotation of the pattern: %s",
    async (_, flags) => {
      using dir = tempDir("build-dts-wrapped-module", {
        ...base,
        "src/index.ts": `export async function load(): Promise<string> {
  const lazy = await import("./lazy");
  return lazy.b + lazy.a + lazy.second + lazy.first + lazy.copy.id + lazy.read() + lazy.local.a + lazy.f + lazy.e + lazy.default.size;
}
`,
        "src/lazy.ts": `interface Config {
  id: number;
}
const source: { a: number; b: string } = { a: 1, b: "x" };
export const { a, b }: { a: number; b: string } = source;
const pair: [number, string] = [1, "x"];
export const [first, second]: [number, string] = pair;
const config: Config = { id: 1 };
export const { ...copy }: Config = config;
{
  var { c, d }: { c: number; d: string } = { c: 1, d: "x" };
}
export function read(): string {
  return d + c;
}
const raw: unknown = JSON.parse("{}");
export const local = (true ? raw : raw) as { a: number };
export const { e, f } = (true ? raw : raw) as { e: number; f: string };
const seed: number = Math.random();
export default new Map([["a", seed]]) as Map<string, number | undefined>;
`,
      });
      const { typed } = await built(dir, "./src/index.ts", "--target=bun", ...flags);
      // The type check of the typed file gives `any` to a name that a function reads. That is a later step, so it is not
      // a part of what this test reads.
      expect(typed.replaceAll(": any", "")).toContain(
        "var source: { a: number; b: string }, a, b, pair: [number, string], first, second, config: Config, copy, c, d, raw: unknown, local, e, f, seed: number, lazy_default;",
      );
      // The output assigns each value in a statement. The cast is on the value, not around the statement.
      expect(
        missingIn(typed, [
          "local = raw as { a: number }",
          "{ e, f } = raw as { e: number; f: string }",
          `new Map([["a", seed]]) as Map<string, number | undefined>;`,
        ]),
      ).toEqual([]);
    },
  );

  // Guards: the output has each binding in the shape of the source, so each keeps its annotation and its cast.
  // The build folds `true ? row : row` to `row`, so each of those values is found only through its declaration.
  test.each([
    ["no other flag", []],
    ["--minify-syntax", ["--minify-syntax"]],
  ])("a binding that the output has as the source has it keeps its annotation and its cast: %s", async (_, flags) => {
    using dir = tempDir("build-dts-kept-bindings", {
      ...base,
      "src/index.ts": `interface Config {
  id: number;
  name: string;
}
enum Unit {
  Px,
  Em,
}
export function kept({ id, name }: Config, [[deep]]: [[number]]): string {
  const { ...copy }: Config = { id, name };
  const [first, { inner }]: [number, { inner: string }] = [deep, { inner: name }];
  return copy.name + first + inner;
}
export function sameShape(row: unknown, pair: unknown): number {
  const ident = (true ? row : row) as { id: number };
  const { first, second } = (true ? pair : pair) as { first: number; second: number };
  return ident.id + first + second;
}
export function widened(): Unit {
  let unit = Unit.Px;
  if (Math.random() > 0.5) unit = Unit.Em;
  return unit;
}
const value: unknown = JSON.parse("{}");
export default value as { id: number };
`,
    });
    const { typed } = await built(dir, "./src/index.ts", "--target=bun", ...flags);
    expect(
      missingIn(typed, [
        "function kept({ id, name }: Config, [[deep]]: [[number]]): string {",
        "{ ...copy }: Config = { id, name }",
        "[first, { inner }]: [number, { inner: string }] = [deep, { inner: name }]",
        "ident = row as { id: number }",
        "{ first, second } = pair as { first: number; second: number }",
        "var src_default = value as { id: number };",
      ]),
    ).toEqual([]);
    expect(typed).toMatch(/^  let unit: Unit\d* = 0 as Unit\d*\.Px /m);
  });
});
