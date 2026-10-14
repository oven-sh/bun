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

/** Files for an installed ESLint plugin with the given `rules`. None of them reports anything. */
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

// Plugins that aren't built in get loaded in a JavaScript VM, and starting one takes seconds in a debug build.
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
        1 is a formatting rule, use bun fmt: indent

You can remove: eslint, eslint-plugin-never-imported
Still needed:   eslint-plugin-first, eslint-plugin-second (their rules run in JavaScript)
                eslint-plugin-react-hooks (eslint.config.js loads it)
Not checked:    other tools' configs, CI files, Git hooks
`);
      expect(isUntouched).toBe(true);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "-f json prints the same report as JSON",
    async () => {
      const { stdout, exitCode } = await doctor(flat, ["-f", "json"]);
      expect(JSON.parse(stdout)).toEqual({
        config: { path: "eslint.config.js", kind: "eslint", nested: [], ignored: null, bunfig: null },
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
            { name: "eslint-plugin-first", reason: "rules", by: null },
            { name: "eslint-plugin-react-hooks", reason: "config", by: "eslint.config.js" },
            { name: "eslint-plugin-second", reason: "rules", by: null },
          ],
          not_checked: ["other tools' configs", "CI files", "Git hooks"],
        },
        notes: [],
      });
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "only counts rules for the files that the arguments select",
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
    "--no-native-plugin-rules runs a plugin's rules from its package",
    async () => {
      const { stdout, exitCode } = await doctor(flat, ["-f", "json", "--no-native-plugin-rules"]);
      const { rules, packages } = JSON.parse(stdout);
      expect(rules.native).toEqual(["eqeqeq", "no-undef", "no-var"]);
      expect(rules.javascript["eslint-plugin-react-hooks"]).toEqual(["react-hooks/rules-of-hooks"]);
      expect(packages.needed).toContainEqual({ name: "eslint-plugin-react-hooks", reason: "rules", by: null });
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
Not checked:    other tools' configs, CI files, Git hooks
`);
      expect(isUntouched).toBe(true);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  test("lists every unsupported rule, but only the first few formatting rules", async () => {
    const files = {
      "eslint.config.js": `export default [{ rules: { indent: 2, semi: 2, quotes: 2, "comma-dangle": 2, "no-such-rule": 2, "nor-this": 2, "nor-that": 2, "nor-any": 2 } }];`,
    };
    const [text, json] = await Promise.all([doctor(files), doctor(files, ["-f", "json"])]);
    expect(text.stdout).toContain(`
    8 rules do not run
        4 are not supported: no-such-rule, nor-any, nor-that, nor-this
        4 are formatting rules, use bun fmt: comma-dangle, indent, quotes, ..
`);
    expect(JSON.parse(json.stdout).rules.not_run).toContainEqual({ rule: "semi", reason: "formatting" });
    expect(text.exitCode).toBe(0);
  });

  test("the React rules are on in a project that depends on react", async () => {
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
      expect(config).toEqual({ path: ".eslintrc.json", kind: "eslintrc", nested: [], ignored: null, bunfig: null });
      expect(rules).toEqual({
        native: ["no-var"],
        javascript: { "eslint-plugin-first": ["first/a"] },
        not_run: [{ rule: "semi", reason: "formatting" }],
      });
      expect(packages.removable).toEqual(["eslint"]);
      expect(packages.needed).toEqual([{ name: "eslint-plugin-first", reason: "rules", by: null }]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "repeats the note that a normal run prints about plugin versions",
    async () => {
      const files = { ...flat, ...plugin("eslint-plugin-react-hooks", ["rules-of-hooks"], { version: "1.0.0" }) };
      const [text, json] = await Promise.all([doctor(files), doctor(files, ["-f", "json"])]);
      const note = /^eslint-plugin-react-hooks 1\.0\.0 is installed/;
      expect(JSON.parse(json.stdout).notes).toEqual([expect.stringMatching(note)]);
      expect(text.stdout).toEndWith(`\n\nnote: ${JSON.parse(json.stdout).notes[0]}\n`);
      expect(text.exitCode).toBe(0);
    },
    timeout,
  );

  test("files that need the config's custom parser go to the installed ESLint", async () => {
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
        Install eslint to lint them

    1 rule runs natively
    0 rules run in JavaScript

Still needed:   eslint (some files go to it)
`);
    expect(installed.exitCode).toBe(0);
    expect(missing.exitCode).toBe(0);
  });

  test("with both an ESLint and an oxlint config, says which one is used and why", async () => {
    const files = {
      "eslint.config.js": `export default [{ rules: { "no-var": "error", eqeqeq: "error" } }];`,
      ".oxlintrc.json": JSON.stringify({ categories: { correctness: "off" }, rules: { "no-debugger": "error" } }),
      "a.js": "",
    };
    const [text, json, picked] = await Promise.all([
      doctor(files),
      doctor(files, ["-f", "json"]),
      doctor(files, ["--config", "eslint.config.js"]),
    ]);
    expect(text.stderr).toBe("");
    expect(text.stdout).toStartWith(`Using .oxlintrc.json (oxlint config)
eslint.config.js is ignored because the project also has an oxlint config. Use --config to pick it.

    2 files to lint

    1 rule runs natively
`);
    expect(JSON.parse(json.stdout).config).toEqual({
      path: ".oxlintrc.json",
      kind: "oxlint",
      nested: [],
      ignored: "eslint.config.js",
      bunfig: null,
    });
    expect(picked.stdout).toStartWith(`Using eslint.config.js (ESLint flat config)

    2 files to lint

    2 rules run natively
`);
    expect(text.exitCode).toBe(0);
    expect(picked.exitCode).toBe(0);
  });

  test("only packages named like linter tooling are removable", async () => {
    const names = [
      "eslint",
      "oxlint",
      "oxlint-tsgolint",
      "typescript-eslint",
      "@eslint/js",
      "@typescript-eslint/parser",
      "eslint-plugin-a",
      "@scope/eslint-plugin",
      "@scope/eslint-plugin-a",
      "eslint-config-a",
      "@scope/eslint-config",
      "@scope/eslint-config-a",
      "eslint-import-resolver-typescript",
    ];
    const others = [
      "vite-plugin-eslint",
      "eslint-webpack-plugin",
      "@nuxt/eslint",
      "@rollup/plugin-eslint",
      "eslint-pluginish",
      "eslint-plugin",
      "prettier-eslint",
      "globals",
    ];
    const { stdout, exitCode } = await doctor(
      {
        "package.json": dependencies(...names, ...others),
        "eslint.config.js": `export default [{ rules: { "no-var": "error" } }];`,
      },
      ["-f", "json"],
    );
    expect(JSON.parse(stdout).packages).toEqual({
      removable: names.toSorted(),
      needed: [],
      not_checked: ["other tools' configs", "CI files", "Git hooks"],
    });
    expect(exitCode).toBe(0);
  });

  test("a package used by a script, lint-staged or another dependency is still needed", async () => {
    const installed = (name: string, fields: object) => ({
      [`node_modules/${name}/package.json`]: JSON.stringify({ name, version: "1.0.0", ...fields }),
    });
    const files = {
      "package.json": JSON.stringify({
        type: "module",
        scripts: {
          build: "vite build",
          lint: "cross-env CI=1 eslint . && echo done",
          "lint:ox": "node_modules/.bin/oxlint",
        },
        "lint-staged": { "*.ts": ["@scope/eslint-config-cli --fix", "git add"] },
        devDependencies: Object.fromEntries(
          [
            "eslint",
            "oxlint",
            "@scope/eslint-config-cli",
            "vite-plugin-eslint",
            "eslint-plugin-of-vite",
            "eslint-config-of-the-plugin",
            "eslint-plugin-free",
          ].map(name => [name, "*"]),
        ),
      }),
      ...installed("vite-plugin-eslint", { peerDependencies: { eslint: "*", "eslint-plugin-of-vite": "*" } }),
      ...installed("eslint-plugin-of-vite", { dependencies: { "eslint-config-of-the-plugin": "*" } }),
      "eslint.config.js": `export default [{ rules: { "no-var": "error" } }];`,
    };
    const [text, json] = await Promise.all([doctor(files), doctor(files, ["-f", "json"])]);
    expect(text.stdout).toEndWith(`
You can remove: eslint-plugin-free
Still needed:   @scope/eslint-config-cli (lint-staged runs it)
                eslint (the "lint" script runs it)
                eslint-config-of-the-plugin (eslint-plugin-of-vite needs it)
                eslint-plugin-of-vite (vite-plugin-eslint needs it)
                oxlint (the "lint:ox" script runs it)
Not checked:    other tools' configs, CI files, Git hooks
`);
    expect(JSON.parse(json.stdout).packages).toEqual({
      removable: ["eslint-plugin-free"],
      needed: [
        { name: "@scope/eslint-config-cli", reason: "lint_staged", by: null },
        { name: "eslint", reason: "script", by: "lint" },
        { name: "eslint-config-of-the-plugin", reason: "dependent", by: "eslint-plugin-of-vite" },
        { name: "eslint-plugin-of-vite", reason: "dependent", by: "vite-plugin-eslint" },
        { name: "oxlint", reason: "script", by: "lint:ox" },
      ],
      not_checked: ["other tools' configs", "CI files", "Git hooks"],
    });
    expect(text.exitCode).toBe(0);
  });

  test("eslint is still needed if a plugin that runs in JavaScript depends on it", async () => {
    const files = {
      ...plugin("eslint-plugin-first", ["a"]),
      "package.json": dependencies("eslint", "eslint-plugin-first"),
      "eslint.config.js": `import first from "eslint-plugin-first";
        export default [{ plugins: { first }, rules: { "first/a": "error" } }];`,
    };
    const manifest = JSON.parse(files["node_modules/eslint-plugin-first/package.json"]);
    files["node_modules/eslint-plugin-first/package.json"] = JSON.stringify({
      ...manifest,
      peerDependencies: { eslint: ">=9" },
    });
    const { stdout, exitCode } = await doctor(files);
    expect(stdout).toEndWith(`
Still needed:   eslint (eslint-plugin-first needs it)
                eslint-plugin-first (its rules run in JavaScript)
`);
    expect(exitCode).toBe(0);
  });

  // eslint-plugin-unicorn does this.
  test(
    "rules are attributed to the package even if it doesn't export the plugin object its configs use",
    async () => {
      const { stdout, exitCode } = await doctor({
        "node_modules/eslint-plugin-inner/package.json": JSON.stringify({
          name: "eslint-plugin-inner",
          version: "1.0.0",
          main: "index.js",
          type: "module",
        }),
        "node_modules/eslint-plugin-inner/index.js": `const inner = { rules: { a: { create: () => ({}) } } };
          export default { ...inner, configs: { recommended: { plugins: { inner }, rules: { "inner/a": "error" } } } };`,
        "package.json": dependencies("eslint-plugin-inner"),
        "eslint.config.js": `import inner from "eslint-plugin-inner";\nexport default [inner.configs.recommended];\n`,
        "a.js": "var a = 1;\n",
      });
      expect(stdout).toEndWith(`
    1 rule runs in JavaScript
        eslint-plugin-inner    1

Still needed:   eslint-plugin-inner (its rules run in JavaScript)
`);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "rules from --rulesdir are listed under --rulesdir",
    async () => {
      const { stdout, exitCode } = await doctor(
        {
          ".eslintrc.json": JSON.stringify({ root: true, rules: { "my-rule": "error", "no-var": "error" } }),
          "rules/my-rule.js": "module.exports = { create: () => ({}) };\n",
          "a.js": "var a = 1;\n",
        },
        ["--rulesdir", "rules"],
      );
      expect(stdout).toEndWith(`
    1 rule runs natively
    1 rule runs in JavaScript
        --rulesdir    1
`);
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  test("lists the config files in subdirectories", async () => {
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

  test.each([
    [{}, "Using ../bunfig.toml ([lint], on top of Bun's defaults)\n\n"],
    [
      { "eslint.config.js": "export default [{ rules: {} }];\n" },
      "Using ../eslint.config.js (ESLint flat config)\nUsing ../bunfig.toml ([lint])\n\n",
    ],
  ])("says which bunfig.toml it reads, and not to add a section: %j", async (config, start) => {
    using dir = tempDir("bun-lint-doctor", {
      ...config,
      "package.json": `{ "type": "module" }`,
      "bunfig.toml": `[lint.rules]\n"no-console" = "warn"\n`,
      "src/a.js": "",
    });
    await using proc = spawn({
      cmd: [bunExe(), "lint", "--doctor"],
      env,
      cwd: join(String(dir), "src"),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toStartWith(start);
    expect(stdout).not.toContain("--init");
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  });

  test("without a config file, [lint.rules] in bunfig.toml still counts", async () => {
    const files = { "a.js": "" };
    const [plain, configured] = await Promise.all([
      doctor(files, ["-f", "json"]),
      doctor({ ...files, "bunfig.toml": `[lint.rules]\n"no-console" = "warn"\n"no-debugger" = "off"\n` }, [
        "-f",
        "json",
      ]),
    ]);
    const [before, after] = [JSON.parse(plain.stdout), JSON.parse(configured.stdout)];
    expect(before.config).toEqual({ path: null, kind: "none", nested: [], ignored: null, bunfig: null });
    expect(after.config).toEqual({ ...before.config, bunfig: "bunfig.toml" });
    expect(before.rules.native).toContain("no-debugger");
    expect(before.rules.native).not.toContain("no-console");
    expect(after.rules.native).toEqual(
      [...before.rules.native.filter((it: string) => it !== "no-debugger"), "no-console"].sort(),
    );
    expect(configured.exitCode).toBe(0);
  });

  test("with no files to lint, lists the rules a file would get", async () => {
    const { stdout, exitCode } = await doctor({ "README.md": "" }, ["-f", "json"]);
    const { files, rules } = JSON.parse(stdout);
    expect(files.linted).toBe(0);
    expect(rules.native).toContain("no-debugger");
    expect(rules.native).toContain("@typescript-eslint/no-explicit-any");
    expect(exitCode).toBe(0);
  });

  test("a config file that throws is an error", async () => {
    const { stdout, stderr, exitCode } = await doctor({
      "eslint.config.js": `throw new Error("broken on purpose");`,
      "a.js": "",
    });
    expect(stdout).toBe("");
    expect(stderr).toContain("broken on purpose");
    expect(exitCode).toBe(2);
  });

  test("a config that ESLint would reject is an error", async () => {
    const { stdout, stderr, exitCode } = await doctor({
      "eslint.config.js": `export default [{ rules: { eqeqeq: ["error", "sometimes"] } }];`,
      "a.js": "",
    });
    expect(stdout).toBe("");
    expect(stderr).toContain(`Key "rules": Key "eqeqeq"`);
    expect(exitCode).toBe(2);
  });

  test("runs even if package.json has a `lint` script", async () => {
    const { stdout, exitCode } = await doctor({
      "package.json": JSON.stringify({ scripts: { lint: "echo the script" } }),
      "a.js": "",
    });
    expect(stdout).toStartWith("No ESLint or oxlint config found.");
    expect(exitCode).toBe(0);
  });
});
