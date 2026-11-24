import { describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "fs";
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

  test.skipIf(isWindows)("an output name with backslashes does not escape outdir", async () => {
    const outside = { "outside.js": "outside\n//# debugId=1\n", "outside.js.map": "{}" };
    const name = String.raw`x\..\..\..\outside.json`;
    using dir = tempDir("build-dts-backslash", { ...outside, app: project });
    const app = join(String(dir), "app");
    writeFileSync(join(app, "src", name), "{}");
    symlinkSync(name, join(app, "src", "link.json"));

    const built = await bun(app, "build", "./src/index.ts", "./src/link.json", "--outdir", "out", "--dts");

    expect(readdirSync(String(dir)).sort()).toEqual(["app", "outside.js", "outside.js.map"]);
    expect(readFileSync(join(String(dir), "outside.js"), "utf8")).toBe(outside["outside.js"]);
    expect(readdirSync(join(app, "out"))).toContain(name.replace(".json", ".js"));
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  });

  describe.skipIf(isWindows).each([
    ["a\\b/out", ["a\\b", "app"]],
    ["c\\d", ["a\\b", "app", "c\\d"]],
  ])("outdir %s", (outdir, entries) => {
    const api = `
      const { outputs } = await Bun.build({ entrypoints: ["./src/index.ts"], outdir: process.argv[2], dts: true });
      await Promise.all(outputs.map(output => output.text()));
    `;
    test.each(["build ./src/index.ts --dts --outdir", "build.js"])("bun %s writes every file into it", async args => {
      using dir = tempDir("build-dts-outdir", { "a\\b": {}, app: { ...project, "build.js": api } });
      await using proc = Bun.spawn({
        cmd: [bunExe(), ...args.split(" "), join(String(dir), outdir)],
        cwd: join(String(dir), "app"),
        env: { ...bunEnv, HOME: join(String(dir), "a\\b") },
        stdout: "ignore",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      expect(readdirSync(String(dir)).sort()).toEqual(entries);
      expect(readdirSync(join(String(dir), outdir)).sort()).toEqual([
        "index.aot.ts",
        "index.d.ts",
        "index.js",
        "join.d.ts",
      ]);
      expect(exitCode).toBe(0);
    });
  });

  test.skipIf(isWindows).each([
    ["build ./src/index.ts --outdir out --dts", "src/index.ts"],
    ["build ./src/index.ts --outdir out --check", "src/index.ts"],
    ["compile ./src/index.ts --outfile out", "src/index.ts"],
    ["compile . --outfile out", ""],
    ["run --check ./src/index.ts", "src/index.ts"],
    ["run --check script", ""],
  ])("%s errors when the cwd contains a backslash", async (args, entryPoint) => {
    const files = { ...project, "package.json": JSON.stringify({ scripts: { script: "echo ran" } }) };
    using dir = tempDir("build-dts-cwd", { "a\\b": files, a: { b: files } });
    const built = await bun(join(String(dir), "a\\b"), ...args.split(" "));
    expect(built.stderr.trim()).toBe(
      `error: The type checker cannot read a path that has a backslash in a directory's name: ${join(String(dir), "a\\b", entryPoint)}`,
    );
    expect(built.exitCode).toBe(1);
  });

  test.skipIf(isWindows).each(["src/link.ts", "src/a\\b.ts"])("--check of %s without a tsconfig.json", async entry => {
    using dir = tempDir("build-check-backslash", { "src/a\\b.ts": `export const a: number = "";\n` });
    symlinkSync("a\\b.ts", join(String(dir), "src", "link.ts"));
    const built = await bun(String(dir), "build", entry, "--outdir", "out", "--check");
    expect(built.stderr).toContain("TS2322");
    expect(built.exitCode).toBe(1);
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

  test("two entry points of two projects keep the types of both in their .aot.ts files", async () => {
    using dir = tempDir("build-dts-two-projects", {
      "x/tsconfig.json": project["tsconfig.json"],
      "x/src/index.ts": `export enum Kind { One, Two }\nexport const name = Kind[Kind.One];\n`,
      "y/tsconfig.json": project["tsconfig.json"],
      "y/src/index.ts": `export const y: number = 1;\n`,
    });
    const entries = ["./x/src/index.ts", "./y/src/index.ts"];
    const built = await bun(String(dir), "build", ...entries, "--root", ".", "--outdir", "out", "--dts");
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const read = (name: string) => readFileSync(join(String(dir), "out", name), "utf8");
    expect(read("x/src/index.aot.ts")).toContain("enum Kind");
    expect(read("y/src/index.aot.ts")).toContain("const y: number = 1;");
  });

  describe("a project that tsconfig.json references", () => {
    const options = {
      ...JSON.parse(project["tsconfig.json"]).compilerOptions,
      composite: true,
      rootDir: "src",
      skipLibCheck: true,
    };
    const projects = {
      "a/tsconfig.json": JSON.stringify({ compilerOptions: options, include: ["src"] }),
      "a/src/index.ts": `export const x = 1;\n`,
      "b/tsconfig.json": JSON.stringify({ compilerOptions: options, include: ["src"], references: [{ path: "../a" }] }),
      "b/src/index.ts": `export const z = 2;\n`,
    };
    const filesIn = (folder: string) =>
      readdirSync(folder, { recursive: true, withFileTypes: true })
        .filter(entry => entry.isFile())
        .map(entry =>
          join(entry.parentPath, entry.name)
            .slice(folder.length + 1)
            .replaceAll("\\", "/"),
        )
        .sort();
    const build = async (dir: string, ...flags: string[]) => {
      const b = join(dir, "b");
      const built = await bun(b, "build", "./src/index.ts", "--outdir", "out", "--dts", ...flags);
      return { stderr: built.stderr, exitCode: built.exitCode, files: built.exitCode ? [] : filesIn(join(b, "out")) };
    };

    test.each([
      { flags: [], files: ["index.aot.ts", "index.d.ts", "index.js"] },
      { flags: ["--root", "./src"], files: ["index.aot.ts", "index.d.ts", "index.js"] },
      { flags: ["--root", ".."], files: ["b/src/index.aot.ts", "b/src/index.d.ts", "b/src/index.js"] },
    ])("gets none for a file that no entry point imports: $flags", async ({ flags, files }) => {
      using dir = tempDir("build-dts-references", projects);
      expect(await build(String(dir), ...flags)).toEqual({ stderr: "", exitCode: 0, files });
      expect(readFileSync(join(String(dir), "b/out", files[1]), "utf8")).toBe("export declare const z = 2;\n");
    });

    const imported = {
      ...projects,
      "a/src/index.ts": `export enum Kind { One, Two }\nexport const x = Kind.One;\n`,
      "a/src/unused.ts": `export const unused = 1;\n`,
      "b/src/index.ts": `import { Kind, x } from "../../a/src/index";\nexport { x };\nexport const name = Kind[x];\n`,
    };

    test("gets one for each file that an entry point imports by a relative path", async () => {
      using dir = tempDir("build-dts-references-import", imported);
      const files = ["a/src/index.d.ts", "b/src/index.aot.ts", "b/src/index.d.ts", "b/src/index.js"];
      expect(await build(String(dir), "--root", "..")).toEqual({ stderr: "", exitCode: 0, files });
      const read = (name: string) => readFileSync(join(String(dir), "b/out", name), "utf8");
      expect(read("b/src/index.d.ts")).toBe(
        `import { x } from "../../a/src/index.js";\nexport { x };\nexport declare const name: string;\n`,
      );
      expect(read("b/src/index.aot.ts")).toContain("enum Kind");
    });

    // A declaration file that an earlier `tsc -b` left on disk is not read to find what an entry point reaches.
    test.each([
      { left: "nothing", dist: {} },
      { left: "stale files", dist: { "a/dist/star.d.ts": `export * from "./unused";\n`, "a/dist/unused.d.ts": "" } },
    ])("gets one for a file that is reached in any way, with $left in its outDir", async ({ dist }) => {
      const inOutDir = { ...options, outDir: "dist" };
      using dir = tempDir("build-dts-references-reach", {
        "a/tsconfig.json": JSON.stringify({ compilerOptions: inOutDir, include: ["src"] }),
        "a/src/type.ts": `export interface T { t: number }\n`,
        "a/src/effect.ts": `export const effect = 1;\n`,
        "a/src/star.ts": `export const star = 1;\n`,
        "a/src/dynamic.ts": `export const dynamic = 1;\n`,
        "a/src/query.ts": `export const query = 1;\n`,
        "a/src/global.ts": `var GLOBAL: number = 1;\n`,
        "a/src/unused.ts": `export const unused = 1;\n`,
        "b/tsconfig.json": JSON.stringify({
          compilerOptions: inOutDir,
          include: ["src"],
          references: [{ path: "../a" }],
        }),
        "b/src/index.ts": `/// <reference path="../../a/src/global.ts" />
import type { T } from "../../a/src/type";
import "../../a/src/effect";
export * from "../../a/src/star";
export const loaded = import("../../a/src/dynamic");
export declare const query: typeof import("../../a/src/query");
export const t: T = { t: GLOBAL };
`,
        ...dist,
      });
      const reached = ["dynamic", "effect", "global", "query", "star", "type"].map(name => `a/src/${name}.d.ts`);
      const files = [...reached, "b/src/index.aot.ts", "b/src/index.d.ts", "b/src/index.js"];
      expect(await build(String(dir), "--root", "..")).toEqual({ stderr: "", exitCode: 0, files });
    });

    test("has no place for that file outside the root directory, like any other project", async () => {
      using dir = tempDir("build-dts-references-outside", imported);
      expect(await build(String(dir))).toEqual({
        stderr: `error: cannot write a declaration file for ${join(String(dir), "a/src/index.ts")} because it is outside the root directory ${join(String(dir), "b/src")}. Pass --root to change it\n`,
        exitCode: 1,
        files: [],
      });
    });

    test("gets none when an entry point imports it as a package", async () => {
      using dir = tempDir("build-dts-references-package", {
        ...projects,
        "a/package.json": JSON.stringify({ name: "@org/a", version: "1.0.0", main: "src/index.ts" }),
        "a/src/index.ts": `export interface T { a: number }\nexport function make(): T { return { a: 1 }; }\n`,
        "b/src/index.ts": `import { make } from "@org/a";\nexport const value = make();\n`,
      });
      mkdirSync(join(String(dir), "node_modules/@org"), { recursive: true });
      symlinkSync(join(String(dir), "a"), join(String(dir), "node_modules/@org/a"), "junction");
      const files = ["index.aot.ts", "index.d.ts", "index.js"];
      expect(await build(String(dir))).toEqual({ stderr: "", exitCode: 0, files });
      expect(readFileSync(join(String(dir), "b/out/index.d.ts"), "utf8")).toBe(
        `export declare const value: import("@org/a").T;\n`,
      );
    });

    const split = {
      "b/tsconfig.json": JSON.stringify({
        compilerOptions: { ...options, composite: false, rootDir: undefined, noEmit: true },
        include: ["src", "test"],
        references: [{ path: "./tsconfig.build.json" }],
      }),
      "b/tsconfig.build.json": JSON.stringify({ compilerOptions: options, include: ["src"] }),
      "b/src/index.ts": `import { helper } from "./helper";\nexport const z = helper + 1;\n`,
      "b/src/helper.ts": `export const helper = 1;\n`,
      "b/src/unused.ts": `export const unused = 1;\n`,
      "b/test/index.test.ts": `export const test = 1;\n`,
    };

    test("gets one for an entry point that it has, and for what that imports", async () => {
      using dir = tempDir("build-dts-references-split", split);
      const files = ["helper.d.ts", "index.aot.ts", "index.d.ts", "index.js"];
      expect(await build(String(dir))).toEqual({ stderr: "", exitCode: 0, files });
    });

    test("gets one for that entry point when it emits nothing for the others to read", async () => {
      using dir = tempDir("build-dts-references-split-no-emit", {
        ...split,
        "b/tsconfig.build.json": JSON.stringify({
          compilerOptions: { ...options, noEmitOnError: true },
          include: ["src"],
        }),
        "b/src/unused.ts": `export const unused: number = "1";\n`,
      });
      const files = ["helper.d.ts", "index.aot.ts", "index.d.ts", "index.js"];
      expect(await build(String(dir))).toEqual({ stderr: "", exitCode: 0, files });
    });
  });

  test("a build without it writes what it always did", async () => {
    using dir = tempDir("build-without-dts", project);
    const built = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out");
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(readdirSync(join(String(dir), "out"))).toEqual(["index.js"]);
  });
});
