import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, normalizeBunSnapshot, tempDir } from "harness";
import { join } from "path";
import { version as reactVersion } from "react";

// process.argv[0] is the executable path with native separators.
const exe = isWindows ? bunExe().replaceAll("/", "\\") : bunExe();

// `stdin` hands the child a regular file as fd 0 (`bun run - < file`). `input`
// is written to a pipe instead (`echo input | bun run -`).
async function run(args: string[], options: { cwd?: string; stdin?: Bun.BunFile; input?: string } = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    env: bunEnv,
    cwd: options.cwd,
    stdin: options.input !== undefined ? "pipe" : (options.stdin ?? "ignore"),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (options.input !== undefined) {
    const stdin = proc.stdin as Bun.FileSink;
    stdin.write(options.input);
    stdin.end();
  }
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.each(["-e", "--print"])("bun %s", flag => {
  // Source that writes the value of `expr`: --print writes the completion
  // value of the script, -e needs a console.log.
  const print = (expr: string) => (flag === "--print" ? expr : `console.log(${expr})`);

  test.concurrent("it works", async () => {
    expect(await run([flag, print('"hello world"')])).toEqual({ stdout: "hello world\n", stderr: "", exitCode: 0 });
  });

  test.concurrent("import, tsx, require in esm, import.meta", async () => {
    const code = `import {version} from "react"; console.log(JSON.stringify({version,file:import.meta.path,require:require("react").version})); ${print("<hello>world</hello>")}`;
    const json = { version: reactVersion, file: join(process.cwd(), "[eval]"), require: reactVersion };
    expect(await run([flag, code])).toEqual({
      stdout: `${JSON.stringify(json)}\n<hello>world</hello>\n`,
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent("error has source map info 1", async () => {
    using dir = tempDir("eval-syntax-error", {});
    const { stdout, stderr, exitCode } = await run([flag, '(throw new Error("hi" as 2))'], { cwd: String(dir) });
    expect(normalizeBunSnapshot(stderr, String(dir))).toMatchInlineSnapshot(`
      "1 | (throw new Error("hi" as 2))
           ^
      error: Unexpected throw
          at <dir>/[eval]:1:2

      Bun v<bun-version>"
    `);
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  });

  // `args` follow the script on the command line. `--` is consumed.
  test.concurrent.each([
    { args: [], argv: [] },
    { args: ["abc", "def"], argv: ["abc", "def"] },
    { args: ["--", "abc", "def"], argv: ["abc", "def"] },
  ])("process.argv with $args", async ({ args, argv }) => {
    expect(await run([flag, print("JSON.stringify(process.argv)"), ...args])).toEqual({
      stdout: `${JSON.stringify([exe, ...argv])}\n`,
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent("process._eval", async () => {
    const code = print("process._eval");
    expect(await run([flag, code])).toEqual({ stdout: `${code}\n`, stderr: "", exitCode: 0 });
  });

  // The eval source is UTF-8; reading it back as Latin-1 turns every
  // multi-byte character into mojibake. The expected text is compared here
  // in the parent -- comparing inside the child would pass either way, since
  // a Latin-1-decoded source corrupts the literal and process._eval alike.
  test.concurrent("process._eval round-trips multi-byte UTF-8", async () => {
    const code = `${print("process._eval")} /* 한글-🎉-café */`;
    expect(await run([flag, code])).toEqual({ stdout: `${code}\n`, stderr: "", exitCode: 0 });
  });

  test.concurrent("does not crash in non-latin1 directory", async () => {
    using dir = tempDir("eval-test-开始学习", { "index.js": "console.log('hello world')" });
    expect(await run([flag, "import './index.js'"], { cwd: String(dir) })).toEqual({
      stdout: `hello world\n${flag === "--print" ? "undefined\n" : ""}`,
      stderr: "",
      exitCode: 0,
    });
  });
});

describe("--print for cjs/esm", () => {
  test.concurrent("eval result between esm imports", async () => {
    using dir = tempDir("eval-esm-imports", { "foo.js": "'foo'", "bar.js": "'bar'" });
    expect(await run(["--print", 'import "./foo.js"; 123; import "./bar.js"'], { cwd: String(dir) })).toEqual({
      stdout: "123\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // https://github.com/oven-sh/bun/issues/30207: the completion value survives
  // a top-level await.
  test.concurrent.each([
    ["(await 1) + 1", "2"],
    ['await Promise.resolve("hello") + " world"', "hello world"],
    ["(await 1) + (await 2)", "3"],
    ["1 + 1", "2"],
  ])("bun -p %s prints %s", async (expr, expected) => {
    expect(await run(["-p", expr])).toEqual({ stdout: `${expected}\n`, stderr: "", exitCode: 0 });
  });

  // A CommonJS global in the source makes the script CommonJS. The completion
  // value is still printed.
  test.concurrent.each([
    ["forced cjs", "module.exports; 123", "123\n"],
    [
      "module, exports, require, __filename, __dirname",
      "console.log(typeof module, typeof exports, typeof require, typeof __filename, typeof __dirname); 123",
      "object object function string string\n123\n",
    ],
    [
      "module._compile is require('module').prototype._compile",
      "module._compile === require('module').prototype._compile",
      "true\n",
    ],
  ])("%s", async (_name, code, stdout) => {
    expect(await run(["--print", code])).toEqual({ stdout, stderr: "", exitCode: 0 });
  });

  // The hoist patterns in [install] are regexes. Compiling them while
  // bunfig.toml loaded initialized JSC before `bun -p` could turn on eval
  // mode, so the script's completion value was dropped and every --print
  // printed undefined.
  describe.each(["hoistPattern", "publicHoistPattern"])("with install.%s in bunfig.toml", key => {
    test.concurrent.each([
      ["Math.max(1, 9)", "9"],
      ["[1, 2].map(x => x * 2)", "[ 2, 4 ]"],
      ["1 + 1", "2"],
      ["(await 1) + 1", "2"],
    ])("bun -p %s", async (expr, expected) => {
      using dir = tempDir("eval-install-pattern", {
        "bunfig.toml": `[install]\n${key} = ["*eslint*", "!eslint-plugin-*"]\n`,
      });
      expect(await run(["-p", expr], { cwd: String(dir) })).toEqual({
        stdout: `${expected}\n`,
        stderr: "",
        exitCode: 0,
      });
    });
  });
});

// `bun run -` reads the script from stdin, from a regular file or from a pipe.
describe.each([
  ["bun run - < file-path.js", "file"],
  ["echo | bun run -", "pipe"],
])("%s", (_name, stdinKind) => {
  async function runStdin(code: string) {
    if (stdinKind === "pipe") return await run(["run", "-"], { input: code });
    using dir = tempDir("bun-run-stdin", { "stdin.js": code });
    return await run(["run", "-"], { stdin: Bun.file(join(String(dir), "stdin.js")) });
  }

  test.concurrent.each([
    ["it works", 'console.log("hello world")', "hello world\n"],
    ["it gets a correct specifier", "console.log(import.meta.path)", `${join(process.cwd(), "[stdin]")}\n`],
    [
      "it can require",
      'const process = require("node:process"); console.log(process.platform);',
      `${process.platform}\n`,
    ],
    [
      "it can import",
      'import * as process from "node:process"; console.log(process.platform);',
      `${process.platform}\n`,
    ],
    ["process.argv", "console.log(JSON.stringify(process.argv))", `${JSON.stringify([exe, "-"])}\n`],
    ["process._eval", "console.log(process._eval)", "console.log(process._eval)\n"],
  ])("%s", async (_name, code, stdout) => {
    expect(await runStdin(code)).toEqual({ stdout, stderr: "", exitCode: 0 });
  });
});

test.concurrent("process._eval (undefined for normal run)", async () => {
  using dir = tempDir("eval-normal-run", { "test.js": "console.log(typeof process._eval)" });
  expect(await run(["run", "test.js"], { cwd: String(dir) })).toEqual({
    stdout: "undefined\n",
    stderr: "",
    exitCode: 0,
  });
});

// The presence of require() makes the eval source evaluate as CommonJS, which
// used to swallow a top-level throw entirely: no stderr output and exit code 0.
test.concurrent("uncaught error from a CommonJS-sniffed eval entry reports and exits 1", async () => {
  using dir = tempDir("eval-cjs-uncaught", {});
  const { stdout, stderr, exitCode } = await run(["-e", `require("assert"); throw new Error("eval-cjs-uncaught");`], {
    cwd: String(dir),
  });
  expect(normalizeBunSnapshot(stderr, String(dir))).toMatchInlineSnapshot(`
    "1 | require("assert"); throw new Error("eval-cjs-uncaught");
                                     ^
    error: eval-cjs-uncaught
          at <dir>/[eval]:1:30

    Bun v<bun-version>"
  `);
  expect(stdout).toBe("");
  expect(exitCode).toBe(1);
});

test.concurrent("uncaught error from a CommonJS-sniffed stdin entry reports and exits 1", async () => {
  using dir = tempDir("stdin-cjs-uncaught", {});
  const { stdout, stderr, exitCode } = await run(["-"], {
    cwd: String(dir),
    input: `require("assert"); throw new Error("stdin-cjs-uncaught");`,
  });
  expect(normalizeBunSnapshot(stderr, String(dir))).toMatchInlineSnapshot(`
    "1 | require("assert"); throw new Error("stdin-cjs-uncaught");
                                     ^
    error: stdin-cjs-uncaught
          at <dir>/[stdin]:1:30

    Bun v<bun-version>"
  `);
  expect(stdout).toBe("");
  expect(exitCode).toBe(1);
});
