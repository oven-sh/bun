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

  const only = (source: string) => ({
    "tsconfig.json": project["tsconfig.json"],
    "package.json": project["package.json"],
    "src/index.ts": source,
  });
  const written = (dir: unknown, name: string) => readFileSync(join(String(dir), "out", name), "utf8");
  const erased = (text: string, loader: "ts" | "js") =>
    new Bun.Transpiler({ loader, target: "node" }).transformSync(text).replace(/\s+/g, "");
  // The tsconfig.json has no "include", so index.aot.ts is a source of the project for `bun check`, as it is for `tsc`.
  // The build judges the file as a dependency of another program, where it drops TS7008, TS2564 and TS1255.
  async function checked(dir: unknown) {
    const { stdout, stderr, exitCode } = await bun(String(dir), "check");
    return { said: (stdout + stderr).match(/TS\d+[^\n]*/g), exitCode };
  }

  // Each of these runs a build and then a type check.
  const TWO_RUNS = 60_000;

  test(
    "a class member without an annotation keeps the type of the sources when the build removes what it stores",
    async () => {
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
      const typed = written(dir, "index.aot.ts");
      const members = typed.match(/^  (static )?\w+: [^;{]+;$/gm);
      expect(members).toEqual([
        "  mode: string | undefined;",
        "  level: string | number;",
        "  static count: number | undefined;",
        "  to: string | undefined;",
      ]);
      // The check of the sources wrote the same types into index.d.ts.
      expect(written(dir, "index.d.ts").match(/^    (static )?\w+: [^;{]+;$/gm)).toEqual(
        members!.map(member => "  " + member),
      );
      expect(written(dir, "index.js")).toContain("  mode;\n  level;\n  static count;\n  static {}\n");
      expect(erased(typed, "ts")).toBe(erased(written(dir, "index.js"), "js"));
      expect(await checked(dir)).toEqual({ said: null, exitCode: 0 });
    },
    TWO_RUNS,
  );

  test(
    "an accessor field keeps its type on the getter that the build makes for it",
    async () => {
      using dir = tempDir(
        "build-dts-accessor",
        only(`function pick(value: string): string;
function pick(value: number): undefined;
function pick(value: string | number): string | undefined {
  return typeof value === "string" ? value : undefined;
}
export class Counter {
  accessor count: number = 1;
  static accessor total: number = 0;
  accessor step = 2;
  stated() {
    return pick(this.count);
  }
  written(): undefined {
    return pick(Counter.total);
  }
  next(): number {
    this.count += this.step;
    return this.count;
  }
}
`),
      );
      const built = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out", "--dts");
      expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
      const typed = written(dir, "index.aot.ts");
      expect(typed.match(/^  (static )?(get|set) \w+\(.*$/gm)).toEqual([
        "  get count(): number {",
        "  set count(v) {",
        "  static get total(): number {",
        "  static set total(v) {",
        "  get step(): number {",
        "  set step(v) {",
      ]);
      expect(typed).toContain("  stated(): undefined {\n");
      expect(typed).toContain("  written(): undefined {\n");
      expect(erased(typed, "ts")).toBe(erased(written(dir, "index.js"), "js"));
      expect(await checked(dir)).toEqual({ said: null, exitCode: 0 });
    },
    TWO_RUNS,
  );

  test("a build without it writes what it always did", async () => {
    using dir = tempDir("build-without-dts", project);
    const built = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out");
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(readdirSync(join(String(dir), "out"))).toEqual(["index.js"]);
  });
});
