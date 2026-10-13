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
  ...installed("prettier-plugin-svelte"),
  ...installed("@ianvs/prettier-plugin-sort-imports"),
  "package.json": dependencies(
    "prettier",
    "prettier-plugin-svelte",
    "prettier-plugin-astro",
    "@ianvs/prettier-plugin-sort-imports",
    "eslint-config-prettier",
    "typescript",
  ),
  ".prettierrc": JSON.stringify({
    semi: false,
    plugins: ["@ianvs/prettier-plugin-sort-imports", "prettier-plugin-svelte"],
  }),
  ".editorconfig": "root = true\n[*]\nindent_size = 2\n",
  "src/a.js": ugly,
  "src/b.ts": ugly,
  "src/c.svelte": "<p>c</p>\n",
  "src/d.svelte": "<p>d</p>\n",
};

describe.concurrent("bun fmt --doctor", () => {
  test("with a .prettierrc", async () => {
    const { stdout, stderr, exitCode, isUntouched } = await doctor(prettier);
    expect(stderr).toBe("");
    expect(stdout).toBe(`Using .prettierrc (Prettier config)
Also .editorconfig

    4 files are formatted natively
    2 files go to your installed Prettier: 2 *.svelte

Built-in plugins: @ianvs/prettier-plugin-sort-imports
Plugins that use your installed Prettier: prettier-plugin-svelte

You can remove: prettier-plugin-astro
Still needed:   @ianvs/prettier-plugin-sort-imports, prettier, prettier-plugin-svelte (some files go to them)
Not checked:    other tools' configs, CI files, Git hooks
`);
    expect(isUntouched).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("-f json prints the same report as JSON", async () => {
    const { stdout, exitCode } = await doctor(prettier, ["-f", "json"]);
    expect(JSON.parse(stdout)).toEqual({
      config: { path: ".prettierrc", kind: "prettier", nested: [], editorconfig: true },
      files: { formatted: 4, by_prettier: { "*.svelte": 2 }, not_formatted: {}, left_for_plugins: 0 },
      plugins: {
        built_in: ["@ianvs/prettier-plugin-sort-imports"],
        by_prettier: ["prettier-plugin-svelte"],
        not_supported: [],
        not_installed: [],
      },
      options_not_supported: [],
      packages: {
        removable: ["prettier-plugin-astro"],
        needed: [
          { name: "@ianvs/prettier-plugin-sort-imports", reason: "files", by: null },
          { name: "prettier", reason: "files", by: null },
          { name: "prettier-plugin-svelte", reason: "files", by: null },
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
