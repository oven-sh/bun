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
// The typed file of `src/index.ts`, from a build that has nothing to say.
async function typed(files: Record<string, string>, options: Partial<Bun.BuildConfig> = {}) {
  using dir = tempDir("build-api-dts-typed", { "tsconfig.json": project["tsconfig.json"], ...files });
  const root = String(dir);
  const built = await Bun.build({
    entrypoints: [join(root, "src/index.tsx" in files ? "src/index.tsx" : "src/index.ts")],
    outdir: join(root, "out"),
    tsconfig: join(root, "tsconfig.json"),
    dts: true,
    ...options,
  });
  expect(built.logs).toEqual([]);
  return readFileSync(join(root, "out/index.aot.ts"), "utf8");
}

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

  // The bundle has `0` for `Unit.Px`, and the typed file has `0 as Unit.Px`. That does not widen to `Unit` as `Unit.Px`
  // does, so a place without an annotation takes `: Unit`. Under an `as` or an `as const`, the place that holds the
  // value takes nothing: the cast is its type.
  describe.each([
    ["", {}],
    [", with minify.syntax", { minify: { syntax: true } }],
  ])("an enum member under a cast%s", (_, options) => {
    const enums = `export enum Unit {
  Px,
  Em,
}
export enum Color {
  Red = "red",
}
`;
    // `same` is checked in the sources and in the typed file: each place has the type that the sources give it.
    const sameType = `type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;\n`;
    const variableAndValues = `let current = Color.Red as string;
export function paint(color: string): string {
  current = color;
  return current;
}
export function inObject() {
  return { unit: Unit.Px as const };
}
export function returned() {
  return Unit.Em as const;
}
let count = Unit.Px as number;
let member = Unit.Px as Unit;
let both = Unit.Px as Unit | null satisfies Unit | null;
let late = Unit.Px satisfies Unit as Unit | null;
let fixed = Unit.Px as const satisfies Unit;
let wide = Unit.Px as const as Unit | null;
export function next(): number {
  count = 7;
  member = Unit.Em;
  both = late = wide = null;
  return count + member + fixed;
}
export const sameValues: [
  Same<typeof current, string>,
  Same<ReturnType<typeof inObject>, { unit: Unit.Px }>,
  Same<ReturnType<typeof returned>, Unit.Em>,
  Same<typeof count, number>,
  Same<typeof member, Unit>,
  Same<[typeof both, typeof late, typeof wide], [Unit | null, Unit | null, Unit | null]>,
  Same<typeof fixed, Unit.Px>,
] = [true, true, true, true, true, true, true];
console.log(paint("blue"), next());
`;
    const parametersAndProperty = `export function useIt(first = 1, unit = Unit.Px as Unit | null) {
  unit = null;
  return [first, unit];
}
export function only(unit = Unit.Px as Unit | null) {
  return unit;
}
export class Box {
  unit = Unit.Px as Unit | undefined;
  clear(): void {
    this.unit = undefined;
  }
}
export class Rows {
  accessor id = 0;
  unit = Unit.Px as Unit | null;
}
export function constant(unit = Unit.Em as const): Unit.Em {
  return unit;
}
type Handler = (unit?: Unit) => Unit;
export const handle: Handler = (unit = Unit.Px as const) => unit;
export function widened(unit = Unit.Px, other = Unit.Px satisfies Unit, third = Unit.Px!) {
  unit = Unit.Em;
  other = Unit.Em;
  third = Unit.Em;
  return [unit, other, third];
}
export const sameParameters: [
  Same<Parameters<typeof useIt>, [first?: number, unit?: Unit | null]>,
  Same<Parameters<typeof only>, [unit?: Unit | null]>,
  Same<Box["unit"], Unit | undefined>,
  Same<Rows["unit"], Unit | null>,
  Same<Parameters<typeof constant>, [unit?: Unit.Em]>,
  Same<Parameters<typeof widened>, [unit?: Unit, other?: Unit, third?: Unit]>,
] = [true, true, true, true, true, true];
console.log(useIt(), useIt(1, null), useIt(1, Unit.Em), only(null), new Box().unit, new Rows().unit, constant(), handle(), widened());
`;
    const fromAnotherFile = `import { Color, Unit } from "./enums";\n`;
    // The name of an enum can have a number behind it, and each value has the name of its member in a comment.
    const typedFile = async (files: Record<string, string>, more: Partial<Bun.BuildConfig> = {}) =>
      (await typed(files, { target: "bun", ...options, ...more }))
        .replace(/\b(Unit|Color)\d+/g, "$1")
        .replace(/ \/\* \w+ \*\//g, "");
    const expectVariableAndValues = (text: string) => {
      expect(text).toContain(`current = "red" as Color.Red as string`);
      // `0 as Unit.Px` is what `Unit.Px as const` is.
      expect(text).toContain("return { unit: 0 as Unit.Px };");
      expect(text).toContain("return 1 as Unit.Em;");
      // Main keeps the typed file for these two, with `: Unit` on each.
      expect(text).toContain("count = 0 as Unit.Px as number");
      expect(text).toContain("member = 0 as Unit.Px as Unit");
      // Each cast of a value counts, in each order.
      expect(text).toContain("both = 0 as Unit.Px as Unit | null satisfies Unit | null");
      expect(text).toContain("late = 0 as Unit.Px satisfies Unit as Unit | null");
      expect(text).toContain("fixed = 0 as Unit.Px satisfies Unit");
      expect(text).toContain("wide = 0 as Unit.Px as Unit | null");
    };
    const expectParametersAndProperty = (text: string) => {
      expect(text).toContain("function useIt(first = 1, unit = 0 as Unit.Px as Unit | null) {");
      expect(text).toContain("function only(unit = 0 as Unit.Px as Unit | null) {");
      expect(text).toContain("  unit = 0 as Unit.Px as Unit | undefined;");
      // A field behind an `accessor` holds its value at the end of a `(first, value)`.
      expect(text).toContain("  unit = (__privateAdd(this, _id, 0), 0 as Unit.Px as Unit | null);");
      expect(text).toContain("function constant(unit = 1 as Unit.Em): Unit.Em {");
      // A callback has the type of its parameter from where it is passed to. An annotation would replace that type.
      expect(text).toContain("handle: Handler = (unit = 0 as Unit.Px) => unit");
      expect(text).toContain(
        "function widened(unit: Unit = 0 as Unit.Px, other: Unit = 0 as Unit.Px satisfies Unit, third: Unit = (0 as Unit.Px)!) {",
      );
    };

    test("in each place, with the enum in the same file", async () => {
      const text = await typedFile({
        "src/index.ts": enums + sameType + variableAndValues + parametersAndProperty,
      });
      expectVariableAndValues(text);
      expectParametersAndProperty(text);
    });

    test("in a variable, an object and a return, with the enum in another file", async () => {
      expectVariableAndValues(
        await typedFile({ "src/enums.ts": enums, "src/index.ts": fromAnotherFile + sameType + variableAndValues }),
      );
    });

    // The React Compiler prints `(unit = Unit.Px)` as `(t0) { let unit = t0 === undefined ? 0 : t0`. The parameter holds
    // no value there, and the typed file has no other type for it than the enum, as before: an `as` does not apply.
    test("in a default value that the React Compiler moves into the function body", async () => {
      const text = await typedFile(
        {
          "src/state.ts": `export function useState<T>(initial: T): [T] {\n  return [initial];\n}\n`,
          "src/index.tsx": `import { useState } from "./state";
${enums}export function useCell(first = 1, unit = Unit.Px as Unit | null): string {
  const [value] = useState(first);
  if (unit === null) return value + "none";
  switch (unit) {
    case Unit.Px:
      return value + "px";
    case Unit.Em:
      return value + "em";
  }
}
export function useExact(first: number, exact = Unit.Px as const): Unit.Px {
  const [value] = useState(first);
  return value > 0 ? exact : Unit.Px;
}
`,
        },
        { reactCompiler: true },
      );
      expect(text).toContain("function useCell(");
    });

    // Observed: `function useIt(first = 1, unit = 0) {`, and TS2322 for `unit = null`. The bundle has the value of a
    // member of another file with no source mapping, so the default of a parameter or a property has no place for a cast.
    test.todo("in a parameter and a class property, with the enum in another file", async () => {
      expectParametersAndProperty(
        await typedFile({
          "src/enums.ts": enums,
          "src/index.ts": fromAnotherFile + sameType + parametersAndProperty,
        }),
      );
    });

    // Observed: `return { kind: 0 as Unit.Px, first: 0 as Unit.Px };`, where `first` is a `Unit.Px` and no `Unit`, and
    // TS2322 for `same`. `0 as Unit.Px` does not widen where a type is inferred from it: in an object, an array, a return.
    test.todo("beside a member without a cast, in a place that has no annotation", async () => {
      await typedFile({
        "src/index.ts": `${enums}${sameType}export function pair() {
  return { kind: Unit.Px as const, first: Unit.Px };
}
export const same: Same<ReturnType<typeof pair>, { kind: Unit.Px; first: Unit }> = true;
`,
      });
    });
  });

  // Observed: `(Settings.fixed = 1) as const` and TS1355. The bundle has an assignment for a variable that a namespace
  // exports, and the casts go behind the assignment.
  test.todo("an enum member under `as const` in a variable that a namespace exports", async () => {
    await typed({
      "src/index.ts": `export enum Unit {
  Px,
  Em,
}
export namespace Settings {
  export const fixed = Unit.Em as const;
}
`,
    });
  });

  // A constant that only a type names is not in the bundle. The typed file declares it with what the type checker says.
  test("a constant that only a type names is declared with a type that names nothing", async () => {
    const text = await typed({
      "src/flag.ts": `type Flag = true | false;
declare const stored: Flag;
export const on = stored;
`,
      "src/index.ts": `import { on } from "./flag";
type Flag = "yes" | "no";
const big = 1e999;
const small = -1e999;
const word = "a";
const five = 5;
const ten = 10n;
const yes = true;
export type On = typeof on;
export type Sizes = [typeof big, typeof small, typeof word, typeof five, typeof ten, typeof yes];
export function pick(flag: Flag): On {
  return flag === "yes";
}
export function sizes(): Sizes {
  return [1e999, -1e999, "a", 5, 10n, true];
}
`,
    });
    // `Flag` of the other file is `boolean`, and the bundle has `Infinity` for `1e999`, which is a `number`. Each
    // other literal keeps its type.
    expect(text.match(/^declare const .*$/gm)?.sort()).toEqual([
      "declare const big: number;",
      "declare const five: 5;",
      "declare const on: boolean;",
      "declare const small: number;",
      "declare const ten: 10n;",
      `declare const word: "a";`,
      "declare const yes: true;",
    ]);
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
