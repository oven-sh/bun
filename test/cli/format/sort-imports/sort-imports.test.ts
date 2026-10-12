// The fixtures are the inputs of the tests of @trivago/prettier-plugin-sort-imports, of
// @ianvs/prettier-plugin-sort-imports (both Apache-2.0) and of oxc's formatter (MIT), and generated ones with comments
// and empty lines in odd places. What is expected is what Prettier 3.9.9 with the plugin (for
// prettier-plugin-organize-imports, with TypeScript 5.9), and oxfmt 0.72, print.
// They are made by test/cli/format/oracle/sort-imports/make-fixtures.mjs.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { endChildren, spawn } from "../../children";

afterAll(endChildren);

type Case = { name: string; filename: string; options: Record<string, unknown>; input: string; output: string };

const tools = {
  trivago: (options: object) => [
    ".prettierrc.json",
    { plugins: ["@trivago/prettier-plugin-sort-imports"], ...options },
  ],
  ianvs: (options: object) => [".prettierrc.json", { plugins: ["@ianvs/prettier-plugin-sort-imports"], ...options }],
  organize: (options: object) => [".prettierrc.json", { plugins: ["prettier-plugin-organize-imports"], ...options }],
  oxfmt: (options: object) => [".oxfmtrc.json", options],
} as const;

async function format(files: Record<string, string>, names: string[], flags: string[] = []) {
  using dir = tempDir("bun-format-sort-imports", files);
  await using proc = spawn({
    cmd: [bunExe(), "format", "--log-level=warn", ...flags, "."],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, files: names.map(name => readFileSync(join(String(dir), name), "utf8")) };
}

for (const [tool, config] of Object.entries(tools)) {
  const cases: Case[] = JSON.parse(readFileSync(join(import.meta.dir, `${tool}.json`), "utf8"));
  // One run for all the cases with the same options.
  const groups = Map.groupBy(cases, it => JSON.stringify(it.options));

  describe.concurrent(tool, () => {
    for (const [options, group] of groups) {
      test(`${group[0].name} .. ${options}`, async () => {
        const [name, contents] = config(JSON.parse(options));
        const names = group.map((it, index) => `${index}-${it.filename}`);
        const files = Object.fromEntries(group.map((it, index) => [names[index], it.input]));
        const result = await format({ [name]: JSON.stringify(contents), ...files }, names);
        expect(result.stderr).toBe("");
        for (const [index, it] of group.entries()) {
          expect({ name: it.name, output: result.files[index] }).toEqual({ name: it.name, output: it.output });
        }
        expect(result.exitCode).toBe(0);
      });
    }
  });
}

// hosts.json: scripts in Vue files, in HTML, in HTML in templates and in blocks of code, with what the tools print. The plugins
// sort the first `<script>` and the first `<script setup>` at the top of a Vue file, and every script anywhere else. oxfmt
// sorts imports and rewrites JSDoc comments in the scripts of a Vue file only.
describe.concurrent("in HTML and Vue", () => {
  type Hosts = Record<string, { config: [string, object]; files: Record<string, [input: string, output: string]> }>;
  const hosts: Hosts = JSON.parse(readFileSync(join(import.meta.dir, "hosts.json"), "utf8"));
  for (const [tool, { config, files }] of Object.entries(hosts)) {
    test(tool, async () => {
      const names = Object.keys(files);
      const inputs = Object.fromEntries(names.map(name => [name, files[name][0]]));
      const result = await format({ [config[0]]: JSON.stringify(config[1]), ...inputs }, names);
      expect(result.stderr).toBe("");
      expect(Object.fromEntries(names.map((name, index) => [name, result.files[index]]))).toEqual(
        Object.fromEntries(names.map(name => [name, files[name][1]])),
      );
      expect(result.exitCode).toBe(0);
    });
  }
});

describe.concurrent("when imports are sorted", () => {
  const unsorted = `import b from "b";\nimport a from "a";\n`;
  const sorted = `import a from "a";\nimport b from "b";\n`;

  test("not without an option that asks for it", async () => {
    const result = await format({ ".prettierrc.json": `{ "semi": true }`, "a.ts": unsorted }, ["a.ts"]);
    expect(result.files).toEqual([unsorted]);
  });

  test("not with the options of a plugin that is not named: Prettier does not know them", async () => {
    const config = `{ "importOrder": ["^[./]"], "importOrderSeparation": true, "organizeImportsTypeOrder": "last" }`;
    const result = await format({ ".prettierrc.json": config, "a.ts": unsorted, "b.ts": unsorted }, ["a.ts", "b.ts"]);
    expect(result.files).toEqual([unsorted, unsorted]);
    expect(result.stderr).toBe(
      `[warn] Ignored unknown option { importOrder: ["^[./]"] }.\n` +
        `[warn] Ignored unknown option { importOrderSeparation: true }.\n` +
        `[warn] Ignored unknown option { organizeImportsTypeOrder: "last" }.\n`,
    );
    expect(result.exitCode).toBe(0);
  });

  test("with a plugin that --plugin names", async () => {
    const files = { ".prettierrc.json": `{ "importOrder": ["^[./]"] }`, "a.ts": unsorted };
    const result = await format(files, ["a.ts"], ["--plugin=@trivago/prettier-plugin-sort-imports"]);
    expect(result.files).toEqual([sorted]);
    expect(result.stderr).toBe("");
  });

  test("with a plugin that is named, without any option", async () => {
    const config = `{ "plugins": ["@ianvs/prettier-plugin-sort-imports"] }`;
    const result = await format({ ".prettierrc.json": config, "a.ts": unsorted }, ["a.ts"]);
    expect(result.files).toEqual([sorted]);
    expect(result.stderr).toBe("");
  });

  test("in the files of an override only", async () => {
    const options = `{ "plugins": ["@trivago/prettier-plugin-sort-imports"], "importOrder": [] }`;
    const config = `{ "overrides": [{ "files": "src/**", "options": ${options} }] }`;
    const result = await format({ ".prettierrc.json": config, "a.ts": unsorted, "src/a.ts": unsorted }, [
      "a.ts",
      "src/a.ts",
    ]);
    expect(result.files).toEqual([unsorted, sorted]);
  });

  test.each([
    [
      "@trivago/prettier-plugin-sort-imports",
      ".prettierrc.json",
      `{ "plugins": ["@trivago/prettier-plugin-sort-imports"], "importOrder": ["^[./]"] }`,
      sorted,
    ],
    [
      "@ianvs/prettier-plugin-sort-imports",
      ".prettierrc.json",
      `{ "plugins": ["@ianvs/prettier-plugin-sort-imports"] }`,
      sorted,
    ],
    ["oxfmt", ".oxfmtrc.json", `{ "sortImports": {} }`, sorted],
    // It asks TypeScript about the file, which is the Markdown. In a.ts it removes both: nothing uses them.
    [
      "prettier-plugin-organize-imports",
      ".prettierrc.json",
      `{ "plugins": ["prettier-plugin-organize-imports"] }`,
      unsorted,
    ],
  ])("in a block of code in Markdown: %s", async (_, name, config, expected) => {
    const result = await format({ [name]: config, "a.md": "```ts\n" + unsorted + "```\n" }, ["a.md"]);
    expect(result.files).toEqual(["```ts\n" + expected + "```\n"]);
  });

  test("an invalid regular expression is an error", async () => {
    const config = `{ "plugins": ["@trivago/prettier-plugin-sort-imports"], "importOrder": ["("] }`;
    const result = await format({ ".prettierrc.json": config, "a.ts": unsorted }, ["a.ts"]);
    expect(result.files).toEqual([unsorted]);
    expect(result.stderr).toContain("importOrder");
    expect(result.exitCode).toBe(2);
  });
});
