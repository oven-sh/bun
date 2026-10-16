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
  { files: ["**/*.js"], rules: { "no-var": "error", "no-debugger": "warn" } },
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
        a.md: 15:15 no-var Unexpected var, use let or const instead.
        a.md: 15:25 eqeqeq Expected '===' and instead saw '=='.
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
        `"a.md: 2:1 no-var Unexpected var, use let or const instead. [fix 6,9 "let"]"`,
      );
      expect(result.exitCode).toBe(1);
      // What the processor gives back without a name is for the language.
      const whole = await lint(files, ["b.txt"]);
      expect(whole.stderr).toContain(`b.txt returned code in the language "fenced/text", but`);
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
        "a.js: 1:1 no-var Unexpected var, use let or const instead. [fix 0,3 "let"]
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
      expect(result.stderr).toContain("the eslint package linted 1 files");
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  // `Linter#verify` takes a `ruleFilter` since ESLint 9. That of ESLint 8 runs every rule, and finds a comment that disables one unused.
  test.each([
    ["9", "rules.filter(ruleFilter)"],
    ["8", `[...rules, ...["'semi'", "'indent' or 'semi'", "'semi' or 'no-var'"].map(unused)]`],
  ])(
    "the deprecated rules about layout do not run there either: ESLint %s",
    async (_, reported) => {
      const result = await lint(
        {
          ...eslintPackage,
          // One message for each rule that runs.
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

  // As `@babel/eslint-parser` with a plugin for syntax that is no standard yet. What is called like JavaScript is read here, as
  // long as it can be. As in nodejs/node the packages are not above the configuration file: eslint is beside the parser.
  test(
    "so is a file called like JavaScript that only its own parser can read, and no rule sees what is made of it here",
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
      expect((await realms("plain"))[0]).toBe(24);
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
        "1 file was not linted because bun lint only supports JavaScript and TypeScript (1 *.txt): b.txt\n  To lint other languages, install eslint: bun add -d eslint",
      );
      expect(result.exitCode).toBe(2);
    },
    timeout,
  );
});

// A stand-in for `@eslint/json`. What it reports shows that it was asked, which takes the package `eslint`.
const jsonPackage = (name = "@eslint/json") => ({
  "node_modules/@eslint/json/package.json": JSON.stringify({ name, version: "2.1.1", main: "index.js" }),
  "node_modules/@eslint/json/index.js": `
    const language = { parse: ({ body }) => ({ ok: true, ast: { lines: body.split("\\n") } }) };
    const rule = name => ({ create: context => ({ Line: () => context.report({ line: 1, message: "the package: " + name }) }) });
    module.exports = {
      meta: { name: ${JSON.stringify(name)}, namespace: "json", version: "2.1.1" },
      languages: { json: language, jsonc: language, json5: language },
      rules: { "no-duplicate-keys": rule("no-duplicate-keys"), "only-in-the-package": rule("only-in-the-package") },
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

// What is expected is what ESLint 10.13 with @eslint/json 2.1.1 reports.
describe.concurrent("bun lint with the languages that are built in", () => {
  const json = { ...jsonPackage(), "eslint.config.mjs": jsonConfig() };
  const [mark, noBreakSpace, noCharacter] = [0xfeff, 0xa0, 0xffff].map(it => String.fromCodePoint(it));

  test(
    "JSON, JSONC and JSON5 are linted here, without the package eslint",
    async () => {
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
    },
    timeout,
  );

  test(
    "an object with many keys",
    async () => {
      const keys = Array.from({ length: 50_000 }, (_, i) => `"k${i}": ${i}`);
      const text = `{${keys.join(",")},"k7":0,"k49999":0,"new":0}`;
      const result = await lint({ ...json, "a.json": text }, ["-f", "json", "."]);
      expect(summary(result.raw).replaceAll(/\d+:\d+ /g, "")).toBe(
        'a.json: json/no-duplicate-keys Duplicate key "k7" found.\na.json: json/no-duplicate-keys Duplicate key "k49999" found.',
      );
    },
    timeout,
  );

  test(
    "nesting is only limited by memory",
    async () => {
      const deep = `${'{"a":['.repeat(200_000)}{"b":1,"b":2}${"]}".repeat(200_000)}`;
      const result = await lint({ ...json, "a.json": deep }, ["-f", "json", "."]);
      expect(summary(result.raw)).toBe('a.json: 1:1200008 json/no-duplicate-keys Duplicate key "b" found.');
    },
    timeout,
  );

  test(
    "what the parser of the plugin refuses is refused with its words, at its place",
    async () => {
      const cases: [string, string, string][] = [
        ["json", "", "1:1 Unexpected end of input found."],
        ["json", "{", "1:1 Unexpected token LBrace found."],
        ["json", '{"a":1', "1:7 Unexpected end of input found."],
        ["json", '{"a":', "1:1 Unexpected end of input found."],
        ["json", '{"a":1,}', "1:8 Unexpected token RBrace found."],
        ["json", "[1,]", "1:4 Unexpected token RBracket found."],
        ["json", "[1", "1:2 Unexpected token Number found."],
        ["json", "{} {}", "1:4 Unexpected token LBrace found."],
        ["json", "// c\n1", "1:1 Unexpected character '/' found."],
        ["json", "{a:1}", "1:2 Unexpected character 'a' found."],
        ["json", "'a'", "1:1 Unexpected character ''' found."],
        ["json", "tru", "1:1 Unexpected identifier 'tru' found."],
        ["json", "01", "1:1 Unexpected character '1' found."],
        ["json", "+1", "1:1 Unexpected character '+' found."],
        ["json", '{\n  "a": "\\q"\n}', "2:9 Unexpected character 'q' found."],
        ["json", '"abc\n\n', "2:2 Unexpected end of input found."],
        ["json", `${noBreakSpace}1`, `1:1 Unexpected character '${noBreakSpace}' found.`],
        ["jsonc", '{"a":1,} // c', "1:8 Unexpected token RBrace found."],
        ["jsonc", "/* c", "1:5 Unexpected end of input found."],
        ["jsonc", "[1, // c\n", "1:5 Unexpected token LineComment found."],
        ["jsonc", "{a:1}", "1:2 Unexpected character 'a' found."],
        ["json5", "{true:1}", "1:2 Unexpected token Boolean found."],
        ["json5", "-.5", "1:1 Unexpected character '.' found."],
        ["json5", "0x", `1:3 Unexpected character '${noCharacter}' found.`],
        ["json5", "[,]", "1:2 Unexpected token Comma found."],
        ["json5", "{a-b:1}", "1:3 Unexpected character 'b' found."],
      ];
      const files = cases.map(([language, text], i) => [`${String(i).padStart(2, "0")}.${language}`, text]);
      const result = await lint({ ...json, ...Object.fromEntries(files) }, ["-f", "json", "."]);
      expect(summary(result.raw).split("\n")).toEqual(
        cases.map(([, , expected], i) => {
          const [place, ...message] = expected.split(" ");
          return `${files[i][0]}: ${place} null Parsing error: ${message.join(" ")} [fatal]`;
        }),
      );
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "what only JSON5 has is read in JSON5",
    async () => {
      const text = `// c\n{ a: +1, b: .5, c: 5., d: 0xF, e: -Infinity, f: NaN, g: 'a\\\nb', "h": "\\x41\\v\\0", $_: [1,], NaN: 1, ${noBreakSpace}}\n`;
      const result = await lint({ ...json, "a.json5": text }, ["-f", "json", "."]);
      expect(summary(result.raw)).toBe("");
      expect(result.exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "comments disable and configure rules in JSONC and JSON5",
    async () => {
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
    },
    timeout,
  );

  test(
    "--fix removes a comment that disables nothing, after a byte order mark too",
    async () => {
      const files = { "a.jsonc": `${mark}{ "é": 1 /* eslint-disable-line */ }\n` };
      const result = await lint({ ...json, ...files }, ["--fix", "."], ["a.jsonc"]);
      expect(result.files).toEqual({ "a.jsonc": `${mark}{ "é": 1   }\n` });
      expect(result.exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "noInlineConfig, --no-inline-config and --report-unused-disable-directives-severity",
    async () => {
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
    },
    timeout,
  );

  test(
    "languageOptions are those of the language",
    async () => {
      const files = (options: string) => ({
        ...jsonPackage(),
        "eslint.config.mjs": jsonConfig(`{ files: ["**/*.jsonc", "x.json"], languageOptions: ${options} }`),
        "a.jsonc": '{ "a": [1,], }',
        "x.json": "{}",
      });
      const [allowed, printed, refused, wrong, elsewhere] = await Promise.all([
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
      expect(summary(refused.raw)).toBe("a.jsonc: 1:11 null Parsing error: Unexpected token RBracket found. [fatal]");
      expect(wrong.stderr).toContain('Key "languageOptions": allowTrailingCommas must be a boolean if provided.');
      expect(wrong.exitCode).toBe(2);
      expect(elsewhere.stderr).toContain(
        'Key "languageOptions": allowTrailingCommas option is only available in JSONC.',
      );
      expect(elsewhere.exitCode).toBe(2);
    },
    timeout,
  );

  test(
    "--stdin, and a format that shows the code",
    async () => {
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
    },
    timeout,
  );

  test(
    "--doctor counts the files and the rules as native",
    async () => {
      const files = { ...json, "package.json": "{}", "a.jsonc": "{}", "b.js": "" };
      const result = await lint(files, ["--doctor", "-f", "json"]);
      const { rules, ...rest } = JSON.parse(result.raw);
      expect(rest.files.linted).toBe(4);
      expect(JSON.stringify(rest.files)).not.toContain("json");
      expect(rules.native).toEqual(["json/no-duplicate-keys"]);
      expect(rules.javascript).toEqual({});
    },
    timeout,
  );

  test(
    "a block in JSON that a processor finds is linted here",
    async () => {
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
    },
    timeout,
  );

  test(
    "a rule for JSON does not take a file in JavaScript",
    async () => {
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
    },
    timeout,
  );

  // ESLint makes the same prefix of its name.
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
  ])(
    "eslint-plugin-json is a package like any other, named by %s",
    async (_, files, args) => {
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
    },
    timeout,
  );

  // Nothing that works with the package stops working.
  describe("the whole file goes to the package eslint", () => {
    const own = {
      "own.mjs": `export default { rules: { seen: { create: context => ({ Line: () => context.report({ line: 1, message: "own" }) }) } } };`,
    };
    const withOwn = (more: string) =>
      jsonConfig(more).replace("export default", `import own from "./own.mjs";\n  export default`);
    const text = '{ "a": 1, "a": 2 }';
    test.each<[string, Record<string, string>, string[], string]>([
      [
        "a rule of the plugin that is not built in is on",
        { "eslint.config.mjs": jsonConfig(`{ files: ["*.json"], rules: { "json/only-in-the-package": "warn" } }`) },
        [],
        "the package: no-duplicate-keys, the package: only-in-the-package",
      ],
      [
        "a rule of another plugin is on",
        {
          ...own,
          "eslint.config.mjs": withOwn(`{ files: ["*.json"], plugins: { own }, rules: { "own/seen": "error" } }`),
        },
        [],
        "the package: no-duplicate-keys, own",
      ],
      ["--no-native-plugin-rules", {}, ["--no-native-plugin-rules"], "the package: no-duplicate-keys"],
      ["--native-plugin-rules names others", {}, ["--native-plugin-rules=import"], "the package: no-duplicate-keys"],
      ["another package has the prefix", jsonPackage("eslint-plugin-json"), [], "the package: no-duplicate-keys"],
    ])(
      "if %s",
      async (_, files, args, expected) => {
        const all = { ...eslintPackage, ...json, ...files, "a.json": text };
        const result = await lint(all, ["-f", "json", "--timing", ...args, "a.json"]);
        const messages = JSON.parse(result.raw)[0].messages.map((it: any) => it.message);
        expect(messages.join(", ")).toBe(expected);
        expect(result.stderr).toContain("the eslint package linted 1 files");
      },
      timeout,
    );

    test(
      "if a comment in it turns on a rule that is not built in",
      async () => {
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
      },
      timeout,
    );

    test(
      "which has to be installed",
      async () => {
        const config = jsonConfig(`{ files: ["a.json"], rules: { "json/only-in-the-package": "warn" } }`);
        const files = { ...json, "eslint.config.mjs": config, "a.json": text, "b.json": text };
        const result = await lint(files, ["-f", "unix", "."]);
        expect(result.stdout).toContain('b.json:1:11: Duplicate key "a" found. [Error/json/no-duplicate-keys]');
        expect(result.stderr).toContain("1 file was not linted");
        expect(result.stderr).toContain(
          "(1 *.json): a.json\n  To lint other languages, install eslint: bun add -d eslint",
        );
        expect(result.exitCode).toBe(2);
      },
      timeout,
    );
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
