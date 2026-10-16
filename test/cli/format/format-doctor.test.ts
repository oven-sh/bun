import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

const env = { ...bunEnv, NO_COLOR: undefined, FORCE_COLOR: undefined };

async function doctor(files: Record<string, string>, args: string[] = []) {
  using dir = tempDir("bun-format-doctor", files);
  const list = () => (readdirSync(String(dir), { recursive: true }) as string[]).sort();
  const before = list();
  await using proc = spawn({
    cmd: [bunExe(), "fmt", "--threads", "2", "--doctor", ...args],
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

/** Files for an installed package. Nothing loads it. */
const installed = (name: string) => ({
  [`node_modules/${name}/package.json`]: JSON.stringify({ name, version: "1.0.0", main: "index.js" }),
  [`node_modules/${name}/index.js`]: "module.exports = {};",
});

const dependencies = (...names: string[]) =>
  JSON.stringify({ name: "app", devDependencies: Object.fromEntries(names.map(name => [name, "*"])) }, null, 2) + "\n";

const ugly = "const a = {b:1}\n";

const prettier = {
  ...installed("prettier"),
  ...installed("prettier-plugin-astro"),
  ...installed("@ianvs/prettier-plugin-sort-imports"),
  "package.json": dependencies(
    "prettier",
    "prettier-plugin-astro",
    "prettier-plugin-svelte",
    "@ianvs/prettier-plugin-sort-imports",
    "eslint-config-prettier",
    "typescript",
  ),
  ".prettierrc": JSON.stringify({
    semi: false,
    plugins: ["@ianvs/prettier-plugin-sort-imports", "prettier-plugin-astro"],
  }),
  ".editorconfig": "root = true\n[*]\nindent_size = 2\n",
  "src/a.js": ugly,
  "src/b.ts": ugly,
  "src/c.astro": "<p>c</p>\n",
  "src/d.astro": "<p>d</p>\n",
};

describe.concurrent("bun fmt --doctor", () => {
  test("with a .prettierrc", async () => {
    const { stdout, stderr, exitCode, isUntouched } = await doctor(prettier);
    expect(stderr).toBe("");
    expect(stdout).toBe(`Using .prettierrc (Prettier config)
Also .editorconfig

    4 files are formatted natively
    2 files go to your installed Prettier: 2 *.astro

Built-in plugins: @ianvs/prettier-plugin-sort-imports
Plugins that use your installed Prettier: prettier-plugin-astro

You can remove: prettier-plugin-svelte
Still needed:   @ianvs/prettier-plugin-sort-imports, prettier, prettier-plugin-astro (some files go to them)
Not checked:    other tools' configs, CI files, Git hooks
`);
    expect(isUntouched).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("-f json prints the same report as JSON", async () => {
    const { stdout, exitCode } = await doctor(prettier, ["-f", "json"]);
    expect(JSON.parse(stdout)).toEqual({
      config: { path: ".prettierrc", kind: "prettier", nested: [], editorconfig: true, bunfig: null },
      files: { formatted: 4, by_prettier: { "*.astro": 2 }, not_formatted: {}, left_for_plugins: 0 },
      plugins: {
        built_in: ["@ianvs/prettier-plugin-sort-imports"],
        by_prettier: ["prettier-plugin-astro"],
        not_supported: [],
        not_installed: [],
      },
      options_not_supported: [],
      packages: {
        removable: ["prettier-plugin-svelte"],
        needed: [
          { name: "@ianvs/prettier-plugin-sort-imports", reason: "files", by: null },
          { name: "prettier", reason: "files", by: null },
          { name: "prettier-plugin-astro", reason: "files", by: null },
        ],
        not_checked: ["other tools' configs", "CI files", "Git hooks"],
      },
      notes: [],
    });
    expect(exitCode).toBe(0);
  });

  test("Prettier and a built-in plugin are removable when no file needs them", async () => {
    const { stdout, exitCode } = await doctor({
      "package.json": dependencies("prettier", "@trivago/prettier-plugin-sort-imports"),
      ".prettierrc.json": JSON.stringify({ plugins: ["@trivago/prettier-plugin-sort-imports"] }),
      "a.js": ugly,
    });
    expect(stdout).toBe(`Using .prettierrc.json (Prettier config)

    3 files are formatted natively

Built-in plugins: @trivago/prettier-plugin-sort-imports

You can remove: @trivago/prettier-plugin-sort-imports, prettier
Not checked:    other tools' configs, CI files, Git hooks
`);
    expect(exitCode).toBe(0);
  });

  test("the plugin that sorts classes is built in", async () => {
    const { stdout, exitCode } = await doctor({
      "package.json": dependencies("prettier", "prettier-plugin-tailwindcss", "tailwindcss"),
      ".prettierrc.json": JSON.stringify({ plugins: ["prettier-plugin-tailwindcss"], tailwindFunctions: ["cn"] }),
      "a.js": ugly,
    });
    expect(stdout).toBe(`Using .prettierrc.json (Prettier config)

    3 files are formatted natively

Built-in plugins: prettier-plugin-tailwindcss

You can remove: prettier, prettier-plugin-tailwindcss
Not checked:    other tools' configs, CI files, Git hooks
`);
    expect(exitCode).toBe(0);
  });

  describe("prettier-plugin-svelte", () => {
    const project = (version?: string) => ({
      ...installed("prettier"),
      ...(version && {
        "node_modules/prettier-plugin-svelte/package.json": JSON.stringify({ name: "prettier-plugin-svelte", version }),
      }),
      "package.json": dependencies("prettier", "prettier-plugin-svelte"),
      ".prettierrc.json": JSON.stringify({ plugins: ["prettier-plugin-svelte"] }),
      "a.svelte": "<p>a</p>\n",
    });

    test.each([undefined, "4.1.1"])("is built in: %s installed", async version => {
      const { stdout, exitCode } = await doctor(project(version));
      expect(stdout).toBe(`Using .prettierrc.json (Prettier config)

    3 files are formatted natively

Built-in plugins: prettier-plugin-svelte

You can remove: prettier, prettier-plugin-svelte
Not checked:    other tools' configs, CI files, Git hooks
`);
      expect(exitCode).toBe(0);
    });

    test("another version prints some components differently, so it stays in use", async () => {
      const { stdout, exitCode } = await doctor(project("3.4.0"));
      expect(stdout).toBe(`Using .prettierrc.json (Prettier config)

    2 files are formatted natively
    1 file goes to your installed Prettier: 1 *.svelte

Plugins that use your installed Prettier: prettier-plugin-svelte

Still needed:   prettier, prettier-plugin-svelte (some files go to them)
`);
      expect(exitCode).toBe(0);
    });

    test("with `svelte = true` in [fmt], another version is not in use", async () => {
      const { stdout, exitCode } = await doctor({ ...project("3.4.0"), "bunfig.toml": "[fmt]\nsvelte = true\n" });
      expect(stdout).toBe(`Using .prettierrc.json (Prettier config)
Using bunfig.toml ([fmt])

    3 files are formatted natively

Built-in plugins: prettier-plugin-svelte

You can remove: prettier, prettier-plugin-svelte
Not checked:    other tools' configs, CI files, Git hooks
`);
      expect(exitCode).toBe(0);
    });

    test.each([
      ["svelte = false in [fmt]", { "bunfig.toml": "[fmt]\nsvelte = false\n" }, []],
      ["--no-svelte", {}, ["--no-svelte"]],
    ])("says that the files are left alone: %s", async (_, files, args) => {
      const { stdout, exitCode } = await doctor({ ...project("3.4.0"), ...files }, args);
      expect(stdout).toBe(`Using .prettierrc.json (Prettier config)
${"bunfig.toml" in files ? "Using bunfig.toml ([fmt])\n" : ""}
    2 files are formatted natively

You can remove: prettier, prettier-plugin-svelte
Not checked:    other tools' configs, CI files, Git hooks

note: Svelte files are not formatted (svelte = false)
`);
      expect(exitCode).toBe(0);
    });

    test.each(["file-override", "prefer-file"])(
      "they are not left alone with --config-precedence=%s",
      async precedence => {
        const files = { ...project("4.1.1"), "bunfig.toml": "[fmt]\nsvelte = false\n" };
        const { stdout, exitCode } = await doctor(files, [`--config-precedence=${precedence}`]);
        expect(stdout).toBe(`Using .prettierrc.json (Prettier config)
Using bunfig.toml ([fmt])

    3 files are formatted natively

Built-in plugins: prettier-plugin-svelte

You can remove: prettier, prettier-plugin-svelte
Not checked:    other tools' configs, CI files, Git hooks
`);
        expect(exitCode).toBe(0);
      },
    );

    test("says that some files are left alone if only an override turns it off", async () => {
      const { stdout, exitCode } = await doctor({
        ...project("4.1.1"),
        "old/b.svelte": "<p>b</p>\n",
        "bunfig.toml": '[[fmt.overrides]]\nfiles = "old/**"\noptions = { svelte = false }\n',
      });
      expect(stdout).toBe(`Using .prettierrc.json (Prettier config)
Using bunfig.toml ([fmt])

    3 files are formatted natively

Built-in plugins: prettier-plugin-svelte

You can remove: prettier, prettier-plugin-svelte
Not checked:    other tools' configs, CI files, Git hooks

note: Some Svelte files are not formatted (svelte = false in an override)
`);
      expect(exitCode).toBe(0);
    });

    test("says so with every --config-precedence, unless a config file counts for more", async () => {
      const note = "note: Some Svelte files are not formatted (svelte = false in an override)\n";
      const files = {
        "a.svelte": "<p>a</p>\n",
        "old/b.svelte": "<p>b</p>\n",
        "bunfig.toml": '[[fmt.overrides]]\nfiles = "old/**"\noptions = { svelte = false }\n',
      };
      const inFile = { ...files, ".oxfmtrc.json": '{ "svelte": true }\n' };
      const says = async (project: Record<string, string>, precedence: string) =>
        (await doctor(project, [`--config-precedence=${precedence}`])).stdout.endsWith(note);
      const precedences = ["cli-override", "file-override", "prefer-file"];
      expect(await Promise.all(precedences.map(it => says(files, it)))).toEqual([true, true, true]);
      expect(await Promise.all(precedences.map(it => says(inFile, it)))).toEqual([true, false, false]);
    });
  });

  test("lists unsupported plugins and plugins that aren't installed", async () => {
    const project = {
      ...installed("prettier"),
      "package.json": dependencies("prettier", "prettier-plugin-css-order", "prettier-plugin-astro"),
      ".prettierrc.json": JSON.stringify({ plugins: ["prettier-plugin-astro"] }),
      "styled/.prettierrc.json": JSON.stringify({ plugins: ["prettier-plugin-css-order"] }),
      "styled/a.js": ugly,
      "b.astro": "<p>b</p>\n",
    };
    const [text, { stdout, exitCode }] = await Promise.all([doctor(project), doctor(project, ["-f", "json"])]);
    expect(text.stdout).toStartWith(`Using .prettierrc.json (Prettier config)
Also styled/.prettierrc.json

    2 files are formatted natively
    1 file cannot be formatted: 1 *.astro
    2 files are skipped because a plugin is not supported
        Use --allow-unsupported to format them without it

Plugins that use your installed Prettier: prettier-plugin-astro
Plugins that are not supported: prettier-plugin-css-order
Not installed: prettier-plugin-astro

Still needed:   prettier, prettier-plugin-astro (some files go to them)
                prettier-plugin-css-order (the skipped files need it)
`);
    const { config, files, plugins, packages } = JSON.parse(stdout);
    expect(config.nested).toEqual(["styled/.prettierrc.json"]);
    expect(files).toEqual({ formatted: 2, by_prettier: {}, not_formatted: { "*.astro": 1 }, left_for_plugins: 2 });
    expect(plugins).toEqual({
      built_in: [],
      by_prettier: ["prettier-plugin-astro"],
      not_supported: ["prettier-plugin-css-order"],
      not_installed: ["prettier-plugin-astro"],
    });
    expect(packages).toEqual({
      removable: [],
      needed: [
        { name: "prettier", reason: "files", by: null },
        { name: "prettier-plugin-astro", reason: "files", by: null },
        { name: "prettier-plugin-css-order", reason: "skipped_files", by: null },
      ],
      not_checked: ["other tools' configs", "CI files", "Git hooks"],
    });
    expect(exitCode).toBe(0);
  });

  test("Prettier is not removable while files are skipped because of a plugin", async () => {
    const { stdout, exitCode } = await doctor({
      "package.json": dependencies("prettier", "prettier-plugin-css-order", "prettier-plugin-other"),
      ".prettierrc": JSON.stringify({ plugins: ["prettier-plugin-css-order"] }),
      "a.js": ugly,
    });
    expect(stdout).toStartWith(`Using .prettierrc (Prettier config)

    0 files are formatted natively
    3 files are skipped because a plugin is not supported
        Use --allow-unsupported to format them without it

Plugins that are not supported: prettier-plugin-css-order

You can remove: prettier-plugin-other
Still needed:   prettier, prettier-plugin-css-order (the skipped files need them)
Not checked:    other tools' configs, CI files, Git hooks
`);
    expect(exitCode).toBe(0);
  });

  test("packages that a JavaScript config file imports are still needed", async () => {
    const { stdout, exitCode } = await doctor({
      "node_modules/prettier-config-shared/package.json": JSON.stringify({
        name: "prettier-config-shared",
        main: "index.js",
      }),
      "node_modules/prettier-config-shared/index.js": "module.exports = { semi: false };",
      "package.json": dependencies("prettier", "prettier-config-shared"),
      "prettier.config.cjs": `module.exports = { ...require("prettier-config-shared"), singleQuote: true };`,
      "a.js": ugly,
    });
    expect(stdout).toBe(`Using prettier.config.cjs (Prettier config)

    3 files are formatted natively

You can remove: prettier
Still needed:   prettier-config-shared (prettier.config.cjs loads it)
Not checked:    other tools' configs, CI files, Git hooks
`);
    expect(exitCode).toBe(0);
  });

  test("only packages named like formatter tooling are removable", async () => {
    const names = [
      "prettier",
      "oxfmt",
      "prettier-plugin-a",
      "@scope/prettier-plugin-a",
      "@prettier/plugin-php",
      "prettier-config-a",
      "@scope/prettier-config",
      "@scope/prettier-config-a",
    ];
    const others = [
      "eslint-plugin-prettier",
      "eslint-config-prettier",
      "prettier-eslint",
      "pretty-quick",
      "prettierx",
      "vite-plugin-prettier",
      "@scope/prettier",
    ];
    const { stdout, exitCode } = await doctor(
      { "package.json": dependencies(...names, ...others), ".prettierrc": "{}" },
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
    const project = (fields: object) => ({
      "package.json":
        JSON.stringify({ devDependencies: { prettier: "*", "eslint-plugin-prettier": "*" }, ...fields }, null, 2) +
        "\n",
      ".prettierrc": "{}\n",
    });
    const peer = {
      "node_modules/eslint-plugin-prettier/package.json": JSON.stringify({
        name: "eslint-plugin-prettier",
        peerDependencies: { prettier: ">=3" },
      }),
    };
    const [script, staged, dependent, free] = await Promise.all([
      doctor(project({ scripts: { check: "prettier --check ." } })),
      doctor(project({ "lint-staged": { "*": "prettier --write" } })),
      doctor({ ...project({}), ...peer }),
      doctor(project({ scripts: { check: "bun fmt --check", pretty: "prettierx ." } })),
    ]);
    expect(script.stdout).toEndWith(`\nStill needed:   prettier (the "check" script runs it)\n`);
    expect(staged.stdout).toEndWith(`\nStill needed:   prettier (lint-staged runs it)\n`);
    expect(dependent.stdout).toEndWith(`\nStill needed:   prettier (eslint-plugin-prettier needs it)\n`);
    expect(free.stdout).toEndWith(
      `\nYou can remove: prettier\nNot checked:    other tools' configs, CI files, Git hooks\n`,
    );
  });

  test("with an .oxfmtrc.json", async () => {
    const { stdout, exitCode, isUntouched } = await doctor({
      "package.json": dependencies("oxfmt"),
      ".oxfmtrc.json": JSON.stringify({ semi: false }),
      "a.js": ugly,
    });
    expect(stdout).toBe(`Using .oxfmtrc.json (oxfmt config)

    3 files are formatted natively

You can remove: oxfmt
Not checked:    other tools' configs, CI files, Git hooks
`);
    expect(isUntouched).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("with only [fmt] in bunfig.toml, says so, and not to add the section", async () => {
    const { stdout, stderr, exitCode } = await doctor({ "a.js": ugly, "bunfig.toml": "[fmt]\nsemi = false\n" });
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "Using bunfig.toml ([fmt], on top of Prettier's defaults)\n\n    2 files are formatted natively\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("without a config file", async () => {
    const { stdout, stderr, exitCode, isUntouched } = await doctor({ "a.js": ugly });
    expect(stderr).toBe("");
    expect(stdout).toBe(`No Prettier or oxfmt config found. Bun formats like Prettier by default.

    1 file is formatted natively

Run bun fmt --init to add a [fmt] section to bunfig.toml
`);
    expect(isUntouched).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("an invalid config file is an error", async () => {
    const { stdout, stderr, exitCode } = await doctor({ ".prettierrc.json": "{", "a.js": ugly });
    expect(stdout).toBe("");
    expect(stderr).toContain(".prettierrc.json");
    expect(exitCode).toBe(2);
  });

  test("-f only accepts json", async () => {
    const { stderr, exitCode } = await doctor({ "a.js": ugly }, ["-f", "yaml"]);
    expect(stderr).toContain(`--format takes json, not "yaml"`);
    expect(exitCode).not.toBe(0);
  });

  test("runs even if package.json has a `fmt` script", async () => {
    const { stdout, exitCode } = await doctor({
      "package.json": JSON.stringify({ scripts: { fmt: "echo the script" } }),
      "a.js": ugly,
    });
    expect(stdout).toStartWith("No Prettier or oxfmt config found.");
    expect(exitCode).toBe(0);
  });
});
