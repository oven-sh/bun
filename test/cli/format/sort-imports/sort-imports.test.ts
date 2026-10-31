// The fixtures are the test inputs of @trivago/prettier-plugin-sort-imports, @ianvs/prettier-plugin-sort-imports (both
// Apache-2.0) and oxc's formatter (MIT), plus generated ones with comments and empty lines in odd places. The expected
// output comes from Prettier 3.9.9 with the plugin (for prettier-plugin-organize-imports, with TypeScript 5.9) and from
// oxfmt 0.72. test/cli/format/oracle/sort-imports/make-fixtures.mjs generates them.
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
    cmd: [bunExe(), "fmt", "--log-level=warn", ...flags, "."],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, files: names.map(name => readFileSync(join(String(dir), name), "utf8")) };
}

for (const [tool, config] of Object.entries(tools)) {
  const recorded: Case[] = JSON.parse(readFileSync(join(import.meta.dir, `${tool}.json`), "utf8"));
  // Where @trivago's plugin puts a module whose name is a hexadecimal number depends on its original position, and a
  // second run moves it again. `bun fmt` always puts it in the same position.
  const cases = recorded.filter(it => tool !== "trivago" || !/from (["']) *0x[0-9a-f]+ *\1/i.test(it.input));
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

// hosts.json has scripts in Vue files, in HTML, in HTML in templates and in code blocks, with each tool's output. The
// plugins sort the first `<script>` and the first `<script setup>` at the top of a Vue file, and every script anywhere
// else. oxfmt only sorts imports and rewrites JSDoc comments in a Vue file's scripts.
describe.concurrent("sorts imports in HTML and Vue", () => {
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

describe.concurrent("import sorting", () => {
  const unsorted = `import b from "b";\nimport a from "a";\n`;
  const sorted = `import a from "a";\nimport b from "b";\n`;

  test("like oxfmt, treats a namespace import with a comment before the `*` as a default import", async () => {
    const files = {
      ".oxfmtrc.json": `{ "sortImports": { "groups": ["wildcard-import", "default-import", "unknown"] } }`,
      "a.js": 'import d from "d";\nimport /* c */ * as ns from "x";\nimport * as w from "w";\nimport e from "e";\n',
    };
    const result = await format(files, ["a.js"]);
    expect(result.files).toEqual([
      'import * as w from "w";\n\nimport d from "d";\nimport e from "e";\nimport /* c */ * as ns from "x";\n',
    ]);
    expect(result.exitCode).toBe(0);
  });

  // javascript-natural-sort ranks each of the two below the other, so with the plugin they swap on every run.
  test("with @trivago's plugin, a hexadecimal module name always sorts to the same position", async () => {
    const [first, second] = ['import b from "0x10B";\n', 'import a from "12a";\n'];
    const files = { ".prettierrc.json": JSON.stringify(tools.trivago({ importOrder: [] })[1]) };
    const result = await format({ ...files, "a.js": first + second, "b.js": second + first }, ["a.js", "b.js"]);
    expect(result.files).toEqual([first + second, first + second]);
    expect(result.exitCode).toBe(0);
  });

  test("is off without an option that enables it", async () => {
    const result = await format({ ".prettierrc.json": `{ "semi": true }`, "a.ts": unsorted }, ["a.ts"]);
    expect(result.files).toEqual([unsorted]);
  });

  test("is off with the options of a plugin that isn't listed, which Prettier doesn't know", async () => {
    const config = `{ "importOrder": ["^[./]"], "importOrderSeparation": true, "organizeImportsTypeOrder": "last" }`;
    const result = await format({ ".prettierrc.json": config, "a.ts": unsorted, "b.ts": unsorted }, ["a.ts", "b.ts"]);
    expect(result.files).toEqual([unsorted, unsorted]);
    expect(result.stderr).toBe(
      `warn: Ignored unknown option { importOrder: ["^[./]"] }.\n` +
        `warn: Ignored unknown option { importOrderSeparation: true }.\n` +
        `warn: Ignored unknown option { organizeImportsTypeOrder: "last" }.\n`,
    );
    expect(result.exitCode).toBe(0);
  });

  test("is on with a plugin passed to --plugin", async () => {
    const files = { ".prettierrc.json": `{ "importOrder": ["^[./]"] }`, "a.ts": unsorted };
    const result = await format(files, ["a.ts"], ["--plugin=@trivago/prettier-plugin-sort-imports"]);
    expect(result.files).toEqual([sorted]);
    expect(result.stderr).toBe("");
  });

  test("is on with a listed plugin and no options", async () => {
    const config = `{ "plugins": ["@ianvs/prettier-plugin-sort-imports"] }`;
    const result = await format({ ".prettierrc.json": config, "a.ts": unsorted }, ["a.ts"]);
    expect(result.files).toEqual([sorted]);
    expect(result.stderr).toBe("");
  });

  test("only applies to an override's files", async () => {
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
    // It passes the file to TypeScript, and the file is the Markdown. In a.ts it would remove both imports, because
    // they're unused.
    [
      "prettier-plugin-organize-imports",
      ".prettierrc.json",
      `{ "plugins": ["prettier-plugin-organize-imports"] }`,
      unsorted,
    ],
  ])("in a Markdown code block: %s", async (_, name, config, expected) => {
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
