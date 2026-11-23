import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, symlinkSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
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

  // The stack of the thread that `Bun.build` runs on is this small.
  test.skipIf(!isLinux)(
    "a declaration file that is emitted for another file's declarations, on a 2 MB stack",
    async () => {
      using dir = tempDir("build-dts-emitted", {
        "a.ts": `export const X = [1];\nexport type T = typeof X;\n`,
        "b.ts": `import type { T } from "./a.ts";\nexport type D = T;\n`,
      });
      await using proc = Bun.spawn({
        cmd: ["sh", "-c", 'ulimit -s 2048 && exec "$@"', "sh", bunExe(), "build", "./b.ts", "--outdir", "out", "--dts"],
        cwd: String(dir),
        env: { ...bunEnv, NO_COLOR: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(readdirSync(join(String(dir), "out")).sort()).toEqual(["a.d.ts", "b.aot.ts", "b.d.ts", "b.js"]);
      expect(readFileSync(join(String(dir), "out/a.d.ts"), "utf8")).toBe(
        `export declare const X: number[];\nexport type T = typeof X;\n`,
      );
      expect(exitCode).toBe(0);
    },
  );

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
