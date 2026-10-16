import { describe, expect, test } from "bun:test";
import { createHash } from "crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

const fixtures = join(import.meta.dir, "fixtures", "dts-sound");

function library(name: string, more: Record<string, string> = {}) {
  const dir = tempDir("build-sound-" + name, more);
  cpSync(join(fixtures, name), String(dir), { recursive: true, force: false });
  if (existsSync(join(String(dir), "outside"))) {
    mkdirSync(join(String(dir), "node_modules"));
    renameSync(join(String(dir), "outside"), join(String(dir), "node_modules", "outside"));
  }
  return dir;
}

async function spawned(cmd: string[], cwd: string) {
  await using proc = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}
const build = (cwd: string, ...args: string[]) => spawned([bunExe(), "build", "src/index.ts", "--outdir", "dist", "--target", "bun", "--packages", "external", ...args], cwd);
const text = (...path: string[]) => Bun.file(join(...path)).text();
const withoutTypes = (typescript: string) => new Bun.Transpiler({ loader: "ts" }).transformSync(typescript);

async function install(from: string, into: string, name: string) {
  cpSync(join(from, "dist"), join(into, "node_modules", name, "dist"), { recursive: true });
  cpSync(join(from, "package.json"), join(into, "node_modules", name, "package.json"));
}

const application = {
  "package.json": JSON.stringify({ name: "app" }),
  "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, module: "esnext", moduleResolution: "bundler", target: "esnext", types: [], lib: ["esnext", "dom"] } }),
};

describe("bun build --dts: the typed JavaScript", () => {
  test("writes the bundle with its types kept, and the declaration file points at it", async () => {
    using dir = library("greeter");
    expect(await build(String(dir), "--dts")).toMatchObject({ stderr: "", exitCode: 0 });
    const javascript = await text(String(dir), "dist", "index.js");
    const typed = await text(String(dir), "dist", "index.sound.ts");
    expect((await text(String(dir), "dist", "index.d.ts")).split("\n")[0]).toBe(`// @sound index.sound.ts ${createHash("sha256").update(javascript).digest("hex")}`);
    expect(typed).toContain("function serve<S extends Server>(server: S, ...rest: string[]): string {");
    expect(typed).toContain("class Polite implements Greeter {");
    expect(typed).toContain("  private moods?: Options;");
    expect(typed).toContain("new Map<string, number>");
    expect(typed).toContain("type Options2 = { name: string; loud?: boolean };");
    expect(typed).toContain("export type { Options2 as Options };");
    expect(withoutTypes(typed)).toBe(withoutTypes(javascript));
    expect(readdirSync(join(String(dir), "dist")).sort()).toEqual(["index.d.ts", "index.js", "index.sound.ts"]);
  });

  const kept: [string, string[]][] = [
    [
      "shapes",
      [
        "abstract class Base<T> {",
        "  protected abstract area(): number;",
        "  declare label: string;",
        "  [key: string]: unknown;",
        "  describe(this: Base<T>, extra?: T): string {",
        "class Square extends Base<number> implements Shape {",
        "var make = async <T extends number>(side: T): Promise<Square> => new Square(side);",
        "function first<T>(list: T[], fallback: T): T;",
        "  return (list[0] ?? fallback)!;",
        "var table = { a: 1, b: 2 } satisfies Record<string, number>;",
        "var other = (late as number) * 2;",
        'var sized = (helper({ kind: "square" }) as unknown as { size: number }).size;',
        "} catch (error: unknown) {",
        "  type Pair = [Inner, Inner];",
        'identity<string>("x")',
      ],
    ],
    [
      "uses-outside",
      [
        'import type { Logger } from "outside";',
        'import type { Level as Severity } from "outside";',
        'import type * as outside from "outside";',
        "interface Entry2 { hidden: boolean }",
        "  const kept: Kept<number> = { value: log(line) };",
        "  const again: Kept<string> = { value: line };",
      ],
    ],
    [
      "odd-names",
      [
        "declare namespace Unit { export type px = Unit2.px; }",
        "declare enum Unit2 { unknown, number, in, px }",
        "var __require = (import.meta as any).require;",
        "// src/b.ts\ndeclare function require(name: string): { sep: string };\nvar second",
      ],
    ],
    [
      "augments",
      ["declare global {\n  interface SymbolConstructor {\n    readonly watched: symbol;\n  }", "type Last<T> = () => T;", "interface Watched<T> {\n  [Symbol.watched]: () => T;\n}"],
    ],
    [
      "constants",
      [
        'var KEY: typeof KEY2 = Symbol.for("key") as typeof KEY2;',
        "declare const KEY2: unique symbol;",
        'var NAME = "name" as const;',
        "var COUNT = -3 as const;",
        "var NIL: undefined = undefined;",
        "var NOTHING: null = null;",
        "interface Marked { [KEY]?: boolean; [OTHER]: number; name: string }",
        "type Tools = { Unused: typeof Unused; used: typeof used };",
        "var exports_keys: any = {};",
        "var Kind!: typeof Kind3;",
        "declare enum Kind3 { Leaf, Branch }",
        "type Kind = Kind3;",
        "    case 0 as Kind3.Leaf /* Leaf */:",
        "  return { kind: 0 as Kind3.Leaf /* Leaf */, value };",
        'function paint(color: Color3 = "red" as Color3.Red /* Red */): Color3 {',
        '  return { name: name as string, [OTHER]: record[NAME].length, [KEY]: NIL ?? NOTHING ?? undefined };',
        "function pick(name: keyof typeof exports_keys2): unknown {",
        "  const first = tree.kind === (1 as Kind3.Branch) /* Branch */ ? +flag : -flag;",
        "  state: Kind3 = 0 as Kind3.Leaf /* Leaf */;",
        "  readonly first = 0 as Kind3.Leaf /* Leaf */;",
      ],
    ],
  ];
  test.each(kept)("%s: the types are put back, and erasing them gives the JavaScript", async (name, lines) => {
    using dir = library(name);
    expect(await build(String(dir), "--dts")).toMatchObject({ stderr: "", exitCode: 0 });
    const typed = await text(String(dir), "dist", "index.sound.ts");
    for (const line of lines) expect(typed).toContain(line);
    expect(withoutTypes(typed)).toBe(withoutTypes(await text(String(dir), "dist", "index.js")));
  });

  test("the JavaScript is what the build writes without it, and no source map is written", async () => {
    using dir = library("constants");
    expect((await build(String(dir), "--dts")).exitCode).toBe(0);
    const javascript = await text(String(dir), "dist", "index.js");
    expect(readdirSync(join(String(dir), "dist")).filter(name => !name.endsWith(".d.ts")).sort()).toEqual(["index.js", "index.sound.ts"]);
    expect((await build(String(dir))).exitCode).toBe(0);
    expect(await text(String(dir), "dist", "index.js")).toBe(javascript);
  });

  test("--aot compiles the package from its typed files", async () => {
    using dir = library("greeter");
    expect((await build(String(dir), "--dts")).exitCode).toBe(0);
    using app = tempDir("build-sound-application", {
      ...application,
      "app.ts": `import { Polite, serve, type Server } from "greeter";
const server: Server = { port: 8080, options: { name: "world", loud: true } };
console.log(serve(server, "a", "b"), new Polite("hi").greet({ name: "you" }, 2));
`,
    });
    await install(String(dir), String(app), "greeter");
    const plain = await spawned([bunExe(), "app.ts"], String(app));
    expect(plain).toEqual({ stdout: `hello WORLD,world80802 [ "hi you", "hi you" ]\n`, stderr: "", exitCode: 0 });
    const compiled = await spawned([bunExe(), "build", "--compile", "--aot", "app.ts", "--outfile", "app"], String(app));
    expect({ said: (compiled.stdout + compiled.stderr).split("\n").filter(line => /^(note|warn|error)/.test(line)), exitCode: compiled.exitCode }).toEqual({
      said: [`note: "greeter" 1.2.3 is compiled from its typed version in node_modules/greeter/dist`],
      exitCode: 0,
    });
    expect(await spawned([join(String(app), "app")], String(app))).toEqual(plain);
  });

  test("--no-bundle: a typed file beside each JavaScript file, and --aot compiles the package from them", async () => {
    using dir = library("greeter");
    const files = ["index", "mood", "options", "polite"];
    const built = await spawned([bunExe(), "build", ...files.map(name => `src/${name}.ts`), "--no-bundle", "--outdir", "dist", "--target", "bun", "--dts"], String(dir));
    expect(built).toMatchObject({ stderr: "", exitCode: 0 });
    expect(readdirSync(join(String(dir), "dist")).sort()).toEqual(files.flatMap(name => [`${name}.d.ts`, `${name}.js`, `${name}.sound.ts`]).sort());
    for (const name of files) {
      expect((await text(String(dir), "dist", name + ".d.ts")).split("\n")[0]).toBe(`// @sound ${name}.sound.ts ${createHash("sha256").update(await text(String(dir), "dist", name + ".js")).digest("hex")}`);
      expect(withoutTypes(await text(String(dir), "dist", name + ".sound.ts"))).toBe(withoutTypes(await text(String(dir), "dist", name + ".js")));
    }
    expect(await text(String(dir), "dist", "polite.sound.ts")).toContain('import type { Greeter, Options } from "./options";');
    expect(await text(String(dir), "dist", "options.sound.ts")).toContain("export type Options = { name: string; loud?: boolean };");
    using app = tempDir("build-sound-apart-application", {
      ...application,
      "app.ts": `import { Polite, serve, type Server } from "greeter";
const server: Server = { port: 8080, options: { name: "world", loud: true } };
console.log(serve(server, "a", "b"), new Polite("hi").greet({ name: "you" }, 2));
`,
    });
    await install(String(dir), String(app), "greeter");
    const plain = await spawned([bunExe(), "app.ts"], String(app));
    expect(plain).toEqual({ stdout: `hello WORLD,world80802 [ "hi you", "hi you" ]\n`, stderr: "", exitCode: 0 });
    const compiled = await spawned([bunExe(), "build", "--compile", "--aot", "app.ts", "--outfile", "app"], String(app));
    expect({ said: (compiled.stdout + compiled.stderr).split("\n").filter(line => /^(note|warn|error)/.test(line)), exitCode: compiled.exitCode }).toEqual({
      said: [`note: "greeter" 1.2.3 is compiled from its typed version in node_modules/greeter/dist`],
      exitCode: 0,
    });
    expect(await spawned([join(String(app), "app")], String(app))).toEqual(plain);
  });

  test("require() in a bundle for the browser", async () => {
    using dir = library("odd-names");
    expect(await spawned([bunExe(), "build", "src/index.ts", "--outdir", "dist", "--packages", "external", "--dts"], String(dir))).toMatchObject({ stderr: "", exitCode: 0 });
    expect(await text(String(dir), "dist", "index.sound.ts")).toContain("return (require as any).apply(this, arguments);");
    expect(await text(String(dir), "dist", "index.js")).toContain("return require.apply(this, arguments);");
  });

  test("needs no package.json", async () => {
    using dir = library("greeter", { "package.json": "{}" });
    expect(await build(String(dir), "--dts")).toMatchObject({ stderr: "", exitCode: 0 });
    expect(readdirSync(join(String(dir), "dist")).sort()).toEqual(["index.d.ts", "index.js", "index.sound.ts"]);
  });

  const leftOut = "warn: --dts: the typed JavaScript that --aot compiles a package from is left out: ";
  test.each([
    ["--minify", "--minify"],
    ["--splitting", "--splitting"],
    ["--format=cjs", "--format other than esm"],
    ["--sourcemap=inline", "--sourcemap=inline"],
  ])("%s: the declaration files are written, and one warning says that the typed JavaScript is left out", async (flag, named) => {
    using dir = library("greeter");
    expect(await build(String(dir), "--dts", flag)).toMatchObject({ stderr: `${leftOut}it does not support ${named} yet\n`, exitCode: 0 });
    const names = readdirSync(join(String(dir), "dist"));
    expect(names).toContain("index.d.ts");
    expect(names.filter(name => name.endsWith(".sound.ts"))).toEqual([]);
    expect(await text(String(dir), "dist", "index.d.ts")).not.toContain("@sound");
  });

  test("a type error that only the typed JavaScript has is a warning", async () => {
    using dir = library("greeter", {
      "src/index.ts": `// @ts-nocheck\nexport function twice(value) {\n  const text: number = "a";\n  return [value, text];\n}\n`,
    });
    const { stderr, exitCode } = await build(String(dir), "--dts");
    expect(stderr).toStartWith(`${leftOut}with its types put back it has type errors, the first at index.sound.ts:`);
    expect(stderr.trim().split("\n").length).toBe(1);
    expect(exitCode).toBe(0);
    expect(readdirSync(join(String(dir), "dist")).sort()).toEqual(["index.d.ts", "index.js"]);
  });

  test("takes no value", async () => {
    using dir = library("greeter");
    expect((await build(String(dir), "--dts=sound")).exitCode).toBe(1);
  });
});
