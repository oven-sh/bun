import { dlopen } from "bun:ffi";
import { afterAll, describe, expect, test } from "bun:test";
import {
  bunEnv,
  bunExe,
  isASAN,
  isDebug,
  isLinux,
  isMacOS,
  isMusl,
  isWindows,
  normalizeBunSnapshot,
  tempDir,
} from "harness";
import {
  chmodSync,
  chownSync,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, parse, posix, sep, win32 } from "node:path";
import { endChildren, spawn } from "../children";
import { configurations } from "./oracle/plugins/oxlint/compare-options";
import whatOxlintReports from "./oracle/plugins/oxlint/expected.json";
import { directoryOf, filesOf, cases as fixCases, flagSets } from "./oracle/plugins/oxlint/fixes";
import fixDifferences from "./oracle/plugins/oxlint/fixes.differences.json";
import whatOxlintFixes from "./oracle/plugins/oxlint/fixes.expected.json";
import whatOxlintMarks from "./oracle/plugins/oxlint/labels.json";
import { filesOf as filesOfMessages, helpsOf, entries as messages, messagesOf } from "./oracle/plugins/oxlint/messages";
import optionsOfOxlint from "./oracle/plugins/oxlint/options.json";
import { labelsOf, projects } from "./oracle/plugins/oxlint/projects";

afterAll(endChildren);

const command = [bunExe(), "lint"];

// Disable AI agent and CI detection regardless of the environment the tests run in.
const env = {
  ...bunEnv,
  AGENT: "0",
  CLAUDECODE: undefined,
  REPL_ID: undefined,
  GITHUB_ACTIONS: undefined,
  GITHUB_WORKSPACE: undefined,
  NO_COLOR: undefined,
  FORCE_COLOR: undefined,
};

const config = (rules: Record<string, unknown>) => `export default [{ rules: ${JSON.stringify(rules)} }];\n`;
const basic = config({
  "no-debugger": "error",
  "no-unused-vars": "warn",
  eqeqeq: "error",
  semi: "error",
  "no-var": "warn",
});
const bad = "var a = 1\nif (a == 2) { debugger; }\n";

type Options = {
  cwd?: string;
  stdin?: string;
  env?: Record<string, string | undefined>;
  /** Files to read when the command has run. */
  reads?: string[];
  /** Called with the directory before the command runs. */
  before?: (dir: string) => void;
  /** The run is meant to end with an error. */
  mayFail?: boolean;
};

async function lint(files: Record<string, string>, args: string[], options: Options = {}) {
  using dir = tempDir("bun-lint", files);
  options.before?.(String(dir));
  await using proc = spawn({
    cmd: [...command, ...args],
    env: { ...env, ...options.env },
    cwd: join(String(dir), options.cwd ?? "."),
    stdin: options.stdin === undefined ? "ignore" : Buffer.from(options.stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // Where a run ends with an error, or dies, the assertion that fails is often about something else.
  if (exitCode !== 0 && exitCode !== 1 && !options.mayFail)
    console.error(`bun lint ${args.join(" ")}: exit code ${exitCode}\n${stderr}`);
  const read = (name: string) =>
    existsSync(join(String(dir), name)) ? readFileSync(join(String(dir), name), "utf8") : null;
  return {
    raw: stdout,
    stdout: normalizeBunSnapshot(stdout, String(dir)),
    stderr: normalizeBunSnapshot(stderr, String(dir)),
    exitCode,
    files: Object.fromEntries((options.reads ?? []).map(name => [name, read(name)])),
  };
}

/** The same in a directory that is there, with nothing in the output replaced. */
async function run(cwd: string, args: string[]) {
  const stdio = { stdin: "ignore", stdout: "pipe", stderr: "pipe" } as const;
  await using proc = spawn({ cmd: [...command, ...args], env, cwd, ...stdio });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, lines: stdout.split("\n").filter(Boolean), stderr, exitCode };
}

// `bun lint --run-path-tests` is compiled into debug and canary builds only.
const hasRunner = isDebug || Bun.spawnSync({ cmd: [bunExe(), "--revision"], env: bunEnv }).stdout.includes("canary");

describe.concurrent("bun lint", () => {
  test("prints problems like ESLint's stylish formatter and exits with 1", async () => {
    const { stdout, stderr, exitCode } = await lint(
      { "eslint.config.js": basic, "a.js": bad, "b.js": "export {};\n" },
      [],
    );
    expect(stdout).toMatchInlineSnapshot(`
      "<dir>/a.js
        1:1   warning  Unexpected var, use let or const instead  no-var
        1:10  error    Missing semicolon                         semi
        2:7   error    Expected '===' and instead saw '=='       eqeqeq
        2:15  error    Unexpected 'debugger' statement           no-debugger

      ✖ 4 problems (3 errors, 1 warning)
        1 error and 1 warning potentially fixable with the \`--fix\` option."
    `);
    expect(stderr).toMatchInlineSnapshot(`"Linted 3 files"`);
    expect(exitCode).toBe(1);
  });

  test("prints nothing on stdout and exits with 0 if there are no problems", async () => {
    const { raw, stderr, exitCode } = await lint({ "eslint.config.js": basic, "a.js": "export const a = 1;\n" }, []);
    expect(raw).toBe("");
    expect(stderr).toMatchInlineSnapshot(`"✓ No problems in 2 files"`);
    expect(exitCode).toBe(0);
  });

  test("warnings alone do not fail, unless --max-warnings says so", async () => {
    const files = { "eslint.config.js": basic, "a.js": "let unused = 1;\n" };
    const [plain, limited] = await Promise.all([lint(files, []), lint(files, ["--max-warnings", "0"])]);
    expect(plain.stdout).toMatchInlineSnapshot(`
      "<dir>/a.js
        1:5  warning  'unused' is assigned a value but never used  no-unused-vars

      ✖ 1 problem (0 errors, 1 warning)"
    `);
    expect(limited.stdout).toBe(plain.stdout);
    expect(limited.stderr).toContain("Found too many warnings (maximum: 0).");
    expect({ plain: plain.exitCode, limited: limited.exitCode }).toEqual({ plain: 0, limited: 1 });
  });

  test("--color", async () => {
    const { raw, exitCode } = await lint({ "eslint.config.js": basic, "a.js": "debugger;\n" }, ["--color", "a.js"]);
    expect(raw.slice(raw.indexOf("a.js"))).toBe(
      "a.js\x1b[24m\n  \x1b[2m1:1\x1b[22m  \x1b[31merror\x1b[39m  Unexpected 'debugger' statement  \x1b[2mno-debugger\x1b[22m\n\n" +
        "\x1b[31m\x1b[1m✖ 1 problem (1 error, 0 warnings)\x1b[22m\x1b[39m\n\x1b[0m\n",
    );
    expect(exitCode).toBe(1);
  });

  test("without a configuration file: what `bun test` has without an import is defined in the files that it takes", async () => {
    const names =
      "test it describe expect expectTypeOf beforeAll beforeEach afterEach afterAll jest vi xit xtest xdescribe";
    const code = `[${names.split(" ").join(", ")}];\n`;
    const taken = ["a.test.js", "src/b_test.mjs", "c.spec.jsx", "d_spec.cjs"];
    const others = ["test.js", "e.tests.js", "atest.js"];
    const files = Object.fromEntries([...taken, ...others].map(name => [name, code]));
    const { stdout } = await lint(files, ["-f", "unix"]);
    const undefinedIn = (name: string) =>
      stdout.split("\n").filter(line => line.startsWith(`<dir>/${name}:`) && line.endsWith("[Error/no-undef]")).length;
    expect([taken.map(undefinedIn), others.map(undefinedIn)]).toEqual([
      [0, 0, 0, 0],
      [14, 14, 14],
    ]);
  });

  describe("the globals of a file are what the types of its project declare", () => {
    const options = (lib: string[], more: object) => JSON.stringify({ compilerOptions: { lib, types: [], ...more } });
    const files = {
      // In no project.
      "a/a.js": "console.log(window, process, Bun, nothing);\n",
      "b/jsconfig.json": options(["es2022"], { checkJs: true }),
      "b/a.js": "console.log(window, process, Bun, nothing, Promise, Map);\n",
      "c/tsconfig.json": options(["es2022", "dom"], { checkJs: true }),
      "c/types/g.d.ts":
        "declare global {\n  var MY_GLOBAL: string;\n  const MY_CONST: number;\n  interface OnlyAType {\n    a: 1;\n  }\n}\nexport {};\n",
      "c/a.js":
        "console.log(window, process, MY_GLOBAL, MY_CONST, OnlyAType, nothing);\nMY_CONST = 1;\nMY_GLOBAL = 'a';\n" +
        "/* global process, window: off */\n",
      // The project does not take it in.
      "d/tsconfig.json": options(["es2022"], {}),
      "d/build.js": "console.log(window, process, require, nothing);\n",
      "d/x.ts": "export const a = 1;\n",
    };
    const reports = (stdout: string) =>
      stdout
        .split("\n")
        .flatMap(line => /^<dir>\/(\S+?:\d+:\d+): .*?'(\w+)'.* \[Error\/(.*)\]$/.exec(line)?.slice(1).join(" ") ?? []);
    const union = ["a/a.js:1:35 nothing no-undef", "d/build.js:1:39 nothing no-undef"];

    test("without a configuration file, with --infer-globals", async () => {
      const [inferred, not] = await Promise.all([
        lint(files, ["-f", "unix", "--infer-globals"]),
        lint(files, ["-f", "unix"]),
      ]);
      expect(reports(inferred.stdout).sort()).toEqual(
        [
          ...union,
          "b/a.js:1:1 console no-undef",
          "b/a.js:1:13 window no-undef",
          "b/a.js:1:21 process no-undef",
          "b/a.js:1:35 nothing no-undef",
          "c/a.js:1:13 window no-undef",
          "c/a.js:1:51 OnlyAType no-undef",
          "c/a.js:1:62 nothing no-undef",
          "c/a.js:2:1 MY_CONST no-global-assign",
        ].sort(),
      );
      expect(reports(not.stdout).sort()).toEqual(
        [
          ...union,
          "b/a.js:1:35 nothing no-undef",
          "c/a.js:1:13 window no-undef",
          "c/a.js:1:30 MY_GLOBAL no-undef",
          "c/a.js:1:41 MY_CONST no-undef",
          "c/a.js:1:51 OnlyAType no-undef",
          "c/a.js:1:62 nothing no-undef",
          "c/a.js:2:1 MY_CONST no-undef",
          "c/a.js:3:1 MY_GLOBAL no-undef",
          "c/a.js:4:11 process no-redeclare",
        ].sort(),
      );
    });

    // TypeScript knows the three in JavaScript without a declaration.
    test("`require`, `module` and `exports` are defined in a JavaScript file that is no ES module", async () => {
      const { stdout } = await lint(
        {
          "tsconfig.json": options(["es2022"], { checkJs: true }),
          "a.js": "module.exports = require('x');\nexports.a = __dirname;\n",
          "b.js": "export default require('x');\nmodule;\n",
        },
        ["-f", "unix", "--infer-globals"],
      );
      expect(reports(stdout).sort()).toEqual([
        "a.js:2:13 __dirname no-undef",
        "b.js:1:16 require no-undef",
        "b.js:2:1 module no-undef",
      ]);
    });

    test("beside a configuration file only with --infer-globals, and besides what it has", async () => {
      const config = `export default [{
        languageOptions: { globals: { nothing: "readonly", MY_CONST: "off" } },
        rules: { "no-undef": "error", "no-global-assign": "error" },
      }];`;
      const all = { ...files, "eslint.config.mjs": config };
      const [not, inferred] = await Promise.all([
        lint(all, ["-f", "unix", "c"]),
        lint(all, ["-f", "unix", "--infer-globals", "c"]),
      ]);
      expect(reports(not.stdout).sort()).toEqual(
        [
          "c/a.js:1:1 console no-undef",
          "c/a.js:1:13 window no-undef",
          "c/a.js:1:30 MY_GLOBAL no-undef",
          "c/a.js:1:41 MY_CONST no-undef",
          "c/a.js:1:51 OnlyAType no-undef",
          "c/a.js:2:1 MY_CONST no-undef",
          "c/a.js:3:1 MY_GLOBAL no-undef",
        ].sort(),
      );
      expect(reports(inferred.stdout).sort()).toEqual(
        [
          "c/a.js:1:13 window no-undef",
          "c/a.js:1:41 MY_CONST no-undef",
          "c/a.js:1:51 OnlyAType no-undef",
          "c/a.js:2:1 MY_CONST no-undef",
        ].sort(),
      );
    });
  });

  test("--stdin: what only the parser of the configuration can read is named, as for a file", async () => {
    const files = {
      "eslint.config.mjs": `export default [{
        languageOptions: { parser: { meta: { name: "@babel/eslint-parser" }, parseForESLint() { throw new Error("called"); } } },
        rules: { "no-var": "error" },
      }];`,
    };
    const [read, unread] = await Promise.all([
      lint(files, ["-f", "unix", "--stdin", "--stdin-filename", "a.mjs"], { stdin: "var a = 1;\nexport { a };\n" }),
      lint(files, ["-f", "unix", "--stdin", "--stdin-filename", "b.mjs"], {
        stdin: "const b = await import.source('./b.wasm');\nexport { b };\n",
        mayFail: true,
      }),
    ]);
    expect(read.stdout).toContain("<dir>/a.mjs:1:1: Unexpected var, use let or const instead. [Error/no-var]");
    expect(unread.stderr).toContain("1 file was not linted, only the parser of the configuration can read it: b.mjs.");
    expect([read.exitCode, unread.exitCode]).toEqual([1, 2]);
  });

  // As ESLint 10.12 and oxlint 1.87.
  test.each(["eslint.config.mjs", "oxlint.config.ts"])(
    "`process.cwd()` in %s is where the command runs, not where the file is",
    async name => {
      const rules = `{ "no-debugger": basename(process.cwd()) === "sub" ? "error" : "off" }`;
      const config = name.startsWith("eslint") ? `[{ rules: ${rules} }]` : `{ rules: ${rules} }`;
      const files = {
        [name]: `import { basename } from "node:path";\nexport default ${config};\n`,
        "sub/a.js": "debugger;\n",
      };
      const [below, beside] = await Promise.all([lint(files, ["a.js"], { cwd: "sub" }), lint(files, ["sub/a.js"])]);
      expect([below.exitCode, beside.exitCode]).toEqual([1, 0]);
    },
  );

  test("without a configuration file: eslint:recommended, and typescript-eslint/recommended for TypeScript", async () => {
    const { stdout, exitCode } = await lint(
      {
        "a.js": "console.log(Bun.version, process.argv, window);\nlet unused;\nundefinedName();\n",
        "b.ts": "export const a: any = 1;\nundefinedName();\n",
        "c.jsx": "export default () => <div />;\n",
        "node_modules/pkg/index.js": "debugger;\n",
        "dist/bundle.js": "debugger;\n",
        "vendor.min.js": "debugger;\n",
        ".gitignore": "dist\n",
      },
      [],
    );
    expect(stdout).toMatchInlineSnapshot(`
      "<dir>/a.js
        2:5  error  'unused' is defined but never used  no-unused-vars
        3:1  error  'undefinedName' is not defined      no-undef

      <dir>/b.ts
        1:17  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

      ✖ 3 problems (3 errors, 0 warnings)"
    `);
    expect(exitCode).toBe(1);
  });

  // What a file is like while it is being written. TypeScript's parser goes on and leaves these to its checker.
  test.each([
    ["eslint.config.js", config({})],
    [".oxlintrc.json", "{}"],
  ])("JavaScript in which a name is missing is a parsing error, with %s", async (name, text) => {
    const codes = [
      "let x = 1;\nconst",
      "export var",
      "for (const of a);",
      "class extends A {}",
      "class A extends {}",
      "x = {a?: 1}",
      "x = {async a}",
      "class A { async a }",
      "try {} catch (a = 1) {}",
      "let a!",
      "function f(this) {}",
      `declare module "a"`,
      "export as namespace a",
    ];
    const files = Object.fromEntries(codes.map((code, i) => [`a${i}.js`, code + "\n"]));
    const { stdout, exitCode } = await lint({ [name]: text, ...files }, ["-f", "unix", ...Object.keys(files)]);
    expect(
      stdout
        .split("\n")
        .filter(line => line.endsWith(" [Error]"))
        .map(line => line.match(/a\d+\.js/)?.[0]),
    ).toEqual(Object.keys(files).sort());
    expect(exitCode).toBe(1);
  });

  // oxc reads these. espree, typescript-estree and tsc do not.
  test("what only oxc parses is linted with .oxlintrc.json, and a parsing error with eslint.config.js", async () => {
    const files = {
      "a.js": 'import source x from "m";\ndebugger;\n',
      "b.ts": 'import source x from "m";\ndebugger;\n',
      "c.js": 'import.source("m");\ndebugger;\n',
      "d.tsx": "<>\n<\n/>;\ndebugger;\n",
    };
    const names = Object.keys(files);
    const lines = (stdout: string) => stdout.split("\n").filter(line => /^\S*[a-d]\.\w+:\d/.test(line));
    const rules = { "no-debugger": "error" };
    const ofOxlint = JSON.stringify({ categories: { correctness: "off" }, rules });
    const ofEslint = `export default [{ files: ["**/*.{js,ts,tsx}"], rules: ${JSON.stringify(rules)} }];\n`;
    const [oxlint, eslint] = await Promise.all([
      lint({ ".oxlintrc.json": ofOxlint, ...files }, ["-f", "unix", ...names]),
      lint({ "eslint.config.js": ofEslint, ...files }, ["-f", "unix", ...names]),
    ]);
    expect(lines(oxlint.stdout).map(line => /no-debugger/.test(line))).toEqual([true, true, true, true]);
    expect(lines(eslint.stdout).map(line => /Parsing error: /.test(line))).toEqual([true, true, true, true]);
  });

  // Each row is what oxlint 1.87 does.
  test("with .oxlintrc.json a file is a script if nothing in it says that it is a module", async () => {
    const name = "var await = 1; f(await);\n";
    const comments = "var a; <!-- c\n--> d\n";
    const linted = {
      "a.js": name,
      "a.ts": name,
      "a.tsx": name,
      "a.cjs": name,
      "a.cts": name,
      "b.js": comments,
      "b.ts": comments,
      "b.cts": comments,
    };
    const refused = {
      "c.mjs": name,
      "c.mts": name,
      "d.mjs": comments,
      "d.mts": comments,
      "e.js": `export {};\nf(await);\n`,
      "e.ts": `export {};\nf(await);\n`,
      "f.js": `export {};\n${comments}`,
      // A module by its `await`, and no script with it.
      "g.js": `await f();\n${comments}`,
      "g.ts": `await f();\n${comments}`,
      "h.js": "var await = 1; let x = ;\n",
    };
    const settings = JSON.stringify({ categories: { correctness: "off" }, rules: {} });
    const files = { ...linted, ...refused };
    const { stdout, exitCode } = await lint({ ".oxlintrc.json": settings, ...files }, [
      "-f",
      "unix",
      ...Object.keys(files),
    ]);
    const reported = stdout.split("\n").flatMap(line => line.match(/^([a-h]\.\w+):\d+:\d+: .* \[Error\]$/)?.[1] ?? []);
    expect([...new Set(reported)].sort()).toEqual(Object.keys(refused).sort());
    expect(exitCode).toBe(1);
  });

  // Each is what ESLint says with espree. At the `<` of the first two the parser went round until its stack was used up.
  test("which error of broken JavaScript is reported, and where", async () => {
    const cases: Record<string, [code: string, error?: string]> = {
      "a0.js": ["{} while (a)< {}", "1:13: Parsing error: Unexpected token <"],
      "a1.js": ["var arr =< [, ,];", "1:10: Parsing error: Unexpected token <"],
      "a2.js": ["foo(#a)", "1:5: Parsing error: Unexpected token #a"],
      "a3.js": ["import.m\\u0065ta;", "1:1: Parsing error: 'import.meta' must not contain escaped characters"],
      "a4.js": [
        "import.d\\u0065fer('a');",
        "1:8: Parsing error: The only valid meta property for import is 'import.meta'",
      ],
      "a5.cjs": [
        'import { a } om "foo"',
        "1:1: Parsing error: 'import' and 'export' may appear only with 'sourceType: module'",
      ],
      // acorn skips a comment before the string of an attribute, which can have a line break.
      "a6.jsx": ['<a b=/* c */"x\ny" />;'],
      "a7.js": ["a = => 1;", "1:5: Parsing error: Unexpected token =>"],
      // What is in parentheses is no mix with `??`, however many parentheses follow it.
      "a8.js": ["(a || b) ?? ((c)); (a && b) ?? [((c))]; f((a || b) ?? !((c)));"],
    };
    const files = Object.fromEntries(Object.entries(cases).map(([name, [code]]) => [name, code + "\n"]));
    const settings = `export default [
      { files: ["**/*.js", "**/*.cjs", "**/*.jsx"], rules: {} },
      { files: ["**/*.jsx"], languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } } },
    ];`;
    const { stdout, exitCode } = await lint({ "eslint.config.js": settings, ...files }, [
      "-f",
      "unix",
      ...Object.keys(files),
    ]);
    expect(
      stdout
        .split("\n")
        .filter(line => line.includes("Parsing error"))
        .map(line => line.replace(/^.*\/(a\d\.\w+):/, "$1:").replace(" [Error]", "")),
    ).toEqual(Object.entries(cases).flatMap(([name, [, error]]) => (error ? [`${name}:${error}`] : [])));
    expect(exitCode).toBe(1);
  });

  describe("which files", () => {
    const files = {
      "eslint.config.js": config({ "no-debugger": "error" }),
      "a.js": "debugger;\n",
      "src/b.mjs": "debugger;\n",
      "src/c.cjs": "debugger;\n",
      "src/d.ts": "debugger;\n",
      "src/.hidden/e.js": "debugger;\n",
      "src/deep/f.js": "debugger;\n",
      "node_modules/pkg/g.js": "debugger;\n",
      "readme.md": "debugger;\n",
    };
    const listed = async (args: string[], options?: Options) => {
      const { stdout, exitCode } = await lint(files, ["--list-files", ...args], options);
      return { files: stdout.split("\n").filter(Boolean), exitCode };
    };

    test("the working directory by default", async () => {
      expect(await listed([])).toEqual({
        files: [
          "<dir>/a.js",
          "<dir>/eslint.config.js",
          "<dir>/src/.hidden/e.js",
          "<dir>/src/b.mjs",
          "<dir>/src/c.cjs",
          "<dir>/src/deep/f.js",
        ],
        exitCode: 0,
      });
    });

    test("files, directories and patterns", async () => {
      expect(
        await Promise.all([listed(["a.js", "src/deep"]), listed(["src/*.{mjs,cjs}"]), listed(["**/f.js"])]),
      ).toEqual([
        { files: ["<dir>/a.js", "<dir>/src/deep/f.js"], exitCode: 0 },
        { files: ["<dir>/src/b.mjs", "<dir>/src/c.cjs"], exitCode: 0 },
        { files: ["<dir>/src/deep/f.js"], exitCode: 0 },
      ]);
    });

    test("--ext", async () => {
      expect(await listed(["--ext", ".ts", "src/d.ts", "src/deep"])).toEqual({
        files: ["<dir>/src/d.ts", "<dir>/src/deep/f.js"],
        exitCode: 0,
      });
    });

    test("--ignore-pattern", async () => {
      expect(await listed(["--ignore-pattern", "src/deep/", "--ignore-pattern", "**/*.mjs", "src"])).toEqual({
        files: ["<dir>/src/.hidden/e.js", "<dir>/src/c.cjs"],
        exitCode: 0,
      });
    });

    test("from a subdirectory, with the configuration above", async () => {
      expect(await listed([], { cwd: "src/deep" })).toEqual({ files: ["<dir>/src/deep/f.js"], exitCode: 0 });
    });

    test.skipIf(isWindows)("a named pipe with the name of a script is passed over", async () => {
      const { stdout, exitCode } = await lint({ "eslint.config.js": basic, "a.js": bad }, ["-f", "unix", "."], {
        before: dir => expect(Bun.spawnSync(["mkfifo", join(dir, "pipe.js")]).exitCode).toBe(0),
      });
      expect(stdout).toContain("<dir>/a.js:1:1: ");
      expect(stdout).not.toContain("pipe.js");
      expect(exitCode).toBe(1);
    });

    test("a link to a file is linted, a link to a directory is not followed", async () => {
      const before = (dir: string) => {
        symlinkSync(join("..", "..", "a.js"), join(dir, "src/deep/link.js"), "file");
        symlinkSync("deep", join(dir, "src/linked"), "dir");
      };
      expect(await listed(["src/deep", "src/linked/.."], { before })).toEqual({
        files: [
          "<dir>/src/.hidden/e.js",
          "<dir>/src/b.mjs",
          "<dir>/src/c.cjs",
          "<dir>/src/deep/f.js",
          "<dir>/src/deep/link.js",
        ],
        exitCode: 0,
      });
    });

    // A junction takes no privilege on Windows. Elsewhere it is a link like any other.
    test("a link to a directory is not followed, on Windows neither", async () => {
      const before = (dir: string) => symlinkSync(join(dir, "src", "deep"), join(dir, "src", "linked"), "junction");
      expect(await listed(["src"], { before })).toEqual({
        files: ["<dir>/src/.hidden/e.js", "<dir>/src/b.mjs", "<dir>/src/c.cjs", "<dir>/src/deep/f.js"],
        exitCode: 0,
      });
    });

    // Every snapshot above has `/` for `\\`, so none of them can tell.
    test("paths are printed as the system writes them", async () => {
      const inDirectory = async (args: string[]) => {
        let root = "";
        const { raw } = await lint(files, args, { before: dir => void (root = dir) });
        return { raw, root, file: join(root, "src", "deep", "f.js") };
      };
      const [json, unix, stylish, list] = await Promise.all([
        inDirectory(["-f", "json-with-metadata", "src/deep"]),
        inDirectory(["-f", "unix", "src/deep"]),
        inDirectory(["src/deep"]),
        inDirectory(["--list-files", "src/deep"]),
      ]);
      const { results, metadata } = JSON.parse(json.raw);
      expect(results.map((it: { filePath: string }) => it.filePath)).toEqual([json.file]);
      expect(metadata.cwd).toBe(json.root);
      expect(unix.raw).toStartWith(`${unix.file}:1:1: `);
      expect(stylish.raw).toStartWith(`\n${stylish.file}\n`);
      expect(list.raw).toBe(`${list.file}\n`);
    });

    test.skipIf(!hasRunner)("paths are computed as by node:path, those of Windows on every system", async () => {
      // Not where a `package.json` has a script `lint`.
      using dir = tempDir("bun-lint", {});
      const cases = {
        windows: {
          resolve: [
            ["C:/proj", "."],
            ["C:/", "."],
            ["C:/proj", ".."],
            ["C:/proj", "../.."],
            ["C:/proj", "src/../a.js"],
            ["C:/proj", "D:/x"],
            ["C:/proj", "/src/a.js"],
            ["C:/proj", "C:src/a.js"],
            ["C:/proj", "c:src"],
            ["//server/share/proj", "."],
            ["//server/share/proj", "../.."],
            ["//server/share/", "a.js"],
            ["//server/share/proj", "/a.js"],
            ["C:/proj", "//server/share"],
            ["C:/proj", "//server//share/a"],
            ["C:/proj", "//server"],
            ["C:/proj", "//?/C:/a"],
          ],
          relative: [
            ["c:/proj", "C:/proj/a.js"],
            ["C:/Proj/Src", "c:/proj/lib/x.js"],
            ["C:/proj", "C:/proj"],
            ["C:/proj", "C:/project/a.js"],
            ["C:/proj", "D:/x/a.js"],
            ["C:/", "C:/a.js"],
            ["//server/share/a", "//SERVER/share/b/c.js"],
            ["//server/share/", "//server/share/a.js"],
            ["//server/share/a", "//server/other/a"],
            ["//server/share/a", "//other/share/a"],
          ],
          dirname: [["C:/a/b"], ["C:/a"], ["C:/"], ["//server/share/a"], ["//server/share/"]],
          normalize: [["C:/a/../b/./c/"], ["C:/.."], ["//server/share/a/.."], ["C:a/.."]],
          join: [
            ["C:/a", "../b"],
            ["C:/a/", "/b/"],
            ["//server/share", "a"],
            ["C:/", ""],
          ],
          namespaced: [
            ["C:/a/b"],
            ["C:\\a\\b"],
            ["C:/"],
            ["C:/a/../b/./c"],
            ["//server/share/a"],
            ["//server/share/"],
            ["\\\\?\\C:\\a"],
          ],
        },
        posix: {
          resolve: [
            ["/proj", "../a"],
            ["/", "."],
            ["/proj", "C:/x"],
            ["/proj", "//server/share"],
            ["/proj", "/a/./b/.."],
          ],
          relative: [
            ["/Proj", "/proj/a.js"],
            ["/proj", "/proj/a.js"],
            ["/", "/a.js"],
            ["/a/b", "/a/c/d"],
            ["/a", "/a"],
          ],
          dirname: [["/a/b"], ["/a"], ["/"]],
          normalize: [["/a/../b/./c/"], ["a//b/.."], ["./a"], ["../../a/.."], [""]],
          join: [
            ["/a", "../b"],
            ["a", "b/"],
            ["", ""],
            ["pkg", "./x/../y"],
          ],
        },
      };
      for (const [style, path] of [
        ["windows", win32],
        ["posix", posix],
      ] as const) {
        const all = Object.entries(cases[style]).flatMap(([name, list]) => list.map(([a, b = "."]) => [name, a, b]));
        const expected = all.map(([name, a, b]) => {
          if (name === "namespaced") return path.toNamespacedPath(a);
          if (name === "normalize") return path.normalize(a).replaceAll("\\", "/");
          const answer = name === "dirname" ? path.dirname(a) : path[name as "resolve" | "relative" | "join"](a, b);
          return answer.replaceAll("\\", "/");
        });
        const { stdout, exitCode } = await run(String(dir), ["--run-path-tests", style, ...all.flat()]);
        const answers = stdout.split("\n").slice(0, -1);
        expect(all.map((it, i) => [...it, answers[i]])).toEqual(all.map((it, i) => [...it, expected[i]]));
        expect(exitCode).toBe(0);
      }
      // A path on another drive that does not start at its root is from the working directory, which is that of the process.
      const script = `console.log(require("node:path").win32.resolve("C:/proj", "D:a").replaceAll("\\\\", "/"))`;
      const ofNode = Bun.spawnSync({ cmd: [bunExe(), "-e", script], cwd: String(dir), env });
      const onOtherDrive = await run(String(dir), ["--run-path-tests", "windows", "resolve", "C:/proj", "D:a"]);
      expect(onOtherDrive.stdout).toBe(ofNode.stdout.toString());
      const inside = ["c:/proj", "C:/PROJ/a.js", "C:/proj", "C:/project/a.js", "C:/", "c:/a.js"].flatMap((it, i) =>
        i % 2 ? [it] : ["inside", it],
      );
      const [onWindows, onPosix] = await Promise.all([
        run(String(dir), ["--run-path-tests", "windows", ...inside]),
        run(String(dir), ["--run-path-tests", "posix", "inside", "/proj", "/PROJ/a.js", "inside", "/", "/a.js"]),
      ]);
      expect(onWindows.lines).toEqual(["inside: a.js", "outside", "inside: a.js"]);
      expect(onPosix.lines).toEqual(["outside", "inside: a.js"]);
    });

    test("an argument that matches nothing fails with 2", async () => {
      const { raw, stderr, exitCode } = await lint(files, ["nothing.js"]);
      expect(raw).toBe("");
      expect(stderr).toMatchInlineSnapshot(`
        "error: No files matching the pattern "nothing.js" were found.
        Please check for typing mistakes in the pattern."
      `);
      expect(exitCode).toBe(2);
    });

    test("--no-error-on-unmatched-pattern", async () => {
      const { exitCode } = await lint(files, ["--no-error-on-unmatched-pattern", "nothing.js", "nothing/**"]);
      expect(exitCode).toBe(0);
    });

    test("a pattern whose matches are all ignored fails with 2", async () => {
      const { stderr, exitCode } = await lint(files, ["node_modules/**/*.js"]);
      expect(stderr).toContain('all of the files matching the glob pattern "node_modules/**/*.js" are ignored');
      expect(exitCode).toBe(2);
    });

    test("warns about a named file that is not linted", async () => {
      const { stdout, exitCode } = await lint(files, ["src/d.ts", "node_modules/pkg/g.js"]);
      expect(stdout).toMatchInlineSnapshot(`
        "<dir>/node_modules/pkg/g.js
          0:0  warning  File ignored by default because it is located under the node_modules directory. Use ignore pattern "!**/node_modules/" to disable file ignore settings or use "--no-warn-ignored" to suppress this warning

        <dir>/src/d.ts
          0:0  warning  File ignored because no matching configuration was supplied

        ✖ 2 problems (0 errors, 2 warnings)"
      `);
      expect(exitCode).toBe(0);
    });

    test("--no-warn-ignored", async () => {
      const { raw, exitCode } = await lint(files, ["--no-warn-ignored", "src/d.ts"]);
      expect(raw).toBe("");
      expect(exitCode).toBe(0);
    });
  });

  describe("configuration", () => {
    test("global ignores, files, and --no-ignore", async () => {
      const files = {
        "eslint.config.js": `export default [{ ignores: ["dist/"] }, { files: ["**/*.ts"], rules: { "no-debugger": "error" } }];`,
        "a.ts": "debugger;\n",
        "a.js": "debugger;\n",
        "dist/b.ts": "debugger;\n",
      };
      const [plain, all] = await Promise.all([lint(files, ["-f", "unix"]), lint(files, ["-f", "unix", "--no-ignore"])]);
      expect(plain.stdout).toMatchInlineSnapshot(`
        "<dir>/a.ts:1:1: Unexpected 'debugger' statement. [Error/no-debugger]

        1 problem"
      `);
      expect(all.stdout).toMatchInlineSnapshot(`
        "<dir>/a.ts:1:1: Unexpected 'debugger' statement. [Error/no-debugger]
        <dir>/dist/b.ts:1:1: Unexpected 'debugger' statement. [Error/no-debugger]

        2 problems"
      `);
    });

    test("the nearest configuration file counts", async () => {
      const { stdout } = await lint(
        {
          "eslint.config.js": config({ "no-debugger": "error" }),
          "a.js": "debugger; if (a == b) {}\n",
          "packages/p/eslint.config.mjs": config({ eqeqeq: "warn" }),
          "packages/p/b.js": "debugger; if (a == b) {}\n",
          "packages/p/src/c.js": "debugger; if (a == b) {}\n",
        },
        ["-f", "unix"],
      );
      expect(stdout).toMatchInlineSnapshot(`
        "<dir>/a.js:1:1: Unexpected 'debugger' statement. [Error/no-debugger]
        <dir>/packages/p/b.js:1:17: Expected '===' and instead saw '=='. [Warning/eqeqeq]
        <dir>/packages/p/src/c.js:1:17: Expected '===' and instead saw '=='. [Warning/eqeqeq]

        3 problems"
      `);
    });

    test("-c replaces every other configuration file", async () => {
      const { stdout } = await lint(
        {
          "eslint.config.js": config({ "no-debugger": "error" }),
          "other.config.js": config({ eqeqeq: "error" }),
          "a.js": "debugger; if (a == b) {}\n",
          "p/eslint.config.js": config({ "no-debugger": "error" }),
          "p/b.js": "debugger; if (a == b) {}\n",
        },
        ["-f", "unix", "-c", "other.config.js"],
      );
      expect(stdout).toMatchInlineSnapshot(`
        "<dir>/a.js:1:17: Expected '===' and instead saw '=='. [Error/eqeqeq]
        <dir>/p/b.js:1:17: Expected '===' and instead saw '=='. [Error/eqeqeq]

        2 problems"
      `);
    });

    test("a configuration file in TypeScript, CommonJS, or that exports a promise", async () => {
      const results = await Promise.all([
        lint(
          {
            "eslint.config.ts": `const severity: "error" = "error";\nexport default [{ rules: { "no-debugger": severity } }];`,
            "a.js": "debugger;\n",
          },
          ["-f", "unix"],
        ),
        lint(
          { "eslint.config.cjs": `module.exports = [{ rules: { "no-debugger": "error" } }];`, "a.js": "debugger;\n" },
          ["-f", "unix"],
        ),
        lint(
          {
            "eslint.config.mjs": `export default Promise.resolve({ rules: { "no-debugger": "error" } });`,
            "a.js": "debugger;\n",
          },
          ["-f", "unix"],
        ),
      ]);
      for (const { stdout, exitCode } of results) {
        expect(stdout).toBe("<dir>/a.js:1:1: Unexpected 'debugger' statement. [Error/no-debugger]\n\n1 problem");
        expect(exitCode).toBe(1);
      }
    });

    test("a configuration file that throws fails with 2", async () => {
      const { raw, stderr, exitCode } = await lint(
        { "eslint.config.js": `throw new Error("not today");`, "a.js": "" },
        [],
      );
      expect(raw).toBe("");
      expect(stderr).toContain("Cannot load the configuration file");
      expect(stderr).toContain("not today");
      expect(exitCode).toBe(2);
    });

    test("invalid rule options fail with 2", async () => {
      const { raw, stderr, exitCode } = await lint(
        { "eslint.config.js": config({ eqeqeq: ["error", "sometimes"] }), "a.js": "" },
        [],
      );
      expect(raw).toBe("");
      expect(stderr).toContain('Key "rules": Key "eqeqeq"');
      expect(exitCode).toBe(2);
    });

    test(
      "the rules of a plugin run, and their fixes are applied",
      async () => {
        const files = {
          "eslint.config.js": `
          const noFoo = {
            meta: { type: "problem", fixable: "code", messages: { foo: "No {{name}}." } },
            create: context => ({
              Identifier(node) {
                if (node.name === "foo") context.report({ node, messageId: "foo", data: node, fix: fixer => fixer.replaceText(node, "bar") });
              },
            }),
          };
          export default [{ files: ["a.js"], plugins: { example: { rules: { "no-foo": noFoo } } }, rules: { "example/no-foo": "error", "no-debugger": "warn" } }];`,
          "a.js": "debugger;\nfoo();\n",
        };
        const [plain, fixed] = await Promise.all([
          lint(files, ["-f", "unix", "a.js"]),
          lint(files, ["--fix", "a.js"], { reads: ["a.js"] }),
        ]);
        expect(plain.stdout).toMatchInlineSnapshot(`
        "<dir>/a.js:1:1: Unexpected 'debugger' statement. [Warning/no-debugger]
        <dir>/a.js:2:1: No foo. [Error/example/no-foo]

        2 problems"
      `);
        expect(plain.exitCode).toBe(1);
        expect(fixed.files).toEqual({ "a.js": "debugger;\nbar();\n" });
        expect(fixed.exitCode).toBe(0);
        // A debug build takes seconds to start the engine that the rules run in.
      },
      isDebug || isASAN ? 120_000 : 30_000,
    );

    test("--rule, --global, --no-config-lookup", async () => {
      const { stdout } = await lint(
        { "eslint.config.js": config({ "no-debugger": "error" }), "a.js": "debugger; a = b; c = 'd';\n" },
        [
          "-f",
          "unix",
          "--no-config-lookup",
          "--rule",
          "no-undef: error",
          "--rule",
          "quotes: [warn, double]",
          "--global",
          "a:true,b",
        ],
      );
      expect(stdout).toMatchInlineSnapshot(`
        "<dir>/a.js:1:18: 'c' is not defined. [Error/no-undef]
        <dir>/a.js:1:22: Strings must use doublequote. [Warning/quotes]

        2 problems"
      `);
    });

    test("--print-config", async () => {
      const files = { "eslint.config.js": config({ eqeqeq: ["error", "smart"], "no-debugger": "off" }), "a.js": "" };
      const [known, unknown] = await Promise.all([
        lint(files, ["--print-config", "a.js"]),
        lint(files, ["--print-config", "a.css"]),
      ]);
      expect(JSON.parse(known.raw)).toMatchObject({
        rules: { eqeqeq: [2, "smart"], "no-debugger": [0] },
        language: "@/js",
        languageOptions: { sourceType: "module" },
      });
      expect(unknown.raw).toBe("undefined\n");
    });

    test(".oxlintrc.json: categories, overrides, ignorePatterns, .gitignore, -D", async () => {
      const { stdout, exitCode } = await lint(
        {
          ".oxlintrc.json": `{
            // Comments are allowed.
            "categories": { "correctness": "off" },
            "rules": { "no-debugger": "error", "react/jsx-key": "error" },
            "ignorePatterns": ["generated/"],
            "overrides": [{ "files": ["*.test.ts"], "rules": { "no-debugger": "off", "typescript/no-explicit-any": "warn" } }],
          }`,
          ".gitignore": "ignored.js\n",
          "a.ts": "debugger; if (a == b) {}\n",
          "a.test.ts": "debugger; export const a: any = 1;\n",
          "ignored.js": "debugger;\n",
          "generated/b.js": "debugger;\n",
        },
        ["-f", "unix", "-D", "eqeqeq"],
      );
      expect(stdout).toMatchInlineSnapshot(`
        "a.test.ts:1:27: Unexpected \`any\`. Specify a different type. [Warning/typescript(no-explicit-any)]
        a.ts:1:1: \`debugger\` statement is not allowed [Error/eslint(no-debugger)]
        a.ts:1:17: Expected === and instead saw == [Error/eslint(eqeqeq)]

        3 problems"
      `);
      expect(exitCode).toBe(1);
    });

    describe("like oxlint, with an .oxlintrc.json", () => {
      // What oxlint 1.87.0 does with each. TypeScript's parser, which reads the file here, takes them all.
      const quiet = JSON.stringify({ categories: { correctness: "off" }, rules: {} });
      test.each([
        ["a.ts", "const a: string;"],
        ["a.ts", "export const"],
        ["a.ts", "export const a = /(/;"],
        ["a.ts", "export {};\nlet = 1;"],
        ["a.ts", "export class <T> {}"],
        ["a.ts", "export {};\nfunction f() { await (1); }"],
        ["a.ts", "for (const a, b of c);"],
        ["a.ts", "using a;"],
        ["a.js", "const a"],
        ["a.js", "const { a }"],
        ["a.js", "break;"],
        ["a.js", "a: continue a;"],
        ["a.js", "export {};\nstatic = 1;"],
        ["a.js", "[a()] = b;"],
        ["a.js", "a = /a/gg;"],
      ])("what OXC refuses is a parsing error: %s: %j", async (name, code) => {
        const { stdout, exitCode } = await lint({ ".oxlintrc.json": quiet, [name]: code + "\n" }, ["-f", "unix"]);
        expect(stdout).toMatch(/^a\.[jt]s:\d+:\d+: (?!Parsing error).* \[Error\]$/m);
        expect(exitCode).toBe(1);
      });

      // oxlint 1.87.0: "Identifier `a` has already been declared", at the first of the two. The parser, which has the names in
      // hand, says that a file may have such a list: no other file is looked at.
      test.each([
        ["a.ts", "export class A {\n  foo(a, a) {}\n}", "a.ts:2:7"],
        ["a.ts", "export {};\nfunction f(b, b) {}", "a.ts:2:12"],
        ["a.js", '"use strict";\n(function (a, b, a) {});', "a.js:2:12"],
        ["a.js", '(function (a, b, a) { "use strict"; });', "a.js:1:12"],
        ["a.js", "(function (a, b, a) {});\nexport {};", "a.js:1:12"],
        ["a.js", "((a, a) => 1);", "a.js:1:3"],
        ["a.js", "function f(a, [a]) {}", "a.js:1:12"],
        ["a.js", "class A { b = function (a, a) {} }", "a.js:1:25"],
        ["a.ts", "type A = (a: number, a: number) => void;", "a.ts:1:11"],
        ["a.ts", "declare function f(a: number, a: number): void;\nexport {};", "a.ts:1:20"],
      ])("what OXC refuses is a parsing error: a name that two parameters bind: %s: %j", async (name, code, place) => {
        const { stdout, exitCode } = await lint({ ".oxlintrc.json": quiet, [name]: code + "\n" }, ["-f", "unix"]);
        expect(stdout).toContain(`${place}: Identifier`);
        expect(exitCode).toBe(1);
      });

      test.each([
        // Only declared.
        ["a.ts", "declare const a: string;"],
        ["a.d.ts", "export const a: string;"],
        ["a.ts", "declare function f(package: string): void;\nexport {};"],
        // A file without `import` and `export` is a script, which is not strict.
        ["a.ts", "type A = (...arguments: any[]) => void;"],
        ["a.ts", "let = 1;"],
        ["a.js", "function f() { await (1); }"],
        ["a.tsx", "if (f) function f() {}"],
        ["a.js", "(function (a, b, a) {});"],
        ["a.cjs", "(function (a, a) {});"],
        ["a.ts", "declare function f(a: number, a: number): void;"],
        ["a.ts", "function f(a: (a: number) => void, b = (a: number) => a) {}\nexport {};"],
        // What acorn does not know, or typescript-estree throws.
        ["a.ts", "class A { accessor b = 1 }"],
        ["a.js", "class A { accessor b = 1 }"],
        ["a.js", "@d class A {}"],
        ["a.ts", "let a!: string;"],
        ["a.ts", "function f<>() {}"],
        ["a.ts", "for (const a in b);"],
        ["a.js", "for (const a of b);"],
      ])("what OXC takes is linted: %s: %j", async (name, code) => {
        const { stdout, exitCode } = await lint({ ".oxlintrc.json": quiet, [name]: code + "\n" }, ["-f", "unix"]);
        expect(stdout).not.toContain("[Error]");
        expect(exitCode).toBe(0);
      });

      test("--fix makes one pass, and what is left is reported where it was", async () => {
        const result = await lint(
          {
            ".oxlintrc.json": JSON.stringify({
              categories: { correctness: "off" },
              jsPlugins: ["./plugin.js"],
              rules: { "p/r": "error" },
            }),
            "plugin.js": `export default {
              meta: { name: "p" },
              rules: {
                r: {
                  meta: { fixable: "code" },
                  create: context => ({
                    Identifier(node) {
                      const to = { a: "longer", longer: "c" }[node.name];
                      if (to) context.report({ node, message: "m", fix: fixer => fixer.replaceText(node, to) });
                      if (node.name === "stays") context.report({ node, message: "it stays" });
                    },
                  }),
                },
              },
            };`,
            "a.js": "a; stays;\n",
          },
          ["--fix", "-f", "json", "a.js"],
          { reads: ["a.js"] },
        );
        expect(result.files["a.js"]).toBe("longer; stays;\n");
        const { diagnostics } = JSON.parse(result.raw);
        expect(diagnostics.map((it: any) => [it.message, it.labels[0].span])).toEqual([
          ["it stays", { offset: 3, length: 5, line: 1, column: 4 }],
        ]);
        expect(result.exitCode).toBe(1);
      });

      test("--fix applies the fixes of a rule that is about several files", async () => {
        const result = await lint(
          {
            ".oxlintrc.json": JSON.stringify({
              categories: { correctness: "off" },
              plugins: ["import"],
              rules: { "import/no-duplicates": "error", "no-var": "error" },
            }),
            "a.js": "import {a} from './foo';\nimport {c} from './foo';\nvar x = a + c;\nexport { x };\n",
            "foo.js": "export const a = 1, c = 2;\n",
          },
          ["--fix", "-f", "unix"],
          { reads: ["a.js"] },
        );
        expect(result.files["a.js"]).toStartWith("import {a,c} from './foo';\n");
        expect(result.stdout).not.toContain("no-duplicates");
      });

      test(
        "--fix, --fix-suggestions, --fix-dangerously and --quiet change what oxlint's change",
        async () => {
          const files = {
            ".oxlintrc.json": JSON.stringify({
              categories: { correctness: "off" },
              jsPlugins: ["./plugin.js"],
              rules: { "p/r": "warn" },
            }),
            "plugin.js": `export default {
            meta: { name: "p" },
            rules: {
              r: {
                meta: { fixable: "code", hasSuggestions: true },
                create: context => ({
                  Identifier(node) {
                    const fix = fixer => fixer.replaceText(node, "done");
                    if (node.name === "fixed") context.report({ node, message: "m", fix });
                    if (node.name === "suggested") context.report({ node, message: "m", suggest: [{ desc: "d", fix }] });
                  },
                }),
              },
            },
          };`,
            "a.js": "fixed; suggested;\n",
          };
          const after = async (...flags: string[]) =>
            (await lint(files, [...flags, "a.js"], { reads: ["a.js"] })).files["a.js"];
          expect(await after("--fix")).toBe("done; suggested;\n");
          expect(await after("--fix", "--quiet")).toBe("done; suggested;\n");
          expect(await after("--fix-suggestions")).toBe("fixed; done;\n");
          expect(await after("--fix", "--fix-suggestions")).toBe("done; done;\n");
          expect(await after("--fix-dangerously")).toBe("done; done;\n");
        },
        isDebug || isASAN ? 120_000 : 30_000,
      );

      // What oxlint 1.87 writes.
      describe("a comment that disables nothing is removed from the scripts of a .vue file only, there by every flag", () => {
        const rules = { "no-debugger": "error", "no-console": "error", "no-var": "error", "no-alert": "error" };
        const options = { reportUnusedDisableDirectives: "error" };
        const files = {
          ".oxlintrc.json": JSON.stringify({ categories: { correctness: "off" }, options, rules }),
          "a.js":
            "// oxlint-disable-next-line no-console\nfoo();\n/* oxlint-disable no-alert */\nvar x = 1; x;\n// oxlint-disable-next-line no-console, no-debugger\ndebugger;\n",
          "a.vue":
            "<script>\n// oxlint-disable-next-line no-console\nfoo();\n/* oxlint-disable no-alert */\nvar x = 1; x;\n// oxlint-disable-next-line no-console, no-debugger\ndebugger;\n</script>\n",
        };
        test.each([
          [
            "a.js",
            "--fix",
            "// oxlint-disable-next-line no-console\nfoo();\n/* oxlint-disable no-alert */\nconst x = 1; x;\n// oxlint-disable-next-line no-console, no-debugger\ndebugger;\n",
          ],
          [
            "a.js",
            "--fix-suggestions",
            "// oxlint-disable-next-line no-console\nfoo();\n/* oxlint-disable no-alert */\nvar x = 1; x;\n// oxlint-disable-next-line no-console, no-debugger\ndebugger;\n",
          ],
          [
            "a.js",
            "--fix-dangerously",
            "// oxlint-disable-next-line no-console\nfoo();\n/* oxlint-disable no-alert */\nconst x = 1; x;\n// oxlint-disable-next-line no-console, no-debugger\ndebugger;\n",
          ],
          [
            "a.vue",
            "--fix",
            "<script>\nfoo();\nvar x = 1; x;\n// oxlint-disable-next-line no-debugger\ndebugger;\n</script>\n",
          ],
          [
            "a.vue",
            "--fix-suggestions",
            "<script>\nfoo();\nvar x = 1; x;\n// oxlint-disable-next-line no-debugger\ndebugger;\n</script>\n",
          ],
          [
            "a.vue",
            "--fix-dangerously",
            "<script>\nfoo();\nvar x = 1; x;\n// oxlint-disable-next-line no-debugger\ndebugger;\n</script>\n",
          ],
        ])("%s %s", async (name, flag, expected) => {
          expect((await lint(files, [flag, name], { reads: [name] })).files).toEqual({ [name]: expected });
        });
      });

      // What oxlint 1.87 writes, in whichever order the file has the rules.
      test("of two fixes with the same range, that of the rule that oxlint has first", async () => {
        const rules = { "unicorn/numeric-separators-style": "error", "unicorn/number-literal-case": "error" };
        const oxlintrc = JSON.stringify({ plugins: ["unicorn"], categories: { correctness: "off" }, rules });
        const files = { ".oxlintrc.json": oxlintrc, "a.js": "a = 0xabcdef12;\n" };
        expect((await lint(files, ["--fix", "a.js"], { reads: ["a.js"] })).files).toEqual({
          "a.js": "a = 0xABCDEF12;\n",
        });
      });

      // What oxlint 1.87 writes. The one rule replaces the declaration and prints it anew (`'a';`), the other the keyword.
      test("of two fixes that start at the same place, the shorter one", async () => {
        const rules = {
          "import/consistent-type-specifier-style": "error",
          "typescript/no-import-type-side-effects": "error",
        };
        const oxlintrc = JSON.stringify({
          plugins: ["import", "typescript"],
          categories: { correctness: "off" },
          rules,
        });
        const files = { ".oxlintrc.json": oxlintrc, "a.ts": 'import { type A } from "a"\nexport type B = A;\n' };
        expect((await lint(files, ["--fix", "a.ts"], { reads: ["a.ts"] })).files).toEqual({
          "a.ts": 'import type { A } from "a"\nexport type B = A;\n',
        });
      });

      // oxlint 1.87 with tsgolint 7.0 changes nothing.
      test("rules that have suggestions for typescript-eslint and none for oxlint", async () => {
        const rules = { "typescript/strict-boolean-expressions": "error", "typescript/strict-void-return": "error" };
        const text =
          "declare const a: string | null;\nif (a) {}\ndeclare function f(cb: () => void): void;\nf(async () => {});\nexport {};\n";
        const files = {
          ".oxlintrc.json": JSON.stringify({ plugins: ["typescript"], categories: { correctness: "off" }, rules }),
          "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [] } }),
          "a.ts": text,
        };
        for (const flags of [["--fix"], ["--fix-suggestions"], ["--fix", "--fix-suggestions"], ["--fix-dangerously"]]) {
          const result = await lint(files, ["--type-aware", ...flags, "a.ts"], { reads: ["a.ts"] });
          expect(result.files).toEqual({ "a.ts": text });
          expect(result.exitCode).toBe(1);
        }
      });

      // What oxlint 1.87 writes.
      test('a fix that is a dangerous one for oxlint: operator-assignment with "never"', async () => {
        const after = async (mode: string, ...flags: string[]) => {
          const rules = { "operator-assignment": ["error", mode] };
          const oxlintrc = JSON.stringify({ plugins: [], categories: { correctness: "off" }, rules });
          const files = { ".oxlintrc.json": oxlintrc, "a.js": "x += y;\nx = x + y;\n" };
          return (await lint(files, [...flags, "a.js"], { reads: ["a.js"] })).files["a.js"];
        };
        expect(await after("never", "--fix")).toBe("x += y;\nx = x + y;\n");
        expect(await after("never", "--fix", "--fix-suggestions")).toBe("x += y;\nx = x + y;\n");
        expect(await after("never", "--fix-dangerously")).toBe("x = x + y;\nx = x + y;\n");
        expect(await after("always", "--fix")).toBe("x += y;\nx += y;\n");
      });

      const rc = (more: object = {}) =>
        JSON.stringify({
          categories: { correctness: "off" },
          rules: { "no-debugger": "error", eqeqeq: "warn" },
          ...more,
        });
      const files = {
        ".oxlintrc.json": rc(),
        "a.js": "debugger;\nif (é == b) {}\n",
        "src/b.ts": "export const b = 1;\n",
      };

      test("-f json is oxlint's: offsets and columns in bytes, plugin(rule)", async () => {
        const { raw, exitCode } = await lint(files, ["-f", "json", "--threads", "2"]);
        const { start_time, ...report } = JSON.parse(raw);
        expect(report).toEqual({
          diagnostics: [
            {
              message: "`debugger` statement is not allowed",
              code: "eslint(no-debugger)",
              severity: "error",
              url: "https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-debugger.html",
              help: "Remove the debugger statement",
              filename: "a.js",
              labels: [{ span: { offset: 0, length: 9, line: 1, column: 1 } }],
            },
            {
              message: "Expected === and instead saw ==",
              code: "eslint(eqeqeq)",
              severity: "warning",
              url: "https://oxc.rs/docs/guide/usage/linter/rules/eslint/eqeqeq.html",
              help: "Prefer === operator",
              filename: "a.js",
              labels: [{ span: { offset: 17, length: 2, line: 2, column: 8 } }],
            },
          ],
          number_of_files: 2,
          number_of_rules: 2,
          threads_count: 2,
        });
        expect(start_time).toBeNumber();
        expect(exitCode).toBe(1);
      });

      // What oxlint says besides a message is made when the message is shown with its code: its text is linted once more.
      describe("the help of a problem that is shown", () => {
        const rules = { "no-underscore-dangle": "error", "no-var": "error" };
        const help = "note: Remove the dangling '_' or add `_a` to the 'allow' configuration.\n";
        const print = async (text: string, flags: string[], stdin?: string) => {
          const files = { ".oxlintrc.json": rc({ rules }), "a.js": text };
          return await lint(files, ["-f", "default", ...flags], { env: { NO_COLOR: "1" }, reads: ["a.js"], stdin });
        };
        const times = (raw: string) => raw.split(help).length - 1;

        test("is there, however many problems there are", async () => {
          const [few, many, all] = await Promise.all([
            print("let _a;\n".repeat(3), ["a.js"]),
            print("let _a;\n".repeat(60), ["a.js"]),
            print("let _a;\n".repeat(60), ["--all", "a.js"]),
          ]);
          expect([few, many, all].map(it => times(it.raw))).toEqual([3, 1, 60]);
          // The one that stands for all is printed like the first of all.
          const first = (raw: string) => raw.slice(0, raw.indexOf(help) + help.length);
          expect(first(many.raw)).toBe(first(all.raw));
        });

        test("is about the text that the message is about, which --fix has changed since", async () => {
          const { raw, files } = await print("var _a;\n", ["--fix", "a.js"]);
          expect(files["a.js"]).toBe("let _a;\n");
          expect(times(raw)).toBe(1);
        });

        test("is there for a text from standard input", async () => {
          const { raw } = await print("", ["--stdin", "--stdin-filename", "b.js"], "let _a;\n");
          expect(times(raw)).toBe(1);
        });
      });

      test("unix, stylish, github and agent are oxlint's: the path from the working directory, columns in bytes, plugin(rule)", async () => {
        const [json, unix, stylish, github, agent] = await Promise.all(
          ["json", "unix", "stylish", "github", "agent"].map(format =>
            lint(files, ["-f", format, "--threads", "2"], { env: { NO_COLOR: "1" } }),
          ),
        );
        const [first, second] = JSON.parse(json.raw).diagnostics;
        const help = (it: { help?: string }) => (it.help === undefined ? "" : ` help: ${it.help}`);
        expect(unix.raw).toBe(
          `a.js:1:1: ${first.message} [Error/eslint(no-debugger)]\n` +
            `a.js:2:8: ${second.message} [Warning/eslint(eqeqeq)]\n` +
            "\n2 problems\n",
        );
        expect(stylish.stdout).toBe(
          "<dir>/a.js\n" +
            `  1:1  error  ${first.message}  eslint(no-debugger)\n` +
            `  2:8  warning  ${second.message}  eslint(eqeqeq)\n` +
            "\n✖ 2 problems (1 error, 1 warning)",
        );
        expect(github.raw.replace(/in \d+ms|in [\d.]+s/, "in 1ms")).toBe(
          `::error file=a.js,line=1,endLine=1,col=1,endColumn=10,title=eslint(no-debugger)::a.js:1:1: ${first.message}\n` +
            `::warning file=a.js,line=2,endLine=2,col=8,endColumn=10,title=eslint(eqeqeq)::a.js:2:8: ${second.message}\n` +
            "\nFound 1 warning and 1 error.\n" +
            "Finished in 1ms on 2 files with 2 rules using 2 threads.\n",
        );
        expect(agent.raw).toBe(
          `a.js:1:1: error eslint(no-debugger): ${first.message}${help(first)}\n` +
            `a.js:2:8: warning eslint(eqeqeq): ${second.message}${help(second)}\n`,
        );
        expect([unix, stylish, github, agent].map(it => [it.stderr, it.exitCode])).toEqual(
          Array.from({ length: 4 }, () => ["", 1]),
        );
      });

      test("what has no place has its text and its severity", async () => {
        const stale = { "oxlint-suppressions.json": JSON.stringify({ "a.js": { "no-debugger": { count: 2 } } }) };
        const text = "There are suppressions that do not occur anymore.";
        const print = async (format: string) => (await lint({ ...files, ...stale }, ["--quiet", "-f", format])).raw;
        expect(await print("unix")).toBe(`:0:0: ${text} [Error]\n\n1 problem\n`);
        expect(await print("checkstyle")).toContain(
          `<error line="0" column="0" severity="error" message="${text}" source="" />`,
        );
        expect(await print("junit")).toContain(`<error message="${text}">line 0, column 0, ${text}</error>`);
      });

      // As oxlint 1.87. For ESLint the mark is in no column.
      test("what a rule says about the file is before a byte order mark, all else after it", async () => {
        const project = {
          ".oxlintrc.json": rc({
            plugins: ["unicorn", "import", "react"],
            rules: {
              "no-debugger": "error",
              "unicode-bom": "error",
              "unicorn/filename-case": "error",
              "import/unambiguous": "error",
              "react/jsx-filename-extension": ["error", { allow: "as-needed" }],
            },
          }),
          "Bad_Name.jsx": "\uFEFFdebugger;\n",
        };
        const { diagnostics } = JSON.parse((await lint(project, ["-f", "json"])).raw);
        expect(
          Object.fromEntries(diagnostics.map((it: any) => [it.code, Object.values(it.labels[0].span).join(" ")])),
        ).toEqual({
          "eslint(no-debugger)": "3 9 1 4",
          "eslint(unicode-bom)": "0 0 1 1",
          "import(unambiguous)": "0 0 1 1",
          "react(jsx-filename-extension)": "0 0 1 1",
          "unicorn(filename-case)": "0 0 1 1",
        });
      });

      test("number_of_rules has what an override turns on, not what needs types, and is null with a nested configuration", async () => {
        const count = async (more: Record<string, string>, ...flags: string[]) =>
          JSON.parse((await lint({ ...files, ...more }, ["-f", "json", ...flags])).raw).number_of_rules;
        const overrides = [
          { files: ["*.ts"], rules: { "no-var": "warn", "no-debugger": "off" } },
          { files: ["*.nothing"], rules: { "no-empty": "error", "no-eval": "off" } },
        ];
        const typed = { rules: { "no-debugger": "error", "typescript/no-floating-promises": "error" } };
        expect({
          overrides: await count({ ".oxlintrc.json": rc({ overrides }) }),
          typed: await count({ ".oxlintrc.json": rc(typed) }),
          nested: await count({ "src/.oxlintrc.json": rc() }),
          notNested: await count({ "src/.oxlintrc.json": rc() }, "--disable-nested-config"),
        }).toEqual({ overrides: 4, typed: 1, nested: null, notNested: 2 });
      });

      test("all that is said is on stdout", async () => {
        const warns = { ".oxlintrc.json": rc(), "a.js": "if (a == b) {}\n" };
        const stale = { "oxlint-suppressions.json": JSON.stringify({ "a.js": { "no-debugger": { count: 2 } } }) };
        const runs = {
          plain: lint(files, []),
          silent: lint(files, ["--silent"]),
          limited: lint(files, ["--max-warnings", "0"]),
          clean: lint(files, ["src"]),
          quiet: lint(warns, ["--quiet"]),
          denied: lint(warns, ["--quiet", "--deny-warnings"]),
          none: lint(files, ["nothing.js"]),
          tolerated: lint(files, ["--no-error-on-unmatched-pattern", "nothing.js"]),
          refused: lint({ ...files, ".oxlintrc.json": "{" }, []),
          unpruned: lint({ ...files, ...stale }, ["--quiet"]),
          unprunedForGitlab: lint({ ...files, ...stale }, ["--quiet", "-f", "gitlab"]),
        };
        const results = Object.fromEntries(
          await Promise.all(Object.entries(runs).map(async ([name, run]) => [name, await run] as const)),
        );
        expect(Object.values(results).map(it => it.stderr)).toEqual(Object.values(results).map(() => ""));
        expect(results.plain.stdout).toEndWith("\n\nLinted 2 files");
        expect(results.silent.stdout).toBe("Linted 2 files");
        expect(results.limited.stdout).toEndWith("\n\nerror: Found too many warnings (maximum: 0).\nLinted 2 files");
        expect(results.clean.stdout).toBe("✓ No problems in 1 file");
        expect(results.quiet.stdout).toBe("Linted 1 file");
        expect(results.denied.stdout).toBe("Linted 1 file");
        expect(results.none.stdout).toBe("error: No files found to lint. Please check your paths and ignore patterns.");
        expect(results.tolerated.stdout).toBe("✓ No problems in 0 files");
        expect(results.refused.stdout).toStartWith("error: ");
        expect(results.unpruned.stdout).toBe(
          "error: There are suppressions that do not occur anymore.\n\n" +
            "note: Run `oxlint --prune-suppressions` to remove unused suppressions.\n\nLinted 2 files",
        );
        // oxlint has neither the text nor the severity of what has no place. The fingerprint is Rust's `DefaultHasher` of all of it.
        expect(JSON.parse(results.unprunedForGitlab.raw)).toEqual([
          {
            description: "There are suppressions that do not occur anymore.",
            check_name: "",
            fingerprint: "a19b313047657a87",
            severity: "critical",
            location: { path: "", lines: { begin: 0, end: 0 } },
          },
        ]);
        expect(Object.fromEntries(Object.entries(results).map(([name, it]) => [name, it.exitCode]))).toEqual({
          plain: 1,
          silent: 1,
          limited: 1,
          clean: 0,
          quiet: 0,
          denied: 1,
          none: 1,
          tolerated: 0,
          refused: 1,
          unpruned: 1,
          unprunedForGitlab: 1,
        });
      });

      test("without --format: what tells oxlint that an agent runs it makes `agent` the format, before GITHUB_ACTIONS", async () => {
        const run = (env: Record<string, string | undefined>) => lint(files, [], { env: { AGENT: undefined, ...env } });
        const [agent, named, both, off, github] = await Promise.all([
          lint(files, ["-f", "agent"]),
          run({ AI_AGENT: "something" }),
          run({ CURSOR_AGENT: "0", GITHUB_ACTIONS: "true" }),
          run({ AI_AGENT: "something", AGENT: "0", GITHUB_ACTIONS: "true" }),
          lint(files, ["-f", "github"]),
        ]);
        const first = (it: { raw: string }) => it.raw.split("\n")[0];
        expect([named.raw, both.raw]).toEqual([agent.raw, agent.raw]);
        expect(first(off)).toBe(first(github));
      });

      test("oxlint-suppressions.json has oxlint's names of the rules", async () => {
        const project = {
          ".oxlintrc.json": JSON.stringify({
            categories: { correctness: "off" },
            plugins: ["typescript", "node", "nextjs"],
            rules: {
              "no-console": "error",
              "typescript/no-explicit-any": "error",
              "node/no-new-require": "error",
              "nextjs/no-img-element": "error",
            },
          }),
          "a.tsx": 'console.log(1 as any);\nnew require("x");\n<img src="a" />;\n',
        };
        // What oxlint 1.87 writes with --suppress-all.
        const names = ["next/no-img-element", "no-console", "node/no-new-require", "typescript/no-explicit-any"];
        const written = Object.fromEntries(names.map(name => [name, { count: 1 }]));
        const suppressed = await lint(
          { ...project, "oxlint-suppressions.json": JSON.stringify({ "a.tsx": written }) },
          ["-f", "json"],
        );
        expect(JSON.parse(suppressed.raw).diagnostics).toEqual([]);
        expect(suppressed.exitCode).toBe(0);
        using dir = tempDir("bun-lint-suppressions", project);
        await using proc = spawn({
          cmd: [...command, "--suppress-all", "-f", "json"],
          env,
          cwd: String(dir),
          stdout: "ignore",
          stderr: "ignore",
        });
        expect(await proc.exited).toBe(0);
        expect(await Bun.file(join(String(dir), "oxlint-suppressions.json")).json()).toEqual({ "a.tsx": written });
      });

      test("--silent and no file to lint: a format prints what oxlint's prints", async () => {
        const formats = ["unix", "checkstyle", "junit", "gitlab", "sarif", "json"];
        const [silent, none] = await Promise.all(
          [["--silent"], ["nothing.js"]].map(flags =>
            Promise.all(formats.map(format => lint(files, ["-f", format, ...flags]))),
          ),
        );
        const line = "No files found to lint. Please check your paths and ignore patterns.\n";
        const [unix, checkstyle, junit, gitlab, sarif, json] = silent.map(it => it.raw);
        expect(unix).toBe("");
        expect(checkstyle).toBe('<?xml version="1.0" encoding="utf-8"?><checkstyle version="4.3"></checkstyle>\n');
        expect(junit).toBe(
          '<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="Oxlint" tests="0" failures="0" errors="0">\n\n</testsuites>\n',
        );
        expect(gitlab).toBe("[]");
        expect(JSON.parse(sarif).runs[0].results).toEqual([]);
        expect(JSON.parse(json).diagnostics).toEqual([]);
        expect(none.slice(0, 5).map(it => it.raw)).toEqual(Array.from({ length: 5 }, () => line));
        expect(none[5].raw).toStartWith(line + '{ "diagnostics": [],\n');
        expect([...silent, ...none].map(it => [it.stderr, it.exitCode])).toEqual(
          Array.from({ length: 12 }, () => ["", 1]),
        );
      });

      test("--rules -f json", async () => {
        const { raw, exitCode } = await lint(files, ["--rules", "-f", "json"]);
        const rules = JSON.parse(raw);
        const find = (scope: string, value: string) =>
          rules.find((it: any) => it.scope === scope && it.value === value);
        expect(find("eslint", "no-debugger")).toEqual({
          scope: "eslint",
          value: "no-debugger",
          category: "correctness",
          type_aware: false,
          fix: "none",
          default: true,
          docs_url: "https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-debugger.html",
        });
        expect(find("typescript", "no-floating-promises").type_aware).toBe(true);
        expect(exitCode).toBe(0);
      });

      test("checkstyle, junit, gitlab, sarif", async () => {
        const [checkstyle, junit, gitlab, sarif] = await Promise.all(
          ["checkstyle", "junit", "gitlab", "sarif"].map(format => lint(files, ["-f", format, "a.js"])),
        );
        expect(checkstyle.stdout).toMatchInlineSnapshot(
          `"<?xml version="1.0" encoding="utf-8"?><checkstyle version="4.3"><file name="a.js"><error line="1" column="1" severity="error" message="\`debugger\` statement is not allowed" source="eslint(no-debugger)" /><error line="2" column="8" severity="warning" message="Expected === and instead saw ==" source="eslint(eqeqeq)" /></file></checkstyle>"`,
        );
        expect(junit.stdout).toMatchInlineSnapshot(`
          "<?xml version="1.0" encoding="UTF-8"?>
          <testsuites name="Oxlint" tests="2" failures="1" errors="1">
              <testsuite name="a.js" tests="2" disabled="0" errors="1" failures="1">
                  <testcase name="eslint(no-debugger)">
                      <error message="\`debugger\` statement is not allowed">line 1, column 1, \`debugger\` statement is not allowed</error>
                  </testcase>
                  <testcase name="eslint(eqeqeq)">
                      <failure message="Expected === and instead saw ==">line 2, column 8, Expected === and instead saw ==</failure>
                  </testcase>
              </testsuite>
          </testsuites>"
        `);
        expect(gitlab.raw.endsWith("]")).toBe(true);
        expect(JSON.parse(gitlab.raw).map(({ fingerprint, ...it }: any) => it)).toEqual([
          {
            description: "`debugger` statement is not allowed",
            check_name: "eslint(no-debugger)",
            severity: "critical",
            location: { path: "a.js", lines: { begin: 1, end: 1 } },
          },
          {
            description: "Expected === and instead saw ==",
            check_name: "eslint(eqeqeq)",
            severity: "major",
            location: { path: "a.js", lines: { begin: 2, end: 2 } },
          },
        ]);
        expect(sarif.raw.endsWith("}")).toBe(true);
        const run = JSON.parse(sarif.raw).runs[0];
        expect(run.tool.driver).toEqual({
          name: "oxlint",
          version: "1.87.0",
          semanticVersion: "1.87.0",
          informationUri: "https://oxc.rs/docs/guide/usage/linter.html",
          rules: [
            {
              id: "eslint(no-debugger)",
              name: "no-debugger",
              helpUri: "https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-debugger.html",
              properties: { category: "correctness", plugin: "eslint", fix: "fixable_suggestion" },
            },
            {
              id: "eslint(eqeqeq)",
              name: "eqeqeq",
              helpUri: "https://oxc.rs/docs/guide/usage/linter/rules/eslint/eqeqeq.html",
              properties: { category: "pedantic", plugin: "eslint", fix: "conditional_dangerous_fix" },
            },
          ],
        });
        expect(run.artifacts).toEqual([{ location: { uri: "a.js" } }]);
        expect(run.columnKind).toBe("unicodeCodePoints");
        expect(
          run.results.map((it: any) => [it.ruleId, it.ruleIndex, it.level, it.locations[0].physicalLocation.region]),
        ).toEqual([
          ["eslint(no-debugger)", 0, "error", { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 }],
          ["eslint(eqeqeq)", 1, "warning", { startLine: 2, startColumn: 8, endLine: 2, endColumn: 10 }],
        ]);
      });

      test("an argument that matches nothing is no error, no file at all is, with 1", async () => {
        const [some, none, tolerated] = await Promise.all([
          lint(files, ["-f", "unix", "nothing.js", "src/b.ts"]),
          lint(files, ["nothing.js"]),
          lint(files, ["--no-error-on-unmatched-pattern", "nothing.js"]),
        ]);
        expect({ some: some.exitCode, none: none.exitCode, tolerated: tolerated.exitCode }).toEqual({
          some: 0,
          none: 1,
          tolerated: 0,
        });
        expect(none.stdout).toContain("No files found to lint. Please check your paths and ignore patterns.");
      });

      test("options in the file: denyWarnings, maxWarnings", async () => {
        const warns = { "a.js": "if (a == b) {}\n" };
        const [plain, denied, limited] = await Promise.all([
          lint({ ...warns, ".oxlintrc.json": rc() }, []),
          lint({ ...warns, ".oxlintrc.json": rc({ options: { denyWarnings: true } }) }, []),
          lint({ ...warns, ".oxlintrc.json": rc({ options: { maxWarnings: 0 } }) }, []),
        ]);
        expect({ plain: plain.exitCode, denied: denied.exitCode, limited: limited.exitCode }).toEqual({
          plain: 0,
          denied: 1,
          limited: 1,
        });
      });

      test("a file that is named is left out if --ignore-path has it", async () => {
        const { stdout, exitCode } = await lint({ ...files, "my.ignore": "a.js\n" }, [
          "-f",
          "unix",
          "--ignore-path",
          "my.ignore",
          "a.js",
          "src/b.ts",
        ]);
        expect(stdout).toBe("");
        expect(exitCode).toBe(0);
      });

      test("-c: the patterns are from the directory of the file", async () => {
        const { stdout } = await lint(
          {
            "configs/x.json": rc({ overrides: [{ files: ["src/*.js"], rules: { "no-debugger": "off" } }] }),
            "configs/src/a.js": "debugger;\n",
            "src/a.js": "debugger;\n",
          },
          ["-c", "configs/x.json", "-f", "unix"],
        );
        expect(stdout).toMatchInlineSnapshot(`
          "src/a.js:1:1: \`debugger\` statement is not allowed [Error/eslint(no-debugger)]

          1 problem"
        `);
      });

      test("no-unused-private-class-members is about #names, not about `private`", async () => {
        const unused = "  private a = 1;\n  private b() {}\n  constructor(private c: number) {}\n";
        const [named, byDefault] = await Promise.all([
          lint(
            {
              ".oxlintrc.json": rc({ rules: { "no-unused-private-class-members": "error" } }),
              "a.ts": `export class A {\n${unused}  #d = 2;\n}\n`,
            },
            ["-f", "unix"],
          ),
          lint({ ".oxlintrc.json": "{}", "a.ts": `export class A {\n${unused}}\n` }, ["-f", "unix"]),
        ]);
        expect(named.stdout).toMatchInlineSnapshot(`
          "a.ts:5:3: 'd' is defined but never used. [Error/eslint(no-unused-private-class-members)]

          1 problem"
        `);
        expect(named.exitCode).toBe(1);
        expect(byDefault.stdout).toBe("");
        expect(byDefault.exitCode).toBe(0);
      });

      // What is expected in the next two tests is what oxlint 1.87.0 prints for the same files and arguments.
      const places = (raw: string) =>
        JSON.parse(raw)
          .diagnostics.map((it: any) => `${it.filename}:${it.labels[0].span.line} ${it.code} ${it.severity}`)
          .sort();
      const unused = { "a.ts": "const u = 1;\nexport {};\n" };
      const any = { "a.ts": "export let a: any;\n" };

      test("all names of a rule are one rule, and what is said last about it counts", async () => {
        const hooks = { "a.jsx": "function C(a) {\n  if (a) useState();\n}\n" };
        const spread = { "a.js": "x.reduce((acc, it) => [...acc, it], []);\n" };
        // The directory, what its .oxlintrc.json says, its files.
        const rows: [string, object, Record<string, string>][] = [
          [
            "off-then-typescript",
            { plugins: ["react"], rules: { "no-unused-vars": "off", "typescript/no-unused-vars": "warn" } },
            unused,
          ],
          [
            "typescript-then-off",
            { plugins: ["react"], rules: { "typescript/no-unused-vars": "warn", "no-unused-vars": "off" } },
            unused,
          ],
          [
            "warn-then-error",
            {
              plugins: ["react"],
              rules: { "eslint/no-unused-vars": "warn", "@typescript-eslint/no-unused-vars": "error" },
            },
            unused,
          ],
          ["no-plugins", { plugins: [], rules: { "@typescript-eslint/no-unused-vars": "warn" } }, unused],
          ["underscore", { rules: { "typescript_eslint/no-unused-vars": "warn" } }, unused],
          [
            "overrides",
            {
              plugins: ["react"],
              rules: { "no-unused-vars": "off" },
              overrides: [{ files: ["*.ts"], rules: { "typescript/no-unused-vars": "warn" } }],
            },
            unused,
          ],
          [
            "extends",
            { plugins: ["react"], extends: ["./base.json"] },
            { ...unused, "base.json": JSON.stringify({ rules: { "typescript/no-unused-vars": "warn" } }) },
          ],
          ["bare-then-off", { rules: { "no-explicit-any": "warn", "typescript/no-explicit-any": "off" } }, any],
          [
            "off-then-bare",
            { rules: { "@typescript-eslint/no-explicit-any": "off", "no-explicit-any": "error" } },
            any,
          ],
          ["bare-without-its-plugin", { plugins: ["react"], rules: { "no-explicit-any": "error" } }, any],
          // `import/no-namespace`, and that plugin is not on.
          ["bare-of-the-first-plugin", { rules: { "no-namespace": "error" } }, { "a.ts": "namespace N {}\n" }],
          ["bare-hooks", { plugins: ["react"], rules: { "rules-of-hooks": "warn" } }, hooks],
          [
            "hooks-then-off",
            { plugins: ["react"], rules: { "react-hooks/rules-of-hooks": "warn", "react/rules-of-hooks": "off" } },
            hooks,
          ],
          [
            "package-name",
            { plugins: ["react"], rules: { "eslint-plugin-react-hooks/rules-of-hooks": "warn" } },
            hooks,
          ],
          [
            "deepscan",
            { rules: { "oxc/no-accumulating-spread": "off", "deepscan/no-accumulating-spread": "warn" } },
            spread,
          ],
          [
            "bare-cycle",
            { plugins: ["import"], rules: { "no-cycle": "warn" } },
            { "a.js": 'import "./b";\n', "b.js": 'import "./a";\n' },
          ],
          // oxlint has one in `eslint`, which needs no types, and one in `typescript`.
          [
            "two-rules",
            { rules: { "require-await": "warn", "typescript/require-await": "off" } },
            { "a.ts": "export async function f() {\n  x;\n}\n" },
          ],
        ];
        const files: Record<string, string> = { ".oxlintrc.json": rc({ rules: {} }) };
        for (const [directory, config, texts] of rows) {
          files[`${directory}/.oxlintrc.json`] = rc({ rules: {}, ...config });
          for (const [name, text] of Object.entries(texts)) files[`${directory}/${name}`] = text;
        }
        const { raw, exitCode } = await lint(files, ["-f", "json"]);
        expect(places(raw)).toEqual([
          "bare-cycle/a.js:1 import(no-cycle) warning",
          "bare-cycle/b.js:1 import(no-cycle) warning",
          "bare-hooks/a.jsx:2 react-hooks(rules-of-hooks) warning",
          "deepscan/a.js:1 oxc(no-accumulating-spread) warning",
          "extends/a.ts:1 eslint(no-unused-vars) warning",
          "no-plugins/a.ts:1 eslint(no-unused-vars) warning",
          "off-then-bare/a.ts:1 typescript(no-explicit-any) error",
          "off-then-typescript/a.ts:1 eslint(no-unused-vars) warning",
          "overrides/a.ts:1 eslint(no-unused-vars) warning",
          "package-name/a.jsx:2 react-hooks(rules-of-hooks) warning",
          "two-rules/a.ts:1 eslint(require-await) warning",
          "underscore/a.ts:1 eslint(no-unused-vars) warning",
          "warn-then-error/a.ts:1 eslint(no-unused-vars) error",
        ]);
        expect(exitCode).toBe(1);
      });

      test("-A, -W and -D come after `rules`, a category too, and know a rule by the plugin that oxlint has it in", async () => {
        const debug = { "a.js": "debugger;\n" };
        // The arguments, `rules`, the files, what is reported.
        const rows: [string[], object, Record<string, string>, string[]][] = [
          [["-D", "correctness"], { "no-debugger": "off" }, debug, ["a.js:1 eslint(no-debugger) error"]],
          [["-W", "correctness"], { "no-debugger": "error" }, debug, ["a.js:1 eslint(no-debugger) warning"]],
          [["-A", "correctness"], { "no-debugger": "error" }, debug, []],
          [["-D", "all"], { "no-debugger": "off" }, debug, ["a.js:1 eslint(no-debugger) error"]],
          [["-D", "no-debugger", "-A", "correctness"], {}, debug, []],
          [
            ["-A", "typescript/no-unused-vars"],
            { "no-unused-vars": "warn" },
            unused,
            ["a.ts:1 eslint(no-unused-vars) warning"],
          ],
          [
            ["-D", "@typescript-eslint/no-unused-vars"],
            { "no-unused-vars": "warn" },
            unused,
            ["a.ts:1 eslint(no-unused-vars) warning"],
          ],
          [["-A", "no-unused-vars"], { "typescript/no-unused-vars": "warn" }, unused, []],
          // The options stay.
          [
            ["-D", "eslint/no-unused-vars"],
            { "typescript/no-unused-vars": ["warn", { varsIgnorePattern: "^u" }] },
            unused,
            [],
          ],
          [
            ["-D", "no-explicit-any"],
            { "typescript/no-explicit-any": "warn" },
            any,
            ["a.ts:1 typescript(no-explicit-any) error"],
          ],
        ];
        const results = await Promise.all(
          rows.map(([args, rules, texts]) =>
            lint({ ".oxlintrc.json": rc({ rules }), ...texts }, [...args, "-f", "json"]),
          ),
        );
        expect(results.map(it => places(it.raw))).toEqual(rows.map(it => it[3]));
        expect(results.map(it => it.exitCode)).toEqual(
          rows.map(it => (it[3].some(it => it.endsWith("error")) ? 1 : 0)),
        );
      });

      test("the rules that ESLint has given up and oxlint has in `node` run if that plugin is on", async () => {
        const texts: Record<string, string> = {
          "callback-return": "function f(err, callback) {\n  if (err) {\n    callback(err);\n  }\n  callback();\n}\n",
          "global-require": 'function f() {\n  require("a");\n}\n',
          "handle-callback-err": "function f(err) {}\n",
          "no-mixed-requires": 'var a = require("a"),\n  b = 1;\n',
          "no-new-require": 'new require("a");\n',
          "no-path-concat": '__dirname + "/a";\n',
          "no-process-env": "process.env.A;\n",
          "no-sync": "fs.readFileSync();\n",
        };
        const files: Record<string, string> = { ".oxlintrc.json": rc({ rules: {} }) };
        for (const [directory, prefix, plugins] of [
          ["bare-on", "", ["node"]],
          ["bare-off", "", []],
          ["node-on", "node/", ["node"]],
          ["node-off", "node/", []],
        ] as const) {
          const rules = Object.fromEntries(Object.keys(texts).map(it => [prefix + it, "warn"]));
          files[`${directory}/.oxlintrc.json`] = rc({ plugins, rules });
          for (const [name, text] of Object.entries(texts)) files[`${directory}/${name}.js`] = text;
        }
        const { raw, exitCode } = await lint(files, ["-f", "json"]);
        // oxlint 1.87.0 calls them node(no-sync) and so on.
        const found = places(raw).map((it: string) => it.replace(/ \w+\((.*)\) /, " $1 "));
        const lines = { "callback-return": 3, "global-require": 2 };
        expect(found).toEqual(
          ["bare-on", "node-on"].flatMap(directory =>
            Object.keys(texts).map(it => `${directory}/${it}.js:${lines[it as keyof typeof lines] ?? 1} ${it} warning`),
          ),
        );
        expect(exitCode).toBe(0);
      });

      // The projects of oracle/plugins/oxlint. expected.json is what oxlint 1.87.0 with tsgolint 7.0.2003 reports for them.
      const found = (raw: string, names: string[]) => {
        const byProject = Object.fromEntries(names.map((it): [string, Set<string>] => [it, new Set()]));
        for (const it of JSON.parse(raw).diagnostics) {
          // A syntax error.
          if (!it.code) continue;
          const name = names.find(name => it.filename.startsWith(name + "/"))!;
          const { line, column } = it.labels[0].span;
          byProject[name].add(`${it.filename.slice(name.length + 1)}:${line}:${column} ${it.code}`);
        }
        return Object.fromEntries(names.map(it => [it, [...byProject[it]].sort()]));
      };
      // With the length of what is pointed at, and each report as often as it is made: two can begin at one place.
      const foundExactly = (raw: string, names: string[]) => {
        const byProject = Object.fromEntries(names.map((it): [string, string[]] => [it, []]));
        for (const it of JSON.parse(raw).diagnostics) {
          // A syntax error.
          if (!it.code) continue;
          const name = names.find(name => it.filename.startsWith(name + "/"))!;
          const { line, column, length } = it.labels[0].span;
          byProject[name].push(`${it.filename.slice(name.length + 1)}:${line}:${column}+${length} ${it.code}`);
        }
        return Object.fromEntries(names.map(it => [it, byProject[it].sort()]));
      };
      const expected = (names: string[]) =>
        Object.fromEntries(names.map(it => [it, whatOxlintReports[it as keyof typeof whatOxlintReports]]));
      // All that is marked for a report, and what is said there, where that is more than one place without a text. labels.json has
      // only the projects in which there is such a report.
      const marked = (raw: string, names: string[]) => {
        const byProject = Object.fromEntries(names.map((it): [string, string[]] => [it, []]));
        for (const it of JSON.parse(raw).diagnostics) {
          const name = names.find(name => it.filename.startsWith(name + "/"))!;
          const labels = it.code && labelsOf(it);
          if (labels) byProject[name].push(`${it.filename.slice(name.length + 1)} ${it.code} ${labels}`);
        }
        return Object.fromEntries(names.map(it => [it, byProject[it].sort()]));
      };
      const expectedMarks = (names: string[]) =>
        Object.fromEntries(names.map(it => [it, (whatOxlintMarks as Record<string, string[]>)[it] ?? []]));

      // The tests that lint hundreds of directories are serial: beside them the others do not get the processor in time.

      test.serial(
        "the rules report what oxlint's report, where they report it",
        async () => {
          const some = projects.filter(it => !it.typed && it.name !== "no-cycle/many-files");
          const files: Record<string, string> = { ".oxlintrc.json": rc({ rules: {} }) };
          for (const { name, config, files: texts } of some) {
            files[`${name}/.oxlintrc.json`] = JSON.stringify(config);
            for (const [path, text] of Object.entries(texts)) files[`${name}/${path}`] = text;
          }
          const names = some.map(it => it.name);
          const { raw } = await lint(files, ["-f", "json"]);
          expect(foundExactly(raw, names)).toEqual(expected(names));
          expect(marked(raw, names)).toEqual(expectedMarks(names));
        },
        isDebug || isASAN ? 120_000 : 30_000,
      );

      // Each project is a program of its own. In four runs: one takes seconds in a debug build.
      test.serial.each([0, 1, 2, 3])(
        "the rules that need types report what tsgolint's report: part %d",
        async part => {
          const some = projects.filter(it => it.typed).filter((_, index) => index % 4 === part);
          const compilerOptions = { strict: true, target: "esnext", module: "esnext", lib: ["esnext", "dom"] };
          const files: Record<string, string> = { ".oxlintrc.json": rc({ rules: {} }) };
          for (const { name, config, files: texts } of some) {
            files[`${name}/.oxlintrc.json`] = JSON.stringify(config);
            files[`${name}/tsconfig.json`] = JSON.stringify({ compilerOptions });
            for (const [path, text] of Object.entries(texts)) files[`${name}/${path}`] = text;
          }
          const names = some.map(it => it.name);
          const { raw } = await lint(files, ["-f", "json", "--type-aware"]);
          expect(foundExactly(raw, names)).toEqual(expected(names));
          expect(marked(raw, names)).toEqual(expectedMarks(names));
        },
        isDebug || isASAN ? 120_000 : 30_000,
      );

      // messages.json has what oxlint 1.87.0 with tsgolint 7.0.2003 says.
      test("the rules that oxlint shares with ESLint and typescript-eslint say what oxlint's say", async () => {
        const { raw } = await lint(filesOfMessages(messages), ["-f", "json", "--type-aware"]);
        const said = messagesOf(raw, messages).map((it, index) => `${messages[index].rule} ${it.join(" | ")}`);
        // Of several the last is the one that is asked about.
        const before = (index: number) => messagesOf(raw, messages)[index].slice(0, messages[index].index ?? 0);
        expect(said).toEqual(messages.map((it, index) => `${it.rule} ${[...before(index), it.message].join(" | ")}`));
        // A help that is printed is oxlint's, and none is lacking.
        const helps = helpsOf(raw, messages).map((it, index) => ({ ...messages[index], said: it }));
        const wrong = helps.filter(it => it.said !== undefined && it.said !== it.help);
        expect(wrong.map(it => [it.rule, it.id])).toEqual([]);
        expect(helps.filter(it => it.said === undefined && it.help !== undefined).length).toBeLessThanOrEqual(0);
      });

      // The table has no texts of messages, only numbers that are made of them: a message that is reworded would lose its help.
      test("every help of oxlint belongs to a message that a rule has", () => {
        const root = join(import.meta.dir, "../../../src/lint");
        const unescaped = (text: string) =>
          text.replace(/\\\n\s*/g, "").replace(/\\(.)/g, (_, it) => ({ n: "\n", t: "\t" })[it as "n"] ?? it);
        const byId = new Map<string, Set<string>>();
        for (const file of new Bun.Glob("**/*.rs").scanSync(root)) {
          const text = readFileSync(join(root, file), "utf8");
          for (const [, id, plain, , raw] of text.matchAll(
            /(?:Message::new|\bm)\(\s*"([\w-]*)",\s*(?:"((?:[^"\\]|\\.)*)"|r(#*)"(.*?)"\3)/gs,
          )) {
            if (!byId.has(id)) byId.set(id, new Set());
            byId.get(id)!.add(raw ?? unescaped(plain));
          }
        }
        const key = (rule: string, id: string, text: string) => {
          const low = (hash: number | bigint) => Number(BigInt.asUintN(32, BigInt(hash)));
          const message = low(Bun.hash.wyhash(text, BigInt(Bun.hash.wyhash(id, 0n))));
          return (low(Bun.hash.wyhash(rule, 0n)) ^ ((message << 16) | (message >>> 16))) >>> 0;
        };
        const table = readFileSync(join(root, "oxlint_help.rs"), "utf8");
        const entries = [...table.matchAll(/^ {4}\(0x([0-9A-F]{8}), .*\), \/\/ (\S+) ?([\w-]*)$/gm)];
        expect(entries.length).toBeGreaterThan(700);
        const lost = entries.filter(
          ([, hash, rule, id]) => ![...(byId.get(id) ?? [])].some(text => key(rule, id, text) === parseInt(hash, 16)),
        );
        expect(lost.map(it => it[0].trim())).toEqual([]);
      });

      // What oxlint 1.87.0 with tsgolint 7.0.2003 reports.
      test("JavaScript is linted with types without allowJs, and is `any` to the TypeScript that imports it", async () => {
        const { raw } = await lint(
          {
            ".oxlintrc.json": rc({
              rules: { "typescript/no-floating-promises": "error", "typescript/no-unsafe-call": "error" },
            }),
            "tsconfig.json": JSON.stringify({
              compilerOptions: { strict: true, module: "esnext", moduleResolution: "bundler" },
              include: ["src"],
            }),
            "src/lib.js": `export async function later() {}\nlater();\n`,
            "src/use.ts": `import { later } from "./lib.js";\nlater();\n`,
            "scripts/out.mjs": `import { later } from "../src/lib.js";\nlater();\n`,
            "scripts/out.cjs": `const { later } = require("../src/lib.js");\nlater();\n`,
          },
          ["-f", "json", "--type-aware"],
        );
        expect(found(raw, ["scripts", "src"])).toEqual({
          scripts: [
            "out.cjs:1:19 typescript(no-unsafe-call)",
            "out.cjs:2:1 typescript(no-floating-promises)",
            "out.mjs:2:1 typescript(no-floating-promises)",
          ],
          src: ["lib.js:2:1 typescript(no-floating-promises)", "use.ts:2:1 typescript(no-unsafe-call)"],
        });
      });

      // What oxlint 1.87.0 with tsgolint 7.0.2003 does: there is no program for such a tsconfig.json, so no rule that needs types
      // runs on its files, and nothing is fixed on types that do not resolve. Each error of TypeScript is one of oxlint.
      test("a tsconfig.json that TypeScript refuses is an error, and its files are linted without types", async () => {
        const options = `"strict":true,"lib":["esnext"]`;
        const code = "declare const s: string;\nexport const g = s as string;\ndebugger;\n";
        const { raw, exitCode, files } = await lint(
          {
            ".oxlintrc.json": rc({
              rules: { "typescript/no-unnecessary-type-assertion": "error", "no-debugger": "error" },
            }),
            "good/tsconfig.json": `{"compilerOptions":{${options}}}`,
            "good/a.ts": code,
            "removed/tsconfig.json": `{"compilerOptions":{${options},"baseUrl":".","target":"es5","types":["node","bun"]}}`,
            "removed/a.ts": code,
            "base.json": `{"compilerOptions":{${options},"moduleResolution":"node"}}`,
            "inherited/tsconfig.json": `{"extends":"../base.json"}`,
            "inherited/a.ts": code,
            "unknown/tsconfig.json": `{"compilerOptions":{${options},"nope":true}}`,
            "unknown/a.ts": code,
            "unfinished/tsconfig.json": `{"compilerOptions":{${options}}`,
            "unfinished/a.ts": "export {};\n",
            "in-no-project.ts": code,
          },
          ["-f", "json", "--type-aware", "--fix"],
          { reads: ["good/a.ts", "removed/a.ts", "in-no-project.ts"] },
        );
        const removed = "has been removed. Please remove it from your configuration.";
        const see = "\nSee https://github.com/oxc-project/tsgolint/issues/351 for more information.";
        const found = JSON.parse(raw).diagnostics.map((it: any) => {
          const { line, column, length } = it.labels[0]?.span ?? {};
          return [it.filename, line, column, length, it.severity, it.code, it.message, it.help ?? ""].join(" ");
        });
        const invalid = "error typescript(tsconfig-error) Invalid tsconfig";
        expect(found.filter((it: string) => it.includes("tsconfig")).sort()).toEqual([
          `inherited/tsconfig.json    ${invalid} Option 'moduleResolution=node10' ${removed}${see}`,
          `removed/tsconfig.json    ${invalid} Cannot find type definition file for 'bun'.`,
          `removed/tsconfig.json    ${invalid} Cannot find type definition file for 'node'.`,
          `removed/tsconfig.json 1 52 9 ${invalid} Option 'baseUrl' ${removed}${see}`,
          `removed/tsconfig.json 1 75 5 ${invalid} Option 'target=ES5' ${removed}${see}`,
          `unfinished/tsconfig.json 1 52 0 ${invalid} '}' expected.`,
          `unknown/tsconfig.json 1 52 6 ${invalid} Unknown compiler option 'nope'.`,
        ]);
        // The rules that need no types run everywhere.
        expect(found.filter((it: string) => it.includes("no-debugger")).length).toBe(5);
        const fixed = code.replace(" as string", "");
        expect(files).toEqual({ "good/a.ts": fixed, "removed/a.ts": code, "in-no-project.ts": fixed });
        expect(exitCode).toBe(1);
      });

      // What oxlint 1.87.0 with tsgolint 7.0.2003 does. Added to the project as root files, the two .mjs would be errors of the
      // program (6504), and the tsconfig.json would be refused for them.
      test("--tsconfig is the project of the files that it includes, the others are in no project", async () => {
        const code = "async function f() { return 1; }\nf();\n";
        const { stdout, exitCode } = await lint(
          {
            ".oxlintrc.json": rc({ rules: { "typescript/no-floating-promises": "error" } }),
            "tsconfig.json": JSON.stringify({
              include: ["src"],
              compilerOptions: { strict: true, lib: ["es2022"], types: [] },
            }),
            "src/a.ts": code,
            "src/b.mjs": code,
            "other/c.ts": code,
            "other/d.mjs": code,
          },
          ["-f", "unix", "--type-aware", "--tsconfig", "./tsconfig.json", "src", "other"],
        );
        const places = stdout.split("\n").filter(it => it.includes("[Error/"));
        expect(places.map(it => it.replace(/: .* \[/, " [")).sort()).toEqual(
          ["other/c.ts", "other/d.mjs", "src/a.ts", "src/b.mjs"].map(
            it => `${it}:2:1 [Error/typescript(no-floating-promises)]`,
          ),
        );
        expect(exitCode).toBe(1);
      });

      // A file is parsed once for all projects of a run that read it alike. Each of these pairs reads it in two ways.
      describe("a file of two projects is to each what the options of the project make of it", () => {
        const project = (more: object, include: string[]) =>
          JSON.stringify({
            compilerOptions: {
              strict: true,
              noEmit: true,
              module: "esnext",
              moduleResolution: "bundler",
              target: "es2022",
              types: [],
              lib: ["es2022"],
              ...more,
            },
            include,
          });

        // It has no `import` and no `export`: a script, whose variable `use.ts` sees, or a module all the same.
        test.each([
          ["moduleDetection", { moduleDetection: "force" }, { moduleDetection: "legacy" }, "p.ts", "1"],
          ["jsx", { jsx: "react-jsx" }, { jsx: "preserve" }, "p.tsx", "<a />"],
          ["the type of its package", { module: "nodenext", moduleResolution: "nodenext" }, {}, "p.ts", "1"],
        ])("%s", async (_, asModule, asScript, name, value) => {
          const run = async (a: object, b: object) => {
            const { raw } = await lint(
              {
                ".oxlintrc.json": rc({ rules: { "typescript/no-floating-promises": "error" } }),
                "a/tsconfig.json": project(a, ["*.ts", `../shared/${name}`]),
                "a/use.ts": "shared;\nexport {};\n",
                "b/tsconfig.json": project(b, ["*.ts", `../shared/${name}`]),
                "b/use.ts": "shared;\nexport {};\n",
                "shared/package.json": `{ "type": "module" }`,
                [`shared/${name}`]: `const shared = Promise.resolve(${value});\n`,
              },
              ["-f", "json", "--type-aware"],
            );
            return found(raw, ["a", "b", "shared"]);
          };
          const reported = ["use.ts:1:1 typescript(no-floating-promises)"];
          expect(await Promise.all([run(asModule, asScript), run(asScript, asModule)])).toEqual([
            { a: [], b: reported, shared: [] },
            { a: reported, b: [], shared: [] },
          ]);
        });

        // Two copies of one version of a package are one file to a program, and a private name is of one class. Both projects
        // have both copies.
        test("the files of a package", async () => {
          const pkg = {
            "package.json": `{ "name": "pkg", "version": "1.0.0", "types": "index.d.ts" }`,
            "index.d.ts": `export declare class C {\n  #secret;\n  later(): Promise<void>;\n}\n`,
          };
          const use = `import { make } from "dep";\nimport { C } from "pkg";\nexport const c: C = make();\nc.later();\n`;
          const { raw } = await lint(
            {
              ".oxlintrc.json": rc({ rules: { "typescript/no-floating-promises": "error" } }),
              ...Object.fromEntries(Object.entries(pkg).map(([name, text]) => [`node_modules/pkg/${name}`, text])),
              ...Object.fromEntries(
                Object.entries(pkg).map(([name, text]) => [`node_modules/dep/node_modules/pkg/${name}`, text]),
              ),
              "node_modules/dep/package.json": `{ "name": "dep", "version": "1.0.0", "types": "index.d.ts" }`,
              "node_modules/dep/index.d.ts": `import { C } from "pkg";\nexport declare function make(): C;\n`,
              "a/tsconfig.json": project({}, ["*.ts"]),
              "a/use.ts": use,
              "b/tsconfig.json": project({}, ["*.ts"]),
              "b/use.ts": use,
            },
            ["-f", "json", "--type-aware", "--type-check"],
          );
          const reported = ["use.ts:4:1 typescript(no-floating-promises)"];
          expect(found(raw, ["a", "b"])).toEqual({ a: reported, b: reported });
        });

        // Each project imports the file of the other, which has the same text, before or after that project reads it itself.
        test.each([
          [
            "experimentalDecorators",
            {},
            { experimentalDecorators: true },
            "declare const dec: any;\nexport class C {\n  constructor(@dec x: number) {}\n}\n",
            { a: ["own.ts:3:15 typescript(TS1206)"], b: [] },
          ],
          [
            "useDefineForClassFields",
            { useDefineForClassFields: true },
            { useDefineForClassFields: false },
            "const y = 1;\nexport class C {\n  x = y;\n  constructor(y: string) {}\n}\n",
            { a: [], b: ["own.ts:3:7 typescript(TS2301)"] },
          ],
          [
            "a target before ES2020",
            {},
            { target: "es2019" },
            "declare const o: { x?: number } | undefined;\nexport function f(a = o?.x, b = () => a) {\n  var o = 1;\n  return [a, b, o];\n}\n",
            {
              a: [],
              b: ["own.ts:2:23 typescript(TS2373)", "own.ts:2:23 typescript(TS2454)", "own.ts:2:26 typescript(TS2339)"],
            },
          ],
          [
            "a target before ES2017",
            {},
            { target: "es2016", lib: ["es2017"] },
            "declare const o: { x: number };\nexport function f({ ...r } = o) {\n  var o = 1;\n  return [r, o];\n}\n",
            {
              a: [],
              b: ["own.ts:2:24 typescript(TS2700)", "own.ts:2:30 typescript(TS2373)", "own.ts:2:30 typescript(TS2454)"],
            },
          ],
        ])("%s", async (_, a, b, text, errors) => {
          const { raw } = await lint(
            {
              ".oxlintrc.json": rc({ rules: {} }),
              "a/tsconfig.json": project(a, ["*.ts"]),
              "a/own.ts": text,
              "a/use.ts": `import "../b/own";\n`,
              "b/tsconfig.json": project(b, ["*.ts"]),
              "b/own.ts": text,
              "b/use.ts": `import "../a/own";\n`,
            },
            ["-f", "json", "--type-aware", "--type-check"],
          );
          expect(found(raw, ["a", "b"])).toEqual(errors);
        });
      });

      const kindsOfFixes = (Object.keys(flagSets) as (keyof typeof flagSets)[]).flatMap(flags =>
        [false, true].map((typed): [keyof typeof flagSets, boolean] => [flags, typed]),
      );
      test.serial.each(kindsOfFixes)(
        "the flags of %s change what they change with oxlint (rules that need types: %p)",
        async (flags, typed) => {
          // fixes.expected.json is what oxlint 1.87.0 with tsgolint 7.0.2003 makes of the files. fixes.differences.json: not yet.
          const differs = (directory: string) =>
            (fixDifferences as Record<string, string[]>)[directory]?.includes(flags);
          const some = fixCases
            .map((it, index) => ({ it, directory: directoryOf(index) }))
            .filter(({ it, directory }) => !!it.typed === typed && !differs(directory));
          expect(some.length).toBeGreaterThan(5);
          const files: Record<string, string> = { ".oxlintrc.json": rc({ rules: {} }) };
          for (const { it, directory } of some) {
            for (const [path, text] of Object.entries(filesOf(it))) files[`${directory}/${path}`] = text;
          }
          const reads = some.map(({ it, directory }) => `${directory}/${it.file}`);
          const result = await lint(files, [...flagSets[flags], ...(typed ? ["--type-aware"] : [])], { reads });
          expect(result.files).toEqual(
            Object.fromEntries(
              some.map(({ it, directory }) => [
                `${directory}/${it.file}`,
                whatOxlintFixes[directory as keyof typeof whatOxlintFixes][flags],
              ]),
            ),
          );
        },
        isDebug || isASAN ? 120_000 : 30_000,
      );

      test("the options that oxlint accepts are accepted", async () => {
        // A configuration that is refused ends the run. options.json is what oxlint 1.87.0 accepts. Each of the configurations has
        // options for many rules.
        const configs = configurations(optionsOfOxlint);
        expect(configs.length).toBeGreaterThan(100);
        const files: Record<string, string> = { ".oxlintrc.json": rc({ rules: {} }) };
        configs.forEach((config, index) => {
          files[`${index}/.oxlintrc.json`] = JSON.stringify(config);
          files[`${index}/a.ts`] = "export {};\n";
        });
        const { raw } = await lint(files, ["-f", "json"]);
        // What is refused is said instead.
        expect(raw.startsWith("{") ? JSON.parse(raw).number_of_files : raw).toBe(configs.length);
      });
    });

    test(".eslintrc.json", async () => {
      const { stdout } = await lint(
        {
          ".eslintrc.json": `{ "root": true, "env": { "node": true }, "rules": { "no-undef": "error" }, "overrides": [{ "files": ["*.test.js"], "globals": { "test": "readonly" } }] }`,
          "a.js": "process.exit(test);\n",
          "a.test.js": "process.exit(test);\n",
        },
        ["-f", "unix"],
      );
      expect(stdout).toMatchInlineSnapshot(`
        "<dir>/a.js:1:14: 'test' is not defined. [Error/no-undef]

        1 problem"
      `);
    });
  });

  test("no-useless-assignment: the name of a class declaration is one variable around the class and another in it", async () => {
    // What is expected is what ESLint 10.12.0 reports.
    const cases: [string, string[]][] = [
      ["(v0 = v0); class v0 extends (function () { return v0; }) { }", ["1:2"]],
      ["const v1 = (() => (v3)); class v3 extends [({ k: [(v3 = v3)] })] { }", ["1:52"]],
      ["class v4 extends v4 { static p = v4; } let [[v5 = (v4 = v4)]] = (0);", ["1:52"]],
      ["function v6() { v7; class v7 extends ([v7] = (0)) { } }", []],
      ["({ v8 } = v8); class v8 extends v8 { }", ["1:4"]],
      ["let [q = v9] = 0; class v9 extends (v9 = 0) { }", []],
      ["let r = v10; class v10 extends (v10 = 0) { }", []],
      ["class a extends (a = 0) { } g(a);", []],
      ["class a { m() { return a; } } a = 0;", []],
      ["class a { m() { return a; } } a = 0; g(a);", []],
      ["class a { static p = (a = 0); } g(a);", []],
      ["class a { m() { a = 0; } } g(a);", []],
    ];
    const files: Record<string, string> = {
      "eslint.config.js": `export default [{ languageOptions: { sourceType: "script" }, rules: { "no-useless-assignment": "error" } }];\n`,
    };
    cases.forEach(([code], i) => (files[`c${i}.cjs`] = code + "\n"));
    const { raw } = await lint(files, ["-f", "json", "*.cjs"]);
    const reported = Object.fromEntries(
      JSON.parse(raw).map((it: any) => [
        it.filePath.replace(/^.*[\\/]/, ""),
        it.messages.map((it: any) => `${it.line}:${it.column}`),
      ]),
    );
    expect(reported).toEqual(Object.fromEntries(cases.map(([, places], i) => [`c${i}.cjs`, places])));
  });

  describe("comments", () => {
    const files = {
      "eslint.config.js": config({ "no-debugger": "error" }),
      "a.js":
        "// eslint-disable-next-line no-debugger -- on purpose\ndebugger;\n// eslint-disable-next-line no-debugger\nexport {};\n",
    };

    test("eslint-disable, and a warning for one that disables nothing", async () => {
      const { stdout, exitCode } = await lint(files, ["-f", "unix"]);
      expect(stdout).toMatchInlineSnapshot(`
        "<dir>/a.js:3:1: Unused eslint-disable directive (no problems were reported from 'no-debugger'). [Warning]

        1 problem"
      `);
      expect(exitCode).toBe(0);
    });

    test("--no-inline-config", async () => {
      const { stdout, exitCode } = await lint(files, ["-f", "unix", "--no-inline-config"]);
      expect(stdout).toMatchInlineSnapshot(`
        "<dir>/a.js:2:1: Unexpected 'debugger' statement. [Error/no-debugger]

        1 problem"
      `);
      expect(exitCode).toBe(1);
    });

    test("--report-unused-disable-directives-severity", async () => {
      const [off, error] = await Promise.all([
        lint(files, ["--report-unused-disable-directives-severity", "off"]),
        lint(files, ["--report-unused-disable-directives-severity", "error"]),
      ]);
      expect({ off: off.exitCode, error: error.exitCode }).toEqual({ off: 0, error: 1 });
      expect(off.raw).toBe("");
    });
  });

  // A file to which links give several names, and rules that look at several files. It must be the same in every run.
  describe("a file that has several names by links", () => {
    const project = (configuration: Record<string, string>) => {
      const dir = tempDir("bun-lint-links", {
        ...configuration,
        "real/skills/a.js": `import { a } from "./b.js";\nimport { c } from "./b.js";\nexport { a, c };\n`,
        "real/skills/b.js": `import { a } from "./a.js";\nexport const b = a, c = 2;\nexport { b as a };\n`,
        "other/keep.txt": "",
      });
      symlinkSync(join(String(dir), "real/skills"), join(String(dir), "other/skills"), "junction");
      // Not everybody may make one on Windows.
      if (!isWindows) symlinkSync("a.js", join(String(dir), "real/skills/c.js"));
      return dir;
    };
    /** The files that have a report, for each outcome that there is among twenty runs. */
    const outcomes = async (cwd: string) => {
      const runs = Array.from({ length: 20 }, async () => {
        await using proc = spawn({
          cmd: [...command, "--threads", "4", "-f", "unix", "."],
          env,
          cwd,
          stdout: "pipe",
          stderr: "pipe",
        });
        const lines = (await proc.stdout.text()).replaceAll("\\", "/").split("\n");
        return lines.flatMap(it => /((?:real|other)\/skills\/\w+\.js):\d+:\d+: /.exec(it)?.[1] ?? []).sort();
      });
      return [...new Set((await Promise.all(runs)).map(it => it.join(" ")))];
    };

    // oxlint 1.87 follows links, and lints a file under each of its names.
    test("with an .oxlintrc.json it is reported under each", async () => {
      using dir = project({
        ".oxlintrc.json": JSON.stringify({
          plugins: ["import"],
          categories: { correctness: "off" },
          rules: { "import/no-duplicates": "error" },
        }),
      });
      const names = isWindows ? ["a.js"] : ["a.js", "c.js"];
      const expected = ["other", "real"].flatMap(it => names.map(name => `${it}/skills/${name}`));
      expect(await outcomes(String(dir))).toEqual([expected.join(" ")]);
    });

    // ESLint 10.12 enters no directory that is a link. eslint-plugin-import 2.32.0 knows the file that is linted by its name, and
    // what it imports without links: nothing imports c.js, so it is in no cycle.
    test("with an eslint.config.js the link to a file is a module of its own", async () => {
      using dir = project({
        "eslint.config.mjs": `export default [{
          plugins: { import: { meta: { name: "eslint-plugin-import" }, rules: {} } },
          rules: { "import/no-cycle": "error" },
        }];`,
      });
      expect(await outcomes(String(dir))).toEqual(["real/skills/a.js real/skills/b.js"]);
    });
  });

  // The defaults, the places and the texts of ESLint's rules are those of the major version of `eslint` that is installed for the
  // configuration file. What ESLint 9.39.5 and ESLint 10.12.0 report.
  describe("the rules of ESLint are those of the eslint that is installed", () => {
    const files = {
      "eslint.config.mjs":
        'export default [{ linterOptions: { reportUnusedDisableDirectives: "error" }, rules: {\n  "max-depth": ["error", 1], "max-statements": ["error", 2], "max-lines-per-function": ["error", 3], "max-nested-callbacks": ["error", 1],\n  "require-yield": "error", "no-useless-constructor": "error", "no-shadow-restricted-names": "error", "new-cap": ["error", { properties: false }],\n  radix: ["error", "as-needed"], "use-isnan": "error", "no-extra-boolean-cast": "error", "prefer-promise-reject-errors": "error",\n  "no-async-promise-executor": "error",\n} }];\n',
      "a.js":
        "function f1(a) { if (a) { if (a) { a; } } }\nfunction f2(a) { if (a) {} else if (a) {} if (a) { if (a) {} } }\nfunction f3(a) { a; a; a; }\nconst f4 = (a) => { a; a; a; };\nfunction f5(a) {\n  a;\n  f4;\n}\nf1(function () { f1(function () { f1(() => {}); }); });\nf1(function () { const g = function () {}; f1(function () { g; }); });\n(function () { f1(() => {}); })();\nfunction* f6() { return 1; }\nclass A { constructor() {} *m() { return 1; } }\nfunction f7(globalThis) { globalThis; }\nfunction f8(constructor) { return [new constructor(), new this.constructor(), f8.UTC(), f8.String()]; }\nparseInt(f1); parseInt(f1, 10); parseInt(f1, 16);\nfunction f9(NaN) { return f1 === NaN; }\nfunction f10(Boolean) { if (Boolean(f1)) {} }\nfunction f11(Promise) { Promise.reject(1); new Promise(async () => {}); }\n// eslint-disable-next-line max-statements\nconst f12 = (a) =>\n  { a; a; a; };\n",
    };
    const nine = [
      "max-statements 1:1-1:44 Function 'f1' has too many statements (3). Maximum allowed is 2.",
      "max-depth 1:27-1:40 Blocks are nested too deeply (2). Maximum allowed is 1.",
      "max-statements 2:1-2:65 Function 'f2' has too many statements (3). Maximum allowed is 2.",
      "max-statements 3:1-3:28 Function 'f3' has too many statements (3). Maximum allowed is 2.",
      "max-statements 4:12-4:31 Arrow function has too many statements (3). Maximum allowed is 2.",
      "max-lines-per-function 5:1-8:2 Function 'f5' has too many lines (4). Maximum allowed is 3.",
      "max-nested-callbacks 9:21-9:50 Too many nested callbacks (2). Maximum allowed is 1.",
      "max-nested-callbacks 9:38-9:46 Too many nested callbacks (3). Maximum allowed is 1.",
      "max-nested-callbacks 11:19-11:27 Too many nested callbacks (2). Maximum allowed is 1.",
      "require-yield 12:1-12:29 This generator function does not have 'yield'.",
      "no-useless-constructor 13:11-13:27 Useless constructor.",
      "require-yield 13:30-13:46 This generator function does not have 'yield'.",
      "new-cap 15:82-15:85 A function with a name starting with an uppercase letter should only be used as a constructor.",
      "radix 16:15-16:31 Redundant radix parameter.",
      "no-shadow-restricted-names 17:13-17:16 Shadowing of global property 'NaN'.",
      "use-isnan 17:27-17:37 Use the isNaN function to compare with NaN.",
      "no-extra-boolean-cast 18:29-18:40 Redundant Boolean call.",
      "prefer-promise-reject-errors 19:25-19:42 Expected the Promise rejection reason to be an Error.",
      "no-async-promise-executor 19:56-19:61 Promise executor functions should not be async.",
    ];
    const ten = [
      "max-statements 1:1-1:12 Function 'f1' has too many statements (3). Maximum allowed is 2.",
      "max-depth 1:27-1:29 Blocks are nested too deeply (2). Maximum allowed is 1.",
      "max-statements 2:1-2:12 Function 'f2' has too many statements (3). Maximum allowed is 2.",
      "max-depth 2:52-2:54 Blocks are nested too deeply (2). Maximum allowed is 1.",
      "max-statements 3:1-3:12 Function 'f3' has too many statements (3). Maximum allowed is 2.",
      "max-statements 4:16-4:18 Arrow function has too many statements (3). Maximum allowed is 2.",
      "max-lines-per-function 5:1-5:12 Function 'f5' has too many lines (4). Maximum allowed is 3.",
      "max-nested-callbacks 9:21-9:30 Too many nested callbacks (2). Maximum allowed is 1.",
      "max-nested-callbacks 9:41-9:43 Too many nested callbacks (3). Maximum allowed is 1.",
      "max-nested-callbacks 10:47-10:56 Too many nested callbacks (2). Maximum allowed is 1.",
      "require-yield 12:1-12:13 This generator function does not have 'yield'.",
      "no-useless-constructor 13:11-13:22 Useless constructor.",
      "require-yield 13:28-13:30 This generator function does not have 'yield'.",
      "no-shadow-restricted-names 14:13-14:23 Shadowing of global property 'globalThis'.",
      "new-cap 15:40-15:51 A constructor name should not start with a lowercase letter.",
      "radix 16:1-16:13 Missing radix parameter.",
      "no-shadow-restricted-names 17:13-17:16 Shadowing of global property 'NaN'.",
      "new-cap 18:29-18:36 A function with a name starting with an uppercase letter should only be used as a constructor.",
    ];
    test.each([
      ["9.39.5", nine],
      // With such a configuration file it is nearer to 9 than to 10.
      ["8.57.1", nine],
      ["10.12.0", ten],
      [undefined, ten],
    ])("%s", async (version, expected) => {
      const installed = { "node_modules/eslint/package.json": JSON.stringify({ name: "eslint", version }) };
      const { raw } = await lint({ ...files, ...(version && installed) }, ["-f", "json", "a.js"]);
      const said = (JSON.parse(raw)[0].messages as any[]).map(
        it => `${it.ruleId} ${it.line}:${it.column}-${it.endLine}:${it.endColumn} ${it.message}`,
      );
      expect(said).toEqual(expected);
    });

    // `eslint-scope` takes the name of a JSX element for a reference since ESLint 10. Before that a rule of a plugin marks what an
    // element uses, as `react/jsx-uses-vars` does: here `local/uses-vars`, which MARKS=off turns off.
    describe("the names of JSX elements", () => {
      const files = {
        "eslint.config.mjs":
          '// What eslint-plugin-react\'s jsx-uses-vars does, in short.\nconst usesVars = { create(context) { return {\n  Program(node) { context.sourceCode.markVariableAsUsed("marked", node); },\n  JSXOpeningElement(node) {\n    let name = node.name;\n    while (name.type === "JSXMemberExpression") name = name.object;\n    if (name.type === "JSXIdentifier") context.sourceCode.markVariableAsUsed(name.name, node);\n  },\n}; } };\nexport default [{ files: ["**/*.jsx"], plugins: { local: { rules: { "uses-vars": usesVars } } }, languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },\n  rules: { "local/uses-vars": process.env.MARKS === "off" ? "off" : "error", "no-unused-vars": "error", "no-undef": "error", "no-use-before-define": "error" } }];\n',
        "a.jsx":
          'import { Card, Button, Unused } from "./components.jsx";\nimport * as Icons from "./icons.jsx";\nconst marked = 1;\nconst notMarked = 2;\nexport const C = () => <Card><Button /><Icons.Close /></Card>;\nfunction render() { return <Widget />; }\nconst Widget = () => <span />;\nrender();\n',
      };
      test.each([
        [
          "9.39.5",
          "on",
          [
            "no-unused-vars 1:24-1:30 'Unused' is defined but never used.",
            "no-unused-vars 4:7-4:16 'notMarked' is assigned a value but never used.",
          ],
        ],
        [
          "9.39.5",
          "off",
          [
            "no-unused-vars 1:10-1:14 'Card' is defined but never used.",
            "no-unused-vars 1:16-1:22 'Button' is defined but never used.",
            "no-unused-vars 1:24-1:30 'Unused' is defined but never used.",
            "no-unused-vars 2:13-2:18 'Icons' is defined but never used.",
            "no-unused-vars 3:7-3:13 'marked' is assigned a value but never used.",
            "no-unused-vars 4:7-4:16 'notMarked' is assigned a value but never used.",
            "no-unused-vars 7:7-7:13 'Widget' is assigned a value but never used.",
          ],
        ],
        [
          "10.12.0",
          "on",
          [
            "no-unused-vars 1:24-1:30 'Unused' is defined but never used.",
            "no-unused-vars 4:7-4:16 'notMarked' is assigned a value but never used.",
            "no-use-before-define 6:29-6:35 'Widget' was used before it was defined.",
          ],
        ],
        [
          "10.12.0",
          "off",
          [
            "no-unused-vars 1:24-1:30 'Unused' is defined but never used.",
            "no-unused-vars 3:7-3:13 'marked' is assigned a value but never used.",
            "no-unused-vars 4:7-4:16 'notMarked' is assigned a value but never used.",
            "no-use-before-define 6:29-6:35 'Widget' was used before it was defined.",
          ],
        ],
      ])("%s, the rule that marks them is %s", async (version, MARKS, expected) => {
        const installed = { "node_modules/eslint/package.json": JSON.stringify({ name: "eslint", version }) };
        const { raw } = await lint({ ...files, ...installed }, ["-f", "json", "a.jsx"], { env: { MARKS } });
        const said = (JSON.parse(raw)[0].messages as any[]).map(
          it => `${it.ruleId} ${it.line}:${it.column}-${it.endLine}:${it.endColumn} ${it.message}`,
        );
        expect(said).toEqual(expected);
      });
    });
  });

  describe("--fix", () => {
    // The file is fixed, and linted again when all files are known, for the rule about several files. There the fix that breaks it
    // is tried once more and taken back.
    test.each(["stylish", "unix", "json", "pretty"])(
      "what the first fixes made of a file is written if later ones are taken back: -f %s",
      async format => {
        const breaks = `{
          meta: { fixable: "code", messages: { bad: "bad" } },
          create: context => ({
            'VariableDeclaration[kind="let"]'(node) {
              context.report({ node, messageId: "bad", fix: fixer => fixer.insertTextAfter(node, " ((") });
            },
          }),
        }`;
        const files = {
          "eslint.config.mjs": `export default [{
            plugins: { import: { meta: { name: "eslint-plugin-import" }, rules: {} }, mine: { rules: { breaks: ${breaks} } } },
            rules: { "import/no-cycle": "error", "no-var": "error", "mine/breaks": "error" },
          }];`,
          "a.js": `import { b } from "./b.js";\nvar a = b;\na = 2;\nexport { a };\n`,
          "b.js": `import { a } from "./a.js";\nexport const b = 1;\nexport const c = a;\n`,
        };
        const result = await lint(files, ["--fix", "-f", format, "."], { reads: ["a.js", "b.js"] });
        expect(result.files).toEqual({ "a.js": files["a.js"].replace("var", "let"), "b.js": files["b.js"] });
        expect(result.stderr).toContain(
          "Fixes of mine/breaks would leave a.js with a syntax error. They are not applied.",
        );
        expect(result.exitCode).toBe(1);
      },
    );

    // What ESLint 10.12 does.
    test("a file of which the fixes leave nothing is written empty", async () => {
      const removes = `{
        meta: { fixable: "code" },
        create: context => ({
          Program(node) {
            if (node.body.length) context.report({ node, message: "all", fix: fixer => fixer.removeRange([0, context.sourceCode.text.length]) });
          },
        }),
      }`;
      const files = {
        "eslint.config.mjs": `export default [
          { files: ["a.js"], plugins: { mine: { rules: { removes: ${removes} } } }, rules: { "mine/removes": "error" } },
          { files: ["b.js"], rules: { "no-debugger": "error" } },
        ];`,
        "a.js": "export const a = 1;\n",
        "b.js": "debugger;\n",
      };
      const result = await lint(files, ["--fix", "-f", "json", "a.js", "b.js"], { reads: ["a.js", "b.js"] });
      expect(result.files).toEqual({ "a.js": "", "b.js": files["b.js"] });
      const [a, b] = JSON.parse(result.raw);
      expect([a.messages, a.output]).toEqual([[], ""]);
      expect(b.messages.map((it: any) => it.ruleId)).toEqual(["no-debugger"]);
      expect(result.exitCode).toBe(1);
    });

    // ESLint prints no report then.
    test.skipIf(process.getuid?.() === 0 || isWindows)(
      "a file that cannot be written does not take the report with it",
      async () => {
        const files = { "eslint.config.js": basic, "a.js": "var a = 1;\nexport { a };\n", "b.js": "debugger;\n" };
        const before = (dir: string) => chmodSync(join(dir, "a.js"), 0o444);
        const result = await lint(files, ["--fix", "-f", "unix", "a.js", "b.js"], { reads: ["a.js"], before });
        expect(result.files["a.js"]).toBe(files["a.js"]);
        expect(result.stdout).toContain("[Error/no-debugger]");
        expect(result.stderr).toMatch(/Cannot write .*a\.js: (EACCES|EPERM)/);
        expect(result.exitCode).toBe(2);
      },
    );

    const files = { "eslint.config.js": basic, "a.js": bad, "b.js": "export const b = 1;\n" };

    test("writes the files and reports what is left", async () => {
      const result = await lint(files, ["--fix"], { reads: ["a.js", "b.js"] });
      expect(result.files).toEqual({
        "a.js": "let a = 1;\nif (a == 2) { debugger; }\n",
        "b.js": "export const b = 1;\n",
      });
      expect(result.stdout).toMatchInlineSnapshot(`
        "<dir>/a.js
          2:7   error  Expected '===' and instead saw '=='  eqeqeq
          2:15  error  Unexpected 'debugger' statement      no-debugger

        ✖ 2 problems (2 errors, 0 warnings)"
      `);
      expect(result.exitCode).toBe(1);
    });

    test("runs until nothing is left to fix", async () => {
      const result = await lint(
        {
          "eslint.config.js": config({
            "no-var": "error",
            "prefer-const": "error",
            semi: "error",
            "object-shorthand": "error",
          }),
          "a.js": "var a = 1\nvar b = { a: a }\nexport { b }\n",
        },
        ["--fix"],
        { reads: ["a.js"] },
      );
      expect(result.files).toEqual({ "a.js": "const a = 1;\nconst b = { a };\nexport { b };\n" });
      expect(result.raw).toBe("");
      expect(result.exitCode).toBe(0);
    });

    test("--fix-dry-run writes nothing, and the json format has the output", async () => {
      const result = await lint(files, ["--fix-dry-run", "-f", "json", "a.js"], { reads: ["a.js"] });
      expect(result.files).toEqual({ "a.js": bad });
      expect(JSON.parse(result.raw)[0].output).toBe("let a = 1;\nif (a == 2) { debugger; }\n");
    });

    test.each(["--fix", "--fix-dry-run"])(
      "%s beside an .oxlintrc.json: ESLint's json formats have the fixed text",
      async flag => {
        const files = {
          ".oxlintrc.json": `{ "rules": { "no-var": "error" } }`,
          "a.js": "var a = 1;\nexport default a;\n",
        };
        const { raw } = await lint(files, [flag, "-f", "json-with-metadata", "a.js"]);
        expect(JSON.parse(raw).results[0].output).toBe("const a = 1;\nexport default a;\n");
      },
    );

    describe("fixes after which the text cannot be parsed are not written", () => {
      const warning = (rules: string, file: string) =>
        `warn: Fixes of ${rules} would leave ${file} with a syntax error. They are not applied.`;

      // oxlint 1.87 writes `foo(,);`, `await x ^= y;` and "declare module String.raw`a\\b` {}".
      test.each([
        ["a.js", "foo(...[,]);\n", "no-useless-spread"],
        [
          "b.js",
          "async function f(x, y) { await Promise.race([x ^= y,],); }\nf();\n",
          "no-single-promise-in-promise-methods",
        ],
        ["c.ts", "declare module 'a\\\\b' {}\n", "prefer-string-raw"],
        ["d.js", "new Foo(...[a, , b,],)\n", "no-useless-spread"],
        [
          "e.js",
          "async function * foo() {await Promise.race([yield promise])}\n",
          "no-single-promise-in-promise-methods",
        ],
      ])("%s, with an .oxlintrc.json", async (name, text, rule) => {
        const rules = { [`unicorn/${rule}`]: "error" };
        const oxlintrc = JSON.stringify({ plugins: ["unicorn"], categories: { correctness: "off" }, rules });
        const all = { ".oxlintrc.json": oxlintrc, [name]: text };
        const result = await lint(all, ["--fix", "-f", "unix", name], { reads: [name] });
        expect(result.files).toEqual({ [name]: text });
        expect(result.stderr).toContain(warning(`unicorn/${rule}`, name));
        expect(result.stdout).toContain(`unicorn(${rule})`);
        expect(result.exitCode).toBe(1);
      });

      const plugin = `
        const rule = (from, to) => ({
          meta: { fixable: "code" },
          create: context => ({
            Identifier(node) {
              if (node.name === from) context.report({ node, message: from, fix: fixer => fixer.replaceText(node, to) });
            },
          }),
        });
        export default [{
          plugins: { p: { rules: { fine: rule("one", "two"), breaks: rule("two", "(") } } },
          rules: { "p/fine": "error", "p/breaks": "error", "no-var": "error" },
        }];`;

      test("of a plugin in JavaScript: none of the fixes of that pass", async () => {
        const all = { "eslint.config.mjs": plugin, "a.js": "var a = 1;\nexport { a };\ntwo;\n" };
        const result = await lint(all, ["--fix", "-f", "unix", "a.js"], { reads: ["a.js"] });
        expect(result.files).toEqual({ "a.js": all["a.js"] });
        expect(result.stderr).toContain(warning("no-var, p/breaks", "a.js"));
        expect(result.stdout).toContain("[Error/no-var]");
        expect(result.stdout).toContain("[Error/p/breaks]");
        expect(result.exitCode).toBe(1);
        const dry = await lint(all, ["--fix-dry-run", "-f", "json", "a.js"]);
        expect(JSON.parse(dry.raw)[0].output).toBeUndefined();
        expect(JSON.parse(dry.raw)[0].messages.map((it: { ruleId: string }) => it.ruleId)).toEqual([
          "no-var",
          "p/breaks",
        ]);
      });

      test("a comment that cannot be read is not a text that cannot be parsed", async () => {
        const all = {
          "eslint.config.mjs": `export default [{ linterOptions: { reportUnusedDisableDirectives: "error" } }];`,
          "a.js": "/* eslint no-var: [ */\nfoo(); // eslint-disable-line no-var\n",
        };
        const result = await lint(all, ["--fix", "a.js"], { reads: ["a.js"] });
        expect(result.files).toEqual({ "a.js": "/* eslint no-var: [ */\nfoo();  \n" });
        expect(result.stderr).not.toContain("syntax error");
      });

      test("the fixes of the passes before it stay", async () => {
        const all = { "eslint.config.mjs": plugin, "a.js": "var a = one;\nexport { a };\n" };
        const result = await lint(all, ["--fix", "-f", "unix", "a.js"], { reads: ["a.js"] });
        expect(result.files).toEqual({ "a.js": "let a = two;\nexport { a };\n" });
        expect(result.stderr).toContain(warning("p/breaks", "a.js"));
        expect(result.stdout).toContain("[Error/p/breaks]");
        expect(result.exitCode).toBe(1);
        const dry = await lint(all, ["--fix-dry-run", "-f", "json", "a.js"]);
        expect(JSON.parse(dry.raw)[0].output).toBe("let a = two;\nexport { a };\n");
      });
    });

    test("--fix-type", async () => {
      const result = await lint(files, ["--fix", "--fix-type", "layout", "a.js"], { reads: ["a.js"] });
      expect(result.files).toEqual({ "a.js": "var a = 1;\nif (a == 2) { debugger; }\n" });
    });

    test.skipIf(isWindows)("keeps a link to the file", async () => {
      const result = await lint(files, ["--fix", "link.js"], {
        reads: ["a.js", "link.js"],
        before: dir => symlinkSync("a.js", join(dir, "link.js")),
      });
      expect(result.files["a.js"]).toBe("let a = 1;\nif (a == 2) { debugger; }\n");
      expect(result.files["link.js"]).toBe(result.files["a.js"]);
    });

    // ESLint and oxlint write into the file (`fs.writeFile`, `fs::write`): all but its text stays as it is.
    describe("the file that is written", () => {
      const fixed = "let a = 1;\nif (a == 2) { debugger; }\n";
      const isRoot = process.getuid?.() === 0;
      /** `--fix` in `dir`, which is still there afterwards. `before`: what starts the command. */
      async function fix(dir: string, args: string[], before: string[] = []) {
        await using proc = spawn({
          cmd: [...before, ...command, "--fix", ...args],
          env,
          cwd: dir,
          stdin: "ignore",
          stdout: "ignore",
          stderr: "pipe",
        });
        const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
        return { stderr, exitCode };
      }
      const read = (dir: string, name: string) => readFileSync(join(dir, name), "utf8");

      test("is still the file that its other names stand for", async () => {
        using dir = tempDir("bun-lint", files);
        linkSync(join(String(dir), "a.js"), join(String(dir), "other-name.txt"));
        await fix(String(dir), ["a.js"]);
        expect([read(String(dir), "a.js"), read(String(dir), "other-name.txt")]).toEqual([fixed, fixed]);
        expect(statSync(join(String(dir), "a.js")).nlink).toBe(2);
        expect(readdirSync(String(dir)).sort()).toEqual(["a.js", "b.js", "eslint.config.js", "other-name.txt"]);
      });

      // What a new file gets is less, unless the mask of the process is 0.
      test.skipIf(isWindows)("keeps its mode, whatever the mask of the process", async () => {
        using dir = tempDir("bun-lint", { ...files, "b.js": files["a.js"] });
        chmodSync(join(String(dir), "a.js"), 0o664);
        chmodSync(join(String(dir), "b.js"), 0o777);
        await fix(String(dir), ["a.js", "b.js"], ["sh", "-c", 'umask 077; exec "$0" "$@"']);
        expect([read(String(dir), "a.js"), read(String(dir), "b.js")]).toEqual([fixed, fixed]);
        expect(["a.js", "b.js"].map(name => statSync(join(String(dir), name)).mode & 0o7777)).toEqual([0o664, 0o777]);
      });

      // ESLint and oxlint write there. Nobody reads the links of a project that he has checked out.
      test("is not one that a link leads to out of the repository", async () => {
        const outside = { "outside/c/d.js": bad };
        const git = "ref: refs/heads/main\n";
        const oxlintrc = JSON.stringify({ categories: { correctness: "off" }, rules: { "no-var": "error" } });
        const link = (dir: string) => symlinkSync(join(dir, "outside", "c"), join(dir, "project", "c"), "junction");
        const options = { cwd: "project", before: link, reads: ["outside/c/d.js"] };
        const [named, found, withoutRepository] = await Promise.all([
          lint(
            { ...outside, "project/.git/HEAD": git, "project/eslint.config.js": basic },
            ["--fix", "c/d.js"],
            options,
          ),
          lint({ ...outside, "project/.git/HEAD": git, "project/.oxlintrc.json": oxlintrc }, ["--fix"], options),
          lint({ ...outside, "project/eslint.config.js": basic }, ["--fix", "c/d.js"], options),
        ]);
        expect([named.files, found.files, withoutRepository.files]).toEqual([outside, outside, outside]);
        for (const { stdout, stderr } of [named, found, withoutRepository]) {
          expect(stdout + stderr).toContain("Cannot write <dir>/project/c/d.js: A link leads out of the repository.");
        }
        // Beside an .oxlintrc.json what fails ends the run as it ends oxlint's.
        expect([named.exitCode, found.exitCode, withoutRepository.exitCode]).toEqual([2, 1, 2]);
      });

      test("can be one that a link leads to in the repository, or that is named outside of the working directory", async () => {
        const files = {
          ".git/HEAD": "ref: refs/heads/main\n",
          "shared/d.js": bad,
          "packages/a/eslint.config.js": basic,
          "eslint.config.js": basic,
        };
        const link = (dir: string) =>
          symlinkSync(join(dir, "shared"), join(dir, "packages", "a", "shared"), "junction");
        const options = { cwd: "packages/a", before: link, reads: ["shared/d.js"] };
        // Jujutsu has one without a `.git`.
        const { ".git/HEAD": _, ...rest } = files;
        const [linked, named, ofJujutsu] = await Promise.all([
          lint(files, ["--fix", "shared/d.js"], options),
          lint(files, ["--fix", "../../shared/d.js"], options),
          lint({ ...rest, ".jj/working_copy/type": "local" }, ["--fix", "shared/d.js"], options),
        ]);
        const written = { "shared/d.js": fixed };
        expect([linked.files, named.files, ofJujutsu.files]).toEqual([written, written, written]);
      });

      // In a container, say, with the project of a user mounted into it.
      test.skipIf(!isRoot)("keeps its owner if root fixes it", async () => {
        using dir = tempDir("bun-lint", files);
        try {
          chownSync(join(String(dir), "a.js"), 12345, 12345);
        } catch {
          // The root of a container that does not have these.
          return;
        }
        await fix(String(dir), ["a.js"]);
        const { uid, gid } = statSync(join(String(dir), "a.js"));
        expect([read(String(dir), "a.js"), uid, gid]).toEqual([fixed, 12345, 12345]);
      });

      // ESLint needs nothing of the directory.
      test.skipIf(isWindows || isRoot)("can be in a directory that nothing can be added to", async () => {
        using dir = tempDir("bun-lint", { "eslint.config.js": files["eslint.config.js"], "src/a.js": files["a.js"] });
        chmodSync(join(String(dir), "src"), 0o555);
        try {
          const { stderr } = await fix(String(dir), ["src"]);
          expect(stderr).not.toContain("Cannot write");
          expect(read(String(dir), "src/a.js")).toBe(fixed);
        } finally {
          chmodSync(join(String(dir), "src"), 0o755);
        }
      });

      // `fs.writeFile` fails with EACCES, on Windows with EPERM. A version control system that hands out files read-only until
      // they are checked out means it.
      test.skipIf(isRoot)("is not replaced if it is read-only, and that is an error", async () => {
        using dir = tempDir("bun-lint", files);
        chmodSync(join(String(dir), "a.js"), 0o444);
        try {
          const { stderr, exitCode } = await fix(String(dir), ["a.js"]);
          expect(read(String(dir), "a.js")).toBe(files["a.js"]);
          expect(stderr).toMatch(/Cannot write .*a\.js: (EACCES|EPERM)/);
          expect(readdirSync(String(dir)).sort()).toEqual(["a.js", "b.js", "eslint.config.js"]);
          expect(exitCode).toBe(2);
        } finally {
          chmodSync(join(String(dir), "a.js"), 0o666);
        }
      });
    });

    // Windows takes no more than that, unless it is asked in a special way.
    test("a file whose path has more than 260 characters", async () => {
      const name = `${Array(14).fill("d".repeat(20)).join("/")}/c.js`;
      const fixed = "let a = 1;\nif (a == 2) { debugger; }\n";
      const [named, found] = await Promise.all([
        lint({ ...files, [name]: bad }, ["--fix", name], { reads: [name] }),
        lint({ ...files, [name]: bad }, ["--fix", "."], { reads: [name] }),
      ]);
      expect([named.stderr, found.stderr].join("\n")).not.toContain("error: ");
      expect([named.files, found.files]).toEqual([{ [name]: fixed }, { [name]: fixed }]);
    });

    test("flags that contradict each other fail with 2", async () => {
      const results = await Promise.all([
        lint(files, ["--fix", "--fix-dry-run"]),
        lint(files, ["--fix-type", "layout"]),
        lint(files, ["--stdin", "--fix"], { stdin: bad }),
      ]);
      expect(results.map(it => [it.stderr.split("\n")[0], it.exitCode])).toEqual([
        ["error: The --fix option and the --fix-dry-run option cannot be used together.", 2],
        ["error: The --fix-type option requires either --fix or --fix-dry-run.", 2],
        ["error: The --fix option is not available for piped-in code; use --fix-dry-run instead.", 2],
      ]);
    });
  });

  // What ESLint 10.12 does with these `rules`, given two lines more: a plugin `no-restricted-syntax` that hands out ESLint's own rule
  // under the names.
  // What ESLint 10.12 says: it gives `languageOptions.ecmaVersion` to espree. Each row: the edition that has brought it, the code, and
  // what the edition before makes of it.
  test("syntax that is newer than ecmaVersion is a parsing error", async () => {
    const rows: [number, string, string, string?][] = [
      [2015, "const a = 1;", "1:1 The keyword 'const' is reserved"],
      [2015, "let a;", "1:5 Unexpected token a"],
      [2015, "(a) => a;", "1:6 Unexpected token >"],
      [2015, "class A {}", "1:1 The keyword 'class' is reserved"],
      [2015, "`a`;", "1:1 Unexpected character '`'"],
      [2015, "var { a } = b;", "1:5 Unexpected token {"],
      [2015, "var [a] = b;", "1:5 Unexpected token ["],
      [2015, "for (a of b);", "1:8 Unexpected token of"],
      [2015, "function* g() {}", "1:9 Unexpected token *"],
      [2015, "var a = { b };", "1:13 Unexpected token }"],
      [2015, "var a = { b() {} };", "1:12 Unexpected token ("],
      [2015, "var a = { [b]: 1 };", "1:11 Unexpected token ["],
      [2015, "[...a];", "1:2 Unexpected token ."],
      [2015, "f(...a);", "1:3 Unexpected token ."],
      [2015, "function f(a = 1) {}", "1:14 Unexpected token ="],
      [2015, "function f(...a) {}", "1:12 Unexpected token ."],
      [2015, "0b1;", "1:2 Identifier directly after number"],
      [2015, "0o7;", "1:2 Identifier directly after number"],
      [2015, "/a/u;", "1:2 Invalid regular expression flag"],
      [2015, "/a/y;", "1:2 Invalid regular expression flag"],
      [2015, "'\\u{61}';", "1:1 Unexpected token"],
      [2016, "a ** b;", "1:4 Unexpected token *"],
      [2016, "a **= b;", "1:4 Unexpected token *="],
      [2017, "async function f() {}", "1:7 Unexpected token function"],
      [2017, "async () => 1;", "1:10 Unexpected token =>"],
      [2017, "f(a,);", "1:5 Unexpected token )"],
      [2017, "function f(a,) {}", "1:14 Unexpected token )"],
      [2017, "var a = { async b() {} };", "1:17 Unexpected token b"],
      [2018, "var a = { ...b };", "1:11 Unexpected token ..."],
      [2018, "var { ...a } = b;", "1:7 Unexpected token ..."],
      [2018, "async function f() { for await (a of b); }", "1:26 Unexpected token await"],
      [2018, "async function* f() {}", "1:15 Unexpected token *"],
      [2018, "/(?<a>b)/;", "1:2 Invalid regular expression: /(?<a>b)/: Invalid group"],
      [2018, "/(?<=a)b/;", "1:2 Invalid regular expression: /(?<=a)b/: Invalid group"],
      [2018, "/a/s;", "1:2 Invalid regular expression flag"],
      [2018, "/\\p{L}/u;", "1:2 Invalid regular expression: /\\p{L}/: Invalid escape"],
      [2019, "try {} catch {}", "1:14 Unexpected token {"],
      [2019, "'\u2028';", "1:1 Unterminated string constant"],
      [2020, "a?.b;", "1:3 Unexpected token ."],
      [2020, "a?.[b];", "1:3 Unexpected token ."],
      [2020, "a?.();", "1:3 Unexpected token ."],
      [2020, "a ?? b;", "1:4 Unexpected token ?"],
      [2020, "1n;", "1:2 Identifier directly after number"],
      [2020, "import('a');", "1:1 'import' and 'export' may appear only with 'sourceType: module'"],
      [2020, "export * as a from 'a';", "1:10 Unexpected token as", "module"],
      [2020, "import.meta;", "1:7 Unexpected token .", "module"],
      [2021, "a ||= b;", "1:5 Unexpected token ="],
      [2021, "a &&= b;", "1:5 Unexpected token ="],
      [2021, "a ??= b;", "1:5 Unexpected token ="],
      [2021, "1_000;", "1:2 Identifier directly after number"],
      [2022, "class A { b = 1; }", "1:13 Unexpected token ="],
      [2022, "class A { b; }", "1:12 Unexpected token ;"],
      [2022, "class A { #b; }", "1:11 Unexpected character '#'"],
      [2022, "class A { #b() {} }", "1:11 Unexpected character '#'"],
      [2022, "class A { static b = 1; }", "1:20 Unexpected token ="],
      [2022, "class A { static {} }", "1:18 Unexpected token {"],
      [2022, "class A { #b; c() { #b in this; } }", "1:11 Unexpected character '#'"],
      [2022, "await 1;", "1:1 Cannot use keyword 'await' outside an async function", "module"],
      [2022, "/a/d;", "1:2 Invalid regular expression flag"],
      [2022, "export { a as 'b' }; var a;", "1:15 Unexpected token 'b'", "module"],
      [2022, "import { 'a' as b } from 'a';", "1:10 Unexpected token 'a'", "module"],
      [2024, "/[a--b]/v;", "1:2 Invalid regular expression flag"],
      [2025, "import a from 'a' with { type: 'json' };", "1:19 Unexpected token with", "module"],
      [2025, "/(?i:a)/;", "1:2 Invalid regular expression: /(?i:a)/: Invalid group"],
      [2025, "/(?<a>b)|(?<a>c)/;", "1:2 Invalid regular expression: /(?<a>b)|(?<a>c)/: Duplicate capture group name"],
      [2025, "import('a', { with: {} });", "1:11 Unexpected token ,"],
      [2026, "{ using a = b; }", "1:9 Unexpected token a"],
      [2026, "async function f() { await using a = b; }", "1:34 Unexpected token a"],
    ];
    const editions = [5, ...Array.from({ length: 12 }, (_, i) => 2015 + i)];
    const objects = editions.flatMap(ecmaVersion =>
      ["script", "module"]
        .filter(sourceType => ecmaVersion > 5 || sourceType === "script")
        .map(sourceType => ({
          files: [`${ecmaVersion}-${sourceType}/*.js`],
          languageOptions: { ecmaVersion, sourceType },
        })),
    );
    const files: Record<string, string> = { "eslint.config.mjs": `export default ${JSON.stringify(objects)};` };
    const expected: Record<string, string[]> = {};
    rows.forEach(([first, code, message, sourceType = "script"], i) => {
      const before = first === 2015 ? 5 : first - 1;
      files[`${before}-${sourceType}/${i}.js`] = files[`${first}-${sourceType}/${i}.js`] = code;
      expected[`${before}-${sourceType}/${i}.js`] = [message.replace(" ", " Parsing error: ")];
      expected[`${first}-${sourceType}/${i}.js`] = [];
    });
    const { raw, exitCode } = await lint(files, ["-f", "json", "."]);
    const results = JSON.parse(raw) as { filePath: string; messages: any[] }[];
    const said = results
      .filter(it => it.filePath.endsWith(".js"))
      .map(it => [
        it.filePath.replaceAll("\\", "/").split("/").slice(-2).join("/"),
        it.messages.map(it => `${it.line}:${it.column} ${it.message}`),
      ]);
    expect(Object.fromEntries(said)).toEqual(expected);
    expect(exitCode).toBe(1);
  });

  describe("no-restricted-syntax/<name> is one more instance of the rule", () => {
    const moment = { selector: 'ImportDeclaration[source.value="moment"]', message: "Use date-fns." };
    const environment = {
      selector: 'MemberExpression[object.name="process"][property.name="env"]',
      message: "Read the environment in config.js.",
    };
    const rules = {
      "no-restricted-syntax": ["error", "WithStatement"],
      "no-restricted-syntax/no-moment": ["error", moment],
      "no-restricted-syntax/no-env": ["warn", environment],
    };
    const flat = (more = "", all: object = rules) =>
      `export default [{ linterOptions: { reportUnusedDisableDirectives: "warn" }, rules: ${JSON.stringify(all)} }${more}];\n`;
    const code = 'import moment from "moment";\nconst e = process.env.X;\nexport { moment, e };\n';
    const json = async (files: Record<string, string>, ...flags: string[]) =>
      JSON.parse((await lint(files, ["-f", "json", ...flags, "a.js"])).raw)[0].messages;

    test.each([
      [
        "plain",
        'import moment from "moment";\nconst e = process.env.X;\nexport { moment, e };\n',
        [
          {
            "ruleId": "no-restricted-syntax/no-moment",
            "severity": 2,
            "message": "Use date-fns.",
            "line": 1,
            "column": 1,
            "endLine": 1,
            "endColumn": 29,
            "messageId": "restrictedSyntax",
          },
          {
            "ruleId": "no-restricted-syntax/no-env",
            "severity": 1,
            "message": "Read the environment in config.js.",
            "line": 2,
            "column": 11,
            "endLine": 2,
            "endColumn": 22,
            "messageId": "restrictedSyntax",
          },
        ],
        1,
      ],
      [
        "directives",
        'import moment from "moment"; // eslint-disable-line no-restricted-syntax/no-moment\nconst e = process.env.X; // eslint-disable-line no-restricted-syntax\nconst f = process.env.Y; // eslint-disable-line no-restricted-syntax/no-env\n// eslint-disable-next-line no-restricted-syntax/no-such\nexport { moment, e, f };\n',
        [
          {
            "ruleId": "no-restricted-syntax/no-env",
            "severity": 1,
            "message": "Read the environment in config.js.",
            "line": 2,
            "column": 11,
            "endLine": 2,
            "endColumn": 22,
            "messageId": "restrictedSyntax",
          },
          {
            "ruleId": null,
            "severity": 1,
            "message": "Unused eslint-disable directive (no problems were reported from 'no-restricted-syntax').",
            "line": 2,
            "column": 26,
          },
          {
            "ruleId": "no-restricted-syntax/no-such",
            "severity": 2,
            "message": "Definition for rule 'no-restricted-syntax/no-such' was not found.",
            "line": 4,
            "column": 1,
            "endLine": 4,
            "endColumn": 57,
          },
        ],
        1,
      ],
      [
        "comments",
        '/* eslint no-restricted-syntax/no-env: "off", no-restricted-syntax/no-moment: "warn" */\nimport moment from "moment";\nconst e = process.env.X;\nexport { moment, e };\n',
        [
          {
            "ruleId": "no-restricted-syntax/no-moment",
            "severity": 1,
            "message": "Use date-fns.",
            "line": 2,
            "column": 1,
            "endLine": 2,
            "endColumn": 29,
            "messageId": "restrictedSyntax",
          },
        ],
        0,
      ],
      [
        "options",
        '/* eslint no-restricted-syntax/no-env: ["error", "ExportNamedDeclaration"] */\nconst e = process.env.X;\nexport { e };\n',
        [
          {
            "ruleId": "no-restricted-syntax/no-env",
            "severity": 2,
            "message": "Using 'ExportNamedDeclaration' is not allowed.",
            "line": 3,
            "column": 1,
            "endLine": 3,
            "endColumn": 14,
            "messageId": "restrictedSyntax",
          },
        ],
        1,
      ],
    ] as [string, string, object[], number][])("%s", async (_, code, messages, exitCode) => {
      const result = await lint({ "eslint.config.js": flat(), "a.js": code }, ["-f", "json", "a.js"]);
      expect(JSON.parse(result.raw)[0].messages).toMatchObject(messages);
      expect(JSON.parse(result.raw)[0].messages).toHaveLength(messages.length);
      expect(result.exitCode).toBe(exitCode);
    });

    test("an object for some files, --rule, --print-config, rulesMeta, suppressions", async () => {
      const off = `, { files: ["a.js"], rules: { "no-restricted-syntax/no-env": "off" } }`;
      expect((await json({ "eslint.config.js": flat(off), "a.js": code })).map((it: any) => it.ruleId)).toEqual([
        "no-restricted-syntax/no-moment",
      ]);
      const files = { "eslint.config.js": flat(), "a.js": code };
      const changed = await json(files, "--rule", 'no-restricted-syntax/no-env: ["error", "ImportDeclaration"]');
      // Both are at 1:1.
      expect(changed.map((it: any) => `${it.line} ${it.severity} ${it.ruleId} ${it.message}`).sort()).toEqual([
        "1 2 no-restricted-syntax/no-env Using 'ImportDeclaration' is not allowed.",
        "1 2 no-restricted-syntax/no-moment Use date-fns.",
      ]);
      const printed = JSON.parse((await lint(files, ["--print-config", "a.js"])).raw).rules;
      expect(
        Object.fromEntries(Object.entries(printed).filter(it => it[0].startsWith("no-restricted-syntax"))),
      ).toEqual({
        "no-restricted-syntax": [2, "WithStatement"],
        "no-restricted-syntax/no-moment": [
          2,
          { "selector": 'ImportDeclaration[source.value="moment"]', "message": "Use date-fns." },
        ],
        "no-restricted-syntax/no-env": [
          1,
          {
            "selector": 'MemberExpression[object.name="process"][property.name="env"]',
            "message": "Read the environment in config.js.",
          },
        ],
      });
      const { metadata } = JSON.parse((await lint(files, ["-f", "json-with-metadata", "a.js"])).raw);
      expect(Object.keys(metadata.rulesMeta)).toEqual([
        "no-restricted-syntax/no-moment",
        "no-restricted-syntax/no-env",
      ]);
      expect(metadata.rulesMeta["no-restricted-syntax/no-moment"].type).toBe("suggestion");
      const suppressed = await lint(files, ["--suppress-all", "a.js"], { reads: ["eslint-suppressions.json"] });
      expect(JSON.parse(suppressed.files["eslint-suppressions.json"])).toEqual({
        "a.js": { "no-restricted-syntax/no-moment": { "count": 1 } },
      });
    });

    test("options that the schema refuses are refused under the name", async () => {
      const all = { "no-restricted-syntax/no-env": ["error", { nonsense: 1 }] };
      const { stderr, exitCode } = await lint({ "eslint.config.js": flat("", all), "a.js": code }, ["a.js"]);
      expect(stderr).toContain(
        'Key "rules": Key "no-restricted-syntax/no-env":\n\tValue {"nonsense":1} should be string.\n\tValue {"nonsense":1} should NOT have additional properties.\n\t\tUnexpected property "nonsense". Expected properties: "selector", "message".\n\tValue {"nonsense":1} should match exactly one schema in oneOf.',
      );
      expect(exitCode).toBe(2);
    });

    // No suite sees this: they turn a rule on by its entry and validate nothing.
    test.each([
      ["import/no-absolute-path", { amd: true }],
      ["import/max-dependencies", { max: 10 }],
      ["import/newline-after-import", { count: 1 }],
      ["import/no-anonymous-default-export", { allowArray: true }],
      ["import/no-dynamic-require", { esmodule: true }],
      ["import/no-nodejs-modules", { allow: ["fs"] }],
      ["import/no-unassigned-import", { allow: ["**/*.css"] }],
    ] as const)("the options of %s are taken beside an .oxlintrc.json", async (rule, options) => {
      const config = { plugins: ["import"], categories: { correctness: "off" }, rules: { [rule]: ["error", options] } };
      const files = { ".oxlintrc.json": JSON.stringify(config), "a.js": "export const a = 1;\n" };
      const { stderr, exitCode } = await lint(files, ["a.js"]);
      expect(stderr).not.toContain("should NOT have");
      expect(exitCode).toBe(0);
    });

    test("a plugin of the configuration that has the prefix answers for it", async () => {
      const plugin = `{ rules: { "no-env": { create: context => ({ Program(node) { context.report({ node, message: "theirs" }); } }) } } }`;
      const theirs = `export default [{ plugins: { "no-restricted-syntax": ${plugin} }, rules: { "no-restricted-syntax/no-env": "error" } }];`;
      const messages = await json({ "eslint.config.js": theirs, "a.js": code });
      expect(messages.map((it: any) => `${it.ruleId} ${it.message}`)).toEqual(["no-restricted-syntax/no-env theirs"]);
    });

    test("with an .oxlintrc.json: the code, the comments, the suppressions", async () => {
      const files = {
        ".oxlintrc.json": JSON.stringify({ categories: { correctness: "off" }, rules }),
        "a.js":
          'import moment from "moment";\nconst e = process.env.X; // oxlint-disable-line no-restricted-syntax/no-env\n' +
          "const f = process.env.Y;\nexport { moment, e, f };\n",
      };
      const { stdout, exitCode } = await lint(files, ["-f", "unix", "a.js"]);
      expect(stdout.split("\n").filter(it => it.startsWith("a.js:"))).toEqual([
        "a.js:1:1: Use date-fns. [Error/no-restricted-syntax(no-moment)]",
        "a.js:3:11: Read the environment in config.js. [Warning/no-restricted-syntax(no-env)]",
      ]);
      expect(exitCode).toBe(1);
      const suppressed = await lint(files, ["--suppress-all", "a.js"], { reads: ["oxlint-suppressions.json"] });
      expect(JSON.parse(suppressed.files["oxlint-suppressions.json"])).toEqual({
        "a.js": { "no-restricted-syntax/no-moment": { count: 1 } },
      });
    });
  });

  describe("bulk suppressions", () => {
    const files = {
      "eslint.config.js": config({ "no-debugger": "error" }),
      "a.js": "debugger;\ndebugger;\n",
      "b.js": "debugger;\n",
    };
    const suppressions = (a: number, b: number) =>
      JSON.stringify({ "a.js": { "no-debugger": { count: a } }, "b.js": { "no-debugger": { count: b } } });

    test("--suppress-all records the errors that there are, and tolerates them", async () => {
      const result = await lint(files, ["--suppress-all"], { reads: ["eslint-suppressions.json"] });
      expect(JSON.parse(result.files["eslint-suppressions.json"]!)).toEqual(JSON.parse(suppressions(2, 1)));
      expect(result.raw).toBe("");
      expect(result.exitCode).toBe(0);
    });

    test("eslint-suppressions.json is applied, and more errors than it has are all reported", async () => {
      const result = await lint({ ...files, "eslint-suppressions.json": suppressions(1, 1) }, ["-f", "unix"]);
      expect(result.stdout).toMatchInlineSnapshot(`
        "<dir>/a.js:1:1: Unexpected 'debugger' statement. [Error/no-debugger]
        <dir>/a.js:2:1: Unexpected 'debugger' statement. [Error/no-debugger]

        2 problems"
      `);
      expect(result.exitCode).toBe(1);
    });

    test("fewer errors than it has fail with 2, until --prune-suppressions", async () => {
      const stale = { ...files, "eslint-suppressions.json": suppressions(2, 3) };
      const [plain, passed, pruned] = await Promise.all([
        lint(stale, []),
        lint(stale, ["--pass-on-unpruned-suppressions"]),
        lint(stale, ["--prune-suppressions"], { reads: ["eslint-suppressions.json"] }),
      ]);
      expect(plain.stderr).toContain("There are suppressions left that do not occur anymore.");
      expect({ plain: plain.exitCode, passed: passed.exitCode, pruned: pruned.exitCode }).toEqual({
        plain: 2,
        passed: 0,
        pruned: 0,
      });
      expect(JSON.parse(pruned.files["eslint-suppressions.json"]!)).toEqual(JSON.parse(suppressions(2, 1)));
    });
  });

  describe("--stdin", () => {
    const files = { "eslint.config.js": basic, "src/eslint.config.js": config({ "no-var": "error" }) };

    test("lints standard input as <text>", async () => {
      const { stdout, stderr, exitCode } = await lint(files, ["--stdin"], { stdin: bad });
      expect(stdout).toMatchInlineSnapshot(`
        "<text>
          1:1   warning  Unexpected var, use let or const instead  no-var
          1:10  error    Missing semicolon                         semi
          2:7   error    Expected '===' and instead saw '=='       eqeqeq
          2:15  error    Unexpected 'debugger' statement           no-debugger

        ✖ 4 problems (3 errors, 1 warning)
          1 error and 1 warning potentially fixable with the \`--fix\` option."
      `);
      expect(stderr).toBe("");
      expect(exitCode).toBe(1);
    });

    test("--stdin-filename decides the configuration", async () => {
      const { stdout } = await lint(files, ["--stdin", "--stdin-filename", "src/new.js", "-f", "unix"], { stdin: bad });
      expect(stdout).toMatchInlineSnapshot(`
        "<dir>/src/new.js:1:1: Unexpected var, use let or const instead. [Error/no-var]

        1 problem"
      `);
    });
  });

  describe("formats", () => {
    const files = { "eslint.config.js": basic, "src/a.js": bad };

    // Rows times the widest: 800 MB. ESLint 10.12 ends with "RangeError: Invalid string length".
    test("stylish does not make every row as wide as the widest where that is more than ESLint can print", async () => {
      const names = [Buffer.alloc(200_000, "a").toString(), ...Array.from({ length: 4_000 }, (_, i) => "b" + i)];
      const { raw, exitCode } = await lint(
        {
          "eslint.config.js": `module.exports = [{ rules: { "no-unused-vars": "error" } }];`,
          "a.js": names.map(name => `var ${name};\n`).join(""),
        },
        ["-f", "stylish", "a.js"],
      );
      expect(raw.length).toBeLessThan(1_000_000);
      expect(raw).toContain("'b3999' is defined but never used  no-unused-vars");
      expect(raw).toContain("4001 problems");
      expect(exitCode).toBe(1);
    });

    test("json", async () => {
      const { raw, exitCode } = await lint(files, ["-f", "json", "--rule", "semi: off", "--rule", "eqeqeq: off"]);
      const results = JSON.parse(raw);
      expect(
        results.map((it: any) => ({
          ...it,
          filePath: it.filePath.replaceAll("\\", "/").replace(/^.*\/(?=src|eslint)/, ""),
        })),
      ).toEqual([
        {
          filePath: "eslint.config.js",
          messages: [],
          suppressedMessages: [],
          errorCount: 0,
          fatalErrorCount: 0,
          warningCount: 0,
          fixableErrorCount: 0,
          fixableWarningCount: 0,
          usedDeprecatedRules: [],
        },
        {
          filePath: "src/a.js",
          messages: [
            expect.objectContaining({
              ruleId: "no-var",
              severity: 1,
              line: 1,
              column: 1,
              endLine: 1,
              endColumn: 10,
              messageId: "unexpectedVar",
            }),
            {
              ruleId: "no-debugger",
              severity: 2,
              message: "Unexpected 'debugger' statement.",
              line: 2,
              column: 15,
              messageId: "unexpected",
              endLine: 2,
              endColumn: 24,
            },
          ],
          suppressedMessages: [],
          errorCount: 1,
          fatalErrorCount: 0,
          warningCount: 1,
          fixableErrorCount: 0,
          fixableWarningCount: 1,
          source: bad,
          usedDeprecatedRules: [],
        },
      ]);
      expect(exitCode).toBe(1);
    });

    test("pretty", async () => {
      const { stdout } = await lint(files, ["-f", "pretty"]);
      expect(stdout).toMatchInlineSnapshot(`
        "1 | var a = 1
            ^
        warn: Unexpected var, use let or const instead.  no-var
           at src/a.js:1:1

        1 | var a = 1
                     ^
        error: Missing semicolon.  semi
            at src/a.js:1:10

        1 | var a = 1
        2 | if (a == 2) { debugger; }
                  ^
        error: Expected '===' and instead saw '=='.  eqeqeq
            at src/a.js:2:7

        1 | var a = 1
        2 | if (a == 2) { debugger; }
                          ^
        error: Unexpected 'debugger' statement.  no-debugger
            at src/a.js:2:15"
      `);
    });

    test("agent, which is the default for an agent", async () => {
      const [named, detected] = await Promise.all([
        lint(files, ["-f", "agent"]),
        lint(files, [], { env: { AGENT: "1" } }),
      ]);
      expect(named.stdout).toMatchInlineSnapshot(`
        "<warning file="src/a.js" line="1" column="1" rule="no-var" fixable="true">
        Unexpected var, use let or const instead.
        <source>
        1 | var a = 1
            ^^^^^^^^^
        2 | if (a == 2) { debugger; }
        </source>
        </warning>
        <error file="src/a.js" line="1" column="10" rule="semi" fixable="true">
        Missing semicolon.
        <source>
        1 | var a = 1
                     ^
        2 | if (a == 2) { debugger; }
        </source>
        </error>
        <error file="src/a.js" line="2" column="7" rule="eqeqeq">
        Expected '===' and instead saw '=='.
        <source>
        1 | var a = 1
        2 | if (a == 2) { debugger; }
                  ^^
        </source>
        <suggestion>Use '===' instead of '=='.</suggestion>
        </error>
        <error file="src/a.js" line="2" column="15" rule="no-debugger">
        Unexpected 'debugger' statement.
        <source>
        1 | var a = 1
        2 | if (a == 2) { debugger; }
                          ^^^^^^^^^
        </source>
        </error>"
      `);
      expect(detected.stdout).toBe(named.stdout);
    });

    test("github, which GitHub Actions gets besides the report", async () => {
      const [named, detected] = await Promise.all([
        lint(files, ["-f", "github", "--quiet"]),
        lint(files, ["--quiet"], { env: { GITHUB_ACTIONS: "true" } }),
      ]);
      expect(named.stdout).toMatchInlineSnapshot(`
        "::error file=src/a.js,line=1,col=10,endLine=2,endColumn=1,title=semi::Missing semicolon.
        ::error file=src/a.js,line=2,col=7,endLine=2,endColumn=9,title=eqeqeq::Expected '===' and instead saw '=='.
        ::error file=src/a.js,line=2,col=15,endLine=2,endColumn=24,title=no-debugger::Unexpected 'debugger' statement."
      `);
      expect(detected.stdout).toContain("✖ 3 problems (3 errors, 0 warnings)");
      expect(detected.stdout).toEndWith(named.stdout);
    });

    test.each(["stylish", "unix", "json"])(
      "what GitHub Actions gets is not in the file of --output-file, nor among the lines of unix: %s",
      async format => {
        const inActions = { env: { GITHUB_ACTIONS: "true" }, reads: ["report.txt"] };
        const [named, plain, toFile, toStdout] = await Promise.all([
          lint(files, ["-f", "github", "--quiet"]),
          lint(files, ["-f", format, "--quiet", "-o", "report.txt"], { reads: ["report.txt"] }),
          lint(files, ["-f", format, "--quiet", "-o", "report.txt"], inActions),
          lint(files, ["-f", format, "--quiet"], { env: { GITHUB_ACTIONS: "true" } }),
        ]);
        expect(toFile.files["report.txt"].replaceAll(/bun-lint_\w+/g, "")).toBe(
          plain.files["report.txt"].replaceAll(/bun-lint_\w+/g, ""),
        );
        expect(toFile.files["report.txt"]).not.toContain("::error");
        expect(toFile.stdout).toBe(named.stdout);
        expect(toStdout.stdout.includes("::error")).toBe(format === "stylish");
      },
    );

    test("identical problems are grouped above 50, unless --all", async () => {
      const many = { "eslint.config.js": basic, "a.js": Buffer.alloc(10 * 60, "debugger;\n").toString() };
      const [grouped, all] = await Promise.all([lint(many, ["-f", "pretty"]), lint(many, ["-f", "pretty", "--all"])]);
      expect(grouped.stdout).toMatchInlineSnapshot(`
        "1 | debugger;
            ^
        error: Unexpected 'debugger' statement.  no-debugger
            at a.js:1:1
            60 times in 1 file
                60  a.js:1

        bun lint --all  show every problem"
      `);
      expect(all.stdout.match(/Unexpected 'debugger' statement/g)).toHaveLength(60);
    });

    test("--output-file", async () => {
      const result = await lint(files, ["-f", "unix", "-o", "reports/lint.txt", "--quiet"], {
        reads: ["reports/lint.txt"],
      });
      expect(result.raw).toBe("");
      expect(result.files["reports/lint.txt"]).toContain("[Error/no-debugger]");
      expect(result.exitCode).toBe(1);
    });

    test("an unknown format fails with 2", async () => {
      const { stderr, exitCode } = await lint(files, ["-f", "nothing"]);
      expect(stderr).toContain('There is no formatter "nothing"');
      expect(exitCode).toBe(2);
    });

    test("a syntax error is a fatal problem of the file", async () => {
      const broken = { "eslint.config.js": basic, "a.js": "const = 1;\n", "b.js": "debugger;\n" };
      const [plain, strict] = await Promise.all([
        lint(broken, ["-f", "json"]),
        lint(broken, ["--exit-on-fatal-error"]),
      ]);
      const [a, b] = JSON.parse(plain.raw);
      expect(a).toMatchObject({
        fatalErrorCount: 1,
        errorCount: 1,
        messages: [{ ruleId: null, fatal: true, severity: 2, line: 1, column: 7 }],
      });
      expect(b).toMatchObject({ errorCount: 1, messages: [{ ruleId: "no-debugger" }] });
      expect({ plain: plain.exitCode, strict: strict.exitCode }).toEqual({ plain: 1, strict: 2 });
    });
  });

  // What oxlint 1.87 does with tsgolint 7.0.2003. tsgolint reads the file on its own; oxlint has not seen the comments.
  // Each is what oxlint 1.87 says. Where it says nothing it lints the file.
  test("`using` at the top level of a script is refused as oxc refuses it", async () => {
    const refused = "'using' declarations are not allowed at the top level of a script";
    const cases: Record<string, [code: string, at?: string]> = {
      "a0.js": ["using a = 1;", "1:1"],
      "a1.ts": ["using a = 1;", "1:1"],
      "a2.jsx": ["let b;\n  using a = 1, c = 2;", "2:3"],
      "a3.js": ["'use strict'; using a = 1;", "1:15"],
      "a4.js": ["using a = 1; async function f() { await b; }", "1:1"],
      "a5.js": ["using a = 1; import('x');", "1:1"],
      "a6.ts": ["using a = 1; import x = require('y');", "1:1"],
      "b0.js": ["using a = 1; export {};"],
      "b1.mjs": ["using a = 1;"],
      "b2.cjs": ["using a = 1;"],
      "b3.cts": ["using a = 1;"],
      "b4.js": ["{ using a = 1; }"],
      "b5.js": ["await using a = 1;"],
      "b6.js": ["using a = 1; await b;"],
      "b7.js": ["using a = 1; function f() { import.meta; }"],
      "b8.ts": ["using a = 1; export = a;"],
      "b9.js": ["for (using a of b) {}"],
    };
    const files = Object.fromEntries(Object.entries(cases).map(([name, [code]]) => [name, code + "\n"]));
    const oxlintrc = JSON.stringify({ categories: { correctness: "off" } });
    const { stdout } = await lint({ ".oxlintrc.json": oxlintrc, ...files }, ["-f", "unix"]);
    expect(
      stdout
        .split("\n")
        .filter(line => line.endsWith("]"))
        .sort(),
    ).toEqual(Object.entries(cases).flatMap(([name, [, at]]) => (at ? [`${name}:${at}: ${refused} [Error]`] : [])));
  });

  // The same.
  test("`export =` beside another export is refused as oxc refuses it", async () => {
    const cases: Record<string, [code: string, at?: string]> = {
      "a0.ts": ["export const a = 1;\nexport = a;", "2:1"],
      "a1.ts": ["const a = 1;\nexport = a;\nexport const b = 2;", "2:1"],
      "a2.ts": ["const a = 1; export type T = 1; export = a;", "1:33"],
      "a3.ts": ['const a = 1; export * from "x"; export = a;', "1:33"],
      "a4.ts": ["const a = 1; export default 1; export = a;", "1:32"],
      "a5.ts": ["const a = 1; export { a }; export = a;", "1:28"],
      "a6.ts": ["const a = 1; export interface I {} export = a;", "1:36"],
      "a7.ts": ['const a = 1; export import x = require("y"); export = a;', "1:46"],
      "a8.d.ts": ["declare const a: 1; export const b: 1; export = a;", "1:40"],
      "a9.ts": ["const a = 1; export namespace N {} export = a;", "1:36"],
      "b0.ts": ['const a = 1; export type { T } from "x"; export = a;', "1:42"],
      "b1.cts": ["export const a = 1;\nexport = a;", "2:1"],
      "c0.ts": ["const a = 1; export {}; export = a;"],
      "c1.ts": ["const a = 1; export = a; export = a;"],
      "c2.ts": ["const a = 1; export as namespace N; export = a;"],
      "c3.ts": ["const a = 1; export = a;"],
      "c4.ts": ['import x from "y"; export = x;'],
    };
    const files = Object.fromEntries(Object.entries(cases).map(([name, [code]]) => [name, code + "\n"]));
    const oxlintrc = JSON.stringify({ categories: { correctness: "off" } });
    const { stdout } = await lint({ ".oxlintrc.json": oxlintrc, ...files }, ["-f", "unix"]);
    const refused = "An export assignment cannot be used in a module with other exported elements";
    expect(
      stdout
        .split("\n")
        .filter(line => line.endsWith("]"))
        .sort(),
    ).toEqual(Object.entries(cases).flatMap(([name, [, at]]) => (at ? [`${name}:${at}: ${refused} [Error]`] : [])));
  });

  // The same.
  test("only a namespace can be deferred, as for oxc", async () => {
    const [ofDefault, ofNamed] = ["Default imports", "Named imports"].map(
      it => `1:8: ${it} are not allowed in a deferred import.`,
    );
    const cases: Record<string, [code: string, refusal?: string]> = {
      "a0.ts": ['import defer x from "m";', ofDefault],
      "a1.ts": ['import defer { a } from "m";', ofNamed],
      "a2.js": ['import defer x from "m";', ofDefault],
      "a3.js": ['import defer { a } from "m";', ofNamed],
      "a4.ts": ['import defer x, { a } from "m";', ofDefault],
      "a5.ts": ['import defer x, * as n from "m";', ofDefault],
      "b0.ts": ['import defer * as n from "m";'],
      "b1.js": ['import defer * as n from "m";'],
      "b2.ts": ['import defer from "m";'],
      "b3.ts": ['import defer, { a } from "m";'],
      "b4.ts": ['import type defer from "m";'],
      "b5.js": ['import source x from "m";'],
    };
    const files = Object.fromEntries(Object.entries(cases).map(([name, [code]]) => [name, code + "\n"]));
    const oxlintrc = JSON.stringify({ categories: { correctness: "off" } });
    const { stdout } = await lint({ ".oxlintrc.json": oxlintrc, ...files }, ["-f", "unix"]);
    expect(
      stdout
        .split("\n")
        .filter(line => line.endsWith("]"))
        .sort(),
    ).toEqual(Object.entries(cases).flatMap(([name, [, refusal]]) => (refusal ? [`${name}:${refusal} [Error]`] : [])));
  });

  // The same.
  test("`declare` in what is ambient already, and `for await` where nothing waits, are refused as oxc refuses them", async () => {
    const declared = "A 'declare' modifier cannot be used in an already ambient context.";
    const waits = "`for await` loops are only allowed within async functions and at the top levels of modules";
    const cases: Record<string, [code: string, refusal?: string]> = {
      "a0.ts": ["declare namespace A { declare const b: 1; }", `1:23: ${declared}`],
      "a1.ts": ['declare module "m" { declare function f(): void; }', `1:22: ${declared}`],
      "a2.d.ts": ["declare namespace A { declare const b: 1; }", `1:23: ${declared}`],
      "a3.d.ts": ["namespace A { declare const b: 1; }", `1:15: ${declared}`],
      "a4.ts": ["declare namespace A { namespace B { declare let c; } }", `1:37: ${declared}`],
      "a5.ts": ["declare global { declare var x: 1; }\nexport {};", `1:18: ${declared}`],
      "a6.ts": ["declare namespace A { declare class B {} }", `1:23: ${declared}`],
      "a7.ts": ["declare namespace A { declare interface I {} }", `1:23: ${declared}`],
      "a8.ts": ["declare namespace A { const a: 1; declare const b: 1; }", `1:35: ${declared}`],
      "a9.d.ts": ["export namespace A { declare const b: 1; }", `1:22: ${declared}`],
      "b0.d.ts": ["declare const a: 1;"],
      "b1.ts": ["namespace A { declare const b: 1; }"],
      "b2.ts": ["declare namespace A { export declare const b: 1; }"],
      "b3.ts": ["declare class A { declare x: 1; }"],
      "b4.d.ts": ["export declare const a: 1;"],
      "b5.d.ts": ['declare module "m" { export declare const a: 1; }'],
      "c0.ts": ["for await (const x of y) {}", `1:5: ${waits}`],
      "c1.js": ["for await (const x of y) {}", `1:5: ${waits}`],
      "c2.cjs": ["for await (const x of y) {}", `1:5: ${waits}`],
      "c3.ts": ["function f() { for await (const x of y) {} }", `1:20: ${waits}`],
      "c4.ts": ["{ for await (const x of y) {} }", `1:7: ${waits}`],
      "c5.js": ["const f = () => { for await (const x of y) {} };", `1:23: ${waits}`],
      "d0.ts": ["for await (const x of y) {}\nexport {};"],
      "d1.mjs": ["for await (const x of y) {}"],
      "d2.ts": ["async function f() { for await (const x of y) {} }"],
      "d3.ts": ["for await (const x of y) {}\nawait z;"],
    };
    const files = Object.fromEntries(Object.entries(cases).map(([name, [code]]) => [name, code + "\n"]));
    const oxlintrc = JSON.stringify({ categories: { correctness: "off" } });
    const { stdout } = await lint({ ".oxlintrc.json": oxlintrc, ...files }, ["-f", "unix"]);
    expect(
      stdout
        .split("\n")
        .filter(line => line.endsWith("]"))
        .sort(),
    ).toEqual(Object.entries(cases).flatMap(([name, [, refusal]]) => (refusal ? [`${name}:${refusal} [Error]`] : [])));
  });

  // The same.
  test("`with` is refused where the code is strict for oxc, and in TypeScript", async () => {
    const cases: Record<string, [code: string, at?: string]> = {
      "a0.mjs": ["with (a) {}", "1:1"],
      "a1.ts": ["with (a) {}", "1:1"],
      "a2.js": ["with (a) {} export {};", "1:1"],
      "a3.js": ["'use strict'; with (a) {}", "1:15"],
      "a4.js": ["function f() { 'use strict'; with (a) {} }", "1:30"],
      "a5.js": ["class A { m() { with (a) {} } }", "1:17"],
      "a6.cts": ["with (a) {}", "1:1"],
      "a7.js": ["with (a) {} import.meta;", "1:1"],
      "a8.js": ["with (a) {} await b;", "1:1"],
      "a9.ts": ["function f() { with (a) {} }", "1:16"],
      "b0.js": ["with (a) {}"],
      "b1.cjs": ["with (a) {}"],
      "b2.jsx": ["with (a) {}"],
    };
    const files = Object.fromEntries(Object.entries(cases).map(([name, [code]]) => [name, code + "\n"]));
    const oxlintrc = JSON.stringify({ categories: { correctness: "off" } });
    const { stdout } = await lint({ ".oxlintrc.json": oxlintrc, ...files }, ["-f", "unix"]);
    expect(
      stdout
        .split("\n")
        .filter(line => line.endsWith("]"))
        .sort(),
    ).toEqual(
      Object.entries(cases).flatMap(([name, [, at]]) =>
        at ? [`${name}:${at}: 'with' statements are not allowed [Error]`] : [],
      ),
    );
  });

  test("in a file that oxc refuses for an early error, the rules that need types go on", async () => {
    const files = {
      "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, noEmit: true, lib: ["es2022"], types: [] } }),
      ".oxlintrc.json": JSON.stringify({
        plugins: ["typescript"],
        categories: { correctness: "off" },
        rules: {
          "no-var": "error",
          "typescript/no-floating-promises": "error",
          "typescript/no-unnecessary-type-assertion": "error",
        },
      }),
      "a.ts":
        "declare const p: Promise<number>;\nfunction f(a: number, a: number) { return a as number; }\n" +
        "// oxlint-disable-next-line typescript/no-floating-promises\np;\n// oxlint-disable-next-line no-var\nvar y = 1;\n" +
        "export { f, y };\n",
    };
    const flags = ["--type-aware", "--report-unused-disable-directives", "-f", "unix", "a.ts"];
    const places = (stdout: string) =>
      stdout
        .split("\n")
        .flatMap(it => /^a\.ts:(\d+:\d+): .* \[Error(\/.*)?\]$/.exec(it)?.slice(1, 3).join(" ").trim() ?? []);
    const { stdout, exitCode } = await lint(files, flags);
    expect(places(stdout).sort()).toEqual([
      "2:12",
      "2:43 /typescript(no-unnecessary-type-assertion)",
      "4:1 /typescript(no-floating-promises)",
    ]);
    expect(exitCode).toBe(1);
    const fixed = await lint(files, ["--fix", ...flags], { reads: ["a.ts"] });
    expect(fixed.files["a.ts"]).toBe(files["a.ts"].replace("a as number", "a"));
  });

  describe("rules that need types", () => {
    const files = {
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          target: "esnext",
          module: "esnext",
          moduleResolution: "bundler",
          lib: ["esnext"],
          types: [],
        },
      }),
      "eslint.config.js": `export default [{
        files: ["**/*.ts"],
        plugins: { "@typescript-eslint": { meta: { name: "@typescript-eslint/eslint-plugin" } } },
        languageOptions: { parser: { meta: { name: "typescript-eslint/parser" } }, parserOptions: { projectService: true } },
        rules: { "@typescript-eslint/no-floating-promises": "error", "@typescript-eslint/no-unnecessary-type-assertion": "error" },
      }];`,
      "a.ts": `import { later, text } from "./b";\nlater();\nexport const a = text as string;\n`,
      "b.ts": `export async function later() {}\nexport const text: string = "";\n`,
    };

    test("a note says that the typescript of the project is older than the one as which types are checked", async () => {
      const notes = async (version: string, more: Record<string, string> = {}, ...flags: string[]) => {
        const installed = { "node_modules/typescript/package.json": JSON.stringify({ name: "typescript", version }) };
        const { stderr } = await lint({ ...files, ...installed, ...more }, ["-f", "stylish", ...flags]);
        return stderr.split("\n").filter(it => it.startsWith("note: "));
      };
      expect(await notes("5.8.3")).toEqual([
        "note: typescript 5.8.3 is installed; bun lint checks types as TypeScript 7.",
      ]);
      expect(await notes("7.0.2")).toEqual([]);
      expect(await notes("5.8.3", {}, "--quiet")).toEqual([]);
      // No rule needs types.
      const untyped = files["eslint.config.js"].replace(/rules: \{.*\}/, `rules: { "no-debugger": "error" }`);
      expect(await notes("5.8.3", { "eslint.config.js": untyped })).toEqual([]);
    });

    // `textContent` of an `Element` is `string | null` up to TypeScript 5.8 and `string` since: a `!` that is removed for the
    // library that is built in is an error to the compiler that the project has.
    test("the library is that of the typescript that is installed for the project", async () => {
      const names = ["Boolean", "CallableFunction", "Function", "IArguments", "NewableFunction", "Number", "Object"];
      const library = (marker: string) =>
        [
          "interface Array<T> { length: number; [n: number]: T }",
          ...[...names, "RegExp", "String"].map(it => `interface ${it} {}`),
          `declare const marker: ${marker};`,
          "",
        ].join("\n");
      const config = (lib: string) =>
        JSON.stringify({ compilerOptions: { strict: true, noEmit: true, lib: [lib], types: [] } });
      const { stdout, exitCode } = await lint(
        {
          "eslint.config.js": files["eslint.config.js"],
          "a/tsconfig.json": config("es5"),
          "a/node_modules/typescript/lib/lib.es5.d.ts": library("string | null"),
          "a/a.ts": "export const a = marker!;\n",
          "b/tsconfig.json": config("es5"),
          "b/node_modules/typescript/lib/lib.es5.d.ts": library("string"),
          "b/b.ts": "export const b = marker!;\n",
          // It has no lib.es2022.d.ts, so the library is the one that is built in, which has no `marker`.
          "c/tsconfig.json": config("es2022"),
          "c/node_modules/typescript/lib/lib.es5.d.ts": library("string"),
          "c/c.ts": "export const c = marker!;\n",
        },
        ["-f", "unix"],
      );
      expect(
        stdout
          .split("\n")
          .filter(it => it.includes("[Error/"))
          .map(it => it.split(": ")[0]),
      ).toEqual(["<dir>/b/b.ts:1:18"]);
      expect(exitCode).toBe(1);
    });

    describe("the globals of a file are those that the types of its program declare", () => {
      const tsconfig = (options: object, rest: object = {}) =>
        JSON.stringify({
          compilerOptions: { allowJs: true, checkJs: true, noEmit: true, strict: true, ...options },
          ...rest,
        });
      const tree = {
        "tsconfig.json": tsconfig({ lib: ["es2022"], types: ["a"] }),
        "globals.d.ts": "declare global { var mine: string }\nexport {};\n",
        "node_modules/@types/a/package.json": `{ "name": "@types/a", "version": "1.0.0", "types": "index.d.ts" }`,
        "node_modules/@types/a/index.d.ts":
          "declare var fromTypes: string;\ndeclare function alsoFromTypes(): void;\ninterface OnlyAType {}\n",
        "a.js": "console.log(fromTypes, alsoFromTypes, mine, window, typo, OnlyAType, Bun);\n",
      };
      const config = `export default [{
        rules: { "no-undef": "error" },
        languageOptions: { globals: { window: "readonly", mine: "off" } },
      }];`;
      /** The names that `rule` reports, in the order of the report. */
      const reported = (stdout: string, rule: string) =>
        stdout
          .split("\n")
          .filter(it => it.endsWith(`[Error/${rule}]`))
          .map(it => `${it.split(":")[0].replace("<dir>/", "")} ${/'([^']+)'/.exec(it)![1]}`);

      test.concurrent.each([
        // In the place of the environments: the project has neither the DOM's library nor the types of Node. `Bun` stays.
        ["--infer-globals", {}, ["--infer-globals"], ["console", "window", "typo", "OnlyAType"]],
        ["without it", {}, [], ["fromTypes", "alsoFromTypes", "mine", "typo", "OnlyAType"]],
        // As ESLint.
        [
          "with a configuration file",
          { "eslint.config.js": config },
          [],
          ["console", "fromTypes", "alsoFromTypes", "mine", "typo", "OnlyAType", "Bun"],
        ],
        // Besides what it says, and what it turns off stays off.
        [
          "with a configuration file and --infer-globals",
          { "eslint.config.js": config },
          ["--infer-globals"],
          ["console", "mine", "typo", "OnlyAType", "Bun"],
        ],
      ])("%s", async (_, more, flags, names) => {
        const { stdout, exitCode } = await lint({ ...tree, ...more }, [...flags, "-f", "unix"]);
        expect(reported(stdout, "no-undef")).toEqual(names.map(it => `a.js ${it}`));
        expect(exitCode).toBe(1);
      });

      test("what a library or a package declares is readonly, and so is all but a `var` or a `let` of the project", async () => {
        const { stdout, exitCode } = await lint(
          {
            ...tree,
            "globals.d.ts":
              "declare var mine: string;\ndeclare let mineLet: 1;\ndeclare const mineConst: 1;\ndeclare function mineFn(): void;\ndeclare class MineClass {}\n",
            "a.js": "fromTypes = mine = mineLet = mineConst = mineFn = MineClass = Array = 1;\n",
          },
          ["-f", "unix", "--infer-globals"],
        );
        expect(reported(stdout, "no-global-assign")).toEqual(
          ["fromTypes", "mineConst", "mineFn", "MineClass", "Array"].map(it => `a.js ${it}`),
        );
        expect(reported(stdout, "no-undef")).toEqual([]);
        expect(exitCode).toBe(1);
      });

      test("a project in which no file can declare a global has its libraries and its types", async () => {
        const { "globals.d.ts": _, ...rest } = tree;
        const text = "export {};\nvoid [Array, fromTypes, typo];\n";
        const { stdout, exitCode } = await lint({ ...rest, "a.js": text }, ["-f", "unix", "--infer-globals"]);
        expect(reported(stdout, "no-undef")).toEqual(["a.js typo"]);
        expect(exitCode).toBe(1);
      });

      // TypeScript reports nothing in such a file, so nobody has seen to it that what it uses is declared.
      test("where the project does not check its JavaScript, its types only add to the environments", async () => {
        const { stdout, exitCode } = await lint(
          {
            ...tree,
            "tsconfig.json": tsconfig({ lib: ["es2022"], types: ["a"], checkJs: false }),
            "a.js": "void [fromTypes, mine, process, window, typo];\n",
          },
          ["-f", "unix", "--infer-globals"],
        );
        expect(reported(stdout, "no-undef")).toEqual(["a.js typo"]);
        expect(exitCode).toBe(1);
      });

      // The program is loaded for the rules that need types, so what it declares costs nothing more.
      test("a file that is linted with types has them without --infer-globals", async () => {
        const all = { ...tree, "a.ts": "fromTypes = mine = '';\nexport {};\n" };
        const [typed, untyped] = await Promise.all([
          lint(all, ["-f", "unix", "--type-aware", "a.ts"]),
          lint(all, ["-f", "unix", "a.ts"]),
        ]);
        expect(reported(typed.stdout, "no-global-assign")).toEqual(["a.ts fromTypes"]);
        expect(reported(untyped.stdout, "no-global-assign")).toEqual([]);
      });

      // No file of the project is read before a name is about to be reported.
      describe("--infer-globals=fast: the options of the project choose the environments, and its types have the last word", () => {
        const node = {
          "node_modules/@types/node/package.json": `{ "name": "@types/node", "version": "1.0.0", "types": "index.d.ts" }`,
          "node_modules/@types/node/index.d.ts": "declare var process: object;\n",
        };
        test.concurrent.each([
          [
            "as --infer-globals",
            { lib: ["es2022"], types: ["a"] },
            "console.log(fromTypes, alsoFromTypes, mine, window, typo, OnlyAType, Bun);\n",
            ["console", "window", "typo", "OnlyAType"],
          ],
          [
            "the edition is that of `lib`",
            { lib: ["es5"], types: [] },
            "void [Array, Promise, Map];\n",
            ["Promise", "Map"],
          ],
          [
            "a part of an edition",
            { lib: ["es5", "es2015.promise"], types: [] },
            "void [Array, Promise, Map];\n",
            ["Map"],
          ],
          [
            "`target` without `lib` stands for its edition and a browser",
            { target: "es2020", types: [] },
            "void [window, BigInt, process, WeakRef];\n",
            ["process", "WeakRef"],
          ],
          ["a package of types", { lib: ["es2022"], types: ["node"] }, "void [process, window];\n", ["window"]],
          // Nothing is known then.
          [
            "a package of types that is not installed",
            { lib: ["es2022"], types: ["no"] },
            "void [window, typo];\n",
            ["typo"],
          ],
          [
            "a project that does not check its JavaScript",
            { lib: ["es2022"], types: ["a"], checkJs: false },
            "void [fromTypes, mine, process, window, typo];\n",
            ["typo"],
          ],
        ])("%s", async (_, options, text, names) => {
          const all = { ...tree, ...node, "tsconfig.json": tsconfig(options), "a.js": text };
          const { stdout, exitCode } = await lint(all, ["-f", "unix", "--infer-globals=fast"]);
          expect(reported(stdout, "no-undef")).toEqual(names.map(it => `a.js ${it}`));
          expect(exitCode).toBe(1);
        });

        // The search for files has seen the configuration files below where it began. The system is asked for the others.
        test("the project is the same, however the file is come by", async () => {
          const all = {
            "tsconfig.json": tsconfig({ lib: ["es2022"], types: [] }),
            "sub/deep/a.js": "void [document, typo];\n",
            "sub/web/tsconfig.json": tsconfig({ lib: ["es2022", "dom"], types: [] }),
            "sub/web/src/b.js": "void [document, typo];\n",
            ".gitignore": "sub/web/tsconfig.json\n",
          };
          const expected = ["sub/deep/a.js document", "sub/deep/a.js typo", "sub/web/src/b.js typo"];
          for (const paths of [["."], ["sub"], ["sub/deep", "sub/web/src"], ["sub/deep/a.js", "sub/web/src/b.js"]]) {
            const { stdout } = await lint(all, ["-f", "unix", "--infer-globals=fast", ...paths]);
            expect(reported(stdout, "no-undef").sort()).toEqual(expected);
          }
        });

        test("which project has a file is asked of `files`, `include`, `exclude` and `references`", async () => {
          const text = "void [document, typo];\n";
          const bare = { lib: ["es2022"], types: [] };
          const { stdout, exitCode } = await lint(
            {
              "tsconfig.json": JSON.stringify({
                files: [],
                references: [{ path: "./one" }, { path: "./two/other.json" }],
              }),
              "one/tsconfig.json": tsconfig({ ...bare, composite: true }, { include: ["src"], exclude: ["src/not"] }),
              "one/src/in.js": text,
              "one/src/deep/er/in.js": text,
              "one/src/not/out.js": text,
              "one/out.js": text,
              // `taken.ts` is in its place.
              "one/src/taken.js": text,
              "one/src/taken.ts": "export {};\n",
              "two/other.json": tsconfig({ ...bare, composite: true }, { files: ["named.js"] }),
              "two/named.js": text,
              "two/out.js": text,
            },
            ["-f", "unix", "--infer-globals=fast"],
          );
          expect(reported(stdout, "no-undef")).toEqual([
            "one/out.js typo",
            "one/src/deep/er/in.js document",
            "one/src/deep/er/in.js typo",
            "one/src/in.js document",
            "one/src/in.js typo",
            "one/src/not/out.js typo",
            "one/src/taken.js typo",
            "two/named.js document",
            "two/named.js typo",
            "two/out.js typo",
          ]);
          expect(exitCode).toBe(1);
        });
      });

      test.concurrent.each(["--infer-globals", "--infer-globals=fast"])(
        "a NUL in a path of the configuration file: %s",
        async flag => {
          const { stdout, exitCode } = await lint(
            {
              "jsconfig.json": JSON.stringify({
                compilerOptions: { checkJs: true, lib: ["es2022"] },
                references: [{ path: "./\0sub" }],
              }),
              "a.js": "void [window, Map];\n",
            },
            ["-f", "unix", flag],
          );
          expect(reported(stdout, "no-undef")).toEqual(["a.js window"]);
          expect(exitCode).toBe(1);
        },
      );

      // The request is made by a thread of the pool, for which the others wait. With references it has threads of its own.
      test.concurrent.each(["--infer-globals", "--infer-globals=fast"])(
        "as many threads as the pool has, and a project with references: %s",
        async flag => {
          const names = Array.from({ length: 24 }, (_, i) => `r${i}`);
          const long = Array.from({ length: 4000 }, (_, i) => `const x${i} = ${i};\nvoid x${i};\n`).join("");
          const all = {
            "tsconfig.json": tsconfig(
              { lib: ["es2022"], types: [] },
              { include: ["*.js", "*.d.ts"], references: names.map(it => ({ path: `./${it}` })) },
            ),
            "g.d.ts": "declare var mine: number;\n",
            "h.d.ts": "declare var alsoMine: number;\n",
            ...Object.fromEntries(
              names.flatMap(it => [
                [`${it}/tsconfig.json`, tsconfig({ lib: ["es2022"], types: [], composite: true, noEmit: false })],
                [`${it}/a.ts`, "export const a = 1;\n"],
              ]),
            ),
            ...Object.fromEntries(
              [1, 2, 3, 4, 5, 6].map(it => [`a${it}.js`, `export {};\n${long}void [mine, alsoMine, typo];\n`]),
            ),
          };
          const args = ["-f", "unix", flag, "--threads", "4", "a1.js", "a2.js", "a3.js", "a4.js", "a5.js", "a6.js"];
          const runs = await Promise.all([1, 2, 3, 4].map(() => lint(all, args, { env: { GOMAXPROCS: "4" } })));
          for (const { stdout } of runs) {
            expect(reported(stdout, "no-undef").sort()).toEqual([1, 2, 3, 4, 5, 6].map(it => `a${it}.js typo`));
          }
        },
      );

      test("each project has its own, and a file that no project includes has the environments", async () => {
        const text = "void [document, process, typo];\n";
        const { stdout, exitCode } = await lint(
          {
            "web/tsconfig.json": tsconfig({ lib: ["es2022", "dom"], types: [] }, { include: ["src"] }),
            "web/src/a.js": text,
            // Beside the project, not of it.
            "web/build.js": text,
            "cli/tsconfig.json": tsconfig({ lib: ["es2022"], types: [] }),
            "cli/a.js": text,
            "cli/global.ts": "export {};\ndeclare global {\n  var process: object;\n}\n",
            // A script: what it declares at the top is in every file of the project.
            "old/jsconfig.json": tsconfig({ lib: ["es5"], types: [] }),
            "old/first.js": "var process = {};\nfunction document() {}\n",
            "old/second.js": text,
            "none/a.js": text,
          },
          ["-f", "unix", "--infer-globals"],
        );
        expect(reported(stdout, "no-undef")).toEqual([
          "cli/a.js document",
          "cli/a.js typo",
          "none/a.js typo",
          "old/second.js typo",
          "web/build.js typo",
          "web/src/a.js process",
          "web/src/a.js typo",
        ]);
        expect(exitCode).toBe(1);
      });
    });

    // Which project a file is checked in is seen from `strictNullChecks`: without it the rule reports, and says at 0:1 that it
    // needs it. As ESLint 10.12 with typescript-eslint 8.71.1 under `--fix` or in an editor.
    describe("parserOptions.project names the projects", () => {
      const tsconfig = (strict: boolean, include?: string[]) =>
        JSON.stringify({ compilerOptions: { ...JSON.parse(files["tsconfig.json"]).compilerOptions, strict }, include });
      const text = "declare const o: { b: number } | null;\nexport const x = o ? 1 : 2;\n";
      const tree = {
        "tsconfig.json": tsconfig(true),
        "tsconfig.loose.json": tsconfig(false, ["a.ts", "sub"]),
        "tsconfig.strict.json": tsconfig(true, ["a.ts"]),
        "g/a/tsconfig.json": tsconfig(false, ["../x.ts"]),
        "g/b/tsconfig.json": tsconfig(true, ["../x.ts"]),
        "g/node_modules/c/tsconfig.json": tsconfig(false, ["../../y.ts"]),
        ...Object.fromEntries(["a.ts", "b.ts", "sub/s.ts", "g/x.ts", "g/y.ts"].map(it => [it, text])),
      };
      test.concurrent.each([
        [`{ projectService: true }`, []],
        [`{ project: true }`, []],
        // Not the nearest. What it does not include is checked with the nearest.
        [`{ project: "./tsconfig.loose.json" }`, ["a.ts", "sub/s.ts"]],
        // The first that includes the file.
        [`{ project: ["./tsconfig.loose.json", "./tsconfig.strict.json"] }`, ["a.ts", "sub/s.ts"]],
        [`{ project: ["./tsconfig.strict.json", "./tsconfig.loose.json"] }`, ["sub/s.ts"]],
        [`{ project: ["./g/*/tsconfig.json"] }`, ["g/x.ts"]],
        // A name comes before what a pattern finds, wherever it stands.
        [`{ project: ["./g/*/tsconfig.json", "./g/b/tsconfig.json"] }`, []],
        [`{ project: ["./g/**/tsconfig.json"] }`, ["g/x.ts"]],
        [`{ project: ["./g/**/tsconfig.json"], projectFolderIgnoreList: [] }`, ["g/x.ts", "g/y.ts"]],
        [`{ project: ["./*/tsconfig.json"], tsconfigRootDir: "g" }`, ["g/x.ts"]],
        [`{ project: "./tsconfig.loose.json", projectService: true }`, []],
      ])("%s", async (parserOptions, loose) => {
        const config = files["eslint.config.js"]
          .replace("{ projectService: true }", parserOptions)
          .replace(/rules: \{.*\}/, `rules: { "@typescript-eslint/no-unnecessary-condition": "error" }`);
        const { stdout, exitCode } = await lint({ ...tree, "eslint.config.js": config }, ["-f", "unix"]);
        const places = stdout.split("\n").filter(it => it.includes("[Error/"));
        expect(places.map(it => it.split(": ")[0])).toEqual(
          loose.flatMap(it => [`<dir>/${it}:0:1`, `<dir>/${it}:2:18`]),
        );
        expect(exitCode).toBe(loose.length > 0 ? 1 : 0);
      });
    });

    // The defaults of compiler options that TypeScript 6.0 has changed and that a rule can see, each in a project of its own.
    // What is expected is what ESLint 10.12 with typescript-eslint 8.71.1 reports with TypeScript 5.9.3 and with 6.0.3 installed.
    describe("the defaults of compiler options are those of the typescript that is installed for the project", () => {
      const names = ["assignment", "call", "member-access", "return"].map(it => `no-unsafe-${it}`);
      const rules = [...names, "no-unnecessary-condition"].map(it => `"@typescript-eslint/${it}": "error"`).join(", ");
      const config = files["eslint.config.js"].replace(/rules: \{.*\}/, `rules: { ${rules} }`);
      type Probe = { options: object; files: Record<string, string>; with5: string[]; with6: string[] };
      const probes: Record<string, Probe> = {
        // `strict`, and with it `strictNullChecks`
        "strict": {
          options: {
            "noEmit": true,
            "types": [],
            "target": "es2022",
            "lib": ["es2022"],
            "module": "esnext",
            "moduleResolution": "bundler",
          },
          files: { "a.ts": "declare const o: { b: number } | null;\nexport const x3 = o ? 1 : 2;\n" },
          with5: ["0:1 no-unnecessary-condition", "2:19 no-unnecessary-condition"],
          with6: [],
        },
        // `useUnknownInCatchVariables` and `noImplicitAny`, which `strict` stands for
        "catch-variable": {
          options: {
            "noEmit": true,
            "types": [],
            "target": "es2022",
            "lib": ["es2022"],
            "module": "esnext",
            "moduleResolution": "bundler",
            "strictNullChecks": true,
          },
          files: {
            "a.ts":
              "export function g() { try { return 1; } catch (e) { return e.x; } }\nexport function h(p) { return p.x; }\n",
          },
          with5: [
            "1:53 no-unsafe-return",
            "1:62 no-unsafe-member-access",
            "2:24 no-unsafe-return",
            "2:33 no-unsafe-member-access",
          ],
          with6: ["1:53 no-unsafe-return", "2:24 no-unsafe-return", "2:33 no-unsafe-member-access"],
        },
        // `types`: every `@types/*` that is installed, or none
        "types": {
          options: {
            "strict": true,
            "noEmit": true,
            "target": "es2022",
            "lib": ["es2022"],
            "module": "esnext",
            "moduleResolution": "bundler",
          },
          files: {
            "a.ts": "export const x1 = zzz.a;\n",
            "node_modules/@types/zzz/index.d.ts": "declare const zzz: { a: number };\n",
            "node_modules/@types/zzz/package.json":
              '{ "name": "@types/zzz", "version": "1.0.0", "types": "index.d.ts" }\n',
          },
          with5: [],
          with6: ["1:14 no-unsafe-assignment", "1:23 no-unsafe-member-access"],
        },
        // `target`, and with it the library: ES5 has no `includes`
        "target": {
          options: { "strict": true, "noEmit": true, "types": [], "module": "esnext", "moduleResolution": "bundler" },
          files: { "a.ts": "export const x1 = [1].includes(1);\n" },
          with5: ["1:14 no-unsafe-assignment", "1:19 no-unsafe-call"],
          with6: [],
        },
        // `module`, and with it `moduleResolution`: `classic` does not look into node_modules
        "module": {
          options: { "strict": true, "noEmit": true, "types": [], "target": "es2022", "lib": ["es2022"] },
          files: {
            "a.ts": 'import { v } from "pkg";\nexport const x1 = v.a;\n',
            "node_modules/pkg/index.d.ts": "export declare const v: { a: number };\n",
            "node_modules/pkg/package.json": '{ "name": "pkg", "version": "1.0.0", "types": "index.d.ts" }\n',
          },
          with5: ["2:14 no-unsafe-assignment", "2:21 no-unsafe-member-access"],
          with6: [],
        },
        // `moduleResolution` beside `module: esnext`
        "module-resolution": {
          options: {
            "strict": true,
            "noEmit": true,
            "types": [],
            "target": "es2022",
            "lib": ["es2022"],
            "module": "esnext",
          },
          files: {
            "a.ts": 'import { v } from "pkg";\nexport const x1 = v.a;\n',
            "node_modules/pkg/index.d.ts": "export declare const v: { a: number };\n",
            "node_modules/pkg/package.json": '{ "name": "pkg", "version": "1.0.0", "types": "index.d.ts" }\n',
          },
          with5: ["2:14 no-unsafe-assignment", "2:21 no-unsafe-member-access"],
          with6: [],
        },
        // `exports` of a package, which only the newer ways of resolving read
        "exports-map": {
          options: { "strict": true, "noEmit": true, "types": [], "lib": ["es2022"] },
          files: {
            "a.ts": 'import { v } from "pkg/sub";\nexport const x1 = v.a;\n',
            "node_modules/pkg/lib/s.d.ts": "export declare const v: { a: number };\n",
            "node_modules/pkg/package.json":
              '{ "name": "pkg", "version": "1.0.0", "exports": { "./sub": { "types": "./lib/s.d.ts" } } }\n',
          },
          with5: ["2:14 no-unsafe-assignment", "2:21 no-unsafe-member-access"],
          with6: [],
        },
        // `esModuleInterop`: a default import of `export =`
        "es-module-interop": {
          options: {
            "strict": true,
            "noEmit": true,
            "types": [],
            "target": "es2022",
            "lib": ["es2022"],
            "module": "commonjs",
            "moduleResolution": "node10",
          },
          files: {
            "a.ts": 'import f from "cjs";\nexport const x1 = f();\n',
            "node_modules/cjs/index.d.ts": "declare function f(): number;\nexport = f;\n",
            "node_modules/cjs/package.json": '{ "name": "cjs", "version": "1.0.0", "types": "index.d.ts" }\n',
          },
          with5: ["2:14 no-unsafe-assignment", "2:19 no-unsafe-call"],
          with6: [],
        },
        // `libReplacement`: `@typescript/lib-dom` in place of lib.dom.d.ts
        "lib-replacement": {
          options: {
            "strict": true,
            "noEmit": true,
            "types": [],
            "target": "es2022",
            "lib": ["es2022", "dom"],
            "module": "esnext",
            "moduleResolution": "bundler",
          },
          files: {
            "a.ts": "export const x1 = marker.a;\nexport const x2 = document.title;\n",
            "node_modules/@typescript/lib-dom/index.d.ts": "declare const marker: { a: number };\n",
            "node_modules/@typescript/lib-dom/package.json":
              '{ "name": "@typescript/lib-dom", "version": "1.0.0", "types": "index.d.ts" }\n',
          },
          with5: ["2:14 no-unsafe-assignment", "2:28 no-unsafe-member-access"],
          with6: ["1:14 no-unsafe-assignment", "1:26 no-unsafe-member-access"],
        },
        // What TypeScript 7.0 has removed means what it meant as long as a TypeScript before it is installed.
        // `baseUrl`: what is neither relative nor a package
        "explicit-base-url": {
          options: {
            "strict": true,
            "noEmit": true,
            "types": [],
            "lib": ["es2022"],
            "target": "es2022",
            "module": "esnext",
            "moduleResolution": "bundler",
            "baseUrl": "./src",
          },
          files: {
            "a.ts": 'import { v } from "lib/v";\nexport const x1 = v.a;\n',
            "src/lib/v.ts": "export const v = { a: 1 };\n",
          },
          with5: [],
          with6: [],
        },
        // `paths` are relative to `baseUrl`
        "explicit-base-url-paths": {
          options: {
            "strict": true,
            "noEmit": true,
            "types": [],
            "lib": ["es2022"],
            "target": "es2022",
            "module": "esnext",
            "moduleResolution": "bundler",
            "baseUrl": "./src",
            "paths": { "@lib/*": ["lib/*"] },
          },
          files: {
            "a.ts": 'import { v } from "@lib/v";\nexport const x1 = v.a;\n',
            "src/lib/v.ts": "export const v = { a: 1 };\n",
          },
          with5: [],
          with6: [],
        },
        // An inherited `baseUrl` counts from the file that has it
        "explicit-base-url-extends": {
          options: {},
          files: {
            "a.ts":
              'import { v } from "lib/v";\nimport { w } from "lib/w";\nexport const x1 = v.a;\nexport const x2 = w.a;\n',
            "config/base.json":
              '{ "compilerOptions": { "strict": true, "noEmit": true, "types": [], "lib": ["es2022"], "target": "es2022", "module": "esnext", "moduleResolution": "bundler", "baseUrl": "./src" } }\n',
            "config/src/lib/v.ts": "export const v = { a: 1 };\n",
            "src/lib/w.ts": "export const w = { a: 1 };\n",
            "tsconfig.json": '{"extends": "./config/base.json", "include": ["*.ts"]}',
          },
          with5: ["4:14 no-unsafe-assignment", "4:21 no-unsafe-member-access"],
          with6: ["4:14 no-unsafe-assignment", "4:21 no-unsafe-member-access"],
        },
        // `moduleResolution: node10` does not know `exports`
        "explicit-node10-exports": {
          options: {
            "strict": true,
            "noEmit": true,
            "types": [],
            "lib": ["es2022"],
            "target": "es2022",
            "module": "esnext",
            "moduleResolution": "node10",
          },
          files: {
            "a.ts": 'import { v } from "pkg/sub";\nexport const x1 = v.a;\n',
            "node_modules/pkg/lib/s.d.ts": "export declare const v: { a: number };\n",
            "node_modules/pkg/package.json":
              '{ "name": "pkg", "version": "1.0.0", "exports": { "./sub": { "types": "./lib/s.d.ts" } } }\n',
          },
          with5: ["2:14 no-unsafe-assignment", "2:21 no-unsafe-member-access"],
          with6: ["2:14 no-unsafe-assignment", "2:21 no-unsafe-member-access"],
        },
        // but for an import that says how it is to be resolved: that one knows all of it, and each way has its own
        "explicit-node10-resolution-mode": {
          options: {
            "strict": true,
            "noEmit": true,
            "types": [],
            "lib": ["es2022"],
            "target": "es2022",
            "module": "esnext",
            "moduleResolution": "node10",
          },
          files: {
            "a.ts":
              'import type { V as I } from "pkg" with { "resolution-mode": "import" };\n' +
              'import type { V as R } from "pkg" with { "resolution-mode": "require" };\n' +
              'import type { V as N } from "pkg";\n' +
              'type T = import("pkg", { with: { "resolution-mode": "import" } }).V;\n' +
              "export const x1 = (v: I) => v.esm;\nexport const x2 = (v: R) => v.cjs;\nexport const x3 = (v: T) => v.esm;\n" +
              "export const x4 = (v: I) => v.cjs;\nexport const x5 = (v: N) => v.esm;\n",
            "node_modules/pkg/c.d.cts": "export interface V {\n  cjs: number;\n}\n",
            "node_modules/pkg/e.d.mts": "export interface V {\n  esm: number;\n}\n",
            "node_modules/pkg/package.json":
              '{ "name": "pkg", "version": "1.0.0", "exports": { ".": { "import": { "types": "./e.d.mts" }, "require": { "types": "./c.d.cts" } } } }\n',
          },
          with5: ["8:29 no-unsafe-return", "9:29 no-unsafe-return", "9:31 no-unsafe-member-access"],
          with6: ["8:29 no-unsafe-return", "9:29 no-unsafe-return", "9:31 no-unsafe-member-access"],
        },
        // nor the name of the package itself
        "explicit-node-self-name": {
          options: {
            "strict": true,
            "noEmit": true,
            "types": [],
            "target": "es2022",
            "lib": ["es2022"],
            "module": "esnext",
            "moduleResolution": "node",
          },
          files: {
            "a.ts": 'import { x } from "p/x";\nexport const x1 = x.a;\n',
            "package.json": '{ "name": "p", "version": "1.0.0", "exports": { "./x": "./src/x.ts" } }\n',
            "src/x.ts": "export const x = { a: 1 };\n",
          },
          with5: ["2:14 no-unsafe-assignment", "2:21 no-unsafe-member-access"],
          with6: ["2:14 no-unsafe-assignment", "2:21 no-unsafe-member-access"],
        },
        // `moduleResolution: classic` does not look into node_modules
        "explicit-classic": {
          options: {
            "strict": true,
            "noEmit": true,
            "types": [],
            "lib": ["es2022"],
            "target": "es2022",
            "module": "esnext",
            "moduleResolution": "classic",
          },
          files: {
            "a.ts": 'import { v } from "pkg";\nexport const x1 = v.a;\n',
            "node_modules/pkg/index.d.ts": "export declare const v: { a: number };\n",
            "node_modules/pkg/package.json": '{ "name": "pkg", "version": "1.0.0", "types": "index.d.ts" }\n',
          },
          with5: ["2:14 no-unsafe-assignment", "2:21 no-unsafe-member-access"],
          with6: ["2:14 no-unsafe-assignment", "2:21 no-unsafe-member-access"],
        },
        // `module: amd` stands for it
        "explicit-module-amd": {
          options: {
            "strict": true,
            "noEmit": true,
            "types": [],
            "lib": ["es2022"],
            "target": "es2022",
            "module": "amd",
          },
          files: {
            "a.ts": 'import { v } from "pkg";\nexport const x1 = v.a;\n',
            "node_modules/pkg/index.d.ts": "export declare const v: { a: number };\n",
            "node_modules/pkg/package.json": '{ "name": "pkg", "version": "1.0.0", "types": "index.d.ts" }\n',
          },
          with5: ["2:14 no-unsafe-assignment", "2:21 no-unsafe-member-access"],
          with6: ["2:14 no-unsafe-assignment", "2:21 no-unsafe-member-access"],
        },
        // `esModuleInterop: false`: no default import of `export =`
        "explicit-interop-false": {
          options: {
            "strict": true,
            "noEmit": true,
            "types": [],
            "lib": ["es2022"],
            "target": "es2022",
            "module": "commonjs",
            "moduleResolution": "node10",
            "esModuleInterop": false,
            "allowSyntheticDefaultImports": false,
          },
          files: {
            "a.ts": 'import f from "cjs";\nexport const x1 = f();\n',
            "node_modules/cjs/index.d.ts": "declare function f(): number;\nexport = f;\n",
            "node_modules/cjs/package.json": '{ "name": "cjs", "version": "1.0.0", "types": "index.d.ts" }\n',
          },
          with5: ["2:14 no-unsafe-assignment", "2:19 no-unsafe-call"],
          with6: ["2:14 no-unsafe-assignment", "2:19 no-unsafe-call"],
        },
        // `target: es5`, and with it the library
        "explicit-target-es5": {
          options: {
            "strict": true,
            "noEmit": true,
            "types": [],
            "target": "es5",
            "module": "esnext",
            "moduleResolution": "bundler",
          },
          files: { "a.ts": "export const x1 = [1].includes(1);\n" },
          with5: ["1:14 no-unsafe-assignment", "1:19 no-unsafe-call"],
          with6: ["1:14 no-unsafe-assignment", "1:19 no-unsafe-call"],
        },
      };
      const projects = Object.entries(probes).flatMap(([name, probe]) => [
        [`${name}/tsconfig.json`, JSON.stringify({ compilerOptions: probe.options, include: ["*.ts"] })],
        ...Object.entries(probe.files).map(([file, text]) => [`${name}/${file}`, text]),
      ]);
      test.each([
        ["5.9.3", "with5"],
        ["6.0.3", "with6"],
      ] as const)(
        "%s",
        async (version, expected) => {
          const installed = { "node_modules/typescript/package.json": JSON.stringify({ name: "typescript", version }) };
          const all = { "eslint.config.js": config, ...installed, ...Object.fromEntries(projects) };
          const { stdout } = await lint(all, ["-f", "unix"]);
          const reports = Object.fromEntries(Object.keys(probes).map(name => [name, [] as string[]]));
          for (const line of stdout.split("\n").filter(it => it.includes("[Error/"))) {
            const [path, row, column] = line.split(":");
            reports[path.split("/")[1]].push(`${row}:${column} ${line.slice(line.lastIndexOf("/") + 1, -1)}`);
          }
          expect(reports).toEqual(Object.fromEntries(Object.entries(probes).map(([name, it]) => [name, it[expected]])));
        },
        isDebug || isASAN ? 120_000 : 30_000,
      );
    });

    test("run with the types of the project", async () => {
      const { stdout, exitCode } = await lint(files, ["-f", "unix"]);
      expect(stdout).toMatchInlineSnapshot(`
        "<dir>/a.ts:2:1: Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the \`void\` operator. [Error/@typescript-eslint/no-floating-promises]
        <dir>/a.ts:3:18: This assertion is unnecessary since it does not change the type of the expression. [Error/@typescript-eslint/no-unnecessary-type-assertion]

        2 problems"
      `);
      expect(exitCode).toBe(1);
    });

    test("--fix", async () => {
      const result = await lint(files, ["--fix", "-f", "unix"], { reads: ["a.ts"] });
      expect(result.files).toEqual({
        "a.ts": `import { later, text } from "./b";\nlater();\nexport const a = text;\n`,
      });
      expect(result.stdout).toMatchInlineSnapshot(`
        "<dir>/a.ts:2:1: Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the \`void\` operator. [Error/@typescript-eslint/no-floating-promises]

        1 problem"
      `);
    });

    // Each pass takes away one assertion of each file, and both projects read both files.
    test("--fix in two projects that import each other: each pass sees what the one before has made of both", async () => {
      const result = await lint(
        {
          "eslint.config.js": files["eslint.config.js"],
          "a/tsconfig.json": files["tsconfig.json"],
          "a/x.ts": `import { text } from "../b/y";\nexport const a = text as string as string as string;\n`,
          "b/tsconfig.json": files["tsconfig.json"],
          "b/y.ts": `import type { a } from "../a/x";\nexport const text: string = "";\nexport const b = text as typeof a as string as typeof a;\n`,
        },
        ["--fix", "-f", "unix"],
        { reads: ["a/x.ts", "b/y.ts"] },
      );
      expect(result).toMatchObject({
        files: {
          "a/x.ts": `import { text } from "../b/y";\nexport const a = text;\n`,
          "b/y.ts": `import type { a } from "../a/x";\nexport const text: string = "";\nexport const b = text;\n`,
        },
        raw: "",
        exitCode: 0,
      });
    });

    test("--no-type-aware skips them", async () => {
      const { raw, exitCode } = await lint(files, ["--no-type-aware"]);
      expect(raw).toBe("");
      expect(exitCode).toBe(0);
    });

    test("type errors are not reported", async () => {
      const { raw, exitCode } = await lint({ ...files, "a.ts": `export const a: number = "";\n` }, []);
      expect(raw).toBe("");
      expect(exitCode).toBe(0);
    });

    const slow = isDebug || isASAN ? 120_000 : 30_000;

    // Whether the file system takes `A` for `a`, where the projects of these tests are.
    const foldsCase = (() => {
      using dir = tempDir("bun-lint", { "probe": "" });
      return existsSync(join(String(dir), "PROBE"));
    })();

    // `name:line rule` of every problem, whatever the directories are called.
    async function problems(cwd: string, args: string[], stdin?: string) {
      await using proc = spawn({
        cmd: [...command, "-f", "json", ...args],
        env,
        cwd,
        stdin: stdin === undefined ? "ignore" : Buffer.from(stdin),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const results: { filePath: string; messages: { ruleId: string; line: number }[] }[] = JSON.parse(stdout || "[]");
      const found = results.flatMap(it =>
        it.messages.map(message => `${basename(it.filePath).toLowerCase()}:${message.line} ${message.ruleId}`),
      );
      return { found: found.sort(), stderr, exitCode };
    }
    const inSrc = {
      "tsconfig.json": files["tsconfig.json"],
      "eslint.config.js": files["eslint.config.js"],
      "src/a.ts": files["a.ts"],
      "src/b.ts": files["b.ts"],
    };
    const both = [
      "a.ts:2 @typescript-eslint/no-floating-promises",
      "a.ts:3 @typescript-eslint/no-unnecessary-type-assertion",
    ];
    // On Windows the working directory is spelled as whoever started the process spelled it.
    const inUpperCase = (dir: string) => join(dirname(dir), basename(dir).toUpperCase());
    const withSmallDrive = (dir: string) => dir[0].toLowerCase() + dir.slice(1);
    // `src/a.ts` is `Src/A.ts` in tsconfig.json, and so in the program. Where the file system does not fold case, each
    // spelling is a file of its own, and the type checker folds all the same: it finds `A.TS` where it looks for `a.ts`.
    const respelled = (text: string) => ({
      ...inSrc,
      "tsconfig.json": JSON.stringify({ ...JSON.parse(files["tsconfig.json"]), files: ["Src/A.ts"] }),
      "src/a.ts": text,
      "src/A.TS": text,
      "Src/A.ts": text,
      "Src/b.ts": files["b.ts"],
    });

    test(
      "run however an argument or the working directory is spelled",
      async () => {
        using dir = tempDir("bun-lint", inSrc);
        const root = String(dir);
        const rows: [cwd: string, args: string[]][] = [
          [root, []],
          [root, ["src"]],
          [root, ["src/a.ts"]],
          [root, [join(root, "src", "a.ts")]],
          [join(root, "src"), ["a.ts"]],
        ];
        if (foldsCase) {
          rows.push(
            [root, ["SRC"]],
            [root, ["SRC/a.ts"]],
            [root, ["src/A.ts"]],
            [root, [join(root, "SRC", "A.ts")]],
            [join(root, "SRC"), ["a.ts"]],
            [inUpperCase(root), []],
          );
        }
        if (isWindows) rows.push([withSmallDrive(root), []], [root, ["src\\a.ts"]]);
        const results = [];
        for (const [cwd, args] of rows) {
          const { found, exitCode } = await problems(cwd, args);
          results.push({ cwd, args, found, exitCode });
        }
        expect(results).toEqual(rows.map(([cwd, args]) => ({ cwd, args, found: both, exitCode: 1 })));
      },
      slow,
    );

    // As ESLint 10.12.0: "File ignored because no matching configuration was supplied.", whatever the file system takes the name for.
    test("`files` is compared with the path as it is written: **/*.ts is not for B.TS", async () => {
      using dir = tempDir("bun-lint", { ...inSrc, "src/B.TS": files["a.ts"] });
      expect(await problems(String(dir), [join("src", "B.TS")])).toMatchObject({
        found: ["b.ts:undefined null"],
        exitCode: 0,
      });
    });

    test(
      "run on a file that tsconfig.json spells differently",
      async () => {
        using dir = tempDir("bun-lint", respelled(files["a.ts"]));
        expect(await problems(String(dir), ["src/a.ts"])).toMatchObject({ found: both, exitCode: 1 });
      },
      slow,
    );

    // The text of the second pass, and that of standard input, is in memory under the path as it is spelled here.
    test(
      "--fix in several passes, and --stdin, however the path is spelled",
      async () => {
        const names = foldsCase ? ["src/a.ts", "SRC/A.ts"] : ["src/a.ts"];
        const results = [];
        for (const name of names) {
          using dir = tempDir("bun-lint", respelled("declare const text: string;\nexport const a = text!!;\n"));
          const fixed = await problems(String(dir), ["--fix", name]);
          const text = readFileSync(join(String(dir), "src/a.ts"), "utf8");
          const piped = await problems(String(dir), ["--stdin", "--stdin-filename", name], files["a.ts"]);
          results.push({
            name,
            left: fixed.found,
            text,
            piped: piped.found,
            exitCodes: [fixed.exitCode, piped.exitCode],
          });
        }
        expect(results).toEqual(
          names.map(name => ({
            name,
            left: [],
            text: "declare const text: string;\nexport const a = text;\n",
            piped: both,
            exitCodes: [0, 1],
          })),
        );
      },
      slow,
    );

    // oxlint checks it in a project of its own, whose configuration file is in memory, in the working directory.
    test(
      "a file that no project includes, from any working directory",
      async () => {
        using dir = tempDir("bun-lint", {
          ".oxlintrc.json": JSON.stringify({
            categories: { correctness: "off" },
            rules: { "typescript/no-floating-promises": "error" },
          }),
          "a.ts": "async function later() {}\nlater();\nexport {};\n",
        });
        const root = String(dir);
        const args = ["-c", join(root, ".oxlintrc.json"), "--type-aware", "-f", "unix", join(root, "a.ts")];
        const from = [root, parse(root).root, ...(isWindows ? [inUpperCase(root), withSmallDrive(root)] : [])];
        const results = [];
        for (const cwd of from) {
          await using proc = spawn({ cmd: [...command, ...args], env, cwd, stdout: "pipe", stderr: "pipe" });
          const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
          results.push({ cwd, stdout, exitCode });
        }
        const stdout = expect.stringContaining("a.ts:2:1: Promises must be awaited");
        expect(results).toEqual(from.map(cwd => ({ cwd, stdout, exitCode: 1 })));
      },
      slow,
    );

    // `LONG-D~1` is also what NTFS calls `long-directory-name`, unless short names are turned off for the volume.
    test.each(["LONG-D~1", ...(isWindows ? ["long-directory-name"] : [])])(
      "in a directory that is reached as LONG-D~1 and is called %s",
      async name => {
        using dir = tempDir(
          "bun-lint",
          Object.fromEntries(Object.entries(inSrc).map(([path, text]) => [`${name}/${path}`, text])),
        );
        const short = join(String(dir), "LONG-D~1");
        if (!existsSync(short)) return;
        expect(await problems(short, [])).toMatchObject({ found: both, exitCode: 1 });
        expect(await problems(String(dir), ["LONG-D~1/src/a.ts"])).toMatchObject({ found: both, exitCode: 1 });
      },
      slow,
    );

    test("--fix of a file with a byte order mark, in several passes", async () => {
      const result = await lint(
        { ...files, "a.ts": "\uFEFFdeclare const text: string;\nexport const a = text!!;\n" },
        ["--fix"],
        { reads: ["a.ts"] },
      );
      expect(result.files).toEqual({ "a.ts": "\uFEFFdeclare const text: string;\nexport const a = text;\n" });
      expect(result.exitCode).toBe(0);
    });

    test(
      "unicode-bom sees the byte order mark",
      async () => {
        const config = (option: string) =>
          files["eslint.config.js"].replace("rules: {", `rules: { "unicode-bom": ["error", "${option}"],`);
        const text = "export const a = 1;\r\n";
        const rows: [option: string, text: string, found: string[], fixed: string][] = [
          ["never", "\uFEFF" + text, ["a.ts:1 unicode-bom"], text],
          ["never", text, [], text],
          ["always", "\uFEFF" + text, [], "\uFEFF" + text],
          ["always", text, ["a.ts:1 unicode-bom"], "\uFEFF" + text],
        ];
        for (const [option, text, found, fixed] of rows) {
          using dir = tempDir("bun-lint", { ...files, "eslint.config.js": config(option), "a.ts": text });
          expect({ option, text, found: (await problems(String(dir), ["a.ts"])).found }).toEqual({
            option,
            text,
            found,
          });
          await problems(String(dir), ["--fix", "a.ts"]);
          expect({ option, text, fixed: readFileSync(join(String(dir), "a.ts"), "utf8") }).toEqual({
            option,
            text,
            fixed,
          });
        }
      },
      slow,
    );

    // For TypeScript, which drops it, it is column 14. In oxlint's formats a column counts bytes, of which the mark has three, as for
    // every other problem. (oxlint 1.87.0 puts what tsgolint reports three bytes too far to the left in all of such a file.)
    test("a type error is where it is, with a byte order mark before it, on the disk and on standard input", async () => {
      const project = {
        "tsconfig.json": files["tsconfig.json"],
        ".oxlintrc.json": JSON.stringify({ categories: { correctness: "off" } }),
        "a.ts": `\uFEFFexport const a: number = "";\n`,
      };
      const args = ["--type-aware", "--type-check", "-f", "unix"];
      const read = await lint(project, args);
      const piped = await lint(project, [...args, "--stdin", "--stdin-filename", "a.ts"], { stdin: project["a.ts"] });
      const where = (text: string) => /a\.ts:\d+:\d+: Type 'string'/.exec(text)?.[0];
      expect([where(read.raw), where(piped.raw)]).toEqual(["a.ts:1:17: Type 'string'", "a.ts:1:17: Type 'string'"]);
    });

    test("rules that are about several files run on a file that is linted with types", async () => {
      const { raw, exitCode } = await lint(
        {
          "tsconfig.json": files["tsconfig.json"],
          ".oxlintrc.json": JSON.stringify({
            categories: { correctness: "off" },
            plugins: ["import", "typescript"],
            rules: { "import/no-cycle": "error", "typescript/no-floating-promises": "error" },
          }),
          "a.ts": `import { b } from "./b";\nexport async function a() {}\nb();\n`,
          "b.ts": `import { a } from "./a";\nexport function b() {\n  a();\n}\n`,
        },
        ["--type-aware", "-f", "json"],
      );
      const found = JSON.parse(raw).diagnostics.map((it: any) => `${it.filename}:${it.labels[0].span.line} ${it.code}`);
      expect(found.sort()).toEqual([
        "a.ts:1 import(no-cycle)",
        "b.ts:1 import(no-cycle)",
        "b.ts:3 typescript(no-floating-promises)",
      ]);
      expect(exitCode).toBe(1);
    });

    // a.ts is linted with types, b.ts without.
    test(
      "a rule in JavaScript gets the path of the file, with and without types",
      async () => {
        const { raw, exitCode } = await lint(
          {
            ...files,
            "eslint.config.js": `import { existsSync } from "node:fs";
            import { isAbsolute, relative } from "node:path";
            const path = { create: context => ({ Program: node => context.report({ node, message: [
              isAbsolute(context.filename), existsSync(context.filename), relative(context.cwd, context.filename),
            ].join(" ") }) }) };
            export default [
              {
                files: ["**/*.ts"],
                plugins: { p: { meta: { name: "p" }, rules: { path } } },
                languageOptions: { parser: { meta: { name: "typescript-eslint/parser" } } },
                rules: { "p/path": "error" },
              },
              {
                files: ["a.ts"],
                plugins: { "@typescript-eslint": { meta: { name: "@typescript-eslint/eslint-plugin" } } },
                languageOptions: { parserOptions: { projectService: true } },
                rules: { "@typescript-eslint/no-floating-promises": "error" },
              },
            ];`,
          },
          ["-f", "json", "a.ts", "b.ts"],
        );
        const said = JSON.parse(raw).flatMap((it: any) => it.messages.map((m: any) => `${m.ruleId}: ${m.message}`));
        expect(said.filter((it: string) => it.startsWith("p/"))).toEqual([
          "p/path: true true a.ts",
          "p/path: true true b.ts",
        ]);
        expect(exitCode).toBe(1);
      },
      slow,
    );

    // As ESLint, whose `readFile` throws. Without types it always was one.
    test("a file that cannot be read is an error", async () => {
      const { "a.ts": _, ...others } = files;
      using dir = tempDir("bun-lint", isLinux ? others : files);
      const path = join(String(dir), "a.ts");
      const everyone = "*S-1-1-0";
      // It can be opened, and reading it fails, also for root.
      if (isLinux) symlinkSync("/proc/self/mem", path);
      // Its data only: what it is, and that it can be deleted, is still to be found out.
      else if (isWindows) Bun.spawnSync({ cmd: ["icacls", path, "/deny", `${everyone}:(RD)`] });
      else chmodSync(path, 0);
      try {
        const canRead = (() => {
          try {
            return readFileSync(path).length >= 0;
          } catch {
            return false;
          }
        })();
        // root on macOS.
        if (canRead) return;
        const { stderr, exitCode } = await problems(String(dir), []);
        expect(stderr).toContain("Cannot read ");
        expect(exitCode).toBe(2);
      } finally {
        if (isWindows) Bun.spawnSync({ cmd: ["icacls", path, "/remove:d", everyone] });
      }
    });

    describe("a project that is referenced is read from its sources", () => {
      const compilerOptions = {
        ...JSON.parse(files["tsconfig.json"]).compilerOptions,
        noEmit: false,
        composite: true,
        rootDir: "src",
        outDir: "dist",
      };
      // Nothing is built: it has no `dist`.
      const lib = (directory: string) => ({
        [`packages/${directory}/package.json`]: JSON.stringify({
          name: "lib",
          version: "1.0.0",
          types: "dist/index.d.ts",
        }),
        [`packages/${directory}/tsconfig.json`]: JSON.stringify({ compilerOptions, include: ["src"] }),
        [`packages/${directory}/src/index.ts`]: "export async function later() {}\n",
      });
      const app = `import { later } from "lib";\nlater();\n`;
      // `LIB` and `INDEX.TS`: as in `respelled`.
      const workspace = (reference: string) => ({
        "eslint.config.js": files["eslint.config.js"],
        ...lib("lib"),
        ...lib("LIB"),
        "packages/app/tsconfig.json": JSON.stringify({
          compilerOptions,
          files: ["src/index.ts"],
          references: [{ path: reference }],
        }),
        "packages/app/src/index.ts": app,
        "packages/app/src/INDEX.TS": app,
      });
      // The real path of the link has the drive and the directories as the system spells them.
      const rows: [reference: string, cwd: (dir: string) => string][] = [
        ["../lib", dir => dir],
        ["../LIB", dir => dir],
      ];
      if (isWindows) rows.push(["../lib", withSmallDrive]);
      test.each(rows)(
        "through a link in node_modules, referenced as %s",
        async (reference, cwd) => {
          using dir = tempDir("bun-lint", workspace(reference));
          const modules = join(String(dir), "packages/app/node_modules");
          mkdirSync(modules, { recursive: true });
          symlinkSync(join(String(dir), "packages/lib"), join(modules, "lib"), "junction");
          expect(await problems(cwd(String(dir)), ["packages/app/src/index.ts"])).toMatchObject({
            found: ["index.ts:2 @typescript-eslint/no-floating-promises"],
            exitCode: 1,
          });
        },
        slow,
      );
    });

    // `subst` gives the directory a drive letter, as in test/cli/check/check.test.ts.
    test.skipIf(!isWindows)(
      "a project at the root of a drive",
      async () => {
        using dir = tempDir("bun-lint", {
          ...inSrc,
          "no-project/.oxlintrc.json": JSON.stringify({
            categories: { correctness: "off" },
            rules: { "typescript/no-floating-promises": "error" },
          }),
          "no-project/c.js": "async function later() {}\nlater();\n",
        });
        const subst = (...args: string[]) => Bun.spawnSync({ cmd: ["subst", ...args] }).exitCode === 0;
        const drive = [..."ZYXWVUTSRQ"]
          .map(letter => `${letter}:`)
          .find(drive => !existsSync(`${drive}\\`) && subst(drive, String(dir)));
        expect(drive).toBeDefined();
        try {
          expect((await problems(`${drive}\\`, ["src"])).found).toEqual(both);
          expect((await problems(String(dir), [`${drive}\\src\\a.ts`])).found).toEqual(both);
          // The tsconfig.json at the root does not include it, and nothing is above the root.
          await using proc = spawn({
            cmd: [...command, "--type-aware", "-f", "unix", "c.js"],
            env,
            cwd: `${drive}\\no-project`,
            stdout: "pipe",
            stderr: "pipe",
          });
          expect(await proc.stdout.text()).toContain("c.js:2:1: Promises must be awaited");
        } finally {
          subst(drive!, "/D");
        }
      },
      slow,
    );

    // What typescript-eslint 8.71 says. `undefined`: nothing. In two of them TypeScript 7, and so tsgolint, differs from
    // TypeScript 6, on which typescript-eslint runs: they are as in 7.
    test("no-deprecated finds the tags of a comment where TypeScript does", async () => {
      const comments: [comment: string, reason: string | undefined][] = [
        ["/** @deprecated a\\@b c */", "a\\@b c"],
        ["/** @deprecated mail a@b.c now */", "mail a@b.c now"],
        ["/** @deprecated x @ y */", "x @ y"],
        ["/** @deprecated x @y z */", "x"],
        ["/** @deprecated `x @y` z */", "`x @y` z"],
        // 6: "b` c"
        ["/** text `a @deprecated b` c */", undefined],
        ["/** @deprecated (@see y) */", "(@see y)"],
        // 6: "a"
        ["/** @deprecated a @*/", "a @"],
        ["/** text@deprecated no */", undefined],
        ["/** text @deprecated yes */", "yes"],
        ["/** @foo bar@deprecated no */", undefined],
        ["/** @foo `bar @deprecated no` */", undefined],
        ["/** @deprecated a {@link b}\n * c */", "a {@link b}c"],
        ["/**\n * - @deprecated dash\n */", "dash"],
        ['/** @deprecated Use `{ "*": ["./*"] }` instead. */', 'Use `{ "*": ["./*"] }` instead.'],
      ];
      const { raw } = await lint(
        {
          ...files,
          "eslint.config.js": files["eslint.config.js"].replace("no-floating-promises", "no-deprecated"),
          "a.ts":
            comments.map(([comment], i) => `${comment}\nexport function f${i}() {}\n`).join("") +
            comments.map((_, i) => `f${i}();\n`).join(""),
        },
        ["-f", "json"],
      );
      const reported: { message: string }[] = JSON.parse(raw)[0].messages;
      expect(reported.map(it => it.message)).toEqual(
        comments.flatMap(([, reason], i) => (reason === undefined ? [] : [`\`f${i}\` is deprecated. ${reason}`])),
      );
    });
  });

  describe("the command line", () => {
    test("an unknown flag fails with 2 and suggests another", async () => {
      const { raw, stderr, exitCode } = await lint({ "a.js": "" }, ["--fixx"]);
      expect(raw).toBe("");
      expect(stderr).toContain("Invalid option '--fixx' - perhaps you meant '--fix'?");
      expect(exitCode).toBe(2);
    });

    test("a flag without its value fails with 2", async () => {
      const { stderr, exitCode } = await lint({ "a.js": "" }, ["--format"]);
      expect(stderr).toContain("Value for 'format'");
      expect(exitCode).toBe(2);
    });

    test("what follows -- is a path", async () => {
      const { stdout } = await lint({ "eslint.config.js": basic, "--fix.js": "debugger;\n" }, [
        "-f",
        "unix",
        "--",
        "--fix.js",
      ]);
      expect(stdout).toMatchInlineSnapshot(`
        "<dir>/--fix.js:1:1: Unexpected 'debugger' statement. [Error/no-debugger]

        1 problem"
      `);
    });

    test("--cwd", async () => {
      const { stdout } = await lint({ "p/eslint.config.js": basic, "p/a.js": "debugger;\n", "b.js": "debugger;\n" }, [
        "--cwd",
        "p",
        "-f",
        "unix",
      ]);
      expect(stdout).toMatchInlineSnapshot(`
        "<dir>/p/a.js:1:1: Unexpected 'debugger' statement. [Error/no-debugger]

        1 problem"
      `);
    });

    test("rules about a name do not listen in files that do not mention it", async () => {
      const files = {
        "eslint.config.js": config({ "no-eval": "error" }),
        "a.js": "a();\n",
        "b.ts": "b<T>();\n",
        "c.tsx": "<c />;\n",
      };
      const { stderr, exitCode } = await lint(files, ["--timing"]);
      expect(stderr).toContain("without a filter of the names they mention: 0 files");
      expect(exitCode).toBe(0);
    });

    test("--help", async () => {
      const { stdout, exitCode } = await lint({}, ["--help"]);
      expect(stdout).toContain("bun lint");
      expect(stdout).toContain("--max-warnings");
      expect(exitCode).toBe(0);
    });
  });
});

describe.concurrent("regular expressions in a configuration", () => {
  test("are JavaScript's on text that is not ASCII", async () => {
    const { stdout, exitCode } = await lint(
      {
        "eslint.config.js": config({
          "id-match": ["error", "^\\p{Ll}[\\p{L}\\p{N}]*$"],
          "no-unused-vars": ["error", { varsIgnorePattern: "^größe" }],
          "max-len": ["error", { code: 30, ignorePattern: "^// 💩.é" }],
          "capitalized-comments": ["error", "always", { ignorePattern: "ünï|💩" }],
          "no-restricted-imports": ["error", { patterns: [{ regex: "^@scope/(?!erlaubt/ü)" }] }],
          // A character outside the BMP is one character with the `u` flag, and two without.
          "no-restricted-syntax": ["error", "Identifier[name=/^.𝒳$/u]", "Literal[value=/^..$/]"],
        }),
        "a.js": [
          `import "@scope/erlaubt/ü";`,
          `import "@scope/erlaubt/u";`,
          `// 💩xé is ignored however long it is`,
          `// 💩xe is not ignored, and too long`,
          `// ünï starts small`,
          `// élan starts small too`,
          `let größeDesFensters = 1;`,
          `let Größe = 2;`,
          `a𝒳("💩", "ab", "é");`,
          ``,
        ].join("\n"),
      },
      ["a.js"],
    );
    expect(stdout).toMatchInlineSnapshot(`
      "<dir>/a.js
        2:1   error  '@scope/erlaubt/u' import is restricted from being used by a pattern                  no-restricted-imports
        4:1   error  This line has a length of 35. Maximum allowed is 30                                   max-len
        6:1   error  Comments should not begin with a lowercase character                                  capitalized-comments
        8:5   error  Identifier 'Größe' does not match the pattern '^/p{Ll}[/p{L}/p{N}]*$'                 id-match
        8:5   error  'Größe' is assigned a value but never used. Allowed unused vars must match /^größe/u  no-unused-vars
        9:1   error  Using 'Identifier[name=/^.𝒳$/u]' is not allowed                                      no-restricted-syntax
        9:5   error  Using 'Literal[value=/^..$/]' is not allowed                                          no-restricted-syntax
        9:11  error  Using 'Literal[value=/^..$/]' is not allowed                                          no-restricted-syntax

      ✖ 8 problems (8 errors, 0 warnings)
        1 error and 0 warnings potentially fixable with the \`--fix\` option."
    `);
    expect(exitCode).toBe(1);
  });

  test("the rules compile none for the patterns that they have themselves", async () => {
    const files = {
      "a.js": [
        `switch (Math.random()) {`,
        `  case 0:`,
        `    console.log(0);`,
        `  // FALLſ\u2003Through`,
        `  case 1:`,
        `    console.log(1);`,
        `  // fall  through`,
        `  case 2:`,
        `    console.log(2);`,
        `}`,
        `// \u3000ToDo: a`,
        `// todoſ: b`,
        ``,
      ].join("\n"),
      "b.ts": "// @ts-ignore\nexport const a: number = 1;\n",
    };
    // JavaScriptCore, which has the regular expressions, prints its options when it is started.
    const env = { BUN_JSC_dumpOptions: "1", JSC_dumpOptions: "1" };
    // Without a configuration file: eslint:recommended.
    const { stdout, stderr, exitCode } = await lint(files, ["--rule", "no-warning-comments: error"], { env });
    expect(stdout).toMatchInlineSnapshot(`
      "<dir>/a.js
         4:11  error  Irregular whitespace not allowed            no-irregular-whitespace
         8:3   error  Expected a 'break' statement before 'case'  no-fallthrough
        11:1   error  Unexpected 'todo' comment: 'ToDo: a'        no-warning-comments
        11:4   error  Irregular whitespace not allowed            no-irregular-whitespace

      <dir>/b.ts
        1:1  error  Use "@ts-expect-error" instead of "@ts-ignore", as "@ts-ignore" will do nothing if the following line is error-free  @typescript-eslint/ban-ts-comment

      ✖ 5 problems (5 errors, 0 warnings)"
    `);
    expect(stderr).not.toContain("JSC options");
    expect(exitCode).toBe(1);

    const own = await lint(files, ["--rule", 'no-fallthrough: [error, { commentPattern: "fall +through" }]'], { env });
    expect(own.stdout).toMatch(/ 5:3 +error +Expected a 'break' statement before 'case' +no-fallthrough\n/);
    expect(own.stderr).toContain("JSC options");
  });

  test("one is shared by all threads", async () => {
    const files: Record<string, string> = {
      // A quantified group: what a match of it can go back to is kept with the compiled pattern.
      "eslint.config.js": config({ "id-match": ["error", "^(?:[a-z]+[A-Z]?)+\\d*$"] }),
    };
    for (let file = 0; file < 48; file++) {
      let text = "";
      for (let name = 0; name < 100; name++) {
        text += `export const someName${Buffer.alloc(2 * (name % 7), "Of").toString()}${file}${name} = 0;\n`;
      }
      files[`f${file}.js`] = `${text}export const Wrong_${file} = 0;\n`;
    }
    const { raw, exitCode } = await lint(files, ["--threads=8", "--format=json"]);
    const reported = (JSON.parse(raw) as { messages: { message: string }[] }[]).flatMap(it => it.messages);
    expect(reported.map(it => it.message).sort()).toEqual(
      Array.from(
        { length: 48 },
        (_, file) => `Identifier 'Wrong_${file}' does not match the pattern '^(?:[a-z]+[A-Z]?)+\\d*$'.`,
      ).sort(),
    );
    expect(exitCode).toBe(1);
  });
});

describe.concurrent("a lint script in package.json", () => {
  const files = {
    "package.json": JSON.stringify({ scripts: { lint: "echo the script" } }),
    "eslint.config.js": basic,
    "a.js": "debugger;\n",
  };

  test("wins over the linter", async () => {
    const { stdout, exitCode } = await lint(files, []);
    expect(stdout).toBe("the script");
    expect(exitCode).toBe(0);
  });

  test("in that script, bun lint is the linter", async () => {
    const { stdout, exitCode } = await lint(
      {
        ...files,
        "package.json": JSON.stringify({ scripts: { lint: `"${bunExe().replaceAll("\\", "/")}" lint -f unix` } }),
      },
      [],
    );
    expect(stdout).toContain("[Error/no-debugger]");
    expect(exitCode).toBe(1);
  });

  // What `bun lint` meant before there was a linter.
  test.each([
    ["a file", { "lint.ts": `console.log("the file");` }, "the file"],
    ["a directory with an index", { "lint/index.js": `console.log("the index");` }, "the index"],
    // An install makes other files for it on Windows.
    ...(isWindows
      ? []
      : [
          [
            "what a package has installed",
            { "node_modules/.bin/lint": `#!/bin/sh\necho the executable\n` },
            "the executable",
          ],
        ]),
  ] as [string, Record<string, string>, string][])("%s of that name wins over the linter", async (_, more, printed) => {
    const { "package.json": __, ...rest } = files;
    using dir = tempDir("bun-lint-name", { ...rest, ...more });
    if ("node_modules/.bin/lint" in more) chmodSync(join(String(dir), "node_modules/.bin/lint"), 0o755);
    await using proc = spawn({ cmd: [bunExe(), "lint"], env, cwd: String(dir), stdout: "pipe", stderr: "pipe" });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout.trim()).toBe(printed);
    expect(exitCode).toBe(0);
  });

  // `bun run` has that directory in PATH.
  test.skipIf(isWindows)(
    "an executable of that name beside package.json wins over the linter, further down too",
    async () => {
      using dir = tempDir("bun-lint-name", {
        ...files,
        "package.json": "{}",
        "lint": `#!/bin/sh\necho the executable\n`,
        "sub/b.js": "debugger;\n",
      });
      chmodSync(join(String(dir), "lint"), 0o755);
      const cwd = join(String(dir), "sub");
      await using proc = spawn({ cmd: [bunExe(), "lint"], env, cwd, stdout: "pipe", stderr: "pipe" });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect(stdout.trim()).toBe("the executable");
      expect(exitCode).toBe(0);
    },
  );

  test("--cwd lint lint: the first is a directory", async () => {
    const { "package.json": __, ...rest } = files;
    using dir = tempDir("bun-lint-name", {
      "lint/eslint.config.js": rest["eslint.config.js"],
      "lint/a.js": rest["a.js"],
    });
    const cmd = [bunExe(), "--cwd", "lint", "lint", "-f", "unix"];
    await using proc = spawn({ cmd, env, cwd: String(dir), stdout: "pipe", stderr: "pipe" });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout).toContain("[Error/no-debugger]");
    expect(exitCode).toBe(1);
  });

  test("a directory of that name without an index does not", async () => {
    const { "package.json": __, ...rest } = files;
    const { stdout, exitCode } = await lint({ ...rest, "lint/notes.txt": "x" }, ["-f", "unix", "a.js"]);
    expect(stdout).toContain("[Error/no-debugger]");
    expect(exitCode).toBe(1);
  });

  test.each(["lint.json", "lint/index.json"])("%s, which cannot be run, does not", async name => {
    const { "package.json": __, ...rest } = files;
    const { stdout, exitCode } = await lint({ ...rest, [name]: "[]" }, ["-f", "unix", "a.js"]);
    expect(stdout).toContain("[Error/no-debugger]");
    expect(exitCode).toBe(1);
  });
});

// What the linter takes from the process that it runs in. Where `bun lint` is developed something else is in Bun's place for each
// of these. See "what bun format takes from Bun" in test/cli/format/format.test.ts.
describe.concurrent("what bun lint takes from Bun", () => {
  const files = {
    "eslint.config.js": basic,
    "a.js": "debugger;\n",
    "sub/eslint.config.js": basic,
    "sub/b.js": "debugger;\n",
  };

  /** `bun ...args` in a directory with `files`. */
  async function bun(files: Record<string, string>, args: string[], variables: Record<string, string> = {}) {
    using dir = tempDir("bun-lint-process", files);
    await using proc = spawn({
      cmd: [bunExe(), ...args],
      env: { ...env, ...variables },
      cwd: String(dir),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    return { stdout: normalizeBunSnapshot(stdout, String(dir)), exitCode };
  }

  test("--cwd before lint, and the flags of BUN_OPTIONS, which are not the linter's", async () => {
    const results = await Promise.all([
      bun(files, ["--cwd=sub", "lint", "-f", "unix"]),
      bun(files, ["--silent", "lint", "-f", "unix", "sub"]),
      bun(files, ["lint", "-f", "unix", "sub"], { BUN_OPTIONS: "--silent --no-install" }),
    ]);
    const expected = "<dir>/sub/b.js:1:1: Unexpected 'debugger' statement. [Error/no-debugger]\n\n1 problem";
    expect(results).toEqual(results.map(() => ({ stdout: expected, exitCode: 1 })));
  });

  // The process that runs the configuration file starts in that directory. With BUN_OPTIONS it would look for `sub` in `sub`.
  test("--cwd in BUN_OPTIONS, with a configuration file that is a program", async () => {
    const result = await bun(files, ["lint", "-f", "unix"], { BUN_OPTIONS: "--cwd=sub" });
    expect(result.stdout).toStartWith("<dir>/sub/b.js:1:1: Unexpected 'debugger' statement.");
    expect(result.exitCode).toBe(1);
  });

  test.each([
    // It would wait for a client, for ever.
    { BUN_INSPECT: "ws://127.0.0.1:0/x?wait=1" },
    { BUN_INSPECT_PRELOAD: "./nowhere.js" },
    { BUN_OPTIONS: "--preload=./nowhere.js" },
  ])("%j is not for the process that runs the configuration file", async variables => {
    const result = await bun(files, ["lint", "-f", "unix", "sub"], variables);
    expect(result.stdout).toStartWith("<dir>/sub/b.js:1:1: Unexpected 'debugger' statement.");
    expect(result.exitCode).toBe(1);
  });

  // ESLint prints its report and never ends.
  test.each([
    ["a timer", "setInterval(() => {}, 1000);"],
    ["a server", `import { createServer } from "node:http";\ncreateServer().listen(0);`],
  ])("a configuration file that leaves %s behind", async (_, code) => {
    // More than a pipe holds.
    const config = `${code}\nexport default [{ rules: { "no-debugger": "error" }, settings: { s: "x".repeat(3 << 20) } }];`;
    const all = { "eslint.config.mjs": config, "a.js": "debugger;\n" };
    const result = await bun(all, ["lint", "-f", "unix", "a.js"]);
    expect(result.stdout).toStartWith("<dir>/a.js:1:1: Unexpected 'debugger' statement.");
    expect(result.exitCode).toBe(1);
  });

  test("what else this process was started with is", async () => {
    const config = `export default [{ rules: { [process.env.THE_RULE]: "error" } }];`;
    const all = { "eslint.config.mjs": config, "a.js": "debugger;\n" };
    const result = await bun(all, ["lint", "-f", "unix", "a.js"], { THE_RULE: "no-debugger" });
    expect(result.stdout).toStartWith("<dir>/a.js:1:1: Unexpected 'debugger' statement.");
  });

  test("what the bunfig.toml of the project has for other commands is not read", async () => {
    const result = await bun({ ...files, "bunfig.toml": "[install]\nglobalDir = 1\n" }, ["lint", "-f", "unix", "a.js"]);
    expect(result.stdout).toStartWith("<dir>/a.js:1:1: Unexpected 'debugger' statement.");
    expect(result.exitCode).toBe(1);
  });

  test("colors are Bun's to decide: FORCE_COLOR, NO_COLOR, and none in a pipe", async () => {
    const line = (text: string) => text.split("\n").find(it => it.includes("no-debugger"));
    const [forced, refused, piped] = await Promise.all([
      lint(files, ["a.js"], { env: { FORCE_COLOR: "1" } }),
      lint(files, ["a.js"], { env: { NO_COLOR: "1" } }),
      lint(files, ["a.js"]),
    ]);
    expect(line(forced.raw)).toContain("\x1b[");
    expect(line(refused.raw)).toBe("  1:1  error  Unexpected 'debugger' statement  no-debugger");
    expect(line(piped.raw)).toBe(line(refused.raw));
  });

  test("more is printed than a pipe holds, and nobody reads it to its end", async () => {
    const many = { "eslint.config.js": basic, "a.js": "debugger;\n".repeat(20_000) };
    const whole = await lint(many, ["-f", "unix", "a.js"]);
    expect(whole.raw.split("\n").filter(it => it.endsWith("[Error/no-debugger]")).length).toBe(20_000);
    expect(whole.exitCode).toBe(1);

    using dir = tempDir("bun-lint-process", many);
    await using proc = spawn({
      cmd: [...command, "-f", "unix", "a.js"],
      env,
      cwd: String(dir),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const reader = proc.stdout.getReader();
    expect((await reader.read()).done).toBe(false);
    await reader.cancel();
    expect(await proc.exited).toBe(1);
  });

  test.skipIf(!isLinux)("a name that is not UTF-8, found in a directory and as an argument", async () => {
    using dir = tempDir("bun-lint-process", { "eslint.config.js": basic });
    writeFileSync(
      Buffer.concat([Buffer.from(String(dir) + "/n"), Buffer.from([0xff]), Buffer.from(".js")]),
      "debugger;\n",
    );
    const run = async (argument: string) => {
      await using proc = spawn({
        cmd: ["sh", "-c", `exec "$0" lint -f unix ${argument}`, bunExe()],
        env,
        cwd: String(dir),
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.bytes(), proc.exited]);
      return { line: Buffer.from(stdout).toString("latin1").split("\n")[0].slice(String(dir).length), exitCode };
    };
    const expected = { line: "/n\xff.js:1:1: Unexpected 'debugger' statement. [Error/no-debugger]", exitCode: 1 };
    expect(await run(".")).toEqual(expected);
    expect(await run(`"$(printf 'n\\377.js')"`)).toEqual(expected);
  });

  // `String(number)` and the value of a literal are WebKit's.
  test("numbers are read and written as JavaScript does", async () => {
    const keys = [
      ["1e21", '"1e+21"'],
      ["1e-7", '"1e-7"'],
      ["0.000001", '"0.000001"'],
      ["123456789012345680000", '"123456789012345680000"'],
      ["5e-324", '"5e-324"'],
      ["1.7976931348623157e308", '"1.7976931348623157e+308"'],
      ["0x1fffffffffffff", '"9007199254740991"'],
      ["9007199254740993", '"9007199254740992"'],
      ["0.1e1", '"1"'],
      [".5", '"0.5"'],
      ["4.35", '"4.35"'],
      ["2.5e-7", '"2.5e-7"'],
    ];
    const code = keys.map(([number, text], i) => `export const k${i} = { ${number}: 1, ${text}: 2 };\n`).join("");
    const { raw, exitCode } = await lint({ "eslint.config.js": config({ "no-dupe-keys": "error" }), "a.js": code }, [
      "-f",
      "unix",
      "a.js",
    ]);
    const lines = raw.split("\n").filter(it => it.endsWith("[Error/no-dupe-keys]"));
    expect(lines.map(it => Number(/:(\d+):\d+: /.exec(it)?.[1]))).toEqual(keys.map((_, i) => i + 1));
    expect(exitCode).toBe(1);
  });

  // `a < b` is the order of the UTF-16 code units: "\u{10000}" is "𐀀". The package natural-compare reads digits as `+digits` does.
  test("strings are ordered as JavaScript does", async () => {
    const files = {
      "eslint.config.js": `export default [
  { files: ["units*.js"], rules: { "sort-keys": "error" } },
  { files: ["natural*.js"], rules: { "sort-keys": ["error", "asc", { natural: true }] } },
];\n`,
      "units.js": 'export default { "\\uD7FF": 1, "\\u{10000}": 2, "\\uDFFF": 3, "\\uE000": 4 };\n',
      "units-reversed.js": 'export default { "\\uDFFF": 1, "\\u{10000}": 2 };\n',
      // The two are the same number.
      "natural.js": "export default { a19007199254740993: 1, a19007199254740992: 2 };\n",
      "natural-reversed.js": "export default { a19007199254740996: 1, a19007199254740992: 2 };\n",
    };
    const { raw, exitCode } = await lint(files, ["-f", "unix", "."]);
    const reported = raw.split("\n").filter(it => it.endsWith("[Error/sort-keys]"));
    expect(reported.map(it => /([\w-]+\.js):\d+:\d+: /.exec(it)?.[1]).sort()).toEqual([
      "natural-reversed.js",
      "units-reversed.js",
    ]);
    expect(exitCode).toBe(1);
  });

  test("texts are collated as Intl.Collator does, outside of ASCII too", async () => {
    const files = {
      ".eslintrc.json": JSON.stringify({
        root: true,
        parser: "@typescript-eslint/parser",
        plugins: ["@typescript-eslint"],
        rules: { "@typescript-eslint/sort-type-constituents": "error" },
      }),
      "sorted.ts": 'export type T = "a2" | "a10" | "e" | "\u00C9" | "\u00E9" | "f" | "ss" | "\u00DF" | "z";\n',
      "accent.ts": 'export type T = "f" | "\u00E9";\n',
      "expansion.ts": 'export type T = "st" | "\u00DF";\n',
    };
    const { raw, exitCode } = await lint(files, ["-f", "unix", "sorted.ts", "accent.ts", "expansion.ts"]);
    const reported = raw.split("\n").filter(it => it.endsWith("[Error/@typescript-eslint/sort-type-constituents]"));
    expect(reported.map(it => /([\w-]+\.ts):\d+:\d+: /.exec(it)?.[1]).sort()).toEqual(["accent.ts", "expansion.ts"]);
    expect(exitCode).toBe(1);
  });
});

// What differs between Windows, macOS and Linux, for `bun lint`: how a path is written, which names are the same file, how a line
// ends, what a link is, what can be written. Nothing here is passed through `normalizeBunSnapshot`, which makes `/` of every `\`
// and `\n` of every `\r\n`: what is printed is compared as it is printed.
//
// A test that can only tell something on one system runs on all of them where it can: there it is a test that nothing else breaks.
describe("bun lint on Windows, macOS and Linux", () => {
  // What is printed must not depend on what the tests run in: `bun lint` looks at these.
  const env = {
    ...bunEnv,
    AGENT: "0",
    CLAUDECODE: undefined,
    REPL_ID: undefined,
    GITHUB_ACTIONS: undefined,
    GITHUB_WORKSPACE: undefined,
    NO_COLOR: "1",
    FORCE_COLOR: undefined,
    ESLINT_USE_FLAT_CONFIG: undefined,
  };

  // A drive letter that a test has taken would stay, for every process of the session, if the test ran out of time.
  const drives = new Set<string>();
  const subst = (...args: string[]) => Bun.spawnSync({ cmd: ["subst", ...args] }).exitCode === 0;
  afterAll(() => {
    endChildren();
    for (const drive of drives) subst(drive, "/D");
  });

  /** `subst` gives `directory` a drive letter, for as long as `use` runs. */
  async function withDrive(directory: string, use: (drive: string) => Promise<void>) {
    const drive = [..."PONMLKJIHG"]
      .map(letter => `${letter}:`)
      .find(drive => !existsSync(`${drive}\\`) && subst(drive, directory));
    if (drive === undefined) throw new Error("No drive letter is free.");
    drives.add(drive);
    try {
      await use(drive);
    } finally {
      subst(drive, "/D");
      drives.delete(drive);
    }
  }
  const slow = isDebug || isASAN;

  type Options = { stdin?: string; env?: Record<string, string | undefined>; before?: string[] };

  /** Runs `bun <args>` in `cwd`. What it prints is returned as it is. */
  async function bun(cwd: string | { toString(): string }, args: string[], options: Options = {}) {
    const proc = spawn({
      cmd: [...(options.before ?? []), bunExe(), ...args],
      env: { ...env, ...options.env },
      cwd: String(cwd),
      stdin: options.stdin === undefined ? "ignore" : Buffer.from(options.stdin),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  const lint = (cwd: string | { toString(): string }, args: string[], options?: Options) =>
    bun(cwd, ["lint", "--threads", "2", ...args], options);

  /** As ESLint, without a configuration file: to run one takes a process. */
  const eslint = ["--no-config-lookup", "--rule", "no-debugger: error"];
  /** As oxlint. */
  const oxlintrc = (more: object = {}) =>
    JSON.stringify({ categories: { correctness: "off" }, rules: { "no-debugger": "error" }, ...more });

  /** The files that are reported about in ESLint's `json`, from `dir`, with `/`. That they are printed otherwise has a test. */
  const reported = (stdout: string, dir: { toString(): string }) =>
    (JSON.parse(stdout) as { filePath: string; messages: unknown[] }[])
      .filter(it => it.messages.length > 0)
      .map(it => it.filePath.slice(String(dir).length + 1).replaceAll(sep, "/"))
      .sort();
  /** The same for oxlint's `json`, which has the path from the working directory. */
  const reportedToOxlint = (stdout: string) =>
    [...new Set((JSON.parse(stdout).diagnostics as { filename: string }[]).map(it => it.filename))].sort();

  const swapCase = (text: string) =>
    text.replace(/[a-z]/gi, letter => (letter === letter.toLowerCase() ? letter.toUpperCase() : letter.toLowerCase()));
  /** All names in `dir`, directories too, from `dir`, with `/`. */
  const everythingIn = (dir: { toString(): string }) =>
    (readdirSync(String(dir), { recursive: true }) as string[]).map(it => it.replaceAll(sep, "/")).sort();

  /** Sets and reads an extended attribute of a file, where a file in the temporary directory takes one. */
  const attributes = (() => {
    if (!isLinux && !isMacOS) return undefined;
    const c = (text: string) => Buffer.from(`${text}\0`);
    // macOS has a position in the attribute before the flags.
    const ofMacOS = () => {
      const { symbols } = dlopen("libSystem.B.dylib", {
        setxattr: { args: ["ptr", "ptr", "ptr", "u64", "u32", "i32"], returns: "i32" },
        getxattr: { args: ["ptr", "ptr", "ptr", "u64", "u32", "i32"], returns: "i64" },
      });
      return {
        set: (path: string, name: string, value: Buffer) =>
          symbols.setxattr(c(path), c(name), value, value.length, 0, 0),
        get: (path: string, name: string, into: Buffer) => symbols.getxattr(c(path), c(name), into, into.length, 0, 0),
      };
    };
    const ofLinux = () => {
      const machine = process.arch === "arm64" ? "aarch64" : "x86_64";
      const { symbols } = dlopen(isMusl ? `libc.musl-${machine}.so.1` : "libc.so.6", {
        setxattr: { args: ["ptr", "ptr", "ptr", "u64", "i32"], returns: "i32" },
        getxattr: { args: ["ptr", "ptr", "ptr", "u64"], returns: "i64" },
      });
      return {
        set: (path: string, name: string, value: Buffer) => symbols.setxattr(c(path), c(name), value, value.length, 0),
        get: (path: string, name: string, into: Buffer) => symbols.getxattr(c(path), c(name), into, into.length),
      };
    };
    const { set, get } = isMacOS ? ofMacOS() : ofLinux();
    const all = {
      set: (path: string, name: string, value: string) => set(path, name, Buffer.from(value)) === 0,
      get(path: string, name: string) {
        const into = Buffer.alloc(256);
        const length = Number(get(path, name, into));
        return length < 0 ? null : into.toString("utf8", 0, length);
      },
    };
    using dir = tempDir("bun-attributes", { "a": "" });
    return all.set(join(String(dir), "a"), "user.tag", "a") ? all : undefined;
  })();

  const BOM = "\uFEFF";
  const crlf = (text: string) => text.replaceAll("\n", "\r\n");

  describe.concurrent("how a path is written", () => {
    // `filePath` of a result is `path.resolve(..)`: lib/eslint/eslint-helpers.js, `findFiles`.
    test("ESLint's formats print a path as the system writes it", async () => {
      using dir = tempDir("bun-lint-platform", { "src/deep/a.js": "debugger;\n" });
      const path = join(String(dir), "src", "deep", "a.js");
      const [stylish, unix, json, listed] = await Promise.all([
        lint(dir, [...eslint, "-f", "stylish", "src"]),
        lint(dir, [...eslint, "-f", "unix", "src"]),
        lint(dir, [...eslint, "-f", "json", "src"]),
        lint(dir, [...eslint, "--list-files", "src"]),
      ]);
      expect({
        stylish: stylish.stdout.trimStart().split("\n")[0],
        unix: unix.stdout.split("\n")[0],
        json: JSON.parse(json.stdout)[0].filePath,
        listed: listed.stdout,
      }).toEqual({
        stylish: path,
        unix: `${path}:1:1: Unexpected 'debugger' statement. [Error/no-debugger]`,
        json: path,
        listed: `${path}\n`,
      });
    });

    // crates/oxc_diagnostics/src/service.rs: `relative_path.cow_replace('\\', "/")`
    test("oxlint's formats, and those of Bun, print the path from the working directory with `/`", async () => {
      using dir = tempDir("bun-lint-platform", { ".oxlintrc.json": oxlintrc(), "src/deep/a.js": "debugger;\n" });
      const formats = ["json", "unix", "checkstyle", "junit", "gitlab", "sarif", "github", "pretty", "agent"];
      const printed = await Promise.all(formats.map(format => lint(dir, ["-f", format])));
      expect(
        printed.map((it, index) => [formats[index], it.stdout.includes("src/deep/a.js"), /src\\+deep/.test(it.stdout)]),
      ).toEqual(formats.map(format => [format, true, false]));
    });

    test("a line of what is printed ends with \\n", async () => {
      using dir = tempDir("bun-lint-platform", { "a.js": "debugger;\n" });
      const results = await Promise.all([
        lint(dir, [...eslint, "-f", "stylish"]),
        lint(dir, [...eslint, "-f", "unix", "-o", join("reports", "deep", "lint.txt")]),
      ]);
      const written = readFileSync(join(String(dir), "reports", "deep", "lint.txt"), "utf8");
      expect(written).toEndWith("[Error/no-debugger]\n\n1 problem");
      expect(
        [results[0].stdout, results[0].stderr, results[1].stderr, written].filter(it => it.includes("\r")),
      ).toEqual([]);
    });

    test("arguments can be written as the system writes paths", async () => {
      using dir = tempDir("bun-lint-platform", {
        "a.js": "debugger;\n",
        "src/b.js": "debugger;\n",
        "lib/c.js": "debugger;\n",
        "pkg/one/d.js": "debugger;\n",
        "pkg/one/e.mjs": "debugger;\n",
        "deep/dir/f.js": "debugger;\n",
        "other/g.js": "debugger;\n",
      });
      const args = [join("src", "b.js"), `.${sep}lib`, join("pkg", "**", "*.js"), join("deep", "dir") + sep];
      const absolute = [join(String(dir), "src", "b.js"), join(String(dir), "deep") + sep];
      const [relative, fromRoot] = await Promise.all([
        lint(dir, [...eslint, "-f", "json", ...args]),
        lint(dir, [...eslint, "-f", "json", ...absolute]),
      ]);
      expect({ relative: reported(relative.stdout, dir), fromRoot: reported(fromRoot.stdout, dir) }).toEqual({
        relative: ["deep/dir/f.js", "lib/c.js", "pkg/one/d.js", "src/b.js"],
        fromRoot: ["deep/dir/f.js", "src/b.js"],
      });
    });

    test("arguments that lead out of the working directory", async () => {
      using dir = tempDir("bun-lint-platform", {
        ".oxlintrc.json": oxlintrc(),
        "a.js": "debugger;\n",
        "lib/c.js": "debugger;\n",
        "pkg/one/d.js": "debugger;\n",
      });
      const { stdout } = await lint(join(String(dir), "pkg", "one"), [
        "-f",
        "json",
        join("..", "..", "lib"),
        `..${sep}..${sep}a.js`,
      ]);
      // crates/oxc_diagnostics/src/service.rs: `path.strip_prefix(cwd).unwrap_or(path)`. What is not in the working directory keeps
      // its whole path. (oxlint itself refuses an argument with `..`. It prints this for the same files, named from the root.)
      const whole = (...names: string[]) => join(String(dir), ...names).replaceAll("\\", "/");
      expect(reportedToOxlint(stdout)).toEqual([whole("a.js"), whole("lib", "c.js")]);
    });

    test("so can the paths that flags take", async () => {
      using dir = tempDir("bun-lint-platform", {
        "configs/mine.json": oxlintrc({ overrides: [{ files: ["src/*.js"], rules: { "no-debugger": "off" } }] }),
        // The patterns of a file that -c names are from its directory.
        "configs/src/off.js": "debugger;\n",
        "configs/ignored": "skipped.js\n",
        "src/a.js": "debugger;\n",
        "src/skipped.js": "debugger;\n",
      });
      const forms = [
        join("configs", "mine.json"),
        join(String(dir), "configs", "mine.json"),
        `.${sep}configs${sep}mine.json`,
      ];
      const results = await Promise.all(
        forms.map(config => lint(dir, ["-c", config, "--ignore-path", join("configs", "ignored"), "-f", "json"])),
      );
      expect(results.map(it => reportedToOxlint(it.stdout))).toEqual(forms.map(() => ["src/a.js"]));
      const [before, after] = await Promise.all([
        bun(dir, [`--cwd=${join(String(dir), "src")}`, "lint", ...eslint, "-f", "json"]),
        lint(dir, ["--cwd", join("src") + sep, ...eslint, "-f", "json"]),
      ]);
      expect([reported(before.stdout, dir), reported(after.stdout, dir)]).toEqual([
        ["src/a.js", "src/skipped.js"],
        ["src/a.js", "src/skipped.js"],
      ]);
    });

    test("--stdin-filename", async () => {
      using dir = tempDir("bun-lint-platform", {
        ".oxlintrc.json": oxlintrc({ rules: {} }),
        "src/.oxlintrc.json": oxlintrc(),
      });
      const path = join(String(dir), "src", "new.js");
      const asEslint = await Promise.all(
        [join("src", "new.js"), path].map(name =>
          lint(dir, [...eslint, "--stdin", "--stdin-filename", name, "-f", "json"], { stdin: "debugger;\n" }),
        ),
      );
      expect(asEslint.map(it => JSON.parse(it.stdout)[0].filePath)).toEqual([path, path]);
      // The name decides which configuration file counts.
      const asOxlint = await Promise.all(
        [join("src", "new.js"), path, "new.js"].map(name =>
          lint(dir, ["--stdin", "--stdin-filename", name, "-f", "json"], { stdin: "debugger;\n" }),
        ),
      );
      expect(asOxlint.map(it => reportedToOxlint(it.stdout))).toEqual([["src/new.js"], ["src/new.js"], []]);
    });

    // lib/services/suppressions-service.js, `getRelativeFilePath`: `.split(path.sep).join(path.posix.sep)`. The file is checked in.
    test("eslint-suppressions.json has `/`, whoever writes it", async () => {
      using dir = tempDir("bun-lint-platform", { "src/deep/a.js": "debugger;\n", "b.js": "debugger;\n" });
      const written = await lint(dir, [...eslint, "--suppress-all"]);
      expect(JSON.parse(readFileSync(join(String(dir), "eslint-suppressions.json"), "utf8"))).toEqual({
        "b.js": { "no-debugger": { count: 1 } },
        "src/deep/a.js": { "no-debugger": { count: 1 } },
      });
      expect(written.exitCode).toBe(0);
      const applied = await lint(dir, [...eslint, "-f", "json", join("src", "deep", "a.js")]);
      expect(JSON.parse(applied.stdout).map((it: any) => [it.messages.length, it.suppressedMessages.length])).toEqual([
        [0, 1],
      ]);
      expect(applied.exitCode).toBe(0);
    });

    test("-f github counts from GITHUB_WORKSPACE, which is written as the system writes paths", async () => {
      using dir = tempDir("bun-lint-platform", { "packages/a/src/b.js": "debugger;\n" });
      const { stdout } = await lint(join(String(dir), "packages", "a"), [...eslint, "-f", "github"], {
        env: { GITHUB_WORKSPACE: String(dir) },
      });
      expect(stdout).toStartWith("::error file=packages/a/src/b.js,line=1,col=1,");
    });

    // What a URL would take for something else: the file is imported by its URL.
    test(
      "a project in a directory with blanks, `#`, `%41` and letters that are not ASCII",
      async () => {
        using dir = tempDir("bun lint #1 %41 é 日本", {
          "eslint.config.mjs": `import plugin from "./my plugins/p#1.mjs";
          export default [{ ignores: ["my plugins/"] }, { plugins: { p: plugin }, rules: { "p/r": "error", "no-debugger": "error" } }];`,
          "my plugins/p#1.mjs": `export default { rules: { r: { create: context => ({ Identifier: node => context.report({ node, message: "found" }) }) } } };`,
          "sources é/ü 100%.js": "debugger; a;\n",
        });
        const { stdout, stderr } = await lint(dir, ["-f", "json", "sources é"]);
        expect(stderr).not.toContain("error");
        expect(JSON.parse(stdout).map((it: any) => [it.filePath, it.messages.map((it: any) => it.ruleId)])).toEqual([
          [join(String(dir), "sources é", "ü 100%.js"), ["no-debugger", "p/r"]],
        ]);
      },
      slow ? 120_000 : undefined,
    );

    test("rules that need types, with a project that is named as the system writes paths", async () => {
      const compilerOptions = { strict: true, noEmit: true, types: [], lib: ["esnext"] };
      using dir = tempDir("bun-lint-platform", {
        ".oxlintrc.json": oxlintrc({ rules: { "typescript/no-floating-promises": "error" } }),
        "packages/a/tsconfig.json": JSON.stringify({ compilerOptions, include: ["src"] }),
        "packages/a/src/deep/b.ts": `import { later } from "../c";\nlater();\n`,
        "packages/a/src/c.ts": "export async function later() {}\n",
      });
      const results = await Promise.all([
        lint(dir, ["--type-aware", "-f", "json"]),
        lint(dir, ["--type-aware", "-f", "json", join("packages", "a", "src", "deep", "b.ts")]),
        lint(dir, ["--type-aware", "-f", "json", "--tsconfig", join("packages", "a", "tsconfig.json")]),
        lint(dir, ["--type-aware", "-f", "json", "--tsconfig", join(String(dir), "packages", "a", "tsconfig.json")]),
      ]);
      expect(results.map(it => reportedToOxlint(it.stdout))).toEqual(results.map(() => ["packages/a/src/deep/b.ts"]));
    });

    // `subst` gives the directory a drive letter.
    test.skipIf(!isWindows)("a project at the root of a drive", async () => {
      using dir = tempDir("bun-lint-platform", {
        ".oxlintrc.json": oxlintrc(),
        "a.js": "debugger;\n",
        "sub/b.js": "debugger;\n",
      });
      await withDrive(realpathSync(String(dir)), async drive => {
        const [from, root, directory, file, asEslint] = await Promise.all([
          lint(`${drive}\\`, ["-f", "json"]),
          lint(dir, ["-f", "json", `${drive}\\`]),
          lint(dir, ["-f", "json", `${drive}\\sub`]),
          lint(`${drive}\\sub`, ["-f", "json", `${drive}\\a.js`]),
          lint(`${drive}\\`, [...eslint, "-f", "json"]),
        ]);
        expect({
          from: reportedToOxlint(from.stdout),
          root: reportedToOxlint(root.stdout).map(it => it.slice(it.indexOf(":") + 1)),
          directory: reportedToOxlint(directory.stdout).map(it => it.slice(it.indexOf(":") + 1)),
          file: reportedToOxlint(file.stdout),
          asEslint: JSON.parse(asEslint.stdout).map((it: any) => it.filePath),
        }).toEqual({
          from: ["a.js", "sub/b.js"],
          root: ["/a.js", "/sub/b.js"],
          directory: ["/sub/b.js"],
          file: [`${drive}/a.js`],
          asEslint: [`${drive}\\a.js`, `${drive}\\sub\\b.js`],
        });
      });
    });

    // The administrative share of the drive, as in test/js/node/fs/cp.test.ts. The same for `\\wsl.localhost\..` and the shared
    // folders of a virtual machine.
    test.skipIf(!isWindows)("a project on a network share", async () => {
      using dir = tempDir("bun-lint-platform", { ".oxlintrc.json": oxlintrc(), "src/a.js": "debugger;\n" });
      const real = realpathSync(String(dir));
      const share = `\\\\localhost\\${real[0]}$\\${real.slice(3)}`;
      const [from, named, asEslint] = await Promise.all([
        lint(share, ["-f", "json"]),
        lint(dir, ["-f", "json", `${share}\\src`]),
        lint(share, [...eslint, "-f", "json"]),
      ]);
      expect(reportedToOxlint(from.stdout)).toEqual(["src/a.js"]);
      expect(reportedToOxlint(named.stdout).map(it => it.slice(-"/src/a.js".length))).toEqual(["/src/a.js"]);
      expect(JSON.parse(asEslint.stdout).map((it: any) => it.filePath)).toEqual([`${share}\\src\\a.js`]);
    });

    // `path.relative()` of Windows takes `c:\A` and `C:\a` for the same. An editor hands out `c:\..`, a shell `C:\..`.
    test.skipIf(!isWindows)(
      "a path whose drive and directories are written in the other case is in the project",
      async () => {
        using dir = tempDir("bun-lint-platform", {
          "configs/mine.json": oxlintrc(),
          ".gitignore": "ignored.js\n",
          "src/a.js": "debugger;\n",
          "src/ignored.js": "debugger;\n",
        });
        const other = swapCase(String(dir));
        const [file, directory] = await Promise.all([
          lint(dir, ["-c", join("configs", "mine.json"), "-f", "json", join(other, "src", "a.js")]),
          lint(dir, ["-c", join("configs", "mine.json"), "-f", "json", join(other, "src")]),
        ]);
        expect(reportedToOxlint(file.stdout)).toEqual(["src/a.js"]);
        expect(reportedToOxlint(directory.stdout)).toEqual(["src/a.js"]);
      },
    );

    // `path.resolve("\\proj\\a.js")` is on the drive of the working directory.
    test.skipIf(!isWindows)("a path from the root of the drive", async () => {
      using dir = tempDir("bun-lint-platform", {
        ".oxlintrc.json": oxlintrc(),
        ".gitignore": "ignored.js\n",
        "src/a.js": "debugger;\n",
        "src/ignored.js": "debugger;\n",
      });
      const rooted = realpathSync(String(dir)).slice(2);
      const [asOxlint, asEslint] = await Promise.all([
        lint(dir, ["-f", "json", join(rooted, "src")]),
        lint(dir, [...eslint, "-f", "json", join(rooted, "src", "a.js")]),
      ]);
      expect(reportedToOxlint(asOxlint.stdout)).toEqual(["src/a.js"]);
      expect(JSON.parse(asEslint.stdout).map((it: any) => [it.filePath, it.messages.length])).toEqual([
        [join(realpathSync(String(dir)), "src", "a.js"), 1],
      ]);
    });
  });

  describe.concurrent("which names are the same file", () => {
    test("a file that is named in the other case is linted if the system finds it, and once for each way it is written", async () => {
      using dir = tempDir("bun-lint-platform", { "src/Button.js": "var a = 1\nexport { a }\n" });
      const foldsCase = existsSync(join(String(dir), "SRC", "bUTTON.JS"));
      const rules = ["--no-config-lookup", "--rule", "semi: error"];
      const { stdout, exitCode } = await lint(dir, [
        ...rules,
        "--fix",
        "-f",
        "json",
        "--no-error-on-unmatched-pattern",
        join("src", "Button.js"),
        join("SRC", "bUTTON.JS"),
      ]);
      // As ESLint, to which a path is text.
      expect(JSON.parse(stdout).map((it: any) => it.filePath)).toEqual(
        foldsCase
          ? [join(String(dir), "SRC", "bUTTON.JS"), join(String(dir), "src", "Button.js")]
          : [join(String(dir), "src", "Button.js")],
      );
      expect(exitCode).toBe(0);
      expect(everythingIn(dir)).toEqual(["src", "src/Button.js"]);
      expect(readFileSync(join(String(dir), "src", "Button.js"), "utf8")).toBe("var a = 1;\nexport { a };\n");
    });

    // lib/config/config-loader.js looks with `findUp`, which asks the system for a file of that name. (oxlint lists the directory
    // and compares the names: `find_unique_config_by_readdir`.)
    test(
      "an eslint.config.js whose name is written in other capitals counts where the system finds it",
      async () => {
        using dir = tempDir("bun-lint-platform", {
          "eslint.config.cjs": `module.exports = [{ rules: {} }];`,
          "a.js": "debugger;\n",
          "packages/p/ESLint.Config.cjs": `module.exports = [{ rules: { "no-debugger": "error" } }];`,
          "packages/p/b.js": "debugger;\n",
        });
        const foldsCase = existsSync(join(String(dir), "packages", "p", "eslint.config.cjs"));
        // Come to by way of its directory, and asked for.
        const [walked, named] = await Promise.all([
          lint(dir, ["-f", "json"]),
          lint(dir, ["-f", "json", join("packages", "p", "b.js")]),
        ]);
        const expected = foldsCase ? ["packages/p/b.js"] : [];
        expect([reported(walked.stdout, dir), reported(named.stdout, dir)]).toEqual([expected, expected]);
      },
      slow ? 120_000 : undefined,
    );

    // macOS finds `é` whether it is written as one character or as `e` and an accent.
    test("a file that is named in the other normalization form is linted if the system finds it", async () => {
      using dir = tempDir("bun-lint-platform", { ["caf\u00e9.js"]: "debugger;\n" });
      const decomposed = "cafe\u0301.js";
      const isFound = existsSync(join(String(dir), decomposed));
      const [named, walked] = await Promise.all([
        lint(dir, [...eslint, "-f", "json", "--no-error-on-unmatched-pattern", decomposed]),
        lint(dir, [...eslint, "-f", "json"]),
      ]);
      expect(JSON.parse(named.stdout).map((it: any) => it.messages.length)).toEqual(isFound ? [1] : []);
      expect(JSON.parse(walked.stdout).map((it: any) => it.filePath.normalize("NFC"))).toEqual([
        join(String(dir), "caf\u00e9.js"),
      ]);
    });
  });

  describe.concurrent("how a line ends, and what a file starts with", () => {
    // What is expected is what ESLint 10.12.0 reports.
    const source = `var a = 1
if (a == 2) {
  debugger
}
// eslint-disable-next-line no-debugger
debugger;
/* eslint-disable
   no-var */
var b = \`x
y\`;



foo(b)
`;
    const rules = [
      "no-debugger: error",
      "no-var: error",
      "semi: error",
      "eqeqeq: error",
      "no-multiple-empty-lines: [error, { max: 1 }]",
      "linebreak-style: [error, windows]",
      "no-trailing-spaces: error",
      "max-len: [error, 20]",
    ].flatMap(rule => ["--rule", rule]);
    const places = (stdout: string) =>
      JSON.parse(stdout)[0]
        .messages.map((it: any) => `${it.line}:${it.column}-${it.endLine}:${it.endColumn} ${it.ruleId}`)
        .sort();

    test("\\r\\n: lines, columns, comments that disable rules, and fixes", async () => {
      using dir = tempDir("bun-lint-platform", { "a.js": crlf(source), "b.js": crlf(source) });
      const [found, fixed] = await Promise.all([
        lint(dir, ["--no-config-lookup", ...rules, "-f", "json", "a.js"]),
        lint(dir, ["--no-config-lookup", ...rules, "--fix", "-f", "json", "b.js"]),
      ]);
      expect(places(found.stdout)).toEqual(
        [
          "1:1-1:10 no-var",
          "1:10-2:1 semi",
          "2:7-2:9 eqeqeq",
          "3:3-3:11 no-debugger",
          "3:11-4:1 semi",
          "5:1-5:40 max-len",
          "12:1-14:1 no-multiple-empty-lines",
          "14:7-15:1 semi",
        ].sort(),
      );
      expect(JSON.parse(found.stdout)[0].suppressedMessages.length).toBe(2);
      expect(readFileSync(join(String(dir), "b.js"), "utf8")).toBe(
        crlf(
          source
            .replace("var a = 1", "let a = 1;")
            .replace("  debugger", "  debugger;")
            .replace("\n\n\n\nfoo(b)", "\n\nfoo(b);"),
        ),
      );
      expect(fixed.exitCode).toBe(1);
    });

    test("a byte order mark is not a column, and stays where it is", async () => {
      using dir = tempDir("bun-lint-platform", { "a.js": `${BOM}debugger\r\nvar a\r\n`, "b.js": `${BOM}debugger\n` });
      const some = ["no-debugger: error", "semi: error"].flatMap(rule => ["--rule", rule]);
      const { stdout } = await lint(dir, ["--no-config-lookup", ...some, "--fix", "-f", "json", "a.js"]);
      expect(places(stdout)).toEqual(["1:1-1:10 no-debugger"]);
      expect(readFileSync(join(String(dir), "a.js"), "utf8")).toBe(`${BOM}debugger;\r\nvar a;\r\n`);
      const removed = await lint(dir, ["--no-config-lookup", "--rule", "unicode-bom: error", "--fix", "b.js"]);
      expect(readFileSync(join(String(dir), "b.js"), "utf8")).toBe("debugger\n");
      expect(removed.exitCode).toBe(0);
    });

    // What oxlint 1.87.0 prints: its columns are bytes from the start of the line, and the mark is three.
    test("to oxlint a byte order mark is three columns", async () => {
      using dir = tempDir("bun-lint-platform", {
        ".oxlintrc.json": oxlintrc(),
        "a.js": `${BOM}debugger; debugger;\ndebugger;\n`,
      });
      const [unix, json] = await Promise.all([lint(dir, ["-f", "unix"]), lint(dir, ["-f", "json"])]);
      expect(unix.stdout.split("\n").flatMap(line => /^a\.js:\d+:\d+/.exec(line) ?? [])).toEqual([
        "a.js:1:4",
        "a.js:1:14",
        "a.js:2:1",
      ]);
      expect(JSON.parse(json.stdout).diagnostics.map((it: any) => it.labels[0].span)).toEqual([
        { offset: 3, length: 9, line: 1, column: 4 },
        { offset: 13, length: 9, line: 1, column: 14 },
        { offset: 23, length: 9, line: 2, column: 1 },
      ]);
    });

    test("\\r\\n and a byte order mark in configuration files", async () => {
      const legacy = { root: true, rules: { "no-debugger": "error" }, ignorePatterns: ["ignored.js"] };
      const files = { "a.js": "debugger;\n", "ignored.js": "debugger;\n" };
      const configs: Record<string, string>[] = [
        { ".oxlintrc.json": crlf(JSON.stringify(JSON.parse(oxlintrc({ ignorePatterns: ["ignored.js"] })), null, 2)) },
        { ".eslintrc.json": crlf(JSON.stringify(legacy, null, 2)) },
        { ".eslintrc.json": BOM + JSON.stringify(legacy) },
        { ".eslintrc.yml": crlf("root: true\nrules:\n  no-debugger: error\nignorePatterns:\n  - ignored.js\n") },
        { "package.json": crlf(JSON.stringify({ eslintConfig: legacy }, null, 2)) },
      ];
      const results = await Promise.all(
        configs.map(async config => {
          using dir = tempDir("bun-lint-platform", { ...files, ...config });
          const { stdout, exitCode } = await lint(dir, ["-f", "unix", "."]);
          return [
            stdout.split("\n").filter(line => line.includes("debugger")).length,
            stdout.includes("ignored.js"),
            exitCode,
          ];
        }),
      );
      expect(results).toEqual(configs.map(() => [1, false, 1]));
    });
  });

  describe.concurrent("links", () => {
    // A junction needs no privilege on Windows. Elsewhere the third argument says nothing, and it is a link to a directory.
    const link = (target: string, path: string) => symlinkSync(target, path, "junction");

    test("oxlint follows a link to a directory, ESLint does not, and --fix writes a file once that is reached by two paths", async () => {
      const files: Record<string, string> = {};
      for (let i = 0; i < 16; i++) files[`real/${i}.js`] = "var a = 1;\nexport { a };\ndebugger;\n";
      using forOxlint = tempDir("bun-lint-platform", {
        ...files,
        ".oxlintrc.json": oxlintrc({ rules: { "no-var": "error", "no-debugger": "error" } }),
      });
      using forEslint = tempDir("bun-lint-platform", files);
      for (const dir of [forOxlint, forEslint]) link(join(String(dir), "real"), join(String(dir), "linked"));
      const [asOxlint, asEslint] = await Promise.all([
        lint(forOxlint, ["--threads", "8", "--fix", "-f", "json"]),
        lint(forEslint, [...eslint, "-f", "json"]),
      ]);
      expect(asOxlint.stderr).not.toContain("Cannot write");
      expect(reportedToOxlint(asOxlint.stdout).length).toBe(32);
      expect(reported(asEslint.stdout, forEslint).length).toBe(16);
      expect(everythingIn(join(String(forOxlint), "real")).length).toBe(16);
      for (let i = 0; i < 16; i++) {
        expect(readFileSync(join(String(forOxlint), "real", `${i}.js`), "utf8")).not.toStartWith("var ");
      }
    });

    test("a link that leads nowhere is passed over", async () => {
      using dir = tempDir("bun-lint-platform", { ".oxlintrc.json": oxlintrc(), "a.js": "debugger;\n" });
      link(join(String(dir), "nowhere"), join(String(dir), "b.js"));
      link(join(String(dir), "nowhere"), join(String(dir), "c"));
      const { stdout, exitCode } = await lint(dir, ["-f", "json"]);
      expect(reportedToOxlint(stdout)).toEqual(["a.js"]);
      expect(exitCode).toBe(1);
    });
  });

  describe.concurrent("what --fix writes", () => {
    const fixable = "var a = 1\nexport { a }\n";
    const fixed = "var a = 1;\nexport { a };\n";
    const semi = ["--no-config-lookup", "--rule", "semi: error"];

    test("nothing but the file is left", async () => {
      using dir = tempDir("bun-lint-platform", { "a.js": fixable, "src/b.js": fixable, "src/c.js": fixed });
      const before = everythingIn(dir);
      const { exitCode } = await lint(dir, [...semi, "--fix"]);
      expect(everythingIn(dir)).toEqual(before);
      expect(readFileSync(join(String(dir), "src", "b.js"), "utf8")).toBe(fixed);
      expect(exitCode).toBe(0);
    });

    // A file that takes the name of another has none of its tags, nor its ACL. ESLint writes into every file.
    test.skipIf(attributes === undefined)("a file keeps its extended attributes", async () => {
      using dir = tempDir("bun-lint-platform", { "tagged.js": fixable, "plain.js": fixable });
      const [tagged, plain] = ["tagged.js", "plain.js"].map(name => join(String(dir), name));
      expect(attributes!.set(tagged, "user.tag", "hello")).toBe(true);
      const before = [tagged, plain].map(path => statSync(path).ino);
      const { exitCode } = await lint(dir, [...semi, "--fix"]);
      expect([tagged, plain].map(path => readFileSync(path, "utf8"))).toEqual([fixed, fixed]);
      expect(attributes!.get(tagged, "user.tag")).toBe("hello");
      expect(statSync(tagged).ino).toBe(before[0]);
      // What the system gives every file, as a label of SELinux, is no reason to write in place.
      if (isLinux) expect(statSync(plain).ino).not.toBe(before[1]);
      expect(everythingIn(dir)).toEqual(["plain.js", "tagged.js"]);
      expect(exitCode).toBe(0);
    });

    // As `fopen` of the C runtime opens a file, and so Python and many editors: others may read and write it, and not rename or
    // delete it. ESLint writes into it.
    test.skipIf(!isWindows)("a file that another program has open", async () => {
      using dir = tempDir("bun-lint-platform", { "a.js": fixable });
      const { symbols, close } = dlopen("kernel32.dll", {
        CreateFileW: { args: ["ptr", "u32", "u32", "ptr", "u32", "u32", "ptr"], returns: "u64" },
        CloseHandle: { args: ["u64"], returns: "i32" },
      });
      const [GENERIC_READ, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING] = [0x80000000, 1, 2, 3];
      const name = Buffer.from(`${join(String(dir), "a.js")}\0`, "utf16le");
      const handle = symbols.CreateFileW(
        name,
        GENERIC_READ,
        FILE_SHARE_READ | FILE_SHARE_WRITE,
        null,
        OPEN_EXISTING,
        0,
        null,
      );
      // `INVALID_HANDLE_VALUE`: without the handle the test would pass whatever is done.
      expect(handle).not.toBe(0xffffffffffffffffn);
      try {
        const { stderr, exitCode } = await lint(dir, [...semi, "--fix", "a.js"]);
        expect(stderr).not.toContain("Cannot write");
        expect(readFileSync(join(String(dir), "a.js"), "utf8")).toBe(fixed);
        expect(everythingIn(dir)).toEqual(["a.js"]);
        expect(exitCode).toBe(0);
      } finally {
        symbols.CloseHandle(handle);
        close();
      }
    });
  });

  describe.concurrent("a configuration file that is a program", () => {
    const timeout = slow ? 240_000 : 30_000;
    const rules = `export default [{ rules: { "no-debugger": "error", "no-var": "warn" } }];`;
    test.each([
      ["exports a configuration", rules, true, 1],
      ["prints", `console.log("out"); console.error("err"); process.emitWarning("old"); ${rules}`, true, 1],
      ["leaves a timer behind", `setInterval(() => {}, 1000); ${rules}`, true, 1],
      // ESLint goes on, too.
      ["sets process.exitCode", `process.exitCode = 5; ${rules}`, true, 1],
      ["exports what no configuration can have", `export default [{ nonsense: 1 }];`, true, 2],
      [
        "exports options that a rule does not take",
        `export default [{ rules: { "no-debugger": ["error", 1] } }];`,
        true,
        2,
      ],
      [
        "exports a rule that is not built in",
        `export default [{ rules: { "no-var": 2, "not-built-in": 2 } }];`,
        true,
        2,
      ],
      ["exports nothing to lint with", `export default [];`, true, 0],
      ["throws", `console.error("before"); throw new Error("boom");`, false, 2],
      ["exports a promise that is rejected", `export default Promise.reject(new Error("rejected"));`, false, 2],
      ["leaves", `process.exit(0);`, false, 2],
      ["leaves with an error, and without a word", `process.exit(3);`, false, 2],
    ])(
      "one that %s",
      async (_, config, isLoaded, exitCode) => {
        using dir = tempDir("bun-lint-platform", {
          "node_modules/.keep": "",
          "eslint.config.mjs": config,
          "a.js": "debugger;\nvar a;\n",
        });
        const result = await lint(dir, ["a.js"]);
        // What it prints is seen only if it fails.
        expect(result.stdout + result.stderr).not.toMatch(/\bout\b|\berr\b|\bold\b/);
        if (!isLoaded) expect(result.stderr).toMatch(/eslint\.config\.mjs:\r?\n./);
        expect(everythingIn(dir)).toEqual(["a.js", "eslint.config.mjs", "node_modules", "node_modules/.keep"]);
        expect(result.exitCode).toBe(exitCode);
      },
      timeout,
    );

    // `timeout 10 bun lint`, an editor that ends what it has started, a step of CI that is cancelled.
    test.each([
      ["waits", "await new Promise(() => setInterval(() => {}, 1000));"],
      // Elsewhere the end of the parent is an event, and a loop that never turns gets none.
      ...(isLinux ? [["spins", "for (;;);"]] : []),
    ])(
      "the process that runs one that %s for ever ends with bun lint, however that ends",
      async (_, forever) => {
        using dir = tempDir("bun-lint-platform", {
          "eslint.config.mjs": `import { writeFileSync } from "node:fs";
            writeFileSync(new URL("./pid.txt", import.meta.url), String(process.pid));
            ${forever}
            export default [];`,
          "a.js": "a;\n",
        });
        const deadline = Date.now() + (slow ? 60_000 : 15_000);
        const until = async (condition: () => boolean) => {
          while (!condition() && Date.now() < deadline) await new Promise(resolve => setImmediate(resolve));
          return condition();
        };
        const isRunning = (pid: number) => {
          try {
            // One that has ended, and that nobody has asked about yet, still has its number.
            if (isLinux) return !/^\d+ \(.*\) Z /s.test(readFileSync(`/proc/${pid}/stat`, "utf8"));
            process.kill(pid, 0);
            return true;
          } catch {
            return false;
          }
        };
        const proc = spawn({ cmd: [bunExe(), "lint"], env, cwd: String(dir), stdout: "ignore", stderr: "ignore" });
        const file = join(String(dir), "pid.txt");
        expect(await until(() => existsSync(file) && readFileSync(file, "utf8") !== "")).toBe(true);
        const pid = Number(readFileSync(file, "utf8"));
        try {
          expect(isRunning(pid)).toBe(true);
          proc.kill("SIGKILL");
          await proc.exited;
          expect(await until(() => !isRunning(pid))).toBe(true);
        } finally {
          if (isRunning(pid)) process.kill(pid, "SIGKILL");
        }
      },
      timeout,
    );

    // It is handed to the process as an argument. The command line of a process has at most 32,767 characters on Windows, with the
    // path of the executable, that of the configuration file, and a `\` before every `"`. Elsewhere there is room for four times that.
    test("the scripts that run one fit on the command line of Windows", () => {
      const driver = join(import.meta.dir, "..", "..", "..", "src", "lint", "driver");
      const read = (...names: string[]) => names.map(name => readFileSync(join(driver, name), "utf8")).join("");
      const scripts = {
        eslint: read("evaluate-start.js", "evaluate-describe.js", "evaluate-stand-ins.js", "evaluate-eslint.js"),
        prettier: read("evaluate-start.js", join("fmt", "evaluate-prettier.js")),
        tailwind: read("evaluate-start.js", join("fmt", "tailwind.js")),
      };
      // `quote_cmd_arg` of libuv.
      const quoted = (text: string) =>
        text.length + 2 + (text.match(/\\*"/g) ?? []).reduce((sum, it) => sum + it.length, 0);
      // Two paths as long as they get, and the rest.
      const others = 2 * 1024 + 64;
      for (const [name, script] of Object.entries(scripts)) {
        expect({ name, fits: quoted(script) + others < 32_767, hasCarriageReturn: script.includes("\r") }).toEqual({
          name,
          fits: true,
          hasCarriageReturn: false,
        });
      }
    });
  });
});

// A key of `[lint]` is the default of the flag of the same name.
describe.concurrent("[lint] in bunfig.toml", () => {
  /** What a run leaves behind: what it prints but for the times, how it ends, and the files. */
  async function run(files: Record<string, string>, args: string[]) {
    const reads = Object.keys(files).filter(name => name !== "bunfig.toml");
    const result = await lint(files, args, { reads, mayFail: true });
    // In JSON the `\\` of a path of Windows are doubled, so the directory is not found in it and its random end stays.
    const text = (printed: string) => printed.replace(/\d+(\.\d+)?m?s\b/g, "0ms").replace(/\bbun-lint_\w+/g, "<dir>");
    return { stdout: text(result.stdout), stderr: text(result.stderr), exitCode: result.exitCode, files: result.files };
  }

  const eslint = { "eslint.config.js": basic, "a.js": bad };
  const oxlint = { ".oxlintrc.json": `{ "rules": { "no-debugger": "error", "no-var": "warn" } }`, "a.js": bad };
  const typed = {
    ".oxlintrc.json": `{ "rules": { "typescript/no-floating-promises": "error" } }`,
    "tsconfig.json": `{ "compilerOptions": { "strict": true }, "include": ["*.ts"] }`,
    "a.ts": "async function f() {}\nf();\nconst a: string = 1;\n",
  };
  const many = Array.from({ length: 60 }, () => "debugger;\n").join("");
  const suppressions = JSON.stringify({
    "a.js": { "no-debugger": { count: 1 }, eqeqeq: { count: 1 }, semi: { count: 1 } },
  });

  // Lines of the section, the flags that say the same, flags that say otherwise, the files, and the arguments.
  const keys: [lines: string, flags: string[], opposite: string[], files: Record<string, string>, args: string[]][] = [
    [
      `config = "other.config.js"`,
      ["--config", "other.config.js"],
      ["-c", "eslint.config.js"],
      { ...eslint, "other.config.js": config({ "no-var": "error" }) },
      ["a.js"],
    ],
    [`configLookup = false`, ["--no-config-lookup"], ["--config-lookup"], eslint, ["a.js"]],
    [`flavor = "oxlint"`, ["--flavor=oxlint"], ["--flavor=eslint"], { ...eslint, ...oxlint }, ["a.js"]],
    [`flavor = "eslint"`, ["--flavor=eslint"], ["--flavor=oxlint"], { ...eslint, ...oxlint }, ["a.js"]],
    [`ext = [".foo"]`, ["--ext", ".foo"], [], { ...eslint, "b.foo": bad }, ["."]],
    [`ext = ".foo"`, ["--ext", ".foo"], [], { ...eslint, "b.foo": bad }, ["."]],
    [
      `ignorePatterns = ["b.js", "sub/"]`,
      ["--ignore-pattern", "b.js", "--ignore-pattern=sub/"],
      [],
      { ...eslint, "b.js": bad, "sub/c.js": bad },
      ["."],
    ],
    [`ignorePath = "mine"`, ["--ignore-path", "mine"], [], { ...oxlint, "b.js": bad, mine: "b.js\n" }, ["."]],
    [
      `ignore = false`,
      ["--no-ignore"],
      ["--ignore"],
      {
        "eslint.config.js": `export default [{ ignores: ["a.js"] }, { rules: { "no-debugger": "error" } }];`,
        "a.js": bad,
      },
      ["a.js"],
    ],
    [
      `warnIgnored = false`,
      ["--no-warn-ignored"],
      ["--warn-ignored"],
      { "eslint.config.js": `export default [{ ignores: ["a.js"] }];`, "a.js": bad, "b.js": "" },
      ["a.js", "b.js"],
    ],
    [`quiet = true`, ["--quiet"], ["--no-quiet"], eslint, ["a.js"]],
    [`silent = true`, ["--silent"], ["--no-silent"], oxlint, ["a.js"]],
    [
      `maxWarnings = 0`,
      ["--max-warnings", "0"],
      ["--max-warnings=10"],
      { ...eslint, "a.js": "var a = 1;\na;\n" },
      ["a.js"],
    ],
    [
      `denyWarnings = true`,
      ["--deny-warnings"],
      ["--no-deny-warnings"],
      { ...oxlint, "a.js": "var a = 1;\na;\n" },
      ["a.js"],
    ],
    [`format = "unix"`, ["-f", "unix"], ["--format=json"], eslint, ["a.js"]],
    [`all = true`, ["--all"], ["--no-all"], { ...eslint, "a.js": many }, ["-f", "pretty", "a.js"]],
    [
      `inlineConfig = false`,
      ["--no-inline-config"],
      ["--inline-config"],
      { ...eslint, "a.js": "// eslint-disable-next-line no-debugger\ndebugger;\n" },
      ["a.js"],
    ],
    [
      `reportUnusedDisableDirectives = true`,
      ["--report-unused-disable-directives"],
      ["--report-unused-disable-directives-severity=off"],
      { ...eslint, "a.js": "// eslint-disable-next-line no-debugger\na;\n" },
      ["a.js"],
    ],
    [
      `reportUnusedDisableDirectives = "off"`,
      ["--report-unused-disable-directives-severity", "off"],
      ["--report-unused-disable-directives"],
      { ...eslint, "a.js": "// eslint-disable-next-line no-debugger\na;\n" },
      ["a.js"],
    ],
    [
      `reportUnusedInlineConfigs = "error"`,
      ["--report-unused-inline-configs=error"],
      ["--report-unused-inline-configs=off"],
      { ...eslint, "a.js": "/* eslint no-debugger: error */\na;\n" },
      ["a.js"],
    ],
    [
      `suppressionsLocation = "known.json"`,
      ["--suppressions-location", "known.json"],
      ["--suppressions-location=none.json"],
      { ...eslint, "known.json": suppressions },
      ["a.js"],
    ],
    [
      `passOnUnprunedSuppressions = true`,
      ["--pass-on-unpruned-suppressions"],
      ["--no-pass-on-unpruned-suppressions"],
      { ...eslint, "a.js": "a;\n", "eslint-suppressions.json": suppressions },
      ["a.js"],
    ],
    [
      `errorOnUnmatchedPattern = false`,
      ["--no-error-on-unmatched-pattern"],
      ["--error-on-unmatched-pattern"],
      eslint,
      ["none.js"],
    ],
    [`passOnNoPatterns = true`, ["--pass-on-no-patterns"], ["--no-pass-on-no-patterns"], eslint, []],
    [
      `exitOnFatalError = true`,
      ["--exit-on-fatal-error"],
      ["--no-exit-on-fatal-error"],
      { ...eslint, "a.js": "a(" },
      ["a.js"],
    ],
    [
      `allowUnsupported = true`,
      ["--allow-unsupported"],
      ["--no-allow-unsupported"],
      { ".eslintrc.json": `{ "rules": { "no-debugger": "error", "require-jsdoc": "warn" } }`, "a.js": bad },
      ["a.js"],
    ],
    [
      `inferGlobals = true`,
      ["--infer-globals"],
      ["--no-infer-globals"],
      {
        "eslint.config.js": config({ "no-undef": "error" }),
        "tsconfig.json": `{ "compilerOptions": { "allowJs": true }, "include": ["*.ts", "*.js"] }`,
        "globals.d.ts": "declare const mine: number;\n",
        "a.js": "mine;\nother;\n",
      },
      ["a.js"],
    ],
    [`typeAware = true`, ["--type-aware"], ["--no-type-aware"], typed, ["a.ts"]],
    [
      `typeAware = false`,
      ["--no-type-aware"],
      ["--type-aware"],
      {
        ...typed,
        ".oxlintrc.json": `{ "options": { "typeAware": true }, "rules": { "typescript/no-floating-promises": "error" } }`,
      },
      ["a.ts"],
    ],
    [`typeCheck = true`, ["--type-check"], ["--no-type-check"], typed, ["--type-aware", "a.ts"]],
    [`project = "none.json"`, ["--project", "none.json"], ["-p", "tsconfig.json"], typed, ["--type-aware", "a.ts"]],
    [
      `disableNestedConfig = true`,
      ["--disable-nested-config"],
      ["--no-disable-nested-config"],
      { ...oxlint, "sub/.oxlintrc.json": `{ "rules": { "no-debugger": "off" } }`, "sub/a.js": bad },
      ["sub/a.js"],
    ],
    [`fixType = ["suggestion"]`, ["--fix-type", "suggestion"], [], eslint, ["--fix", "a.js"]],
    [
      `[lint.rules]\n"no-debugger" = "off"\neqeqeq = ["error", "smart"]\n"no-eval" = 2`,
      ["--rule", `{"no-debugger": "off", "eqeqeq": ["error", "smart"], "no-eval": 2}`],
      ["--rule", "no-debugger: warn"],
      { ...eslint, "a.js": `${bad}eval(a == null);\n` },
      ["a.js"],
    ],
    [
      `[lint.rules]\n"no-debugger" = "off"\n"no-eval" = "error"`,
      ["--rule", `{"no-debugger": "off", "no-eval": "error"}`, "--flavor=oxlint"],
      ["--rule", "no-debugger: warn"],
      { ...oxlint, "a.js": `${bad}eval(a);\n` },
      ["a.js"],
    ],
    [
      `[lint.rules]\n"no-restricted-imports" = ["error", { paths = ["lodash"], patterns = [{ group = ["a\\nb*"], message = "it's \\"so\\"" }] }]`,
      ["--rule", `{"no-restricted-imports": ["error", { "paths": ["lodash"] }]}`],
      [],
      { ...eslint, "a.js": `import "lodash";\n` },
      ["a.js"],
    ],
    [
      `[lint.globals]\nmine = "readonly"\nyours = true\ntheirs = false\nours = "writable"`,
      ["--global", "mine,yours:true", "--global", "theirs,ours:true"],
      [],
      {
        "eslint.config.js": config({ "no-undef": "error", "no-global-assign": "error" }),
        "a.js": "mine = yours = theirs = ours = other;\n",
      },
      ["a.js"],
    ],
    [
      `[lint.parserOptions]\necmaFeatures = { jsx = true }`,
      ["--parser-options", "ecmaFeatures: { jsx: true }"],
      ["--parser-options", "ecmaFeatures: { jsx: false }"],
      { ...eslint, "a.js": "<a />;\n" },
      ["a.js"],
    ],
    [
      `[lint.categories]\nstyle = "warn"\nall = "off"\ncorrectness = "error"`,
      ["-A", "all", "-W", "style", "-D", "correctness"],
      [],
      { ".oxlintrc.json": "{}", "a.js": `${bad}for (;;) {}\n` },
      ["a.js"],
    ],
  ];

  test.each(keys)("%s", async (lines, flags, opposite, files, args) => {
    const bunfig = { "bunfig.toml": lines.startsWith("[") ? `${lines}\n` : `[lint]\n${lines}\n` };
    const [plain, byKey, byFlag, underFlag, byOtherFlag] = await Promise.all([
      run(files, args),
      run({ ...files, ...bunfig }, args),
      run(files, [...flags, ...args]),
      run({ ...files, ...bunfig }, [...opposite, ...args]),
      // What takes a list or a table is added to.
      run(files, [...(opposite.length === 0 || /^\[|= \[/.test(lines) ? flags : []), ...opposite, ...args]),
    ]);
    expect(byKey).toEqual(byFlag);
    expect(byKey).not.toEqual(plain);
    expect(underFlag).toEqual(byOtherFlag);
  });

  test("threads", async () => {
    const [byKey, byFlag, wrong] = await Promise.all([
      run({ ...eslint, "bunfig.toml": "[lint]\nthreads = 1\n" }, ["a.js"]),
      run(eslint, ["--threads=1", "a.js"]),
      run({ ...eslint, "bunfig.toml": "[lint]\nthreads = -1\n" }, ["a.js"]),
    ]);
    expect(byKey).toEqual(byFlag);
    expect(wrong.stderr).toContain(`--threads takes a number, not "-1".`);
    expect(wrong.exitCode).toBe(2);
  });

  // 288 bytes for each: 19 GB, and more than there is to address.
  test.each(["67108864", "9007199254740992", "9223372036854775808"])("%s threads are as many as there can be", async count => {
    const [byKey, byFlag, few] = await Promise.all([
      run({ ...eslint, "bunfig.toml": `[lint]\nthreads = ${count}\n` }, ["a.js"]),
      run(eslint, [`--threads=${count}`, "a.js"]),
      run(eslint, ["--threads=1", "a.js"]),
    ]);
    // TOML has no number as large as the last.
    if (count.length < 19) expect(byKey).toEqual(few);
    expect(byFlag).toEqual(few);
  });

  // ESLint refuses the flag in a run that fixes nothing.
  test("fixType waits for a run that fixes", async () => {
    const files = { ...eslint, "bunfig.toml": `[lint]\nfixType = ["layout"]\n` };
    const [without, plain, dry, dryByFlag] = await Promise.all([
      run(files, ["a.js"]),
      run(eslint, ["a.js"]),
      run(files, ["--fix-dry-run", "-f", "json", "a.js"]),
      run(eslint, ["--fix-dry-run", "--fix-type=layout", "-f", "json", "a.js"]),
    ]);
    expect(without).toEqual(plain);
    expect(dry).toEqual(dryByFlag);
  });

  // A flag that only one of the two tools has says whom a command line was written for. A key was written for Bun.
  test("a key does not say which tool the run stands in for", async () => {
    const both = { ...eslint, ...oxlint };
    const asks = "Say which one this run is for: --flavor=oxlint or --flavor=eslint.";
    const results = await Promise.all(
      [
        `denyWarnings = true`,
        `typeAware = true`,
        `ext = [".js"]`,
        `[lint.rules]\n"no-var" = "off"`,
        `[lint.categories]\nstyle = "warn"`,
      ].map(lines =>
        run({ ...both, "bunfig.toml": lines.startsWith("[") ? `${lines}\n` : `[lint]\n${lines}\n` }, ["a.js"]),
      ),
    );
    for (const result of results) {
      expect(result.stderr).toContain(asks);
      expect(result.exitCode).toBe(2);
    }
    // With the configuration of ESLint alone, the flag makes it a run of oxlint.
    const [byKey, byFlag, plain] = await Promise.all([
      run({ ...eslint, "bunfig.toml": "[lint]\ndenyWarnings = true\n" }, ["-f", "unix", "a.js"]),
      run(eslint, ["--deny-warnings", "-f", "unix", "a.js"]),
      run(eslint, ["-f", "unix", "a.js"]),
    ]);
    expect(byKey.stdout).toBe(plain.stdout);
    expect(byFlag.stdout).not.toBe(plain.stdout);
  });

  test("bun/format holds a file against what bun format prints, with [format]", async () => {
    const files = { "a.js": "a('b')\n", "bunfig.toml": "[format]\nsemi = false\nsingleQuote = true\n" };
    const rule = (...options: unknown[]) => ({
      ".oxlintrc.json": JSON.stringify({ rules: { "bun/format": ["error", ...options] } }),
    });
    const [withSection, without, overridden] = await Promise.all([
      run({ ...files, ...rule() }, ["-f", "unix", "a.js"]),
      run({ "a.js": files["a.js"], ...rule() }, ["-f", "unix", "a.js"]),
      run({ ...files, ...rule({ semi: true }) }, ["-f", "unix", "a.js"]),
    ]);
    expect(withSection.stdout).toBe("");
    expect(withSection.exitCode).toBe(0);
    expect(without.stdout).toContain(`Replace \`'b')\` with \`"b");\``);
    expect(overridden.stdout).toContain("Insert `;`");
    expect(overridden.stdout).not.toContain("Replace");
  });

  test("the file is that of the working directory, after --cwd", async () => {
    const files = {
      ...eslint,
      "sub/a.js": bad,
      "bunfig.toml": `[lint]\nformat = "unix"\n`,
      "sub/bunfig.toml": `[lint]\nquiet = true\nformat = "json"\n`,
    };
    const [above, below] = await Promise.all([run(files, ["sub/a.js"]), run(files, ["--cwd=sub", "a.js"])]);
    expect(above.stdout).toContain("[Warning/no-var]");
    expect(JSON.parse(below.stdout)[0].warningCount).toBe(0);
  });

  /** `bun ...args` in a directory with `files`. */
  async function bun(files: Record<string, string>, args: string[]) {
    using dir = tempDir("bun-lint-bunfig", files);
    const stdio = { stdin: "ignore", stdout: "pipe", stderr: "pipe" } as const;
    await using proc = spawn({ cmd: [bunExe(), ...args], env, cwd: String(dir), ...stdio });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test("--config= before lint names another file than bunfig.toml", async () => {
    const files = {
      ...eslint,
      "bunfig.toml": `[lint]\nformat = "unix"\n`,
      "other.toml": `[lint]\nformat = "json"\n`,
    };
    const results = await Promise.all([
      bun(files, ["lint", "a.js"]),
      bun(files, ["--config=other.toml", "lint", "a.js"]),
      bun(files, ["-c=other.toml", "lint", "a.js"]),
      // What follows `lint` is the linter's.
      bun(files, ["--config=other.toml", "lint", "-c", "eslint.config.js", "a.js"]),
      bun(files, ["--config=none.toml", "lint", "a.js"]),
    ]);
    expect(results.map(it => [it.stdout.startsWith("[{"), it.exitCode])).toEqual([
      [false, 1],
      [true, 1],
      [true, 1],
      [true, 1],
      [false, 2],
    ]);
    expect(results[4].stderr).toContain(`while reading config "`);
  });

  test("what is wrong with [lint] is shown where it is, as for every other section", async () => {
    const bunfig = `[lint]\nquiet = true\n\n[lint.rules]\neqeqeq = ["error", "smart"]\n"no-var" = "always"\n`;
    const result = await bun({ ...eslint, "bunfig.toml": bunfig }, ["lint", "a.js"]);
    expect(result.stderr).toContain(`6 | "no-var" = "always"\n`);
    expect(result.stderr).toMatch(
      /error: Option rules: 'always' not one of off, warn, error, 0, 1, or 2\.\n\s+at .*bunfig\.toml:6:12\n/,
    );
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(2);
  });

  // The flags that say what one run does.
  test.each([
    ["fix = true", "--fix"],
    ["fixDryRun = true", "--fix-dry-run"],
    ["fixSuggestions = true", "--fix-suggestions"],
    ["fixDangerously = true", "--fix-dangerously"],
    ["init = true", "--init"],
    ["stdin = true", "--stdin"],
    [`stdinFilename = "a.js"`, "--stdin-filename"],
    [`printConfig = "a.js"`, "--print-config"],
    ["suppressAll = true", "--suppress-all"],
    [`suppressRule = ["no-var"]`, "--suppress-rule"],
    ["pruneSuppressions = true", "--prune-suppressions"],
    [`outputFile = "report.txt"`, "--output-file"],
    ["color = true", "--color"],
    ["timing = true", "--timing"],
    [`cwd = "sub"`, "--cwd"],
  ])("%s is refused, and nothing is written", async (line, flag) => {
    const key = line.split(" ")[0];
    const result = await run({ ...eslint, "bunfig.toml": `[lint]\n${line}\n` }, ["a.js"]);
    expect(result.stderr).toContain(
      `"${key}" cannot be set in bunfig.toml, it says what one run does. Pass ${flag} on the command line`,
    );
    expect(result.stdout).toBe("");
    expect(result.files["a.js"]).toBe(bad);
    expect(result.exitCode).toBe(2);
  });

  test.each([
    ["quiet = 1", "expected boolean but received number"],
    [`maxWarnings = "0"`, "expected number but received string"],
    ["maxWarnings = 1.5", "Invalid value for option 'max-warnings' - expected type Int, received value: 1.5."],
    ["config = false", "expected string but received boolean"],
    ["ignorePatterns = true", "expected array but received boolean"],
    ["ignorePatterns = [1]", "expected string but received number"],
    [`flavor = "biome"`, "Option flavor: 'biome' not one of eslint or oxlint."],
    [`format = "fancy"`, `There is no formatter "fancy". Those that exist: stylish, pretty, json,`],
    [`fixType = ["all"]`, `'fixTypes' must be an array of any of "directive", "problem", "suggestion", and "layout".`],
    [`reportUnusedDisableDirectives = "loud"`, "'loud' not one of off, warn, error, 0, 1, or 2."],
    ["reportUnusedDisableDirectives = 1", "expected string but received number"],
    [`reportUnusedInlineConfigs = true`, "expected string but received boolean"],
    ["rules = true", "expected object but received boolean"],
    [`[lint.rules]\neqeqeq = "always"`, "Option rules: 'always' not one of off, warn, error, 0, 1, or 2."],
    [`[lint.rules]\neqeqeq = ["smart"]`, "Option rules: 'smart' not one of off, warn, error, 0, 1, or 2."],
    [`[lint.rules]\neqeqeq = []`, "expected string but received array"],
    [`[lint.rules]\neqeqeq = true`, "expected string but received boolean"],
    [`[lint.globals]\na = "off"`, `expected "readonly" or "writable" but received string`],
    [`[lint.globals]\na = 1`, `expected "readonly" or "writable" but received number`],
    [`[lint.categories]\nstyles = "warn"`, `unknown category "styles"`],
    [`[lint.categories]\nstyle = "deny"`, "Option categories: 'deny' not one of off, warn, error, 0, 1, or 2."],
    ["maxWarning = 0", `unknown key "maxWarning" in [lint]. Did you mean "maxWarnings"?`],
    ["max-warnings = 0", `unknown key "max-warnings" in [lint]. Did you mean "maxWarnings"?`],
    [`ignorePattern = ["a"]`, `unknown key "ignorePattern" in [lint]. Did you mean "ignorePatterns"?`],
    [`plugins = ["import"]`, `unknown key "plugins" in [lint].`],
    [`extends = ["a"]`, `unknown key "extends" in [lint].`],
    ["overrides = []", `unknown key "overrides" in [lint].`],
    ["cache = true", `unknown key "cache" in [lint].`],
    [`env = ["node"]`, `unknown key "env" in [lint].`],
  ])("%s is refused: %s", async (lines, message) => {
    const bunfig = lines.startsWith("[") ? `${lines}\n` : `[lint]\n${lines}\n`;
    const result = await run({ ...eslint, "bunfig.toml": bunfig }, ["a.js"]);
    expect(result.stderr).toContain(message);
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(2);
  });

  test("every flag in the help is a key, or is refused as a key with its name", async () => {
    const help = await lint({}, ["--help"]);
    const flags = [...help.stdout.matchAll(/^\s+(?:-\w, )?--([a-z-]+)/gm)].map(it => it[1]);
    expect(flags.length).toBeGreaterThan(50);
    const renamed: Record<string, string> = {
      "ignore-pattern": "ignorePatterns",
      "report-unused-disable-directives-severity": "reportUnusedDisableDirectives",
      rule: "rules",
      global: "globals",
      allow: "categories",
      warn: "categories",
      deny: "categories",
    };
    const answers = await Promise.all(
      flags.map(async flag => {
        const positive = flag.replace(/^no-/, "");
        const key = renamed[positive] ?? positive.replace(/-(\w)/g, (_, it) => it.toUpperCase());
        // Of a type that no key takes: one that exists says what it expects.
        const { stderr } = await run({ "bunfig.toml": `[lint]\n${key} = [[1]]\n` }, ["--list-files"]);
        return [flag, /expected .+ but received|cannot be set in bunfig\.toml/.test(stderr)];
      }),
    );
    expect(answers.filter(it => !it[1])).toEqual([]);
  });
});

// The rules of some plugins are built in, and run in place of those of the package that the configuration loads.
describe.concurrent("nativePluginRules", () => {
  // A debug build takes seconds to start an engine for JavaScript.
  const timeout = isDebug || isASAN ? 120_000 : 10_000;

  /** A package that is called `name`, whose rules report at the top of every file that they have run. */
  const standIn = (name: string, rules: string[], report = `context.report({ node, message: "the package ran" })`) => ({
    [`node_modules/${name}/package.json`]: JSON.stringify({ name, version: "99.0.0", main: "index.js" }),
    [`node_modules/${name}/index.js`]: `module.exports = {
      meta: { name: ${JSON.stringify(name)}, version: "99.0.0" },
      rules: Object.fromEntries(${JSON.stringify(rules)}.map(rule => [rule, { create: context => ({ Program(node) { ${report}; } }) }])),
    };\n`,
  });
  const packages = {
    ...standIn("eslint-plugin-react-hooks", ["rules-of-hooks"]),
    ...standIn("eslint-plugin-import", ["order"]),
  };
  const rules = { "react-hooks/rules-of-hooks": "error", "import/order": "error", "no-debugger": "error" };
  const source = {
    "a.js": `import b from "./b.js";\nimport fs from "fs";\nfunction f() {\n  if (b) useState(fs);\n}\ndebugger;\n`,
    "b.js": "export default 1;\n",
  };
  const flat = {
    ...packages,
    ...source,
    "eslint.config.js": `const hooks = require("eslint-plugin-react-hooks");\nconst imports = require("eslint-plugin-import");\nmodule.exports = [{ plugins: { "react-hooks": hooks, import: imports }, rules: ${JSON.stringify(rules)} }];\n`,
  };
  const legacy = {
    ...packages,
    ...source,
    ".eslintrc.json": JSON.stringify({
      root: true,
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
      plugins: ["react-hooks", "import"],
      rules,
    }),
  };

  /** For each rule that reports: whether it is that of the package. */
  async function who(files: Record<string, string>, args: string[] = []) {
    const { raw, stderr, exitCode } = await lint(files, ["-f", "json", ...args, "a.js"], { mayFail: true });
    if (exitCode !== 1) return { stderr, exitCode };
    const messages: { ruleId: string; message: string }[] = JSON.parse(raw)[0].messages;
    return Object.fromEntries(
      messages.map(it => [it.ruleId, it.message === "the package ran" ? "package" : "built in"]),
    );
  }
  const bunfig = (value: string) => ({ "bunfig.toml": `[lint]\nnativePluginRules = ${value}\n` });
  const all = (hooks: string, imports: string) => ({
    "react-hooks/rules-of-hooks": hooks,
    "import/order": imports,
    // Of no package.
    "no-debugger": "built in",
  });

  describe.each([
    ["eslint.config.js", flat],
    [".eslintrc.json", legacy],
  ])("%s", (_, files) => {
    test.each([
      ["nothing", {}, [], all("built in", "built in")],
      ["true", bunfig("true"), [], all("built in", "built in")],
      ["false", bunfig("false"), [], all("package", "package")],
      ["[]", bunfig("[]"), [], all("package", "package")],
      [`["import"]`, bunfig(`["import"]`), [], all("package", "built in")],
      [`["react-hooks", "import"]`, bunfig(`["react-hooks", "import"]`), [], all("built in", "built in")],
      ["--no-native-plugin-rules", {}, ["--no-native-plugin-rules"], all("package", "package")],
      ["--native-plugin-rules=false", {}, ["--native-plugin-rules=false"], all("package", "package")],
      ["--native-plugin-rules import", {}, ["--native-plugin-rules", "import"], all("package", "built in")],
      ["--native-plugin-rules=react-hooks", {}, ["--native-plugin-rules=react-hooks"], all("built in", "package")],
      [
        "false, and --native-plugin-rules=true",
        bunfig("false"),
        ["--native-plugin-rules=true"],
        all("built in", "built in"),
      ],
      [
        `["import"], and --native-plugin-rules=react-hooks`,
        bunfig(`["import"]`),
        ["--native-plugin-rules=react-hooks"],
        all("built in", "package"),
      ],
      ["true, and --no-native-plugin-rules", bunfig("true"), ["--no-native-plugin-rules"], all("package", "package")],
    ] as const)(
      "%s",
      async (_, more, args, expected) => {
        expect(await who({ ...files, ...more }, [...args])).toEqual(expected);
      },
      timeout,
    );

    test(
      "a comment is about the rule that runs",
      async () => {
        const disabled = { "a.js": `/* eslint-disable react-hooks/rules-of-hooks */\n${source["a.js"]}` };
        expect(await who({ ...files, ...disabled, ...bunfig("false") })).toEqual({
          "import/order": "package",
          "no-debugger": "built in",
        });
      },
      timeout,
    );
  });

  describe.each(["eslint.config.js", ".eslintrc.json"])("react: %s", kind => {
    const config = (rules: Record<string, string>) =>
      kind === "eslint.config.js"
        ? {
            "eslint.config.js": `module.exports = [{
              languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
              plugins: { react: require("eslint-plugin-react") },
              rules: ${JSON.stringify(rules)},
            }];`,
          }
        : {
            ".eslintrc.json": JSON.stringify({
              root: true,
              parserOptions: { ecmaVersion: 2022, sourceType: "module", ecmaFeatures: { jsx: true } },
              plugins: ["react"],
              rules,
            }),
          };
    const files = {
      ...standIn("eslint-plugin-react", ["jsx-key"]),
      ...config({ "react/jsx-key": "error", "no-debugger": "error" }),
      "a.js": "export const a = [<b />];\ndebugger;\n",
    };
    const by = (react: string) => ({ "react/jsx-key": react, "no-debugger": "built in" });
    const others = "@typescript-eslint,react-hooks,import,n,prettier";

    test.each([
      ["nothing", {}, [], "built in"],
      ["true", bunfig("true"), [], "built in"],
      ["false", bunfig("false"), [], "package"],
      [`["import"]`, bunfig(`["import"]`), [], "package"],
      [`["react"]`, bunfig(`["react"]`), [], "built in"],
      ["--no-native-plugin-rules", {}, ["--no-native-plugin-rules"], "package"],
      ["all the others", {}, [`--native-plugin-rules=${others}`], "package"],
      ["all the others and it", {}, [`--native-plugin-rules=${others},react`], "built in"],
    ] as const)(
      "%s",
      async (_, more, args, expected) => {
        expect(await who({ ...files, ...more }, [...args])).toEqual(by(expected));
      },
      timeout,
    );

    test(
      "a comment is about the rule that runs",
      async () => {
        const disabled = { "a.js": `/* eslint-disable react/jsx-key */\n${files["a.js"]}` };
        const expected = { "no-debugger": "built in" };
        expect(await who({ ...files, ...disabled })).toEqual(expected);
        expect(await who({ ...files, ...disabled }, ["--no-native-plugin-rules"])).toEqual(expected);
      },
      timeout,
    );
  });

  // oxlint has them in its `react`. eslint-plugin-react does not.
  test.each(["rules-of-hooks", "only-export-components"])(
    "react/%s is no rule of eslint-plugin-react",
    async rule => {
      const files = {
        ...standIn("eslint-plugin-react", ["jsx-key"]),
        "eslint.config.js": `module.exports = [{ plugins: { react: require("eslint-plugin-react") }, rules: { "react/${rule}": "error" } }];`,
        "a.js": "export {};\n",
      };
      const { stderr, exitCode } = await lint(files, ["a.js"], { mayFail: true });
      expect(stderr).toContain(`Key "rules": Key "react/${rule}": Could not find "${rule}" in plugin "react".`);
      expect(exitCode).toBe(2);
    },
    timeout,
  );

  test(
    "another plugin that a configuration calls `react` answers for itself",
    async () => {
      const files = {
        ...standIn("eslint-plugin-react-x", ["jsx-key"]),
        "eslint.config.js": `module.exports = [{
          languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
          plugins: { react: require("eslint-plugin-react-x") },
          rules: { "react/jsx-key": "error" },
        }];`,
        "a.js": "export const a = [<b />];\n",
      };
      expect(await who(files)).toEqual({ "react/jsx-key": "package" });
    },
    timeout,
  );

  // As ESLint 10.12. No rule of the plugin is on, so nothing of a plugin that is built in has to run in JavaScript: what rules it
  // has is known all the same.
  test.each([
    ["react/nope", "eslint-plugin-react", false],
    // oxlint has it in its `react`.
    ["react/only-export-components", "eslint-plugin-react", false],
    ["import/nope", "eslint-plugin-import", false],
    ["n/nope", "eslint-plugin-n", false],
    ["react-hooks/nope", "eslint-plugin-react-hooks", false],
    ["@typescript-eslint/nope", "@typescript-eslint/eslint-plugin", false],
    // A later version, or a copy with a rule of its own.
    ["react/other", "eslint-plugin-react", true],
    ["import/other", "eslint-plugin-import", true],
    // Another package.
    ["import-x/other", "eslint-plugin-import-x", true],
    ["import-x/nope", "eslint-plugin-import-x", false],
    ["import/other", "eslint-plugin-import-x", true],
    ["react/other", "@eslint-react/eslint-plugin", true],
    ["react/jsx-key", "@eslint-react/eslint-plugin", false],
  ] as const)(
    "%s, that only a comment names, with %s",
    async (id, name, exists) => {
      const prefix = id.slice(0, id.lastIndexOf("/"));
      const files = {
        ...standIn(name, ["other"]),
        "eslint.config.js": `module.exports = [{ plugins: { ${JSON.stringify(prefix)}: require("${name}") } }];`,
        "disables.js": `// eslint-disable-next-line ${id}\nmodule.exports = 1;\n`,
        "turns-on.js": `/* eslint ${id}: "error" */\nmodule.exports = 1;\n`,
      };
      const { raw } = await lint(files, ["-f", "json", "disables.js", "turns-on.js"], { mayFail: true });
      const said = (JSON.parse(raw) as { messages: any[] }[]).map(it =>
        it.messages.map(it => `${it.line}:${it.column} ${it.ruleId} ${it.message}`),
      );
      const missed = [`1:1 ${id} Definition for rule '${id}' was not found.`];
      const unused = [`1:1 null Unused eslint-disable directive (no problems were reported from '${id}').`];
      expect(said).toEqual(exists ? [unused, [`1:1 ${id} the package ran`]] : [missed, missed]);
    },
    timeout,
  );

  // As ESLint 10.12 with eslint-plugin-react 7.37.5, 98 of whose rules have no `meta.type`.
  test(
    "a rule that says no type: --fix-type leaves its fix alone, and the metadata have no type",
    async () => {
      const files = {
        ...standIn("eslint-plugin-react", ["self-closing-comp", "jsx-key"]),
        "eslint.config.js": `module.exports = [{
          languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
          plugins: { react: require("eslint-plugin-react") },
          rules: { "react/self-closing-comp": "error", "react/jsx-key": "error", "no-var": "error" },
        }];`,
        "a.js": "var a = [<b></b>];\nexport { a };\n",
      };
      const json = async (...flags: string[]) =>
        JSON.parse((await lint(files, [...flags, "a.js"], { mayFail: true })).raw);
      const fixed = async (...flags: string[]) => (await json("--fix-dry-run", ...flags, "-f", "json"))[0].output;
      expect(await fixed()).toBe("let a = [<b />];\nexport { a };\n");
      const withoutIt = "let a = [<b></b>];\nexport { a };\n";
      expect(await fixed("--fix-type", "suggestion")).toBe(withoutIt);
      expect(await fixed("--fix-type", "problem,suggestion,layout,directive")).toBe(withoutIt);
      expect(await fixed("--fix-type", "layout")).toBeUndefined();
      const { rulesMeta } = (await json("-f", "json-with-metadata")).metadata;
      expect(rulesMeta["no-var"].type).toBe("suggestion");
      expect(rulesMeta["react/self-closing-comp"]).toEqual({ fixable: "code" });
      expect(rulesMeta["react/jsx-key"]).toEqual({});
    },
    timeout,
  );

  // eslint-plugin-import-lite, which @antfu/eslint-config has as `import`, has no `meta`. Neither has eslint-plugin-react.
  describe("a plugin that says no name is the package that it was loaded from", () => {
    /** As `standIn`, without `meta`. The first rule takes one of two words that the rule of eslint-plugin-import does not know. */
    const nameless = (name: string, rules: string[]) => ({
      [`node_modules/${name}/package.json`]: JSON.stringify({ name, version: "99.0.0", main: "index.js" }),
      [`node_modules/${name}/index.js`]: `module.exports = {
        rules: Object.fromEntries(${JSON.stringify(rules)}.map((rule, at) => [rule, {
          meta: { schema: at === 0 ? [{ enum: ["top-level", "inline"] }] : [] },
          create: context => ({ Program(node) { context.report({ node, message: "the package ran" }); } }),
        }])),
      };\n`,
    });
    const config = (prefix: string, name: string, rules: object) => ({
      "eslint.config.js": `module.exports = [{
        languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
        plugins: { ${prefix}: require("${name}") },
        rules: ${JSON.stringify(rules)},
      }];`,
    });
    const code = {
      "a.js": `foo();\nimport b from "./b.js";\nexport const a = [<b />];\n`,
      "b.js": "export default 1;\n",
    };

    test.each([
      ["import", "eslint-plugin-import-lite", "package"],
      ["import", "eslint-plugin-import", "built in"],
    ] as const)(
      "%s: %s",
      async (prefix, name, who_) => {
        const rules = { "import/consistent-type-specifier-style": ["error", "top-level"], "import/first": "error" };
        const files = {
          ...nameless(name, ["consistent-type-specifier-style", "first"]),
          ...config(prefix, name, rules),
          ...code,
        };
        const answer = await who(files);
        expect(answer).toEqual(
          who_ === "package"
            ? { "import/consistent-type-specifier-style": "package", "import/first": "package" }
            : // The word is not one of eslint-plugin-import's.
              { stderr: expect.stringContaining(`Key "import/consistent-type-specifier-style"`), exitCode: 2 },
        );
      },
      timeout,
    );

    test(
      "react: eslint-plugin-react",
      async () => {
        const files = {
          ...nameless("eslint-plugin-react", ["other", "jsx-key"]),
          ...config("react", "eslint-plugin-react", { "react/jsx-key": "error" }),
          ...code,
        };
        expect(await who(files)).toEqual({ "react/jsx-key": "built in" });
      },
      timeout,
    );

    test(
      "a comment that names a rule which only the other package has",
      async () => {
        const files = {
          ...nameless("eslint-plugin-import-lite", ["consistent-type-specifier-style", "first"]),
          ...config("import", "eslint-plugin-import-lite", {}),
          "a.js": "// eslint-disable-next-line import/no-unresolved\nexport {};\n",
        };
        const { raw } = await lint(files, ["-f", "json", "a.js"], { mayFail: true });
        expect((JSON.parse(raw)[0].messages as any[]).map(it => it.message)).toEqual([
          "Definition for rule 'import/no-unresolved' was not found.",
        ]);
      },
      timeout,
    );

    const first = { "import/first": "error" };
    test(
      "the last node_modules of the path counts: the store of pnpm",
      async () => {
        const inStore = (name: string) => `.pnpm/${name}@1.0.0/node_modules/${name}`;
        const run = (name: string) =>
          who({
            ...nameless(inStore(name), ["other", "first"]),
            ...config("import", `./node_modules/${inStore(name)}`, first),
            ...code,
          });
        expect(await Promise.all([run("eslint-plugin-import-lite"), run("eslint-plugin-import")])).toEqual([
          { "import/first": "package" },
          { "import/first": "built in" },
        ]);
      },
      timeout,
    );

    test(
      "a package that only hands the object on is not what it was loaded from",
      async () => {
        const run = (name: string) =>
          who({
            ...nameless(name, ["other", "first"]),
            "node_modules/shared/package.json": `{ "name": "shared", "main": "index.js" }`,
            "node_modules/shared/index.js": `exports.plugin = require("${name}");\n`,
            ...config("import", "shared", first),
            "eslint.config.js": config("import", "shared", first)["eslint.config.js"].replace(
              `require("shared")`,
              `require("shared").plugin`,
            ),
            ...code,
          });
        expect(await Promise.all([run("eslint-plugin-import-lite"), run("eslint-plugin-import")])).toEqual([
          { "import/first": "package" },
          { "import/first": "built in" },
        ]);
      },
      timeout,
    );

    test(
      "an object that is written in the configuration file goes by its prefix",
      async () => {
        const files = {
          "eslint.config.js": `module.exports = [{
            plugins: { import: { rules: { first: { create: context => ({ Program(node) { context.report({ node, message: "the package ran" }); } }) } } } },
            rules: ${JSON.stringify(first)},
          }];`,
          "a.js": `foo();\nimport b from "./b.js";\nb;\n`,
          "b.js": code["b.js"],
        };
        expect(await who(files)).toEqual({ "import/first": "built in" });
      },
      timeout,
    );
  });

  // `plugins` of an .oxlintrc.json names what is built into oxlint, and what `jsPlugins` names runs in JavaScript anyway.
  test(
    "it changes nothing under the configuration of oxlint",
    async () => {
      const files = {
        ...packages,
        "a.js": `import "./a.js";\n${source["a.js"]}`,
        ".oxlintrc.json": JSON.stringify({
          plugins: ["import", "react"],
          jsPlugins: [{ name: "hooks", specifier: "eslint-plugin-react-hooks" }],
          rules: { "import/no-self-import": "error", "react/rules-of-hooks": "error", "hooks/rules-of-hooks": "error" },
        }),
      };
      const run = async (more: Record<string, string>) =>
        (await lint({ ...files, ...more }, ["-f", "unix", "a.js"])).stdout;
      const [plain, none, some] = await Promise.all([run({}), run(bunfig("false")), run(bunfig(`["import"]`))]);
      expect(plain).toContain("the package ran");
      expect(plain).toContain("import(no-self-import)");
      expect(plain).toContain("react-hooks(rules-of-hooks)");
      expect([none, some]).toEqual([plain, plain]);
    },
    timeout,
  );

  test(
    "prettier/prettier is a rule of a plugin like any other",
    async () => {
      const files = {
        ...standIn("eslint-plugin-prettier", ["prettier"]),
        "eslint.config.js": `const prettier = require("eslint-plugin-prettier");\nmodule.exports = [{ plugins: { prettier }, rules: { "prettier/prettier": "error" } }];\n`,
        "a.js": "a  ;\n",
      };
      const [none, others] = await Promise.all([
        who({ ...files, ...bunfig("false") }),
        who({ ...files, ...bunfig(`["import"]`) }),
      ]);
      expect([none, others]).toEqual([{ "prettier/prettier": "package" }, { "prettier/prettier": "package" }]);
    },
    timeout,
  );

  test(
    "--print-config names the rules of the file that run in JavaScript, beside what ESLint prints",
    async () => {
      const [builtIn, mixed] = await Promise.all([
        lint(flat, ["--print-config", "a.js"]),
        lint({ ...flat, ...bunfig(`["import"]`) }, ["--print-config", "a.js"]),
      ]);
      expect(builtIn.stderr).toBe("");
      expect(mixed.stderr).toBe("note: in JavaScript: react-hooks/rules-of-hooks. All other rules are built in.");
      expect(JSON.parse(mixed.raw)).toEqual(JSON.parse(builtIn.raw));
    },
    timeout,
  );

  // Only the built-in rules have types.
  test(
    "a rule of the package that asks for types does not run, and the run says so and fails",
    async () => {
      const asks = `throw new Error("You have used a rule which requires type information, but don't have parserOptions set to generate type information for this file.")`;
      const files = {
        ...standIn("@typescript-eslint/eslint-plugin", ["no-floating-promises"], asks),
        "eslint.config.js": `const ts = require("@typescript-eslint/eslint-plugin");\nmodule.exports = [{ plugins: { "@typescript-eslint": ts }, rules: { "@typescript-eslint/no-floating-promises": "error" } }];\n`,
        "a.js": "a;\n",
      };
      const result = await lint({ ...files, ...bunfig("false") }, ["a.js"], { mayFail: true });
      expect(result.stderr).toContain(
        "1 rule in JavaScript did not run, only the built-in rules have types: @typescript-eslint/no-floating-promises. With --native-plugin-rules=@typescript-eslint the built-in ones run",
      );
      expect(result.exitCode).toBe(2);
    },
    timeout,
  );

  test("without a configuration file no package is loaded, and the built-in rules run", async () => {
    const files = { "a.ts": "const a: any = 1;\nexport { a };\n" };
    const [plain, off] = await Promise.all([
      lint(files, ["-f", "unix", "a.ts"]),
      lint({ ...files, ...bunfig("false") }, ["-f", "unix", "a.ts"]),
    ]);
    expect(plain.stdout).toContain("[Error/@typescript-eslint/no-explicit-any]");
    expect(off.stdout).toBe(plain.stdout);
  });

  // Of that package only the configurations are loaded, as long as its rules are not asked for.
  test(
    "the rules of @typescript-eslint with an .eslintrc",
    async () => {
      const files = {
        ...standIn("@typescript-eslint/eslint-plugin", ["no-explicit-any"]),
        ".eslintrc.json": JSON.stringify({
          root: true,
          plugins: ["@typescript-eslint"],
          rules: { "@typescript-eslint/no-explicit-any": "error" },
        }),
        "a.js": "a;\n",
      };
      expect(await who({ ...files, ...bunfig("false") })).toEqual({ "@typescript-eslint/no-explicit-any": "package" });
    },
    timeout,
  );

  test(
    "a package that is not installed",
    async () => {
      const files = { ...legacy, ...standIn("eslint-plugin-import", ["order"]) };
      const without = Object.fromEntries(Object.entries(files).filter(([name]) => !name.includes("react-hooks/")));
      expect(await who(without)).toEqual(all("built in", "built in"));
      const refused = await who({ ...without, ...bunfig("false") });
      expect(refused.exitCode).toBe(2);
      expect(refused.stderr).toContain(`ESLint couldn't find the plugin "eslint-plugin-react-hooks".`);
    },
    timeout,
  );

  test.each([
    [
      `["imprt"]`,
      "Option native-plugin-rules: 'imprt' not one of @typescript-eslint, react-hooks, import, n, react, prettier.",
    ],
    [`["unicorn"]`, "Option native-plugin-rules: 'unicorn' not one of"],
    [`["true"]`, "Option native-plugin-rules: 'true' not one of"],
    [`"import"`, "expected boolean or array but received string"],
    ["[1]", "expected string but received number"],
  ])("nativePluginRules = %s is refused", async (value, message) => {
    const result = await lint({ ...flat, ...bunfig(value) }, ["a.js"], { mayFail: true });
    expect(result.stderr).toContain(message);
    expect(result.exitCode).toBe(2);
  });
});
