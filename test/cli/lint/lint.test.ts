import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, normalizeBunSnapshot, tempDir } from "harness";
import { existsSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { configurations } from "./oracle/plugins/oxlint/compare-options";
import whatOxlintReports from "./oracle/plugins/oxlint/expected.json";
import { directoryOf, filesOf, cases as fixCases } from "./oracle/plugins/oxlint/fixes";
import fixDifferences from "./oracle/plugins/oxlint/fixes.differences.json";
import whatOxlintFixes from "./oracle/plugins/oxlint/fixes.expected.json";
import optionsOfOxlint from "./oracle/plugins/oxlint/options.json";
import { projects } from "./oracle/plugins/oxlint/projects";

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
  await using proc = Bun.spawn({
    cmd: [...command, ...args],
    env: { ...env, ...options.env },
    cwd: join(String(dir), options.cwd ?? "."),
    stdin: options.stdin === undefined ? "ignore" : Buffer.from(options.stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
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

    test.skipIf(isWindows)("a link to a file is linted, a link to a directory is not followed", async () => {
      const before = (dir: string) => {
        symlinkSync("../a.js", join(dir, "src/deep/link.js"));
        symlinkSync("deep", join(dir, "src/linked"));
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
      isDebug || isASAN ? 120_000 : undefined,
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
        "<dir>/a.test.ts:1:27: Unexpected any. Specify a different type. [Warning/@typescript-eslint/no-explicit-any]
        <dir>/a.ts:1:1: Unexpected 'debugger' statement. [Error/no-debugger]
        <dir>/a.ts:1:17: Expected '===' and instead saw '=='. [Error/eqeqeq]

        3 problems"
      `);
      expect(exitCode).toBe(1);
    });

    describe("like oxlint, with an .oxlintrc.json", () => {
      test("--fix, --fix-suggestions, --fix-dangerously and --quiet change what oxlint's change", async () => {
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
              message: "Unexpected 'debugger' statement.",
              code: "eslint(no-debugger)",
              severity: "error",
              filename: "a.js",
              labels: [{ span: { offset: 0, length: 9, line: 1, column: 1 } }],
            },
            {
              message: "Expected '===' and instead saw '=='.",
              code: "eslint(eqeqeq)",
              severity: "warning",
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
          `"<?xml version="1.0" encoding="utf-8"?><checkstyle version="4.3"><file name="a.js"><error line="1" column="1" severity="error" message="Unexpected &apos;debugger&apos; statement." source="eslint(no-debugger)" /><error line="2" column="7" severity="warning" message="Expected &apos;===&apos; and instead saw &apos;==&apos;." source="eslint(eqeqeq)" /></file></checkstyle>"`,
        );
        expect(junit.stdout).toMatchInlineSnapshot(`
          "<?xml version="1.0" encoding="UTF-8"?>
          <testsuites name="Oxlint" tests="2" failures="1" errors="1">
              <testsuite name="a.js" tests="2" disabled="0" errors="1" failures="1">
                  <testcase name="eslint(no-debugger)">
                      <error message="Unexpected &apos;debugger&apos; statement.">line 1, column 1, Unexpected &apos;debugger&apos; statement.</error>
                  </testcase>
                  <testcase name="eslint(eqeqeq)">
                      <failure message="Expected &apos;===&apos; and instead saw &apos;==&apos;.">line 2, column 7, Expected &apos;===&apos; and instead saw &apos;==&apos;.</failure>
                  </testcase>
              </testsuite>
          </testsuites>"
        `);
        expect(JSON.parse(gitlab.raw).map(({ fingerprint, ...it }: any) => it)).toEqual([
          {
            description: "Unexpected 'debugger' statement.",
            check_name: "eslint(no-debugger)",
            severity: "critical",
            location: { path: "a.js", lines: { begin: 1, end: 1 } },
          },
          {
            description: "Expected '===' and instead saw '=='.",
            check_name: "eslint(eqeqeq)",
            severity: "major",
            location: { path: "a.js", lines: { begin: 2, end: 2 } },
          },
        ]);
        const run = JSON.parse(sarif.raw).runs[0];
        expect(run.results.map((it: any) => [it.ruleId, it.level, it.locations[0].physicalLocation.region])).toEqual([
          ["eslint(no-debugger)", "error", { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 }],
          ["eslint(eqeqeq)", "warning", { startLine: 2, startColumn: 7, endLine: 2, endColumn: 9 }],
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
        expect(none.stderr).toContain("No files found to lint. Please check your paths and ignore patterns.");
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
          "<dir>/src/a.js:1:1: Unexpected 'debugger' statement. [Error/no-debugger]

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
          "<dir>/a.ts:5:3: '#d' is defined but never used. [Error/no-unused-private-class-members]

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
      const expected = (names: string[]) =>
        Object.fromEntries(
          names.map(it => [it, [...new Set(whatOxlintReports[it as keyof typeof whatOxlintReports])]]),
        );

      test("the rules report what oxlint's report, where they report it", async () => {
        const some = projects.filter(it => !it.typed && it.name !== "no-cycle/many-files");
        const files: Record<string, string> = { ".oxlintrc.json": rc({ rules: {} }) };
        for (const { name, config, files: texts } of some) {
          files[`${name}/.oxlintrc.json`] = JSON.stringify(config);
          for (const [path, text] of Object.entries(texts)) files[`${name}/${path}`] = text;
        }
        const names = some.map(it => it.name);
        const { raw } = await lint(files, ["-f", "json"]);
        expect(found(raw, names)).toEqual(expected(names));
      });

      test("the rules that need types report what tsgolint's report", async () => {
        const some = projects.filter(it => it.typed);
        const compilerOptions = { strict: true, target: "esnext", module: "esnext", lib: ["esnext", "dom"] };
        const files: Record<string, string> = { ".oxlintrc.json": rc({ rules: {} }) };
        for (const { name, config, files: texts } of some) {
          files[`${name}/.oxlintrc.json`] = JSON.stringify(config);
          files[`${name}/tsconfig.json`] = JSON.stringify({ compilerOptions });
          for (const [path, text] of Object.entries(texts)) files[`${name}/${path}`] = text;
        }
        const names = some.map(it => it.name);
        const { raw } = await lint(files, ["-f", "json", "--type-aware"]);
        expect(found(raw, names)).toEqual(expected(names));
      });

      test.each([false, true])("--fix changes what oxlint --fix changes (rules that need types: %p)", async typed => {
        // fixes.expected.json is what oxlint 1.87.0 with tsgolint 7.0.2003 makes of the files. fixes.differences.json: not yet.
        const differs = (directory: string) => (fixDifferences as Record<string, string[]>)[directory]?.includes("fix");
        const some = fixCases
          .map((it, index) => ({ it, directory: directoryOf(index) }))
          .filter(({ it, directory }) => !!it.typed === typed && !differs(directory));
        expect(some.length).toBeGreaterThan(5);
        const files: Record<string, string> = { ".oxlintrc.json": rc({ rules: {} }) };
        for (const { it, directory } of some) {
          for (const [path, text] of Object.entries(filesOf(it))) files[`${directory}/${path}`] = text;
        }
        const reads = some.map(({ it, directory }) => `${directory}/${it.file}`);
        const result = await lint(files, ["--fix", ...(typed ? ["--type-aware"] : [])], { reads });
        expect(result.files).toEqual(
          Object.fromEntries(
            some.map(({ it, directory }) => [
              `${directory}/${it.file}`,
              whatOxlintFixes[directory as keyof typeof whatOxlintFixes].fix,
            ]),
          ),
        );
      });

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
        const { raw, stderr } = await lint(files, ["-f", "json"]);
        // What is refused is said there.
        expect(raw === "" ? stderr : JSON.parse(raw).number_of_files).toBe(configs.length);
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

    test("--fix-type", async () => {
      const result = await lint(files, ["--fix", "--fix-type", "layout", "a.js"], { reads: ["a.js"] });
      expect(result.files).toEqual({ "a.js": "var a = 1;\nif (a == 2) { debugger; }\n" });
    });

    test.skipIf(isWindows)("keeps the mode of the file, and a link to it", async () => {
      const result = await lint(files, ["--fix", "link.js"], {
        reads: ["a.js", "link.js"],
        before: dir => symlinkSync("a.js", join(dir, "link.js")),
      });
      expect(result.files["a.js"]).toBe("let a = 1;\nif (a == 2) { debugger; }\n");
      expect(result.files["link.js"]).toBe(result.files["a.js"]);
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

    // What typescript-eslint 8.71 says. `undefined`: nothing.
    test("no-deprecated finds the tags of a comment where TypeScript does", async () => {
      const comments: [comment: string, reason: string | undefined][] = [
        ["/** @deprecated a\\@b c */", "a\\@b c"],
        ["/** @deprecated mail a@b.c now */", "mail a@b.c now"],
        ["/** @deprecated x @ y */", "x @ y"],
        ["/** @deprecated x @y z */", "x"],
        ["/** @deprecated `x @y` z */", "`x @y` z"],
        ["/** text `a @deprecated b` c */", "b` c"],
        ["/** @deprecated (@see y) */", "(@see y)"],
        ["/** @deprecated a @*/", "a"],
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
});
