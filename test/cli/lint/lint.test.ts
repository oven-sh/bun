import { dlopen } from "bun:ffi";
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isWindows, normalizeBunSnapshot, tempDir } from "harness";
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
  utimesSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, parse, posix, sep, win32 } from "node:path";
import { endChildren, spawn } from "../children";
import { configurations } from "./oracle/plugins/oxlint/compare-options";
import whatOxlintReports from "./oracle/plugins/oxlint/expected.json";
import { directoryOf, filesOf, cases as fixCases, flagSets } from "./oracle/plugins/oxlint/fixes";
import fixDifferences from "./oracle/plugins/oxlint/fixes.differences.json";
import whatOxlintFixes from "./oracle/plugins/oxlint/fixes.expected.json";
import { filesOf as filesOfMessages, helpsOf, entries as messages, messagesOf } from "./oracle/plugins/oxlint/messages";
import optionsOfOxlint from "./oracle/plugins/oxlint/options.json";
import { projects } from "./oracle/plugins/oxlint/projects";

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
  if (exitCode !== 0 && exitCode !== 1) console.error(`bun lint ${args.join(" ")}: exit code ${exitCode}\n${stderr}`);
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
        .filter(line => / Parsing error: /.test(line))
        .map(line => line.match(/a\d+\.js/)?.[0]),
    ).toEqual(Object.keys(files).sort());
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
        expect(stdout).toContain(": Parsing error: ");
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
        expect(stdout).toContain(`${place}: Parsing error: Identifier`);
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
        expect(stdout).not.toContain("Parsing error");
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
        // A help that is printed is oxlint's. Not all are there yet.
        const helps = helpsOf(raw, messages).map((it, index) => ({ ...messages[index], said: it }));
        const wrong = helps.filter(it => it.said !== undefined && it.said !== it.help);
        expect(wrong.map(it => [it.rule, it.id])).toEqual([]);
        expect(helps.filter(it => it.said === undefined && it.help !== undefined).length).toBeLessThanOrEqual(5);
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

    test("a file is not emptied", async () => {
      const removes = `{
        meta: { fixable: "code" },
        create: context => ({
          Program(node) {
            if (node.body.length) context.report({ node, message: "all", fix: fixer => fixer.removeRange([0, context.sourceCode.text.length]) });
          },
        }),
      }`;
      const files = {
        "eslint.config.mjs": `export default [{ files: ["a.js"], plugins: { mine: { rules: { removes: ${removes} } } }, rules: { "mine/removes": "error" } }];`,
        "a.js": "export const a = 1;\n",
      };
      const result = await lint(files, ["--fix", "a.js"], { reads: ["a.js"] });
      expect(result.files["a.js"]).toBe(files["a.js"]);
      expect(result.stderr).toContain("a.js: The fixes leave nothing of it.");
      expect(result.exitCode).toBe(2);
    });

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
        const [linked, named] = await Promise.all([
          lint(files, ["--fix", "shared/d.js"], options),
          lint(files, ["--fix", "../../shared/d.js"], options),
        ]);
        expect([linked.files, named.files]).toEqual([{ "shared/d.js": fixed }, { "shared/d.js": fixed }]);
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

  test("a directory of that name without an index does not", async () => {
    const { "package.json": __, ...rest } = files;
    const { stdout, exitCode } = await lint({ ...rest, "lint/notes.txt": "x" }, ["-f", "unix", "a.js"]);
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
    const result = await bun(files, ["lint", "-f", "unix", "--no-config-cache", "sub"], variables);
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

  test("the bunfig.toml of the project is not read", async () => {
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
    /** Makes the file as old as a file that nobody is working on: what depends on one that has just been written is not kept. */
    const age = (path: string, seconds: number) => {
      const time = new Date(Date.now() - seconds * 1000);
      utimesSync(path, time, time);
    };

    test(
      "what it exports is kept until the file, what it has read, or a variable of the environment changes",
      async () => {
        // Windows makes no difference between upper and lower case in the name of a variable.
        const name = isWindows ? "bun_lint_platform_rule" : "BUN_LINT_PLATFORM_RULE";
        const config = (comment: string) => `// ${comment}
        const fs = require("node:fs");
        fs.appendFileSync(__dirname + "/evaluated.txt", "x");
        const { rule } = JSON.parse(fs.readFileSync(require("node:path").join(__dirname, "settings", "rule.json"), "utf8"));
        module.exports = [{ rules: { [process.env.${name} ?? rule]: "error" } }];`;
        using dir = tempDir("bun-lint-platform", {
          "node_modules/.keep": "",
          "eslint.config.cjs": config("one"),
          "settings/rule.json": `{ "rule": "no-debugger" }`,
          "a.js": "debugger;\nvar a;\n",
        });
        const at = (...names: string[]) => join(String(dir), ...names);
        const run = async (variable?: string) => {
          const { stdout } = await lint(dir, ["-f", "json", "a.js"], { env: { BUN_LINT_PLATFORM_RULE: variable } });
          return [
            JSON.parse(stdout)[0].messages.map((it: any) => it.ruleId),
            readFileSync(at("evaluated.txt"), "utf8"),
          ];
        };
        age(at("eslint.config.cjs"), 60);
        age(at("settings", "rule.json"), 60);
        expect(await run()).toEqual([["no-debugger"], "x"]);
        expect(await run()).toEqual([["no-debugger"], "x"]);
        // As long as before.
        writeFileSync(at("settings", "rule.json"), `{ "rule": "no-var"      }`);
        age(at("settings", "rule.json"), 30);
        expect(await run()).toEqual([["no-var"], "xx"]);
        expect(await run()).toEqual([["no-var"], "xx"]);
        expect(await run("no-debugger")).toEqual([["no-debugger"], "xxx"]);
        expect(await run("no-debugger")).toEqual([["no-debugger"], "xxx"]);
        writeFileSync(at("eslint.config.cjs"), config("two"));
        age(at("eslint.config.cjs"), 30);
        expect(await run("no-debugger")).toEqual([["no-debugger"], "xxxx"]);
      },
      timeout,
    );

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
      "the first run is as the next: one that %s",
      async (_, config, isKept, exitCode) => {
        using dir = tempDir("bun-lint-platform", {
          "node_modules/.keep": "",
          "eslint.config.mjs": config,
          "a.js": "debugger;\nvar a;\n",
        });
        age(join(String(dir), "eslint.config.mjs"), 60);
        const run = async () => {
          const { stdout, stderr, exitCode } = await lint(dir, ["a.js"]);
          return { stdout, stderr: stderr.replace(/\[[\d.]+m?s\]/, "[time]"), exitCode };
        };
        const first = await run();
        // What fails is run again.
        expect(existsSync(join(String(dir), "node_modules", ".cache", "bun-lint"))).toBe(isKept);
        expect(await run()).toEqual(first);
        // What it prints is seen only if it fails.
        expect(first.stdout + first.stderr).not.toMatch(/\bout\b|\berr\b|\bold\b/);
        if (!isKept) expect(first.stderr).toMatch(/eslint\.config\.mjs:\r?\n./);
        expect(first.exitCode).toBe(exitCode);
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
        eslint: read("evaluate-track.js", "evaluate-describe.js", "evaluate-eslint.js"),
        prettier: read("evaluate-track.js", join("fmt", "evaluate-prettier.js")),
        tailwind: read("evaluate-track.js", join("fmt", "tailwind.js")),
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
