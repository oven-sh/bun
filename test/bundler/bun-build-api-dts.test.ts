import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
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
// What a build of the project with these files says, its `index.aot.ts`, and what `bun check` says of a project that
// has that file among its own. The build judges the file as a project that installs the package does: it is told less.
async function typedFile(files: Record<string, string>) {
  using dir = tempDir("build-api-dts-typed-file", {
    ...project,
    // Few libraries, and none of them checked: that keeps the check of the one file short.
    "tsconfig.own.json": JSON.stringify({
      extends: "./tsconfig.json",
      compilerOptions: { skipLibCheck: true, lib: ["es2015"] },
      files: ["out/index.aot.ts"],
    }),
    ...files,
  });
  const root = String(dir);
  const built = await Bun.build({
    entrypoints: [join(root, "src/index.ts")],
    outdir: join(root, "out"),
    tsconfig: join(root, "tsconfig.json"),
    dts: true,
  });
  const typed = built.outputs.find(output => output.path.endsWith("index.aot.ts"));
  await using check = Bun.spawn({
    cmd: [bunExe(), "check", "-p", "tsconfig.own.json"],
    cwd: root,
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([check.stdout.text(), check.stderr.text(), check.exited]);
  return { logs: built.logs, typed: await typed?.text(), own: { said: (stdout + stderr).match(/TS\d+/g), exitCode } };
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

  test("a static field with a computed key has no `!`, and a field of an object keeps it", async () => {
    const { logs, typed, own } = await typedFile({
      "src/index.ts": `const key = "computed";
const sym = Symbol("sym");
export class Sizes {
  static [key]: number;
  static readonly [sym]: string;
  static ["lit"]: boolean;
  static [1]: number;
  static [Symbol.toStringTag]: string;
  static plain: number;
  [key]: number;
  size: number;
  constructor(size: number) {
    this[key] = size;
    this.size = size;
  }
}
export const Expression = class {
  static [key]: number;
  [key]: number = 2;
};
`,
    });
    expect(logs).toEqual([]);
    // TypeScript takes no `!` on a static field (TS1255).
    expect(typed).toContain(`class Sizes {
  static [key]: number;
  static readonly [sym]: string;
  static ["lit"]: boolean;
  static [1]: number;
  static [Symbol.toStringTag]: string;
  static plain: number;
  [key]!: number;
  size: number;
  constructor(size: number) {`);
    expect(typed).toContain(`const Expression = class {
  static [key]: number;
  [key]: number = 2;
};`);
    expect(own).toEqual({ said: null, exitCode: 0 });
  });

  test("a field of an object keeps its `!` where the bundle declares its key with var", async () => {
    const { logs, typed, own } = await typedFile({
      "src/key.ts": `export const key = "computed";\n`,
      // The import() makes a module object of key.ts, and the bundle then declares its constants with var.
      "src/index.ts": `import { key } from "./key";
export class Counter {
  static [key]: number;
  [key]: number;
  constructor(start: number) {
    this[key] = start;
  }
  get count(): number {
    return this[key];
  }
}
export const lazy = () => import("./key");
`,
    });
    expect(logs).toEqual([]);
    expect(typed).toMatch(/^var key\b/m);
    expect(typed).toContain(`class Counter {
  static [key]: number;
  [key]!: number;
  constructor(start: number) {`);
    // Through a var, TypeScript does not see that the constructor stores to the field: without the `!` this is TS2564.
    expect(own).toEqual({ said: null, exitCode: 0 });
  });

  // Under these options the bundle has no field for a field without a value. The package.json states them too.
  const withoutFields = (more: Record<string, boolean> = {}) => {
    const compilerOptions = { strict: true, useDefineForClassFields: false };
    const written = JSON.parse(project["tsconfig.json"]).compilerOptions;
    return {
      "tsconfig.json": JSON.stringify({ compilerOptions: { ...written, ...compilerOptions, ...more } }),
      "package.json": JSON.stringify({ name: "shapes", version: "1.0.0", compilerOptions }),
    };
  };

  test("a field that is written as a declaration has no `!`", async () => {
    const { logs, typed, own } = await typedFile({
      ...withoutFields(),
      "src/index.ts": `export class Shape {
  late!: number;
  protected readonly name!: string;
  ["lit"]!: number;
  spaced /* kept */ !: number;
  size: number;
  constructor(size: number) {
    this.size = size;
    this.measure();
  }
  measure(): void {
    this.late = this.size * 2;
  }
}
`,
    });
    expect(logs).toEqual([]);
    // A declaration takes no `!` (TS1255).
    expect(typed).toContain(`class Shape {
  declare late: number;
  declare protected readonly name: string;
  declare ["lit"]: number;
  declare spaced /* kept */ : number;
  declare size: number;
  constructor(size: number) {`);
    expect(own).toEqual({ said: null, exitCode: 0 });
  });

  // Both declarations are written with `override`, which `declare` does not take (TS1243). Once the file type checks
  // this test fails: change `test.failing` to `test`.
  test.failing("a member with override that is written as a declaration type checks", async () => {
    const { logs, own } = await typedFile({
      ...withoutFields({ noImplicitOverride: true }),
      "src/index.ts": `export class Base {
  label: string = "base";
  constructor(readonly id: number) {}
}
export class Shape extends Base {
  override label: string;
  constructor(
    public override readonly id: number,
    size: number,
  ) {
    super(id);
    this.label = "shape" + size;
  }
}
`,
    });
    expect(logs).toEqual([]);
    expect(own).toEqual({ said: null, exitCode: 0 });
  });

  test("cannot be used with compile", () => {
    expect(() => Bun.build({ entrypoints: ["./index.ts"], compile: true, dts: true })).toThrow(
      "dts cannot be used with compile",
    );
  });
});
