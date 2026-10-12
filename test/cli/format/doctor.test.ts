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
    cmd: [bunExe(), "format", "--threads", "2", "--doctor", ...args],
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

/** A package that is installed. Nothing loads it. */
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

describe.concurrent("bun format --doctor", () => {
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
`);
    expect(isUntouched).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("-f json has the same as data", async () => {
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
          { name: "@ianvs/prettier-plugin-sort-imports", reason: "files" },
          { name: "prettier", reason: "files" },
          { name: "prettier-plugin-svelte", reason: "files" },
        ],
      },
      notes: [],
    });
    expect(exitCode).toBe(0);
  });

  test("Prettier and a built-in plugin can go where no file needs them", async () => {
    const { stdout, exitCode } = await doctor({
      "package.json": dependencies("prettier", "@trivago/prettier-plugin-sort-imports"),
      ".prettierrc.json": JSON.stringify({ plugins: ["@trivago/prettier-plugin-sort-imports"] }),
      "a.js": ugly,
    });
    expect(stdout).toBe(`Using .prettierrc.json (Prettier config)

    3 files are formatted natively

Built-in plugins: @trivago/prettier-plugin-sort-imports

You can remove: @trivago/prettier-plugin-sort-imports, prettier
`);
    expect(exitCode).toBe(0);
  });

  test("a plugin that is not supported, and one that is not installed", async () => {
    const { stdout, exitCode } = await doctor(
      {
        ...installed("prettier"),
        "package.json": dependencies("prettier", "prettier-plugin-tailwindcss", "prettier-plugin-astro"),
        ".prettierrc.json": JSON.stringify({ plugins: ["prettier-plugin-astro"] }),
        "styled/.prettierrc.json": JSON.stringify({ plugins: ["prettier-plugin-tailwindcss"] }),
        "styled/a.js": ugly,
        "b.astro": "<p>b</p>\n",
      },
      ["-f", "json"],
    );
    const { config, files, plugins, packages } = JSON.parse(stdout);
    expect(config.nested).toEqual(["styled/.prettierrc.json"]);
    expect(files).toEqual({ formatted: 2, by_prettier: {}, not_formatted: { "*.astro": 1 }, left_for_plugins: 2 });
    expect(plugins).toEqual({
      built_in: [],
      by_prettier: ["prettier-plugin-astro"],
      not_supported: ["prettier-plugin-tailwindcss"],
      not_installed: ["prettier-plugin-astro"],
    });
    expect(packages).toEqual({
      removable: [],
      needed: [
        { name: "prettier", reason: "files" },
        { name: "prettier-plugin-astro", reason: "files" },
      ],
    });
    expect(exitCode).toBe(0);
  });

  test("a config file that is a program needs what it imports", async () => {
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
`);
    expect(exitCode).toBe(0);
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
`);
    expect(isUntouched).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("without a config file", async () => {
    const { stdout, stderr, exitCode, isUntouched } = await doctor({ "a.js": ugly });
    expect(stderr).toBe("");
    expect(stdout).toBe(`No Prettier or oxfmt config found. Bun formats like Prettier by default.

    1 file is formatted natively

Run bun format --init to add a [format] section to bunfig.toml
`);
    expect(isUntouched).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("a config file that cannot be read is an error", async () => {
    const { stdout, stderr, exitCode } = await doctor({ ".prettierrc.json": "{", "a.js": ugly });
    expect(stdout).toBe("");
    expect(stderr).toContain(".prettierrc.json");
    expect(exitCode).toBe(2);
  });

  test("-f takes json only", async () => {
    const { stderr, exitCode } = await doctor({ "a.js": ugly }, ["-f", "yaml"]);
    expect(stderr).toContain("Option format: 'yaml' is not json.");
    expect(exitCode).not.toBe(0);
  });

  test("the format script of package.json does not take its place", async () => {
    const { stdout, exitCode } = await doctor({
      "package.json": JSON.stringify({ scripts: { format: "echo the script" } }),
      "a.js": ugly,
    });
    expect(stdout).toStartWith("No Prettier or oxfmt config found.");
    expect(exitCode).toBe(0);
  });
});
