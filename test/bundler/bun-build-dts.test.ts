import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
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

  test.each([
    ["without a minify flag", [], "undefined"],
    ["--minify-syntax", ["--minify-syntax"], "void 0"],
  ])("%s: a default that is a cast keeps its cast", async (_, flags, printed) => {
    using dir = tempDir("build-dts-default-cast", {
      ...project,
      "src/index.ts": `export function pick(index: number = undefined as any): number {
  return index ?? 1;
}
export function keep(index: number = null as any): number {
  return index ?? 1;
}
console.log(pick(3), keep(4));
`,
    });
    const built = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out", "--dts", ...flags);
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(readFileSync(join(String(dir), "out/index.aot.ts"), "utf8").match(/^function .*$/gm)).toEqual([
      `function pick(index: number = ${printed} as any): number {`,
      "function keep(index: number = null as any): number {",
    ]);
    expect(readFileSync(join(String(dir), "out/index.js"), "utf8")).toContain(`function pick(index = ${printed}) {`);
  });

  test("a cast whose operand the build folds stays where index.aot.ts allows it", async () => {
    using dir = tempDir("build-dts-folded-cast", {
      ...project,
      "src/index.ts": `declare const process: { env: Record<string, string | undefined> };
export function at(index: number = (process.env.NODE_ENV === "production" ? 1 : undefined) as any): number {
  return index ?? 1;
}
`,
    });
    const built = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out", "--dts");
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(readFileSync(join(String(dir), "out/index.aot.ts"), "utf8").match(/^function .*$/gm)).toEqual([
      "function at(index: number = undefined as any): number {",
    ]);
  });

  // In index.aot.ts `limit` is narrowed, and the build folds or removes a part of the next four operands.
  const rejected = {
    "src/constants.ts": `export const limit: number | undefined = undefined;
export const value: unknown = "v";
`,
    "src/index.ts": `import * as ns from "./constants";
declare const process: { env: Record<string, string | undefined> };
declare const settings: { a: string; b: number };
let last: unknown;
export const narrowed = (n: number | undefined = ns.limit as number): number => n ?? 1;
export function folded(p: unknown = settings[process.env.NODE_ENV === "production" ? "a" : "b"] as string): unknown {
  return p;
}
export function chosen(p: unknown = (process.env.NODE_ENV === "production" ? "a" : 1) as string): unknown {
  return p;
}
export function assigned(m: unknown = (last = process.env.NODE_ENV === "production" ? "a" : 1) as string): unknown {
  return [m, last];
}
export function looped(x: number, name: string): number {
  while (!!name as boolean) {
    x++;
    name = "";
  }
  return x;
}
export function held(p: unknown = ns.value as string): unknown {
  return p;
}
export const text = ns.value as string;
`,
  };

  // On Windows the check of index.aot.ts reads no file, so the build does not see the error.
  test.todoIf(isWindows).each([
    ["without a minify flag", []],
    ["--minify-syntax", ["--minify-syntax"]],
  ])("%s: a cast that index.aot.ts does not allow does not cost index.aot.ts", async (_, flags) => {
    using dir = tempDir("build-dts-rejected-cast", { ...project, ...rejected });
    const built = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out", "--dts", ...flags);
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const typed = readFileSync(join(String(dir), "out/index.aot.ts"), "utf8");
    expect(typed.match(/^(const (narrowed|text) |function |  while ).*$/gm)).toEqual([
      "const narrowed = (n: number | undefined = limit): number => n ?? 1;",
      'function folded(p: unknown = settings["b"]): unknown {',
      "function chosen(p: unknown = 1): unknown {",
      "function assigned(m: unknown = last = 1): unknown {",
      "function looped(x: number, name: string): number {",
      "  while (name) {",
      "function held(p: unknown = value): unknown {",
      "const text = value as string;",
    ]);
  });

  // index.aot.ts has an error with the casts of the defaults and another without them. The warning is the second.
  test.todoIf(isWindows).each([
    [
      "a default needs its cast",
      {
        "src/levels.ts": `export type Level = "trace" | "debug" | "info";
export const floor: Level = "trace";
export const configured: string = "info";
export const value: unknown = "v";
`,
        "src/index.ts": `import * as ns from "./levels";
export const isFloor = (level = ns.configured as "debug" | "info"): boolean => level === ns.floor;
export function size(text: string = ns.value as string): number {
  return text.length;
}
`,
      },
      "index.aot.ts:9:15: TS2322: Type 'unknown' is not assignable to type 'string'.",
    ],
    [
      "another expression is an error",
      {
        "src/mode.ts": `export const mode: "a" | "b" = "a";\n`,
        "src/index.ts": `import * as ns from "./mode";
export function looped(x: number, name: string): number {
  while (!!name as boolean) {
    x++;
    name = "";
  }
  return x;
}
export const isB = (): boolean => ns.mode === "b";
`,
      },
      `index.aot.ts:12:28: TS2367: This comparison appears to be unintentional because the types '"a"' and '"b"' have no overlap.`,
    ],
  ])(
    "a cast that index.aot.ts does not allow, where %s: the warning is the one without the cast",
    async (_, files, error) => {
      using dir = tempDir("build-dts-rejected-cast-warning", { ...project, ...files });
      const built = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out", "--dts");
      expect(built.stderr).toBe(
        `warn: the .aot.ts files that --aot compiles a package from are left out: they have type errors, the first at ${error}\n`,
      );
      expect(built.exitCode).toBe(0);
      expect(readdirSync(join(String(dir), "out")).filter(name => name.endsWith(".aot.ts"))).toEqual([]);
    },
  );

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
