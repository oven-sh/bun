import { describe, expect, test } from "bun:test";
import { existsSync, rmSync, statSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { basename, join } from "path";
import { run as runCommand } from "../../aot/harness/run";
import { unsupported } from "../../aot/run-programs";

async function run(cwd: string, cmd: string[]) {
  const { stdout, stderr, exitCode } = await runCommand(cmd, cwd, { ...bunEnv, NO_COLOR: "1" });
  return { stdout, stderr, exitCode };
}

const bun = (cwd: string, ...args: string[]) => run(cwd, [bunExe(), ...args]);
const executable = (cwd: string, name: string) => join(cwd, isWindows ? name + ".exe" : name);
const withoutCompiler = unsupported ? ["--no-aot"] : [];

describe.concurrent("bun compile", () => {
  test("compiles a file into an executable named after it", async () => {
    using dir = tempDir("compile-a-file", { "hello.ts": `console.log("hello", process.argv.slice(2).join(" "));` });
    const built = await bun(String(dir), "compile", ...withoutCompiler, "./hello.ts");
    expect(built.stderr).not.toContain("error");
    expect(built.exitCode).toBe(0);
    expect(await run(String(dir), [executable(String(dir), "hello"), "a", "b"])).toEqual({
      stdout: "hello a b\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("takes the flags of bun build --compile", async () => {
    using dir = tempDir("compile-flags", {
      "app.ts": `console.log(GREETING, process.execArgv.join(" "));\ndeclare const GREETING: string;`,
    });
    const flags = ["--define", 'GREETING="hi"', "--compile-exec-argv=--smol", "--outfile", "out/renamed"];
    const built = await bun(String(dir), "compile", ...withoutCompiler, "app.ts", ...flags);
    expect(built.stderr).not.toContain("error");
    expect(built.exitCode).toBe(0);
    expect(await run(String(dir), [executable(String(dir), "out/renamed")])).toEqual({
      stdout: "hi --smol\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test.skipIf(!!unsupported)("compiles ahead of time, and --no-aot does not", async () => {
    using dir = tempDir("compile-no-aot", { "app.ts": `const count: number = "one";\nconsole.log(count);` });
    const compiled = await bun(String(dir), "compile", "app.ts");
    expect(compiled.stderr).toContain("TS2322");
    expect(compiled.exitCode).toBe(1);
    expect(existsSync(executable(String(dir), "app"))).toBe(false);

    const plain = await bun(String(dir), "compile", "--no-aot", "app.ts");
    expect(plain.stderr).toBe("");
    expect(plain.exitCode).toBe(0);
    expect(await run(String(dir), [executable(String(dir), "app")])).toEqual({
      stdout: "one\n",
      stderr: "",
      exitCode: 0,
    });

    expect(await bun(String(dir), "compile", "--no-aot", "--aot-log-type-mismatches", "app.ts")).toEqual({
      stdout: "",
      stderr: "error: --aot-log-type-mismatches requires --aot\n",
      exitCode: 1,
    });
  });

  test.skipIf(!!unsupported)(
    "says how much is typed, and --explain says why the rest is not",
    async () => {
      using dir = tempDir("compile-explain", {
        "app.ts": `function first(text: string): number {\n  return JSON.parse(text).head;\n}\nconsole.log(first('{"head":1}'));`,
      });
      const said = ({ stdout, stderr }: { stdout: string; stderr: string }) => (stdout + stderr).split("\n");
      const hint = "Untyped code works, but runs slower. Run with --explain to see what to fix.";
      const built = await bun(String(dir), "compile", "app.ts");
      const summary = said(built).filter(line => /^[\d.]+% of property accesses|^Untyped code works/.test(line));
      expect(summary).toEqual([
        hint,
        expect.stringMatching(
          /^[\d.]+% of property accesses are one load: \d+ free, \d+ tested, [1-9]\d* by name \(\d+\)$/,
        ),
      ]);
      const accesses = Number(/(\d+) by name/.exec(summary[1]!)![1]);
      const explained = await bun(String(dir), "compile", "app.ts", "--explain");
      expect(said(explained)).toContainEqual(expect.stringMatching(/^note: 1\. [a-z-]+: /));
      expect(said(explained)).toContain(`note: ${accesses} of ${accesses} untyped access${accesses === 1 ? "" : "es"}`);
      expect(said(explained)).not.toContain(hint);
      expect(
        said(await bun(String(dir), "build", "--compile", "--aot", "app.ts", "--explain")).filter(
          line => !/\[\d/.test(line),
        ),
      ).toEqual(said(explained).filter(line => !/\[\d/.test(line)));
      expect(await bun(String(dir), "build", "--compile", "app.ts", "--explain")).toEqual({
        stdout: "",
        stderr: "error: --explain requires --aot\n",
        exitCode: 1,
      });
      const [entry] = said(await bun(String(dir), "compile", "app.ts", "--explain=json")).filter(line =>
        line.startsWith('{"rank"'),
      );
      expect(JSON.parse(entry!)).toMatchObject({
        rank: 1,
        reason: expect.any(String),
        file: "app.ts",
        line: 2,
        source: "  return JSON.parse(text).head;",
      });
      expect(await bun(String(dir), "compile", "app.ts", "--explain=nonsense")).toEqual({
        stdout: "",
        stderr:
          'error: Invalid value for --explain: "nonsense". Must be one of text, json, guards, guards-json, trim, missed-optimizations, allocations, statistics\n',
        exitCode: 1,
      });
    },
    120_000,
  );

  test.skipIf(!!unsupported)(
    "writes what bun build --compile --aot writes",
    async () => {
      using dir = tempDir("compile-same-as-build", {
        "app.ts": `console.log([1, 2, 3].map((x: number) => x * 2).join());`,
      });
      async function build(...args: string[]) {
        rmSync(executable(String(dir), "app"), { force: true });
        const { stderr, exitCode } = await bun(String(dir), ...args, "app.ts", "--outfile", "app");
        if (exitCode !== 0) return { stderr, exitCode };
        return {
          stderr,
          exitCode,
          size: statSync(executable(String(dir), "app")).size,
          ...(await run(String(dir), [executable(String(dir), "app")])),
        };
      }
      const compiled = await build("compile");
      expect(compiled).toMatchObject({ stdout: "2,4,6\n", exitCode: 0 });
      expect(compiled).toEqual(await build("build", "--compile", "--aot"));
      const trimmed = await build("compile", "--trim");
      expect(trimmed).toEqual(await build("build", "--compile", "--aot", "--trim"));
      expect(await build("build", "--trim")).toEqual({ stderr: "error: --trim requires --compile\n", exitCode: 1 });
    },
    60_000,
  );

  test.each([[["--aot", "--no-aot"], "error: Cannot use both --aot and --no-aot\n"]])("%j", async (flags, stderr) => {
    using dir = tempDir("compile-both-flags", { "app.ts": `console.log(1);` });
    const built = await bun(String(dir), "compile", ...flags, "app.ts");
    if (unsupported && built.stderr.includes(unsupported)) return;
    expect(built).toEqual({ stdout: "", stderr, exitCode: 1 });
  });

  test("--target=browser with an HTML entry point writes one HTML file", async () => {
    using dir = tempDir("compile-html", {
      "index.html": `<!doctype html><script type="module" src="./app.ts"></script>`,
      "app.ts": `document.title = "compiled";`,
    });
    const built = await bun(String(dir), "compile", "--target=browser", "./index.html", "--outdir", "out");
    expect(built.stderr).toBe("");
    expect(built.exitCode).toBe(0);
    expect(await Bun.file(join(String(dir), "out/index.html")).text()).toContain(`document.title = "compiled"`);
  });

  test("--help", async () => {
    using dir = tempDir("compile-help", {});
    const { stdout, stderr, exitCode } = await bun(String(dir), "compile", "--help");
    expect(stdout).toStartWith("Usage: bun compile [flags] [<entrypoint>]\n");
    for (const flag of ["--outfile", "--target", "--define", "--no-aot", "--trim", "--no-script", "--explain"])
      expect(stdout).toContain(flag);
    expect(stdout).not.toContain("note: package.json");
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect((await bun(String(dir), "--help")).stdout).toMatch(/^  compile +\.\/cli\.ts +Compile /m);
  });
});

describe.concurrent("bun compile in a project that has its own compile", () => {
  const files = {
    "index.ts": `console.log("compiled");`,
    "package.json": JSON.stringify({ name: "has-a-script", scripts: { compile: "echo the script" } }),
  };

  test("runs the script, with the arguments", async () => {
    using dir = tempDir("compile-script", files);
    const { stdout, exitCode } = await bun(String(dir), "compile", "--outfile", "a", "b");
    expect(stdout).toBe("the script --outfile a b\n");
    expect(exitCode).toBe(0);
    expect(existsSync(executable(String(dir), "has-a-script"))).toBe(false);
  });

  test("--no-script runs the command", async () => {
    using dir = tempDir("compile-no-script", files);
    for (const args of [
      ["compile", "--no-script"],
      ["--no-script", "compile"],
    ]) {
      const built = await bun(
        String(dir),
        ...args,
        ...withoutCompiler,
        "--outfile",
        args[0] === "compile" ? "after" : "before",
      );
      expect(built.stdout).not.toContain("the script");
      expect(built.exitCode).toBe(0);
    }
    for (const name of ["after", "before"]) {
      expect(await run(String(dir), [executable(String(dir), name)])).toEqual({
        stdout: "compiled\n",
        stderr: "",
        exitCode: 0,
      });
    }
  });

  test("in the script, it is the command", async () => {
    using dir = tempDir("compile-script-runs-command", {
      ...files,
      "package.json": JSON.stringify({
        name: "has-a-script",
        scripts: { compile: [bunExe(), "compile", ...withoutCompiler, "--outfile from-the-script"].join(" ") },
      }),
    });
    const built = await bun(String(dir), "compile");
    expect(built.exitCode).toBe(0);
    expect(await run(String(dir), [executable(String(dir), "from-the-script")])).toEqual({
      stdout: "compiled\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("--help is the command's, and mentions the script", async () => {
    using dir = tempDir("compile-script-help", files);
    const { stdout, exitCode } = await bun(String(dir), "compile", "--help");
    expect(stdout).toStartWith("Usage: bun compile");
    expect(stdout).toContain(`note: package.json has a "compile" script, so bun compile runs that script`);
    expect(exitCode).toBe(0);
  });

  test("a file named compile.ts is run", async () => {
    using dir = tempDir("compile-file", {
      "compile.ts": `console.log("the file", process.argv.slice(2).join(" "));`,
      "index.ts": files["index.ts"],
    });
    expect(await bun(String(dir), "compile", "a")).toEqual({ stdout: "the file a\n", stderr: "", exitCode: 0 });
  });
});

describe.concurrent("bun compile without an entry point", () => {
  const prints = (text: string) => `console.log(${JSON.stringify(text)});`;

  test.each([
    ["bin, a string", { name: "@scope/tool", bin: "./src/cli.ts", module: "./index.ts" }, "tool", "src/cli.ts"],
    [
      "bin, one entry",
      { name: "tool", bin: { "other-name": "src/cli.ts" }, main: "./index.ts" },
      "other-name",
      "src/cli.ts",
    ],
    [
      "bin, the entry named as the package",
      { name: "tool", bin: { helper: "./index.ts", tool: "./src/cli.ts" } },
      "tool",
      "src/cli.ts",
    ],
    ["module", { name: "tool", module: "src/cli.ts", main: "index.ts" }, "tool", "src/cli.ts"],
    ["main", { name: "tool", main: "src/cli.ts" }, "tool", "src/cli.ts"],
    ["index.ts", { name: "tool" }, "tool", "index.ts"],
  ])("%s", async (_, packageJson, name, entryPoint) => {
    using dir = tempDir("compile-finds", {
      "package.json": JSON.stringify(packageJson),
      "index.ts": prints("index.ts"),
      "src/cli.ts": prints("src/cli.ts"),
    });
    const built = await bun(String(dir), "compile", ...withoutCompiler);
    expect(built.stderr).not.toContain("error");
    expect(built.exitCode).toBe(0);
    expect(await run(String(dir), [executable(String(dir), name)])).toEqual({
      stdout: entryPoint + "\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test.each(["index.tsx", "index.mts", "index.js"])("%s, and no package.json", async file => {
    using dir = tempDir("compile-finds-index", { [file]: prints(file) });
    const built = await bun(String(dir), "compile", ...withoutCompiler);
    expect(built.stderr).not.toContain("error");
    expect(built.exitCode).toBe(0);
    expect(await run(String(dir), [executable(String(dir), basename(String(dir)))])).toEqual({
      stdout: file + "\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("an index file in the working directory, under a folder that has a package.json", async () => {
    using dir = tempDir("compile-finds-here", {
      "package.json": JSON.stringify({ name: "above", main: "main.ts" }),
      "main.ts": prints("main.ts"),
      "scratch/index.ts": prints("scratch/index.ts"),
    });
    const built = await bun(join(String(dir), "scratch"), "compile", ...withoutCompiler);
    expect(built.stderr).not.toContain("error");
    expect(built.exitCode).toBe(0);
    expect(await run(String(dir), [executable(join(String(dir), "scratch"), "scratch")])).toEqual({
      stdout: "scratch/index.ts\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("in a folder of the package, and --outfile", async () => {
    using dir = tempDir("compile-finds-from-below", {
      "package.json": JSON.stringify({ name: "tool", module: "src/cli.ts" }),
      "src/cli.ts": prints("src/cli.ts"),
    });
    const built = await bun(join(String(dir), "src"), "compile", ...withoutCompiler, "--outfile", "../named");
    expect(built.stderr).not.toContain("error");
    expect(built.exitCode).toBe(0);
    expect(await run(String(dir), [executable(String(dir), "named")])).toEqual({
      stdout: "src/cli.ts\n",
      stderr: "",
      exitCode: 0,
    });
  });

  const usage =
    "\nUsage:\n  $ bun compile <entrypoint> [...flags]\n\nTo see full documentation:\n  $ bun compile --help\n";

  test.each([
    [
      "nothing",
      {},
      (dir: string) =>
        `No entry point. There is no package.json and no index.ts, index.tsx, index.mts or index.js in ${dir}`,
    ],
    [
      "a package.json that names none",
      { "package.json": JSON.stringify({ name: "tool" }) },
      (dir: string) =>
        `No entry point. ${join(dir, "package.json")} has no "bin", "module" or "main", and there is no index.ts, index.tsx, index.mts or index.js next to it`,
    ],
    [
      "a file that is not there",
      { "package.json": JSON.stringify({ name: "tool", bin: "./dist/cli.js", module: "index.ts" }), "index.ts": "" },
      (dir: string) => `"bin" in ${join(dir, "package.json")} is "./dist/cli.js", which is not a file`,
    ],
    [
      "several executables",
      { "package.json": JSON.stringify({ name: "tool", bin: { a: "./a.ts", b: "./b.ts" } }), "a.ts": "", "b.ts": "" },
      (dir: string) =>
        `"bin" in ${join(dir, "package.json")} has 2 entries, and none is named "tool". Choose one:\n  bun compile ./a.ts --outfile a\n  bun compile ./b.ts --outfile b`,
    ],
  ])("%s", async (_, files, message) => {
    using dir = tempDir("compile-finds-nothing", files);
    const built = await bun(String(dir), "compile", ...withoutCompiler);
    expect(built).toEqual({ stdout: "", stderr: `error: ${message(String(dir))}\n${usage}`, exitCode: 1 });
  });
});
