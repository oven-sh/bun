import { describe, expect, test } from "bun:test";
import {
  accessSync,
  constants,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  watch,
  writeFileSync,
} from "fs";
import { bunEnv, bunExe, isLinux, isRoot, isWindows, tempDir } from "harness";
import { tmpdir } from "os";
import { basename, join } from "path";
import { unsupported } from "../../aot/harness/commands";
import { run as runCommand } from "../../aot/harness/run";
import { withoutDebugInformation } from "../../aot/harness/without-debug-information";

async function run(cwd: string, cmd: string[]) {
  const { stdout, stderr, exitCode } = await runCommand(cmd, cwd, { ...bunEnv, NO_COLOR: "1" });
  return { stdout, stderr, exitCode };
}

const bun = (cwd: string, ...args: string[]) => run(cwd, [bunExe(), ...args]);
/** Each executable is a copy of Bun, and CI tests a Bun with debug information, which is three times as large. */
const compile = (cwd: string, ...args: string[]) => bun(cwd, "compile", ...withoutDebugInformation, ...args);
const executable = (cwd: string, name: string) => join(cwd, isWindows ? name + ".exe" : name);
const withoutCompiler = unsupported ? ["--no-aot"] : [];

describe.concurrent("bun compile", () => {
  test("compiles a file into an executable named after it", async () => {
    using dir = tempDir("compile-a-file", { "hello.ts": `console.log("hello", process.argv.slice(2).join(" "));` });
    const built = await compile(String(dir), ...withoutCompiler, "./hello.ts");
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
    const built = await compile(String(dir), ...withoutCompiler, "app.ts", ...flags);
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
    const compiled = await compile(String(dir), "app.ts");
    expect(compiled.stderr).toContain("TS2322");
    expect(compiled.exitCode).toBe(1);
    expect(existsSync(executable(String(dir), "app"))).toBe(false);

    const plain = await compile(String(dir), "--no-aot", "app.ts");
    expect(plain.stderr).toBe("");
    expect(plain.exitCode).toBe(0);
    expect(await run(String(dir), [executable(String(dir), "app")])).toEqual({
      stdout: "one\n",
      stderr: "",
      exitCode: 0,
    });

    expect(await bun(String(dir), "compile", "--no-aot", "--aot-huge-heap", "app.ts")).toEqual({
      stdout: "",
      stderr: "error: --aot-huge-heap requires --aot\n",
      exitCode: 1,
    });
  });

  test.skipIf(!!unsupported)(
    "prints four aligned rows, and --explain says how much is typed and why the rest is not",
    async () => {
      using dir = tempDir("compile-explain", {
        "app.ts": `function first(text: string): number {\n  return JSON.parse(text).head;\n}\nconsole.log(first('{"head":1}'));`,
      });
      const said = ({ stdout, stderr }: { stdout: string; stderr: string }) => (stdout + stderr).split("\n");
      const built = await compile(String(dir), "app.ts");
      expect({ ...built, stdout: built.stdout.split("\n") }).toEqual({
        stdout: [
          expect.stringMatching(/^ +\[[\d.]+m?s\]  bundle  1 module$/),
          expect.stringMatching(/^ +\[[\d.]+m?s\]   check  4 lines$/),
          expect.stringMatching(/^ +\[[\d.]+m?s\] compile  \S*app(\.exe)?  \d+\.\d MB$/),
          expect.stringMatching(/^ +build id  [0-9a-f]{32}$/),
          "",
        ],
        stderr: "",
        exitCode: 0,
      });
      const labelEnds = built.stdout
        .trimEnd()
        .split("\n")
        .map(row => /^ *(\[\S+\] +)?(bundle|check|compile|build id)/.exec(row)![0].length);
      expect(labelEnds).toEqual([17, 17, 17, 17]);
      const megabytes = Number(/ (\d+\.\d) MB$/m.exec(built.stdout)![1]);
      expect(megabytes).toBeCloseTo(statSync(executable(String(dir), "app")).size / 1_000_000, 0);
      const explained = await compile(String(dir), "app.ts", "--explain");
      const summary = said(explained).filter(line => /of property accesses|^Untyped code works/.test(line));
      expect(summary).toEqual([
        expect.stringMatching(
          /^[\d.]+% of property accesses are one load: \d+ free, \d+ tested, [1-9]\d* by name \(\d+\)$/,
        ),
      ]);
      const accesses = Number(/(\d+) by name/.exec(summary[0]!)![1]);
      expect(said(explained)).toContainEqual(expect.stringMatching(/^note: 1\. [a-z-]+: /));
      expect(said(explained)).toContain(`note: ${accesses} of ${accesses} untyped access${accesses === 1 ? "" : "es"}`);
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
      const [entry] = said(await compile(String(dir), "app.ts", "--explain=json")).filter(line =>
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
          'error: Invalid value for --explain: "nonsense". Must be one of text, json, guards, guards-json, trim, allocations, forms, statistics\n',
        exitCode: 1,
      });
    },
    120_000,
  );

  test.skipIf(!!unsupported)(
    "the check row counts the files that are compiled without types",
    async () => {
      using dir = tempDir("compile-untyped-files", {
        "app.ts": `import { value } from "./loose/value";\nconsole.log(value);\n`,
        "tsconfig.json": `{ "compilerOptions": { "strict": true } }`,
        "loose/tsconfig.json": `{ "compilerOptions": { "strictNullChecks": false } }`,
        "loose/value.ts": `export const value: number = 1;\n`,
      });
      const built = await compile(String(dir), "app.ts");
      expect(built.stdout.split("\n").slice(0, 2)).toEqual([
        expect.stringMatching(/^ +\[[\d.]+m?s\]  bundle  2 modules$/),
        expect.stringMatching(/^ +\[[\d.]+m?s\]   check  3 lines  1 file compiled without types$/),
      ]);
      expect(built.exitCode).toBe(0);
    },
    120_000,
  );

  test.skipIf(!!unsupported)(
    "what is only slower in a package is counted, and each reason that limits --trim is printed once",
    async () => {
      using dir = tempDir("compile-noisy-package", {
        "app.ts": `import { pack } from "packer";\nconsole.log(await pack(process.argv[2]));\n`,
        "package.json": `{ "name": "app", "type": "module" }`,
        "node_modules/packer/package.json": `{ "name": "packer", "version": "1.0.0", "main": "index.js" }`,
        "node_modules/packer/index.js": `"use strict";
Symbol.asyncDispose ??= Symbol("Symbol.asyncDispose");
const path = require("node:path");
const escapeText = text => text.replace(/[.*+?]/g, "\\\\$&");
const matchers = [name => new RegExp("^" + escapeText(name)), name => new RegExp(escapeText(name) + "$")];
const globalObject = new Function("return this")();
const wordsOf = language => require("./locales/" + language);
async function pack(file) {
  const config = file ? require(path.resolve(file)) : { name: "none" };
  const found = matchers.filter(make => make(config.name).test("none"));
  return [found.length, typeof globalObject, config.text ? eval(config.text) : 0, wordsOf("en.json").hello].join(" ");
}
module.exports = { pack };
`,
        "node_modules/packer/locales/en.json": `{ "hello": "hello" }`,
        "node_modules/packer/locales/README.md": "# translations\n",
      });
      const codes = (text: string) => [...text.matchAll(/^\w+: (TS\d+):/gm)].map(match => match[1]);
      const notes = (text: string) => text.split("\n").filter(line => /^ {13,}[a-z]/.test(line));
      const counted =
        "             note  2 regular expressions in packer are compiled at run time (--explain lists them)";

      const built = await compile(String(dir), "app.ts");
      expect({ codes: codes(built.stderr), notes: notes(built.stderr) }).toEqual({
        codes: ["TS100064", "TS100064"],
        notes: [counted],
      });
      expect(built.exitCode).toBe(0);
      expect(await run(String(dir), [executable(String(dir), "app")])).toEqual({
        stdout: "2 object 0 hello\n",
        stderr: "",
        exitCode: 0,
      });

      const explained = await compile(String(dir), "app.ts", "--explain");
      expect(codes(explained.stderr).sort()).toEqual(["TS100058", "TS100058", "TS100064", "TS100064", "TS100088"]);
      expect(explained.stderr).not.toContain("regular expressions in packer");
      expect(explained.stderr).not.toContain("(reason ");

      const checked = await bun(String(dir), "check", "--aot", "--trim", "app.ts");
      expect(notes(checked.stderr)).toEqual([
        counted,
        "             trim  kept APIs your code doesn't call:",
        "                   the program calls eval() or new Function()",
        "                     node_modules/packer/index.js:6:26",
        "                     node_modules/packer/index.js:11:60",
        "                   the program calls import() or require() with a dynamic path",
        expect.stringMatching(/^ {21}node_modules\/packer\/index\.js:\d+:\d+$/),
      ]);
      expect(checked.exitCode).toBe(0);
    },
    240_000,
  );

  test.skipIf(!!unsupported)(
    "the compile row gives the lines per second of a build of a thousand lines or more",
    async () => {
      const lines = (count: number) => Array.from({ length: count }, (_, i) => `console.log(${i});\n`).join("");
      using dir = tempDir("compile-rate", { "short.ts": lines(999), "long.ts": lines(1000) });
      const [short, long] = await Promise.all([compile(String(dir), "short.ts"), compile(String(dir), "long.ts")]);
      expect(short.stdout.split("\n").slice(1, 3)).toEqual([
        expect.stringMatching(/   check  999 lines$/),
        expect.stringMatching(/ compile  \S*short(\.exe)?  \d+\.\d MB$/),
      ]);
      expect(long.stdout.split("\n").slice(1, 3)).toEqual([
        expect.stringMatching(/   check  1,000 lines$/),
        expect.stringMatching(/ compile  \S*long(\.exe)?  \d+\.\d MB  (\d+|\d+\.\dk) lines\/s$/),
      ]);
      expect({ short: short.exitCode, long: long.exitCode }).toEqual({ short: 0, long: 0 });
    },
    120_000,
  );

  // Each of the two cases below builds twice, beside every other build of this file: the cases above have two minutes for one build.
  const doubledNumbers = { "app.ts": `console.log([1, 2, 3].map((x: number) => x * 2).join());` };

  function builderIn(dir: string) {
    return async (...args: string[]) => {
      rmSync(executable(dir, "app"), { force: true });
      const { stderr, exitCode } = await bun(dir, ...args, "app.ts", "--outfile", "app");
      if (exitCode !== 0) return { stderr, exitCode };
      return {
        stderr,
        exitCode,
        size: statSync(executable(dir, "app")).size,
        ...(await run(dir, [executable(dir, "app")])),
      };
    };
  }

  test.skipIf(!!unsupported)(
    "writes what bun build --compile --aot writes",
    async () => {
      using dir = tempDir("compile-same-as-build", doubledNumbers);
      const build = builderIn(String(dir));
      const compiled = await build("compile");
      expect(compiled).toMatchObject({ stdout: "2,4,6\n", exitCode: 0 });
      expect(compiled).toEqual(await build("build", "--compile", "--aot"));
    },
    240_000,
  );

  test.skipIf(!!unsupported)(
    "with --trim writes what bun build --compile --aot --trim writes",
    async () => {
      using dir = tempDir("compile-trim-same-as-build", doubledNumbers);
      const build = builderIn(String(dir));
      const trimmed = await build("compile", "--trim");
      expect(trimmed).toEqual(await build("build", "--compile", "--aot", "--trim"));
      expect(await build("build", "--trim")).toEqual({ stderr: "error: --trim requires --compile\n", exitCode: 1 });
    },
    240_000,
  );

  test.skipIf(!!unsupported).each([[["--aot", "--no-aot"], "error: Cannot use both --aot and --no-aot\n"]])(
    "%j",
    async (flags, stderr) => {
      using dir = tempDir("compile-both-flags", { "app.ts": `console.log(1);` });
      const built = await compile(String(dir), ...flags, "app.ts");
      expect(built).toEqual({ stdout: "", stderr, exitCode: 1 });
    },
  );

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

describe.concurrent("bun compile with the name of an installed executable", () => {
  const prints = (text: string) => `#!/usr/bin/env node\nconsole.log(${JSON.stringify(text)});`;
  const tool = {
    "node_modules/tool/package.json": JSON.stringify({
      name: "tool",
      main: "lib/index.js",
      bin: { tool: "bin/cli.js", "tool-helper": "./bin/helper.js" },
    }),
    "node_modules/tool/lib/index.js": `exports.greet = name => "hello, " + name;`,
    "node_modules/tool/bin/cli.js": `#!/usr/bin/env node\nconsole.log(require("../lib/index.js").greet(process.argv[2]));`,
    "node_modules/tool/bin/helper.js": prints("helper"),
  };

  const note = (name: string, path: string, packageName: string) =>
    new RegExp(`^ +note  ${name} is ${RegExp.escape(join(...path.split("/")))}, from the package ${packageName}$`, "m");

  async function compiles(cwd: string, args: string[], name: string, stdout: string, expectedNote?: RegExp) {
    const built = await compile(cwd, ...withoutCompiler, ...args);
    expect(built.stderr).not.toContain("error");
    if (expectedNote) expect(built.stderr).toMatch(expectedNote);
    else expect(built.stderr).not.toContain("from the package");
    expect(built.exitCode).toBe(0);
    expect(await run(cwd, [executable(cwd, name), "world"])).toEqual({ stdout, stderr: "", exitCode: 0 });
  }

  test("the name of a package, and again next to the executable of the first build", async () => {
    using dir = tempDir("compile-installed", tool);
    const said = note("tool", "node_modules/tool/bin/cli.js", "tool");
    await compiles(String(dir), ["tool"], "tool", "hello, world\n", said);
    await compiles(String(dir), ["tool", "--outfile", "again"], "again", "hello, world\n", said);
  });

  test("a scoped package whose bin is a string", async () => {
    using dir = tempDir("compile-installed-scoped", {
      "node_modules/@scope/tool/package.json": JSON.stringify({ name: "@scope/tool", bin: "cli.js" }),
      "node_modules/@scope/tool/cli.js": prints("scoped"),
    });
    const said = note("@scope/tool", "node_modules/@scope/tool/cli.js", "@scope/tool");
    await compiles(String(dir), ["@scope/tool"], "tool", "scoped\n", said);
  });

  test.skipIf(isWindows)("a link in node_modules/.bin", async () => {
    using dir = tempDir("compile-installed-link", tool);
    mkdirSync(join(String(dir), "node_modules", ".bin"));
    symlinkSync(join("..", "tool", "bin", "helper.js"), join(String(dir), "node_modules", ".bin", "tool-helper"));
    const said = note("tool-helper", "node_modules/tool/bin/helper.js", "tool");
    await compiles(String(dir), ["tool-helper"], "tool-helper", "helper\n", said);
  });

  test("a launcher in node_modules/.bin", async () => {
    using dir = tempDir("compile-installed-launcher", {
      ...tool,
      [`node_modules/.bin/tool-helper${isWindows ? ".cmd" : ""}`]: "not JavaScript {",
      "node_modules/@scope/other/package.json": JSON.stringify({ name: "@scope/other", bin: { other: "cli.js" } }),
    });
    const said = note("tool-helper", "node_modules/tool/bin/helper.js", "tool");
    await compiles(String(dir), ["tool-helper"], "tool-helper", "helper\n", said);
  });

  test("in a folder of the project", async () => {
    using dir = tempDir("compile-installed-from-below", { ...tool, "src/app.ts": "" });
    const said = note("tool", "../node_modules/tool/bin/cli.js", "tool");
    await compiles(join(String(dir), "src"), ["tool"], "tool", "hello, world\n", said);
  });

  test("the nearest package of that name hides one further up", async () => {
    using dir = tempDir("compile-installed-nearest", {
      ...tool,
      "sub/node_modules/tool/package.json": JSON.stringify({ name: "tool", main: "index.js" }),
      "sub/node_modules/tool/index.js": `console.log("the nearer library");`,
    });
    const cwd = join(String(dir), "sub");
    const built = await compile(cwd, ...withoutCompiler, "tool");
    expect(built.stderr).toStartWith(`note: tool has no "bin" in its package.json`);
    expect(built.exitCode).toBe(0);
    expect(await run(cwd, [executable(cwd, "tool")])).toEqual({
      stdout: "the nearer library\n",
      stderr: "",
      exitCode: 0,
    });
  });

  const modes = unsupported ? ["--no-aot"] : ["--aot", "--no-aot"];
  const packages: [string, Record<string, string>][] = [
    ["a package with a library", tool],
    [
      "a package without a library",
      {
        "node_modules/tool/package.json": JSON.stringify({ name: "tool", bin: "cli.js" }),
        "node_modules/tool/cli.js": prints("installed"),
      },
    ],
    [
      "another package",
      {
        "node_modules/other/package.json": JSON.stringify({ name: "other", bin: { tool: "cli.js" } }),
        "node_modules/other/cli.js": prints("installed"),
        [`node_modules/.bin/tool${isWindows ? ".cmd" : ""}`]: "not JavaScript {",
      },
    ],
  ];

  const extensions = [".tsx", ".ts", ".jsx", ".cts", ".cjs", ".js", ".mjs", ".mts"];
  const pairs = extensions.flatMap((first, index) => extensions.slice(index + 1).map(second => [first, second]));

  test.each(pairs)("of tool%s and tool%s, the one that bun run runs", async (first, second) => {
    using dir = tempDir("compile-installed-pair", {
      ["tool" + first]: `console.log("${first}");`,
      ["tool" + second]: `console.log("${second}");`,
    });
    const ran = await bun(String(dir), "run", "tool");
    expect([first + "\n", second + "\n"]).toContain(ran.stdout);
    await compiles(String(dir), ["tool"], "tool", ran.stdout);
  });
  describe.each(modes)("a source file of that name, %s", mode => {
    test.each(packages)("is compiled in the first build and the next, beside %s", async (_, files) => {
      using dir = tempDir("compile-installed-or-file", { ...files, "tool.ts": prints("the file") });
      await compiles(String(dir), [mode, "tool"], "tool", "the file\n");
      writeFileSync(join(String(dir), "tool.ts"), prints("the changed file"));
      await compiles(String(dir), [mode, "tool"], "tool", "the changed file\n");
    });

    test("is gone at the next build, which compiles the package's", async () => {
      using dir = tempDir("compile-installed-after-file", { ...tool, "tool.ts": prints("the file") });
      await compiles(String(dir), [mode, "tool"], "tool", "the file\n");
      rmSync(join(String(dir), "tool.ts"));
      const said = note("tool", "node_modules/tool/bin/cli.js", "tool");
      await compiles(String(dir), [mode, "tool"], "tool", "hello, world\n", said);
    });
  });

  test.each([
    [
      "no bin",
      { name: "library", main: "index.js" },
      `note: library has no "bin" in its package.json, so this compiles the library that import "library" loads\n`,
    ],
    [
      "a bin with other names",
      { name: "library", main: "index.js", bin: { first: "index.js", second: "index.js" } },
      `note: library has no "bin" of that name in its package.json, so this compiles the library that import "library" loads. Its "bin" has: first, second\n`,
    ],
  ])("a package that is a library gets a note: %s", async (_, packageJson, note) => {
    using dir = tempDir("compile-installed-library", {
      "node_modules/library/package.json": JSON.stringify(packageJson),
      "node_modules/library/index.js": `exports.answer = 42;`,
    });
    const built = await compile(String(dir), ...withoutCompiler, "library");
    expect(built.stderr).toStartWith(note);
    expect(built.exitCode).toBe(0);
    expect(await run(String(dir), [executable(String(dir), "library")])).toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
  });

  describe.each(modes)("a file without an extension, %s", mode => {
    const compilesInMode = async (files: Record<string, string>, entryPoint: string, stdout: string) => {
      using dir = tempDir("compile-no-extension", files);
      const built = await compile(String(dir), mode, entryPoint, "--outfile", "out");
      expect(built.stderr).not.toContain("error");
      expect(built.exitCode).toBe(0);
      expect(await run(String(dir), [executable(String(dir), "out")])).toEqual({ stdout, stderr: "", exitCode: 0 });
    };
    const installed = (cli: string) => ({
      "node_modules/tool/package.json": JSON.stringify({ name: "tool", bin: "bin/tool" }),
      "node_modules/tool/lib.js": `exports.answer = 42;`,
      "node_modules/tool/bin/tool": cli,
    });
    const printsAnswer = `console.log(require("../lib.js").answer);`;

    test("the name of an installed executable", () =>
      compilesInMode(installed("#!/usr/bin/env node\n" + printsAnswer), "tool", "42\n"));

    test("the path of a file that a bin names", () =>
      compilesInMode(installed(printsAnswer), "node_modules/tool/bin/tool", "42\n"));

    test("a script whose first line names bun", () =>
      compilesInMode(
        { "script": `#!/usr/bin/env -S bun run\nconst answer: number = 42;\nconsole.log(answer);` },
        "./script",
        "42\n",
      ));

    test("a byte order mark before the first line", () =>
      compilesInMode(
        { "script": `﻿#!/usr/bin/env bun\nconst answer: number = 42;\nconsole.log(answer);` },
        "./script",
        "42\n",
      ));
  });

  test("bun build --compile resolves the name to the library", async () => {
    using dir = tempDir("compile-installed-build", tool);
    const built = await bun(String(dir), "build", "--compile", "tool");
    expect(built.stderr).not.toContain("error");
    expect(built.exitCode).toBe(0);
    expect(await run(String(dir), [executable(String(dir), "tool")])).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  });

  test.each([
    ["next to it", () => "../outside.js"],
    ["above node_modules", () => "../../above.js"],
    ["by an absolute path", (dir: string) => join(dir, "above.js")],
    ["behind an absolute path", (dir: string) => join(dir, "node_modules", "tool") + "/x\\..\\..\\outside.js"],
  ])("a bin outside the package is an error: %s", async (_, bin) => {
    using dir = tempDir("compile-installed-outside", {
      "node_modules/tool/index.js": "",
      "node_modules/outside.js": prints("outside"),
      "above.js": prints("above"),
    });
    const written = bin(String(dir));
    const packageJson = join(String(dir), "node_modules", "tool", "package.json");
    writeFileSync(packageJson, JSON.stringify({ name: "tool", main: "index.js", bin: written }));
    const built = await compile(String(dir), ...withoutCompiler, "tool");
    expect(built.stderr).toStartWith(`error: "bin" in ${packageJson} is "${written}", which is outside the package\n`);
    expect({ stdout: built.stdout, exitCode: built.exitCode }).toEqual({ stdout: "", exitCode: 1 });
    expect(existsSync(executable(String(dir), "tool"))).toBe(false);
  });

  test.each(["dist/cli.js", "lib", "", "."])("a bin that is not a file: %j", async bin => {
    using dir = tempDir("compile-installed-missing", {
      "node_modules/tool/package.json": JSON.stringify({ name: "tool", main: "index.js", bin }),
      "node_modules/tool/index.js": "",
      "node_modules/tool/lib/index.js": "",
    });
    const built = await compile(String(dir), ...withoutCompiler, "tool");
    const packageJson = join(String(dir), "node_modules", "tool", "package.json");
    expect(built.stderr).toStartWith(`error: "bin" in ${packageJson} is "${bin}", which is not a file\n`);
    expect({ stdout: built.stdout, exitCode: built.exitCode }).toEqual({ stdout: "", exitCode: 1 });
  });
});

// On Windows the executable ends in .exe.
describe.skipIf(isWindows)("bun compile never writes over an entry point", () => {
  const script = `#!/usr/bin/env bun\nconsole.log("the script");\n`;
  const modes = unsupported ? ["--no-aot"] : ["--aot", "--no-aot"];
  const cases: [string, Record<string, string>, string[], string][] = [
    ["a script named without an extension", { "serve": script }, ["serve"], "serve"],
    ["its path", { "serve": script }, ["./serve"], "serve"],
    ["--outfile", { "app.ts": script }, ["app.ts", "--outfile", "./app.ts"], "./app.ts"],
    [
      "another spelling",
      { "app.ts": script, "src/a.ts": "" },
      ["app.ts", "--outfile", "src/../app.ts"],
      "src/../app.ts",
    ],
    [
      "another entry point",
      { "app.ts": "", "worker.ts": script },
      ["app.ts", "worker.ts", "--outfile", "worker.ts"],
      "worker.ts",
    ],
    ["bin of package.json", { "package.json": `{ "name": "serve", "bin": "./serve" }`, "serve": script }, [], "serve"],
  ];

  describe.each(modes)("%s", mode => {
    test.concurrent.each(cases)("%s", async (_, files, args, outfile) => {
      using dir = tempDir("compile-keeps-entry-point", files);
      const built = await compile(String(dir), mode, ...args);
      expect(built.stderr).toContain(
        `error: the executable would overwrite ${outfile}, which is an entry point. Choose another path with --outfile\n`,
      );
      expect(built.exitCode).toBe(1);
      expect(await Bun.file(join(String(dir), outfile)).text()).toBe(script);
    });

    test.concurrent("a link, written as the entry point", async () => {
      using dir = tempDir("compile-keeps-link", { "src/serve.ts": script });
      symlinkSync(join("src", "serve.ts"), join(String(dir), "serve"));
      const built = await compile(String(dir), mode, "serve");
      expect(built.stderr).toContain("error: the executable would overwrite serve, which is an entry point.");
      expect(built.exitCode).toBe(1);
      expect(await Bun.file(join(String(dir), "serve")).text()).toBe(script);
    });

    test.concurrent.each([
      ["symbolic", symlinkSync],
      ["hard", linkSync],
    ])("a %s link to the entry point is replaced", async (_, link) => {
      using dir = tempDir("compile-replaces-link", { "app.ts": script });
      link(join(String(dir), "app.ts"), join(String(dir), "out"));
      const built = await compile(String(dir), mode, "app.ts", "--outfile", "out");
      expect(built.stderr).not.toContain("error");
      expect(built.exitCode).toBe(0);
      expect(await run(String(dir), [executable(String(dir), "out")])).toEqual({
        stdout: "the script\n",
        stderr: "",
        exitCode: 0,
      });
      expect(await Bun.file(join(String(dir), "app.ts")).text()).toBe(script);
    });

    test.concurrent("an entry point that has a second hard link", async () => {
      using dir = tempDir("compile-keeps-hard-link", { "serve": script });
      linkSync(join(String(dir), "serve"), join(String(dir), "second"));
      const built = await compile(String(dir), mode, "./serve");
      expect(built.stderr).toContain("error: the executable would overwrite serve, which is an entry point.");
      expect(built.exitCode).toBe(1);
      expect(await Bun.file(join(String(dir), "serve")).text()).toBe(script);
    });

    test.concurrent("--outfile elsewhere, twice", async () => {
      using dir = tempDir("compile-beside-script", { "serve": script });
      for (let build = 0; build < 2; build++) {
        const built = await compile(String(dir), mode, "serve", "--outfile", "out");
        expect(built.stderr).not.toContain("error");
        expect(built.exitCode).toBe(0);
        expect(await run(String(dir), [executable(String(dir), "out")])).toEqual({
          stdout: "the script\n",
          stderr: "",
          exitCode: 0,
        });
      }
      expect(await Bun.file(join(String(dir), "serve")).text()).toBe(script);
    });
  });
});
describe.skipIf(isWindows || !!unsupported)("an executable never replaces a file of its program", () => {
  const script = `#!/usr/bin/env bun\nconsole.log("the script");\n`;
  const commands = [["compile"], ["build", "--compile", "--aot"]];
  const cases: [string, Record<string, string>, string][] = [
    ["an entry point", { "app.ts": `console.log("app");\n` }, "app.ts"],
    ["another entry point", { "app.ts": "", "worker.ts": `console.log("worker");\n` }, "worker.ts"],
    [
      "an imported file",
      {
        "app.ts": `import { word } from "./helper";\nconsole.log(word);\n`,
        "helper.ts": `export const word = "helper";\n`,
      },
      "helper.ts",
    ],
    [
      "a required file",
      { "app.ts": `console.log(require("./helper.cjs").word);\n`, "helper.cjs": `exports.word = "helper";\n` },
      "helper.cjs",
    ],
    [
      "a data file",
      { "app.ts": `import data from "./data.json";\nconsole.log(data.word);\n`, "data.json": `{ "word": "data" }\n` },
      "data.json",
    ],
    [
      "an embedded file",
      {
        "app.ts": `import path from "./logo.bin" with { type: "file" };\nconsole.log(path.length > 0);\n`,
        "logo.bin": "logo\n",
      },
      "logo.bin",
    ],
  ];

  describe.each(commands)("%s", (...command) => {
    test.concurrent.each(cases)("%s", async (_, files, outfile) => {
      using dir = tempDir("compile-keeps-sources", files);
      const entryPoints = "worker.ts" in files ? ["app.ts", "worker.ts"] : ["app.ts"];
      const args = [...command.filter(Boolean), ...withoutDebugInformation, ...entryPoints, "--outfile", outfile];
      const built = await bun(String(dir), ...args);
      expect(built.stderr).toContain(`error: the executable would overwrite ${outfile}, which is `);
      expect(built.exitCode).toBe(1);
      expect(await Bun.file(join(String(dir), outfile)).text()).toBe(files[outfile]);
    });
  });

  test.concurrent("build --compile --aot of a script named without an extension", async () => {
    using dir = tempDir("build-keeps-script", { "serve": script });
    const built = await bun(String(dir), "build", "--compile", "--aot", ...withoutDebugInformation, "./serve");
    expect(built.stderr).toContain(
      "error: the executable would overwrite serve, which is an entry point. Choose another path with --outfile\n",
    );
    expect(built.exitCode).toBe(1);
    expect(await Bun.file(join(String(dir), "serve")).text()).toBe(script);
  });

  test.concurrent("build --compile --aot replaces a link to the entry point", async () => {
    using dir = tempDir("build-replaces-link", { "app.ts": script });
    symlinkSync("app.ts", join(String(dir), "out"));
    const args = [...withoutDebugInformation, "app.ts", "--outfile", "out"];
    const built = await bun(String(dir), "build", "--compile", "--aot", ...args);
    expect(built.stderr).not.toContain("error");
    expect(built.exitCode).toBe(0);
    expect(await Bun.file(join(String(dir), "app.ts")).text()).toBe(script);
  });

  test.concurrent("Bun.build names its own option", async () => {
    using dir = tempDir("api-keeps-sources", {
      "serve": script,
      "app.ts": script,
      "main.ts": `import { word } from "./helper";\nconsole.log(word);\n`,
      "helper.ts": `export const word = "helper";\n`,
      "build.ts": `const requests = [
  { entrypoints: ["./serve"], compile: { aot: true } },
  { entrypoints: ["./app.ts"], compile: { aot: true, outfile: "./app.ts" } },
  { entrypoints: ["./app.ts"], outdir: "./out/..", compile: { aot: true, outfile: "app.ts" } },
  { entrypoints: ["./main.ts"], compile: { aot: true, outfile: "./helper.ts" } },
];
for (const request of requests) {
  try {
    await Bun.build(request as any);
    console.log("built");
  } catch (error) {
    console.log(error.errors.map(it => it.message.replaceAll(process.cwd() + "/", "")).join());
  }
}
`,
    });
    const built = await bun(String(dir), "build.ts");
    const choose = "Choose another path with compile.outfile\n";
    expect({ stdout: built.stdout, exitCode: built.exitCode }).toEqual({
      stdout:
        `the executable would overwrite serve, which is an entry point. ${choose}` +
        `the executable would overwrite app.ts, which is an entry point. ${choose}` +
        `the executable would overwrite app.ts, which is an entry point. ${choose}` +
        `the executable would overwrite helper.ts, which is part of the program. ${choose}`,
      exitCode: 0,
    });
    for (const name of ["serve", "app.ts"]) expect(await Bun.file(join(String(dir), name)).text()).toBe(script);
    expect(await Bun.file(join(String(dir), "helper.ts")).text()).toBe(`export const word = "helper";\n`);
  });
  test.concurrent("another file is replaced", async () => {
    using dir = tempDir("compile-replaces-file", { "app.ts": `console.log("app");\n`, "notes.txt": "notes\n" });
    const built = await compile(String(dir), "app.ts", "--outfile", "notes.txt");
    expect(built.stderr).not.toContain("error");
    expect(await run(String(dir), [join(String(dir), "notes.txt")])).toEqual({
      stdout: "app\n",
      stderr: "",
      exitCode: 0,
    });
  });
});

// A rename puts the executable at its output path, and a rename replaces whatever has the name: as root,
// `--outfile=/dev/null` left a regular file in place of the null device. Windows has no device among its directory entries.
describe.skipIf(isWindows)("an executable never replaces a device", () => {
  const commands = [
    { command: ["compile", "--no-aot"], aot: false },
    { command: ["build", "--compile"], aot: false },
    ...(unsupported ? [] : ["compile", "build --compile --aot"].map(it => ({ command: it.split(" "), aot: true }))),
  ].map(it => [it.command.join(" "), it] as const);
  const files = { "app.ts": `console.log("app");\n` };
  const buildScript = `const [aot, ...outfiles] = process.argv.slice(2);
for (const outfile of outfiles) {
  try {
    await Bun.build({ entrypoints: ["./app.ts"], compile: { outfile, aot: aot === "aot" } } as any);
    console.log("built");
  } catch (error) {
    console.log(error.errors.map(it => it.message.replaceAll(process.cwd() + "/", "")).join());
  }
}
`;
  const refusal = (outfile: string, kind = "character device") =>
    `the executable would replace ${outfile}, which is a ${kind}. Choose another output path\n`;

  /** What has the name. A rename over it changes the inode, and the mode holds the kind. */
  function node(path: string) {
    const { ino, mode, rdev } = lstatSync(path);
    return { ino, mode: mode.toString(8), rdev };
  }
  function mknod(path: string, type: "c" | "b", major: number, minor: number) {
    try {
      return Bun.spawnSync({ cmd: ["mknod", path, type, `${major}`, `${minor}`], stderr: "ignore" }).exitCode === 0;
    } catch {
      return false;
    }
  }
  // A device node takes root, but for a whiteout (0, 0): any user makes one on Linux 5.8 and later, though not on overlayfs.
  const can = (() => {
    if (!isLinux) return { makeWhiteout: false, makeDevices: false };
    using dir = tempDir("compile-mknod", {});
    const make = (name: string, type: "c" | "b", major: number, minor: number) =>
      mknod(join(String(dir), name), type, major, minor);
    return {
      makeWhiteout: make("whiteout", "c", 0, 0),
      makeDevices: make("null", "c", 1, 3) && make("other", "c", 0, 1) && make("block", "b", 0, 0),
    };
  })();
  // As root every device is a scratch node: (1, 3) are the numbers of the null device of Linux, and no driver has (0, 1).
  // No root build names an entry of /dev. Without root a build can neither replace nor change one, so a link to it stands in.
  const hasDevices = isRoot ? can.makeDevices : true;
  const makeNullDevice = (path: string) =>
    isRoot ? expect(mknod(path, "c", 1, 3)).toBe(true) : symlinkSync("/dev/null", path);
  const makeDevice = (path: string) =>
    isRoot ? expect(mknod(path, "c", 0, 1)).toBe(true) : symlinkSync("/dev/zero", path);
  // The copy to another file system removes the name and makes a file, where the rename replaces it.
  const otherVolume = ["/dev/shm", "/tmp"].find(dir => {
    try {
      accessSync(dir, constants.W_OK | constants.X_OK);
      return statSync(dir).dev !== statSync(tmpdir()).dev;
    } catch {
      return false;
    }
  });

  /** Resolves to a function that resolves to every name that appeared in `dir` in between, also one that is gone again. */
  async function namesThatAppearIn(dir: string) {
    const names = new Set<string>();
    const marks = new Map<string, () => void>();
    const watcher = watch(dir, (_, name) => {
      const passed = marks.get(`${name}`);
      if (passed) passed();
      else if (name) names.add(`${name}`);
    });
    // The watcher reports names in the order they appear, so it has reported every earlier one when it reports the mark.
    const passMark = async (mark: string) => {
      const { promise, resolve } = Promise.withResolvers<void>();
      marks.set(mark, resolve);
      writeFileSync(join(dir, mark), "");
      await promise;
      rmSync(join(dir, mark));
    };
    await passMark(".start");
    names.clear();
    return async () => {
      await passMark(".end");
      watcher.close();
      return [...names];
    };
  }
  const isStagedCopy = (name: string) => name.endsWith(".bun-build");

  describe.each(commands)("bun %s", (_, { command, aot }) => {
    const build = (cwd: string, outfile: string) =>
      bun(cwd, ...command, ...withoutDebugInformation, "app.ts", "--outfile", outfile);

    test.skipIf(!hasDevices).concurrent("a character device", async () => {
      using dir = tempDir("compile-device", files);
      const cwd = String(dir);
      mkdirSync(join(cwd, "sub"));
      const out = join(cwd, "sub", "out");
      makeDevice(out);
      const before = node(out);
      const built = await build(cwd, join("sub", "out"));
      expect(built.stderr).toContain(refusal(join("sub", "out")));
      expect({
        exitCode: built.exitCode,
        out: node(out),
        beside: readdirSync(join(cwd, "sub")),
        files: readdirSync(cwd).sort(),
      }).toEqual({ exitCode: 1, out: before, beside: ["out"], files: ["app.ts", "sub"] });
    });

    test.skipIf(isRoot || !can.makeWhiteout).concurrent("a character device that any user can make", async () => {
      using dir = tempDir("compile-device", files);
      const out = join(String(dir), "out");
      expect(mknod(out, "c", 0, 0)).toBe(true);
      const before = node(out);
      const built = await build(String(dir), "out");
      expect(built.stderr).toContain(refusal("out"));
      expect({ exitCode: built.exitCode, out: node(out), files: readdirSync(String(dir)).sort() }).toEqual({
        exitCode: 1,
        out: before,
        files: ["app.ts", "out"],
      });
    });

    test.skipIf(!isRoot || !can.makeDevices).concurrent("a block device", async () => {
      using dir = tempDir("compile-device", files);
      const out = join(String(dir), "out");
      // No disk has the number (0, 0): the open that an ahead-of-time build makes at its output path fails with ENXIO.
      expect(mknod(out, "b", 0, 0)).toBe(true);
      const before = node(out);
      const built = await build(String(dir), "out");
      expect(built.stderr).toContain(refusal("out", "block device"));
      expect({ exitCode: built.exitCode, out: node(out) }).toEqual({ exitCode: 1, out: before });
    });

    // An ahead-of-time build reads the template before it builds.
    test.skipIf(!hasDevices || aot).concurrent("a device is refused before the executable is staged", async () => {
      using dir = tempDir("compile-device", files);
      makeDevice(join(String(dir), "out"));
      const build = (outfile: string) =>
        bun(String(dir), ...command, "--compile-executable-path", "app.ts", "app.ts", "--outfile", outfile);
      // Staging fails on a template that is no executable.
      expect((await build("elsewhere")).stderr).toContain("failed to write compiled executable elsewhere\n");
      const built = await build("out");
      expect(built.stderr).toContain(refusal("out"));
      expect(built.exitCode).toBe(1);
    });

    // Not concurrent: each build stages a copy of Bun.
    test.skipIf(!hasDevices)("the null device, which gets nothing", async () => {
      using dir = tempDir("compile-null", files);
      const cwd = String(dir);
      mkdirSync(join(cwd, "dev"));
      makeNullDevice(join(cwd, "dev", "null"));
      symlinkSync(join("dev", "null"), join(cwd, "link"));
      const nodes = () => ({ device: node(join(cwd, "dev", "null")), link: node(join(cwd, "link")) });
      const before = nodes();
      // Without root the device is a link already.
      for (const outfile of isRoot ? [join("dev", "null"), "link"] : [join("dev", "null")]) {
        const appeared = isLinux && [await namesThatAppearIn(cwd), await namesThatAppearIn(join(cwd, "dev"))];
        const built = await build(cwd, outfile);
        expect(built.stderr).not.toContain("error");
        // The copy is staged in the working directory: nothing is renamed into the directory of the device.
        if (appeared) {
          const [inCwd, besideDevice] = [await appeared[0](), await appeared[1]()];
          expect({ inCwd: inCwd.some(isStagedCopy), besideDevice }).toEqual({ inCwd: true, besideDevice: [] });
        }
        expect({
          exitCode: built.exitCode,
          ...nodes(),
          beside: readdirSync(join(cwd, "dev")),
          files: readdirSync(cwd).sort(),
        }).toEqual({ exitCode: 0, ...before, beside: ["null"], files: ["app.ts", "dev", "link"] });
      }
    });

    // Not concurrent: a build that replaces the device writes a copy of Bun to that file system, which can be memory.
    test.skipIf(!hasDevices || !otherVolume || aot)("a device on another file system", async () => {
      using dir = tempDir("compile-device", files);
      const volume = mkdtempSync(join(otherVolume!, "bun-compile-device-"));
      try {
        const [device, nullDevice] = [join(volume, "device"), join(volume, "null")];
        makeDevice(device);
        makeNullDevice(nullDevice);
        const before = { device: node(device), nullDevice: node(nullDevice) };
        const refused = await build(String(dir), device);
        expect(refused.stderr).toContain(refusal(device));
        const discarded = await build(String(dir), nullDevice);
        expect(discarded.stderr).not.toContain("error");
        expect({
          exitCodes: [refused.exitCode, discarded.exitCode],
          device: node(device),
          nullDevice: node(nullDevice),
          volume: readdirSync(volume).sort(),
          files: readdirSync(String(dir)),
        }).toEqual({ exitCodes: [1, 0], ...before, volume: ["device", "null"], files: ["app.ts"] });
      } finally {
        rmSync(volume, { recursive: true, force: true });
      }
    });
  });

  describe.each(unsupported ? ["no-aot"] : ["no-aot", "aot"])("Bun.build, %s", aot => {
    test.skipIf(!hasDevices).concurrent("a character device", async () => {
      using dir = tempDir("api-device", { ...files, "build.ts": buildScript });
      const cwd = String(dir);
      mkdirSync(join(cwd, "sub"));
      const [out, link] = [join(cwd, "sub", "out"), join(cwd, "link")];
      makeDevice(out);
      symlinkSync(join("sub", "out"), link);
      const before = { out: node(out), link: node(link) };
      // One path is relative, and one is absolute with another directory than the working directory. Without `aot` the
      // message names the last part of the path alone, as the one for a directory does.
      const built = await bun(cwd, "build.ts", aot, "link", out);
      expect({ stdout: built.stdout, exitCode: built.exitCode, out: node(out), link: node(link) }).toEqual({
        stdout: refusal("link") + refusal(aot === "aot" ? join("sub", "out") : "out"),
        exitCode: 0,
        ...before,
      });
      expect(readdirSync(join(cwd, "sub"))).toEqual(["out"]);
    });

    test.skipIf(!hasDevices)("the null device, which gets nothing", async () => {
      using dir = tempDir("api-null", { ...files, "build.ts": buildScript });
      const cwd = String(dir);
      mkdirSync(join(cwd, "dev"));
      makeNullDevice(join(cwd, "dev", "null"));
      const before = node(join(cwd, "dev", "null"));
      const built = await bun(cwd, "build.ts", aot, join("dev", "null"));
      expect({ stdout: built.stdout, exitCode: built.exitCode, device: node(join(cwd, "dev", "null")) }).toEqual({
        stdout: "built\n",
        exitCode: 0,
        device: before,
      });
      expect({ beside: readdirSync(join(cwd, "dev")), files: readdirSync(cwd).sort() }).toEqual({
        beside: ["null"],
        files: ["app.ts", "build.ts", "dev"],
      });
    });
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
    const built = await compile(String(dir), ...withoutCompiler);
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
    const built = await compile(String(dir), ...withoutCompiler);
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
    const built = await compile(join(String(dir), "scratch"), ...withoutCompiler);
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
    const built = await compile(join(String(dir), "src"), ...withoutCompiler, "--outfile", "../named");
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
    const built = await compile(String(dir), ...withoutCompiler);
    expect(built).toEqual({ stdout: "", stderr: `error: ${message(String(dir))}\n${usage}`, exitCode: 1 });
  });
});
