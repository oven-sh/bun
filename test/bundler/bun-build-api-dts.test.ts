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
  // does, so a place without an annotation takes `: Unit`. Under an `as`, the place has the type of the `as`.
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
const px: Unit.Px = inObject().unit;
const em: Unit.Em = returned();
console.log(paint("blue"), px, em);
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
export function constant(unit = Unit.Em as const): Unit.Em {
  return unit;
}
export function widened(unit = Unit.Px, other = Unit.Px satisfies Unit, third = Unit.Px!) {
  unit = Unit.Em;
  other = Unit.Em;
  third = Unit.Em;
  return [unit, other, third];
}
console.log(useIt(), useIt(1, null), useIt(1, Unit.Em), only(null), new Box().unit, constant(), widened());
`;
    const fromAnotherFile = `import { Color, Unit } from "./enums";\n`;
    // The name of an enum can have a number behind it, and each value has the name of its member in a comment.
    const typedFile = async (files: Record<string, string>, more: Partial<Bun.BuildConfig> = {}) =>
      (await typed(files, { target: "bun", ...options, ...more }))
        .replace(/\b(Unit|Color)\d+/g, "$1")
        .replace(/ \/\* \w+ \*\//g, "");
    const expectVariableAndValues = (text: string) => {
      expect(text).toContain(`current = "red" as Color.Red as string;`);
      // `0 as Unit.Px` is what `Unit.Px as const` is.
      expect(text).toContain("return { unit: 0 as Unit.Px };");
      expect(text).toContain("return 1 as Unit.Em;");
    };
    const expectParametersAndProperty = (text: string) => {
      expect(text).toContain("function useIt(first = 1, unit = 0 as Unit.Px as Unit | null) {");
      expect(text).toContain("function only(unit = 0 as Unit.Px as Unit | null) {");
      expect(text).toContain("  unit = 0 as Unit.Px as Unit | undefined;");
      expect(text).toContain("function constant(unit: Unit.Em = 1 as Unit.Em): Unit.Em {");
      expect(text).toContain(
        "function widened(unit: Unit = 0 as Unit.Px, other: Unit = 0 as Unit.Px satisfies Unit, third: Unit = (0 as Unit.Px)!) {",
      );
    };

    test("in each place, with the enum in the same file", async () => {
      const text = await typedFile({ "src/index.ts": enums + variableAndValues + parametersAndProperty });
      expectVariableAndValues(text);
      expectParametersAndProperty(text);
    });

    test("in a variable, an object and a return, with the enum in another file", async () => {
      expectVariableAndValues(
        await typedFile({ "src/enums.ts": enums, "src/index.ts": fromAnotherFile + variableAndValues }),
      );
    });

    // The React Compiler prints `(unit = Unit.Px)` as `(t0) { let unit = t0 === undefined ? 0 : t0`. The parameter holds
    // no value there, and the enum is the one type that the typed file has for it, with and without an `as`.
    test("in a default value that the React Compiler moves into the function body", async () => {
      const text = await typedFile(
        {
          "src/state.ts": `export function useState<T>(initial: T): [T] {\n  return [initial];\n}\n`,
          "src/index.tsx": `import { useState } from "./state";
${enums}export function useCell(first: number, unit = Unit.Px as Unit | null): string {
  const [value] = useState(first);
  if (unit === null) return value + "none";
  switch (unit) {
    case Unit.Px:
      return value + "px";
    case Unit.Em:
      return value + "em";
  }
}
`,
        },
        { reactCompiler: true },
      );
      expect(text).toContain("function useCell(first: number, t0: Unit): string {");
    });

    // Observed: `function useIt(first = 1, unit = 0) {`, and TS2322 for `unit = null`. The bundle has the value of a
    // member of another file with no source mapping, so the default of a parameter or a property has no place for a cast.
    test.todo("in a parameter and a class property, with the enum in another file", async () => {
      expectParametersAndProperty(
        await typedFile({ "src/enums.ts": enums, "src/index.ts": fromAnotherFile + parametersAndProperty }),
      );
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
export type On = typeof on;
export type Sizes = [typeof big, typeof small, typeof word];
export function pick(flag: Flag): On {
  return flag === "yes";
}
export function sizes(): Sizes {
  return [1e999, -1e999, "a"];
}
`,
    });
    // `Flag` of the other file is `boolean`, and no type is `Infinity`.
    expect(text.match(/^declare const .*$/gm)?.sort()).toEqual([
      "declare const big: number;",
      "declare const on: boolean;",
      "declare const small: number;",
      `declare const word: "a";`,
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
