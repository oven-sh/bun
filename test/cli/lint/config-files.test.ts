import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { join } from "node:path";

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
  ESLINT_USE_FLAT_CONFIG: undefined,
};

type Options = { cwd?: string; env?: Record<string, string | undefined> };

/** What is reported, as `file:line:column rule`, what is printed on standard error, and the exit code. */
async function lint(files: Record<string, string>, args: string[] = ["."], options: Options = {}) {
  using dir = tempDir("bun-lint-config-files", files);
  await using proc = Bun.spawn({
    cmd: [...command, "--threads", "2", "-f", "unix", ...args],
    env: { ...env, ...options.env },
    cwd: join(String(dir), options.cwd ?? "."),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const problems = [
    ...normalizeBunSnapshot(stdout, String(dir)).matchAll(/^<dir>\/(.+?):(\d+):(\d+): .* \[\w+(?:\/(.+))?\]$/gm),
  ];
  return {
    problems: problems.map(([, file, line, column, rule]) => `${file}:${line}:${column} ${rule ?? "-"}`).sort(),
    stderr: normalizeBunSnapshot(stderr, String(dir)),
    exitCode,
  };
}

// eqeqeq 2:7, no-debugger 2:13, no-var 1:1
const code = "var x = 1;\nif (x == 2) debugger;\n";
const rc = (config: object) => JSON.stringify({ root: true, ...config });
const noVar = { rules: { "no-var": "error" } };

// The parts of @eslint/eslintrc that the functions of its `FlatCompat` are made of, in the shape that they have there.
const eslintrc = `
  const matchers = patterns => [patterns].flat().map(it =>
    it.startsWith("./") ? { pattern: it.slice(2), options: { matchBase: false } } : { pattern: it, options: { matchBase: true } });
  class OverrideTester {
    constructor(patterns, basePath) { Object.assign(this, { patterns, basePath }); }
    test() { return false; }
  }
  class ConfigArray extends Array {
    extractConfig() {
      const patterns = this.flatMap(it => it.ignorePatterns ?? []);
      return { ignores: Object.assign(() => false, { basePath: this.basePath, patterns }) };
    }
  }
  class FlatCompat {
    constructor({ baseDirectory }) { this.baseDirectory = baseDirectory; }
    config(config) {
      const elements = Object.assign(new ConfigArray(), { basePath: this.baseDirectory });
      const add = ({ files, excludedFiles, overrides = [], ...rest }, outer) => {
        const own = files ? [{ includes: matchers(files), excludes: excludedFiles ? matchers(excludedFiles) : null }] : [];
        const patterns = [...outer, ...own];
        elements.push({ ...rest, criteria: patterns.length > 0 ? new OverrideTester(patterns, this.baseDirectory) : null });
        for (const it of overrides) add(it, patterns);
      };
      add(config, []);
      const flat = elements.map(({ criteria, rules }) => ({ rules, ...(criteria && { files: [path => criteria.test(path)] }) }));
      if (elements.some(it => it.ignorePatterns)) flat.unshift({ ignores: [path => elements.extractConfig(path).ignores(path)] });
      return flat;
    }
  }
  module.exports = { FlatCompat, Legacy: { OverrideTester, ConfigArray } };`;

describe.concurrent("a function in an eslint.config.js", () => {
  test.each(["files", "ignores"])("in `%s` is an error", async key => {
    const { problems, stderr, exitCode } = await lint({
      "eslint.config.mjs": `export default [{ rules: { "no-var": "error" } }, { name: "mine", ${key}: [path => path.endsWith(".ts")], rules: { "no-debugger": "error" } }];`,
      "a.ts": code,
      "b.js": code,
    });
    expect(problems).toEqual([]);
    expect(stderr).toContain(`Config "mine": Key "${key}": A function is not supported, at user-defined index 1.`);
    expect(exitCode).toBe(2);
  });

  test("those of `FlatCompat` are the patterns that they are made of", async () => {
    const { problems, stderr, exitCode } = await lint({
      "node_modules/@eslint/eslintrc/index.js": eslintrc,
      "eslint.config.mjs": `
        import { FlatCompat } from "@eslint/eslintrc";
        export default new FlatCompat({ baseDirectory: import.meta.dirname }).config({
          ignorePatterns: ["ignored.js", "/build"],
          rules: { "no-var": "error" },
          overrides: [
            { files: ["*.ts", "*.mts"], excludedFiles: "*.d.ts", rules: { "no-debugger": "error" } },
            { files: "src/**/*.js", rules: { eqeqeq: "error" }, overrides: [{ files: "./src/only.js", rules: { "no-var": "off" } }] },
          ],
        });`,
      "a.js": code,
      "b.ts": code,
      "c.d.ts": code,
      "ignored.js": code,
      "build/d.js": code,
      ".hidden.js": code,
      "src/e.js": code,
      "src/only.js": code,
      "src/deep/only.js": code,
      "src/ignored.js": code,
    });
    expect(stderr).not.toContain("function");
    expect(problems).toEqual([
      "a.js:1:1 no-var",
      "b.ts:1:1 no-var",
      "b.ts:2:13 no-debugger",
      "src/deep/only.js:1:1 no-var",
      "src/deep/only.js:2:7 eqeqeq",
      "src/e.js:1:1 no-var",
      "src/e.js:2:7 eqeqeq",
      "src/only.js:2:7 eqeqeq",
    ]);
    expect(exitCode).toBe(1);
  });
});

describe.concurrent("an eslint.config.js", () => {
  test("the options of the language of a plugin are not those of JavaScript", async () => {
    const { problems, stderr } = await lint({
      "eslint.config.mjs": `export default [
        { rules: { "no-var": "error" } },
        { files: ["**/*.jsonc"], plugins: { j: { languages: { jsonc: {} } } }, language: "j/jsonc", languageOptions: { allowTrailingCommas: true } },
      ];`,
      "a.js": code,
      "b.jsonc": "[1,]\n",
    });
    expect(stderr).not.toContain("allowTrailingCommas");
    expect(problems).toEqual(["a.js:1:1 no-var"]);
  });

  test("one that exports nothing is an error", async () => {
    const { problems, stderr, exitCode } = await lint({ "eslint.config.mjs": "export const a = 1;\n", "a.js": code });
    expect(problems).toEqual([]);
    expect(stderr).toContain("<dir>/eslint.config.mjs exports nothing.");
    expect(exitCode).toBe(2);
  });

  test('`type: "any"` in the schema of a rule allows everything', async () => {
    const { problems, stderr, exitCode } = await lint({
      "plugin.mjs": `export default { rules: { r: { meta: { schema: [{ type: "array", items: { type: "any" } }] }, create: context => ({ DebuggerStatement: node => context.report({ node, message: "found" }) }) } } };`,
      "eslint.config.mjs": `import p from "./plugin.mjs";\nexport default [{ ignores: ["plugin.mjs"] }, { plugins: { p }, rules: { "p/r": ["error", [{ a: 1 }, 1, "a"]] } }];`,
      "a.js": code,
    });
    expect(stderr).not.toContain("should be");
    expect(problems).toEqual(["a.js:2:13 p/r"]);
    expect(exitCode).toBe(1);
  });
});

describe.concurrent("an .oxlintrc.json", () => {
  test("only comments that disable rules configure anything", async () => {
    const { problems, exitCode } = await lint({
      ".oxlintrc.json": JSON.stringify({
        categories: { correctness: "off" },
        rules: { "no-var": "error", "no-undef": "error" },
      }),
      "env.js": "/* eslint-env mocha */\n",
      "rules.js": '/* eslint no-var: "off", no-debugger: "error" */\nvar a = 1;\ndebugger;\n',
      "global.js": "/* global b */\nb;\n",
      "broken.js": "/* eslint no-var: [ */\n/* globals c: nonsense */\n",
      "disabled.js": "// eslint-disable-next-line no-var\nvar d = 1;\n",
    });
    expect(problems).toEqual(["global.js:2:1 no-undef", "rules.js:2:1 no-var"]);
    expect(exitCode).toBe(1);
  });

  test.each([
    ["base.json", "base.json"],
    ["configs/base.json", "configs/base.json"],
    ["./base", "base"],
    [".base", ".base"],
  ])("`extends` %j is a path", async (name, file) => {
    const { problems, exitCode } = await lint({
      ".oxlintrc.json": JSON.stringify({ categories: { correctness: "off" }, extends: [name] }),
      [file]: JSON.stringify(noVar),
      "a.js": code,
    });
    expect(problems).toEqual(["a.js:1:1 no-var"]);
    expect(exitCode).toBe(1);
  });

  test.each(["nowhere.json", "./nowhere.json", "shared", "@scope/shared", "configs/base"])(
    "`extends` %j, which is no file or the name of a package, is an error",
    async name => {
      const { problems, stderr, exitCode } = await lint({
        ".oxlintrc.json": JSON.stringify({ categories: { correctness: "off" }, extends: [name] }),
        "node_modules/shared/index.json": JSON.stringify(noVar),
        "configs/base": JSON.stringify(noVar),
        "a.js": code,
      });
      expect(problems).toEqual([]);
      expect(stderr).toContain("<dir>/.oxlintrc.json");
      expect(stderr).toContain(JSON.stringify(name));
      expect(exitCode).toBe(2);
    },
  );
});

describe.concurrent("an .eslintrc.json", () => {
  test.each([
    [{ extends: "next/core-web-vitals" }, 'It extends "next/core-web-vitals". A configuration that is a package'],
    [{ extends: ["eslint:recommended", "airbnb"] }, 'It extends "airbnb". A configuration that is a package'],
    [{ extends: "plugin:unicorn/recommended" }, 'It extends "plugin:unicorn/recommended".'],
    [{ plugins: ["unicorn"] }, 'It uses the plugin "unicorn".'],
    [{ plugins: ["@scope/eslint-plugin"] }, 'It uses the plugin "@scope/eslint-plugin".'],
    [{ overrides: [{ files: ["*.js"], plugins: ["eslint-plugin-unicorn"] }] }, 'the plugin "eslint-plugin-unicorn".'],
    [{ extends: "./nowhere.json" }, 'Failed to load config "./nowhere.json" to extend from.'],
  ])("%j, which names a package or no file, is an error", async (config, message) => {
    const { problems, stderr, exitCode } = await lint({
      ".eslintrc.json": rc({ ...config, rules: { "no-var": "error" } }),
      "node_modules/eslint-config-airbnb/index.js": "module.exports = {};",
      "node_modules/eslint-plugin-unicorn/index.js": "module.exports = { configs: { recommended: {} } };",
      "a.js": code,
    });
    expect(problems).toEqual([]);
    expect(stderr).toContain("<dir>/.eslintrc.json");
    expect(stderr).toContain(message);
    expect(exitCode).toBe(2);
  });

  test("what is built in is not a package", async () => {
    const { problems, exitCode } = await lint({
      ".eslintrc.json": rc({
        extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended", "./base.json"],
        plugins: ["@typescript-eslint", "@typescript-eslint/eslint-plugin", "eslint-plugin-import", "n"],
      }),
      "base.json": JSON.stringify(noVar),
      "a.js": code,
    });
    expect(problems).toEqual(["a.js:1:1 no-var", "a.js:2:13 no-debugger"]);
    expect(exitCode).toBe(1);
  });
});

describe.concurrent("whose configuration files count", () => {
  test("an eslint.config.js further down is not read", async () => {
    const { problems, exitCode } = await lint({
      ".oxlintrc.json": JSON.stringify({ categories: { correctness: "off" }, rules: { "no-var": "error" } }),
      "a.js": code,
      "sub/eslint.config.js": `import "a-package-that-is-not-installed";`,
      "sub/b.js": code,
      "sub/deeper/.oxlintrc.json": JSON.stringify({ categories: { correctness: "off" }, rules: { eqeqeq: "error" } }),
      "sub/deeper/c.js": code,
    });
    expect(problems).toEqual(["a.js:1:1 no-var", "sub/b.js:1:1 no-var", "sub/deeper/c.js:2:7 eqeqeq"]);
    expect(exitCode).toBe(1);
  });

  test("a file of ESLint 8 further down is not read", async () => {
    const { problems, exitCode } = await lint({
      ".oxlintrc.json": JSON.stringify({ categories: { correctness: "off" }, rules: { "no-var": "error" } }),
      "a.js": code,
      "sub/.eslintrc": "not: [valid",
      "sub/b.js": code,
    });
    expect(problems).toEqual(["a.js:1:1 no-var", "sub/b.js:1:1 no-var"]);
    expect(exitCode).toBe(1);
  });

  // What is left over from ESLint in examples, fixtures and templates.
  test("below an .oxlintrc.json, also one above the working directory, no file of ESLint ends the run", async () => {
    const files = {
      ".oxlintrc.json": JSON.stringify({ categories: { correctness: "off" }, rules: { "no-var": "error" } }),
      "docs/fiddles/.eslintrc.json": `{ "extends": "standard", "rules": { "import/order": "off" } }`,
      "docs/fiddles/a.js": code,
    };
    for (const [args, cwd] of [
      [["docs/fiddles"], "."],
      [["docs/fiddles/a.js"], "."],
      [["."], "docs"],
    ] as const) {
      const { problems, exitCode } = await lint(files, [...args], { cwd });
      expect(problems).toEqual(["docs/fiddles/a.js:1:1 no-var"]);
      expect(exitCode).toBe(1);
    }
  });

  test("an .oxlintrc.json below an eslint.config.js is not read", async () => {
    const { problems } = await lint({
      "eslint.config.js": `module.exports = [{ rules: { "no-var": "error" } }];`,
      "a.js": code,
      "sub/.oxlintrc.json": "not JSON",
      "sub/b.js": code,
    });
    expect(problems).toEqual(["a.js:1:1 no-var", "sub/b.js:1:1 no-var"]);
  });

  test("where the working directory has no configuration, each directory tells", async () => {
    const { problems } = await lint({
      "one/eslint.config.js": `module.exports = [{ rules: { "no-var": "error" } }];`,
      "one/a.js": code,
      "two/.oxlintrc.json": JSON.stringify({ categories: { correctness: "off" }, rules: { eqeqeq: "error" } }),
      "two/b.js": code,
      "three/.eslintrc.json": rc({ rules: { "no-debugger": "error" } }),
      "three/c.js": code,
    });
    expect(problems).toEqual(["one/a.js:1:1 no-var", "three/c.js:2:13 no-debugger", "two/b.js:2:7 eqeqeq"]);
  });
});
