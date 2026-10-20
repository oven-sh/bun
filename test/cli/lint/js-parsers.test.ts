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

async function lint(files: Record<string, string | Buffer>, args: string[], reads: string[] = [], stdin?: string) {
  using dir = tempDir("bun-lint-js-parsers", files);
  await using proc = spawn({
    cmd: [bunExe(), "lint", ...(args.includes("--threads") ? [] : ["--threads", "2"]), ...args],
    env,
    cwd: String(dir),
    stdin: stdin === undefined ? "ignore" : Buffer.from(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // If a run fails or crashes, the assertion that fails is often about something else, so print the real cause.
  if (exitCode !== 0 && exitCode !== 1) console.error(`bun lint ${args.join(" ")}: exit code ${exitCode}\n${stderr}`);
  return {
    raw: stdout,
    stdout: normalizeBunSnapshot(stdout, String(dir)),
    stderr: normalizeBunSnapshot(stderr, String(dir)),
    exitCode,
    files: Object.fromEntries(reads.map(name => [name, readFileSync(join(String(dir), name), "utf8")])),
  };
}

// Returns `file: line:column rule message` for each message, followed by its other properties in brackets.
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

// Debug builds are 10 to 100 times slower, so the big inputs are smaller there.
const many = (count: number) => (isDebug || isASAN ? count / 10 : count);

// Same as `fill.repeat(count)`, which is slow in a debug build.
const repeated = (fill: string, count: number) => Buffer.alloc(count * Buffer.byteLength(fill), fill).toString();

// Test-only commands are only compiled into debug and canary builds.
const hasTestRunner =
  isDebug || Bun.spawnSync({ cmd: [bunExe(), "--revision"], env: bunEnv }).stdout.includes("canary");

// A processor that extracts the ``` blocks from a file, and maps their reports back to positions in the file.
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
  { files: ["**/*.js"], rules: { "no-var": "error", "no-debugger": "warn" } },
  { files: ["**/*.md/*.js"], rules: { "no-debugger": "off", eqeqeq: "error" } },
`;

describe.concurrent("bun lint with processors", () => {
  test(
    "lints each block with the config for the block's own name, alongside other files",
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
        "a.md: 4:1 no-var Unexpected var, use let or const instead. [fix 13,16 "let"]
        a.md: 15:15 no-var Unexpected var, use let or const instead. [fix 129,132 "let"]
        a.md: 15:25 eqeqeq Expected '===' and instead saw '=='. [1 suggestion]
        a.md: 7:3 eqeqeq Expected '===' and instead saw '=='. [1 suggestion] [suppressed: why not]
        b.js: 1:1 no-var Unexpected var, use let or const instead. [fix 0,3 "let"]
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
        let a = 1
        debugger;
        // eslint-disable-next-line eqeqeq -- why not
        a == 2;
        \`\`\`

        \`\`\`py
        var x
        \`\`\`

        \`\`\`js
        let s = "é" ; let b = s == 1
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
    "an inline processor object without supportsAutofix gets no fixes",
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
        a.md: 15:15 no-var Unexpected var, use let or const instead.
        a.md: 15:25 eqeqeq Expected '===' and instead saw '=='.
        a.md: 7:3 eqeqeq Expected '===' and instead saw '=='. [suppressed: why not]"
      `);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "handles a processor that throws, blocks without a name, and a processor that doesn't exist",
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
    "a JavaScript rule gets the block's name and the file's name",
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

  // This is what @eslint/markdown's `configs.recommended` and `configs.processor` give you together.
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
        `"a.md: 2:1 no-var Unexpected var, use let or const instead. [fix 6,9 "let"]"`,
      );
      expect(result.exitCode).toBe(1);
      // A block that the processor returns without a name is linted in the file's language.
      const unnamedBlock = await lint(files, ["b.txt"]);
      expect(unnamedBlock.stderr).toContain(
        "1 file was not linted because it needs eslint, which is not installed (1 *.txt): b.txt",
      );
      expect(unnamedBlock.exitCode).toBe(2);
    },
    timeout,
  );
});

// A stand-in for the `eslint` package with just enough to lint text in a plugin's language: `Linter.verify` with one
// config object.
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
    "a file in a plugin's language is linted by the installed eslint's Linter",
    async () => {
      const result = await lint({ ...eslintPackage, ...lines }, ["-f", "json", "a.js", "b.txt"]);
      expect(summary(result.raw)).toMatchInlineSnapshot(`
        "a.js: 1:1 no-var Unexpected var, use let or const instead. [fix 0,3 "let"]
        b.txt: 2:1 lines/no-tabs tab o 4 s b.txt [fix 4,5 " "]
        b.txt: 3:1 lines/no-tabs tab o 4 s b.txt [fix 10,11 " "] [suppressed: ]"
      `);
      expect(result.stderr).not.toContain("not linted");
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  // Like `vue-eslint-parser` for `.vue`.
  test(
    "a file with a custom parser is linted by the installed eslint's Linter",
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
      expect(result.stderr).toContain("the eslint package linted 1 files");
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  // `Linter#verify` has accepted a `ruleFilter` since ESLint 9. ESLint 8's runs every rule, and then reports a comment
  // that disables one of them as unused.
  test.each([
    ["9", "rules.filter(ruleFilter)"],
    ["8", `[...rules, ...["'semi'", "'indent' or 'semi'", "'semi' or 'no-var'"].map(unused)]`],
  ])(
    "the deprecated layout rules don't run in the installed eslint either: ESLint %s",
    async (_, reported) => {
      const result = await lint(
        {
          ...eslintPackage,
          // Reports one message for each rule that runs.
          "node_modules/eslint/index.js": `
            const unused = names => ({ ruleId: null, severity: 1, text: "Unused eslint-disable directive (no problems were reported from " + names + ")." });
            exports.Linter = class Linter {
              verify(text, [config], { ruleFilter }) {
                const rules = Object.entries(config.rules).map(([ruleId, [severity]]) => ({ ruleId, severity, text: "It ran." }));
                return ${reported}.map(({ text, ...it }) => ({ ...it, message: text, line: 1, column: 1 }));
              }
              getSuppressedMessages() {
                return [{ ruleId: "semi", severity: 2, message: "It ran.", line: 1, column: 1, suppressions: [{ kind: "directive", justification: "" }] }].slice(${reported.startsWith("rules") ? 1 : 0});
              }
            };`,
          "parser.cjs": `module.exports = { meta: { name: "vue-eslint-parser", version: "10.0.0" }, parseForESLint() {} };`,
          "eslint.config.mjs": `
            import parser from "./parser.cjs";
            export default [{ files: ["**/*.vue"], languageOptions: { parser }, rules: { semi: "error", "no-var": "error", indent: "warn" } }];`,
          "c.vue": "<template />\n",
        },
        ["-f", "json", "c.vue"],
      );
      expect(summary(result.raw).split("\n")).toEqual([
        "c.vue: 1:1 no-var It ran.",
        ...(reported.startsWith("rules")
          ? []
          : ["c.vue: 1:1 null Unused eslint-disable directive (no problems were reported from 'semi' or 'no-var')."]),
      ]);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  // Like `@babel/eslint-parser` with a plugin for syntax that isn't standard yet. Bun parses a file with a JavaScript
  // extension itself if it can. As in nodejs/node, the packages aren't in a directory above the config file: eslint is
  // next to the parser.
  test(
    "a .js file that only its custom parser can parse goes to the installed eslint, and no rule sees Bun's tree for it",
    async () => {
      const result = await lint(
        {
          ...Object.fromEntries(Object.entries(eslintPackage).map(([name, text]) => [`tools/${name}`, text])),
          ...lines,
          "tools/node_modules/@babel/eslint-parser/package.json": JSON.stringify({ main: "index.js" }),
          "tools/node_modules/@babel/eslint-parser/index.js": `
            const parseForESLint = (text, languageOptions) => ({ ast: { lines: text.split("\\n"), languageOptions } });
            module.exports = { meta: { name: "@babel/eslint-parser", version: "8.0.0" }, parseForESLint };`,
          "members.mjs": `
            const objects = { create: context => ({ MemberExpression: node => context.report({ node, message: node.object.type }) }) };
            export default { rules: { objects } };`,
          "eslint.config.mjs": `
            import lines from "./lines.mjs";
            import members from "./members.mjs";
            import parser from "./tools/node_modules/@babel/eslint-parser/index.js";
            export default [
              {
                files: ["*.js"],
                plugins: { lines, members },
                languageOptions: { parser, parserOptions: { width: 2 } },
                settings: { name: "b" },
                rules: { "lines/no-tabs": ["error", "q"], "members/objects": "error" },
              },
            ];`,
          "plain.js": "a.b;\n",
          "phase.js": "const it = await import.source('./it.wasm');\n\tit.b;\n",
        },
        ["-f", "json", "--timing", "plain.js", "phase.js"],
      );
      expect(summary(result.raw)).toMatchInlineSnapshot(`
        "phase.js: 2:1 lines/no-tabs tab q 2 b phase.js [fix 45,46 " "]
        plain.js: 1:1 members/objects Identifier"
      `);
      expect(result.stderr).toContain("the eslint package linted 1 files");
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "a file configured with eslint-plugin-html, which patches the Linter when it loads, goes to the installed eslint",
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

  // Like @antfu/eslint-config for `.vue`: the export is a promise, and the processor forgets a file in `postprocess`.
  test(
    "passes on a whole config file that exports a promise, and calls its processor only once",
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

  describe("config objects from bunfig.toml and the command line work with ESLint 9.0", () => {
    // A stand-in for ESLint 9.0, which rejects keys it doesn't know. `basePath` in config objects came in 9.30.
    const strictEslint = {
      "node_modules/eslint/package.json": JSON.stringify({ name: "eslint", version: "9.0.0", main: "index.js" }),
      "node_modules/eslint/lib/config/flat-config-array.js": `
        const path = require("node:path");
        const known = ["name", "files", "ignores", "settings", "linterOptions", "languageOptions", "processor", "plugins", "rules"];
        exports.FlatConfigArray = class {
          #configs = [];
          constructor(configs, { basePath }) {
            this.basePath = basePath;
            this.push(...configs);
          }
          push(...configs) {
            this.#configs.push(...configs);
          }
          normalize() {
            const unknown = this.#configs.flatMap(Object.keys).find(key => !known.includes(key));
            if (unknown !== undefined) throw new Error(\`Unexpected key "\${unknown}" found.\`);
          }
          getConfig(file) {
            const relative = path.relative(this.basePath, file).replaceAll("\\\\", "/");
            // Like in ESLint, a negated pattern on its own ignores nothing.
            const matches = it => (typeof it === "function" ? it(file) : !it.startsWith("!") && new Bun.Glob(it).match(relative));
            const applies = it => (it.files?.some(matches) ?? true) && !(it.rules && it.ignores?.some(matches));
            return { rules: Object.assign({}, ...this.#configs.filter(applies).map(it => it.rules)) };
          }
        };`,
      "node_modules/eslint/index.js": `
        exports.Linter = class {
          verify(text, configs, { filename }) {
            const isOn = configs.getConfig(filename).rules["no-console"] !== "off";
            return isOn ? [{ ruleId: "no-console", severity: 2, message: "from the installed ESLint", line: 1, column: 1 }] : [];
          }
          getSuppressedMessages() {
            return [];
          }
        };`,
    };
    // The parser is an inline object, so the .vue files need the whole config file plus what Bun adds to it.
    const config = `
      const parser = { meta: { name: "vue-eslint-parser" }, parseForESLint() {} };
      export default [{ rules: { "no-console": "error" } }, { files: ["**/*.vue"], languageOptions: { parser } }];`;
    // Bun lints the .js files itself and sends the .vue files to the installed ESLint.
    const tree = Object.fromEntries(
      ["b", "b.test", "vendor/d.test", "deep/c.test"].flatMap(name => [
        [`tree/${name}.js`, "console.log(1);\n"],
        [`tree/${name}.vue`, "<template />\n"],
      ]),
    );
    const bunfig = (prefix: string) => `
[lint]
ignorePatterns = ["${prefix}deep/"]
[[lint.overrides]]
files = ["*.test.*"]
excludeFiles = ["${prefix}vendor/**"]
rules = { "no-console" = "off" }
`;
    /** Returns the files under tree/ that have a problem. */
    async function reported(files: Record<string, string>, args: string[]) {
      const { raw, stderr, exitCode } = await lint({ ...strictEslint, ...tree, ...files }, ["-f", "json", ...args]);
      expect({ stderr: stderr.replace(/^Linted .*$/m, ""), exitCode }).toEqual({ stderr: "", exitCode: 1 });
      const results: { filePath: string; messages: unknown[] }[] = JSON.parse(raw);
      const names = results.filter(it => it.messages.length > 0).map(it => it.filePath.replaceAll("\\", "/"));
      return names.map(it => it.slice(it.indexOf("/tree/") + "/tree/".length)).sort();
    }
    const expected = ["b.js", "b.vue", "vendor/d.test.js", "vendor/d.test.vue"];

    test(
      "from the config file's directory",
      async () => {
        const files = { "tree/eslint.config.mjs": config, "tree/bunfig.toml": bunfig("") };
        expect(await reported(files, ["--cwd", "tree", "."])).toEqual(expected);
      },
      timeout,
    );

    test(
      "from a subdirectory",
      async () => {
        const files = { "eslint.config.mjs": config, "tree/bunfig.toml": bunfig("") };
        expect(await reported(files, ["--cwd", "tree", "."])).toEqual(expected);
      },
      timeout,
    );

    test(
      "from a directory above the config file",
      async () => {
        const files = { "tree/eslint.config.mjs": config, "bunfig.toml": bunfig("tree/") };
        expect(await reported(files, ["tree"])).toEqual(expected);
      },
      timeout,
    );

    test(
      "with --ignore-pattern and --rule from a subdirectory",
      async () => {
        const files = { "eslint.config.mjs": config, "tree/bunfig.toml": bunfig("") };
        const args = ["--cwd", "tree", "--ignore-pattern", "vendor/", "--rule", "no-console: error", "."];
        expect(await reported(files, args)).toEqual(["b.js", "b.test.js", "b.test.vue", "b.vue"]);
      },
      timeout,
    );

    test(
      "extglobs and brace ranges select the same files on both sides",
      async () => {
        const names = ["a/x", "ab/x", "c/x", "f1", "f3", "f4"];
        const both = (names: string[]) => names.flatMap(name => [`globs/${name}.js`, `globs/${name}.vue`]);
        const override = (patterns: string) => ({
          "eslint.config.mjs": config,
          ...Object.fromEntries(
            both(names).map(it => [`tree/${it}`, it.endsWith(".js") ? "console.log(1);\n" : "<template />\n"]),
          ),
          "tree/globs/bunfig.toml": `[[lint.overrides]]\n${patterns}\nrules = { "no-console" = "off" }\n`,
        });
        const globs = `["+(a|b)/**", "f{1..3}.*"]`;
        const args = ["--cwd", "tree/globs", "."];
        expect(await reported(override(`files = ${globs}`), args)).toEqual(both(["c/x", "f4"]));
        expect(await reported(override(`files = "**/*"\nexcludeFiles = ${globs}`), args)).toEqual(
          both(["a/x", "ab/x", "f1", "f3"]),
        );
      },
      timeout,
    );

    test(
      "negated patterns select the same files on both sides",
      async () => {
        const both = (names: string[]) => names.flatMap(name => [`negated/${name}.js`, `negated/${name}.vue`]).sort();
        const sources = both(["a", "a.test", "src/b", "src/b.test"]).map(it => [
          `tree/${it}`,
          it.endsWith(".js") ? "console.log(1);\n" : "<template />\n",
        ]);
        const [plain, tests] = [both(["a", "src/b"]), both(["a.test", "src/b.test"])];
        // The patterns, and the files that still get reported because the override doesn't apply to them.
        const rows: Record<string, string[]> = {
          'files = ["*.test.*"]': plain,
          'files = ["!**/*.test.*"]': tests,
          'files = ["!*.test.*"]': tests,
          'files = ["!!*.test.*"]': plain,
          'files = ["!src/**"]': both(["src/b", "src/b.test"]),
          // `!(` starts an extglob group. It isn't a negation.
          'files = ["!(a|b).{js,vue}"]': plain,
          'files = ["!!(a|b).{js,vue}"]': tests,
          'files = ["**/*"]\nexcludeFiles = ["!*.test.*"]': plain,
          'files = ["**/*"]\nexcludeFiles = ["!**/*.test.*"]': plain,
          'files = ["**/*"]\nexcludeFiles = ["!(a|b).{js,vue}"]': tests,
        };
        const run = (patterns: string) => {
          const bunfig = `[[lint.overrides]]\n${patterns}\nrules = { "no-console" = "off" }\n`;
          const files = {
            "eslint.config.mjs": config,
            ...Object.fromEntries(sources),
            "tree/negated/bunfig.toml": bunfig,
          };
          return reported(files, ["--cwd", "tree/negated", "."]);
        };
        const results = await Promise.all(Object.keys(rows).map(run));
        expect(Object.fromEntries(Object.keys(rows).map((patterns, at) => [patterns, results[at]]))).toEqual(rows);
      },
      timeout,
    );
  });

  test(
    "files whose parser options request types all go to one engine",
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
      // 6 MB, which is enough work for several engines.
      const text = Buffer.alloc(250_000, "<!-- comment -->\n").toString();
      for (let i = 0; i < 24; i++) files[`typed/${i}.vue`] = files[`plain/${i}.vue`] = text;
      const realms = async (directory: string) => {
        const result = await lint(files, ["-f", "json", "--threads", "8", directory]);
        expect(result.exitCode).toBe(1);
        const messages = JSON.parse(result.raw).flatMap((it: any) => it.messages.map((it: any) => it.message));
        return [messages.length, new Set(messages).size];
      };
      expect(await realms("typed")).toEqual([24, 1]);
      expect((await realms("plain"))[0]).toBe(24);
    },
    timeout,
  );

  test(
    "--fix repeats until there's nothing left to fix",
    async () => {
      const result = await lint({ ...eslintPackage, ...lines }, ["--fix", "b.txt"], ["b.txt"]);
      expect(result.files).toEqual({ "b.txt": "one\n two \n\tthree # off\n" });
      expect(result.exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "without the eslint package, lists the files that need it and lints the others",
    async () => {
      const result = await lint(lines, ["-f", "unix", "a.js", "b.txt"]);
      expect(result.stdout).toContain("a.js:1:1: Unexpected var, use let or const instead. [Error/no-var]");
      expect(result.stderr).toContain(
        "1 file was not linted because it needs eslint, which is not installed (1 *.txt): b.txt\n  Run bun add -d eslint",
      );
      expect(result.exitCode).toBe(2);
    },
    timeout,
  );
});

// A stand-in for `@eslint/json`. Its reports show that the package ran, which requires the `eslint` package.
const jsonPackage = (name = "@eslint/json") => ({
  "node_modules/@eslint/json/package.json": JSON.stringify({ name, version: "2.1.1", main: "index.js" }),
  "node_modules/@eslint/json/index.js": `
    const language = { parse: ({ body }) => ({ ok: true, ast: { lines: body.split("\\n") } }) };
    const rule = name => ({ create: context => ({ Line: () => context.report({ line: 1, message: "the package: " + name }) }) });
    module.exports = {
      meta: { name: ${JSON.stringify(name)}, namespace: "json", version: "2.1.1" },
      languages: { json: language, jsonc: language, json5: language },
      rules: Object.fromEntries(
        ["no-duplicate-keys", "no-empty-keys", "no-unnormalized-keys", "no-unsafe-values", "sort-keys", "top-level-interop", "only-in-the-package"].map(
          name => [name, rule(name)],
        ),
      ),
    };`,
});

const jsonConfig = (more = "") => `
  import json from "@eslint/json";
  const rules = { "json/no-duplicate-keys": "error" };
  export default [
    { files: ["**/*.json"], plugins: { json }, language: "json/json", rules },
    { files: ["**/*.jsonc"], plugins: { json }, language: "json/jsonc", rules },
    { files: ["**/*.json5"], plugins: { json }, language: "json/json5", rules },
    ${more}
  ];`;

// The expected output is what ESLint 10.13 reports with @eslint/json 2.1.1.
describe.concurrent("bun lint with the built-in JSON languages", () => {
  const json = { ...jsonPackage(), "eslint.config.mjs": jsonConfig() };
  const [mark, noBreakSpace] = [0xfeff, 0xa0].map(it => String.fromCodePoint(it));
  const separators = String.fromCodePoint(0x2028, 0x2029);

  test("lints JSON, JSONC and JSON5 without the eslint package", async () => {
    const result = await lint(
      {
        ...json,
        "a.json": '{\n  "a": 1,\n  "b": { "c": 1, "c": 2 },\n  "a": 2,\n  "\\u0061": 3\n}\n',
        "b.jsonc": '// é😀\n{ "é😀": 1, /* c */ "é😀": 2 }\n',
        "c.json5": "{ a: 1, 'a': 2, \"a\": 3, \\u0061: 4, }\n",
        "crlf.json": `${mark}{\r\n  "a": 1,\r\n  "a": 2\r\n}\r\n`,
        "fine.json": '{ "a": { "a": [{ "a": 1 }] }, "b": 1 }\n',
      },
      ["-f", "json", "--timing", "."],
    );
    expect(summary(result.raw)).toMatchInlineSnapshot(`
      "a.json: 3:18 json/no-duplicate-keys Duplicate key "c" found.
      a.json: 4:3 json/no-duplicate-keys Duplicate key "a" found.
      a.json: 5:3 json/no-duplicate-keys Duplicate key "\\u0061" found.
      b.jsonc: 2:21 json/no-duplicate-keys Duplicate key "é😀" found.
      c.json5: 1:9 json/no-duplicate-keys Duplicate key "a" found.
      c.json5: 1:17 json/no-duplicate-keys Duplicate key "a" found.
      c.json5: 1:25 json/no-duplicate-keys Duplicate key "\\u0061" found.
      crlf.json: 3:3 json/no-duplicate-keys Duplicate key "a" found."
    `);
    expect(JSON.parse(result.raw)[1].messages[0]).toEqual({
      ruleId: "json/no-duplicate-keys",
      severity: 2,
      message: 'Duplicate key "é😀" found.',
      line: 2,
      column: 21,
      messageId: "duplicateKey",
      endLine: 2,
      endColumn: 26,
    });
    expect(result.stderr).not.toContain("the eslint package linted");
    expect(result.exitCode).toBe(1);
  });

  test("finds the duplicates in an object with many keys", async () => {
    const count = many(50_000);
    const keys = Array.from({ length: count }, (_, i) => `"k${i}": ${i}`);
    const text = `{${keys.join(",")},"k7":0,"k${count - 1}":0,"new":0}`;
    const result = await lint({ ...json, "a.json": text }, ["-f", "json", "."]);
    expect(summary(result.raw).replaceAll(/\d+:\d+ /g, "")).toBe(
      `a.json: json/no-duplicate-keys Duplicate key "k7" found.\na.json: json/no-duplicate-keys Duplicate key "k${count - 1}" found.`,
    );
  });

  test("nesting is only limited by memory", async () => {
    const depth = many(200_000);
    const deep = `${repeated('{"a":[', depth)}{"b":1,"b":2}${repeated("]}", depth)}`;
    const result = await lint({ ...json, "a.json": deep }, ["-f", "json", "."]);
    expect(summary(result.raw)).toBe(`a.json: 1:${depth * 6 + 8} json/no-duplicate-keys Duplicate key "b" found.`);
  });

  // Bun has to reject the same inputs as the plugin. The message and its location come from Bun's parser.
  test("a rejected file gets exactly one fatal problem", async () => {
    const cases: [string, string, string][] = [
      ["json", "", "1:1 Unexpected end of input"],
      ["json", "{", "1:2 Unexpected end of input"],
      ["json", '{"a":1', "1:7 Unterminated object"],
      ["json", '{"a" 1}', "1:6 Expected ':' after object key"],
      ["json", '{"a":1,}', "1:7 Trailing commas are not allowed in JSON"],
      ["json", "[1,]", "1:3 Trailing commas are not allowed in JSON"],
      ["json", "[1", "1:3 Unterminated array"],
      ["json", "[1 2]", "1:4 Expected ','"],
      ["json", '{\n  "a": 1\n  "b": 2\n}', "3:3 Expected ','"],
      ["json", '["a" "b"]', "1:6 Expected ','"],
      ["json", '{"a":1 2}', "1:8 Expected ','"],
      ["json", '{"a" "b"}', "1:6 Expected ':' after object key"],
      ["json", '{"a":}', "1:6 Unexpected token"],
      ["json", '{"a":,"b":1}', "1:6 Unexpected token"],
      ["json", "[1,,2]", "1:4 Unexpected token"],
      ["json", '"a" "b"', "1:5 Unexpected token after JSON value"],
      ["json", "[1}", "1:3 Expected ']'"],
      ["json", '{"a":1]', "1:7 Expected '}'"],
      ["json", "{} {}", "1:4 Unexpected token after JSON value"],
      ["json", "// c\n1", "1:1 Comments are not allowed in JSON"],
      ["json", "{a:1}", "1:2 Keys must be strings in double quotes"],
      ["json", "{true:1}", "1:2 Keys must be strings in double quotes"],
      ["json", "'a'", "1:1 Strings must be in double quotes"],
      ["json", "tru", "1:1 Unexpected token"],
      ["json", "NaN", "1:1 Unexpected token"],
      ["json", "01", "1:1 Leading zeros are not allowed in JSON"],
      ["json", "+1", "1:1 Invalid number"],
      ["json", ".5", "1:1 Invalid number"],
      ["json", "5.", "1:1 Invalid number"],
      ["json", "0x1", "1:1 Invalid number"],
      ["json", "-Infinity", "1:1 Invalid number"],
      ["json", '{\n  "a": "\\q"\n}', "2:9 Invalid escape sequence"],
      ["json", '"\\x41"', "1:2 Invalid escape sequence"],
      ["json", '"a\\\nb"', "1:3 Invalid escape sequence"],
      ["json", '"abc', "1:5 Unterminated string"],
      ["json", `${noBreakSpace}1`, "1:1 Unexpected character"],
      ["json", `1${String.fromCodePoint(0)}`, "1:2 Unexpected character"],
      ["jsonc", '{"a":1,} // c', "1:7 Trailing commas are not allowed in JSONC"],
      ["jsonc", "/* c", "1:5 Unterminated multi-line comment"],
      ["jsonc", "[1, // c\n", "2:1 Unexpected end of input"],
      ["jsonc", "{a:1}", "1:2 Keys must be strings in double quotes"],
      ["jsonc", '{"a": "b" // c\n"d": 1}', "2:1 Expected ','"],
      ["jsonc", '{"a" /* c */ "b"}', "1:14 Expected ':' after object key"],
      ["jsonc", '{"a": /* c */ }', "1:15 Unexpected token"],
      ["json5", "{1:1}", "1:2 Invalid identifier start character"],
      ["json5", "0x", "1:3 Invalid hex number"],
      ["json5", "01", "1:1 Leading zeros are not allowed in JSON5"],
      ["json5", "[,]", "1:2 Unexpected token"],
      ["json5", "{a-b:1}", "1:4 Unexpected character"],
      ["json5", "1 2", "1:3 Unexpected token after JSON5 value"],
      ["json5", "{a: 1 b: 2}", "1:7 Expected ','"],
      ["json5", "['a' 'b']", "1:6 Expected ','"],
      ["json5", "{a 'b'}", "1:4 Expected ':' after object key"],
      ["json5", "{a:}", "1:4 Unexpected token"],
    ];
    const files = cases.map(([language, text], i) => [`${String(i).padStart(2, "0")}.${language}`, text]);
    const result = await lint({ ...json, ...Object.fromEntries(files) }, ["-f", "json", "."]);
    expect(summary(result.raw).split("\n")).toEqual(
      cases.map(([, , expected], i) => {
        const [position, ...message] = expected.split(" ");
        return `${files[i][0]}: ${position} null Parsing error: ${message.join(" ")} [fatal]`;
      }),
    );
    expect(result.exitCode).toBe(1);
  });

  // `a` means accepted and `r` means rejected, in this order: JSON, JSONC, JSONC with `allowTrailingCommas`, JSON5.
  // Where ESLint differs, its result is in the `//` comment. The next test covers those cases.
  test("accepts and rejects the right inputs", async () => {
    const texts: [string, string][] = [
      ["", "rrrr"],
      [" ", "rrrr"],
      ["\n", "rrrr"],
      ["{", "rrrr"],
      ["}", "rrrr"],
      ["[", "rrrr"],
      ["]", "rrrr"],
      ["{}", "aaaa"],
      ["[]", "aaaa"],
      ["{} {}", "rrrr"],
      ["[] 1", "rrrr"],
      ["1 2", "rrrr"],
      ['"a"', "aaaa"],
      ['"a', "rrrr"],
      ['"a\n', "rrrr"],
      ['"a\nb"', "rrrr"], // aaaa
      ["'a'", "rrra"],
      ["nul", "rrrr"],
      ["null", "aaaa"],
      ["nulll", "rrrr"],
      ["tru", "rrrr"],
      ["true", "aaaa"],
      ["false", "aaaa"],
      ["fals", "rrrr"],
      ["t", "rrrr"],
      ["n", "rrrr"],
      ["f", "rrrr"],
      ["a", "rrrr"],
      ["abc", "rrrr"],
      ["undefined", "rrrr"],
      ["NaN", "rrra"],
      ["Infinity", "rrra"],
      ["-Infinity", "rrra"],
      ["+Infinity", "rrra"],
      ["-NaN", "rrra"],
      ["+NaN", "rrra"],
      ["-Inf", "rrrr"],
      ["+N", "rrrr"],
      ["-", "rrrr"],
      ["+", "rrrr"],
      ["-a", "rrrr"],
      ["+1", "rrra"],
      ["-1", "aaaa"],
      ["01", "rrrr"],
      ["00", "rrrr"],
      ["-01", "rrrr"],
      ["0", "aaaa"],
      ["-0", "aaaa"],
      ["1.", "rrra"],
      ["1.e5", "rrra"],
      [".5", "rrra"],
      ["-.5", "rrra"], // rrrr
      ["+.5", "rrra"], // rrrr
      [".", "rrrr"], // rrra
      [".a", "rrrr"], // rrra
      [".e1", "rrrr"], // rrra
      ["5.", "rrra"],
      ["1e", "rrrr"],
      ["1e+", "rrrr"],
      ["1e-", "rrrr"],
      ["1ea", "rrrr"],
      ["1e5", "aaaa"],
      ["1E+5", "aaaa"],
      ["1.5e-3", "aaaa"],
      ["0x", "rrrr"],
      ["0x1", "rrra"],
      ["0X1f", "rrra"],
      ["0xg", "rrrr"],
      ["-0x1", "rrra"],
      ["0x1.5", "rrrr"], // rrra
      ["1a", "rrrr"],
      ["1_000", "rrrr"],
      ["1n", "rrrr"],
      ["0b1", "rrrr"],
      ["0o7", "rrrr"],
      ['{"a"}', "rrrr"],
      ['{"a":}', "rrrr"],
      ['{"a":1', "rrrr"],
      ['{"a":1,', "rrrr"],
      ['{"a":1,}', "rraa"],
      ['{"a":1,,}', "rrrr"],
      ["{,}", "rrrr"],
      ['{"a" 1}', "rrrr"],
      ['{"a":1 "b":2}', "rrrr"],
      ['{"a":1]', "rrrr"],
      ["{a:1}", "rrra"],
      ["{'a':1}", "rrra"],
      ["{1:1}", "rrrr"],
      ["{true:1}", "rrra"], // rrrr
      ["{null:1}", "rrra"], // rrrr
      ["{NaN:1}", "rrra"],
      ["{Infinity:1}", "rrra"],
      ["{-Infinity:1}", "rrrr"],
      ["{+NaN:1}", "rrrr"],
      ["{.5:1}", "rrrr"], // rrra
      ['{"a":', "rrrr"],
      ['{"a"', "rrrr"],
      ['{"a":{', "rrrr"],
      ['{"a":[', "rrrr"],
      ["[1", "rrrr"],
      ["[1,", "rrrr"],
      ["[1,]", "rraa"],
      ["[1,,2]", "rrrr"],
      ["[,]", "rrrr"],
      ["[,1]", "rrrr"],
      ["[1 2]", "rrrr"],
      ["[1}", "rrrr"],
      ["[1,2", "rrrr"],
      ["[[", "rrrr"],
      ["[{", "rrrr"],
      ["[1,\n", "rrrr"],
      ["[1 // c\n", "rrrr"],
      ["[1, // c\n", "rrrr"],
      ["[1, /* c */", "rrrr"],
      ["{ // c\n", "rrrr"],
      ['{"a":1 /* c */', "rrrr"],
      ['{"a":1, // c', "rrrr"],
      ["// c", "rrrr"],
      ["/* c */", "rrrr"],
      ["/* c", "rrrr"],
      ["/*", "rrrr"],
      ["/", "rrrr"],
      ["/a", "rrrr"],
      ["/* c *", "rrrr"],
      ["/**/", "rrrr"],
      ["/***/1", "raaa"],
      ["/*/", "rrrr"],
      ["1 // c", "raaa"],
      ["1 /* c */", "raaa"],
      ["// c\n1", "raaa"],
      ["/* c */ 1", "raaa"],
      ["//\n1", "raaa"],
      ["1 /", "rrrr"],
      ["# c", "rrrr"],
      ['"\\a"', "rrra"],
      ['"\\u12"', "rrrr"],
      ['"\\u12G4"', "rrrr"],
      ['"\\u"', "rrrr"],
      ['"\\x41"', "rrra"],
      ['"\\x4"', "rrrr"],
      ['"\\xg"', "rrrr"],
      ['"\\0"', "rrra"],
      ['"\\1"', "rrrr"], // rrra
      ['"\\v"', "rrra"],
      ['"\\\'"', "rrra"],
      ['"\\\n"', "rrra"],
      ['"\\\r\n"', "rrra"],
      ['"\\"', "rrrr"],
      ['"\\\\"', "aaaa"],
      ['"\\""', "aaaa"],
      ['"\\/"', "aaaa"],
      ['"\\b\\f\\n\\r\\t"', "aaaa"],
      ['"\\u0061"', "aaaa"],
      ['"\\uD83D\\uDE00"', "aaaa"],
      ['"\\uD83D"', "aaaa"],
      ['"\t"', "rrra"], // aaaa
      ['"\u0001"', "rrra"], // aaaa
      ['"\u2028"', "aaaa"],
      ["'\\''", "rrra"],
      ["'\"'", "rrra"],
      ['"\'"', "aaaa"],
      ["'a\nb'", "rrrr"], // rrra
      ["'a", "rrrr"],
      ["\u00a0 1", "rrra"],
      ["\u000b1", "rrra"],
      ["\f1", "rrra"],
      ["\ufeff1", "aaaa"],
      ["1\ufeff", "rrra"],
      ["\u20281", "rrra"],
      ["\u16801", "rrra"], // rrrr
      ["\u30001", "rrra"],
      ["\u20001", "rrra"],
      ["\u180e1", "rrrr"],
      ["\u00001", "rrrr"],
      ["1\u0000", "rrrr"],
      ["\u00e9", "rrrr"],
      ["{\u00e9:1}", "rrra"],
      ["{\\u0061:1}", "rrra"],
      ["{\\u0031:1}", "rrrr"],
      ["{a\\u0031:1}", "rrra"],
      ["{a\\u002d:1}", "rrrr"],
      ["{\\x61:1}", "rrrr"],
      ["{\\u00:1}", "rrrr"],
      ["{\\", "rrrr"],
      ["{a\\", "rrrr"],
      ["{$a_1:1}", "rrra"],
      ["{\u200c:1}", "rrrr"], // rrra
      ["{a\u200d:1}", "rrra"],
      ["{\ud835\udc00:1}", "rrra"], // rrrr
      ["{a-b:1}", "rrrr"],
      ["{a b:1}", "rrrr"],
      ['{"a":a}', "rrrr"],
      ['{"a":tru}', "rrrr"],
      ["[tru]", "rrrr"],
      ["[nulla]", "rrrr"],
      ["[true1]", "rrrr"],
      ["[tru\u0435]", "rrrr"],
      ['{"a":1,"a":2}', "aaaa"],
      ['{"a":1,"\\u0061":2}', "aaaa"],
      ['{"a":1,"b":{"a":1,"a":2},"a":3}', "aaaa"],
      ['[{"a":1,"a":2}]', "aaaa"],
      ['{"":1,"":2}', "aaaa"],
      ['{"__proto__":1,"__proto__":2}', "aaaa"],
      ['{"\u00e9":1,"\\u00e9":2}', "aaaa"],
      ['{"\ud83d\ude00":1,"\\uD83D\\uDE00":2, "x\ud83d\ude00": 1, "x\ud83d\ude00": 2}', "aaaa"],
      ["{a:1,'a':2,\"a\":3,\\u0061:4}", "rrra"],
      ['{NaN:1,"NaN":2}', "rrra"],
      ['{Infinity:1,"Infinity":2}', "rrra"],
      ['{"a\\/b":1,"a/b":2}', "aaaa"],
      ['{"a\\\\":1,"a\\\\":2}', "aaaa"],
      ['{"a\\nb":1,"a\\u000ab":2}', "aaaa"],
      ["{'a\\\nb':1,ab:2}", "rrra"],
      ['{"\\uD83D":1,"\\uD83D":2}', "aaaa"],
      ['{\r\n  "a": 1,\r\n  "a": 2\r\n}\r\n', "aaaa"],
      ['{\r  "a": 1,\r  "a": 2\r}\r', "aaaa"],
      ['{\n"a":1,\n\n"a"\n:\n2}', "aaaa"],
      ['\ufeff{"a":1,"a":2}', "aaaa"],
      ['{"\u00e9\ud83d\ude00": 1, "a": 1, "a": 2}', "aaaa"],
      ['{"a":1,\n"b":"\u2028","a":2}', "aaaa"],
      ['{"a":1}\n\n\n', "aaaa"],
      ['{"a":1\n\n', "rrrr"],
      ["[1,2\n\n", "rrrr"],
      ['"abc\n\n', "rrrr"],
      ["/* abc\n\n", "rrrr"],
      ['{"a":"b\n', "rrrr"],
      ['{"a":1,\r\n', "rrrr"],
      ["[\r\n1\r\n", "rrrr"],
      ['"a\r\n', "rrrr"],
      ["/*\r\n", "rrrr"],
      ['{"a":"\\q"}', "rrra"],
      ['{\n  "a": "\\q"\n}', "rrra"],
      ['{\n  "a": 1e\n}', "rrrr"],
      ['{\n  "a": -\n}', "rrrr"],
      ['{\n "a": 01\n}', "rrrr"],
      ['{\n "a": 1.\n}', "rrra"],
      ['{\n "a": 1.}', "rrra"],
      ["1.\n", "rrra"],
      ["1e\n", "rrrr"],
      ["-\n", "rrrr"],
      ["// a\u2028b\n[]", "raar"], // raaa
      ["// a\u2029\n[]", "raaa"],
      ["[] // a\u2028b", "raar"], // raaa
      ["// c\u2028[]", "rrra"], // rrrr
    ];
    const names = (i: number) => [`plain/${i}.json`, `plain/${i}.jsonc`, `commas/${i}.jsonc`, `plain/${i}.json5`];
    const files = Object.fromEntries(texts.flatMap(([text], i) => names(i).map(name => [name, text])));
    const config = jsonConfig(`{ files: ["commas/*.jsonc"], languageOptions: { allowTrailingCommas: true } }`);
    const result = await lint({ ...json, "eslint.config.mjs": config, ...files }, ["-f", "json", "."]);
    const found = new Map<string, string>();
    for (const { filePath, messages } of JSON.parse(result.raw)) {
      // A rejected file gets exactly one problem.
      const isRefused = messages.some((it: any) => it.fatal);
      found.set(
        filePath.replaceAll("\\", "/").split("/").slice(-2).join("/"),
        isRefused ? "r".repeat(messages.length) : "a",
      );
    }
    expect(
      texts.map(([text], i) => [
        text,
        names(i)
          .map(name => found.get(name))
          .join(""),
      ]),
    ).toEqual(texts);
  });

  // Momoa 3.3, the plugin's parser, does the opposite in each case.
  test("follows the spec where the plugin's parser doesn't", async () => {
    const character = (code: number) => String.fromCodePoint(code);
    const cases: [string, string, "accepted" | "refused"][] = [
      // RFC 8259: control characters in strings must be escaped.
      ["json", '"a\nb"', "refused"],
      ["json", '"a\tb"', "refused"],
      ["jsonc", `"${character(1)}"`, "refused"],
      // JSON5: a string only continues on the next line after a backslash.
      ["json5", '"a\nb"', "refused"],
      // Any number can have a sign.
      ["json5", "[-.5, +.5]", "accepted"],
      ["json5", "[.a]", "refused"],
      ["json5", "[.e1]", "refused"],
      ["json5", "[0x1.5]", "refused"],
      // A key is a string or an ECMAScript 5.1 IdentifierName, which includes keywords.
      ["json5", "{true:1, null:2, false: 3}", "accepted"],
      ["json5", "{.5:1}", "refused"],
      ["json5", `{${character(0x200c)}:1}`, "refused"],
      ["json5", `{${character(0x1d400)}:1}`, "accepted"],
      // The only digit allowed after a backslash is `0`, and no digit can follow it.
      ["json5", '["\\1"]', "refused"],
      ["json5", '["\\01"]', "refused"],
      ["json5", '["\\8"]', "refused"],
      // Every character in the Zs category is whitespace.
      ["json5", `${character(0x1680)}[]`, "accepted"],
      // A comment ends at any ECMAScript line terminator.
      ["json5", `// c${character(0x2028)}[]`, "accepted"],
      ["json5", `// a${character(0x2029)}b\n[]`, "refused"],
    ];
    const files = cases.map(([language, text], i) => [`${String(i).padStart(2, "0")}.${language}`, text]);
    const result = await lint({ ...json, ...Object.fromEntries(files) }, ["-f", "json", "."]);
    const found = JSON.parse(result.raw)
      .filter((it: any) => /\d\d\.json[c5]?$/.test(it.filePath))
      .map((it: any) => (it.messages.some((it: any) => it.fatal) ? "refused" : "accepted"));
    expect(found.map((it: string, i: number) => `${JSON.stringify(cases[i][1])} in ${cases[i][0]}: ${it}`)).toEqual(
      cases.map(([language, text, expected]) => `${JSON.stringify(text)} in ${language}: ${expected}`),
    );
  });

  test("parses JSON5-only syntax in JSON5", async () => {
    const text = `// c\n{ a: +1, b: .5, c: 5., d: 0xF, e: -Infinity, f: NaN, g: 'a\\\nb', "h": "\\x41\\v\\0", $_: [1,], NaN: 1, ${noBreakSpace}}\n`;
    const result = await lint({ ...json, "a.json5": text }, ["-f", "json", "."]);
    expect(summary(result.raw)).toBe("");
    expect(result.exitCode).toBe(0);
  });

  describe("all of the plugin's rules", () => {
    const character = (code: number) => String.fromCodePoint(code);
    const [accent, backslash, wideQuote, wideBackslash, ligature] = [0x301, 92, 0xff02, 0xff3c, 0xfb01].map(character);
    const escaped = (code: string) => `${backslash}u${code}`;
    const all = {
      ...jsonPackage(),
      "eslint.config.mjs": jsonConfig(`
        { files: ["**/*.json*"], rules: { "json/no-empty-keys": "error", "json/no-unnormalized-keys": "error", "json/no-unsafe-values": "error", "json/sort-keys": "warn", "json/top-level-interop": "error" } },
        { files: ["desc.json"], rules: { "json/sort-keys": ["error", "desc", { caseSensitive: false, natural: true, minKeys: 3 }] } },
        { files: ["groups.jsonc"], rules: { "json/sort-keys": ["error", "asc", { allowLineSeparatedGroups: true }] } },
        { files: ["nfkc.json5"], rules: { "json/no-unnormalized-keys": ["error", { form: "NFKC" }] } },`),
      "a.json": `{\n  "b": 1e400,\n  "a": 9007199254740993,\n  "": -1e-400,\n  " \\t": 2.2250738585072009e-308,\n  "cafe${accent}": "${escaped("d83d")} x ${escaped("dc00")}${escaped("d83d")}${escaped("de00")}",\n  "${escaped("d83d")}": 0.0e-999,\n  "b": [1.5, -0, 9007199254740991, 123456789012345678]\n}\n`,
      "top.json": `${mark}\n"x"\n`,
      "top.json5": "// c\n-Infinity",
      "whole.json": `"${escaped("d83d")}"`,
      "whole.json5": "1e400",
      "hex.json5": `[0x1fffffffffffff, 0x20000000000000, -0x20000000000000, 0x0, 0xe, 1E400, .0e1, 5.e-324, NaN, +0x${"f".repeat(300)}]`,
      "desc.json": `{ "a10": 1, "A2": 2, "b": 3, "x": { "a": 1, "b": 2 } }`,
      "groups.jsonc": `{\n  "b": 1,\n\n  "a": 2,\n  // c\n  "A": 3,\n  /*\n\n  */\n  "0": 4,\n  \n  "-": 5\n}`,
      "nfkc.json5": `{ '${wideQuote}': 1, ${ligature}: 2, "${escaped("fb01")}": 3, "${wideBackslash}": 4 }`,
      "fix.jsonc": `{\n  "c": { "z": 1, "y": 2 }, "b": [1], // c\n  "a": 1, "0": 2\n}`,
    };

    test("report the same as in ESLint", async () => {
      const result = await lint(all, ["-f", "json", "."]);
      expect(summary(result.raw).replace(/f{300}/, "f..f")).toMatchInlineSnapshot(`
          "a.json: 2:8 json/no-unsafe-values The number '1e400' will evaluate to Infinity.
          a.json: 3:3 json/sort-keys Expected object keys to be in alphanumeric case-sensitive ascending order. 'a' should be before 'b'. [fix 4,39 "\\"a\\": 9007199254740993,\\n  \\"b\\": 1e400"]
          a.json: 3:8 json/no-unsafe-values The integer '9007199254740993' is outside the safe integer range.
          a.json: 4:3 json/sort-keys Expected object keys to be in alphanumeric case-sensitive ascending order. '' should be before 'a'. [fix 18,54 "\\"\\": -1e-400,\\n  \\"a\\": 9007199254740993"]
          a.json: 4:3 json/no-empty-keys Empty key found.
          a.json: 4:7 json/no-unsafe-values The number '-1e-400' will evaluate to zero.
          a.json: 5:3 json/no-empty-keys Empty key found.
          a.json: 5:10 json/no-unsafe-values Unexpected subnormal number '2.2250738585072009e-308' found, which may cause interoperability issues.
          a.json: 6:3 json/no-unnormalized-keys Unnormalized key 'café' found. [fix 93,98 "café"]
          a.json: 6:12 json/no-unsafe-values Lone surrogate '\\ud83d' found.
          a.json: 6:12 json/no-unsafe-values Lone surrogate '\\udc00' found.
          a.json: 7:3 json/no-unsafe-values Lone surrogate '\\ud83d' found.
          a.json: 8:3 json/sort-keys Expected object keys to be in alphanumeric case-sensitive ascending order. 'b' should be before '\\ud83d'. [fix 134,208 "\\"b\\": [1.5, -0, 9007199254740991, 123456789012345678],\\n  \\"\\\\ud83d\\": 0.0e-999"]
          a.json: 8:3 json/no-duplicate-keys Duplicate key "b" found.
          a.json: 8:36 json/no-unsafe-values The integer '123456789012345678' is outside the safe integer range.
          desc.json: 1:22 json/sort-keys Expected object keys to be in natural case-insensitive descending order. 'b' should be before 'A2'. [fix 12,27 "\\"b\\": 3, \\"A2\\": 2"]
          desc.json: 1:30 json/sort-keys Expected object keys to be in natural case-insensitive descending order. 'x' should be before 'b'. [fix 21,52 "\\"x\\": { \\"a\\": 1, \\"b\\": 2 }, \\"b\\": 3"]
          fix.jsonc: 2:18 json/sort-keys Expected object keys to be in alphanumeric case-sensitive ascending order. 'y' should be before 'z'. [fix 11,25 "\\"y\\": 2, \\"z\\": 1"]
          fix.jsonc: 2:28 json/sort-keys Expected object keys to be in alphanumeric case-sensitive ascending order. 'b' should be before 'c'.
          fix.jsonc: 3:3 json/sort-keys Expected object keys to be in alphanumeric case-sensitive ascending order. 'a' should be before 'b'.
          fix.jsonc: 3:11 json/sort-keys Expected object keys to be in alphanumeric case-sensitive ascending order. '0' should be before 'a'.
          groups.jsonc: 6:3 json/sort-keys Expected object keys to be in alphanumeric case-sensitive ascending order. 'A' should be before 'a'.
          groups.jsonc: 10:3 json/sort-keys Expected object keys to be in alphanumeric case-sensitive ascending order. '0' should be before 'A'.
          hex.json5: 1:20 json/no-unsafe-values The integer '0x20000000000000' is outside the safe integer range.
          hex.json5: 1:38 json/no-unsafe-values The integer '-0x20000000000000' is outside the safe integer range.
          hex.json5: 1:67 json/no-unsafe-values The number '1E400' will evaluate to Infinity.
          hex.json5: 1:80 json/no-unsafe-values Unexpected subnormal number '5.e-324' found, which may cause interoperability issues.
          hex.json5: 1:94 json/no-unsafe-values The number '+0xf..f' will evaluate to Infinity.
          nfkc.json5: 1:3 json/no-unnormalized-keys Unnormalized key '＂' found. [fix 3,4 "\\""]
          nfkc.json5: 1:11 json/sort-keys Expected object keys to be in alphanumeric case-sensitive ascending order. 'ﬁ' should be before '＂'. [fix 2,14 "ﬁ: 2, '＂': 1"]
          nfkc.json5: 1:11 json/no-unnormalized-keys Unnormalized key 'ﬁ' found. [fix 10,11 "fi"]
          nfkc.json5: 1:17 json/no-duplicate-keys Duplicate key "\\ufb01" found.
          nfkc.json5: 1:17 json/no-unnormalized-keys Unnormalized key '\\ufb01' found.
          nfkc.json5: 1:30 json/no-unnormalized-keys Unnormalized key '＼' found. [fix 30,31 "\\\\\\\\"]
          top.json: 1:1 json/top-level-interop Top level item should be array or object, got 'String'.
          top.json5: 1:1 json/top-level-interop Top level item should be array or object, got 'Infinity'.
          whole.json: 1:1 json/top-level-interop Top level item should be array or object, got 'String'.
          whole.json: 1:1 json/no-unsafe-values Lone surrogate '\\ud83d' found.
          whole.json5: 1:1 json/top-level-interop Top level item should be array or object, got 'Number'.
          whole.json5: 1:1 json/no-unsafe-values The number '1e400' will evaluate to Infinity."
        `);
      expect(result.exitCode).toBe(1);
    });

    test("--fix repeats until the keys are sorted", async () => {
      const names = ["a.json", "desc.json", "fix.jsonc", "nfkc.json5"];
      const result = await lint(all, ["--fix", "."], names);
      expect(result.files).toMatchInlineSnapshot(`
          {
            "a.json": 
          "{
            "": -1e-400,
            " \\t": 2.2250738585072009e-308,
            "a": 9007199254740993,
            "b": 1e400,
            "b": [1.5, -0, 9007199254740991, 123456789012345678],
            "café": "\\ud83d x \\udc00\\ud83d\\ude00",
            "\\ud83d": 0.0e-999
          }
          "
          ,
            "desc.json": "{ "x": { "a": 1, "b": 2 }, "b": 3, "a10": 1, "A2": 2 }",
            "fix.jsonc": 
          "{
            "c": { "y": 2, "z": 1 }, "b": [1], // c
            "a": 1, "0": 2
          }"
          ,
            "nfkc.json5": "{ '"': 1, "\\\\": 4, fi: 2, "\\ufb01": 3 }",
          }
        `);
    });

    test.each([
      [
        '"json/sort-keys": ["error", "up"]',
        'Key "json/sort-keys":\n\tValue "up" should be equal to one of the allowed values.',
      ],
      ['"json/sort-keys": ["error", "asc", { minKeys: 1 }]', 'Key "json/sort-keys":\n\tValue 1 should be >= 2.'],
      [
        '"json/no-unnormalized-keys": ["error", { form: "nfc" }]',
        'Key "json/no-unnormalized-keys":\n\tValue "nfc" should be equal to one of the allowed values.',
      ],
      [
        '"json/no-empty-keys": ["error", 1]',
        'Key "json/no-empty-keys":\n\tValue [1] should NOT have more than 0 items.',
      ],
    ])("options are validated: %s", async (rule, expected) => {
      const config = jsonConfig(`{ files: ["**/*.json"], rules: { ${rule} } }`);
      const result = await lint({ ...json, "eslint.config.mjs": config, "a.json": "{}" }, ["a.json"]);
      expect(result.stderr).toContain(`Key "rules": ${expected}`);
      expect(result.exitCode).toBe(2);
    });

    test("handle many keys out of order, with comments", async () => {
      const count = many(30_000);
      const keys = Array.from({ length: count }, (_, i) => `"k${count - i}": ${i}, // ${i}`);
      const result = await lint({ ...all, "many.jsonc": `{\n${keys.join("\n")}\n"a": 1\n}` }, [
        "-f",
        "json",
        "many.jsonc",
      ]);
      const { messages } = JSON.parse(result.raw)[0];
      expect(messages.length).toBeGreaterThan(count / 2);
      expect(messages.filter((it: any) => it.fix)).toEqual([]);
      // Only comments between two keys. A blank line there would start a new group.
      const apart = `{\n"b": 1,\n${repeated("// c\n/*\n\n*/\n", count)}"a": 2\n}`;
      const groups = await lint({ ...all, "groups.jsonc": apart }, ["-f", "json", "groups.jsonc"]);
      expect(JSON.parse(groups.raw)[0].messages.map((it: any) => it.line)).toEqual([count * 4 + 3]);
    });
  });

  // ESLint reads files as UTF-8.
  test("invalid UTF-8 in a file counts as U+FFFD", async () => {
    const bytes = (text: string) => Buffer.from(text, "latin1");
    const replaced = String.fromCodePoint(0xfffd);
    const result = await lint(
      {
        ...json,
        "a.json": bytes('{"\xED\xA0\xBD": "\xC3", "b\xFF": 1, "\xEF\xBF\xBD\xEF\xBF\xBD\xEF\xBF\xBD": 1}'),
        "b.json5": bytes("{c\xFF: 1}"),
      },
      ["-f", "json", "."],
    );
    expect(summary(result.raw)).toBe(
      `a.json: 1:23 json/no-duplicate-keys Duplicate key "${replaced.repeat(3)}" found.\n` +
        "b.json5: 1:3 null Parsing error: Unexpected character [fatal]",
    );
  });

  // Same as Microsoft's jsonc-parser and the plugin.
  test("U+2028 and U+2029 don't end a comment in JSONC", async () => {
    const twice = '{ "a": 1, "a": 2 }';
    const result = await lint(
      {
        ...json,
        "line.jsonc": `${twice} // eslint-disable-line -- a${separators}b`,
        "next-line.jsonc": `// eslint-disable-next-line json/no-duplicate-keys -- ${separators} b\n${twice}`,
        "reported.jsonc": `// ${separators}\n${twice}`,
      },
      ["-f", "json", "."],
    );
    expect(summary(result.raw)).toBe(
      [
        `line.jsonc: 1:11 json/no-duplicate-keys Duplicate key "a" found. [suppressed: a${separators}b]`,
        'next-line.jsonc: 2:11 json/no-duplicate-keys Duplicate key "a" found. [suppressed: b]',
        'reported.jsonc: 2:11 json/no-duplicate-keys Duplicate key "a" found.',
      ].join("\n"),
    );
  });

  // Line numbers in problems go by the language's line breaks, so code that looks a line up in the text must too.
  describe.each([
    ["only line feeds", (text: string) => text],
    ["a byte order mark", (text: string) => mark + text],
    ["carriage returns", (text: string) => text.replaceAll("\n", "\r\n")],
    ["both", (text: string) => mark + text.replaceAll("\n", "\r\n")],
  ])("U+2028 and U+2029 aren't line breaks in JSON: a file with %s", (_, transform) => {
    // Unless the file is short, the linter counts lines without saving their offsets, so the formatter recomputes them.
    const more = Array.from({ length: 50 }, (_, i) => `  "${i}": "${"-".repeat(40)}",\n`).join("");
    const text = `{\n  "s": "${separators}",\n${more}  "a": 1,\n  "a": 2\n}\n`;
    const files = { ...json, "a.json": transform(text) };

    test.each(["pretty", "agent"])("the code excerpt in %s shows the right line", async format => {
      const result = await lint(files, ["-f", format, "a.json"]);
      const excerptLines = result.stdout
        .split("\n")
        .filter(line => line.includes('"a"') && !line.includes("Duplicate"));
      expect(excerptLines.at(-1)).toEndWith('"a": 2');
      expect(result.stdout).toContain(format === "pretty" ? "a.json:54:3" : 'line="54" column="3"');
    });

    test.each(["stylish", "json", "unix", "github", "checkstyle", "junit", "gitlab", "sarif"])(
      "%s prints the right line",
      async format => {
        const result = await lint(files, ["-f", format, "a.json"]);
        const expectedByFormat = {
          stylish: "  54:3  error",
          json: '"line":54,"column":3,"messageId":"duplicateKey","endLine":54,"endColumn":6',
          unix: "a.json:54:3:",
          github: "line=54,col=3,endLine=54,endColumn=6",
          checkstyle: 'line="54" column="3"',
          junit: "line 54, column 3",
          gitlab: '"begin": 54',
          sarif: '"startLine": 54',
        };
        expect(result.stdout).toContain(expectedByFormat[format as keyof typeof expectedByFormat]);
      },
    );
  });

  test("comments disable and configure rules in JSONC and JSON5", async () => {
    const twice = '"a": 1, "a": 2';
    const result = await lint(
      {
        ...json,
        "next-line.jsonc": `{\n  // eslint-disable-next-line json/no-duplicate-keys -- why\n  ${twice}\n}`,
        "line.json5": `{\n  ${twice} /* eslint-disable-line */\n}`,
        "block.jsonc": `/* eslint-disable json/no-duplicate-keys */\n{\n  ${twice},\n/* eslint-enable json/no-duplicate-keys */\n"a": 3\n}`,
        "to-the-end-of-the-line.jsonc": `// eslint-disable\n{\n  ${twice}\n}`,
        "unused.jsonc": `{\n  // eslint-disable-next-line json/no-duplicate-keys\n  "a": 1\n}`,
        "unknown.jsonc": `/* eslint-disable json/nope */\n{ ${twice} }`,
        "off.jsonc": `/* eslint json/no-duplicate-keys: "off" */\n{ ${twice} }`,
        "warn.jsonc": `// eslint json/no-duplicate-keys: "warn"\n{ ${twice} }`,
        "options.jsonc": `/* eslint json/no-duplicate-keys: ["error", 1] */\n{ "a": 1 }`,
        "other-labels.jsonc": `/* global a */ /* exported b */ /* eslint-env node */ /* oxlint-disable */\n{ ${twice} }`,
        "several-lines.jsonc": `{\n  ${twice} /* eslint-disable-line\n */\n}`,
      },
      ["-f", "json", "."],
    );
    expect(summary(result.raw)).toMatchInlineSnapshot(`
      "block.jsonc: 5:1 json/no-duplicate-keys Duplicate key "a" found.
      block.jsonc: 3:11 json/no-duplicate-keys Duplicate key "a" found. [suppressed: ]
      line.json5: 2:11 json/no-duplicate-keys Duplicate key "a" found. [suppressed: ]
      next-line.jsonc: 3:11 json/no-duplicate-keys Duplicate key "a" found. [suppressed: why]
      options.jsonc: 1:1 json/no-duplicate-keys Inline configuration for rule "json/no-duplicate-keys" is invalid:
      	Value [1] should NOT have more than 0 items.

      other-labels.jsonc: 2:11 json/no-duplicate-keys Duplicate key "a" found.
      several-lines.jsonc: 2:11 json/no-duplicate-keys Duplicate key "a" found.
      several-lines.jsonc: 2:18 null eslint-disable-line comment should not span multiple lines.
      to-the-end-of-the-line.jsonc: 3:11 json/no-duplicate-keys Duplicate key "a" found. [suppressed: ]
      unknown.jsonc: 1:1 json/nope Definition for rule 'json/nope' was not found.
      unknown.jsonc: 2:11 json/no-duplicate-keys Duplicate key "a" found.
      unused.jsonc: 2:3 null Unused eslint-disable directive (no problems were reported from 'json/no-duplicate-keys'). [fix 4,54 " "]
      warn.jsonc: 2:11 json/no-duplicate-keys Duplicate key "a" found."
    `);
    const severities = JSON.parse(result.raw).flatMap((it: any) => it.messages.map((it: any) => it.severity));
    expect(severities).toEqual([2, 2, 2, 2, 2, 2, 2, 1, 1]);
  });

  test("--fix removes an unused disable comment, also after a byte order mark", async () => {
    const files = { "a.jsonc": `${mark}{ "é": 1 /* eslint-disable-line */ }\n` };
    const result = await lint({ ...json, ...files }, ["--fix", "."], ["a.jsonc"]);
    expect(result.files).toEqual({ "a.jsonc": `${mark}{ "é": 1   }\n` });
    expect(result.exitCode).toBe(0);
  });

  test("noInlineConfig, --no-inline-config and --report-unused-disable-directives-severity work", async () => {
    const files = {
      ...jsonPackage(),
      "eslint.config.mjs": jsonConfig(`{ files: ["no/*"], linterOptions: { noInlineConfig: true } }`),
      "no/a.jsonc": '{ "a": 1, "a": 2 } // eslint-disable-line',
      "b.jsonc": '{ "a": 1 } // eslint-disable-line',
    };
    const [plain, ignoring, strict] = await Promise.all([
      lint(files, ["-f", "json", "."]),
      lint(files, ["-f", "json", "--no-inline-config", "."]),
      lint(files, ["-f", "json", "--report-unused-disable-directives-severity", "error", "b.jsonc"]),
    ]);
    expect(summary(plain.raw)).toMatchInlineSnapshot(`
      "b.jsonc: 1:12 null Unused eslint-disable directive (no problems were reported). [fix 11,33 " "]
      a.jsonc: 1:11 json/no-duplicate-keys Duplicate key "a" found.
      a.jsonc: 1:20 null '// eslint-disable-line' has no effect because you have 'noInlineConfig' setting in your config."
    `);
    expect(summary(ignoring.raw)).toBe('a.jsonc: 1:11 json/no-duplicate-keys Duplicate key "a" found.');
    expect(JSON.parse(strict.raw)[0].errorCount).toBe(1);
  });

  test("languageOptions are interpreted by the language", async () => {
    const files = (options: string) => ({
      ...jsonPackage(),
      "eslint.config.mjs": jsonConfig(`{ files: ["**/*.jsonc", "x.json"], languageOptions: ${options} }`),
      "a.jsonc": '{ "a": [1,], }',
      "x.json": "{}",
    });
    const [allowed, printed, disallowed, wrong, elsewhere] = await Promise.all([
      lint(files("{ allowTrailingCommas: true, globals: { a: true } }"), ["-f", "json", "a.jsonc"]),
      lint(files("{ allowTrailingCommas: true }"), ["--print-config", "a.jsonc"]),
      lint(files("{ allowTrailingCommas: false }"), ["-f", "json", "a.jsonc"]),
      lint(files("{ allowTrailingCommas: 1 }"), ["a.jsonc"]),
      lint(files("{ allowTrailingCommas: true }"), ["x.json"]),
    ]);
    expect(summary(allowed.raw)).toBe("");
    expect(allowed.exitCode).toBe(0);
    expect(JSON.parse(printed.raw).language).toBe("json/jsonc");
    expect(JSON.parse(printed.raw).languageOptions).toEqual({ allowTrailingCommas: true });
    expect(summary(disallowed.raw)).toBe(
      "a.jsonc: 1:10 null Parsing error: Trailing commas are not allowed in JSONC [fatal]",
    );
    expect(wrong.stderr).toContain('Key "languageOptions": allowTrailingCommas must be a boolean if provided.');
    expect(wrong.exitCode).toBe(2);
    expect(elsewhere.stderr).toContain('Key "languageOptions": allowTrailingCommas option is only available in JSONC.');
    expect(elsewhere.exitCode).toBe(2);
  });

  test("--stdin works, also with a format that shows the code", async () => {
    using dir = tempDir("bun-lint-js-parsers", json);
    const run = async (format: string) => {
      await using proc = spawn({
        cmd: [bunExe(), "lint", "--stdin", "--stdin-filename", "x.jsonc", "-f", format],
        env,
        cwd: String(dir),
        stdin: Buffer.from('{\n  "a": 1, // c\n  "a": 2\n}\n'),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect(exitCode).toBe(1);
      return normalizeBunSnapshot(stdout, String(dir));
    };
    const [unix, pretty] = await Promise.all([run("unix"), run("pretty")]);
    expect(unix).toMatchInlineSnapshot(`
      "<dir>/x.jsonc:3:3: Duplicate key "a" found. [Error/json/no-duplicate-keys]

      1 problem"
    `);
    expect(pretty).toContain('3 |   "a": 2');
  });

  test("--doctor counts the files and the rules as native", async () => {
    const files = { ...json, "package.json": "{}", "a.jsonc": "{}", "b.js": "" };
    const result = await lint(files, ["--doctor", "-f", "json"]);
    const { rules, ...rest } = JSON.parse(result.raw);
    expect(rest.files.linted).toBe(4);
    expect(JSON.stringify(rest.files)).not.toContain("json");
    expect(rules.native).toEqual(["json/no-duplicate-keys"]);
    expect(rules.javascript).toEqual({});
  });

  test("lints a JSON block that a processor extracts", async () => {
    const result = await lint(
      {
        ...jsonPackage(),
        "fenced.mjs": fenced(true),
        "eslint.config.mjs": `
            import json from "@eslint/json";
            import fenced from "./fenced.mjs";
            export default [
              { files: ["**/*.md"], plugins: { fenced }, processor: "fenced/fenced" },
              { files: ["**/*.md/*.json"], plugins: { json }, language: "json/json", rules: { "json/no-duplicate-keys": "error" } },
            ];`,
        "a.md": '# a\n\n```json\n{\n  "a": 1,\n  "a": 2\n}\n```\n',
      },
      ["-f", "json", "a.md"],
    );
    expect(summary(result.raw)).toBe('a.md: 6:3 json/no-duplicate-keys Duplicate key "a" found.');
  });

  test("a JSON rule can't be enabled for a JavaScript file", async () => {
    const files = {
      ...jsonPackage(),
      "eslint.config.mjs": `
        import json from "@eslint/json";
        export default [{ plugins: { json } }, { files: ["on/*.js"], rules: { "json/no-duplicate-keys": "error" } }];`,
      "on/a.js": "",
      "b.js": '/* eslint json/no-duplicate-keys: "error" */',
    };
    const [result, inline] = await Promise.all([lint(files, ["on/a.js"]), lint(files, ["-f", "json", "b.js"])]);
    expect(result.stderr).toContain(
      'Key "rules": The following rules do not support the language "js/js":\n\t- "json/no-duplicate-keys"',
    );
    expect(result.exitCode).toBe(2);
    expect(summary(inline.raw)).toMatchInlineSnapshot(`
      "b.js: 1:1 json/no-duplicate-keys Inline configuration for rule "json/no-duplicate-keys" is invalid:
      	Rule does not support the language "js/js". Use a config block with "files" to apply the rule only to supported files, or disable it.
      "
    `);
  });

  // ESLint derives the same prefix, `json`, from its name.
  test.each<[string, Record<string, string>, string[]]>([
    [
      "an .eslintrc.json",
      { ".eslintrc.json": `{ "root": true, "plugins": ["json"], "rules": { "json/no-duplicate-keys": "error" } }` },
      [],
    ],
    [
      "--plugin",
      { "eslint.config.mjs": `export default [{ rules: { "json/no-duplicate-keys": "error" } }];` },
      ["--plugin", "json"],
    ],
    [
      "bunfig.toml",
      { "bunfig.toml": `[lint]\nplugins = ["eslint-plugin-json"]\n[lint.rules]\n"json/no-duplicate-keys" = "error"\n` },
      [],
    ],
    [
      "an .oxlintrc.json",
      { ".oxlintrc.json": `{ "jsPlugins": ["eslint-plugin-json"], "rules": { "json/no-duplicate-keys": "error" } }` },
      [],
    ],
  ])("eslint-plugin-json is treated like any other package when it's loaded from %s", async (_, files, args) => {
    const result = await lint(
      {
        "package.json": "{}",
        "node_modules/eslint-plugin-json/package.json": `{ "name": "eslint-plugin-json", "main": "index.js" }`,
        "node_modules/eslint-plugin-json/index.js": `
            const create = context => ({ Program: node => context.report({ node, message: "eslint-plugin-json" }) });
            module.exports = { meta: { name: "eslint-plugin-json" }, rules: { "no-duplicate-keys": { create } } };`,
        "a.js": "a;\n",
        ...files,
      },
      ["-f", "unix", ...args, "a.js"],
    );
    expect(result.stdout).toMatch(/a\.js:1:1: eslint-plugin-json \[Error\/json[/(]no-duplicate-keys\)?\]/);
  });

  // Anything that works with the package has to keep working.
  describe("the whole file goes to the eslint package", () => {
    const own = {
      "own.mjs": `export default { rules: { seen: { create: context => ({ Line: () => context.report({ line: 1, message: "own" }) }) } } };`,
    };
    const withOwn = (more: string) =>
      jsonConfig(more).replace("export default", `import own from "./own.mjs";\n  export default`);
    const text = '{ "a": 1, "a": 2 }';
    test.each<[string, Record<string, string>, string[], string]>([
      [
        "a plugin rule that isn't built in is on",
        { "eslint.config.mjs": jsonConfig(`{ files: ["*.json"], rules: { "json/only-in-the-package": "warn" } }`) },
        [],
        "the package: no-duplicate-keys, the package: only-in-the-package",
      ],
      [
        "another plugin's rule is on",
        {
          ...own,
          "eslint.config.mjs": withOwn(`{ files: ["*.json"], plugins: { own }, rules: { "own/seen": "error" } }`),
        },
        [],
        "the package: no-duplicate-keys, own",
      ],
      ["--no-native-plugin-rules", {}, ["--no-native-plugin-rules"], "the package: no-duplicate-keys"],
      ["--native-plugin-rules lists others", {}, ["--native-plugin-rules=import"], "the package: no-duplicate-keys"],
      ["another package uses the prefix", jsonPackage("eslint-plugin-json"), [], "the package: no-duplicate-keys"],
    ])("if %s", async (_, files, args, expected) => {
      const all = { ...eslintPackage, ...json, ...files, "a.json": text };
      const result = await lint(all, ["-f", "json", "--timing", ...args, "a.json"]);
      const messages = JSON.parse(result.raw)[0].messages.map((it: any) => it.message);
      expect(messages.join(", ")).toBe(expected);
      expect(result.stderr).toContain("the eslint package linted 1 files");
    });

    test("if a comment in it turns on a rule that isn't built in", async () => {
      const files = {
        ...eslintPackage,
        ...json,
        "a.jsonc": `/* eslint json/only-in-the-package: "error" */ ${text}`,
        "b.jsonc": text,
      };
      const result = await lint(files, ["-f", "json", "--timing", "."]);
      expect(summary(result.raw)).toMatchInlineSnapshot(`
          "a.jsonc: 1:1 json/no-duplicate-keys the package: no-duplicate-keys
          b.jsonc: 1:11 json/no-duplicate-keys Duplicate key "a" found."
        `);
      expect(result.stderr).toContain("the eslint package linted 1 files");
    });

    // A rule that needs eslint can be turned on in the config or by a comment in the file. Either way the run
    // continues.
    describe("if eslint isn't installed, the file is skipped with a warning and the rest is linted", () => {
      const languages = {
        JSON: {
          needy: "needs-eslint.jsonc",
          good: "good.jsonc",
          text: `${text}\n`,
          comment: '/* eslint no-irregular-whitespace: "error" */',
          // `--fix` removes the unused disable comment.
          fixable: '{\n  "a": 1 // eslint-disable-line json/no-duplicate-keys\n}\n',
          fixed: '{\n  "a": 1  \n}\n',
          project: (more: string) => ({ ...jsonPackage(), "eslint.config.mjs": jsonConfig(more) }),
          rule: "json/only-in-the-package",
          reported: "json/no-duplicate-keys",
        },
        Markdown: {
          needy: "needs-eslint.md",
          good: "good.md",
          text: "<b>a</b>\n",
          comment: '<!-- eslint markdown/only-in-the-package: "error" -->\n\n',
          fixable: "(reversed)[x]\n",
          fixed: "[reversed](x)\n",
          project: (more: string) => ({
            ...markdownPackage(),
            "eslint.config.mjs": markdownConfig(more, `["no-html", "no-reversed-media-syntax"]`),
          }),
          rule: "markdown/only-in-the-package",
          reported: "markdown/no-html",
        },
      };
      type Language = keyof typeof languages;
      // The same project twice. Only the place where the rule is turned on differs.
      const both = (language: Language, good?: string) => {
        const it = languages[language];
        const rest = { [it.good]: good ?? it.text };
        return [
          {
            ...it.project(`{ files: ["${it.needy}"], rules: { "${it.rule}": "error" } }`),
            ...rest,
            [it.needy]: it.text,
          },
          { ...it.project(""), ...rest, [it.needy]: it.comment + it.text },
        ];
      };
      const withoutTimes = (text: string) => text.replaceAll(/\[[\d.]+m?s\]/g, "[time]");
      const warning = (name: string) =>
        `1 file was not linted because it needs eslint, which is not installed (1 *${name.slice(name.indexOf("."))}): ${name}\n  Run bun add -d eslint`;

      describe.each(Object.keys(languages) as Language[])("%s", language => {
        const it = languages[language];

        test.each(["-f unix", "-f stylish", "-f json", "-f agent", "-f unix --allow-unsupported", "-f unix --quiet"])(
          "%s",
          async args => {
            const flags = args.split(" ");
            const [inConfig, inComment] = await Promise.all(both(language).map(files => lint(files, [...flags, "."])));
            expect(inComment.stdout).toContain(it.reported);
            expect(inComment.stdout).not.toContain(it.needy);
            expect(inComment.stderr).toContain(warning(it.needy));
            expect(inComment.exitCode).toBe(flags.includes("--allow-unsupported") ? 1 : 2);
            // `-f json` prints absolute paths, and each project has its own temporary directory.
            const withoutDir = (text: string) => text.replaceAll(/bun-lint-js-parsers_\w+/g, "<dir>");
            const printed = (it: typeof inConfig) => [withoutDir(it.stdout), withoutTimes(it.stderr), it.exitCode];
            expect(printed(inComment)).toEqual(printed(inConfig));
          },
        );

        test("--fix fixes the other files", async () => {
          const projects = both(language, it.fixable);
          for (const result of await Promise.all(projects.map(files => lint(files, ["--fix", "."], [it.good])))) {
            expect(result.files).toEqual({ [it.good]: it.fixed });
            expect(result.stderr).toContain(warning(it.needy));
            expect(result.exitCode).toBe(2);
          }
        });

        test("--stdin", async () => {
          const results = await Promise.all(
            both(language).map(files =>
              lint(files, ["--stdin", "--stdin-filename", it.needy, "-f", "json"], [], String(files[it.needy])),
            ),
          );
          for (const result of results) {
            expect(result.raw.trim()).toBe("[]");
            expect(result.stderr).toContain(warning(it.needy));
            expect(result.exitCode).toBe(2);
          }
        });
      });

      test("several such files among others", async () => {
        const [json, markdown] = [languages.JSON, languages.Markdown];
        const config = `
          import json from "@eslint/json";
          import markdown from "@eslint/markdown";
          export default [
            { files: ["**/*.jsonc"], plugins: { json }, language: "json/jsonc", rules: { "json/no-duplicate-keys": "error" } },
            { files: ["**/*.md"], plugins: { markdown }, language: "markdown/commonmark", rules: { "markdown/no-html": "error" } },
            { files: ["in-config.*"], rules: { "json/only-in-the-package": "error" } },
            { files: ["**/*.js"], rules: { "no-var": "error" } },
          ];`;
        const files: Record<string, string> = {
          ...jsonPackage(),
          ...markdownPackage(),
          "eslint.config.mjs": config,
          "in-config.jsonc": json.text,
          "a/in-comment.jsonc": json.comment + json.text,
          "b/in-comment.jsonc": json.comment + json.text,
          "a/in-comment.md": markdown.comment + markdown.text,
          "script.js": "var a;\n",
        };
        for (let i = 0; i < 10; i++) {
          files[`a/${i}.jsonc`] = json.text;
          files[`b/${i}.md`] = markdown.text;
        }
        const result = await lint(files, ["-f", "json", "--threads", "4", "."]);
        const linted = JSON.parse(result.raw).filter((it: any) => it.messages.length === 1);
        expect(linted.length).toBe(21);
        expect(result.raw).not.toContain("in-co");
        expect(result.stderr).toContain(
          "4 files were not linted because they need eslint, which is not installed (3 *.jsonc, 1 *.md): a/in-comment.jsonc, a/in-comment.md, b/in-comment.jsonc, ..\n  Run bun add -d eslint",
        );
        expect(result.exitCode).toBe(2);
      });

      // Files only go to the eslint package with an eslint.config.js, so installing it wouldn't help here.
      test("with an .eslintrc, the warning doesn't tell you to install eslint", async () => {
        const files = {
          ".eslintrc.json": JSON.stringify({
            root: true,
            rules: { "no-var": "error" },
            overrides: [{ files: ["*.foo"], parser: "some-parser" }],
          }),
          "node_modules/some-parser/package.json": JSON.stringify({ name: "some-parser", main: "index.js" }),
          "node_modules/some-parser/index.js": "module.exports = { parse() {} };",
          "a.js": "var a;\n",
          "b.foo": "foo\n",
        };
        const result = await lint(files, ["-f", "unix", "."]);
        expect(result.stdout).toContain("a.js:1:1: Unexpected var");
        expect(result.stderr).toContain(
          "1 file was not linted because the parser in your config only works with an eslint.config.js (1 *.foo): b.foo\n",
        );
        expect(result.stderr).not.toContain("bun add");
        expect(result.exitCode).toBe(2);
      });

      describe("a block that a processor finds in a file", () => {
        const project = {
          ...jsonPackage(),
          "fenced.mjs": fenced(true),
          "eslint.config.mjs": `
            import json from "@eslint/json";
            import fenced from "./fenced.mjs";
            const whole = { preprocess: (text, filename) => [{ text, filename: "whole.txt" }], postprocess: lists => lists.flat() };
            const own = { languages: { text: {} }, processors: { whole } };
            export default [
              { files: ["**/*.md"], plugins: { fenced }, processor: "fenced/fenced" },
              { files: ["**/*.js"], rules: { "no-var": "error" } },
              { files: ["**/*.jsonc"], plugins: { json }, language: "json/jsonc", rules: { "json/no-duplicate-keys": "error" } },
              { files: ["**/*.css", "**/*.txt"], plugins: { own }, language: "own/text" },
              { files: ["*.txt"], processor: "own/whole" },
            ];`,
        };
        const fence = (language: string, code: string) => `\`\`\`${language}\n${code}\n\`\`\`\n\n`;

        test("is listed in the warning, and the file's other blocks are reported", async () => {
          const files = {
            ...project,
            "a.md": [
              fence("js", "var a;"),
              // The config gives it a language that isn't built in.
              fence("css", "a {}"),
              fence("jsonc", text),
              // A comment turns on a rule that isn't built in.
              fence("jsonc", `/* eslint json/only-in-the-package: "error" */ ${text}`),
              fence("js", "var b;"),
            ].join(""),
            "b.js": "var c;\n",
          };
          const result = await lint(files, ["-f", "json", "a.md", "b.js"]);
          expect(summary(result.raw).replaceAll(/ \[fix.*/g, "")).toBe(
            [
              "a.md: 2:1 no-var Unexpected var, use let or const instead.",
              'a.md: 10:11 json/no-duplicate-keys Duplicate key "a" found.',
              "a.md: 18:1 no-var Unexpected var, use let or const instead.",
              "b.js: 1:1 no-var Unexpected var, use let or const instead.",
            ].join("\n"),
          );
          expect(result.stderr).toContain(
            "2 files were not linted because they need eslint, which is not installed (1 *.css, 1 *.jsonc): a.md/1_block.css, a.md/3_block.jsonc\n  Run bun add -d eslint",
          );
          expect(result.stderr).toContain("Linted 2 files");
          expect(result.exitCode).toBe(2);
        });

        test("--fix fixes the other blocks, and the warning lists the block once", async () => {
          const files = { ...project, "a.md": fence("js", "var a = 1; var b = 2;") + fence("css", "a {}") };
          const result = await lint(files, ["--fix", "a.md"], ["a.md"]);
          expect(result.files["a.md"]).toBe(fence("js", "let a = 1; let b = 2;") + fence("css", "a {}"));
          expect(result.stderr).toContain(
            "1 file was not linted because it needs eslint, which is not installed (1 *.css): a.md/1_block.css\n",
          );
          expect(result.exitCode).toBe(2);
        });

        test("if a named block is the whole file, the warning lists the file", async () => {
          const result = await lint({ ...project, "b.txt": "text\n", "b.js": "var c;\n" }, [
            "-f",
            "json",
            "b.txt",
            "b.js",
          ]);
          expect(summary(result.raw)).toStartWith("b.js: 1:1 no-var");
          expect(result.raw).not.toContain("b.txt");
          expect(result.stderr).toContain(warning("b.txt"));
          expect(result.stderr).toContain("Linted 1 file\n");
          expect(result.exitCode).toBe(2);
        });

        // ESLint silently skips a block like this too.
        test("is skipped without a warning if no config object matches its name", async () => {
          const languages = ["ts", "yaml", "json", "sh", "html", "py", "rs", "toml", "vue", "scss"];
          const readme = languages.map(language => fence(language, "a {}")).join("");
          const result = await lint({ ...project, "README.md": fence("js", "let a;") + readme }, [
            "-f",
            "json",
            "README.md",
          ]);
          expect(summary(result.raw)).toBe("");
          expect(result.stderr).not.toContain("not linted");
          expect(result.exitCode).toBe(0);
        });
      });
    });
  });
});
const markdownRules = [
  "fenced-code-language",
  "fenced-code-meta",
  "heading-increment",
  "no-bare-urls",
  "no-duplicate-definitions",
  "no-duplicate-headings",
  "no-empty-definitions",
  "no-empty-images",
  "no-empty-links",
  "no-html",
  "no-invalid-label-refs",
  "no-missing-atx-heading-space",
  "no-missing-label-refs",
  "no-missing-link-fragments",
  "no-multiple-h1",
  "no-reference-like-urls",
  "no-reversed-media-syntax",
  "no-space-in-emphasis",
  "no-unused-definitions",
  "require-alt-text",
  "table-column-count",
];

const markdownPackage = (name = "@eslint/markdown") => ({
  "node_modules/@eslint/markdown/package.json": JSON.stringify({ name, version: "8.0.3", main: "index.js" }),
  "node_modules/@eslint/markdown/index.js": `
    const language = { parse: ({ body }) => ({ ok: true, ast: { lines: body.split("\\n") } }) };
    const rule = name => ({ create: context => ({ Line: () => context.report({ line: 1, message: "the package: " + name }) }) });
    module.exports = {
      meta: { name: ${JSON.stringify(name)}, version: "8.0.3" },
      languages: { commonmark: language, gfm: language },
      rules: Object.fromEntries(${JSON.stringify([...markdownRules, "only-in-the-package"])}.map(name => [name, rule(name)])),
    };`,
});

// Turns on every rule. Files are CommonMark, except `*.gfm.md`, which are GFM.
const markdownConfig = (more = "", rules = JSON.stringify(markdownRules)) => `
  import markdown from "@eslint/markdown";
  const rules = Object.fromEntries(${rules}.map(name => ["markdown/" + name, "error"]));
  export default [
    { files: ["**/*.md"], plugins: { markdown }, language: "markdown/commonmark", rules },
    { files: ["**/*.gfm.md"], language: "markdown/gfm" },
    ${more}
  ];`;

// The expected output is what ESLint 10.13 reports with @eslint/markdown 8.0.3, unless a comment says otherwise.
describe.concurrent("bun lint with built-in Markdown", () => {
  const project = { ...markdownPackage(), "eslint.config.mjs": markdownConfig() };
  const few = { ...markdownPackage(), "eslint.config.mjs": markdownConfig("", `["no-html", "no-empty-links"]`) };
  const mark = String.fromCodePoint(0xfeff);

  test("lints CommonMark and GFM without the eslint package", async () => {
    const table = "| a | b |\n| - | - |\n| 1 | 2 | 3 |\n\nhttps://example.com";
    const result = await lint(
      {
        ...project,
        "a.md":
          "# Ünï 😀\n\n### Skipped\n\n[é😀][missing], ![](x.png), [empty]() and (reversed)[x]\n\n```\ncode\n```\n\n#NoSpace\n\n<b>bold</b> ** not bold**\n\n# Ünï 😀\n",
        "b.gfm.md": `${table} [^1]\n\n[^1]: one\n[^1]: two\n[^2]: unused\n`,
        "b.md": `${table}\n`,
        "crlf.md": `${mark}# a\r\n\r\n### é😀 b\r\n\r\n[x]: y\r\n[x]: z\r\n`,
        "fine.md":
          "# Title\n\n## Section\n\nSee [section](#section) and [the site][site].\n\n```js title\n1;\n```\n\n[site]: https://example.com\n",
      },
      ["-f", "json", "--timing", "."],
    );
    expect(summary(result.raw)).toMatchInlineSnapshot(`
        "a.md: 3:1 markdown/heading-increment Heading level skipped from 1 to 3.
        a.md: 5:7 markdown/no-missing-label-refs Label reference 'missing' not found.
        a.md: 5:17 markdown/require-alt-text Alternative text for image is required.
        a.md: 5:29 markdown/no-empty-links Unexpected empty link found.
        a.md: 5:43 markdown/no-reversed-media-syntax Unexpected reversed syntax found. Use [label](URL) syntax instead. [fix 65,78 "[reversed](x)"]
        a.md: 5:54 markdown/no-missing-label-refs Label reference 'x' not found.
        a.md: 7:1 markdown/fenced-code-language Missing code block language.
        a.md: 11:1 markdown/no-missing-atx-heading-space Missing space after hash(es) on ATX style heading. [fix 95,95 " "]
        a.md: 13:1 markdown/no-html HTML element "b" is not allowed.
        a.md: 13:13 markdown/no-space-in-emphasis Unexpected space around emphasis marker. [fix 118,119 ""]
        a.md: 15:1 markdown/no-multiple-h1 Unexpected additional H1 heading found.
        a.md: 15:1 markdown/no-duplicate-headings Duplicate heading "Ünï 😀" found.
        b.gfm.md: 3:9 markdown/table-column-count Table column count mismatch (Expected: 2, Actual: 3), extra data starting here will be ignored.
        b.gfm.md: 5:1 markdown/no-bare-urls Unexpected bare URL. Use autolink (<URL>) or link ([text](URL)) instead. [fix 35,54 "<https://example.com>"]
        b.gfm.md: 8:1 markdown/no-duplicate-definitions Unexpected duplicate footnote definition \`1\` (label: \`1\`) found. First defined at line 7 (label: \`1\`).
        b.gfm.md: 9:1 markdown/no-unused-definitions Unexpected unused footnote definition \`2\` (label: \`2\`) found.
        crlf.md: 3:1 markdown/heading-increment Heading level skipped from 1 to 3.
        crlf.md: 5:1 markdown/no-unused-definitions Unexpected unused definition \`x\` (label: \`x\`) found.
        crlf.md: 6:1 markdown/no-duplicate-definitions Unexpected duplicate definition \`x\` (label: \`x\`) found. First defined at line 5 (label: \`x\`).
        crlf.md: 6:1 markdown/no-unused-definitions Unexpected unused definition \`x\` (label: \`x\`) found."
      `);
    expect(JSON.parse(result.raw)[0].messages[1]).toEqual({
      ruleId: "markdown/no-missing-label-refs",
      severity: 2,
      message: "Label reference 'missing' not found.",
      line: 5,
      column: 7,
      messageId: "notFound",
      endLine: 5,
      endColumn: 14,
    });
    expect(result.stderr).not.toContain("the eslint package linted");
    expect(result.exitCode).toBe(1);
  });

  test("HTML comments disable and configure rules", async () => {
    const result = await lint(
      {
        ...few,
        "next-line.gfm.md": "<!-- eslint-disable-next-line markdown/no-html -- why -->\n<b>a</b>\n\n<b>b</b>\n",
        "line.md": "<b>a</b> <!-- eslint-disable-line -->\n",
        "block.md":
          "<!-- eslint-disable markdown/no-html -->\n\n<b>a</b> [a]()\n\n<!-- eslint-enable markdown/no-html -->\n\n<b>b</b>\n",
        "inline.md": "a <!-- eslint-disable --> <b>b</b> <!-- eslint-enable --> <b>c</b>\n",
        "unused.md": "<!-- eslint-disable-next-line markdown/no-html -->\na\n",
        "unknown.md": "<!-- eslint-disable markdown/nope -->\n\n<b>a</b>\n",
        "off.md": '<!-- eslint markdown/no-html: "off" -->\n\n<b>a</b>\n',
        "warn.md": '<!-- eslint markdown/no-html: ["warn", { allowed: ["i"] }] -->\n\n<b>a</b> <i>b</i>\n',
        "options.md": '<!-- eslint markdown/no-html: ["error", 1] -->\n\na\n',
        "several-lines.md": "<b>a</b> <!-- eslint-disable-line\n-->\n",
        "in-code.md": "```html\n<!-- eslint-disable -->\n```\n\n`<!-- eslint-disable -->` <b>a</b>\n",
        "in-a-list.md": "- a\n\n  <!-- eslint-disable-next-line markdown/no-html -->\n  <b>a</b>\n",
        "two.md":
          "<!-- eslint-disable markdown/no-html --> <!-- eslint-disable markdown/no-empty-links -->\n\n<b>a</b> [a]()\n",
        "other.md": "<!-- global a --> <!-- oxlint-disable --> <!-- prettier-ignore -->\n\n<b>a</b>\n",
      },
      ["-f", "json", "."],
    );
    expect(summary(result.raw)).toMatchInlineSnapshot(`
        "block.md: 3:10 markdown/no-empty-links Unexpected empty link found.
        block.md: 7:1 markdown/no-html HTML element "b" is not allowed.
        block.md: 3:1 markdown/no-html HTML element "b" is not allowed. [suppressed: ]
        in-a-list.md: 4:3 markdown/no-html HTML element "b" is not allowed. [suppressed: ]
        in-code.md: 5:27 markdown/no-html HTML element "b" is not allowed.
        inline.md: 1:59 markdown/no-html HTML element "b" is not allowed.
        inline.md: 1:27 markdown/no-html HTML element "b" is not allowed. [suppressed: ]
        line.md: 1:1 markdown/no-html HTML element "b" is not allowed. [suppressed: ]
        next-line.gfm.md: 4:1 markdown/no-html HTML element "b" is not allowed.
        next-line.gfm.md: 2:1 markdown/no-html HTML element "b" is not allowed. [suppressed: why]
        options.md: 1:1 markdown/no-html Inline configuration for rule "markdown/no-html" is invalid:
        	Value 1 should be object.

        other.md: 3:1 markdown/no-html HTML element "b" is not allowed.
        several-lines.md: 1:1 markdown/no-html HTML element "b" is not allowed.
        several-lines.md: 1:10 null eslint-disable-line comment should not span multiple lines.
        two.md: 3:1 markdown/no-html HTML element "b" is not allowed. [suppressed: ]
        two.md: 3:10 markdown/no-empty-links Unexpected empty link found. [suppressed: ]
        unknown.md: 1:1 markdown/nope Definition for rule 'markdown/nope' was not found.
        unknown.md: 3:1 markdown/no-html HTML element "b" is not allowed.
        unused.md: 1:1 null Unused eslint-disable directive (no problems were reported from 'markdown/no-html'). [fix 0,50 " "]
        warn.md: 3:1 markdown/no-html HTML element "b" is not allowed."
      `);
    const severities = JSON.parse(result.raw).flatMap((it: any) => it.messages.map((it: any) => it.severity));
    expect(severities).toEqual([2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1]);
  });

  describe("a directive comment that spans lines inside a container", () => {
    const within = (first: string, rest: string, text: string) =>
      `${text
        .split("\n")
        .map((line, i) => (i ? rest : first) + line)
        .join("\n")}\n`;
    const directive = "<!-- eslint-disable markdown/no-html,\nmarkdown/no-bare-urls -->";
    const bad = "<b>a</b> https://x.y";

    // The `> ` or the indentation at the start of the second line isn't part of the comment.
    test.each([
      ["a block quote", within("> ", "> ", `${directive}\n${bad}`)],
      ["a block quote without the space", within(">", ">", `${directive}\n${bad}`)],
      ["a block quote with a tab", within(">\t", ">\t", `${directive}\n${bad}`)],
      ["a list item", within("- ", "  ", `${directive}\n${bad}`)],
      ["a numbered list item", within("10. ", "    ", `${directive}\n${bad}`)],
      ["a list item indented with a tab", within("-\t", "\t", `${directive}\n${bad}`)],
      ["a block quote in a list item", within("- > ", "  > ", `${directive}\n${bad}`)],
      ["a list item in a block quote", within("> - ", ">   ", `${directive}\n${bad}`)],
      ["a block quote in a block quote", within("> > ", "> > ", `${directive}\n${bad}`)],
      ["a footnote definition", `${within("[^a]: ", "    ", `${directive}\n${bad}`)}\n[^a]\n`],
      ["a paragraph in a block quote", within("> ", "> ", `a ${directive} ${bad}`)],
      ["a paragraph in a block quote, with a lazy second line", `> a ${directive} ${bad}\n`],
      ["a block quote with CRLF", within("> ", "> ", `${directive}\n${bad}`).replaceAll("\n", "\r\n")],
    ])("disables every rule it lists: %s", async (_, text) => {
      const result = await lint({ ...project, "a.gfm.md": text }, ["-f", "json", "a.gfm.md"]);
      const [{ messages, suppressedMessages }] = JSON.parse(result.raw);
      expect(messages).toEqual([]);
      expect(suppressedMessages.map((it: any) => it.ruleId)).toEqual(["markdown/no-html", "markdown/no-bare-urls"]);
    });

    test("configures a rule, and has a justification", async () => {
      const result = await lint(
        {
          ...project,
          "config.md": within(
            "> ",
            "> ",
            '<!-- eslint markdown/no-html: ["error",\n{ allowed: ["b"] }] -->\n<b>a</b> <i>c</i>',
          ),
          "why.md": within("> ", "> ", "<!-- eslint-disable-next-line markdown/no-html -- one\ntwo -->\n<b>a</b>"),
        },
        ["-f", "json", "."],
      );
      expect(summary(result.raw)).toBe(
        'config.md: 3:12 markdown/no-html HTML element "i" is not allowed.\n' +
          'why.md: 3:3 markdown/no-html HTML element "b" is not allowed. [suppressed: one\ntwo]',
      );
    });

    // The plugin's ranges for these fixes are wrong, because it finds a comment by its index in the HTML node's `value`,
    // which has no `> `: 2 to 65, -1 to 17 and 15 to 38.
    test("--fix removes what is unused, and nothing else", async () => {
      const files = {
        "all.gfm.md": within("> ", "> ", `${directive}\na`),
        "first.gfm.md": within("> ", "> ", `${directive}\nhttps://x.y`),
        "last.gfm.md": within("> ", "> ", `${directive}\n<b>a</b>`),
      };
      const found = await lint({ ...project, ...files }, ["-f", "json", "."]);
      expect(summary(found.raw).replaceAll(/^.* markdown\/.*\n?/gm, "")).toMatchInlineSnapshot(`
        "all.gfm.md: 1:3 null Unused eslint-disable directive (no problems were reported from 'markdown/no-html' or 'markdown/no-bare-urls'). [fix 2,67 " "]
        first.gfm.md: 1:3 null Unused eslint-disable directive (no problems were reported from 'markdown/no-html'). [fix 22,42 ""]
        last.gfm.md: 1:3 null Unused eslint-disable directive (no problems were reported from 'markdown/no-bare-urls'). [fix 38,63 ""]
        "
      `);
      const fixed = await lint({ ...project, ...files }, ["--fix", "."], Object.keys(files));
      expect(fixed.files).toEqual({
        "all.gfm.md": ">  \n> a\n",
        "first.gfm.md": "> <!-- eslint-disable markdown/no-bare-urls -->\n> https://x.y\n",
        "last.gfm.md": "> <!-- eslint-disable markdown/no-html -->\n> <b>a</b>\n",
      });
    });
  });

  test("with CRLF, text that spans lines keeps its line breaks", async () => {
    const result = await lint(
      {
        ...project,
        // The plugin counts from the start of the HTML in its `value`, which has no `> `, so it is two columns off.
        "h1.md": "> <h1>a</h1>\r\n> <h1>b</h1>\r\n",
        "label.md": "[a\r\nb]: c\r\n",
        "heading.md": "d\\*\r\ne\r\n---\r\n\r\nd\\*\r\ne\r\n---\r\n",
      },
      ["-f", "json", "."],
    );
    expect(summary(result.raw).replaceAll(/^.*no-html.*\n/gm, "")).toBe(
      [
        "h1.md: 2:1 markdown/no-multiple-h1 Unexpected additional H1 heading found.",
        'heading.md: 5:1 markdown/no-duplicate-headings Duplicate heading "d*\r\ne" found.',
        "label.md: 1:1 markdown/no-unused-definitions Unexpected unused definition `a b` (label: `a\r\nb`) found.",
      ].join("\n"),
    );
  });

  test("noInlineConfig, --no-inline-config and --report-unused-disable-directives-severity work", async () => {
    const files = {
      ...markdownPackage(),
      "eslint.config.mjs": markdownConfig(`{ files: ["no.md"], linterOptions: { noInlineConfig: true } }`),
      "no.md": "<b>a</b> <!-- eslint-disable-line -->\n",
      "b.md": "a <!-- eslint-disable-line -->\n",
    };
    const [plain, ignoring, strict] = await Promise.all([
      lint(files, ["-f", "json", "."]),
      lint(files, ["-f", "json", "--no-inline-config", "."]),
      lint(files, ["-f", "json", "--report-unused-disable-directives-severity", "error", "b.md"]),
    ]);
    expect(summary(plain.raw)).toMatchInlineSnapshot(`
        "b.md: 1:3 null Unused eslint-disable directive (no problems were reported). [fix 2,30 " "]
        no.md: 1:1 markdown/no-html HTML element "b" is not allowed.
        no.md: 1:10 null '<!-- eslint-disable-line -->' has no effect because you have 'noInlineConfig' setting in your config."
      `);
    expect(summary(ignoring.raw)).toBe('no.md: 1:1 markdown/no-html HTML element "b" is not allowed.');
    expect(JSON.parse(strict.raw)[0].errorCount).toBe(1);
  });

  test("languageOptions turn on front matter and math", async () => {
    const [dashes, pluses, dollars] = [
      "---\ntitle: a\n---\n\n# b\n",
      "+++\ntitle = 'a'\n+++\n\n# b\n",
      "$[a]$\n\n$$\n[b]\n$$\n",
    ];
    const result = await lint(
      {
        ...markdownPackage(),
        "eslint.config.mjs": markdownConfig(`
            { files: ["*.yaml.md"], languageOptions: { frontmatter: "yaml" } },
            { files: ["*.toml.md"], languageOptions: { frontmatter: "toml" } },
            { files: ["*.json.md"], languageOptions: { frontmatter: "json" } },
            { files: ["*.math.md"], languageOptions: { math: true } },
            { files: ["*.false.md"], languageOptions: { frontmatter: false, math: false, other: 1 } },`),
        "dashes.md": dashes,
        "dashes.false.md": dashes,
        "dashes.yaml.md": dashes,
        "dashes.toml.md": dashes,
        "pluses.yaml.md": pluses,
        "pluses.toml.md": pluses,
        "dashes.json.md": '---\n{ "title": "a" }\n---\n\n# b\n',
        "crlf.yaml.md": dashes.replaceAll("\n", "\r\n"),
        "not-first.yaml.md": `\n${dashes}`,
        "dollars.md": dollars,
        "dollars.math.md": dollars,
      },
      ["-f", "json", "."],
    );
    expect(summary(result.raw)).toMatchInlineSnapshot(`
        "crlf.yaml.md: 5:1 markdown/no-multiple-h1 Unexpected additional H1 heading found.
        dashes.json.md: 5:1 markdown/no-multiple-h1 Unexpected additional H1 heading found.
        dashes.yaml.md: 5:1 markdown/no-multiple-h1 Unexpected additional H1 heading found.
        dollars.md: 1:3 markdown/no-missing-label-refs Label reference 'a' not found.
        dollars.md: 4:2 markdown/no-missing-label-refs Label reference 'b' not found.
        pluses.toml.md: 5:1 markdown/no-multiple-h1 Unexpected additional H1 heading found."
      `);
  });

  test.each([
    [`{ frontmatter: "xml" }`, '`xml` for frontmatter. Expected one of `false`, `"yaml"`, `"toml"`, or `"json"`.'],
    [`{ frontmatter: true }`, '`true` for frontmatter. Expected one of `false`, `"yaml"`, `"toml"`, or `"json"`.'],
    [`{ frontmatter: null }`, '`null` for frontmatter. Expected one of `false`, `"yaml"`, `"toml"`, or `"json"`.'],
    [`{ frontmatter: ["yaml"] }`, '`yaml` for frontmatter. Expected one of `false`, `"yaml"`, `"toml"`, or `"json"`.'],
    [`{ math: 1 }`, "`1` for math. Expected a boolean."],
  ])("languageOptions: %s is rejected", async (options, message) => {
    const config = markdownConfig(`{ files: ["a.md"], languageOptions: ${options} }`);
    const result = await lint({ ...markdownPackage(), "eslint.config.mjs": config, "a.md": "# a\n" }, ["a.md"]);
    expect(result.stderr).toContain(`Key "languageOptions": Invalid language option value ${message}`);
    expect(result.exitCode).toBe(2);
  });

  test.each([
    [
      `"markdown/no-html": ["error", { allowed: 1 }]`,
      'Key "rules": Key "markdown/no-html":\n\tValue 1 should be array.',
    ],
    [
      `"markdown/fenced-code-meta": ["error", "sometimes"]`,
      'Value "sometimes" should be equal to one of the allowed values.',
    ],
  ])("options are validated: %s", async (rule, message) => {
    const config = markdownConfig(`{ files: ["a.md"], rules: { ${rule} } }`);
    const result = await lint({ ...markdownPackage(), "eslint.config.mjs": config, "a.md": "# a\n" }, ["a.md"]);
    expect(result.stderr).toContain(message);
    expect(result.exitCode).toBe(2);
  });

  // The plugin compiles these options in `create()`, so `new RegExp` throws there and ESLint stops.
  test.each([
    ["heading-increment", "frontmatterTitle", "iu"],
    ["no-multiple-h1", "frontmatterTitle", "iu"],
    ["no-missing-link-fragments", "allowPattern", "u"],
  ])("an invalid regex in the options of %s ends the run with ESLint's error", async (rule, option, flags) => {
    const files = {
      ...markdownPackage(),
      "eslint.config.mjs": markdownConfig(
        `{ files: ["config.md"], rules: { "markdown/${rule}": ["error", { ${option}: "(" }] } }`,
      ),
      "config.md": "# a\n",
      "comment.md": `# a\n\n<!-- eslint markdown/${rule}: ["error", { ${option}: "[" }] -->\n`,
    };
    const [config, comment] = await Promise.all([lint(files, ["config.md"]), lint(files, ["comment.md"])]);
    const loading = `SyntaxError: Error while loading rule 'markdown/${rule}': Invalid regular expression:`;
    expect(config.stderr).toContain(
      `${loading} /(/${flags}: Unterminated group\nOccurred while linting <dir>/config.md`,
    );
    expect(comment.stderr).toContain(
      `${loading} /[/${flags}: Unterminated character class\nOccurred while linting <dir>/comment.md`,
    );
    expect([config.exitCode, comment.exitCode]).toEqual([2, 2]);
  });

  test("--fix works after a byte order mark and with CRLF", async () => {
    const text = `${mark}#Ünï 😀\r\n\r\n** a** and (b)[c] and https://example.com and [d](e)\r\n\r\n[e]: f\r\n`;
    const result = await lint({ ...project, "a.gfm.md": text }, ["--fix", "."], ["a.gfm.md"]);
    expect(result.files).toEqual({
      "a.gfm.md": `${mark}# Ünï 😀\r\n\r\n**a** and [b](c) and <https://example.com> and [d][e]\r\n\r\n[e]: f\r\n`,
    });
    expect(result.exitCode).toBe(0);
  });

  test("--stdin works with stylish, unix and pretty", async () => {
    using dir = tempDir("bun-lint-js-parsers", project);
    const run = async (format: string) => {
      await using proc = spawn({
        cmd: [bunExe(), "lint", "--stdin", "--stdin-filename", "x.gfm.md", "-f", format],
        env,
        cwd: String(dir),
        stdin: Buffer.from("# a\n\n| a |\n| - |\n| 1 | é |\n"),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect(exitCode).toBe(1);
      return normalizeBunSnapshot(stdout, String(dir));
    };
    const [stylish, unix, pretty] = await Promise.all([run("stylish"), run("unix"), run("pretty")]);
    expect(stylish).toMatchInlineSnapshot(`
        "<dir>/x.gfm.md
          5:5  error  Table column count mismatch (Expected: 1, Actual: 2), extra data starting here will be ignored  markdown/table-column-count

        ✖ 1 problem (1 error, 0 warnings)"
      `);
    expect(unix).toContain(
      "x.gfm.md:5:5: Table column count mismatch (Expected: 1, Actual: 2), extra data starting here will be ignored. [Error/markdown/table-column-count]",
    );
    expect(pretty).toContain("5 | | 1 | é |");
  });

  test("--doctor counts the files and the rules as native", async () => {
    const files = { ...few, "package.json": "{}", "a.md": "# a\n", "b.js": "" };
    const result = await lint(files, ["--doctor", "-f", "json"]);
    const { rules, ...rest } = JSON.parse(result.raw);
    expect(JSON.stringify(rest.files)).not.toContain(".md");
    expect(rules.native).toEqual(["markdown/no-empty-links", "markdown/no-html"]);
    expect(rules.javascript).toEqual({});
  });

  // The plugin's rules don't declare `meta.languages`, so ESLint allows it.
  test("a Markdown rule can be enabled for a JavaScript file, where it reports nothing", async () => {
    const files = {
      ...markdownPackage(),
      "eslint.config.mjs": `
          import markdown from "@eslint/markdown";
          export default [{ plugins: { markdown }, rules: { "markdown/no-html": "error", "no-debugger": "error" } }];`,
      "a.js": 'debugger; /* eslint markdown/no-empty-links: "error" */\n',
    };
    const result = await lint(files, ["-f", "json", "a.js"]);
    expect(summary(result.raw)).toBe("a.js: 1:1 no-debugger Unexpected 'debugger' statement.");
    expect(result.exitCode).toBe(1);
  });

  // This is what the plugin's `configs.recommended` and `configs.processor` give you together.
  test("a file that also has the plugin's processor goes to the processor", async () => {
    const files = {
      ...markdownPackage(),
      "fenced.mjs": fenced(true),
      "eslint.config.mjs": `
          import markdown from "@eslint/markdown";
          import { processor } from "./fenced.mjs";
          const plugin = { ...markdown, processors: { markdown: processor } };
          export default [
            { files: ["**/*.md"], plugins: { markdown: plugin }, language: "markdown/commonmark", rules: { "markdown/heading-increment": "error" } },
            { files: ["**/*.md"], processor: "markdown/markdown" },
            { files: ["**/*.md/*.js"], rules: { "no-debugger": "error" } },
          ];`,
      "a.md": "# a\n\n### b\n\n```js\ndebugger;\n```\n",
    };
    const result = await lint(files, ["-f", "json", "a.md"]);
    expect(summary(result.raw)).toBe("a.md: 6:1 no-debugger Unexpected 'debugger' statement.");
  });

  // micromark 4.0.3, the plugin's parser, parses each of these differently.
  test("follows CommonMark where the plugin's parser doesn't", async () => {
    const result = await lint(
      {
        ...project,
        // An unquoted attribute value can contain a `/`. The plugin doesn't see a tag here and reports nothing.
        "slash-in-value.md": "a <a href=b/c>d</a>\n",
        // It can't contain a `=`. The plugin sees a tag, and `markdown/no-html` reports it.
        "two-equals.md": "<a b=c=d>\n",
        // A title in parentheses can't contain an unescaped `(`, so this isn't a definition. The plugin reports an
        // unused definition.
        "paren-in-title.md": "[a]: b (()\n",
      },
      ["-f", "json", "."],
    );
    expect(summary(result.raw)).toMatchInlineSnapshot(`
        "paren-in-title.md: 1:2 markdown/no-missing-label-refs Label reference 'a' not found.
        slash-in-value.md: 1:3 markdown/no-html HTML element "a" is not allowed."
      `);
  });

  describe("markdown/no-space-in-emphasis", () => {
    const options = `{ files: ["**/*.md"], rules: { "markdown/no-space-in-emphasis": ["error", { checkStrikethrough: true }] } }`;
    const files = { ...markdownPackage(), "eslint.config.mjs": markdownConfig(options, "[]") };

    // The plugin pairs a paragraph's first marker with the second and the third with the fourth, regardless of the text
    // around them. It reports every line below through the table, and its fix changes the rendered text: `2 *3* 4`,
    // `*.ts,*.tsx`.
    test("ignores stars and underscores that are plain text", async () => {
      const text = [
        "The area is 2 * 3 * 4 units.",
        "x = a * b + c * d",
        'globs: "*.ts, *.tsx, *.html, *.css"',
        "Matches **/*.js, **/*.mjs and src/* files.",
        "Prints [[ cyclic ref *1 ]] and then [[ cyclic ref *2 ]].",
        "In C: char *a, *b; and x = *p * 2;",
        "f(*args, **kwargs) and g(*a, **k)",
        "/* one comment */ and (* another *)",
        "This is * ambiguous * too.",
        "Will _flag on _words, and words* with asterisks* after them.",
        "About ~ 5 or ~ 10.",
        "# 2 * 3 * 4",
        "| a * b * c |\n| --------- |\n| 1 * 2 * 3 |",
        "`*.ts, *.tsx` and `2 * 3 * 4`",
        "See https://example.com/*/a and https://example.com/*/b.",
      ].join("\n\n");
      const result = await lint({ ...files, "a.gfm.md": `${text}\n` }, ["--fix", "-f", "json", "."], ["a.gfm.md"]);
      expect(summary(result.raw)).toBe("");
      expect(result.files).toEqual({ "a.gfm.md": `${text}\n` });
      expect(result.exitCode).toBe(0);
    });

    test.each([
      ["This is ** important**.", "This is **important**."],
      ["This is **important **.", "This is **important**."],
      ["This is ** important ** too.", "This is **important** too."],
      ["This is _important _.", "This is _important_."],
      ["This is _ important _ too.", "This is _important_ too."],
      ["This is *** very important***.", "This is ***very important***."],
      ["One-sided *broken emphasis *", "One-sided *broken emphasis*"],
      ["(*broken *)", "(*broken*)"],
      ["(* broken*)", "(*broken*)"],
      ["**`code` **", "**`code`**"],
      ["Follow ** [a link](b)**", "Follow **[a link](b)**"],
      ["**Several ** in **one ** line.", "**Several** in **one** line."],
      ["2 * 3 is ** important**.", "2 * 3 is **important**."],
      ["This is ~~ gone~~.", "This is ~~gone~~."],
      ["# A ** heading**", "# A **heading**"],
    ])("--fix turns %j into emphasis", async (before, after) => {
      expect(Bun.markdown.html(before)).not.toMatch(/<(em|strong|del)>/);
      expect(Bun.markdown.html(after)).toMatch(/<(em|strong|del)>/);
      const result = await lint({ ...files, "a.gfm.md": `${before}\n` }, ["--fix", "."], ["a.gfm.md"]);
      expect(result.files).toEqual({ "a.gfm.md": `${after}\n` });
      expect(result.exitCode).toBe(0);
    });
  });

  // The rules are only as good as the tree. `conformance/markdown-trees.mjs` recorded the plugin's trees.
  test.skipIf(!hasTestRunner)(
    "every example in the CommonMark and GFM specs parses to the same tree as with the plugin's parser",
    async () => {
      const recorded = Bun.zstdDecompressSync(readFileSync(join(import.meta.dir, "conformance", "markdown-trees.zst")));
      using dir = tempDir("bun-lint-js-parsers", { "cases.jsonl": recorded });
      await using proc = spawn({
        cmd: [bunExe(), "lint", "--print-markdown-trees", "cases.jsonl"],
        env,
        cwd: String(dir),
        stdin: "ignore",
        stdout: "pipe",
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      const trees = new Map(
        stdout.split(/^### /m).map(it => [it.slice(0, it.indexOf("\n")), it.slice(it.indexOf("\n") + 1)]),
      );
      const cases: { id: string; tree: string }[] = recorded
        .toString()
        .trimEnd()
        .split("\n")
        .map(it => JSON.parse(it));
      expect(cases.length).toBe(3308);
      // Links that the plugin makes from plain text in a later pass have no position, and its rules throw: see below.
      const withPlaces = cases.filter(it => !/^ *\w+ \?/m.test(it.tree));
      expect(cases.length - withPlaces.length).toBe(6);
      const different = withPlaces.filter(it => trees.get(it.id) !== `${it.tree}\n`).map(it => it.id.split(" ")[0]);
      // For each of these, the file has the output of cmark and md4c. Bun matches it and micromark doesn't.
      expect([...new Set(different)]).toEqual([
        // A punctuation character above U+FFFF.
        "coverage.txt#13",
        // `a***b* c*`: whether two delimiter runs can match depends on their full lengths.
        "regressions.txt#7",
        // An empty list item after indented code.
        "regressions.txt#23",
        // A line that's just a tag continues the paragraph before it.
        "regressions.txt#39",
        // A tab before the two spaces of a hard line break.
        "regressions.txt#60",
      ]);
      expect(exitCode).toBe(0);
    },
  );

  // In GFM, the plugin turns text like this into links that have no position. Five of its rules then throw
  // "Custom getLoc() method must be implemented in the subclass", which ends the ESLint run.
  test("lints a file that crashes the plugin", async () => {
    const files = { ...project, "a.gfm.md": "# a\n\n[www.example.com\n\n<www.example.com> <b>c</b>\n" };
    const result = await lint(files, ["-f", "json", "."]);
    expect(summary(result.raw)).toBe('a.gfm.md: 5:19 markdown/no-html HTML element "b" is not allowed.');
  });

  test("the run ends the same way as in ESLint when one of the plugin's rules throws", async () => {
    const config = markdownConfig(
      `{ rules: { "markdown/no-missing-atx-heading-space": ["error", { checkClosedHeadings: true }] } }`,
    );
    const result = await lint({ ...markdownPackage(), "eslint.config.mjs": config, "a.md": "#\n" }, ["a.md"]);
    expect(result.stderr).toContain(
      "RangeError: Index out of range (requested index -1, but source text has length 2).",
    );
    expect(result.stderr).toContain('Rule: "markdown/no-missing-atx-heading-space"');
    expect(result.exitCode).toBe(2);
  });

  test("invalid UTF-8 and NUL in a file count as U+FFFD", async () => {
    const bytes = (text: string) => Buffer.from(text, "latin1");
    const result = await lint(
      {
        ...project,
        "a.md": bytes("# a\xFF\n\n# a\xEF\xBF\xBD\n\n[b\xFF]\n"),
        "nul.md": bytes("# a\0\n\n[\0]\n\n<b\0>\n\n<i>\n"),
      },
      ["-f", "json", "."],
    );
    const replaced = String.fromCodePoint(0xfffd);
    expect(summary(result.raw)).toBe(
      [
        "a.md: 3:1 markdown/no-multiple-h1 Unexpected additional H1 heading found.",
        `a.md: 3:1 markdown/no-duplicate-headings Duplicate heading "a${replaced}" found.`,
        `a.md: 5:2 markdown/no-missing-label-refs Label reference 'b${replaced}' not found.`,
        "nul.md: 3:2 markdown/no-missing-label-refs Label reference '\0' not found.",
        'nul.md: 7:1 markdown/no-html HTML element "i" is not allowed.',
      ].join("\n"),
    );
  });

  describe("runs in linear time", () => {
    const count = many(20_000);
    test.each([
      ["headings", "# a\n\n"],
      ["HTML headings", "<h1>a</h1>"],
      ["opening heading tags", "<h1>"],
      ["tags with an id", "<div id=a>\n"],
      ["references on one line, after a non-ASCII character", "é [a] "],
      ["definitions", "[a]: b\n"],
      ["fragment links", "[a](#b) "],
      ["emphasis markers", "* a *"],
      ["comments", "<!-- a -->"],
      ["unclosed comments", "<!-- "],
      ["bare URLs", "https://a.b "],
      ["rows", "| a | b |\n"],
      ["block quotes", "> "],
      ["list items", "- "],
    ])("%s", async (_, unit) => {
      const text = `| a |\n| - |\n${repeated(unit, count)}\n`;
      const result = await lint({ ...project, "a.gfm.md": text }, ["-f", "json", "a.gfm.md"]);
      expect(JSON.parse(result.raw)[0].messages.filter((it: any) => it.fatal)).toEqual([]);
      expect(result.exitCode).toBeLessThan(2);
    });
  });

  // Anything that works with the package has to keep working.
  describe("the whole file goes to the eslint package", () => {
    const own = {
      "own.mjs": `export default { rules: { seen: { create: context => ({ Line: () => context.report({ line: 1, message: "own" }) }) } } };`,
    };
    const one = (more = "") => markdownConfig(more, `["no-html"]`);
    test.each<[string, Record<string, string>, string[], string]>([
      [
        "a plugin rule that isn't built in is on",
        { "eslint.config.mjs": one(`{ files: ["*.md"], rules: { "markdown/only-in-the-package": "warn" } }`) },
        [],
        "the package: no-html, the package: only-in-the-package",
      ],
      [
        "another plugin's rule is on",
        {
          ...own,
          "eslint.config.mjs": one(`{ files: ["*.md"], plugins: { own }, rules: { "own/seen": "error" } }`).replace(
            "export default",
            `import own from "./own.mjs";\n  export default`,
          ),
        },
        [],
        "the package: no-html, own",
      ],
      ["--no-native-plugin-rules", {}, ["--no-native-plugin-rules"], "the package: no-html"],
      ["--native-plugin-rules lists others", {}, ["--native-plugin-rules=import"], "the package: no-html"],
      ["another package uses the prefix", markdownPackage("eslint-plugin-markdown"), [], "the package: no-html"],
    ])("if %s", async (_, files, args, expected) => {
      const all = {
        ...eslintPackage,
        ...markdownPackage(),
        "eslint.config.mjs": one(),
        ...files,
        "a.md": "<b>a</b>\n",
      };
      const result = await lint(all, ["-f", "json", "--timing", ...args, "a.md"]);
      const messages = JSON.parse(result.raw)[0].messages.map((it: any) => it.message);
      expect(messages.join(", ")).toBe(expected);
      expect(result.stderr).toContain("the eslint package linted 1 files");
    });

    test("if a comment in it turns on a rule that isn't built in", async () => {
      const files = {
        ...eslintPackage,
        ...markdownPackage(),
        "eslint.config.mjs": one(),
        "a.md": '<!-- eslint markdown/only-in-the-package: "error" -->\n\n<b>a</b>\n',
        "b.md": "<b>a</b>\n",
      };
      const result = await lint(files, ["-f", "json", "--timing", "."]);
      expect(summary(result.raw)).toMatchInlineSnapshot(`
          "a.md: 1:1 markdown/no-html the package: no-html
          b.md: 1:1 markdown/no-html HTML element "b" is not allowed."
        `);
      expect(result.stderr).toContain("the eslint package linted 1 files");
    });
  });
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

// Returns `file line:column rule` for each diagnostic in oxlint's JSON format.
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
  // After a script in an unknown language, the rest of the file isn't linted.
  "d.vue": `<script lang="coffee">
x = 1
</script>
<script setup>
debugger;
</script>
`,
};

describe.concurrent("bun lint with an .oxlintrc.json", () => {
  test("lints the scripts in .vue, .svelte and .astro files like oxlint", async () => {
    const result = await lint(scripts, ["-f", "json"]);
    // This is what oxlint 1.80 reports.
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

  test("--fix fixes the scripts in place", async () => {
    const result = await lint(scripts, ["--fix", "-f", "json"], ["a.vue", "b.svelte", "c.astro", "d.vue"]);
    // These are the exact bytes oxlint 1.87 writes.
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
