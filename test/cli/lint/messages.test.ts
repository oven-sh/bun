// Tests for messages that `bun lint` and `bun fmt` word themselves, each in the situation that triggers it. Messages
// that belong to a feature are tested with that feature. This file has the rest.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

const env = {
  ...bunEnv,
  AGENT: "0",
  CLAUDECODE: undefined,
  REPL_ID: undefined,
  GITHUB_ACTIONS: undefined,
  NO_COLOR: "1",
};

async function bun(files: Record<string, string | Buffer>, args: string[]) {
  using dir = tempDir("bun-lint-messages", files);
  await using proc = spawn({ cmd: [bunExe(), ...args], env, cwd: String(dir), stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const shown = (text: string) => normalizeBunSnapshot(text, String(dir));
  return { stdout: shown(stdout), stderr: shown(stderr), exitCode };
}

describe.concurrent("bun lint", () => {
  test("rules that need types are skipped with a warning", async () => {
    const rules = (...names: string[]) => `[lint.rules]\n${names.map(it => `"${it}" = "error"\n`).join("")}`;
    const files = { "a.ts": "export const a: number = 1;\n" };
    const [one, two] = await Promise.all([
      bun({ ...files, "bunfig.toml": rules("@typescript-eslint/await-thenable") }, ["lint", "--no-type-aware"]),
      bun(
        {
          ...files,
          "bunfig.toml": rules("@typescript-eslint/await-thenable", "@typescript-eslint/no-floating-promises"),
        },
        ["lint", "--no-type-aware"],
      ),
    ]);
    expect(one.stderr).toStartWith(
      "warn: Skipped 1 rule that needs type information\n  Remove typeAware = false or --no-type-aware to run it.\n",
    );
    expect(two.stderr).toStartWith(
      "warn: Skipped 2 rules that need type information\n  Remove typeAware = false or --no-type-aware to run them.\n",
    );
    expect([one.exitCode, two.exitCode]).toEqual([0, 0]);
    // Same with a config file that doesn't turn type information on.
    const config = `const plugin = { meta: { name: "@typescript-eslint/eslint-plugin" }, rules: {} };
export default [{ plugins: { "@typescript-eslint": plugin }, rules: { "@typescript-eslint/await-thenable": "error" } }];\n`;
    const { stderr } = await bun({ "a.js": "export const a = 1;\n", "eslint.config.mjs": config }, ["lint", "a.js"]);
    expect(stderr).toStartWith("warn: Skipped 1 rule that needs type information\n  Use --type-aware to run it.\n");
  });

  test("a config file that calls process.exit", async () => {
    const { stderr, exitCode } = await bun({ "eslint.config.mjs": "process.exit(1);\n", "a.js": "a;\n" }, ["lint"]);
    expect(stderr).toBe(
      "error: Cannot load the configuration file <dir>/eslint.config.mjs:\nIt exited before it exported a config.",
    );
    expect(exitCode).toBe(2);
  });

  test("an .eslintrc.json with invalid JSON", async () => {
    const { stderr, exitCode } = await bun({ ".eslintrc.json": "{ nope\n", "a.js": "a;\n" }, ["lint"]);
    expect(stderr).toEndWith("Cannot read config file: <dir>/.eslintrc.json\nError: Invalid JSON.");
    expect(exitCode).toBe(2);
  });

  test("a non-JSON option for a rule that runs in JavaScript", async () => {
    const files = {
      "mine.js": `export default { meta: { name: "mine" }, rules: { x: { meta: { schema: false }, create: () => ({}) } } };\n`,
      "oxlint.config.ts": `export default { jsPlugins: ["./mine.js"], rules: { "mine/x": ["error", { a: new Map() }] } };\n`,
      "a.js": "export {};\n",
    };
    const { stdout, exitCode } = await bun(files, ["lint"]);
    expect(stdout).toEndWith(
      `Key "rules": Key "mine/x": Options for a rule that runs in JavaScript must be JSON, not Map.`,
    );
    expect(exitCode).toBe(1);
  });

  test("an older typescript-eslint with an .eslintrc", async () => {
    const files = {
      "node_modules/@typescript-eslint/eslint-plugin/package.json": JSON.stringify({
        name: "@typescript-eslint/eslint-plugin",
        version: "7.18.0",
        main: "index.js",
      }),
      "node_modules/@typescript-eslint/eslint-plugin/index.js": `module.exports = { rules: { "no-explicit-any": { create: () => ({}) } }, configs: {} };\n`,
      ".eslintrc.json": JSON.stringify({
        root: true,
        plugins: ["@typescript-eslint"],
        rules: { "@typescript-eslint/no-explicit-any": "error" },
      }),
      "a.js": "var a = 1;\n",
    };
    const { stderr, exitCode } = await bun(files, ["lint", "a.js"]);
    expect(stderr).toContain(
      "warn: typescript-eslint 7.18.0 is installed. bun lint runs version 8 of its rules, with the default options of the installed version.\n",
    );
    expect(exitCode).toBe(0);
  });

  test("a recognized but unsupported flag, and --env-info", async () => {
    const [flag, info] = await Promise.all([
      bun({ "a.js": "a;\n" }, ["lint", "--mcp"]),
      bun({}, ["lint", "--env-info"]),
    ]);
    expect(flag.stderr).toBe("error: bun lint does not support --mcp");
    expect(flag.exitCode).toBe(2);
    expect(info.stdout).toMatch(/^ESLint version: [\d.]+ \(the version bun lint is compatible with\)$/m);
    expect(info.exitCode).toBe(0);
  });
});

describe.concurrent("bun fmt", () => {
  test("a UTF-16 file", async () => {
    const { stderr, exitCode } = await bun({ "a.js": Buffer.from("﻿a;\n", "utf16le") }, ["fmt", "a.js"]);
    expect(stderr).toStartWith("error: This file is UTF-16. bun fmt only reads UTF-8\n    at a.js\n\n");
    expect(exitCode).toBe(2);
  });

  test("--plugin with --allow-unsupported, and a recognized but unsupported flag", async () => {
    const [plugin, flag] = await Promise.all([
      bun({ "a.js": "a;\n" }, ["fmt", "--plugin=prettier-plugin-x", "--allow-unsupported", "--check", "a.js"]),
      bun({ "a.js": "a;\n" }, ["fmt", "--migrate=prettier"]),
    ]);
    expect(plugin.stderr).toContain("warn: --plugin has no effect because bun fmt does not load Prettier plugins");
    expect(plugin.exitCode).toBe(0);
    expect(flag.stderr).toStartWith("error: bun fmt does not support --migrate\n");
    expect(flag.exitCode).toBe(2);
  });

  test("oxfmt options in a .prettierrc", async () => {
    const hint = "\n  Use --allow-unsupported to make this a warning.";
    const [one, two, allowed] = await Promise.all([
      bun({ ".prettierrc": `{ "sortTailwindcss": true }\n`, "a.js": "a;\n" }, ["fmt", "a.js"]),
      bun({ ".prettierrc": `{ "sortTailwindcss": true, "experimentalTailwindcss": true }\n`, "a.js": "a;\n" }, [
        "fmt",
        "a.js",
      ]),
      bun({ ".prettierrc": `{ "sortTailwindcss": true }\n`, "a.js": "a;\n" }, ["fmt", "--allow-unsupported", "a.js"]),
    ]);
    expect(one.stderr).toEndWith(`error: sortTailwindcss is not supported yet and has no effect${hint}`);
    expect(two.stderr).toEndWith(
      `error: sortTailwindcss, experimentalTailwindcss are not supported yet and have no effect${hint}`,
    );
    expect(allowed.stderr).toEndWith("warn: sortTailwindcss is not supported yet and has no effect");
    expect([one.exitCode, two.exitCode, allowed.exitCode]).toEqual([2, 2, 0]);
  });

  test.each([
    [`{ "order": 1 }`, '`order` must be "asc" or "desc"'],
    [`{ "groups": 1 }`, "`groups` must be an array"],
    [`{ "ignoreCase": 1 }`, "`ignoreCase` must be a boolean"],
    [`{ "customGroups": 1 }`, "`customGroups` must be an array"],
    [`{ "internalPattern": 1 }`, "`internalPattern` must be an array of strings"],
    ["1", "it must be a boolean or an object"],
  ])("sortImports: %s", async (sortImports, message) => {
    const files = { ".oxfmtrc.json": `{ "sortImports": ${sortImports} }\n`, "a.js": "a;\n" };
    const { stderr, exitCode } = await bun(files, ["fmt", "a.js"]);
    expect(stderr).toContain(`error: Invalid \`sortImports\` configuration: ${message}\n`);
    expect(exitCode).toBe(2);
  });
});
