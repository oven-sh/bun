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

  test("--splitting --minify-syntax --minify-whitespace: a class member of a chunk keeps the type of the sources", async () => {
    using dir = tempDir("build-dts-minify-chunk", {
      "tsconfig.json": project["tsconfig.json"],
      "package.json": project["package.json"],
      "src/settings.ts": `declare const __DEV__: boolean;
export class Settings {
  mode;
  constructor() {
    if (__DEV__) this.mode = "dev";
  }
}
`,
      "src/first.ts": `import { Settings } from "./settings";
export const first = (): Settings => new Settings();
`,
      "src/second.ts": `import { Settings } from "./settings";
export const second = (): string | undefined => new Settings().mode;
`,
    });
    const flags = ["--dts", "--splitting", "--minify-syntax", "--minify-whitespace", "--define", "__DEV__=false"];
    const built = await bun(String(dir), "build", "./src/first.ts", "./src/second.ts", "--outdir", "out", ...flags);
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const typed = readdirSync(join(String(dir), "out")).filter(name => name.endsWith(".aot.ts"));
    const chunk = typed.find(name => name !== "first.aot.ts" && name !== "second.aot.ts");
    expect(typed).toHaveLength(3);
    expect(readFileSync(join(String(dir), "out", chunk!), "utf8")).toBe(
      "class Settings{mode: string | undefined;\nconstructor(){}}\nexport{Settings};\n",
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

  const only = (source: string) => ({
    "tsconfig.json": project["tsconfig.json"],
    "package.json": project["package.json"],
    "src/index.ts": source,
  });
  const written = (dir: unknown, name: string) => readFileSync(join(String(dir), "out", name), "utf8");
  const membersOf = (text: string) =>
    text.match(/^ +(?:static )?#?\w+\??(?:: [^;{]+| = [^;]+)?;$/gm)?.map(it => it.trim());

  // Without a `;` behind the last member, its type and a member that has no JavaScript go to the same place.
  test("--minify-syntax --minify-whitespace: the type of the last member of a class stands behind its name", async () => {
    using dir = tempDir(
      "build-dts-minify-last-member",
      only(`export abstract class Shape {
  constructor() {
    this.kind = "shape";
  }
  kind;
  abstract area(): number;
}
export class Sizes {
  constructor() {
    this.width = 1;
  }
  width: number;
  [side: string]: number;
}
export abstract class Named {
  name = "n" as const;
  abstract area(): number;
}
`),
    );
    const flags = ["--dts", "--minify-syntax", "--minify-whitespace"];
    const built = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out", ...flags);
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(written(dir, "index.aot.ts")).toBe(
      `abstract class Shape{constructor(){this.kind="shape"}
kind: string;abstract area(): number;
}
class Sizes{constructor(){this.width=1}
width: number;[side: string]: number;
}
abstract class Named{name="n" as const;abstract area(): number;
}
export{Named,Shape,Sizes};
`,
    );
  });

  test("noUncheckedIndexedAccess: a member that is stored from an index is undefined too", async () => {
    const options = { strict: true, noUncheckedIndexedAccess: true };
    using dir = tempDir("build-dts-unchecked-index", {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { ...options, module: "esnext", moduleResolution: "bundler", target: "esnext", types: [] },
      }),
      "package.json": JSON.stringify({ name: "greeter", version: "1.0.0", compilerOptions: options }),
      "src/index.ts": `export class Holder {
  first;
  constructor(items: string[]) {
    this.first = items[0];
  }
}
`,
    });
    const built = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out", "--dts");
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(membersOf(written(dir, "index.aot.ts"))).toEqual(["first: string | undefined;"]);
  });

  test("exactOptionalPropertyTypes: the note of an optional member leaves to its `?` that it can be absent", async () => {
    const options = { strict: true, exactOptionalPropertyTypes: true };
    using dir = tempDir("build-dts-exact-optional", {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { ...options, module: "esnext", moduleResolution: "bundler", target: "esnext", types: [] },
      }),
      "package.json": JSON.stringify({ name: "greeter", version: "1.0.0", compilerOptions: options }),
      "src/index.ts": `declare const __DEV__: boolean;
export interface Options {
  name?: string;
}
export class Settings implements Options {
  name?;
  label?;
  constructor(name: string) {
    this.name = name;
    if (__DEV__) this.label = "dev";
  }
}
export const shown: Options = new Settings("a");
`,
    });
    const flags = ["--dts", "--define", "__DEV__=false"];
    const built = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out", ...flags);
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    // `name?: string | undefined` is another type there, and `Settings` would not implement `Options`.
    // A path of the constructor leaves `label` without a store, so its `undefined` is a value.
    expect(membersOf(written(dir, "index.aot.ts"))).toEqual([
      "name?: string;",
      "name?: string;",
      "label?: string | undefined;",
    ]);
  });

  test("useDefineForClassFields: false: a member without a value is declared with the type of the sources", async () => {
    const options = { strict: true, useDefineForClassFields: false };
    const more = { noImplicitOverride: true, module: "esnext", moduleResolution: "bundler", target: "esnext" };
    using dir = tempDir("build-dts-no-define", {
      "tsconfig.json": JSON.stringify({ compilerOptions: { ...options, ...more, types: [] } }),
      "package.json": JSON.stringify({ name: "greeter", version: "1.0.0", compilerOptions: options }),
      "src/index.ts": `declare const __DEV__: boolean;
export class Counter {
  mode;
  count;
  label: string;
  constructor() {
    this.count = 0;
    this.label = "c";
    if (__DEV__) this.mode = "dev";
  }
  next(): number {
    return ++this.count;
  }
}
export class Named extends Counter {
  override mode;
  override label: string;
  constructor(override count: number) {
    super();
    this.label = "n";
    if (__DEV__) this.mode = "named";
  }
}
`,
    });
    const flags = ["--dts", "--define", "__DEV__=false"];
    const built = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out", ...flags);
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    // The bundle has none of these fields. `declare` allows no `override` (TS1243).
    expect(written(dir, "index.aot.ts").match(/^  declare .*$/gm)).toEqual([
      "  declare mode: string | undefined;",
      "  declare count: number;",
      "  declare label: string;",
      "  declare mode: string | undefined;",
      "  declare label: string;",
      "  declare count: number;",
    ]);
    // The tsconfig.json has no "include", so index.aot.ts is a source of this project too.
    const checked = await bun(String(dir), "check");
    expect({ said: (checked.stdout + checked.stderr).match(/TS\d+[^\n]*/g), exitCode: checked.exitCode }).toEqual({
      said: null,
      exitCode: 0,
    });
  });

  test("experimentalDecorators: a line that index.aot.ts adds for a member has none of its decorators", async () => {
    const options = { strict: true, experimentalDecorators: true, useDefineForClassFields: false };
    using dir = tempDir("build-dts-decorated-members", {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { ...options, module: "esnext", moduleResolution: "bundler", target: "esnext", types: [] },
      }),
      "package.json": JSON.stringify({ name: "greeter", version: "1.0.0", compilerOptions: options }),
      // The helper of the bundle reads Reflect.decorate. A package that imports `reflect-metadata` has it declared.
      "src/index.ts": `declare const __DEV__: boolean;
declare global {
  namespace Reflect {
    function decorate(decorators: unknown[], target: object, key?: string | symbol, desc?: PropertyDescriptor | null): any;
  }
}
export const columns: string[] = [];
function column(target: object, key: string): void {
  columns.push(key);
}
function indexed(name: string) {
  return (target: object, key: string): void => {
    columns.push(name + ":" + key);
  };
}
export class Row {
  @column id: number;
  @column
  @indexed("by name")
  name;
  @column private readonly note?;
  @column declare owner: string;
  constructor(id: number) {
    this.id = id;
    if (__DEV__) this.name = "row";
    if (__DEV__) this.note = "n";
  }
}
export const load = () => import("./service");
`,
      // A decorator of a parameter assigns to the class. The bundle has the class of a module in a variable only
      // where it loads the module this way.
      "src/service.ts": `function inject(target: object, key: string | undefined, index: number): void {}
export class Service {
  constructor(@inject private readonly name: string) {}
  read(): string {
    return this.name;
  }
}
`,
    });
    const flags = ["--dts", "--define", "__DEV__=false"];
    const built = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out", ...flags);
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    // The bundle has none of these fields: it stores in the constructor, and it calls the decorators behind the class.
    expect(written(dir, "index.aot.ts").match(/^ +declare .*$/gm)).toEqual([
      "    declare private readonly name: string;",
      "  declare id: number;",
      "  declare name: string | undefined;",
      "  declare private readonly note?: string | undefined;",
      "  declare owner: string;",
    ]);
    // A decorator that index.aot.ts stated too would run twice.
    const erased = (name: string, loader: "ts" | "js") =>
      new Bun.Transpiler({ loader, target: "node", tsconfig: { compilerOptions: options } })
        .transformSync(written(dir, name))
        .replace(/\s+/g, "");
    expect(erased("index.aot.ts", "ts")).toBe(erased("index.js", "js"));
  });

  test("a class member without an annotation keeps the type of the sources when the build removes what it stores", async () => {
    using dir = tempDir(
      "build-dts-dead-stores",
      only(`declare const __DEV__: boolean;
declare const process: { env: Record<string, string | undefined> };
export class Settings {
  mode;
  level;
  static count;
  static {
    if (__DEV__) this.count = 1;
  }
  constructor(level: number) {
    if (__DEV__) this.mode = "dev";
    if (__DEV__) this.level = "debug";
    else this.level = level;
  }
  read(): string {
    return String(this.mode) + this.level + Settings.count;
  }
}
export class Trace {
  to;
  constructor() {
    if (process.env.NODE_ENV === "production") this.to = "stderr";
  }
  read(): string {
    return String(this.to);
  }
}
`),
    );
    const flags = ["--dts", "--define", "__DEV__=false"];
    const built = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out", ...flags);
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const members = [
      "mode: string | undefined;",
      // The store of a string is not in the bundle, and the store of a number is.
      "level: string | number;",
      "static count: number | undefined;",
      "to: string | undefined;",
    ];
    expect(membersOf(written(dir, "index.aot.ts"))).toEqual(members);
    // The check of the sources wrote the same types into index.d.ts.
    expect(membersOf(written(dir, "index.d.ts"))).toEqual(members);
    expect(membersOf(written(dir, "index.js"))).toEqual(["mode;", "level;", "static count;", "to;"]);
    const erased = (name: string, loader: "ts" | "js") =>
      new Bun.Transpiler({ loader, target: "node" }).transformSync(written(dir, name)).replace(/\s+/g, "");
    expect(erased("index.aot.ts", "ts")).toBe(erased("index.js", "js"));
    // The tsconfig.json has no "include", so index.aot.ts is a source of this project too. The build judges the file
    // as a dependency of another program, where TS7008 does not count. Here it does.
    const checked = await bun(String(dir), "check");
    expect({ said: (checked.stdout + checked.stderr).match(/TS\d+[^\n]*/g), exitCode: checked.exitCode }).toEqual({
      said: null,
      exitCode: 0,
    });
  });

  test("a member is written with the type of the sources only where that type names nothing", async () => {
    using dir = tempDir(
      "build-dts-member-types",
      only(`declare const __DEV__: boolean;
export type Mode = "fast" | "slow";
export enum Color {
  Red,
  Blue,
}
function mode(): Mode {
  return "fast";
}
export class Rows {
  optional?;
  #hidden;
  either;
  flag;
  both;
  picked;
  far;
  kept;
  color;
  entries;
  valued = 1;
  constructor(on: boolean) {
    this.either = on ? "a" : null;
    this.kept = "kept";
    if (__DEV__) this.optional = "dev";
    if (__DEV__) this.#hidden = 1n;
    if (__DEV__) this.flag = false as const;
    if (__DEV__) this.both = on;
    if (__DEV__) this.picked = mode();
    if (__DEV__) this.far = 1e999 as const;
    if (__DEV__) this.color = Color.Red;
    if (__DEV__) this.entries = new Map<string, number>();
  }
  read(): string {
    return [this.optional, this.#hidden, this.flag, this.both, this.picked, this.far, this.color].join();
  }
  size(): number {
    return this.valued + this.kept.length + (this.entries?.size ?? 0) + (this.either?.length ?? 0);
  }
}
`),
    );
    const flags = ["--dts", "--define", "__DEV__=false"];
    const built = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out", ...flags);
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(membersOf(written(dir, "index.aot.ts"))).toEqual([
      "optional?: string | undefined;",
      "#hidden: bigint | undefined;",
      "either: string | null;",
      "flag: false | undefined;",
      "both: boolean | undefined;",
      // The type checker prints `Mode | undefined` for it, and `Mode` can be the name of another type in a bundle.
      'picked: "fast" | "slow" | undefined;',
      // `Infinity` is the name of a value.
      "far: number | undefined;",
      "kept: string;",
      // The member of an enum and a class are names. These two are as the bundle has them.
      "color;",
      "entries;",
      "valued = 1;",
    ]);
  });

  test("a build without it writes what it always did", async () => {
    using dir = tempDir("build-without-dts", project);
    const built = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out");
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(readdirSync(join(String(dir), "out"))).toEqual(["index.js"]);
  });
});
