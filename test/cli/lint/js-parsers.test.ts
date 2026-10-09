import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, normalizeBunSnapshot, tempDir } from "harness";
import { readFileSync } from "node:fs";
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

async function lint(files: Record<string, string>, args: string[], reads: string[] = []) {
  using dir = tempDir("bun-lint-js-parsers", files);
  await using proc = spawn({
    cmd: [bunExe(), "lint", ...(args.includes("--threads") ? [] : ["--threads", "2"]), ...args],
    env,
    cwd: String(dir),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // Where a run ends with an error, or dies, the assertion that fails is often about something else.
  if (exitCode !== 0 && exitCode !== 1) console.error(`bun lint ${args.join(" ")}: exit code ${exitCode}\n${stderr}`);
  return {
    raw: stdout,
    stdout: normalizeBunSnapshot(stdout, String(dir)),
    stderr: normalizeBunSnapshot(stderr, String(dir)),
    exitCode,
    files: Object.fromEntries(reads.map(name => [name, readFileSync(join(String(dir), name), "utf8")])),
  };
}

// `file: line:column rule message`, with what else there is to a message.
function summary(json: string) {
  const lines: string[] = [];
  for (const { filePath, messages, suppressedMessages } of JSON.parse(json)) {
    for (const it of [...messages, ...suppressedMessages]) {
      const extras = [
        it.fatal && "fatal",
        it.fix && `fix ${it.fix.range} ${JSON.stringify(it.fix.text)}`,
        it.suggestions && `${it.suggestions.length} suggestion`,
        it.suppressions && `suppressed: ${it.suppressions[0].justification}`,
      ].filter(Boolean);
      const name = filePath.replaceAll("\\", "/").split("/").at(-1);
      lines.push(`${name}: ${it.line}:${it.column} ${it.ruleId} ${it.message}${extras.map(it => ` [${it}]`).join("")}`);
    }
  }
  return lines.join("\n");
}

// Each thread that needs JavaScript starts a VM, which takes seconds in a debug build.
const timeout = isDebug || isASAN ? 120_000 : 10_000;

// Takes the blocks between ``` out of a file, and puts what is reported about them where they are.
const fenced = (supportsAutofix: boolean) => `
const blocksOf = new Map();
export const processor = {
  meta: { name: "fenced" },
  supportsAutofix: ${supportsAutofix},
  preprocess(text, filename) {
    if (text.includes("BROKEN")) throw Object.assign(new Error("line 3: It is broken."), { lineNumber: 3, column: 7 });
    const blocks = [];
    for (const match of text.matchAll(/^\`\`\`(\\w+)\\n([\\s\\S]*?)^\`\`\`$/gm)) {
      const start = match.index + match[1].length + 4;
      const line = text.slice(0, start).split("\\n").length - 1;
      blocks.push({ text: match[2], filename: "block." + match[1], start, line });
    }
    blocksOf.set(filename, blocks);
    return blocks.map(({ text, filename }) => ({ text, filename }));
  },
  postprocess(lists, filename) {
    const blocks = blocksOf.get(filename);
    return lists.flatMap((messages, i) =>
      messages.map(message => ({
        ...message,
        line: message.line + blocks[i].line,
        endLine: message.endLine && message.endLine + blocks[i].line,
        fix: message.fix && { range: message.fix.range.map(at => at + blocks[i].start), text: message.fix.text },
      })),
    );
  },
};
export default { meta: { name: "eslint-plugin-fenced" }, processors: { fenced: processor } };
`;

const markdown = [
  "# Ünï",
  "",
  "```js",
  "var a = 1",
  "debugger;",
  "// eslint-disable-next-line eqeqeq -- why not",
  "a == 2;",
  "```",
  "",
  "```py",
  "var x",
  "```",
  "",
  "```js",
  'let s = "é" ; var b = s == 1',
  "```",
  "",
].join("\n");

const rules = `
  { files: ["**/*.js"], rules: { "no-var": "error", semi: "error", "no-debugger": "warn" } },
  { files: ["**/*.md/*.js"], rules: { "no-debugger": "off", eqeqeq: "error" } },
`;

describe.concurrent("bun lint with processors", () => {
  test(
    "the blocks are linted with the configuration for their own names, next to other files",
    async () => {
      const result = await lint(
        {
          "fenced.mjs": fenced(true),
          "eslint.config.mjs": `
            import fenced from "./fenced.mjs";
            export default [{ files: ["**/*.md"], plugins: { fenced }, processor: "fenced/fenced" }, ${rules}];`,
          "a.md": markdown,
          "b.js": "var z = 1\ndebugger;\n",
        },
        ["-f", "json", "a.md", "b.js"],
      );
      expect(result.stderr).not.toContain("error");
      expect(summary(result.raw)).toMatchInlineSnapshot(`
        "a.md: 4:1 no-var Unexpected var, use let or const instead. [fix 13,22 "let a = 1"]
        a.md: 4:10 semi Missing semicolon. [fix 22,22 ";"]
        a.md: 15:15 no-var Unexpected var, use let or const instead. [fix 129,143 "let b = s == 1"]
        a.md: 15:25 eqeqeq Expected '===' and instead saw '=='. [1 suggestion]
        a.md: 15:29 semi Missing semicolon. [fix 143,143 ";"]
        a.md: 7:3 eqeqeq Expected '===' and instead saw '=='. [1 suggestion] [suppressed: why not]
        b.js: 1:1 no-var Unexpected var, use let or const instead. [fix 0,9 "let z = 1"]
        b.js: 1:10 semi Missing semicolon. [fix 9,9 ";"]
        b.js: 2:1 no-debugger Unexpected 'debugger' statement."
      `);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "--fix fixes the blocks in the file",
    async () => {
      const result = await lint(
        {
          "fenced.mjs": fenced(true),
          "eslint.config.mjs": `
            import fenced from "./fenced.mjs";
            export default [{ files: ["**/*.md"], plugins: { fenced }, processor: "fenced/fenced" }, ${rules}];`,
          "a.md": markdown,
        },
        ["--fix", "-f", "json", "a.md"],
        ["a.md"],
      );
      expect(result.files["a.md"]).toMatchInlineSnapshot(`
        "# Ünï

        \`\`\`js
        let a = 1;
        debugger;
        // eslint-disable-next-line eqeqeq -- why not
        a == 2;
        \`\`\`

        \`\`\`py
        var x
        \`\`\`

        \`\`\`js
        let s = "é" ; let b = s == 1;
        \`\`\`
        "
      `);
      expect(summary(result.raw)).toMatchInlineSnapshot(`
        "a.md: 15:25 eqeqeq Expected '===' and instead saw '=='. [1 suggestion]
        a.md: 7:3 eqeqeq Expected '===' and instead saw '=='. [1 suggestion] [suppressed: why not]"
      `);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "a processor that an object of the configuration has itself, without supportsAutofix: no fixes",
    async () => {
      const result = await lint(
        {
          "fenced.mjs": fenced(false),
          "eslint.config.mjs": `
            import { processor } from "./fenced.mjs";
            export default [{ files: ["**/*.md"], processor }, ${rules}];`,
          "a.md": markdown,
        },
        ["--fix", "-f", "json", "a.md"],
        ["a.md"],
      );
      expect(result.files["a.md"]).toBe(markdown);
      expect(summary(result.raw)).toMatchInlineSnapshot(`
        "a.md: 4:1 no-var Unexpected var, use let or const instead.
        a.md: 4:10 semi Missing semicolon.
        a.md: 15:15 no-var Unexpected var, use let or const instead.
        a.md: 15:25 eqeqeq Expected '===' and instead saw '=='.
        a.md: 15:29 semi Missing semicolon.
        a.md: 7:3 eqeqeq Expected '===' and instead saw '=='. [suppressed: why not]"
      `);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "a processor that throws, blocks without a name, and a processor that does not exist",
    async () => {
      const files = {
        "fenced.mjs": fenced(true),
        "eslint.config.mjs": `
          import fenced from "./fenced.mjs";
          const halves = {
            preprocess: text => text.split("~~~\\n"),
            postprocess: lists => lists.flat(),
          };
          export default [
            { files: ["**/*.md"], plugins: { fenced }, processor: "fenced/fenced" },
            { files: ["**/*.halves"], processor: halves, rules: { "no-var": "error" } },
            { files: ["**/*.none"], plugins: { fenced }, processor: "fenced/none" },
          ];`,
        "a.md": "one\ntwo\nBROKEN\n",
        "b.halves": "var a;\n~~~\nlet b;\nvar c;\n",
        "c.none": "",
      };
      const result = await lint(files, ["-f", "json", "a.md", "b.halves"]);
      expect(summary(result.raw)).toMatchInlineSnapshot(`
        "a.md: 3:7 null Preprocessing error: It is broken. [fatal]
        b.halves: 1:1 no-var Unexpected var, use let or const instead.
        b.halves: 2:1 no-var Unexpected var, use let or const instead."
      `);
      expect(result.exitCode).toBe(1);
      const missing = await lint(files, ["c.none"]);
      expect(missing.stderr).toContain(`Key "processor": Could not find "none" in plugin "fenced".`);
      expect(missing.exitCode).toBe(2);
    },
    timeout,
  );

  test(
    "a rule in JavaScript sees the name of the block and the name of the file",
    async () => {
      const result = await lint(
        {
          "fenced.mjs": fenced(true),
          "eslint.config.mjs": `
            import { relative } from "node:path";
            import fenced from "./fenced.mjs";
            const names = {
              rules: {
                names: {
                  create: context => ({
                    Program(node) {
                      const [name, physical] = [context.filename, context.physicalFilename].map(it =>
                        relative(context.cwd, it).replaceAll("\\\\", "/"),
                      );
                      context.report({ node, message: name + " in " + physical });
                    },
                  }),
                },
              },
            };
            export default [
              { files: ["**/*.md"], plugins: { fenced }, processor: "fenced/fenced" },
              { files: ["**/*.js"], plugins: { names }, rules: { "names/names": "error" } },
            ];`,
          "docs/a.md": "```js\nlet a;\n```\n",
          "b.js": "let b;\n",
        },
        ["-f", "json", "docs/a.md", "b.js"],
      );
      expect(summary(result.raw)).toMatchInlineSnapshot(`
        "b.js: 1:1 names/names b.js in b.js
        a.md: 2:1 names/names docs/a.md/0_block.js in docs/a.md"
      `);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  // As with `configs.recommended` and `configs.processor` of @eslint/markdown.
  test(
    "a file with a language and a processor goes to the processor",
    async () => {
      const files = {
        "fenced.mjs": fenced(true),
        "eslint.config.mjs": `
          import fenced, { processor } from "./fenced.mjs";
          const whole = { preprocess: text => [text], postprocess: lists => lists.flat() };
          const plugin = { ...fenced, languages: { text: {} }, processors: { fenced: processor, whole } };
          export default [
            { files: ["**/*.md", "**/*.txt"], plugins: { fenced: plugin }, language: "fenced/text", languageOptions: { frontmatter: "yaml" } },
            { files: ["**/*.md"], processor: "fenced/fenced" },
            { files: ["**/*.txt"], processor: "fenced/whole" },
            { files: ["**/*.md/*.js"], rules: { "no-var": "error" } },
          ];`,
        "a.md": "```js\nvar a;\n```\n",
        "b.txt": "var b;\n",
      };
      const result = await lint(files, ["-f", "json", "a.md"]);
      expect(summary(result.raw)).toMatchInlineSnapshot(
        `"a.md: 2:1 no-var Unexpected var, use let or const instead. [fix 6,12 "let a;"]"`,
      );
      expect(result.exitCode).toBe(1);
      // What the processor gives back without a name is for the language.
      const whole = await lint(files, ["b.txt"]);
      expect(whole.stderr).toContain(`b.txt returns text in the language "fenced/text".`);
      expect(whole.exitCode).toBe(2);
    },
    timeout,
  );
});

// Enough of the package `eslint` to lint a text in the language of a plugin: `Linter.verify` with one object of configuration.
const eslintPackage = {
  "node_modules/eslint/package.json": JSON.stringify({ name: "eslint", version: "10.0.0", main: "index.js" }),
  "node_modules/eslint/index.js": `
    exports.Linter = class Linter {
      #suppressed = [];
      verify(text, [config], { filename, disableFixes }) {
        const [prefix, name] = (config.language ?? "@/js").split("/");
        const { ast } =
          prefix === "@"
            ? config.languageOptions.parser.parseForESLint(text, config.languageOptions.parserOptions)
            : config.plugins[prefix].languages[name].parse({ body: text, path: filename }, config);
        const messages = [];
        for (const [ruleId, [severity, ...options]] of Object.entries(config.rules)) {
          const [plugin, rule] = ruleId.split("/");
          const report = ({ line, message, fix }) =>
            messages.push({ ruleId, severity, message, line, column: 1, ...(fix && !disableFixes ? { fix } : {}) });
          config.plugins[plugin].rules[rule].create({ options, filename, settings: config.settings, report }).Line?.(ast);
        }
        const isOff = it => ast.lines[it.line - 1].endsWith("# off");
        this.#suppressed = messages.filter(isOff).map(it => ({ ...it, suppressions: [{ kind: "directive", justification: "" }] }));
        return messages.filter(it => !isOff(it));
      }
      getSuppressedMessages() {
        return this.#suppressed;
      }
    };`,
};

const lines = {
  "lines.mjs": `
    import noTabs from "./no-tabs.mjs";
    globalThis.loaded = [...(globalThis.loaded ?? []), "lines"];
    export default {
      languages: { text: { parse: ({ body }, { languageOptions }) => ({ ok: true, ast: { lines: body.split("\\n"), languageOptions } }) } },
      rules: { "no-tabs": noTabs },
    };`,
  "no-tabs.mjs": `
    export default {
      meta: { schema: [{ type: "string" }] },
      create: context => ({
        Line({ lines, languageOptions }) {
          let start = 0;
          for (const [i, line] of lines.entries()) {
            const at = line.indexOf("\\t");
            if (at !== -1) {
              const message = ["tab", context.options[0], languageOptions.width, context.settings.name, context.filename.split(/[\\\\/]/).at(-1)].join(" ");
              context.report({ line: i + 1, message, fix: { range: [start + at, start + at + 1], text: " " } });
            }
            start += line.length + 1;
          }
        },
      }),
    };`,
  "eslint.config.mjs": `
    import lines from "./lines.mjs";
    export default [
      { rules: { "no-var": "error" } },
      {
        files: ["**/*.txt"],
        plugins: { lines },
        language: "lines/text",
        languageOptions: { width: 4 },
        settings: { name: "s" },
        rules: { "no-var": "off", "lines/no-tabs": ["error", "o"] },
      },
    ];`,
  "a.js": "var a;\n",
  "b.txt": "one\n\ttwo\t\n\tthree # off\n",
};

describe.concurrent("bun lint with languages", () => {
  test(
    "a file in the language of a plugin is linted by the Linter of the eslint that is installed",
    async () => {
      const result = await lint({ ...eslintPackage, ...lines }, ["-f", "json", "a.js", "b.txt"]);
      expect(summary(result.raw)).toMatchInlineSnapshot(`
        "a.js: 1:1 no-var Unexpected var, use let or const instead. [fix 0,6 "let a;"]
        b.txt: 2:1 lines/no-tabs tab o 4 s b.txt [fix 4,5 " "]
        b.txt: 3:1 lines/no-tabs tab o 4 s b.txt [fix 10,11 " "] [suppressed: ]"
      `);
      expect(result.stderr).not.toContain("not linted");
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  // As `vue-eslint-parser` for `.vue`.
  test(
    "so is a file that a parser of its own reads",
    async () => {
      const result = await lint(
        {
          ...eslintPackage,
          ...lines,
          "parser.cjs": `
            const parseForESLint = (text, languageOptions) => ({ ast: { lines: text.split("\\n"), languageOptions } });
            module.exports = { meta: { name: "vue-eslint-parser", version: "10.0.0" }, parseForESLint };`,
          "eslint.config.mjs": `
            import lines from "./lines.mjs";
            import parser from "./parser.cjs";
            export default [
              { files: ["**/*.vue"], plugins: { lines }, languageOptions: { parser, parserOptions: { width: 8 } }, settings: { name: "v" }, rules: { "lines/no-tabs": ["error", "p"] } },
            ];`,
          "c.vue": "<template>\n\t<p />\n</template>\n",
        },
        ["-f", "json", "--timing", "c.vue"],
      );
      expect(summary(result.raw)).toMatchInlineSnapshot(`"c.vue: 2:1 lines/no-tabs tab p 8 v c.vue [fix 11,12 " "]"`);
      expect(result.stderr).toContain("the package eslint has linted 1 texts");
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "so is a file for which eslint-plugin-html is configured, which changes the Linter when it is loaded",
    async () => {
      const result = await lint(
        {
          ...eslintPackage,
          "node_modules/eslint-plugin-html/package.json": JSON.stringify({
            name: "eslint-plugin-html",
            main: "index.js",
          }),
          "node_modules/eslint-plugin-html/index.js": `
            require("eslint").Linter.prototype.verify = text => {
              const line = text.split("\\n").indexOf("<script>") + 1;
              return [{ ruleId: "no-var", severity: 2, message: "a script", line, column: 1 }];
            };`,
          "eslint.config.mjs": `
            import html from "eslint-plugin-html";
            export default [{ rules: { "no-var": "error" } }, { files: ["**/*.html"], plugins: { html } }];`,
          "a.html": "<p>\n<script>\nvar a;\n</script>\n",
          "b.js": "var b;\n",
        },
        ["-f", "unix", "a.html", "b.js"],
      );
      expect(result.stdout).toMatchInlineSnapshot(`
        "<dir>/a.html:2:1: a script [Error/no-var]
        <dir>/b.js:1:1: Unexpected var, use let or const instead. [Error/no-var]

        2 problems"
      `);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  // As @antfu/eslint-config for `.vue`: the export is a promise, and the processor forgets a file in `postprocess`.
  test(
    "the whole configuration file, which exports a promise, and a processor, which is called once",
    async () => {
      const result = await lint(
        {
          ...eslintPackage,
          ...lines,
          "node_modules/eslint/lib/config/flat-config-array.js": `
            exports.FlatConfigArray = class extends Array {
              constructor(configs) {
                super();
                this.push(...configs);
              }
              normalize() {}
              getConfig(name) {
                const found = [...this].filter(it => it.files?.some(pattern => name.endsWith(pattern.slice(4))));
                return found.length === 0 ? undefined : Object.assign({}, ...found);
              }
            };`,
          "node_modules/eslint/index.js": `
            exports.Linter = class {
              verify(text, configs, { filename }) {
                const { processor, rules } = configs.getConfig(filename) ?? {};
                if (rules === undefined) return [{ ruleId: null, severity: 1, message: "no configuration", line: 0, column: 0 }];
                const message = { ruleId: "own/seen", severity: 2, message: Object.keys(rules).join(), line: 1, column: 1 };
                return processor ? processor.postprocess(processor.preprocess(text, filename).map(() => [message]), filename) : [message];
              }
              getSuppressedMessages() {
                return [];
              }
            };`,
          "eslint.config.mjs": `
            const known = new Set();
            const processor = {
              preprocess: (text, name) => (known.add(name), [text]),
              postprocess(lists, name) {
                if (!known.delete(name)) throw new Error("postprocess() without preprocess()");
                return lists.flat();
              },
            };
            const parser = { meta: { name: "vue-eslint-parser" }, parseForESLint() {} };
            const own = { rules: { seen: { create: () => ({}) } }, processors: { processor } };
            export default Promise.resolve([
              { files: ["**/*.vue"], plugins: { own }, processor: "own/processor", languageOptions: { parser }, rules: { "own/seen": "error" } },
            ]);`,
          "c.vue": "<template />\n",
        },
        ["-f", "unix", "c.vue"],
      );
      expect(result.stdout).toMatchInlineSnapshot(`
        "<dir>/c.vue:1:1: own/seen [Error/own/seen]

        1 problem"
      `);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "files for which the parser is asked for types all go to one engine",
    async () => {
      const files: Record<string, string> = {
        ...eslintPackage,
        "node_modules/eslint/index.js": `
          const realm = Math.random();
          exports.Linter = class {
            verify = () => [{ ruleId: "own/seen", severity: 2, message: String(realm), line: 1, column: 1 }];
            getSuppressedMessages = () => [];
          };`,
        "plugin.mjs": `export default { rules: { seen: { create: () => ({}) } } };`,
        "parser.cjs": `module.exports = { meta: { name: "vue-eslint-parser" }, parseForESLint() {} };`,
        "eslint.config.mjs": `
          import own from "./plugin.mjs";
          import parser from "./parser.cjs";
          const typed = { parser, parserOptions: { projectService: true } };
          export default [
            { files: ["typed/*.vue"], plugins: { own }, languageOptions: typed, rules: { "own/seen": "error" } },
            { files: ["plain/*.vue"], plugins: { own }, languageOptions: { parser }, rules: { "own/seen": "error" } },
          ];`,
      };
      // 6 MB, which is work for several engines.
      const text = Buffer.alloc(250_000, "<!-- comment -->\n").toString();
      for (let i = 0; i < 24; i++) files[`typed/${i}.vue`] = files[`plain/${i}.vue`] = text;
      const realms = async (directory: string) => {
        const result = await lint(files, ["-f", "json", "--threads", "8", directory]);
        expect(result.exitCode).toBe(1);
        const messages = JSON.parse(result.raw).flatMap((it: any) => it.messages.map((it: any) => it.message));
        return [messages.length, new Set(messages).size];
      };
      expect(await realms("typed")).toEqual([24, 1]);
      expect((await realms("plain"))[1]).toBeGreaterThan(1);
    },
    timeout,
  );

  test(
    "--fix goes on until nothing is left to fix",
    async () => {
      const result = await lint({ ...eslintPackage, ...lines }, ["--fix", "b.txt"], ["b.txt"]);
      expect(result.files).toEqual({ "b.txt": "one\n two \n\tthree # off\n" });
      expect(result.exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "without the package eslint such files are named, and the others are linted",
    async () => {
      const result = await lint(lines, ["-f", "unix", "a.js", "b.txt"]);
      expect(result.stdout).toContain("a.js:1:1: Unexpected var, use let or const instead. [Error/no-var]");
      expect(result.stderr).toContain(
        `1 file was not linted, only JavaScript and TypeScript can be (1 *.txt): b.txt. The package "eslint" lints other languages, if it is installed`,
      );
      expect(result.exitCode).toBe(2);
    },
    timeout,
  );
});

const oxlintrc = JSON.stringify({
  categories: { correctness: "off" },
  rules: {
    "no-var": "error",
    "no-debugger": "error",
    eqeqeq: "error",
    "no-unused-vars": "error",
    "no-undef": "error",
    "no-unused-labels": "error",
    "prefer-const": "error",
  },
});

// `file line:column rule` of oxlint's JSON.
const diagnostics = (json: string) =>
  JSON.parse(json)
    .diagnostics.map((it: any) => `${it.filename} ${it.labels[0].span.line}:${it.labels[0].span.column} ${it.code}`)
    .sort()
    .join("\n");

const scripts = {
  ".oxlintrc.json": oxlintrc,
  "a.vue": `<template>
  <div @click="go(x == 1)">{{ msg }}</div>
  <!-- <script>var inComment = 1</script> -->
</template>

<script lang="ts">
var a: number = 1;
debugger;
export default { name: "a" };
</script>

<script setup lang="ts" generic="T extends Record<string, string>">
import { ref } from "vue";
const props = defineProps<{ x: number }>();
let msg = ref("é"); var unused = 2;
if (msg.value == "1") undefinedThing();
// oxlint-disable-next-line no-debugger
debugger;
</script>

<script>
var third = 1; debugger;
</script>
`,
  "b.svelte": `<script module lang="ts">
  export var m: number = 1;
</script>
<script-like>var no = 1;</script-like>
<script>
  let count = 0;
  $: doubled = count * 2;
  var v = 1; debugger;
</script>
<button on:click={() => count == 1}>{doubled}</button>
`,
  "c.astro": `---
let title: string = "x"; var y = 1;
debugger;
---
<html><body>{title}
<script>var z = 1; debugger;</script>
<script type="application/json">{"a": 1}</script>
<script is:inline src="x.js" />
</body></html>
`,
  // No language that is known: nothing from there on is linted.
  "d.vue": `<script lang="coffee">
x = 1
</script>
<script setup>
debugger;
</script>
`,
};

describe.concurrent("bun lint with an .oxlintrc.json", () => {
  test("lints the scripts in .vue, .svelte and .astro files, as oxlint does", async () => {
    const result = await lint(scripts, ["-f", "json"]);
    // What oxlint 1.80 reports.
    expect(diagnostics(result.raw)).toMatchInlineSnapshot(`
      "a.vue 14:15 eslint(no-undef)
      a.vue 15:22 eslint(no-var)
      a.vue 16:15 eslint(eqeqeq)
      a.vue 16:23 eslint(no-undef)
      a.vue 7:1 eslint(no-var)
      a.vue 8:1 eslint(no-debugger)
      b.svelte 2:10 eslint(no-var)
      b.svelte 7:6 eslint(no-undef)
      b.svelte 8:14 eslint(no-debugger)
      b.svelte 8:3 eslint(no-var)
      c.astro 2:26 eslint(no-var)
      c.astro 2:5 eslint(prefer-const)
      c.astro 3:1 eslint(no-debugger)
      c.astro 6:20 eslint(no-debugger)
      c.astro 6:9 eslint(no-var)"
    `);
    expect(JSON.parse(result.raw).number_of_files).toBe(4);
    expect(result.exitCode).toBe(1);
  });

  test("--fix fixes the scripts where they are", async () => {
    const result = await lint(scripts, ["--fix", "-f", "json"], ["a.vue", "b.svelte", "c.astro", "d.vue"]);
    // The bytes that oxlint 1.87 writes.
    expect(result.files).toMatchInlineSnapshot(`
      {
        "a.vue": 
      "<template>
        <div @click="go(x == 1)">{{ msg }}</div>
        <!-- <script>var inComment = 1</script> -->
      </template>

      <script lang="ts">
      const a: number = 1;
      debugger;
      export default { name: "a" };
      </script>

      <script setup lang="ts" generic="T extends Record<string, string>">
      import { ref } from "vue";
      const props = defineProps<{ x: number }>();
      let msg = ref("é"); const unused = 2;
      if (msg.value == "1") undefinedThing();
      // oxlint-disable-next-line no-debugger
      debugger;
      </script>

      <script>
      var third = 1; debugger;
      </script>
      "
      ,
        "b.svelte": 
      "<script module lang="ts">
        export const m: number = 1;
      </script>
      <script-like>var no = 1;</script-like>
      <script>
        let count = 0;
        $: doubled = count * 2;
        const v = 1; debugger;
      </script>
      <button on:click={() => count == 1}>{doubled}</button>
      "
      ,
        "c.astro": 
      "---
      const title: string = "x"; const y = 1;
      debugger;
      ---
      <html><body>{title}
      <script>const z = 1; debugger;</script>
      <script type="application/json">{"a": 1}</script>
      <script is:inline src="x.js" />
      </body></html>
      "
      ,
        "d.vue": 
      "<script lang="coffee">
      x = 1
      </script>
      <script setup>
      debugger;
      </script>
      "
      ,
      }
    `);
    expect(result.exitCode).toBe(1);
  });
});
