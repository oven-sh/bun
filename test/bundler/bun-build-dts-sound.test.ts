import { describe, expect, test } from "bun:test";
import { createHash } from "crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { unsupported } from "../aot/run-programs";

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
const build = (cwd: string, ...args: string[]) =>
  spawned(
    [bunExe(), "build", "src/index.ts", "--outdir", "dist", "--target", "bun", "--packages", "external", ...args],
    cwd,
  );
const text = (...path: string[]) => Bun.file(join(...path)).text();
const withoutTypes = (typescript: string) => new Bun.Transpiler({ loader: "ts" }).transformSync(typescript);

async function install(from: string, into: string, name: string) {
  cpSync(join(from, "dist"), join(into, "node_modules", name, "dist"), { recursive: true });
  cpSync(join(from, "package.json"), join(into, "node_modules", name, "package.json"));
}

const application = {
  "package.json": JSON.stringify({ name: "app" }),
  "tsconfig.json": JSON.stringify({
    compilerOptions: {
      strict: true,
      module: "esnext",
      moduleResolution: "bundler",
      target: "esnext",
      types: [],
      lib: ["esnext", "dom"],
    },
  }),
};

describe("bun build --dts: the typed JavaScript", () => {
  test("writes the bundle with its types kept, and the declaration file points at it", async () => {
    using dir = library("greeter");
    expect(await build(String(dir), "--dts")).toMatchObject({ stderr: "", exitCode: 0 });
    const javascript = await text(String(dir), "dist", "index.js");
    const typed = await text(String(dir), "dist", "index.sound.ts");
    expect((await text(String(dir), "dist", "index.d.ts")).split("\n")[0]).toBe(
      `// @sound index.sound.ts ${createHash("sha256").update(javascript).digest("hex")}`,
    );
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
      [
        "declare global {\n  interface SymbolConstructor {\n    readonly watched: symbol;\n  }",
        "type Last<T> = () => T;",
        "interface Watched<T> {\n  [Symbol.watched]: () => T;\n}",
      ],
    ],
    [
      "directives",
      [
        "// @ts-ignore\ninterface Wide extends Narrow { value: string }",
        "  // @ts-ignore\n  if (names.length > 9)\n    // @ts-ignore\n    found = names.missing;\n  const kept: string = found;",
        "  if (!list.includes(wanted))\n    // @ts-ignore\n    return;\n  return wanted;",
      ],
    ],
    [
      "symbol-members",
      [
        "  public [type]!: string;\n  public [target]: Event | null = null;\n  private static [count]: number = 0;",
        "  public [listeners]: Map<string, ((event: Event) => void) | null> = new Map;",
        "  public [count](by: number): number {",
      ],
    ],
    [
      "namespaces-of-types-and-code",
      [
        "namespace errors {\nexport type Message = string | { message?: string };\n}\nvar errors: any;\n((errors) => {\n  type Message = string | { message?: string };\n  errors.toObject = (message?: Message): { message?: string } =>",
        'export namespace deep {\nexport type Key = "a" | "b";\n}',
        "  function dist(a: P, b: Hidden = util.origin): number {",
        "function far(point: util.P, key: util.deep.Key, id: onlyTypes.Id): number {",
      ],
    ],
    [
      "casts-on-defaults-and-symbol-members",
      [
        'var cookie_default = { key: "", origin: null } as Cookie;',
        "var settings_default = { depth: 1 } as Settings;",
        "    return this[target] as Event;\n  }\n  public get sure(): Event {\n    return this[target]!;",
        "    return host + ([] as string[]).length + (made.key.length as unknown as number);",
      ],
    ],
    [
      "constants",
      [
        'var KEY: unique symbol = Symbol.for("key");',
        'var OTHER = Symbol("other");',
        'var NAME = "name";',
        "var COUNT = -3;",
        "var NIL = undefined;",
        "var NOTHING = null;",
        "interface Marked { [KEY]?: boolean; [OTHER]: number; name: string }",
        "type Tools = { Unused: typeof Unused; used: typeof used };",
        "var exports_keys: any = {};",
        "var Kind!: typeof Kind3;",
        "declare enum Kind3 { Leaf, Branch }",
        "type Kind = Kind3;",
        "    case 0 as Kind3.Leaf /* Leaf */:",
        "  return { kind: 0 as Kind3.Leaf /* Leaf */, value };",
        'function paint(color: Color3 = "red" as Color3.Red /* Red */): Color3 {',
        "  return { name: name as string, [OTHER]: record[NAME].length, [KEY]: NIL ?? NOTHING ?? undefined };",
        "function pick(name: keyof typeof exports_keys2): unknown {",
        "  const first = tree.kind === (1 as Kind3.Branch) /* Branch */ ? +flag : -flag;",
        "  state: Kind3 = 0 as Kind3.Leaf /* Leaf */;",
        "  readonly first = 0 as Kind3.Leaf /* Leaf */;",
      ],
    ],
    [
      "removed-declarations",
      [
        "declare function canonical(value: string): string;\ndeclare function canonical(value: number): number;",
        "declare function measure(value: string, from?: number): number;",
        'declare const LocalId: "~fixture/Local";',
        'declare const TypeId2: "~fixture/Cache";',
        "declare const Version: 3;",
        'declare const Prefixed: "~fixture/Cache/entry";',
        'declare const Checked: "~fixture/checked";',
        "declare const Annotated: Annotated;",
        "declare const absent: symbol;",
        "declare const missing: unique symbol;",
        "declare const marker: unique symbol;",
        "declare class Unused {\n    size: number;\n}",
      ],
    ],
    [
      "cast-operands",
      [
        "  return [pairs.map((pair) => pair[0]), pairs.map((pair) => pair[1])];\n}) as any;",
        "  readonly tag = tag;\n} as any;",
        "var smaller2: (left: Size, right: Size) => Size = smaller as any;",
        "var succeed2 = succeed as <A>(value: A) => { value: A; readonly exact: true };",
        "reduce(values, undefined as void, (_, value) => visit(value));",
        "var nothing: undefined = call((): undefined => {",
        "  return sql<{ name: string }>`SELECT name FROM ${table}`.map((row) => row.name);",
        'var text = (identity<string>).bind(undefined, "text");',
        "  const first = (yield* encode(1)) as string;",
        "  second = (yield* encode(2)) as string;",
        "  return zero as any;",
        'function pick<A extends boolean>(first2: A, again: typeof first2 = first2): A extends true ? "first" : "second" {',
        '  return (first2 && again ? first() : second()) as A extends true ? "first" : "second";',
      ],
    ],
    [
      "global-names",
      [
        "interface Field<T> extends Codec<T> {",
        "type Decoded = { symbol: typeof Symbol2; text: typeof Text };",
        "declare const Symbol2: Codec<symbol>;",
        "declare const Text: Field<string>;",
        "  [Symbol.iterator](): Iterator<number>;\n  steps(): globalThis.Generator<number, void>;",
        "function* count(limit: number): globalThis.Generator<number, void> {",
        'var key = Symbol.for("key");',
      ],
    ],
    [
      "ambient-values",
      [
        "var LIMIT = 10;",
        'declare const LIMIT2: "import it from ./limits";',
        "declare const injected: number;",
        "var visit: { (node: string): void; BREAK: symbol; SKIP: symbol } = function visit(node) {",
      ],
    ],
    [
      "lazy-modules",
      [
        "type Parsed = string | number;\nvar init_parse = __esm(() => {\n  isHex = /^0x[0-9a-f]+$/i;",
        "coerce = (text: string): Parsed => isHex.test(text) || isDecimal.test(text) ? Number(text) : text",
        "interface Options {\n  fallback?: Parsed;\n}",
      ],
    ],
    [
      "merged-exports",
      [
        "type Kind2 = (typeof exports_kinds_2)[keyof typeof exports_kinds_2];",
        "export type Kind = Kind2;",
        "  kind: typeof NAME;",
        "function isName(kind: Kind2): boolean {\n  const seen = new Set<Kind2>;",
      ],
    ],
    [
      "augmented-modules",
      [
        "declare namespace Annotations2 {\n  interface Augment {}",
        "declare namespace Annotations2 {\n    interface Augment {\n      readonly status?: number;",
        "interface Options2 {\n    readonly loud?: boolean;",
      ],
    ],
    [
      "declaration-modules",
      [
        "interface Parsed { value: string }",
        'type Kind = "a" | "b";',
        "function parse(text: string, kind: Kind): Parsed {",
      ],
    ],
    [
      "shadowed-names",
      [
        "declare namespace outer { export type { Objects }; }",
        "  type Objects = { readonly ast: outer.Objects<number>; readonly options: Options2 };",
        "function pick<Objects extends string>(name: Objects, from: outer.Objects<Objects>): Objects | undefined {",
        "type infer2<T> = T extends readonly (infer Item)[] ? Item : never;",
        "function first<T extends readonly unknown[]>(list: T): infer2<T> | undefined {",
        "interface Scope2 {\n  readonly name: string;\n}\nfunction trace(parent: Scope, name: string): Scope2 | undefined {\n  const scope: Scope2 = { name };",
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

  test("a name that is exported as a namespace and as a type is both in the rolled-up declaration file", async () => {
    using dir = library("merged-exports");
    expect(await build(String(dir), "--dts")).toMatchObject({ stderr: "", exitCode: 0 });
    expect(readdirSync(join(String(dir), "dist")).sort()).toEqual(["index.d.ts", "index.js", "index.sound.ts"]);
    const declarations = await text(String(dir), "dist", "index.d.ts");
    expect(declarations).toContain("export type Kind = Kind2;");
    expect(declarations).toContain("export { exports_kinds_ as Kind, isName };");
  });

  test("the JavaScript is what the build writes without it, and no source map is written", async () => {
    using dir = library("constants");
    expect((await build(String(dir), "--dts")).exitCode).toBe(0);
    const javascript = await text(String(dir), "dist", "index.js");
    expect(
      readdirSync(join(String(dir), "dist"))
        .filter(name => !name.endsWith(".d.ts"))
        .sort(),
    ).toEqual(["index.js", "index.sound.ts"]);
    expect((await build(String(dir))).exitCode).toBe(0);
    expect(await text(String(dir), "dist", "index.js")).toBe(javascript);
  });

  test.skipIf(!!unsupported)("--aot compiles the package from its typed files", async () => {
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
    const compiled = await spawned(
      [bunExe(), "build", "--compile", "--aot", "app.ts", "--outfile", "app"],
      String(app),
    );
    expect({
      said: (compiled.stdout + compiled.stderr).split("\n").filter(line => /^(note|warn|error)/.test(line)),
      exitCode: compiled.exitCode,
    }).toEqual({
      said: [`note: "greeter" 1.2.3 is compiled from its typed version in node_modules/greeter/dist`],
      exitCode: 0,
    });
    expect(await spawned([join(String(app), "app")], String(app))).toEqual(plain);
  });

  test.skipIf(!!unsupported)(
    "--no-bundle: a typed file beside each JavaScript file, and --aot compiles the package from them",
    async () => {
      using dir = library("greeter");
      const files = ["index", "mood", "options", "polite"];
      const built = await spawned(
        [
          bunExe(),
          "build",
          ...files.map(name => `src/${name}.ts`),
          "--no-bundle",
          "--outdir",
          "dist",
          "--target",
          "bun",
          "--dts",
        ],
        String(dir),
      );
      expect(built).toMatchObject({ stderr: "", exitCode: 0 });
      expect(readdirSync(join(String(dir), "dist")).sort()).toEqual(
        files.flatMap(name => [`${name}.d.ts`, `${name}.js`, `${name}.sound.ts`]).sort(),
      );
      for (const name of files) {
        expect((await text(String(dir), "dist", name + ".d.ts")).split("\n")[0]).toBe(
          `// @sound ${name}.sound.ts ${createHash("sha256")
            .update(await text(String(dir), "dist", name + ".js"))
            .digest("hex")}`,
        );
        expect(withoutTypes(await text(String(dir), "dist", name + ".sound.ts"))).toBe(
          withoutTypes(await text(String(dir), "dist", name + ".js")),
        );
      }
      expect(await text(String(dir), "dist", "polite.sound.ts")).toContain(
        'import type { Greeter, Options } from "./options";',
      );
      expect(await text(String(dir), "dist", "options.sound.ts")).toContain(
        "export type Options = { name: string; loud?: boolean };",
      );
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
      const compiled = await spawned(
        [bunExe(), "build", "--compile", "--aot", "app.ts", "--outfile", "app"],
        String(app),
      );
      expect({
        said: (compiled.stdout + compiled.stderr).split("\n").filter(line => /^(note|warn|error)/.test(line)),
        exitCode: compiled.exitCode,
      }).toEqual({
        said: [`note: "greeter" 1.2.3 is compiled from its typed version in node_modules/greeter/dist`],
        exitCode: 0,
      });
      expect(await spawned([join(String(app), "app")], String(app))).toEqual(plain);
    },
  );

  test.skipIf(!!unsupported)(
    "--no-bundle with rewriteRelativeImportExtensions: the typed files import the JavaScript files, for types too",
    async () => {
      using dir = tempDir("build-sound-rewritten-imports", {
        "package.json": JSON.stringify({
          name: "welcome",
          version: "1.0.0",
          type: "module",
          main: "./dist/index.js",
          types: "./dist/index.d.ts",
        }),
        "tsconfig.json": JSON.stringify({
          compilerOptions: {
            strict: true,
            module: "nodenext",
            target: "esnext",
            types: [],
            lib: ["esnext"],
            rewriteRelativeImportExtensions: true,
            verbatimModuleSyntax: true,
          },
        }),
        "src/index.ts": `import { greet } from "./greet.ts";\nimport type { Error } from "./greet.ts";\nimport type { Options } from "./options.ts";\nexport type { Options } from "./options.ts";\nexport type Loud = import("./options.ts").Options & { loud: true };\nexport function welcome(options: Options, error?: Error): string {\n  return greet(options, error) + "!";\n}\n`,
        "src/greet.ts": `import type { Options } from "./options.ts";\nexport type Error = { reason: string };\nexport function isError(value: unknown): value is globalThis.Error {\n  return value instanceof Error;\n}\nexport function greet(options: Options, error?: Error): string {\n  return "hello " + options.name + (error?.reason ?? "");\n}\n`,
        "src/options.ts": `export type Options = { name: string };\n`,
      });
      const built = await spawned(
        [
          bunExe(),
          "build",
          "src/index.ts",
          "src/greet.ts",
          "src/options.ts",
          "--no-bundle",
          "--outdir",
          "dist",
          "--target",
          "bun",
          "--dts",
        ],
        String(dir),
      );
      expect(built).toMatchObject({ stderr: "", exitCode: 0 });
      expect(await text(String(dir), "dist", "index.js")).toContain('import { greet } from "./greet.js";');
      const typed = await text(String(dir), "dist", "index.sound.ts");
      expect(typed).toContain('import { greet } from "./greet.js";');
      expect(typed).toContain('import type { Error } from "./greet.js";');
      expect(typed).toContain('import type { Options } from "./options.js";');
      expect(typed).toContain('export type { Options } from "./options.js";');
      expect(typed).toContain('export type Loud = import("./options.js").Options & { loud: true };');
      expect(await text(String(dir), "dist", "greet.sound.ts")).toContain("export type Error = { reason: string };\n");
      using app = tempDir("build-sound-rewritten-imports-application", {
        ...application,
        "app.ts": `import { welcome, type Options } from "welcome";\nconst options: Options = { name: "you" };\nconsole.log(welcome(options));\n`,
      });
      await install(String(dir), String(app), "welcome");
      const plain = await spawned([bunExe(), "app.ts"], String(app));
      expect(plain).toEqual({ stdout: "hello you!\n", stderr: "", exitCode: 0 });
      const compiled = await spawned(
        [bunExe(), "build", "--compile", "--aot", "app.ts", "--outfile", "app"],
        String(app),
      );
      expect({
        said: (compiled.stdout + compiled.stderr).split("\n").filter(line => /^(note|warn|error)/.test(line)),
        exitCode: compiled.exitCode,
      }).toEqual({
        said: [`note: "welcome" 1.0.0 is compiled from its typed version in node_modules/welcome/dist`],
        exitCode: 0,
      });
      expect(await spawned([join(String(app), "app")], String(app))).toEqual(plain);
    },
  );

  test.skipIf(!!unsupported)(
    "--no-bundle: a declaration file that says ./x.ts finds the same class as the typed file",
    async () => {
      using dir = tempDir("build-sound-one-class", {
        "package.json": JSON.stringify({
          name: "welcome",
          version: "1.0.0",
          type: "module",
          main: "./dist/index.js",
          types: "./dist/index.d.ts",
          exports: { ".": "./dist/index.js", "./*": "./dist/*.js" },
        }),
        "tsconfig.json": JSON.stringify({
          compilerOptions: {
            strict: true,
            module: "nodenext",
            target: "esnext",
            types: [],
            lib: ["esnext"],
            rewriteRelativeImportExtensions: true,
            verbatimModuleSyntax: true,
          },
        }),
        "src/index.ts": `import { Issue } from "./issue.ts";\nexport function make(text: string): Issue {\n  return new Issue(text);\n}\n`,
        "src/issue.ts": `export class Issue {\n  #text: string;\n  constructor(text: string) {\n    this.#text = text;\n  }\n  get text(): string {\n    return this.#text;\n  }\n}\n`,
        "src/named.ts": `import type { Issue } from "./issue.ts";\nexport function read(issue: Issue): string {\n  return issue.text;\n}\n`,
      });
      const built = await spawned(
        [
          bunExe(),
          "build",
          "src/index.ts",
          "src/issue.ts",
          "src/named.ts",
          "--no-bundle",
          "--outdir",
          "dist",
          "--target",
          "bun",
          "--dts",
        ],
        String(dir),
      );
      expect(built).toMatchObject({ stderr: "", exitCode: 0 });
      using app = tempDir("build-sound-one-class-application", {
        ...application,
        "app.ts": `import { make } from "welcome";\nimport { read } from "welcome/named";\nconsole.log(read(make("one class")));\n`,
      });
      await install(String(dir), String(app), "welcome");
      const compiled = await spawned(
        [bunExe(), "build", "--compile", "--aot", "app.ts", "--outfile", "app"],
        String(app),
      );
      expect({
        said: (compiled.stdout + compiled.stderr).split("\n").filter(line => /^(note|warn|error)/.test(line)),
        exitCode: compiled.exitCode,
      }).toEqual({
        said: [`note: "welcome" 1.0.0 is compiled from its typed version in node_modules/welcome/dist`],
        exitCode: 0,
      });
      expect(await spawned([join(String(app), "app")], String(app))).toEqual({
        stdout: "one class\n",
        stderr: "",
        exitCode: 0,
      });
    },
  );

  test.skipIf(!!unsupported)(
    "--no-bundle: a package that imports itself by name while its exports point at its sources",
    async () => {
      using dir = tempDir("build-sound-self-name", {
        "package.json": JSON.stringify({
          name: "welcome",
          version: "1.0.0",
          type: "module",
          exports: { ".": "./src/index.ts", "./*": "./src/*.ts" },
        }),
        "tsconfig.json": JSON.stringify({
          compilerOptions: {
            strict: true,
            module: "nodenext",
            target: "esnext",
            types: [],
            lib: ["esnext"],
            rewriteRelativeImportExtensions: true,
            verbatimModuleSyntax: true,
          },
        }),
        "src/index.ts": `import { Issue } from "welcome/issue";\nimport { read } from "./named.ts";\nexport const text: string = read(new Issue("one class"));\n`,
        "src/issue.ts": `export class Issue {\n  #text: string;\n  constructor(text: string) {\n    this.#text = text;\n  }\n  get text(): string {\n    return this.#text;\n  }\n}\n`,
        "src/named.ts": `import type { Issue } from "./issue.ts";\nexport function read(issue: Issue): string {\n  return issue.text;\n}\n`,
      });
      const built = await spawned(
        [
          bunExe(),
          "build",
          "src/index.ts",
          "src/issue.ts",
          "src/named.ts",
          "--no-bundle",
          "--root",
          "src",
          "--outdir",
          "dist",
          "--target",
          "bun",
          "--dts",
        ],
        String(dir),
      );
      expect(built).toMatchObject({ stderr: "", exitCode: 0 });
      expect(await text(String(dir), "dist", "index.sound.ts")).toContain('import { Issue } from "welcome/issue";');
    },
  );

  test("require() in a bundle for the browser", async () => {
    using dir = library("odd-names");
    expect(
      await spawned(
        [bunExe(), "build", "src/index.ts", "--outdir", "dist", "--packages", "external", "--dts"],
        String(dir),
      ),
    ).toMatchObject({ stderr: "", exitCode: 0 });
    expect(await text(String(dir), "dist", "index.sound.ts")).toContain(
      "return (require as any).apply(this, arguments);",
    );
    expect(await text(String(dir), "dist", "index.js")).toContain("return require.apply(this, arguments);");
  });

  test("several entry points, overloads of async methods, a directive beside a template literal", async () => {
    using dir = library("found-on-servers");
    const built = await spawned(
      [
        bunExe(),
        "build",
        "src/index.ts",
        "src/helper/index.ts",
        "--outdir",
        "dist",
        "--root",
        "src",
        "--target",
        "bun",
        "--packages",
        "external",
        "--dts",
      ],
      String(dir),
    );
    expect(built).toMatchObject({ stderr: "", exitCode: 0 });
    const typed = await text(String(dir), "dist", "index.sound.ts");
    expect(typed).toContain(
      "  async parse(options?: Partial<Input>): Promise<Result<Input>>;\n  async parse(options?: Partial<Input>): Promise<Result<Input>> {",
    );
    expect(typed).toContain(
      "  static async make(count: number): Promise<Request[]>;\n  static async make(count?: number): Promise<Request | Request[]> {",
    );
    expect(typed).toContain("  each(from: number): Generator<number>;\n  *each(from = 0) {");
    expect(typed).toContain("  literal += /* @ts-ignore */`\n");
    expect(withoutTypes(typed)).toBe(withoutTypes(await text(String(dir), "dist", "index.js")));
    const below = await text(String(dir), "dist", "helper", "index.sound.ts");
    expect(below).toContain("type Input = { in?: {} };\ninterface Result<T> { value: T; input: Input }");
    expect(await text(String(dir), "dist", "helper", "index.d.ts")).toStartWith("// @sound index.sound.ts ");
  });

  test("a constant of the sources is checked as a constant, though the bundle declares it with var", async () => {
    using dir = library("greeter", {
      "src/index.ts": `const ROOT = "root";
const KEY = "key";
const LIMIT = 4;
export function resolve(name?: string): string {
  let found = ROOT;
  found = name ?? found;
  return found;
}
export function read(bag: { [KEY]?: unknown }): string | undefined {
  return typeof bag[KEY] === "string" ? bag[KEY] : undefined;
}
export function clamp(value: number, limit = LIMIT): number {
  return Math.min(value, (limit = limit + 1));
}
`,
    });
    expect(await build(String(dir), "--dts")).toMatchObject({ stderr: "", exitCode: 0 });
    expect(await text(String(dir), "dist", "index.sound.ts")).toContain(
      'var ROOT = "root";\nvar KEY = "key";\nvar LIMIT = 4;',
    );
  });

  test("is judged as --aot judges it: not by noUnusedLocals, as an ES module and under the tsconfig.json of its sources wherever --outdir is", async () => {
    using dir = library("greeter", {
      "package.json": JSON.stringify({ name: "greeter", version: "1.2.3", type: "module" }),
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          strict: true,
          module: "nodenext",
          target: "esnext",
          types: [],
          lib: ["esnext", "dom"],
          noUnusedLocals: true,
          noUnusedParameters: true,
          verbatimModuleSyntax: true,
          allowImportingTsExtensions: true,
          noEmit: true,
        },
      }),
      "src/index.ts": `import { used, type Shape } from "./shapes.ts";\nexport const meta: ImportMeta = import.meta;\nexport const later = (run: () => void): number => setTimeout(run, 1);\nexport function area(shape: Shape): number {\n  return used(shape);\n}\n`,
      "src/shapes.ts": `export interface Shape { side: number }\nexport interface Unused { name: string }\nexport function used(shape: Shape): number {\n  return shape.side ** 2;\n}\n`,
    });
    using out = tempDir("build-sound-outside", {});
    const built = await spawned(
      [bunExe(), "build", "src/index.ts", "--outdir", String(out), "--target", "bun", "--dts"],
      String(dir),
    );
    expect(built).toMatchObject({ stderr: "", exitCode: 0 });
    expect(readdirSync(String(out)).sort()).toEqual(["index.d.ts", "index.js", "index.sound.ts"]);
    expect(await text(String(out), "index.sound.ts")).toContain("interface Unused { name: string }");
  });

  test("under a tsconfig.json that only references projects, is judged under the project that has its sources", async () => {
    using dir = library("greeter", {
      "tsconfig.json": JSON.stringify({ files: [], references: [{ path: "./tsconfig.build.json" }] }),
      "tsconfig.build.json": JSON.stringify({
        compilerOptions: {
          composite: true,
          strict: true,
          module: "esnext",
          moduleResolution: "bundler",
          target: "esnext",
          types: [],
          lib: ["esnext", "dom"],
          noEmit: false,
          outDir: "built",
        },
        include: ["src"],
      }),
      "src/index.ts": `export function reply(text: string): Response {\n  return new Response(text);\n}\n`,
    });
    expect(await build(String(dir), "--dts")).toMatchObject({ stderr: "", exitCode: 0 });
    expect(await text(String(dir), "dist", "index.sound.ts")).toContain("function reply(text: string): Response {");
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
  ])(
    "%s: the declaration files are written, and one warning says that the typed JavaScript is left out",
    async (flag, named) => {
      using dir = library("greeter");
      expect(await build(String(dir), "--dts", flag)).toMatchObject({
        stderr: `${leftOut}it does not support ${named} yet\n`,
        exitCode: 0,
      });
      const names = readdirSync(join(String(dir), "dist"));
      expect(names).toContain("index.d.ts");
      expect(names.filter(name => name.endsWith(".sound.ts"))).toEqual([]);
      expect(await text(String(dir), "dist", "index.d.ts")).not.toContain("@sound");
    },
  );

  test("a type error that only the typed JavaScript has is a warning", async () => {
    using dir = library("greeter", {
      "src/index.ts": `export { length } from "./other";\ndeclare const injected: { on: boolean };\nexport const on = injected.on;\n`,
      "src/other.ts": `declare const injected: string;\nexport const length = injected.length;\n`,
    });
    const { stderr, exitCode } = await build(String(dir), "--dts");
    expect(stderr).toStartWith(`${leftOut}with its types put back it has type errors, the first at index.sound.ts:`);
    expect(stderr.trim().split("\n").length).toBe(1);
    expect(exitCode).toBe(0);
    expect(readdirSync(join(String(dir), "dist")).sort()).toEqual(["index.d.ts", "index.js", "other.d.ts"]);
  });

  test("a file with @ts-nocheck stays untyped in the bundle, and its errors are not reported", async () => {
    using dir = library("greeter", {
      "src/index.ts": `import { twice } from "./vendored";\nexport function four(value: number): number[] {\n  return [...twice(value), ...twice(value)];\n}\n`,
      "src/vendored.ts": `// @ts-nocheck\nexport function twice(value: number) {\n  const text: number = "a" * value;\n  return [value, text];\n}\n`,
    });
    expect(await build(String(dir), "--dts")).toMatchObject({ stderr: "", exitCode: 0 });
    const typed = await text(String(dir), "dist", "index.sound.ts");
    expect(typed).toContain('// @ts-ignore\nfunction twice(value) {\n  // @ts-ignore\n  const text = "a" * value;');
    expect(typed).toContain("function four(value: number): number[] {");
    expect(withoutTypes(typed)).toBe(withoutTypes(await text(String(dir), "dist", "index.js")));
  });

  test("takes no value", async () => {
    using dir = library("greeter");
    expect((await build(String(dir), "--dts=sound")).exitCode).toBe(1);
  });
});
