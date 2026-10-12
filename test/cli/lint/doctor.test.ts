import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

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

async function doctor(files: Record<string, string>, args: string[] = []) {
  using dir = tempDir("bun-lint-doctor", files);
  const list = () => (readdirSync(String(dir), { recursive: true }) as string[]).sort();
  const before = list();
  await using proc = spawn({
    cmd: [bunExe(), "lint", "--threads", "2", "--doctor", ...args],
    env,
    cwd: String(dir),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const isUntouched =
    Bun.deepEquals(list(), before) &&
    Object.entries(files).every(([name, text]) => readFileSync(join(String(dir), name), "utf8") === text);
  return { stdout, stderr, exitCode, isUntouched };
}

/** A package with a plugin for ESLint that has `rules`, none of which reports anything. */
function plugin(name: string, rules: string[], { isModule = false, version = "99.0.0" } = {}) {
  const object = `{ meta: { name: ${JSON.stringify(name)}, version: ${JSON.stringify(version)} }, rules: { ${rules
    .map(rule => `${JSON.stringify(rule)}: { create: () => ({}) }`)
    .join(", ")} } }`;
  return {
    [`node_modules/${name}/package.json`]: JSON.stringify({
      name,
      version,
      main: "index.js",
      type: isModule ? "module" : "commonjs",
    }),
    [`node_modules/${name}/index.js`]: isModule ? `export default ${object};` : `module.exports = ${object};`,
  };
}

const dependencies = (...names: string[]) =>
  JSON.stringify({ name: "app", type: "module", devDependencies: Object.fromEntries(names.map(name => [name, "*"])) });

// A VM is started for a plugin that only a VM can describe, which takes seconds in a debug build.
const timeout = isDebug || isASAN ? 120_000 : 10_000;

const flat = {
  ...plugin("eslint-plugin-first", ["a", "b"]),
  ...plugin("eslint-plugin-second", ["c"], { isModule: true }),
  ...plugin("eslint-plugin-react-hooks", ["rules-of-hooks", "exhaustive-deps"]),
  "package.json": dependencies(
    "eslint",
    "eslint-plugin-first",
    "eslint-plugin-second",
    "eslint-plugin-react-hooks",
    "eslint-plugin-never-imported",
    "typescript",
  ),
  "eslint.config.js": `
    import first from "eslint-plugin-first";
    import second from "eslint-plugin-second";
    import hooks from "eslint-plugin-react-hooks";
    const local = { rules: { x: { create: () => ({}) } } };
    export default [
      {
        plugins: { first, second, "react-hooks": hooks, local },
        rules: {
          "no-var": "error",
          eqeqeq: "warn",
          "no-console": "off",
          "first/a": "error",
          "second/c": "error",
          "local/x": "warn",
          "react-hooks/rules-of-hooks": "error",
          indent: "error",
          "no-such-rule": "error",
        },
      },
      { files: ["**/*.ts"], rules: { "first/b": "error", "no-undef": "error", eqeqeq: "off" } },
    ];`,
  "src/a.js": "var a = 1;\n",
  "src/b.ts": "var b = 1;\n",
};

describe.concurrent("bun lint --doctor", () => {
  test(
    "with an eslint.config.js",
    async () => {
      const { stdout, stderr, exitCode, isUntouched } = await doctor(flat);
      expect(stderr).toBe("");
      expect(stdout).toBe(`Using eslint.config.js (ESLint flat config)

    3 files to lint

    4 rules run natively
    4 rules run in JavaScript
        eslint-plugin-first     2
        eslint-plugin-second    1
        eslint.config.js        1
    2 rules do not run
        1 is not supported: no-such-rule
        1 is a formatting rule, use bun format: indent

You can remove: eslint, eslint-plugin-never-imported
Still needed:   eslint-plugin-first, eslint-plugin-second (their rules run in JavaScript)
                eslint-plugin-react-hooks (eslint.config.js loads it)
`);
      expect(isUntouched).toBe(true);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "-f json has the same as data",
    async () => {
      const { stdout, exitCode } = await doctor(flat, ["-f", "json"]);
      expect(JSON.parse(stdout)).toEqual({
        config: { path: "eslint.config.js", kind: "eslint", nested: [] },
        files: { linted: 3, by_eslint: {}, not_linted: {} },
        rules: {
          native: ["eqeqeq", "no-undef", "no-var", "react-hooks/rules-of-hooks"],
          javascript: {
            "eslint-plugin-first": ["first/a", "first/b"],
            "eslint-plugin-second": ["second/c"],
            "eslint.config.js": ["local/x"],
          },
          not_run: [
            { rule: "no-such-rule", reason: "not_supported" },
            { rule: "indent", reason: "formatting" },
          ],
        },
        packages: {
          removable: ["eslint", "eslint-plugin-never-imported"],
          needed: [
            { name: "eslint-plugin-first", reason: "rules" },
            { name: "eslint-plugin-react-hooks", reason: "config" },
            { name: "eslint-plugin-second", reason: "rules" },
          ],
        },
        notes: [],
      });
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "counts the rules of the files that the arguments select",
    async () => {
      const { stdout, exitCode } = await doctor(flat, ["-f", "json", "src/a.js"]);
      const { files, rules } = JSON.parse(stdout);
      expect(files.linted).toBe(1);
      expect(rules.native).toEqual(["eqeqeq", "no-var", "react-hooks/rules-of-hooks"]);
      expect(rules.javascript["eslint-plugin-first"]).toEqual(["first/a"]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "--no-native-plugin-rules sends the rules of a plugin to its package",
    async () => {
      const { stdout, exitCode } = await doctor(flat, ["-f", "json", "--no-native-plugin-rules"]);
      const { rules, packages } = JSON.parse(stdout);
      expect(rules.native).toEqual(["eqeqeq", "no-undef", "no-var"]);
      expect(rules.javascript["eslint-plugin-react-hooks"]).toEqual(["react-hooks/rules-of-hooks"]);
      expect(packages.needed).toContainEqual({ name: "eslint-plugin-react-hooks", reason: "rules" });
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "with an .oxlintrc.json",
    async () => {
      const { stdout, stderr, exitCode, isUntouched } = await doctor({
        ...plugin("eslint-plugin-first", ["a", "b"]),
        "package.json": dependencies("oxlint", "oxlint-tsgolint", "eslint-plugin-first"),
        ".oxlintrc.json": JSON.stringify({
          categories: { correctness: "off" },
          ignorePatterns: ["node_modules"],
          plugins: ["typescript", "unicorn", "vue"],
          jsPlugins: ["eslint-plugin-first"],
          rules: {
            "no-var": "error",
            "unicorn/no-null": "warn",
            "first/a": "error",
            "typescript/no-floating-promises": "error",
            "vue/no-arrow-functions-in-watch": "error",
          },
        }),
        "a.ts": "var a = null;\n",
      });
      expect(stderr).toBe("");
      expect(stdout).toBe(`Using .oxlintrc.json (oxlint config)

    1 file to lint

    2 rules run natively
    1 rule runs in JavaScript
        eslint-plugin-first    1
    2 rules do not run
        1 is not supported: vue/no-arrow-functions-in-watch
        1 needs types, use --type-aware: @typescript-eslint/no-floating-promises

You can remove: oxlint, oxlint-tsgolint
Still needed:   eslint-plugin-first (its rules run in JavaScript)
`);
      expect(isUntouched).toBe(true);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  test("of the rules that lose nothing it names a few", async () => {
    const files = {
      "eslint.config.js": `export default [{ rules: { indent: 2, semi: 2, quotes: 2, "comma-dangle": 2, "no-such-rule": 2, "nor-this": 2, "nor-that": 2, "nor-any": 2 } }];`,
    };
    const [text, json] = await Promise.all([doctor(files), doctor(files, ["-f", "json"])]);
    expect(text.stdout).toContain(`
    8 rules do not run
        4 are not supported: no-such-rule, nor-any, nor-that, nor-this
        4 are formatting rules, use bun format: comma-dangle, indent, quotes, ..
`);
    expect(JSON.parse(json.stdout).rules.not_run).toContainEqual({ rule: "semi", reason: "formatting" });
    expect(text.exitCode).toBe(0);
  });

  test("the rules for React are on in a project that depends on it", async () => {
    const native = async (dependency: string) => {
      const files = { "package.json": dependencies(dependency), "a.jsx": "" };
      return JSON.parse((await doctor(files, ["-f", "json"])).stdout).rules.native;
    };
    const [withReact, without] = await Promise.all([native("react"), native("preact")]);
    expect(withReact).toContain("react-hooks/rules-of-hooks");
    expect(without).not.toContain("react-hooks/rules-of-hooks");
    expect(withReact.length).toBeGreaterThan(without.length);
  });

  test("--type-aware runs the rules that need types", async () => {
    const { stdout, exitCode } = await doctor(
      {
        ".oxlintrc.json": JSON.stringify({
          categories: { correctness: "off" },
          rules: { "typescript/no-floating-promises": "error" },
        }),
        "tsconfig.json": "{}",
        "a.ts": "export {};\n",
      },
      ["-f", "json", "--type-aware"],
    );
    const { rules } = JSON.parse(stdout);
    expect(rules).toEqual({ native: ["@typescript-eslint/no-floating-promises"], javascript: {}, not_run: [] });
    expect(exitCode).toBe(0);
  });

  test(
    "with an .eslintrc.json",
    async () => {
      const { stdout, exitCode } = await doctor(
        {
          ...plugin("eslint-plugin-first", ["a", "b"]),
          "package.json": dependencies("eslint", "eslint-plugin-first"),
          ".eslintrc.json": JSON.stringify({
            root: true,
            plugins: ["first"],
            rules: { "no-var": "error", "first/a": "error", semi: "error" },
          }),
          "a.js": "var a = 1;\n",
        },
        ["-f", "json"],
      );
      const { config, rules, packages } = JSON.parse(stdout);
      expect(config).toEqual({ path: ".eslintrc.json", kind: "eslintrc", nested: [] });
      expect(rules).toEqual({
        native: ["no-var"],
        javascript: { "eslint-plugin-first": ["first/a"] },
        not_run: [{ rule: "semi", reason: "formatting" }],
      });
      expect(packages).toEqual({ removable: ["eslint"], needed: [{ name: "eslint-plugin-first", reason: "rules" }] });
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "says what a run says about the versions of plugins",
    async () => {
      const files = { ...flat, ...plugin("eslint-plugin-react-hooks", ["rules-of-hooks"], { version: "1.0.0" }) };
      const [text, json] = await Promise.all([doctor(files), doctor(files, ["-f", "json"])]);
      const note = /^eslint-plugin-react-hooks 1\.0\.0 is installed; bun lint follows [\d.]+\.$/;
      expect(JSON.parse(json.stdout).notes).toEqual([expect.stringMatching(note)]);
      expect(text.stdout).toEndWith(`\n\nnote: ${JSON.parse(json.stdout).notes[0]}\n`);
      expect(text.exitCode).toBe(0);
    },
    timeout,
  );

  test("files that only the parser of the config reads go to the installed ESLint", async () => {
    const files = {
      "package.json": dependencies("eslint"),
      "eslint.config.js": `
        const parser = { meta: { name: "my-parser" }, parse() {} };
        export default [{ rules: { "no-var": "error" } }, { files: ["**/*.foo"], languageOptions: { parser } }];`,
      "a.js": "",
      "b.foo": "",
      "c.foo": "",
    };
    const eslint = { "node_modules/eslint/package.json": JSON.stringify({ name: "eslint", version: "10.0.0" }) };
    const [installed, missing] = await Promise.all([doctor({ ...files, ...eslint }), doctor(files)]);
    expect(installed.stdout).toBe(`Using eslint.config.js (ESLint flat config)

    4 files to lint
    2 of them go to your installed ESLint: 2 *.foo

    1 rule runs natively
    0 rules run in JavaScript

Still needed:   eslint (some files go to it)
`);
    expect(missing.stdout).toBe(`Using eslint.config.js (ESLint flat config)

    2 files to lint
    2 files cannot be linted: 2 *.foo

    1 rule runs natively
    0 rules run in JavaScript

You can remove: eslint
`);
    expect(installed.exitCode).toBe(0);
    expect(missing.exitCode).toBe(0);
  });

  test("names the config files further down", async () => {
    const { stdout, exitCode } = await doctor({
      "eslint.config.js": `export default [{ rules: { "no-var": "error" } }];`,
      "packages/a/eslint.config.js": `export default [{ rules: { eqeqeq: "error" } }];`,
      "a.js": "",
      "packages/a/b.js": "",
    });
    expect(stdout).toStartWith(`Using eslint.config.js (ESLint flat config)
Also packages/a/eslint.config.js

    4 files to lint

    2 rules run natively
    0 rules run in JavaScript
`);
    expect(exitCode).toBe(0);
  });

  test("without a config file", async () => {
    const { stdout, stderr, exitCode, isUntouched } = await doctor({
      "package.json": dependencies("typescript"),
      "a.ts": "var a = 1;\n",
    });
    expect(stderr).toBe("");
    expect(stdout).toStartWith("No ESLint or oxlint config found. Using Bun's defaults.\n\n    1 file to lint\n\n");
    expect(stdout).toMatch(/^ +\d+ rules are on\n( {8}\S+ +\d+\n)*? {8}eslint +\d+\n/m);
    expect(stdout).toMatch(/^ {8}@typescript-eslint +\d+$/m);
    expect(stdout).toMatch(/^ {8}bun:test +\d+$/m);
    expect(stdout).not.toContain("JavaScript");
    expect(stdout).toEndWith("\nRun bun lint --init to add a [lint] section to bunfig.toml\n");
    expect(isUntouched).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("without a config file, [lint.rules] of bunfig.toml count", async () => {
    const files = { "a.js": "" };
    const [plain, configured] = await Promise.all([
      doctor(files, ["-f", "json"]),
      doctor({ ...files, "bunfig.toml": `[lint.rules]\n"no-console" = "warn"\n"no-debugger" = "off"\n` }, [
        "-f",
        "json",
      ]),
    ]);
    const [before, after] = [JSON.parse(plain.stdout), JSON.parse(configured.stdout)];
    expect(before.config).toEqual({ path: null, kind: "none", nested: [] });
    expect(after.config).toEqual(before.config);
    expect(before.rules.native).toContain("no-debugger");
    expect(before.rules.native).not.toContain("no-console");
    expect(after.rules.native).toEqual(
      [...before.rules.native.filter((it: string) => it !== "no-debugger"), "no-console"].sort(),
    );
    expect(configured.exitCode).toBe(0);
  });

  test("without any file to lint it says what a file would have", async () => {
    const { stdout, exitCode } = await doctor({ "README.md": "" }, ["-f", "json"]);
    const { files, rules } = JSON.parse(stdout);
    expect(files.linted).toBe(0);
    expect(rules.native).toContain("no-debugger");
    expect(rules.native).toContain("@typescript-eslint/no-explicit-any");
    expect(exitCode).toBe(0);
  });

  test("a config file that cannot be read is an error", async () => {
    const { stdout, stderr, exitCode } = await doctor({
      "eslint.config.js": `throw new Error("broken on purpose");`,
      "a.js": "",
    });
    expect(stdout).toBe("");
    expect(stderr).toContain("broken on purpose");
    expect(exitCode).toBe(2);
  });

  test("a config that ESLint refuses is an error", async () => {
    const { stdout, stderr, exitCode } = await doctor({
      "eslint.config.js": `export default [{ rules: { eqeqeq: ["error", "sometimes"] } }];`,
      "a.js": "",
    });
    expect(stdout).toBe("");
    expect(stderr).toContain(`Key "rules": Key "eqeqeq"`);
    expect(exitCode).toBe(2);
  });

  test("the lint script of package.json does not take its place", async () => {
    const { stdout, exitCode } = await doctor({
      "package.json": JSON.stringify({ scripts: { lint: "echo the script" } }),
      "a.js": "",
    });
    expect(stdout).toStartWith("No ESLint or oxlint config found.");
    expect(exitCode).toBe(0);
  });
});
