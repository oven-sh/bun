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
});

describe.concurrent("an .oxlintrc.json", () => {
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
