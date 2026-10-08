// The fixtures are the inputs of the tests of @trivago/prettier-plugin-sort-imports, of
// @ianvs/prettier-plugin-sort-imports (both Apache-2.0) and of oxc's formatter (MIT), and generated ones with comments
// and empty lines in odd places. What is expected is what Prettier 3.9.9 with the plugin (for
// prettier-plugin-organize-imports, with TypeScript 5.9), and oxfmt 0.72, print.
// They are made by test/cli/format/oracle/sort-imports/make-fixtures.mjs.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Case = { name: string; filename: string; options: Record<string, unknown>; input: string; output: string };

const tools = {
  trivago: (options: object) => [".prettierrc.json", { plugins: ["@trivago/prettier-plugin-sort-imports"], ...options }],
  ianvs: (options: object) => [".prettierrc.json", { plugins: ["@ianvs/prettier-plugin-sort-imports"], ...options }],
  organize: (options: object) => [".prettierrc.json", { plugins: ["prettier-plugin-organize-imports"], ...options }],
  oxfmt: (options: object) => [".oxfmtrc.json", options],
} as const;

async function format(files: Record<string, string>, names: string[]) {
  using dir = tempDir("bun-format-sort-imports", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "format", "--log-level=warn", "."],
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

describe.concurrent("when imports are sorted", () => {
  const unsorted = `import b from "b";\nimport a from "a";\n`;
  const sorted = `import a from "a";\nimport b from "b";\n`;

  test("not without an option that asks for it", async () => {
    const result = await format({ ".prettierrc.json": `{ "semi": true }`, "a.ts": unsorted }, ["a.ts"]);
    expect(result.files).toEqual([unsorted]);
  });

  test("with importOrder, without any plugin", async () => {
    const result = await format({ ".prettierrc.json": `{ "importOrder": ["^[./]"] }`, "a.ts": unsorted }, ["a.ts"]);
    expect(result.files).toEqual([sorted]);
  });

  test("with a plugin that is named, without any option", async () => {
    const config = `{ "plugins": ["@ianvs/prettier-plugin-sort-imports"] }`;
    const result = await format({ ".prettierrc.json": config, "a.ts": unsorted }, ["a.ts"]);
    expect(result.files).toEqual([sorted]);
    expect(result.stderr).toBe("");
  });

  test("in the files of an override only", async () => {
    const config = `{ "overrides": [{ "files": "src/**", "options": { "importOrder": [] } }] }`;
    const result = await format({ ".prettierrc.json": config, "a.ts": unsorted, "src/a.ts": unsorted }, ["a.ts", "src/a.ts"]);
    expect(result.files).toEqual([unsorted, sorted]);
  });

  test("an invalid regular expression is an error", async () => {
    const result = await format({ ".prettierrc.json": `{ "importOrder": ["("] }`, "a.ts": unsorted }, ["a.ts"]);
    expect(result.files).toEqual([unsorted]);
    expect(result.stderr).toContain("importOrder");
    expect(result.exitCode).toBe(2);
  });
});
