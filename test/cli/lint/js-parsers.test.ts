import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, normalizeBunSnapshot, tempDir } from "harness";
import { chmodSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { endChildren, spawn } from "../children";
import scopesOfParser from "./oracle/svelte-scopes.expected.json";
import { cases as scopeCases, differences as scopeDifferences } from "./oracle/svelte-scopes.mjs";
import scopeWitnesses from "./oracle/svelte-scopes.witnesses.json";
import typesOrderExpected from "./oracle/types-order.expected.json";
import {
  linted as typesOrderLinted,
  projectFiles as typesOrderFiles,
  shown as typesOrderShown,
} from "./oracle/types-order.mjs";

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

async function lint(
  files: Record<string, string | Buffer>,
  args: string[],
  reads: string[] = [],
  variables: Record<string, string> = {},
  stdin?: string,
  before?: (dir: string) => void,
) {
  using dir = tempDir("bun-lint-js-parsers", files);
  before?.(String(dir));
  await using proc = spawn({
    cmd: [bunExe(), "lint", ...(args.includes("--threads") ? [] : ["--threads", "2"]), ...args],
    env: { ...env, ...variables },
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

// Components whose residual is typed go to several engines, the lanes: as many as fit into half of BUN_LINT_MEMORY when
// each takes 12 GB (`TYPED_LANE` in src/runtime/cli/lint_js.rs) next to 2 GiB for each other engine, at most 8 GiB
// here, and at most one per 16 components. This leaves `count` lanes. With 0 not even one fits, and the first engine
// lints them.
const lanes = (count: number) => ({ BUN_LINT_MEMORY: String(count ? 2 * (count * 12e9 + 11.4e9) : 2 ** 31) });

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
      verify(text, [config], { filename, disableFixes, ruleFilter = () => true }) {
        const [prefix, name] = (config.language ?? "@/js").split("/");
        const { ast, services } =
          prefix === "@"
            ? config.languageOptions.parser.parseForESLint(text, config.languageOptions.parserOptions)
            : config.plugins[prefix].languages[name].parse({ body: text, path: filename }, config);
        const messages = [];
        for (const [ruleId, [severity, ...options]] of Object.entries(config.rules)) {
          if (!ruleFilter({ ruleId, severity })) continue;
          const at = ruleId.indexOf("/");
          const [plugin, rule] = [ruleId.slice(0, at), ruleId.slice(at + 1)];
          const report = ({ line, message, fix }) =>
            messages.push({ ruleId, severity, message, line, column: 1, ...(fix && !disableFixes ? { fix } : {}) });
          config.plugins[plugin].rules[rule].create({ options, filename, settings: config.settings, sourceCode: { parserServices: services }, report }).Line?.(ast);
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

  // A language reads its own options, so there `parser` doesn't have to be a JavaScript parser.
  test(
    "so is a file in a language whose `parser` option is a name",
    async () => {
      // That `Linter` gets the config from a config array.
      const linter = eslintPackage["node_modules/eslint/index.js"]
        .replace("verify(text, [config], ", "verify(text, configs, ")
        .replace("const [prefix, name]", "const config = configs.getConfig(filename);\n        const [prefix, name]");
      const files = {
        ...eslintPackage,
        ...lines,
        "node_modules/eslint/index.js": linter,
        "node_modules/eslint/lib/config/flat-config-array.js": `
          exports.FlatConfigArray = class extends Array {
            constructor(configs) {
              super();
              this.push(...configs);
            }
            normalize() {}
            getConfig() {
              return this.reduce((merged, it) => ({ ...merged, ...it, rules: { ...merged.rules, ...it.rules } }), {});
            }
          };`,
        "eslint.config.mjs": `
          import lines from "./lines.mjs";
          export default [{ files: ["**/*.txt"], plugins: { lines }, language: "lines/text", languageOptions: { parser: "tabs", width: 4 }, settings: { name: "s" }, rules: { "lines/no-tabs": ["error", "o"] } }];`,
      };
      const result = await lint(files, ["-f", "json", "b.txt"]);
      expect(summary(result.raw)).toMatchInlineSnapshot(`
        "b.txt: 2:1 lines/no-tabs tab o 4 s b.txt [fix 4,5 " "]
        b.txt: 3:1 lines/no-tabs tab o 4 s b.txt [fix 10,11 " "] [suppressed: ]"
      `);
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
              lint(files, ["--stdin", "--stdin-filename", it.needy, "-f", "json"], [], {}, String(files[it.needy])),
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

// svelte-eslint-parser as the config knows it: by name. When the component is linted natively, nothing calls it. The
// `eslint` package, which lints what isn't linted natively, would.
const svelteParser = {
  ...eslintPackage,
  "node_modules/svelte-eslint-parser/package.json": JSON.stringify({
    name: "svelte-eslint-parser",
    version: "1.9.0",
    main: "index.js",
  }),
  "node_modules/svelte-eslint-parser/index.js": `
    module.exports = { meta: { name: "svelte-eslint-parser", version: "1.9.0" }, parseForESLint() { throw new Error("parsed in JavaScript"); } };`,
};

// A namespace that ESLint treats as @typescript-eslint/parser's.
const typescriptParser = {
  "node_modules/@typescript-eslint/parser/package.json": JSON.stringify({
    name: "@typescript-eslint/parser",
    version: "8.71.1",
    main: "index.js",
  }),
  "node_modules/@typescript-eslint/parser/index.js": `
    module.exports = { meta: { name: "typescript-eslint/parser", version: "8.71.1" }, parseForESLint() { throw new Error("parsed in JavaScript"); } };`,
};

function component(text: string, rules: Record<string, unknown>) {
  return {
    ...svelteParser,
    "eslint.config.mjs": `
      import parser from "svelte-eslint-parser";
      export default [{ files: ["**/*.svelte"], languageOptions: { parser }, rules: ${JSON.stringify(rules)} }];`,
    "a.svelte": text,
  };
}

// eslint-plugin-svelte with `rules`, the source of a rules object. ESLint runs its rules that have no native port on a
// component, on what svelte-eslint-parser reads, under any name a config gives the plugin.
function sveltePackage(rules: string) {
  return {
    "node_modules/eslint-plugin-svelte/package.json": JSON.stringify({
      name: "eslint-plugin-svelte",
      version: "3.23.1",
      main: "index.js",
    }),
    "node_modules/eslint-plugin-svelte/index.js": `
      module.exports = { meta: { name: "eslint-plugin-svelte", version: "3.23.1" }, rules: ${rules} };`,
  };
}

// The rule `local/shout`, which only ESLint runs: an eslint-plugin-svelte rule without a native port, on what
// svelte-eslint-parser reads, here the lines the fake `eslint` lints. It reports each line that says LOUD, and fixes
// it.
const shout = `{
  create: ({ report }) => ({
    Line({ lines }) {
      let start = 0;
      for (const [i, line] of lines.entries()) {
        const at = line.indexOf("LOUD");
        if (at !== -1) report({ line: i + 1, message: "Shouting.", fix: { range: [start + at, start + at + 4], text: "soft" } });
        start += line.length + 1;
      }
    },
  }),
}`;

function shouting(text: string, rules: Record<string, unknown>) {
  return {
    ...component(text, rules),
    ...sveltePackage(`{ shout: ${shout} }`),
    "node_modules/svelte-eslint-parser/index.js": `
      module.exports = { meta: { name: "svelte-eslint-parser", version: "1.9.0" }, parseForESLint: text => ({ ast: { lines: text.split("\\n") } }) };`,
    "eslint.config.mjs": `
      import parser from "svelte-eslint-parser";
      import local from "eslint-plugin-svelte";
      export default [{
        files: ["**/*.svelte"],
        languageOptions: { parser },
        plugins: { local },
        linterOptions: { reportUnusedDisableDirectives: "error" },
        rules: ${JSON.stringify(rules)},
      }];`,
  };
}

const shouted = `<script>
  // eslint-disable-next-line local/shout
  let a = "LOUD";
  let b = "LOUD" + c;
  // eslint-disable-next-line local/shout, no-undef
  let d = "LOUD" + e;
  // eslint-disable-next-line local/shout
  let f = 1;
</script>
<p>{a}{b}{d}{f}{g}</p>
`;

// `line:column` and the range each suggestion removes or replaces.
function suggested(json: string) {
  return JSON.parse(json).flatMap(({ messages }) =>
    messages.flatMap(it => (it.suggestions ?? []).map(s => `${it.line}:${it.column} ${s.fix.range}`)),
  );
}

// What ESLint 10 with svelte-eslint-parser 1.9 reports on each, and where it suggests changes.
describe.concurrent("bun lint with svelte-eslint-parser", () => {
  test(
    "lints a component natively, and says so",
    async () => {
      const text = "<script>\n  let a = 1;\n</script>\n<p>{a} {b}</p>\n";
      const result = await lint(component(text, { "no-undef": "error" }), ["-f", "json"], []);
      expect(summary(result.raw)).toBe("a.svelte: 4:9 no-undef 'b' is not defined.");
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "--print-config prints a parser nested in another parser's options as is",
    async () => {
      const files = {
        ...svelteParser,
        "eslint.config.mjs": `
          import parser from "svelte-eslint-parser";
          export default [{ languageOptions: { parserOptions: { parser: { ts: parser } } } }];`,
        "a.js": "",
      };
      const result = await lint(files, ["--print-config", "a.js"]);
      expect(JSON.parse(result.stdout).languageOptions.parserOptions.parser).toEqual({
        ts: {
          meta: { name: "svelte-eslint-parser", version: "1.9.0" },
          parseForESLint: { $unserializable: "function" },
        },
      });
      expect(result.exitCode).toBe(0);
    },
    timeout,
  );

  test.each([
    ["", ""],
    [
      ", and a later object leaves it out",
      '{ files: ["**/*.svelte"], languageOptions: { parserOptions: { parser: { ts: undefined } } } },',
    ],
    ...["{ meta: undefined }", "{ meta: { name: undefined } }", "{ meta: { version: undefined } }"].map(ts => [
      `, and a later object merges ${ts} into it`,
      `{ files: ["**/*.svelte"], languageOptions: { parserOptions: { parser: { ts: ${ts} } } } },`,
    ]),
  ])(
    "a script is TypeScript where the parser that its `lang` names is that of TypeScript, imported as a namespace%s",
    async (_, later) => {
      const files = {
        ...svelteParser,
        ...typescriptParser,
        "eslint.config.mjs": `
          import parser from "svelte-eslint-parser";
          import * as ts from "@typescript-eslint/parser";
          export default [
            { files: ["**/*.svelte"], languageOptions: { parser, parserOptions: { parser: { ts } } }, rules: { "prefer-const": "error" } },
            ${later}
          ];`,
        "a.svelte": '<script lang="ts">let x: number = 1;</script>{x}',
      };
      const result = await lint(files, ["-f", "json"], []);
      expect(summary(result.raw)).toBe(
        `a.svelte: 1:23 prefer-const 'x' is never reassigned. Use 'const' instead. [fix 18,36 "const x: number = 1;"]`,
      );
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  // typescript-estree 8.71 throws a `TSError`, which exposes its position through getters. ESLint 10.11 reads a parser
  // error's stack before them, as this `Linter` does. The positions are what ESLint on Node reports with the real
  // packages. A component reaches ESLint's parser where svelte-eslint-parser calls a function to decide whether it's in
  // runes mode.
  test.each([
    [
      "the whole configuration file",
      `{ files: ["**/*.svelte"], languageOptions: { parser: svelte, parserOptions: { parser: ts, svelteConfig: { compilerOptions: { runes: () => false } } } } }`,
      "a.svelte",
      '<script lang="ts">\n  const value: number = ;\n</script>\n',
      "a.svelte: 2:24 null Parsing error: Expression expected. [fatal]",
    ],
    [
      "a configuration made of what it says",
      `{ files: ["**/*.vue"], languageOptions: { parser: forExtraFiles } }`,
      "c.vue",
      "const ok = 1;\nconst value: number = ;\n",
      "c.vue: 2:22 null Parsing error: Expression expected. [fatal]",
    ],
  ])(
    "an error of a TypeScript parser in the installed ESLint is reported where it is, with %s",
    async (_, config, name, text, reported) => {
      const files = {
        ...svelteParser,
        "node_modules/eslint/lib/config/flat-config-array.js": `
          exports.FlatConfigArray = class extends Array {
            constructor(configs) {
              super();
              this.push(...configs);
            }
            normalize() {}
            getConfig() {
              return Object.assign({}, ...this);
            }
          };`,
        "node_modules/eslint/index.js": `
          const debug = () => {};
          exports.Linter = class {
            verify(text, configs, { filename }) {
              const { parser, parserOptions } = configs.getConfig(filename).languageOptions;
              try {
                parser.parseForESLint(text, parserOptions);
                return [];
              } catch (ex) {
                debug("%s\\n%s", ex.message, ex.stack);
                return [{ ruleId: null, fatal: true, severity: 2, message: "Parsing error: " + ex.message, line: ex.lineNumber, column: ex.column }];
              }
            }
            getSuppressedMessages() {
              return [];
            }
          };`,
        "node_modules/svelte-eslint-parser/index.js": `
          const parseForESLint = (text, options) => options.parser.parseForESLint(text, options);
          module.exports = { meta: { name: "svelte-eslint-parser", version: "1.9.0" }, parseForESLint };`,
        "node_modules/@typescript-eslint/parser/package.json": JSON.stringify({
          name: "@typescript-eslint/parser",
          version: "8.71.1",
          main: "index.js",
        }),
        "node_modules/@typescript-eslint/parser/index.js": `
          class TSError extends Error {
            fileName;
            location;
            name = "TSError";
            constructor(message, fileName, location) {
              super(message);
              this.fileName = fileName;
              this.location = location;
            }
            get lineNumber() {
              return this.location.start.line;
            }
            get column() {
              return this.location.start.column;
            }
          }
          // Where TypeScript expects an expression in these texts.
          function parseForESLint(text) {
            const offset = text.indexOf("= ;") + 2;
            const lines = text.slice(0, offset).split("\\n");
            const start = { column: lines.at(-1).length, line: lines.length, offset };
            throw new TSError("Expression expected.", "", { start, end: start });
          }
          module.exports = { meta: { name: "typescript-eslint/parser", version: "8.71.1" }, parseForESLint };`,
        // A parser that passes the text to typescript-eslint's, as typescript-eslint-parser-for-extra-files does.
        "for-extra-files.cjs": `
          const ts = require("@typescript-eslint/parser");
          const parseForESLint = (text, options) => ts.parseForESLint(text, options);
          module.exports = { meta: { name: "typescript-eslint-parser-for-extra-files" }, parseForESLint };`,
        "eslint.config.mjs": `
          import svelte from "svelte-eslint-parser";
          import ts from "@typescript-eslint/parser";
          import forExtraFiles from "./for-extra-files.cjs";
          export default [${config}];`,
        [name]: text,
      };
      const result = await lint(files, ["-f", "json", name]);
      expect(summary(result.raw)).toBe(reported);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "fixes a script in place",
    async () => {
      const text = "<p>{a}</p>\n<script>\n  let a = 1;\n</script>\n";
      const result = await lint(component(text, { "prefer-const": "error" }), ["--fix"], ["a.svelte"]);
      expect(result.files["a.svelte"]).toBe("<p>{a}</p>\n<script>\n  const a = 1;\n</script>\n");
      expect(result.exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "allows elements and blocks nested 2000 deep, whatever the innermost contains",
    async () => {
      const nested = (depth: number) => repeated("<div>", depth) + "{missing}" + repeated("</div>", depth);
      const files = { ...component("", { "no-undef": "error" }), "a.svelte": nested(2000), "b.svelte": nested(2001) };
      const result = await lint(files, ["-f", "json"], []);
      expect(summary(result.raw).split("\n").filter(Boolean)).toEqual([
        "a.svelte: 1:10002 no-undef 'missing' is not defined.",
        "b.svelte: 1:1 null Parsing error: The code is nested too deeply. [fatal]",
      ]);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  const declared = "<script>let x=1, p=Promise.resolve(1), items=[1];</script>";
  test.each([
    ["an arrow function without a body", "{((x)=>)}", "1:7 Unexpected token\nhttps://svelte.dev/e/js_parse_error"],
    ["an arrow function with an open body", "{((x)=>{)}", "1:8 Unexpected token\nhttps://svelte.dev/e/js_parse_error"],
    [
      "a shorthand property with a value in an object",
      "<script>let C;</script><C let:x={{\n foo = (()=>1)()\n}}>{foo}</C>",
      "2:5 Shorthand property assignments are valid only in destructuring patterns\nhttps://svelte.dev/e/js_parse_error",
    ],
    ["a shorthand property with a value in a pattern", "<script>let f = 1;</script>{(({a = 1}) => a)(f)}", ""],
    [
      "a type in JavaScript",
      `${declared}{((a: number) => a)(x)}`,
      "1:62 Unexpected token\nhttps://svelte.dev/e/js_parse_error",
    ],
    [
      "`satisfies` in JavaScript",
      `${declared}{x satisfies number}`,
      "1:61 Expected token }\nhttps://svelte.dev/e/expected_token",
    ],
    [
      "a script without an end",
      "<script>let x=1",
      "1:15 `<script>` was left open\nhttps://svelte.dev/e/element_unclosed",
    ],
    [
      "a script in an element without an end",
      "<div><script>let x=1",
      "1:20 Expected token </script>\nhttps://svelte.dev/e/expected_token",
    ],
    [
      "a style without an end",
      "<p>a</p><style>p {}",
      "1:19 Expected token </style\nhttps://svelte.dev/e/expected_token",
    ],
    [
      "an element without an end",
      "<p>a</p>\n<div class=a><p>a</p>",
      "2:0 `<div>` was left open\nhttps://svelte.dev/e/element_unclosed",
    ],
    ["a block without an end", "{#each [1] as a}{a}", "1:0 Block was left open\nhttps://svelte.dev/e/block_unclosed"],
    ["a tag without an end", "<p", "1:2 Unexpected end of input\nhttps://svelte.dev/e/unexpected_eof"],
    [
      "another context than the module",
      '<script context="bad">let a=1;</script>',
      '1:8 If the context attribute is supplied, its value must be "module"\nhttps://svelte.dev/e/script_invalid_context',
    ],
    [
      "an attribute twice",
      '<p a="x" a="y"></p>',
      "1:9 Attributes need to be unique\nhttps://svelte.dev/e/attribute_duplicate",
    ],
    [
      "a block that there is not",
      "{#wat a}{/wat}",
      "1:2 Expected 'if', 'each', 'await', 'key' or 'snippet'\nhttps://svelte.dev/e/expected_block_type",
    ],
    [
      "a dynamic component without `this`",
      "<svelte:component />",
      "1:0 `<svelte:component>` must have a 'this' attribute\nhttps://svelte.dev/e/svelte_component_missing_this",
    ],
    [
      "an option that there is not",
      "<svelte:options unknown={true} />",
      "1:16 `<svelte:options>` unknown attribute 'unknown'\nhttps://svelte.dev/e/svelte_options_unknown_attribute",
    ],
    [
      "a snippet rendered without a call",
      "{@render foo}",
      "1:9 `{@render ...}` tags can only contain call expressions\nhttps://svelte.dev/e/render_tag_invalid_expression",
    ],
    [
      "a block in a value, behind a comment that names a <textarea>",
      '<!-- <textarea> --><p a="{#if x}"></p>',
      "1:25 {#if ...} block cannot be in attribute value\nhttps://svelte.dev/e/block_invalid_placement",
    ],
    [
      "a block in a <textarea>",
      "<textarea>{#if x}{/if}</textarea>",
      "1:10 {#if ...} block cannot be inside <textarea>\nhttps://svelte.dev/e/block_invalid_placement",
    ],
    [
      "a tag in a <textarea>",
      "<textarea>a {@html x}</textarea>",
      "1:12 {@html ...} tag cannot be inside <textarea>\nhttps://svelte.dev/e/tag_invalid_placement",
    ],
    [
      "`{:else}` twice",
      "{#if x}{:else}{:else}{/if}",
      "1:15 {:else} cannot appear more than once within a block\nhttps://svelte.dev/e/block_duplicate_clause",
    ],
    [
      "two scripts at the top level",
      "<script>let a</script><script>let b</script>",
      "1:22 A component can have a single top-level `<script>` element and/or a single top-level `<script module>` element\nhttps://svelte.dev/e/script_duplicate",
    ],
    [
      "two styles at the top level",
      "<style></style><style></style>",
      "1:15 A component can have a single top-level `<style>` element\nhttps://svelte.dev/e/style_duplicate",
    ],
  ])(
    "what Svelte refuses is told in its words, where it is: %s",
    async (_, text, expected) => {
      const result = await lint(component(text, { "no-undef": "error" }), ["-f", "json"], []);
      const [{ messages }] = JSON.parse(result.raw);
      expect(
        messages.map(it => `${it.line}:${it.column} ${it.message.replace("Parsing error: ", "")}`).join("\n"),
      ).toBe(expected);
      expect(result.exitCode).toBe(expected ? 1 : 0);
    },
    timeout,
  );

  test(
    "a rule that only ESLint runs reports alongside the native rules, and the file's comments apply to all of them",
    async () => {
      const rules = { "no-undef": ["error"], "local/shout": ["error"] };
      const result = await lint(shouting(shouted, rules), ["-f", "json"], []);
      expect(summary(result.raw)).toMatchInlineSnapshot(`
        "a.svelte: 4:1 local/shout Shouting. [fix 80,84 "soft"]
        a.svelte: 4:20 no-undef 'c' is not defined.
        a.svelte: 7:3 null Unused eslint-disable directive (no problems were reported from 'local/shout'). [fix 167,206 " "]
        a.svelte: 10:17 no-undef 'g' is not defined.
        a.svelte: 3:1 local/shout Shouting. [fix 62,66 "soft"] [suppressed: ]
        a.svelte: 6:1 local/shout Shouting. [fix 154,158 "soft"] [suppressed: ]
        a.svelte: 6:20 no-undef 'e' is not defined. [suppressed: ]"
      `);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "fixes what the native rules and the rules that only ESLint runs report",
    async () => {
      const rules = { "no-undef": ["error"], "prefer-const": ["error"], "local/shout": ["error"] };
      const result = await lint(shouting(shouted, rules), ["--fix"], ["a.svelte"]);
      expect(result.files["a.svelte"]).toBe(
        shouted
          .replaceAll("let", "const")
          .replace('"LOUD" + c', '"soft" + c')
          .replace("  // eslint-disable-next-line local/shout\n  const f", "   \n  const f"),
      );
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  // `local/shout` is off. A comment in the file turns it on, and the fake `eslint` follows such comments, as ESLint
  // does.
  test.each([
    ["a component", "a.svelte", "<script>\n  /* eslint X */\n  let a = 'LOUD';\n</script>\n<p>{a}{b}</p>\n", "5:8"],
    ["a module of Svelte", "a.svelte.js", "/* eslint X */\nlet a = 'LOUD';\nexport const c = a + b;\n", "3:22"],
  ])(
    "a rule that only ESLint runs and that a comment turns on runs in %s, as do those here",
    async (_, name, written, undefinedAt) => {
      const text = written.replace("X", `"local/shout": "error", "no-undef": "error"`);
      const files = {
        ...shouting("", {}),
        "node_modules/eslint/index.js": `
          exports.Linter = class Linter {
            verify(text, [config], { ruleFilter }) {
              const { ast } = config.languageOptions.parser.parseForESLint(text);
              const rules = { ...config.rules };
              for (const [, given] of text.matchAll(/\\/\\* eslint (.*?) \\*\\//g)) Object.assign(rules, JSON.parse("{" + given + "}"));
              const messages = [];
              for (const [ruleId, setting] of Object.entries(rules)) {
                const [severity] = [setting].flat();
                if (severity === 0 || severity === "off" || !ruleFilter({ ruleId, severity })) continue;
                const [prefix, rule] = ruleId.split("/");
                const report = ({ line, message }) => messages.push({ ruleId, severity: 2, message, line, column: 1 });
                config.plugins[prefix].rules[rule].create({ report }).Line(ast);
              }
              return messages;
            }
            getSuppressedMessages() {
              return [];
            }
          };`,
        "eslint.config.mjs": `
          import parser from "svelte-eslint-parser";
          const shout = {
            create: ({ report }) => ({
              Line: ({ lines }) => lines.forEach((line, i) => line.includes("LOUD") && report({ line: i + 1, message: "Shouting." })),
            }),
          };
          export default [{
            files: ["**/*.svelte", "**/*.svelte.js"],
            languageOptions: { parser },
            plugins: { local: { rules: { shout } } },
            rules: { "local/shout": "off", "no-undef": "off" },
          }];`,
        [name]: text,
      };
      const result = await lint(files, ["-f", "json"], []);
      expect(summary(result.raw).split("\n")).toEqual([
        `${name}: ${name === "a.svelte" ? 3 : 2}:1 local/shout Shouting.`,
        `${name}: ${undefinedAt} no-undef 'b' is not defined.`,
      ]);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  // `local/options` is off with options, and reports them. A comment that only sets a severity turns it on with them,
  // as ESLint does. The fake `eslint` merges such comments as ESLint does.
  test.each([
    ["a configuration made of what it says", ""],
    ["the whole configuration file", "settings: { made: () => 1 },"],
  ])(
    "a rule that only ESLint runs and that a comment turns on keeps the options it is off with, with %s",
    async (_, more) => {
      const files = {
        ...shouting("", {}),
        "node_modules/eslint/index.js": `
          const severities = { off: 0, warn: 1, error: 2 };
          exports.Linter = class Linter {
            verify(text, [config], { ruleFilter }) {
              const { ast } = config.languageOptions.parser.parseForESLint(text);
              const rules = {};
              for (const [ruleId, setting] of Object.entries(config.rules)) rules[ruleId] = [setting].flat();
              for (const [, given] of text.matchAll(/\\/\\* eslint (.*?) \\*\\//g)) {
                for (const [ruleId, setting] of Object.entries(JSON.parse("{" + given + "}"))) {
                  const said = [setting].flat();
                  rules[ruleId] = said.length === 1 ? [said[0], ...(rules[ruleId] ?? []).slice(1)] : said;
                }
              }
              const messages = [];
              for (const [ruleId, [level, ...options]] of Object.entries(rules)) {
                const severity = severities[level] ?? level;
                if (severity === 0 || !ruleFilter({ ruleId, severity })) continue;
                const [prefix, rule] = ruleId.split("/");
                const report = ({ line, message }) => messages.push({ ruleId, severity, message, line, column: 1 });
                config.plugins[prefix].rules[rule].create({ options, report }).Line(ast);
              }
              return messages;
            }
            getSuppressedMessages() {
              return [];
            }
          };`,
        "eslint.config.mjs": `
          import parser from "svelte-eslint-parser";
          const options = {
            meta: { schema: [{ type: "object" }] },
            create: ({ options, report }) => ({ Line: () => report({ line: 1, message: JSON.stringify(options) }) }),
          };
          export default [{
            files: ["**/*.svelte"],
            languageOptions: { parser },
            ${more}
            plugins: { local: { rules: { options } } },
            rules: { "local/options": ["off", { allowReferrer: true }] },
          }];`,
        "a.svelte": `<script>/* eslint "local/options": "error" */</script><a href="x" target="_blank">x</a>`,
      };
      const result = await lint(files, ["-f", "json"], []);
      expect(summary(result.raw)).toBe(`a.svelte: 1:1 local/options [{"allowReferrer":true}]`);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "runes are globals in a Svelte module that svelte-eslint-parser reads",
    async () => {
      const files = {
        ...svelteParser,
        "eslint.config.mjs": `
          import parser from "svelte-eslint-parser";
          export default [{ files: ["**/*.svelte.ts"], languageOptions: { parser }, rules: { "no-undef": "error" } }];`,
        "a.svelte.ts":
          "export const count = $state(0);\nexport const double = $derived(count * 2);\n$effect(() => $nope);\n",
      };
      const result = await lint(files, ["-f", "json"]);
      expect(summary(result.raw)).toBe("a.svelte.ts: 3:15 no-undef '$nope' is not defined.");
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "lints a component from standard input",
    async () => {
      const files = component("", { "no-undef": "error" });
      const args = ["-f", "json", "--stdin", "--stdin-filename", "x.svelte"];
      const result = await lint(files, args, [], {}, "<script>\n  let a = 1;\n</script>\n<p>{a} {b}</p>\n");
      expect(summary(result.raw)).toBe("x.svelte: 4:9 no-undef 'b' is not defined.");
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "a rule that only ESLint runs gets what svelte-eslint-parser provides for a Svelte module",
    async () => {
      const files = {
        ...svelteParser,
        "node_modules/svelte-eslint-parser/index.js": `
          module.exports = {
            meta: { name: "svelte-eslint-parser", version: "1.9.0" },
            parseForESLint: text => ({ ast: { lines: text.split("\\n") }, services: { svelteParseContext: { runes: true } } }),
          };`,
        "eslint.config.mjs": `
          import parser from "svelte-eslint-parser";
          const tell = {
            create: ({ report, sourceCode }) => ({
              Line({ lines }) {
                for (const [i, line] of lines.entries()) {
                  if (line.includes('"tell"')) report({ line: i + 1, message: JSON.stringify(sourceCode.parserServices.svelteParseContext) });
                }
              },
            }),
          };
          export default [{
            files: ["**/*.svelte.js"],
            languageOptions: { parser },
            plugins: { local: { rules: { tell } } },
            rules: { "local/tell": "error", "no-undef": "error" },
          }];`,
        "a.svelte.js":
          '// eslint-disable-next-line local/tell\nlet a = "tell";\nlet b = "tell" + $nope;\nexport const c = $state(a + b);\n',
      };
      const result = await lint(files, ["-f", "json"]);
      expect(summary(result.raw).split("\n").filter(Boolean)).toEqual([
        'a.svelte.js: 3:1 local/tell {"runes":true}',
        "a.svelte.js: 3:18 no-undef '$nope' is not defined.",
        'a.svelte.js: 2:1 local/tell {"runes":true} [suppressed: ]',
      ]);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "an eslint-plugin-svelte rule that reads types runs where types are available",
    async () => {
      const rule = "@typescript-eslint/no-unnecessary-condition";
      const says = `({ report, sourceCode }) => ({ Line: () => report({ line: 1, message: sourceCode.parserServices.program ? "with a program" : "without a program" }) })`;
      const files = {
        ...shouting("<script>let a = 1;</script>{a}", {}),
        ...sveltePackage(`{ "${rule}": { create: ${says} } }`),
        // It creates a program when asked to, as typescript-eslint's parser does.
        "node_modules/svelte-eslint-parser/index.js": `
          module.exports = {
            meta: { name: "svelte-eslint-parser", version: "1.9.0" },
            parseForESLint: (text, options) => ({ ast: { lines: text.split("\\n") }, services: options.projectService ? { program: {} } : {} }),
          };`,
        "eslint.config.mjs": `
          import parser from "svelte-eslint-parser";
          import svelte from "eslint-plugin-svelte";
          export default [{
            files: ["**/*.svelte"],
            languageOptions: { parser, parserOptions: { projectService: true } },
            plugins: { svelte },
            rules: { "svelte/${rule}": "error" },
          }];`,
      };
      const result = await lint(files, ["-f", "json"]);
      expect(summary(result.raw)).toBe(`a.svelte: 1:1 svelte/${rule} with a program`);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  // The eslint-plugin-svelte package under another prefix, and a parser that creates a program when asked to, as
  // typescript-eslint's does. Each rule says whether it got one.
  test.each([
    ["one that reads types, under another prefix, is given them", "sv/require-event-prefix", "with a program", 1],
    ["one that reads none is not", "sv/no-inline-styles", "without a program", 0],
  ])(
    "of the rules of eslint-plugin-svelte, %s",
    async (_, rule, reported, typed) => {
      const says = `({ report, sourceCode }) => ({ Line: () => report({ line: 1, message: sourceCode.parserServices.program ? "with a program" : "without a program" }) })`;
      const files = {
        ...svelteParser,
        "node_modules/eslint/lib/config/flat-config-array.js": `
          exports.FlatConfigArray = class extends Array {
            constructor(configs) {
              super();
              this.push(...configs);
            }
            normalize() {}
            getConfig() {
              return Object.assign({}, ...this);
            }
          };`,
        "node_modules/eslint/index.js": `
          exports.Linter = class {
            verify(text, configs, { filename, ruleFilter }) {
              const config = configs.getConfig(filename);
              const { parser, parserOptions } = config.languageOptions;
              const { ast, services } = parser.parseForESLint(text, parserOptions);
              const messages = [];
              for (const [ruleId, setting] of Object.entries(config.rules)) {
                const [severity] = [setting].flat();
                if (!ruleFilter({ ruleId, severity })) continue;
                const [prefix, name] = ruleId.split("/");
                const report = ({ line, message }) => messages.push({ ruleId, severity: 2, message, line, column: 1 });
                config.plugins[prefix].rules[name].create({ sourceCode: { parserServices: services }, report }).Line(ast);
              }
              return messages;
            }
            getSuppressedMessages() {
              return [];
            }
          };`,
        "node_modules/svelte-eslint-parser/index.js": `
          module.exports = {
            meta: { name: "svelte-eslint-parser", version: "1.9.0" },
            parseForESLint: (text, options) => ({ ast: {}, services: options.projectService ? { program: {} } : {} }),
          };`,
        "node_modules/eslint-plugin-svelte/package.json": JSON.stringify({
          name: "eslint-plugin-svelte",
          version: "3.23.1",
          main: "index.js",
        }),
        "node_modules/eslint-plugin-svelte/index.js": `
          module.exports = {
            meta: { name: "eslint-plugin-svelte", version: "3.23.1" },
            rules: { "require-event-prefix": { create: ${says} }, "no-inline-styles": { create: ${says} } },
          };`,
        "eslint.config.mjs": `
          import parser from "svelte-eslint-parser";
          import svelte from "eslint-plugin-svelte";
          export default [{
            files: ["**/*.svelte"],
            languageOptions: { parser, parserOptions: { projectService: true } },
            plugins: { sv: svelte },
            rules: { "${rule}": "error" },
          }];`,
        "a.svelte": "<script>let a = 1;</script>{a}",
      };
      const result = await lint(files, ["-f", "json"], []);
      expect(summary(result.raw)).toBe(`a.svelte: 1:1 ${rule} ${reported}`);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  // Where `local/require-event-prefix` records the engines that lint `name`, and which engines those were for each of
  // `names`.
  const markOf = (name: string) => `marks/${name.replace("/", "-")}`;
  const realmsOf = (result: { files: Record<string, string> }, names: string[]) =>
    names.map(name => result.files[markOf(name)].split("\n").filter(Boolean));

  // `local/require-event-prefix`, an eslint-plugin-svelte rule that reads types and has no native port: ESLint runs it
  // with types on `typed/*.svelte`, without types on `untyped/*.svelte`, and not at all on `native/*.svelte`. Each
  // time, it records the engine in `marks/`. It reports the first `XX` and fixes it to `X`, so each `--fix` pass has
  // another one. In `meet-a.svelte` it waits until `meet-b.svelte` arrives, and the other way round, for no longer than
  // its option says, in milliseconds. `more` holds more config objects.
  function typedComponents(names: string[], wait: number, more = "") {
    const files: Record<string, string> = {
      ...shouting("", {}),
      ...sveltePackage(`{
        "require-event-prefix": {
          create: ({ report, filename, options: [wait] }) => ({
            Line({ lines }) {
              const [directory, name] = filename.split(/[\\\\/]/).slice(-2);
              appendFileSync("marks/" + directory + "-" + name, realm + "\\n");
              if (name.startsWith("meet-")) {
                const other = "marks/" + directory + "-" + (name === "meet-a.svelte" ? "meet-b.svelte" : "meet-a.svelte");
                const [until, pause] = [Date.now() + wait, new Int32Array(new SharedArrayBuffer(4))];
                while (!existsSync(other) && Date.now() < until) Atomics.wait(pause, 0, 0, 5);
                report({ line: 1, message: existsSync(other) ? "Met." : "Alone." });
              }
              let start = 0;
              for (const [i, line] of lines.entries()) {
                const at = line.indexOf("XX");
                if (at !== -1) return report({ line: i + 1, message: "Shrink.", fix: { range: [start + at, start + at + 2], text: "X" } });
                start += line.length + 1;
              }
            },
          }),
        },
      }`),
      "marks/.keep": "",
      "eslint.config.mjs": `
        import parser from "svelte-eslint-parser";
        import local from "eslint-plugin-svelte";
        import { readdirSync, writeFileSync } from "node:fs";
        const realm = Math.random();
        export default [
          { files: ["**/*.svelte"], languageOptions: { parser }, plugins: { local }, rules: { "no-undef": "error" } },
          { files: ["untyped/*.svelte", "typed/*.svelte"], rules: { "local/require-event-prefix": ["error", ${wait}] } },
          { files: ["typed/*.svelte"], languageOptions: { parser, parserOptions: { projectService: true } } },
          ${more}
        ];`,
    };
    files["node_modules/eslint-plugin-svelte/index.js"] =
      'const { appendFileSync, existsSync } = require("node:fs");\nconst realm = Math.random();\n' +
      files["node_modules/eslint-plugin-svelte/index.js"];
    delete files["a.svelte"];
    for (const name of names) files[name] = '<script>\n  let a = "XXXX";\n</script>\n<p>{a}{b}</p>\n';
    return files;
  }

  // Each result with its path relative to the run's directory.
  const outputOf = (raw: string) =>
    JSON.parse(raw).map((it: any) => ({
      ...it,
      filePath: it.filePath.replaceAll("\\", "/").split("/").slice(-2).join("/"),
    }));

  // How long the meeting components wait for each other: long enough for a slow machine, short enough that a missing
  // lane shows as "Alone." before the test times out.
  const rendezvous = timeout / 4;

  test.concurrent(
    "typed components are linted on several engines at once",
    async () => {
      const names = ["typed/meet-a.svelte", "typed/meet-b.svelte"];
      for (let i = 0; i < 30; i++) names.push(`typed/${i}.svelte`);
      const reads = names.map(markOf);
      const files = (wait: number) => {
        const files = typedComponents(names, wait);
        // The two meeting components are the largest, so the first two lanes take them first, `meet-a.svelte` first.
        files["typed/meet-a.svelte"] += "<!-- the largest of all -->\n";
        files["typed/meet-b.svelte"] += "<!-- the second -->\n";
        return files;
      };
      const met = (raw: string) =>
        summary(raw)
          .split("\n")
          .filter(it => / (Met|Alone)\.$/.test(it));
      const result = await lint(files(rendezvous), ["-f", "json", "--threads", "4", "typed"], reads, lanes(4));
      expect(met(result.raw)).toEqual([
        "meet-a.svelte: 1:1 local/require-event-prefix Met.",
        "meet-b.svelte: 1:1 local/require-event-prefix Met.",
      ]);
      expect(new Set(realmsOf(result, names).flat()).size).toBe(2);
      expect(result.exitCode).toBe(1);
      // With one lane, the first component waits in vain, and that lane lints them all.
      const alone = await lint(files(200), ["-f", "json", "--threads", "4", "typed"], reads, lanes(0));
      expect(met(alone.raw)).toEqual([
        "meet-a.svelte: 1:1 local/require-event-prefix Alone.",
        "meet-b.svelte: 1:1 local/require-event-prefix Met.",
      ]);
      expect(new Set(realmsOf(alone, names).flat()).size).toBe(1);
      expect(alone.exitCode).toBe(1);
    },
    timeout,
  );

  test.concurrent(
    "the output is the same on any number of lanes, and each file is linted once",
    async () => {
      const names = ["native/0.svelte", "native/1.svelte", "native/2.svelte"];
      for (let i = 0; i < 6; i++) names.push(`untyped/${i}.svelte`);
      const typed: string[] = [];
      for (let i = 0; i < 64; i++) typed.push(`typed/${i}.svelte`);
      const files = typedComponents([...names, ...typed], 0);
      // A typed one that the first engine lints along with the heavy files.
      files["typed/large.svelte"] = files["typed/0.svelte"] + "<!--" + Buffer.alloc(300_000, "x").toString() + "-->\n";
      const reads = typed.map(markOf);
      const run = async (threads: number, count: number) => {
        const result = await lint(
          files,
          ["-f", "json", "--threads", String(threads), "native", "untyped", "typed"],
          reads,
          lanes(count),
        );
        expect(result.exitCode).toBe(1);
        return { output: outputOf(result.raw), realms: realmsOf(result, typed) };
      };
      const runs = await Promise.all([run(4, 1), run(4, 2), run(4, 4), run(1, 4)]);
      expect(runs[0].output.map((it: any) => it.filePath)).toEqual([...names, ...typed, "typed/large.svelte"].sort());
      const first = runs[0].output.filter((it: any) => it.filePath === "typed/0.svelte");
      expect(summary(JSON.stringify(first)).split("\n")).toEqual([
        '0.svelte: 2:1 local/require-event-prefix Shrink. [fix 20,22 "X"]',
        "0.svelte: 4:8 no-undef 'b' is not defined.",
      ]);
      for (const { output } of runs.slice(1)) expect(output).toEqual(runs[0].output);
      // Each typed file is linted once, by no more engines than there are lanes.
      for (const [i, { realms }] of runs.entries()) {
        expect(realms.map(it => it.length)).toEqual(typed.map(() => 1));
        expect(new Set(realms.flat()).size).toBeLessThanOrEqual([1, 2, 4, 1][i]);
      }
      expect(new Set(runs[0].realms.flat()).size).toBe(1);
    },
    timeout,
  );

  test.concurrent(
    "--fix writes the same files on any number of lanes, and each file keeps its engine through all passes",
    async () => {
      const names: string[] = [];
      for (let i = 0; i < 49; i++) names.push(`typed/${i}.svelte`);
      const reads = [...names, ...names.map(markOf)];
      const run = (count: number) =>
        lint(typedComponents(names, 0), ["--fix", "-f", "json", "--threads", "4", "typed"], reads, lanes(count));
      const counts = [1, 2, 4];
      const runs = await Promise.all(counts.map(run));
      for (const [i, result] of runs.entries()) {
        const realms = realmsOf(result, names);
        for (const [j, name] of names.entries()) {
          expect(result.files[name]).toBe('<script>\n  let a = "X";\n</script>\n<p>{a}{b}</p>\n');
          // Three passes that fix, and one that finds nothing more.
          expect([realms[j].length, new Set(realms[j]).size]).toEqual([4, 1]);
        }
        expect(new Set(realms.flat()).size).toBeLessThanOrEqual(counts[i]);
        expect(result.exitCode).toBe(1);
      }
      expect(outputOf(runs[1].raw)).toEqual(outputOf(runs[0].raw));
      expect(outputOf(runs[2].raw)).toEqual(outputOf(runs[0].raw));
    },
    timeout,
  );

  test.concurrent(
    "components whose comments turn on a rule that may read types are only linted on the lanes",
    async () => {
      // `audit/audit`, from a plugin that may read types, is off, and a comment in each `inline/*.svelte` turns it on.
      const audit = `{
        files: ["inline/*.svelte"],
        languageOptions: { parser, parserOptions: { projectService: true } },
        plugins: { audit: { rules: { audit: { create: () => ({}) } } } },
        rules: { "audit/audit": "off" },
      },`;
      const files = typedComponents(["typed/0.svelte", "typed/1.svelte"], 0, audit);
      // Each time the parser is asked for a program, it records the engine.
      files["node_modules/svelte-eslint-parser/index.js"] = `
        const { appendFileSync } = require("node:fs");
        const realm = Math.random();
        module.exports = {
          meta: { name: "svelte-eslint-parser", version: "1.9.0" },
          parseForESLint(text, options) {
            if (options?.projectService) appendFileSync("marks/programs", realm + "\\n");
            return { ast: { lines: text.split("\\n") }, services: {} };
          },
        };`;
      // Large enough to be worth more than one engine.
      const text = `<script>\n  /* eslint audit/audit: error */\n  let a = 1;\n</script>\n<p>{a}</p>\n<!--${Buffer.alloc(200_000, "x")}-->\n`;
      for (let i = 0; i < 30; i++) files[`inline/${i}.svelte`] = text;
      const args = ["-f", "json", "--threads", "4", "typed", "inline"];
      // 32 typed components: two lanes.
      const result = await lint(files, args, ["marks/programs"], lanes(4));
      const programs = result.files["marks/programs"].split("\n").filter(Boolean);
      expect(programs.length).toBe(32);
      expect(new Set(programs).size).toBeLessThanOrEqual(2);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  test.concurrent(
    "typed components are linted on several engines when an earlier phase already started the maximum number",
    async () => {
      // `ts/*.ts` are linted with types first. The first one on each engine waits until three engines have one, so all
      // the engines `--threads 3` allows are started by then.
      const earlier = `{
        files: ["ts/*.ts"],
        plugins: {
          early: { rules: { engines: { create: () => ({ Program() {
            if (globalThis.hasWaited) return;
            globalThis.hasWaited = true;
            writeFileSync("engines/" + realm, "");
            const [until, pause] = [Date.now() + ${rendezvous}, new Int32Array(new SharedArrayBuffer(4))];
            while (readdirSync("engines").length < 4 && Date.now() < until) Atomics.wait(pause, 0, 0, 5);
          } }) } } },
          "@typescript-eslint": { meta: { name: "@typescript-eslint/eslint-plugin" } },
        },
        languageOptions: { parser: { meta: { name: "typescript-eslint/parser" } }, parserOptions: { projectService: true } },
        rules: { "early/engines": "error", "@typescript-eslint/no-floating-promises": "error" },
      },`;
      const names = ["typed/meet-a.svelte", "typed/meet-b.svelte"];
      for (let i = 0; i < 30; i++) names.push(`typed/${i}.svelte`);
      const files = typedComponents(names, rendezvous, earlier);
      files["typed/meet-a.svelte"] += "<!-- the largest of all -->\n";
      files["typed/meet-b.svelte"] += "<!-- the second -->\n";
      files["engines/.keep"] = "";
      files["tsconfig.json"] = JSON.stringify({ compilerOptions: { noLib: true, types: [] } });
      // 24 files of 250 KB, enough to be worth three engines.
      for (let i = 0; i < 24; i++) files[`ts/${i}.ts`] = `foo;\n/*${Buffer.alloc(250_000, "x")}*/\n`;
      const args = ["-f", "json", "--timing", "--threads", "3", "typed", "ts"];
      const result = await lint(files, args, [], lanes(4));
      const met = summary(result.raw)
        .split("\n")
        .filter(it => / (Met|Alone)\.$/.test(it));
      expect(met).toEqual([
        "meet-a.svelte: 1:1 local/require-event-prefix Met.",
        "meet-b.svelte: 1:1 local/require-event-prefix Met.",
      ]);
      expect(result.stderr).toContain("JavaScript: 3 engines");
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  test.each([
    [
      "a name in the markup reads the variable, and a block declares what it names",
      "<script>\n  let used = 1;\n  let unused = 2;\n</script>\n{#each [used] as item}\n  <p>x</p>\n{/each}\n",
      { "no-unused-vars": "error" },
      [
        "a.svelte: 3:7 no-unused-vars 'unused' is assigned a value but never used. [1 suggestion]",
        "a.svelte: 5:18 no-unused-vars 'item' is defined but never used. [1 suggestion]",
      ],
      ["3:7 27,42", "5:18 70,74"],
    ],
    [
      "a store's `$x` reads `x` where it is written, also in a function",
      '<script>\n  import { writable } from "svelte/store";\n  let a = writable(1);\n  a = writable(2);\n  const b = writable(3);\n  let c = writable(4);\n  c = writable(5);\n  function f() { return $c; }\n</script>\n<p>{$a}{$b}</p>{f()}\n',
      { "no-useless-assignment": "error" },
      ["a.svelte: 3:7 no-useless-assignment The value assigned to 'a' is not used in subsequent statements."],
      [],
    ],
    [
      "a store's `$x` in the markup before the script reads `x` before it is written",
      '<p>{$d}</p>\n<script>\n  import { writable } from "svelte/store";\n  const d = writable(1);\n</script>\n',
      { "no-useless-assignment": "error" },
      ["a.svelte: 4:9 no-useless-assignment The value assigned to 'd' is not used in subsequent statements."],
      [],
    ],
    [
      // svelte-eslint-parser makes every `$x` a read-only reference to `x`, even where it assigns, and has no `$x`
      // variable.
      "a store's `$x` that is assigned or updated reads `x`, and is no variable",
      '<script>\n  import { writable } from "svelte/store";\n  let a = writable(0);\n  $a = 1;\n  a = writable(2);\n  let b = writable(0);\n  $b += 1;\n  b = writable(2);\n  let c = writable(0);\n  $c++;\n  c = writable(2);\n  let d = writable(0);\n  ++$d;\n  d = writable(2);\n  let e = writable(0);\n  e = writable(1);\n  $e = 2;\n  console.log(a, b, c, d, e);\n</script>\n',
      { "no-useless-assignment": "error" },
      ["a.svelte: 15:7 no-useless-assignment The value assigned to 'e' is not used in subsequent statements."],
      [],
    ],
    [
      // A markup block isn't a function, so its contents are in the component's code path.
      "an assignment in an `{#each}` is in the code path of the component",
      "<script>\n  let { items } = $props();\n  let n = 0;\n</script>\n\n{#each items as x (x)}\n  <p data-n={n++}>{x}</p>\n{/each}\n",
      { "no-useless-assignment": "error" },
      ["a.svelte: 7:14 no-useless-assignment The value assigned to 'n' is not used in subsequent statements."],
      [],
    ],
    [
      // Loops in `$:` statements are in the component's code path like any other.
      "a loop in a `$:` statement can repeat",
      "<script>\n  export let rows = []\n  $: {\n    for (let i = 0; i < rows.length; i++) {\n      rows[i] = String(rows[i])\n    }\n  }\n  $: for (const row of rows) {\n    console.log(row)\n  }\n</script>\n",
      { "no-unreachable-loop": "error" },
      [],
      [],
    ],
    [
      "the markup is tokens: the `>` of `<script>` keeps a declaration from being removed",
      "<script>\n  let unused = 1;\n</script>\n{#each [1] as item}{/each}\n",
      { "no-unused-vars": "error" },
      [
        "a.svelte: 2:7 no-unused-vars 'unused' is assigned a value but never used.",
        "a.svelte: 4:15 no-unused-vars 'item' is defined but never used. [1 suggestion]",
      ],
      ["4:15 51,55"],
    ],
    [
      "`bind:` writes the name that it binds, but assigns nothing",
      '<script>\n  import imported from "./a.js";\n  let x;\n</script>\n<input bind:value={imported} />\n<input bind:value={x} />\n',
      { "no-import-assign": "error", "logical-assignment-operators": ["error", "never"] },
      ["a.svelte: 5:20 no-import-assign 'imported' is read-only."],
      [],
    ],
    [
      "the markup reads no variable of the script that it does not name",
      "<script>\n  let $$h = 1;\n</script>\n<p>{a}</p>\n",
      { "no-unused-vars": "error" },
      ["a.svelte: 2:7 no-unused-vars '$$h' is assigned a value but never used."],
      [],
    ],
    [
      "columns count UTF-16 code units after a byte order mark, and lines end with CRLF",
      '﻿<script>\r\n  let ä = 1;\r\n</script>\r\n<p title="é">{ä} {x} é {ü}</p>\r\n',
      { "no-undef": "error" },
      ["a.svelte: 4:19 no-undef 'x' is not defined.", "a.svelte: 4:25 no-undef 'ü' is not defined."],
      [],
    ],
    [
      "a comment in a script disables a rule for the next line",
      "<script>\n  // eslint-disable-next-line no-undef\n  foo;\n  bar;\n</script>\n",
      { "no-undef": "error" },
      ["a.svelte: 4:3 no-undef 'bar' is not defined.", "a.svelte: 3:3 no-undef 'foo' is not defined. [suppressed: ]"],
      [],
    ],
    [
      "what is reported about the code around the markup is not what a comment disables",
      "<script>\n  let a = 1;\n  /* eslint-disable no-undef */\n</script>\n<p>{a}</p>\n",
      { "no-undef": "error" },
      [
        `a.svelte: 3:3 null Unused eslint-disable directive (no problems were reported from 'no-undef'). [fix 24,53 " "]`,
      ],
      [],
    ],
    [
      "a handler in the markup is no callback",
      "<button on:click={function () { go(); }}>x</button>\n<script>\n  [1].map(function (x) { return x; });\n</script>\n",
      { "prefer-arrow-callback": "error" },
      ['a.svelte: 3:11 prefer-arrow-callback Unexpected function expression. [fix 71,83 "(x) =>"]'],
      [],
    ],
    [
      "a block is no callback either",
      "<script>\n  let xs = [1];\n  a(() => b(() => c()));\n</script>\n{#each xs as x}\n  <p on:click={() => xs.map(() => x)}>{x}</p>\n{/each}\n",
      { "max-nested-callbacks": ["error", 1] },
      ["a.svelte: 3:16 max-nested-callbacks Too many nested callbacks (2). Maximum allowed is 1."],
      [],
    ],
    [
      'the markup before a script does not keep its "use strict" from being a directive',
      '<div class={a}></div>\n<script>\n  "use strict";\n  let a = 1;\n</script>\n',
      { "no-unused-expressions": "error" },
      [],
      [],
    ],
    [
      "a message names a place in the component",
      "<p>{y}</p><script>let x = 1; let y = 2;</script>{#each [1] as x}{x}{/each}\n",
      { "no-shadow": "error" },
      ["a.svelte: 1:63 no-shadow 'x' is already declared in the upper scope on line 1 column 23."],
      [],
    ],
    [
      "markup and HTML comments are no comments",
      "<script>\n  let a = 1;\n</script>\n<p>{a} b</p>\n<!-- c d -->\n",
      { "no-irregular-whitespace": ["error", { skipComments: true }] },
      [
        "a.svelte: 4:7 no-irregular-whitespace Irregular whitespace not allowed.",
        "a.svelte: 5:7 no-irregular-whitespace Irregular whitespace not allowed.",
      ],
      [],
    ],
    [
      "a prop is the name that it spells, escaped or not",
      "<script>export let \\u0078=1;</script>{x}",
      { "prefer-const": "error", "no-unused-vars": "error" },
      [],
      [],
    ],
    [
      "a bindable prop is the name that it spells, escaped or not",
      "<script>let { x: \\u0079 = $bindable() } = $props();</script>",
      { "prefer-const": "error", "no-unused-vars": "error" },
      [],
      [],
    ],
    [
      "the last statement of a script ends before the markup",
      "<script>let x = 1</script>{x}",
      { "prefer-const": "error" },
      [`a.svelte: 1:13 prefer-const 'x' is never reassigned. Use 'const' instead. [fix 8,17 "const x = 1"]`],
      [],
    ],
    [
      "the last statement of a script ends before the markup after a line comment too",
      "<script>let x = 1 // end</script>\n<p>{x}</p>\n",
      { "prefer-const": "error" },
      [`a.svelte: 1:13 prefer-const 'x' is never reassigned. Use 'const' instead. [fix 8,24 "const x = 1 // end"]`],
      [],
    ],
    [
      "the last statement of a script that markup follows ends before the markup",
      '<script context="module">let a=1</script><p>{a}</p><script>\nlet b=2;\n</script>{b}',
      { "prefer-const": "error" },
      [
        `a.svelte: 1:30 prefer-const 'a' is never reassigned. Use 'const' instead. [fix 25,32 "const a=1"]`,
        `a.svelte: 2:5 prefer-const 'b' is never reassigned. Use 'const' instead. [fix 60,68 "const b=2;"]`,
      ],
      [],
    ],
    [
      "the last statement of a script that markup follows ends before a line comment that ends the script",
      '<script context="module">let a=1 // x</script><p>{a}</p><script>\nlet b=2;\n</script>{b}',
      { "prefer-const": "error" },
      [
        `a.svelte: 1:30 prefer-const 'a' is never reassigned. Use 'const' instead. [fix 25,32 "const a=1"]`,
        `a.svelte: 2:5 prefer-const 'b' is never reassigned. Use 'const' instead. [fix 65,73 "const b=2;"]`,
      ],
      [],
    ],
    [
      "the end of the last statement of a script is not in a line comment that ends its code",
      "<script>// eslint-disable-next-line no-constant-condition\n</script>{#if true}{/if}",
      { "no-constant-condition": "error" },
      [
        `a.svelte: 1:9 null Unused eslint-disable directive (no problems were reported from 'no-constant-condition'). [fix 8,57 " "]`,
      ],
      [],
    ],
    [
      "a component, an action and a style directive that are not named in ASCII read their variables",
      "<script>let Ä; let ä; let ö;</script>\n<Ä /><p use:ä style:ö></p>\n",
      { "no-unused-vars": "error" },
      [],
      [],
    ],
    [
      "a snippet that a component is given and nothing renders declares no variable",
      "<script>let x = 1; let C;</script>\n<C>{#snippet x()}hello{/snippet}</C>\n<p>{x}</p>\n",
      { "no-shadow": "error" },
      [],
      [],
    ],
    [
      "a line comment that ends a script reads as it is written",
      "<script>let x = 1; // foo*/bar</script>\n<p>{x}</p>\n",
      { "no-warning-comments": ["error", { terms: ["foo*/bar"] }] },
      ["a.svelte: 1:20 no-warning-comments Unexpected 'foo*/bar' comment: 'foo*/bar'."],
      [],
    ],
    [
      "a directive in a line comment that ends a script names its rules where they are written",
      "<script>let x = 1; // eslint-disable-line prefer-const -- foo*/bar</script>\n<p>{x}</p>\n",
      { "prefer-const": "error" },
      [
        `a.svelte: 1:13 prefer-const 'x' is never reassigned. Use 'const' instead. [fix 8,18 "const x = 1;"] [suppressed: foo*/bar]`,
      ],
      [],
    ],
    [
      "a fix writes a line comment that ends a script as it is written",
      "<script>let x=1 // TODO */</script>{x}{missing}",
      { "prefer-const": "error" },
      [`a.svelte: 1:13 prefer-const 'x' is never reassigned. Use 'const' instead. [fix 8,26 "const x=1 // TODO */"]`],
      [],
    ],
  ])(
    "%s",
    async (_, text, rules, reported, suggestions) => {
      const result = await lint(component(text, rules), ["-f", "json"], []);
      expect(summary(result.raw).split("\n").filter(Boolean)).toEqual(reported);
      expect(suggested(result.raw)).toEqual(suggestions);
      const errors = reported.filter(it => !it.includes(" null ") && !it.includes("[suppressed"));
      expect(result.exitCode).toBe(errors.length ? 1 : 0);
    },
    timeout,
  );

  // svelte-eslint-parser parses the scripts as one program, with whitespace for the markup between them and for a
  // script in the markup, before the markup's code. Each script has the statements that start and end in it. The last
  // script's `lang` decides how they're parsed.
  const unterminated = "null Parsing error: The script is unterminated [fatal]";
  const isNeverReassigned = "prefer-const 'x' is never reassigned. Use 'const' instead.";
  test.each([
    [
      "a script goes on into the next where markup without code is between them",
      '<script context="module">let a=1</script><p></p><script>let b=2;</script>{a+b}',
      "a.svelte: 1:57 null Parsing error: Unexpected token let [fatal]",
    ],
    [
      "a script goes on into the next where markup with code is between them",
      '<script context="module">let a=1</script><p>{a}</p><script>let b=2;</script>{b}',
      "a.svelte: 1:60 null Parsing error: Unexpected token let [fatal]",
    ],
    [
      "a statement that goes on into the next script is in none",
      '<script context="module">let a=foo</script><p>{a}</p><script>\n(bar);\n</script>{a}',
      `a.svelte: 2:6 ${unterminated}`,
    ],
    [
      "a `$:` statement that goes on into the next script is in none",
      '<script>const foo=x=>x;const bar=1;$: a=foo</script><p>{a}</p><script context="module">\n(bar);\n</script>',
      `a.svelte: 2:6 ${unterminated}`,
    ],
    [
      "a line comment at the end of a script takes the next one on the line",
      '<script context="module">let a=1 // x</script><p>{a}</p><script>let b=2;</script>{b}',
      `a.svelte: 1:72 ${unterminated}`,
    ],
    [
      "markup whose only code is what `let:` declares has code behind the scripts",
      '<script context="module">const a=1 // x</script><div let:item></div><script>const b=2;</script>',
      `a.svelte: 1:86 ${unterminated}`,
    ],
    [
      "markup behind both scripts whose only code is what `let:` declares has code behind them",
      '<script context="module">const a=1 // x</script><script>const b=2;</script><div let:item></div>',
      `a.svelte: 1:66 ${unterminated}`,
    ],
    [
      "a template that a `$:` statement does not close is not closed by markup",
      "<script>var a; $: a=`unterminated</script><p>`</p>",
      "a.svelte: 1:22 null Parsing error: Unterminated template [fatal]",
    ],
    [
      "an empty script behind another ends nothing",
      '<script>let x=1</script><p>{x}</p><script context="module"></script>',
      `a.svelte: 1:13 ${isNeverReassigned} [fix 8,15 "const x=1"]`,
    ],
    [
      "a script in the markup is no script",
      "<script>let x=1</script><div><script></script></div>{x}",
      `a.svelte: 1:13 ${isNeverReassigned} [fix 8,15 "const x=1"]`,
    ],
    [
      "a template that a script does not close is not closed by markup",
      "<script>const x=`unterminated</script><p>`</p>",
      "a.svelte: 1:18 null Parsing error: Unterminated template [fatal]",
    ],
    [
      "a comment that a script does not close is not closed by markup",
      "<script>let x=1; /* unterminated</script>{x}",
      "a.svelte: 1:18 null Parsing error: Unterminated comment [fatal]",
    ],
    [
      "the last script decides the parser: JavaScript",
      '<script lang="ts">let x:number=1;</script><p>{x}</p><script context="module" lang="js">const m=2;</script>{m}',
      "a.svelte: 1:24 null Parsing error: Unexpected token : [fatal]",
    ],
    [
      "a script in the markup decides the parser where it is the last: JavaScript",
      '<script lang="ts">let x:number=1;</script><div><script lang="js"></script></div>{x}',
      "a.svelte: 1:24 null Parsing error: Unexpected token : [fatal]",
    ],
    [
      "a script in the markup decides the parser where it is the last: TypeScript",
      '<script lang="js">let x:number=1;</script><div><script lang="ts"></script></div>{x}',
      `a.svelte: 1:23 ${isNeverReassigned} [fix 18,33 "const x:number=1;"]`,
    ],
    [
      "white space around the `=` of `lang` is no part of it",
      '<script lang= "ts">let x:number=1;</script>{x}',
      `a.svelte: 1:24 ${isNeverReassigned} [fix 19,34 "const x:number=1;"]`,
    ],
    [
      "white space around the `=` of `lang` of a script in the markup is no part of it",
      '<script lang="js">let x:number=1;</script><div><script lang = "ts"></script></div>{x}',
      `a.svelte: 1:23 ${isNeverReassigned} [fix 18,33 "const x:number=1;"]`,
    ],
    [
      "with TypeScript, the render function follows the scripts where the markup has no code",
      '<script lang="ts">const b=2</script><p></p>',
      "a.svelte: 1:43 null Parsing error: ',' expected. [fatal]",
    ],
    [
      "with TypeScript, the render function follows the last of the scripts",
      '<script context="module" lang="ts">const a=1;</script>\n<script lang="ts">const b=2</script>',
      "a.svelte: 2:36 null Parsing error: ',' expected. [fatal]",
    ],
    [
      "with TypeScript, a `$:` statement at the end of the scripts is a function before the render function",
      '<script lang="ts">let y=1;$: x=y</script><p></p>',
      `a.svelte: 1:23 prefer-const 'y' is never reassigned. Use 'const' instead. [fix 18,26 "const y=1;"]`,
    ],
    [
      "with TypeScript, a `$:` statement at the end of the scripts is a function where an empty script follows",
      '<script lang="ts">let y=1;$: x=y</script><script context="module"></script>',
      `a.svelte: 1:23 prefer-const 'y' is never reassigned. Use 'const' instead. [fix 18,26 "const y=1;"]`,
    ],
    [
      "the last script decides the parser: TypeScript",
      '<script context="module" lang="js">const m=2;</script><p>{m}</p><script lang="ts">let x:number=1;</script>{x}',
      `a.svelte: 1:87 ${isNeverReassigned} [fix 82,97 "const x:number=1;"]`,
    ],
  ])(
    "%s",
    async (_, text, reported) => {
      const files = {
        ...component(text, { "prefer-const": "error", "no-undef": "error" }),
        ...typescriptParser,
        "eslint.config.mjs": `
          import parser from "svelte-eslint-parser";
          import * as ts from "@typescript-eslint/parser";
          export default [
            { files: ["**/*.svelte"], languageOptions: { parser, parserOptions: { parser: { ts } } }, rules: { "prefer-const": "error", "no-undef": "error" } },
          ];`,
      };
      const result = await lint(files, ["-f", "json"], []);
      expect(summary(result.raw)).toBe(reported);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  // For svelte-eslint-parser a script's statements are in a `SvelteScriptElement`, not in the `Program`, so no-var's
  // `canFix` in ESLint doesn't accept them.
  test(
    "a `var` at the top of a script is reported without a fix",
    async () => {
      const text = "<script>var x = 1; console.log(x);</script>\n";
      const reported = "a.svelte: 1:9 no-var Unexpected var, use let or const instead.";
      const files = component(text, { "no-var": "error" });
      const linted = await lint(files, ["-f", "json"], []);
      expect(summary(linted.raw)).toBe(reported);
      expect(linted.exitCode).toBe(1);
      const fixed = await lint(files, ["--fix", "-f", "json"], ["a.svelte"]);
      expect(fixed.files["a.svelte"]).toBe(text);
      expect(summary(fixed.raw)).toBe(reported);
      expect(fixed.exitCode).toBe(1);
    },
    timeout,
  );

  // The same holds for the other rules that check whether a statement is in the `Program` or in a statement list, or
  // that look at the `Program`'s `body`. The expected reports are what ESLint 10.11 reports with svelte-eslint-parser
  // 1.9: for a statement in a block or a function, but not for the same statement at the top of the script.
  const inTypeScript = (text: string) => `<script lang="ts">${text}</script>`;
  test.each([
    [
      "prefer-const",
      "error",
      "<script>let x; x = 1; console.log(x); { let y; y = 1; console.log(y); }</script>",
      "a.svelte: 1:48 prefer-const 'y' is never reassigned. Use 'const' instead.",
    ],
    [
      "strict",
      "error",
      '<script>"use strict"; function f() { "use strict"; } f();</script>',
      `a.svelte: 1:38 strict 'use strict' is unnecessary inside of modules. [fix 37,50 ""]`,
    ],
    [
      "no-redeclare",
      "error",
      "<script>var a = 1; var a = 2; function f() { var b = 1; var b = 2; return b; } f(a);</script>",
      "a.svelte: 1:61 no-redeclare 'b' is already defined.",
    ],
    [
      "@typescript-eslint/no-redeclare",
      "error",
      inTypeScript("var a = 1; var a = 2; function f() { var b = 1; var b = 2; return b; } f(a);"),
      "a.svelte: 1:71 @typescript-eslint/no-redeclare 'b' is already defined.",
    ],
    [
      "no-lone-blocks",
      "error",
      "<script>{ { console.log(1); } }</script>",
      "a.svelte: 1:11 no-lone-blocks Nested block is redundant.",
    ],
    [
      "one-var",
      ["error", "never"],
      "<script>let a = 1, b = 2; { let c = 1, d = 2; console.log(c, d); } console.log(a, b);</script>",
      "a.svelte: 1:9 one-var Split 'let' declarations into multiple statements.\n" +
        `a.svelte: 1:29 one-var Split 'let' declarations into multiple statements. [fix 37,38 "; let"]`,
    ],
    [
      "no-console",
      "error",
      "<script>console.log(1); { console.log(2); }</script>",
      "a.svelte: 1:9 no-console Unexpected console statement.\n" +
        "a.svelte: 1:27 no-console Unexpected console statement. [1 suggestion]",
    ],
    [
      "vars-on-top",
      "error",
      "<script>var a = 1; function f() { var b = 1; return b; } f(a);</script>",
      "a.svelte: 1:9 vars-on-top All 'var' declarations must be at the top of the function scope.",
    ],
    [
      "no-inner-declarations",
      ["error", "both", { blockScopedFunctions: "disallow" }],
      "<script>var a = 1; function f() { var b = 2; return b; } export { f }; console.log(a);</script>",
      "a.svelte: 1:9 no-inner-declarations Move variable declaration to program root.\n" +
        "a.svelte: 1:20 no-inner-declarations Move function declaration to program root.",
    ],
    [
      "global-require",
      "error",
      "<script>const a = require('a'); console.log(a);</script>",
      "a.svelte: 1:19 global-require Unexpected require().",
    ],
    [
      "no-unused-labels",
      "error",
      '<script>A: "x";</script>',
      `a.svelte: 1:9 no-unused-labels 'A:' is defined but never used. [fix 8,11 ""]`,
    ],
    [
      "@typescript-eslint/adjacent-overload-signatures",
      "error",
      inTypeScript(
        "function f(a: string): void; function g() {} function f(a: number): void; function f(a: any) {} " +
          "{ function h(a: string): void; function k() {} function h(a: number): void; function h(a: any) {} k(); h(1); } g(); f(1);",
      ),
      "a.svelte: 1:162 @typescript-eslint/adjacent-overload-signatures All h signatures should be adjacent.",
    ],
    [
      "@typescript-eslint/unified-signatures",
      "error",
      inTypeScript(
        "function f(a: string): void; function f(a: number): void; function f(a: any) {} f(1); " +
          "namespace N { export function g(a: string): void; export function g(a: number): void; export function g(a: any) {} }",
      ),
      "a.svelte: 1:173 @typescript-eslint/unified-signatures These overloads can be combined into one signature taking `string | number`.",
    ],
    [
      "@typescript-eslint/no-useless-empty-export",
      "error",
      '<script lang="ts" module>export {}; export const a = 1;</script>',
      "",
    ],
  ])(
    "%s takes no statement of a script for one of the program",
    async (rule, setting, text, reported) => {
      const files = {
        ...component(`${text}\n`, {}),
        ...typescriptParser,
        "eslint.config.mjs": `
          import parser from "svelte-eslint-parser";
          import * as ts from "@typescript-eslint/parser";
          export default [{
            files: ["**/*.svelte"],
            languageOptions: { parser, parserOptions: { parser: { ts } } },
            plugins: { "@typescript-eslint": { meta: { name: "@typescript-eslint/eslint-plugin" } } },
            rules: ${JSON.stringify({ [rule]: setting })},
          }];`,
      };
      const result = await lint(files, ["-f", "json"], []);
      expect(summary(result.raw)).toBe(reported);
      expect(result.exitCode).toBe(reported ? 1 : 0);
    },
    timeout,
  );

  // If svelte-eslint-parser and Svelte read a block's start tag differently from here, ESLint lints the component.
  test.each([
    [
      "a value of `lang` that may be a mustache",
      '<script lang="ts">let x=1;</script><div><script lang="{a}t{s}"></script></div>{x}',
    ],
    [
      "a mustache that ends a value before its end",
      "<script>let x=1;</script><div><script src={s}ts></script></div>{x}",
    ],
    ["a mustache without its end", `<script>let x=1;</script><div><script src="{'a}"></script></div>{x}`],
    [
      "a mustache in the start tag of the style at the top level",
      "<script>let x=1;</script>{x}<style media={m}>p {}</style>",
    ],
    [
      "a mustache of more than a name",
      "<script>let x=1;</script><svelte:head><script src={new.target}></script></svelte:head>{x}",
    ],
    [
      "a quoted mustache of more than a name",
      `<script>let x=1;</script><svelte:head><script src="{new.target}"></script></svelte:head>{x}`,
    ],
    [
      "a mustache with a comment",
      `<script>let x=1;</script><svelte:head><script src="{({s:1})/* } */}"></script></svelte:head>{x}`,
    ],
    [
      "a mustache behind a space",
      `<script>let x=1;</script><svelte:head><script src=" {new.target}"></script></svelte:head>{x}`,
    ],
    ["a mustache behind text", `<script>let x=1;</script><svelte:head><script src="p{x}"></script></svelte:head>{x}`],
    [
      "an unquoted mustache behind text",
      "<script>let x=1;</script><svelte:head><script src=p{x}></script></svelte:head>{x}",
    ],
    [
      "a mustache behind text in a template with a script in it",
      `<script>let x=1;</script><template data-a="p{x}"><script></script>{x}</template>`,
    ],
    ["white space that is not ASCII", '<script lang=\u00a0"ts">let x=1;</script>{x}'],
    ["a block that closes itself", '<script lang="ts">let x=1;</script>{x}\n<style lang="css"/>'],
    ["`LANG` of a template", '<script>let x=1;</script><template LANG="pug">p</template>{x}'],
    [
      "a script at the top level that svelte-eslint-parser leaves in the markup",
      "{#if x}{/if}<script>let x=1;</script>",
    ],
    // Svelte's message for it names the clauses the block accepts.
    ["a clause that the block does not take", "<script>let x=1;</script>{#if x}{:then}{/if}"],
  ])(
    "ESLint lints a component with %s",
    async (_, text) => {
      const result = await lint(component(text, { "prefer-const": "error" }), [], []);
      // The parser's throw there ends the run.
      expect(result.stderr).toContain("error: parsed in JavaScript");
      expect(result.exitCode).toBe(2);
    },
    timeout,
  );

  // The rule runs natively, and its fix produces a component that ESLint lints, as it would lint the file with that
  // text.
  test(
    "ESLint lints a component that a fix turns into one that isn't read natively",
    async () => {
      const files = {
        ...svelteParser,
        "a.svelte": '<script>let x=1;</script><template lang="pug">p</template>{x}',
        "eslint.config.mjs": `
          import parser from "svelte-eslint-parser";
          const shout = { meta: { fixable: "code" }, create: ({ sourceCode, report }) => ({ Program(node) {
            const at = sourceCode.text.indexOf('lang="pug"');
            if (at !== -1) report({ node, message: "Shout.", fix: fixer => fixer.replaceTextRange([at, at + 4], "LANG") });
          } }) };
          export default [{ files: ["**/*.svelte"], languageOptions: { parser }, plugins: { local: { rules: { shout } } },
            rules: { "local/shout": "error" } }];`,
      };
      const result = await lint(files, ["--fix"], ["a.svelte"]);
      expect(result.stderr).toContain("error: parsed in JavaScript");
      expect(result.exitCode).toBe(2);
    },
    timeout,
  );

  test.each([
    ["a script that is no block, nor one for Svelte", "<script>let x=1;</script><p>{@html '<script>'}</p>{x}"],
    [
      "a mustache in the start tag of a script in the markup",
      "<script>let x=1;</script>\n<svelte:head><script src={x}></script></svelte:head>",
    ],
    [
      "mustaches of a name and a path in the start tag of a script in the markup",
      `<script>let x=1;</script>\n<svelte:head><script nonce={x} src="{x.src}"></script></svelte:head>`,
    ],
    ["a script in a comment of the markup", "<script>let x=1;</script>\n<p>{/* <script src={x}></script> */ x}</p>"],
    // Svelte reads a top-level block's attributes as written.
    [
      "braces in a value of the start tag of the style at the top level",
      `<script>let x=1;</script>\n<style media="a{b}">p {}</style>`,
    ],
    // svelte-eslint-parser treats these as templates, which aren't blocks without a `lang`.
    ["a component `Template` that closes itself", "<script>let x=1;</script>\n<Template options={x.y()} {x} />"],
    [
      "a component `Template` with a comment and a `language` in it",
      "<script>let x=1;</script>\n<Template run={() => x.y()}><!-- a --><p language={x}>{x}</p></Template>",
    ],
    ["a mustache behind text in a template", `<script>let x=1;</script><template data-a="p{x}">{x}</template>`],
  ])(
    "a component with %s is linted here",
    async (_, text) => {
      const result = await lint(component(text, { "prefer-const": "error" }), ["-f", "json"], []);
      expect(summary(result.raw)).toBe(
        `a.svelte: 1:13 prefer-const 'x' is never reassigned. Use 'const' instead. [fix 8,16 "const x=1;"]`,
      );
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  // svelte-eslint-parser parses a component as a module, whatever `sourceType` says, so its script's declarations
  // aren't globals.
  test(
    'a component with `sourceType: "script"` is a module',
    async () => {
      const text = "<script>\n  let top = 1;\n  var other = 2;\n  name = 'n';\n</script>\n<p>{top}{other}</p>\n";
      const files = component(text, { "no-redeclare": "error", "no-implicit-globals": "error" });
      files["eslint.config.mjs"] = files["eslint.config.mjs"].replace(
        "languageOptions: { parser }",
        'languageOptions: { parser, sourceType: "script", globals: { top: "readonly", name: "readonly" } }',
      );
      const result = await lint(files, ["-f", "json"]);
      expect(summary(result.raw)).toBe(
        "a.svelte: 4:3 no-implicit-globals Unexpected assignment to read-only global variable.",
      );
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  // svelte-eslint-parser reads `\s` between a template's attributes, and blanks one whose `lang` is another language,
  // so `y` isn't read. A `lang` after a quoted value is an attribute too.
  test.each([
    ["\\u00a0 before the `=` of its `lang`", '<template lang ="pug">', false],
    ["\\ufeff before the `=` of its `lang`", '<template lang﻿="pug">', false],
    ["\\u00a0 before its `lang`", '<template a="b" lang="pug">', false],
    ["its `lang` right behind a quoted value", '<template a="b"lang="pug">', true],
    ["a space behind the `=` of its `lang`", '<template lang= "pug">', true],
  ])(
    "a template with %s",
    async (_, start, isHere) => {
      const text = `<script>let x=1;</script>${start}{y}</template>{x}`;
      const result = await lint(component(text, { "prefer-const": "error", "no-undef": "error" }), ["-f", "json"], []);
      if (!isHere) {
        expect(result.stderr).toContain("error: parsed in JavaScript");
        expect(result.exitCode).toBe(2);
        return;
      }
      expect(summary(result.raw)).toBe(
        `a.svelte: 1:13 prefer-const 'x' is never reassigned. Use 'const' instead. [fix 8,16 "const x=1;"]`,
      );
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  // What the native rules report for `let a = 1`, or the error that ends the run when ESLint lints the component with
  // the throwing parser.
  const routed = (result: Awaited<ReturnType<typeof lint>>, text: string, isHere: boolean) => {
    if (!isHere) {
      expect(result.stderr).toContain("error: parsed in JavaScript");
      expect(result.exitCode).toBe(2);
      return;
    }
    const at = text.indexOf("let a");
    const line = text.slice(0, at).split("\n").length;
    expect(summary(result.raw)).toBe(
      `a.svelte: ${line}:7 prefer-const 'a' is never reassigned. Use 'const' instead. [fix ${at},${at + 10} "const a = 1;"]`,
    );
    expect(result.exitCode).toBe(1);
  };

  // svelte-eslint-parser calls a function given as `compilerOptions.runes` for each component, unless
  // `svelteFeatures.runes` decides.
  test.each([
    ["a function", "svelteConfig: { compilerOptions: { runes: () => false } }", false],
    ["false", "svelteConfig: { compilerOptions: { runes: false } }", true],
    [
      "a function after svelteFeatures",
      "svelteFeatures: { runes: false }, svelteConfig: { compilerOptions: { runes: () => false } }",
      true,
    ],
  ])(
    "a component whose parserOptions.svelteConfig has runes as %s",
    async (_, options, isHere) => {
      const text = "<script>\n  let a = 1;\n</script>\n{a}\n";
      const files = component(text, { "prefer-const": "error" });
      files["eslint.config.mjs"] = files["eslint.config.mjs"].replace(
        "languageOptions: { parser }",
        `languageOptions: { parser, parserOptions: { ${options} } }`,
      );
      routed(await lint(files, ["-f", "json"]), text, isHere);
    },
    timeout,
  );

  // typescript-eslint reads `generics` as the type parameters of `void function<..>(){}` in a separate module, where
  // TypeScript 5 treats `await` as a name. The native parser doesn't, so ESLint lints such a component. It also rejects
  // `out T`.
  test.each([
    ["await", false],
    ["out T", true],
    ["T", true],
  ])(
    'a component in TypeScript with generics="%s"',
    async (generics, isHere) => {
      const text = `<script lang="ts" generics="${generics}">\n  let a = 1;\n</script>\n{a}\n`;
      const files = { ...component(text, { "prefer-const": "error" }), ...typescriptParser };
      files["eslint.config.mjs"] = files["eslint.config.mjs"]
        .replace('import parser from "svelte-eslint-parser";', '$&\nimport * as ts from "@typescript-eslint/parser";')
        .replace("languageOptions: { parser }", "languageOptions: { parser, parserOptions: { parser: ts } }");
      routed(await lint(files, ["-f", "json"]), text, isHere);
    },
    timeout,
  );
});

// eslint-plugin-svelte as a config loads it. The native rules replace the plugin's rules they port on natively linted
// components, whatever name the config gives the plugin, and its processor runs natively: these throw if ESLint runs
// them. `more` is the source of more of its rules without native ports, as object properties.
function sveltePorts(more = "") {
  return {
    ...sveltePackage("rules"),
    "node_modules/eslint-plugin-svelte/index.js": `
    const here = (name, schema = []) => ({ meta: { schema }, create() { throw new Error(name + " ran in ESLint"); } });
    const names = [
      "no-at-html-tags", "no-at-debug-tags", "no-raw-special-elements", "system", "no-dupe-else-if-blocks", "no-dupe-on-directives",
      "no-dupe-use-directives", "no-export-load-in-svelte-module-in-kit-pages", "no-inspect", "no-object-in-text-mustaches",
      "no-dupe-style-properties", "no-shorthand-style-property-overrides", "no-unused-svelte-ignore",
      "no-reactive-functions", "no-reactive-literals", "no-svelte-internal", "no-useless-children-snippet", "require-each-key",
      "valid-prop-names-in-kit-pages", "infinite-reactive-loop", "no-dom-manipulating", "no-immutable-reactive-statements",
      "no-not-function-handler", "no-store-async", "prefer-svelte-reactivity", "prefer-writable-derived",
      "require-event-dispatcher-types", "valid-each-key",
    ];
    const options = { type: "object", properties: { reportUnusedDisableDirectives: { type: "boolean" } }, additionalProperties: false };
    const rules = {
      ...Object.fromEntries(names.map(it => [it, here(it)])),
      "comment-directive": here("comment-directive", [options]),
      "no-unknown-style-directive-property": here("no-unknown-style-directive-property", [{ type: "object" }]),
      "no-useless-mustaches": here("no-useless-mustaches", [{ type: "object" }]),
      "no-inner-declarations": here("no-inner-declarations", [{ enum: ["functions", "both"] }, { type: "object" }]),
      "no-reactive-reassign": here("no-reactive-reassign", [{ type: "object" }]),
      "no-unnecessary-state-wrap": here("no-unnecessary-state-wrap", [{ type: "object" }]),
      ${more}
    };
    const fails = () => { throw new Error("the processor ran in ESLint"); };
    const svelte = { preprocess: fails, postprocess: fails, supportsAutofix: true };
    module.exports = { meta: { name: "eslint-plugin-svelte", version: "3.23.1" }, rules, processors: { svelte, ".svelte": svelte } };`,
  };
}

const sveltePlugin = sveltePorts();

// A fake `eslint` whose `Linter` lints the way ESLint 10's `runRules` does, on a one-line `Program` from a fake
// svelte-eslint-parser that has `getStyleContext`: it sets up the rules in config order, then parses every key as a
// selector and calls the listeners, and reports their throws the way its `Linter` does. Its configs have
// `getRuleDefinition`, so the worker traces the rules. With `withTraverser`, the traversal is in
// `lib/linter/source-code-traverser.js`, as in ESLint 10, otherwise in the `Linter`'s module.
function eslintTen(withTraverser: boolean) {
  const traverser = `class SourceCodeTraverser {
    static getInstance() {
      return new this();
    }
    traverseSync(sourceCode, visitor) {
      for (const key of visitor.keys())
        if (!/^(?:[A-Za-z]+|\\*)(?::exit)?$/.test(key)) throw new SyntaxError(\`Syntax error in selector "\${key}"\`);
      for (const exit of [false, true]) {
        for (const [key, listeners] of visitor) {
          if (key.endsWith(":exit") !== exit) continue;
          for (const listener of listeners) {
            try {
              listener(sourceCode.ast);
            } catch (err) {
              err.currentNode = sourceCode.ast;
              throw err;
            }
          }
        }
      }
    }
  }`;
  return {
    "node_modules/svelte-eslint-parser/index.js": `
      module.exports = {
        meta: { name: "svelte-eslint-parser", version: "1.9.0" },
        parseForESLint: text => ({
          ast: { type: "Program", body: [], range: [0, text.length], loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } } },
          services: { getStyleContext() {} },
        }),
      };`,
    "node_modules/eslint/lib/config/flat-config-array.js": `
      exports.FlatConfigArray = class extends Array {
        constructor(configs) {
          super();
          this.push(...configs);
        }
        normalize() {}
        getConfig() {
          const [rules, plugins] = ["rules", "plugins"].map(key => Object.assign({}, ...Array.from(this, it => it[key])));
          return { ...Object.assign({}, ...this), rules, plugins, getRuleDefinition(id) { const [prefix, name] = id.split("/"); return this.plugins[prefix]?.rules[name]; } };
        }
      };`,
    ...(withTraverser
      ? { "node_modules/eslint/lib/linter/source-code-traverser.js": `exports.SourceCodeTraverser = ${traverser};` }
      : {}),
    "node_modules/eslint/index.js": `
      "use strict";
      const SourceCodeTraverser = ${withTraverser ? 'require("./lib/linter/source-code-traverser.js").SourceCodeTraverser' : traverser};
      exports.Linter = class {
        verify(text, configs, { filename, ruleFilter, disableFixes }) {
          const config = configs.getConfig(filename);
          const { ast, services } = config.languageOptions.parser.parseForESLint(text, {});
          const sourceCode = { text, ast, parserServices: services };
          const messages = [];
          const visitor = new Map();
          try {
            for (const [ruleId, setting] of Object.entries(config.rules)) {
              const [severity] = [setting].flat();
              if (severity === "off" || severity === 0 || !ruleFilter({ ruleId, severity: 2 })) continue;
              const report = ({ node, message, fix }) => {
                const made = typeof fix === "function" ? fix({ replaceTextRange: (range, text) => ({ range, text }) }) : fix;
                const at = node.loc.start;
                messages.push({ ruleId, severity: 2, message, line: at.line, column: at.column + 1, ...(made && !disableFixes ? { fix: made } : {}) });
              };
              let made;
              try {
                made = config.getRuleDefinition(ruleId).create({ id: ruleId, filename, sourceCode, report });
              } catch (ex) {
                ex.message = \`Error while loading rule '\${ruleId}': \${ex.message}\`;
                throw ex;
              }
              if (made == null) throw new Error(\`The create() function for rule '\${ruleId}' did not return an object.\`);
              for (const key of Object.keys(made)) {
                const listener = made[key];
                const handler = node => {
                  try {
                    return listener(node);
                  } catch (error) {
                    if (error !== null && typeof error === "object") error.ruleId = ruleId;
                    throw error;
                  }
                };
                visitor.set(key, [...(visitor.get(key) ?? []), handler]);
              }
            }
            SourceCodeTraverser.getInstance().traverseSync(sourceCode, visitor);
          } catch (err) {
            err.message += \`\\nOccurred while linting \${filename}\`;
            if (err.currentNode) err.message += \`:\${err.currentNode.loc.start.line}\`;
            if (err.ruleId) err.message += \`\\nRule: "\${err.ruleId}"\`;
            throw err;
          }
          return messages;
        }
        getSuppressedMessages() {
          return [];
        }
      };`,
  };
}

// `shouting`'s `shout` without its fix.
const quietShout = `{
  create: ({ report }) => ({
    Line: ({ lines }) => lines.forEach((line, i) => line.includes("LOUD") && report({ line: i + 1, message: "Shouting." })),
  }),
}`;

// A component, linted with eslint-plugin-svelte's rules as `svelte/..` and as `sv/..`, and with `local/shout`, which
// only ESLint runs: see `shouting`.
function svelteRules(text: string, rules: Record<string, unknown>) {
  return {
    ...shouting(text, {}),
    ...sveltePorts(`shout: ${quietShout},`),
    "eslint.config.mjs": `
      import parser from "svelte-eslint-parser";
      import svelte from "eslint-plugin-svelte";
      export default [{
        files: ["**/*.svelte"],
        languageOptions: { parser },
        plugins: { svelte, sv: svelte, local: svelte },
        linterOptions: { reportUnusedDisableDirectives: "error" },
        rules: ${JSON.stringify(rules)},
      }];`,
  };
}

// `probe/component`, a JavaScript plugin rule that runs in the host on the svelte-eslint-parser tree and scopes the
// component is presented as, and reports what it sees at the `Program` as JSON. Positions are `type@start`, ranges
// `start-end`.
// - `nodes`: each component node, and each code node that's a child of one: `type start-end < parent`.
// - `bindings`: each variable declared outside the scripts: `[name, its scope's block, its definition's node, the
//   component nodes its references are in]`.
// - `references`: each reference of each scope, `name start-end rw -> variable`, where the variable is `name@start-end`
//   of its definition's name, or `null`.
const componentProbe = `{
  create: context => ({
    Program(program) {
      const { scopeManager, visitorKeys } = context.sourceCode;
      const isSvelte = node => node.type.startsWith("Svelte");
      const at = node => (node ? node.type + "@" + node.range[0] : "null");
      const range = node => node.range[0] + "-" + node.range[1];
      const owner = node => {
        for (let it = node.parent; it; it = it.parent) if (isSvelte(it)) return it;
        return null;
      };
      const nodes = [];
      const visit = node => {
        if (!node || typeof node.type !== "string") return;
        const parent = node.parent ?? null;
        const isOwn = node === program || isSvelte(node);
        nodes.push(node.type + " " + range(node) + " < " + at(parent));
        if (isOwn) for (const key of visitorKeys[node.type] ?? []) [node[key]].flat().forEach(visit);
      };
      visit(program);
      const bindings = [];
      const references = [];
      for (const scope of scopeManager.scopes) {
        for (const variable of scope.variables) {
          const [definition] = variable.defs;
          const declaredIn = definition && owner(definition.name);
          if (!declaredIn || declaredIn.type === "SvelteScriptElement") continue;
          const read = variable.references.filter(it => it.identifier !== definition.name);
          bindings.push([variable.name, at(scope.block), at(definition.node), read.map(it => at(owner(it.identifier)))]);
        }
        for (const reference of scope.references) {
          const { identifier, resolved } = reference;
          const flags = (reference.isRead() ? "r" : "") + (reference.isWrite() ? "w" : "");
          const name = resolved?.defs[0]?.name;
          const variable = name ? resolved.name + "@" + range(name) : "null";
          references.push(identifier.name + " " + range(identifier) + " " + flags + " -> " + variable);
        }
      }
      context.report({ node: program, message: JSON.stringify({ nodes: nodes.sort(), bindings, references: references.sort() }) });
    },
  }),
}`;

// `svelteRules` with `probe/component` on.
function probing(text: string, rules: Record<string, unknown> = { "svelte/no-at-html-tags": "error" }) {
  const files = svelteRules(text, { ...rules, "probe/component": "error" });
  files["eslint.config.mjs"] = files["eslint.config.mjs"]
    .replace("export default [{", `const probe = { rules: { component: ${componentProbe} } };\n      export default [{`)
    .replace("plugins: { svelte,", "plugins: { probe, svelte,");
  return files;
}

interface Probed {
  nodes: string[];
  bindings: [name: string, block: string, node: string, references: string[]][];
  references: string[];
}

// What `probe/component` saw in the first file.
function probed(raw: string): Probed {
  const [{ messages }] = JSON.parse(raw);
  return JSON.parse(messages.find((it: { ruleId: string }) => it.ruleId === "probe/component").message);
}

describe.concurrent("eslint-plugin-svelte's native rules", () => {
  test(
    "replace the package's rules on a component, under any plugin name, and leave ESLint the rest",
    async () => {
      const text = "<script>\n  let html = 'LOUD';\n</script>\n<p>{@html html}</p>{@debug html}\n";
      const rules = { "svelte/no-at-html-tags": "error", "sv/no-at-debug-tags": "warn", "local/shout": "error" };
      const result = await lint(svelteRules(text, rules), ["-f", "json"]);
      expect(summary(result.raw)).toMatchInlineSnapshot(`
        "a.svelte: 2:1 local/shout Shouting.
        a.svelte: 4:4 svelte/no-at-html-tags \`{@html}\` can lead to XSS attack.
        a.svelte: 4:20 sv/no-at-debug-tags Unexpected \`{@debug}\`. [1 suggestion]"
      `);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "are native to --doctor, under any plugin name",
    async () => {
      const rules = { "svelte/no-at-html-tags": "error", "sv/no-at-debug-tags": "warn", "local/shout": "error" };
      const result = await lint(svelteRules("<p>{@html a}</p>\n", rules), ["--doctor", "-f", "json"]);
      const { files, rules: counted } = JSON.parse(result.raw);
      expect({ by_eslint: files.by_eslint, native: counted.native, javascript: counted.javascript }).toEqual({
        by_eslint: {},
        native: ["sv/no-at-debug-tags", "svelte/no-at-html-tags"],
        javascript: { "eslint-plugin-svelte": ["local/shout"] },
      });
      expect(result.exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "are native to --doctor where the component is linted natively, and its other components go to ESLint",
    async () => {
      const rules = { "svelte/no-at-html-tags": "error" };
      const files = {
        ...svelteRules("<p>{@html a}</p>\n", rules),
        // A template whose `lang` isn't written in lower case isn't read here the way Svelte reads it.
        "b.svelte": '<script>let x = 1;</script><template LANG="pug">p</template>{x}\n',
      };
      const result = await lint(files, ["--doctor", "-f", "json"]);
      const { files: counted, rules: listed } = JSON.parse(result.raw);
      expect({ by_eslint: counted.by_eslint, native: listed.native }).toEqual({
        by_eslint: { "*.svelte": 1 },
        native: ["svelte/no-at-html-tags"],
      });
      expect(result.exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "run when only a comment in the component turns them on, under any plugin name",
    async () => {
      const text = `<script>/* eslint svelte/no-at-html-tags: "error", sv/no-at-debug-tags: "warn" */ let a = "x";</script>{@html a}{@debug a}\n`;
      const result = await lint(svelteRules(text, {}), ["-f", "json"]);
      expect(summary(result.raw)).toMatchInlineSnapshot(`
        "a.svelte: 1:104 svelte/no-at-html-tags \`{@html}\` can lead to XSS attack.
        a.svelte: 1:113 sv/no-at-debug-tags Unexpected \`{@debug}\`. [1 suggestion]"
      `);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  // A fake `eslint` whose `Linter` runs the rules it's given on a one-node `Program` with the range of `element`, which
  // a fix replaces. It calls each listener once, with the `Program` where the key is only about it, otherwise with the
  // element, and a code path end with the `Program`, as ESLint does.
  const traversingEslint = (element: object) => ({
    "node_modules/eslint/lib/config/flat-config-array.js": `
      exports.FlatConfigArray = class extends Array {
        constructor(configs) {
          super();
          this.push(...configs);
        }
        normalize() {}
        getConfig() {
          const [rules, plugins] = ["rules", "plugins"].map(key => Object.assign({}, ...Array.from(this, it => it[key])));
          return { ...Object.assign({}, ...this), rules, plugins, getRuleDefinition(id) { const [prefix, name] = id.split("/"); return this.plugins[prefix]?.rules[name]; } };
        }
      };`,
    "node_modules/eslint/index.js": `
      exports.Linter = class {
        verify(text, configs, { filename, ruleFilter }) {
          const config = configs.getConfig(filename);
          const loc = { start: { line: 1, column: 0 }, end: { line: 1, column: text.length } };
          const program = { type: "Program", range: [0, text.length], loc, body: [] };
          const element = { ...${JSON.stringify(element)}, range: [0, text.length], loc, parent: program, text };
          program.body.push(element);
          const messages = [];
          const listeners = [];
          for (const [id, setting] of Object.entries(config.rules)) {
            const [severity] = [setting].flat();
            if (severity === "off" || !ruleFilter({ ruleId: id, severity: 2 })) continue;
            const report = ({ node, message, fix }) =>
              messages.push({ ruleId: id, severity: 2, message, line: node.loc.start.line, column: node.loc.start.column + 1, fix });
            listeners.push(config.getRuleDefinition(id).create({ id, report }));
          }
          for (const it of listeners) {
            for (const [key, listener] of Object.entries(it)) {
              if (key === "onCodePathEnd") listener({}, program);
              else listener(key.startsWith("Program") && !key.includes(">") ? program : element);
            }
          }
          return messages.sort((a, b) => a.line - b.line || a.column - b.column);
        }
        getSuppressedMessages() {
          return [];
        }
      };`,
  });

  // ESLint sorts its reports by line and column only. Reports that start at one position stay in traversal order: on
  // entering a node before on leaving it, the outer of two nodes with the same range first, and on one node the less
  // specific selector first, then rule order. That decides which of two fixes for one range is applied. Here a rule
  // that only ESLint runs fixes what `svelte/no-raw-special-elements` fixes, which listens with
  // `SvelteElement[kind="html"]`.
  test.each([
    ["on leaving the element, after the rule here", "SvelteElement:exit", true, "<svelte:head>x</svelte:head>"],
    ["on entering it by its type, before the rule here", "SvelteElement", true, "<svelte:head>local</svelte:head>"],
    ["by `*`, which says less than a type, before the rule here", "*", false, "<svelte:head>local</svelte:head>"],
    [
      "by a child of the program, which has no attribute, before the rule here",
      "Program > SvelteElement",
      false,
      "<svelte:head>local</svelte:head>",
    ],
    [
      "by a sibling, which has no attribute, before the rule here",
      "SvelteText + SvelteElement",
      false,
      "<svelte:head>local</svelte:head>",
    ],
    [
      "by two attributes, after the rule here",
      'SvelteElement[kind="html"][name.name="head"]',
      true,
      "<svelte:head>x</svelte:head>",
    ],
    [
      "by one attribute, in the order of the text",
      'SvelteElement[name.name="head"]',
      true,
      "<svelte:head>x</svelte:head>",
    ],
    [
      "by the selector of the rule here, in the order of the rules",
      'SvelteElement[kind="html"]',
      true,
      "<svelte:head>local</svelte:head>",
    ],
    [
      "by two attributes beside a class that does not exist, after the rule here",
      "SvelteElement:matches(*, :unknown)[kind=html][name.name=head]",
      true,
      "<svelte:head>x</svelte:head>",
    ],
    [
      "on the program, which has the range of the element, before the rule here",
      "Program[body]",
      false,
      "<svelte:head>local</svelte:head>",
    ],
    [
      "on the program by two attributes, before the rule here",
      "Program[type][body]",
      false,
      "<svelte:head>local</svelte:head>",
    ],
  ])(
    "at one place come after what ESLint's own rules report where it reports that later: %s",
    async (_, listener, isListedFirst, fixed) => {
      const rules = ["local/local", "svelte/no-raw-special-elements"];
      const files = {
        ...svelteRules("<head>x</head>", {}),
        ...traversingEslint({ type: "SvelteElement", kind: "html" }),
        ...sveltePorts(`local: {
          create: ({ report }) => ({
            ${JSON.stringify(listener)}(node) {
              const element = node.type === "Program" ? node.body[0] : node;
              if (element.text === "<head>x</head>") report({ node: element, message: "Local.", fix: { range: [1, 9], text: "head>local</" } });
            },
          }),
        },`),
        "eslint.config.mjs": `
          import parser from "svelte-eslint-parser";
          import svelte from "eslint-plugin-svelte";
          export default [{
            files: ["**/*.svelte"],
            languageOptions: { parser },
            plugins: { svelte, local: svelte },
            rules: ${JSON.stringify(Object.fromEntries((isListedFirst ? rules : rules.toReversed()).map(it => [it, "error"])))},
          }];`,
      };
      const result = await lint(files, ["--fix"], ["a.svelte"]);
      expect(result.files["a.svelte"]).toBe(fixed);
    },
    timeout,
  );

  // ESLint ends the program's code path after every `Program:exit` listener, where `no-unused-vars` reports, whatever
  // the rule order.
  test(
    "report after the native rules' end-of-program reports when ESLint's own report at the end of the code path",
    async () => {
      const text = "<script>const unused = 1;</script>";
      const files = {
        ...svelteRules(text, {}),
        ...traversingEslint({ type: "SvelteScriptElement" }),
        ...sveltePorts(`local: {
          create: ({ report }) => ({
            onCodePathEnd(codePath, node) {
              if (node.type === "Program") report({ node: { loc: { start: { line: 1, column: 14 } } }, message: "Local." });
            },
          }),
        },`),
        "eslint.config.mjs": `
          import parser from "svelte-eslint-parser";
          import local from "eslint-plugin-svelte";
          export default [{
            files: ["**/*.svelte"],
            languageOptions: { parser },
            plugins: { local },
            rules: { "local/local": "error", "no-unused-vars": "error" },
          }];`,
      };
      const result = await lint(files, ["-f", "json"], []);
      expect(summary(result.raw)).toMatchInlineSnapshot(`
        "a.svelte: 1:15 no-unused-vars 'unused' is assigned a value but never used.
        a.svelte: 1:15 local/local Local."
      `);
    },
    timeout,
  );

  // A node of `tree`: its type, its range, and its children.
  type Tree = [type: string, start: number, end: number, children?: Tree[]];

  // A fake `eslint` whose `Linter` has the tree `tree` for the component `text` and calls each listener of a rule once:
  // with the node at `on` in walk order, and for a code path event with that node last, as ESLint does. A node's
  // children are the nodes under its only visitor key.
  const listeningEslint = (text: string, tree: Tree, on: number) => ({
    ...traversingEslint({}),
    "node_modules/eslint/index.js": `
      exports.Linter = class {
        verify(text, configs, { filename, ruleFilter }) {
          if (text !== ${JSON.stringify(text)}) return [];
          const config = configs.getConfig(filename);
          const walked = [];
          const node = ([type, start, end, children = []], parent) => {
            const it = { type, range: [start, end], loc: { start: { line: 1, column: start }, end: { line: 1, column: end } }, parent };
            walked.push(it);
            it.children = children.map(child => node(child, it));
            return it;
          };
          node(${JSON.stringify(tree)}, null);
          const events = ["onCodePathStart", "onCodePathEnd", "onCodePathSegmentStart", "onCodePathSegmentEnd", "onUnreachableCodePathSegmentEnd"];
          const messages = [];
          for (const [id, setting] of Object.entries(config.rules)) {
            const [severity] = [setting].flat();
            if (severity === "off" || !ruleFilter({ ruleId: id, severity: 2 })) continue;
            const report = ({ node, loc, message, fix }) =>
              messages.push({ ruleId: id, severity: 2, message, line: loc.start.line, column: loc.start.column + 1, fix });
            const sourceCode = { visitorKeys: new Proxy({}, { get: () => ["children"] }) };
            for (const [key, listener] of Object.entries(config.getRuleDefinition(id).create({ id, report, sourceCode }))) {
              if (events.includes(key)) listener({}, walked[${on}]);
              else listener(walked[${on}]);
            }
          }
          return messages.sort((a, b) => a.line - b.line || a.column - b.column);
        }
        getSuppressedMessages() {
          return [];
        }
      };`,
  });

  // Reports that start at one position come in ESLint's traversal order, wherever their rule runs: the native rules say
  // what their listeners are called with, on nodes of Bun's program or the component, also when they listen by type
  // only, and on code path steps.
  test.each([
    [
      "by the type of the node alone, in the order of the rules",
      "<script>debugger;</script>",
      ["Program", 0, 26, [["SvelteScriptElement", 0, 26, [["DebuggerStatement", 8, 17]]]]],
      { "no-debugger": "error" },
      ["DebuggerStatement", 2, 8],
      ["no-debugger", "local/local"],
      false,
    ],
    [
      "by a selector of the same specificity as the type of the node, in the order of their text",
      "<script>let x = 1;</script>{@debug x}",
      [
        "Program",
        0,
        37,
        [
          ["SvelteScriptElement", 0, 27],
          ["SvelteDebugTag", 27, 37, [["Identifier", 35, 36]]],
        ],
      ],
      { "svelte/no-at-debug-tags": "error" },
      [":not(SvelteAttribute)", 2, 27],
      ["local/local", "svelte/no-at-debug-tags"],
      false,
    ],
    [
      "on a node that has the range of that of the rule here, which ESLint enters first",
      "<script>({ x })\n</script>",
      [
        "Program",
        0,
        25,
        [
          [
            "SvelteScriptElement",
            0,
            25,
            [
              [
                "ExpressionStatement",
                8,
                15,
                [
                  [
                    "ObjectExpression",
                    9,
                    14,
                    [
                      [
                        "Property",
                        11,
                        12,
                        [
                          ["Identifier", 11, 12],
                          ["Identifier", 11, 12],
                        ],
                      ],
                    ],
                  ],
                ],
              ],
            ],
          ],
        ],
      ],
      { "no-restricted-syntax": ["error", { selector: "Identifier", message: "Native." }] },
      ["Property[type]", 4, 11],
      ["local/local", "no-restricted-syntax", "no-restricted-syntax"],
      false,
    ],
    [
      "on entering the name of a rune, after entering the call around it",
      "<script>$inspect(1)</script>",
      [
        "Program",
        0,
        28,
        [
          [
            "SvelteScriptElement",
            0,
            28,
            [
              [
                "ExpressionStatement",
                8,
                19,
                [
                  [
                    "CallExpression",
                    8,
                    19,
                    [
                      ["Identifier", 8, 16],
                      ["Literal", 17, 18],
                    ],
                  ],
                ],
              ],
            ],
          ],
        ],
      ],
      { "svelte/no-inspect": "error" },
      ["CallExpression", 3, 8],
      ["local/local", "svelte/no-inspect"],
      false,
    ],
    [
      "on leaving the function that is bound, which the rule here does not listen to, before leaving the call",
      "<script>foo(function () { return 1; }.bind(this));</script>",
      [
        "Program",
        0,
        59,
        [
          [
            "SvelteScriptElement",
            0,
            59,
            [
              [
                "ExpressionStatement",
                8,
                50,
                [
                  [
                    "CallExpression",
                    8,
                    49,
                    [
                      ["Identifier", 8, 11],
                      [
                        "CallExpression",
                        12,
                        48,
                        [
                          [
                            "MemberExpression",
                            12,
                            42,
                            [
                              ["FunctionExpression", 12, 37, [["BlockStatement", 24, 37]]],
                              ["Identifier", 38, 42],
                            ],
                          ],
                          ["ThisExpression", 43, 47],
                        ],
                      ],
                    ],
                  ],
                ],
              ],
            ],
          ],
        ],
      ],
      { "no-extra-bind": "error" },
      ["CallExpression:exit", 5, 38],
      ["no-extra-bind", "local/local"],
      true,
    ],
    [
      "on a statement without `;`, which ESLint enters before the call in it",
      "<script>alert()</script>",
      [
        "Program",
        0,
        24,
        [
          [
            "SvelteScriptElement",
            0,
            24,
            [["ExpressionStatement", 8, 15, [["CallExpression", 8, 15, [["Identifier", 8, 13]]]]]],
          ],
        ],
      ],
      { "no-alert": "error" },
      ["ExpressionStatement", 2, 8],
      ["local/local", "no-alert"],
      false,
    ],
    [
      "on entering a function by the start of its code path, before the listeners of selectors there",
      "<script>function f() {} </script>",
      [
        "Program",
        0,
        33,
        [
          [
            "SvelteScriptElement",
            0,
            33,
            [
              [
                "FunctionDeclaration",
                8,
                23,
                [
                  ["Identifier", 17, 18],
                  ["BlockStatement", 21, 23],
                ],
              ],
            ],
          ],
        ],
      ],
      { "no-empty-function": "error" },
      ["onCodePathStart", 2, 21],
      ["local/local", "no-empty-function"],
      false,
    ],
    [
      "on entering the name of a type parameter of generics, after entering the parameter of the same range",
      '<script lang="ts" generics="$inspect"></script>',
      [
        "Program",
        0,
        47,
        [
          [
            "SvelteScriptElement",
            0,
            47,
            [
              [
                "SvelteStartTag",
                0,
                38,
                [["SvelteGenericsDirective", 18, 37, [["TSTypeParameter", 28, 36, [["Identifier", 28, 36]]]]]],
              ],
            ],
          ],
        ],
      ],
      { "svelte/no-inspect": "error" },
      ["TSTypeParameter", 4, 28],
      ["local/local", "svelte/no-inspect"],
      false,
    ],
    ...[
      [
        "the value of a shorthand attribute",
        "<A {$inspect}/>",
        [
          "Program",
          0,
          15,
          [
            [
              "SvelteElement",
              0,
              15,
              [
                [
                  "SvelteStartTag",
                  0,
                  15,
                  [
                    ["SvelteName", 1, 2],
                    [
                      "SvelteShorthandAttribute",
                      3,
                      13,
                      [
                        ["Identifier", 4, 12],
                        ["Identifier", 4, 12],
                      ],
                    ],
                  ],
                ],
              ],
            ],
          ],
        ],
        6,
        4,
      ],
      [
        "the value of a shorthand property",
        "<script>({ $inspect })\n</script>",
        [
          "Program",
          0,
          32,
          [
            [
              "SvelteScriptElement",
              0,
              32,
              [
                [
                  "ExpressionStatement",
                  8,
                  22,
                  [
                    [
                      "ObjectExpression",
                      9,
                      21,
                      [
                        [
                          "Property",
                          11,
                          19,
                          [
                            ["Identifier", 11, 19],
                            ["Identifier", 11, 19],
                          ],
                        ],
                      ],
                    ],
                  ],
                ],
              ],
            ],
          ],
        ],
        6,
        11,
      ],
    ].map(([what, text, tree, on, column]) => [
      `on entering ${what}, after leaving its key of the same range`,
      text,
      tree,
      { "svelte/no-inspect": "error" },
      ["Identifier", on, column],
      ["svelte/no-inspect", "local/local", "svelte/no-inspect"],
      true,
    ]),
    [
      "on entering the name of `load` in a route, after entering its declarator",
      '<script context="module">export const load = () => {};</script>',
      [
        "Program",
        0,
        63,
        [
          [
            "SvelteScriptElement",
            0,
            63,
            [
              [
                "ExportNamedDeclaration",
                25,
                54,
                [
                  [
                    "VariableDeclaration",
                    32,
                    54,
                    [
                      [
                        "VariableDeclarator",
                        38,
                        53,
                        [
                          ["Identifier", 38, 42],
                          ["ArrowFunctionExpression", 45, 53],
                        ],
                      ],
                    ],
                  ],
                ],
              ],
            ],
          ],
        ],
      ],
      { "svelte/no-export-load-in-svelte-module-in-kit-pages": "error" },
      ["VariableDeclarator", 4, 38, "src/routes/+page.svelte"],
      ["local/local", "svelte/no-export-load-in-svelte-module-in-kit-pages"],
      false,
    ],
    ...[true, false].map(isLocalFirst => [
      `on a \`$:\` statement, a \`SvelteReactiveStatement\` of svelte-eslint-parser, in the order of the rules: ${isLocalFirst ? "ESLint's first" : "ESLint's last"}`,
      "<script>$: a=1;</script>",
      [
        "Program",
        0,
        24,
        [
          [
            "SvelteScriptElement",
            0,
            24,
            [
              [
                "SvelteReactiveStatement",
                8,
                15,
                [
                  [
                    "ExpressionStatement",
                    11,
                    15,
                    [
                      [
                        "AssignmentExpression",
                        11,
                        14,
                        [
                          ["Identifier", 11, 12],
                          ["Literal", 13, 14],
                        ],
                      ],
                    ],
                  ],
                ],
              ],
            ],
          ],
        ],
      ],
      { "svelte/no-immutable-reactive-statements": "error" },
      ["SvelteReactiveStatement", 2, 13],
      isLocalFirst
        ? ["local/local", "svelte/no-immutable-reactive-statements"]
        : ["svelte/no-immutable-reactive-statements", "local/local"],
      isLocalFirst,
    ]),
    ...["FunctionDeclaration:exit", "onUnreachableCodePathSegmentEnd", "onCodePathEnd", "onCodePathEnd:first"].map(
      listener => {
        const [key, first] = listener.split(":first");
        return [
          first === undefined
            ? `on leaving a function by \`${key}\`, before the end of its code path where the rule here reports`
            : "at the end of the code path of a function, in the order of the rules",
          "<script>function f() { return; } </script>",
          [
            "Program",
            0,
            42,
            [
              [
                "SvelteScriptElement",
                0,
                42,
                [
                  [
                    "FunctionDeclaration",
                    8,
                    32,
                    [
                      ["Identifier", 17, 18],
                      ["BlockStatement", 21, 32, [["ReturnStatement", 23, 30]]],
                    ],
                  ],
                ],
              ],
            ],
          ],
          { "no-useless-return": "error" },
          [key, 2, 23],
          key === "onCodePathEnd" && first === undefined
            ? ["no-useless-return", "local/local"]
            : ["local/local", "no-useless-return"],
          first !== undefined,
        ];
      },
    ),
  ] as [
    string,
    string,
    Tree,
    Record<string, unknown>,
    [key: string, on: number, column: number, route?: string],
    string[],
    boolean,
  ][])(
    "at one place come where ESLint has them: %s",
    async (_, text, tree, native, [key, on, column, route], expected, isLocalFirst) => {
      const rules = isLocalFirst ? { "local/local": "error", ...native } : { ...native, "local/local": "error" };
      const isTypeScript = text.includes('lang="ts"');
      const files: Record<string, string> = {
        ...svelteRules(text, {}),
        ...(isTypeScript ? typescriptParser : {}),
        ...listeningEslint(text, tree, on),
        ...sveltePorts(`local: {
          create: ({ report }) => ({
            ${JSON.stringify(key)}() {
              report({ loc: { start: { line: 1, column: ${column} } }, message: "Local." });
            },
          }),
        },`),
        "eslint.config.mjs": `
          import parser from "svelte-eslint-parser";
          import svelte from "eslint-plugin-svelte";
          ${isTypeScript ? 'import * as ts from "@typescript-eslint/parser";' : ""}
          export default [{
            files: ["**/*.svelte"],
            languageOptions: { parser${isTypeScript ? ", parserOptions: { parser: ts }" : ""} },
            plugins: { svelte, local: svelte },
            rules: ${JSON.stringify(rules)},
          }];`,
      };
      // A SvelteKit route.
      if (route) {
        files[route] = files["a.svelte"];
        files["package.json"] = JSON.stringify({ name: "app", devDependencies: { "@sveltejs/kit": "^2.5.0" } });
        delete files["a.svelte"];
      }
      const result = await lint(files, ["-f", "json", route ?? "a.svelte"], []);
      const [{ messages }] = JSON.parse(result.raw);
      expect(messages.map(it => `${it.line}:${it.column} ${it.ruleId}`)).toEqual(
        expected.map(it => `1:${column + 1} ${it}`),
      );
    },
    timeout,
  );

  test(
    "report component positions in UTF-16 code units, after a byte order mark and with CRLF line breaks",
    async () => {
      const text =
        "\uFEFF<script>\r\n  let a = '\u{1F600}';\r\n</script>\r\n<p>\u{1F600} {@html a}</p>{@debug a}\r\n<head>é</head>\r\n";
      const rules = {
        "svelte/no-at-html-tags": "error",
        "svelte/no-at-debug-tags": "error",
        "svelte/no-raw-special-elements": "error",
      };
      const result = await lint(svelteRules(text, rules), ["-f", "json"], []);
      const [{ messages }] = JSON.parse(result.raw);
      expect(
        messages.map(it => [
          `${it.line}:${it.column}-${it.endLine}:${it.endColumn}`,
          it.ruleId,
          it.fix?.range,
          it.fix?.text,
          it.suggestions?.[0]?.fix,
        ]),
      ).toMatchInlineSnapshot(`
        [
          [
            "4:7-4:16",
            "svelte/no-at-html-tags",
            undefined,
            undefined,
            undefined,
          ],
          [
            "4:20-4:30",
            "svelte/no-at-debug-tags",
            undefined,
            undefined,
            {
              "range": [
                57,
                67,
              ],
              "text": "",
            },
          ],
          [
            "5:1-5:15",
            "svelte/no-raw-special-elements",
            [
              70,
              78,
            ],
            "svelte:head>é</svelte:",
            undefined,
          ],
        ]
      `);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "fix together with the rules that run on the program, where their fixes overlap",
    async () => {
      const text = "<script>\n  let a = 1;\n</script>\n<head>{!!a ? 1 : 2}</head>\n";
      const rules = {
        "svelte/no-raw-special-elements": "error",
        "no-extra-boolean-cast": "error",
        "prefer-const": "error",
      };
      const result = await lint(svelteRules(text, rules), ["--fix"], ["a.svelte"]);
      expect(result.files["a.svelte"]).toBe(
        "<script>\n  const a = 1;\n</script>\n<svelte:head>{a ? 1 : 2}</svelte:head>\n",
      );
      expect(result.exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "are disabled by the program's comments but not by HTML comments, as without the processor",
    async () => {
      const text = [
        "<script>",
        "  /* eslint-disable svelte/no-at-debug-tags */",
        "  // eslint-disable-next-line sv/no-at-html-tags",
        "  let a = 1;",
        "</script>",
        "{@debug a}",
        "<p>{@html a /* eslint-disable-line svelte/no-at-html-tags */}</p>",
        "<!-- eslint-disable-next-line svelte/no-at-html-tags -->",
        "<p>{@html a}</p>",
        "",
      ].join("\n");
      const rules = { "svelte/no-at-html-tags": "error", "svelte/no-at-debug-tags": "error" };
      const result = await lint(svelteRules(text, rules), ["-f", "json"], []);
      expect(summary(result.raw)).toMatchInlineSnapshot(`
        "a.svelte: 3:3 null Unused eslint-disable directive (no problems were reported from 'sv/no-at-html-tags'). [fix 58,104 " "]
        a.svelte: 9:4 svelte/no-at-html-tags \`{@html}\` can lead to XSS attack.
        a.svelte: 6:1 svelte/no-at-debug-tags Unexpected \`{@debug}\`. [1 suggestion] [suppressed: ]
        a.svelte: 7:4 svelte/no-at-html-tags \`{@html}\` can lead to XSS attack. [suppressed: ]"
      `);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "see the component that fixes produced, on each pass",
    async () => {
      const text = "<script>let a = '';</script><p>{@html a}</p>\n";
      const rules = { "svelte/no-at-html-tags": "error", "prefer-const": "error" };
      const result = await lint(svelteRules(text, rules), ["--fix-dry-run", "-f", "json"], []);
      expect(summary(result.raw)).toBe("a.svelte: 1:34 svelte/no-at-html-tags `{@html}` can lead to XSS attack.");
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "see the component as svelte-eslint-parser has it, with its program's code inside",
    async () => {
      // From the attribute value's expression up to the `Program`, and a script with its statement.
      const text = "<script>\n  let value = 0;\n</script>\n<p title={value}>{value}</p>\n";
      const result = await lint(probing(text), ["-f", "json"]);
      expect(probed(result.raw).nodes).toMatchInlineSnapshot(`
        [
          "Identifier 46-51 < SvelteMustacheTag@45",
          "Identifier 54-59 < SvelteMustacheTag@53",
          "Program 0-65 < null",
          "SvelteAttribute 39-52 < SvelteStartTag@36",
          "SvelteElement 36-64 < Program@0",
          "SvelteEndTag 26-35 < SvelteScriptElement@0",
          "SvelteEndTag 60-64 < SvelteElement@36",
          "SvelteMustacheTag 45-52 < SvelteAttribute@39",
          "SvelteMustacheTag 53-60 < SvelteElement@36",
          "SvelteName 1-7 < SvelteScriptElement@0",
          "SvelteName 37-38 < SvelteElement@36",
          "SvelteName 39-44 < SvelteAttribute@39",
          "SvelteScriptElement 0-35 < Program@0",
          "SvelteStartTag 0-8 < SvelteScriptElement@0",
          "SvelteStartTag 36-53 < SvelteElement@36",
          "SvelteText 35-36 < Program@0",
          "VariableDeclaration 11-25 < SvelteScriptElement@0",
        ]
      `);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  // What svelte-eslint-parser 1.9.0 builds for each, as a JavaScript plugin rule sees it (`probe/component`): every
  // component node and every code node inside one, and the component nodes that contain the references to what blocks,
  // directives and snippets declare.
  test.each([
    [
      "names of directives that are code, and names of components with dots",
      "<C let:item><div use:item style:item>{item}</div></C><UI.Card.Sub use:a.b />",
      [
        "Identifier 1-2 < SvelteElement@0",
        "Identifier 21-25 < SvelteDirectiveKey@17",
        "Identifier 32-36 < SvelteDirectiveKey@26",
        "Identifier 38-42 < SvelteMustacheTag@37",
        "Identifier 54-56 < SvelteMemberExpressionName@54",
        "Identifier 7-11 < SvelteDirective@3",
        "MemberExpression 70-73 < SvelteDirectiveKey@66",
        "Program 0-76 < null",
        "SvelteDirective 17-25 < SvelteStartTag@12",
        "SvelteDirective 3-11 < SvelteStartTag@0",
        "SvelteDirective 66-73 < SvelteStartTag@53",
        "SvelteDirectiveKey 17-25 < SvelteDirective@17",
        "SvelteDirectiveKey 26-36 < SvelteStyleDirective@26",
        "SvelteDirectiveKey 3-11 < SvelteDirective@3",
        "SvelteDirectiveKey 66-73 < SvelteDirective@66",
        "SvelteElement 0-53 < Program@0",
        "SvelteElement 12-49 < SvelteElement@0",
        "SvelteElement 53-76 < Program@0",
        "SvelteEndTag 43-49 < SvelteElement@12",
        "SvelteEndTag 49-53 < SvelteElement@0",
        "SvelteMemberExpressionName 54-61 < SvelteMemberExpressionName@54",
        "SvelteMemberExpressionName 54-65 < SvelteElement@53",
        "SvelteMustacheTag 37-43 < SvelteElement@12",
        "SvelteName 13-16 < SvelteElement@12",
        "SvelteName 57-61 < SvelteMemberExpressionName@54",
        "SvelteName 62-65 < SvelteMemberExpressionName@54",
        "SvelteName 7-11 < SvelteDirectiveKey@3",
        "SvelteStartTag 0-12 < SvelteElement@0",
        "SvelteStartTag 12-37 < SvelteElement@12",
        "SvelteStartTag 53-76 < SvelteElement@53",
        "SvelteStyleDirective 26-36 < SvelteStartTag@12",
      ],
      [["item", ["SvelteDirectiveKey@17", "SvelteDirectiveKey@26", "SvelteMustacheTag@37"]]],
    ],
    [
      "clauses without children",
      "{#if a}{:else}{/if}{#each xs as x}{:else}{/each}{#await p}{:then v}{:catch e}{/await}{#await p then}{/await}",
      [
        "Identifier 26-28 < SvelteEachBlock@19",
        "Identifier 32-33 < SvelteEachBlock@19",
        "Identifier 5-6 < SvelteIfBlock@0",
        "Identifier 56-57 < SvelteAwaitBlock@48",
        "Identifier 65-66 < SvelteAwaitThenBlock@58",
        "Identifier 75-76 < SvelteAwaitCatchBlock@67",
        "Identifier 93-94 < SvelteAwaitBlock@85",
        "Program 0-108 < null",
        "SvelteAwaitBlock 48-85 < Program@0",
        "SvelteAwaitBlock 85-108 < Program@0",
        "SvelteAwaitCatchBlock 67-77 < SvelteAwaitBlock@48",
        "SvelteAwaitPendingBlock 48-58 < SvelteAwaitBlock@48",
        "SvelteAwaitThenBlock 58-67 < SvelteAwaitBlock@48",
        "SvelteAwaitThenBlock 85-100 < SvelteAwaitBlock@85",
        "SvelteEachBlock 19-48 < Program@0",
        "SvelteElseBlock 34-34 < SvelteEachBlock@19",
        "SvelteElseBlock 7-14 < SvelteIfBlock@0",
        "SvelteIfBlock 0-19 < Program@0",
      ],
      [
        ["x", []],
        ["v", []],
        ["e", []],
      ],
    ],
    [
      "names and parameters of snippets, and the two functions of a binding",
      "<script>let v = 1;</script>{#snippet row(a, {b}, ...c)}{a}{b}{c}{/snippet}{#snippet none()}n{/snippet}{@render row(1, {b: 2})}<input bind:value={() => v, (x) => (v = x)} />",
      [
        "ArrowFunctionExpression 145-152 < SvelteFunctionBindingsExpression@145",
        "ArrowFunctionExpression 154-168 < SvelteFunctionBindingsExpression@145",
        "CallExpression 111-125 < SvelteRenderTag@102",
        "Identifier 37-40 < SvelteSnippetBlock@27",
        "Identifier 41-42 < SvelteSnippetBlock@27",
        "Identifier 56-57 < SvelteMustacheTag@55",
        "Identifier 59-60 < SvelteMustacheTag@58",
        "Identifier 62-63 < SvelteMustacheTag@61",
        "Identifier 84-88 < SvelteSnippetBlock@74",
        "ObjectPattern 44-47 < SvelteSnippetBlock@27",
        "Program 0-172 < null",
        "RestElement 49-53 < SvelteSnippetBlock@27",
        "SvelteDirective 133-169 < SvelteStartTag@126",
        "SvelteDirectiveKey 133-143 < SvelteDirective@133",
        "SvelteElement 126-172 < Program@0",
        "SvelteEndTag 18-27 < SvelteScriptElement@0",
        "SvelteFunctionBindingsExpression 145-168 < SvelteDirective@133",
        "SvelteMustacheTag 55-58 < SvelteSnippetBlock@27",
        "SvelteMustacheTag 58-61 < SvelteSnippetBlock@27",
        "SvelteMustacheTag 61-64 < SvelteSnippetBlock@27",
        "SvelteName 1-7 < SvelteScriptElement@0",
        "SvelteName 127-132 < SvelteElement@126",
        "SvelteName 138-143 < SvelteDirectiveKey@133",
        "SvelteRenderTag 102-126 < Program@0",
        "SvelteScriptElement 0-27 < Program@0",
        "SvelteSnippetBlock 27-74 < Program@0",
        "SvelteSnippetBlock 74-102 < Program@0",
        "SvelteStartTag 0-8 < SvelteScriptElement@0",
        "SvelteStartTag 126-172 < SvelteElement@126",
        "SvelteText 91-92 < SvelteSnippetBlock@74",
        "VariableDeclaration 8-18 < SvelteScriptElement@0",
      ],
      [
        ["row", ["SvelteRenderTag@102"]],
        ["none", []],
        ["x", ["SvelteFunctionBindingsExpression@145"]],
        ["a", ["SvelteMustacheTag@55"]],
        ["b", ["SvelteMustacheTag@58"]],
        ["c", ["SvelteMustacheTag@61"]],
      ],
    ],
    [
      "generics of a script in TypeScript",
      '<script lang="ts" generics="T extends string, U = number">let a: T;</script>{a}',
      [
        "Identifier 77-78 < SvelteMustacheTag@76",
        "Program 0-79 < null",
        "SvelteAttribute 8-17 < SvelteStartTag@0",
        "SvelteEndTag 67-76 < SvelteScriptElement@0",
        "SvelteGenericsDirective 18-57 < SvelteStartTag@0",
        "SvelteLiteral 14-16 < SvelteAttribute@8",
        "SvelteMustacheTag 76-79 < Program@0",
        "SvelteName 1-7 < SvelteScriptElement@0",
        "SvelteName 18-26 < SvelteGenericsDirective@18",
        "SvelteName 8-12 < SvelteAttribute@8",
        "SvelteScriptElement 0-76 < Program@0",
        "SvelteStartTag 0-58 < SvelteScriptElement@0",
        "TSTypeParameter 28-44 < SvelteGenericsDirective@18",
        "TSTypeParameter 46-56 < SvelteGenericsDirective@18",
        "VariableDeclaration 58-67 < SvelteScriptElement@0",
      ],
      [
        ["T", ["SvelteScriptElement@0"]],
        ["U", []],
      ],
    ],
    [
      // typescript-eslint's parser throws on `out` in a function's type parameter.
      "generics that typescript-eslint's parser does not take for those of a function, as an attribute",
      '<script lang="ts" generics="out T, U">let a: T;</script>{a}',
      [
        "Identifier 57-58 < SvelteMustacheTag@56",
        "Program 0-59 < null",
        "SvelteAttribute 18-37 < SvelteStartTag@0",
        "SvelteAttribute 8-17 < SvelteStartTag@0",
        "SvelteEndTag 47-56 < SvelteScriptElement@0",
        "SvelteLiteral 14-16 < SvelteAttribute@8",
        "SvelteLiteral 28-36 < SvelteAttribute@18",
        "SvelteMustacheTag 56-59 < Program@0",
        "SvelteName 1-7 < SvelteScriptElement@0",
        "SvelteName 18-26 < SvelteAttribute@18",
        "SvelteName 8-12 < SvelteAttribute@8",
        "SvelteScriptElement 0-56 < Program@0",
        "SvelteStartTag 0-38 < SvelteScriptElement@0",
        "VariableDeclaration 38-47 < SvelteScriptElement@0",
      ],
      [],
    ],
    [
      "the two functions of a binding behind comments, which hold no parenthesis",
      "<input bind:value={/* ( */ get, set} /><input bind:value={/* a */ // b\n x, y} />",
      [
        "Identifier 27-30 < SvelteFunctionBindingsExpression@27",
        "Identifier 32-35 < SvelteFunctionBindingsExpression@27",
        "Identifier 72-73 < SvelteFunctionBindingsExpression@72",
        "Identifier 75-76 < SvelteFunctionBindingsExpression@72",
        "Program 0-80 < null",
        "SvelteDirective 46-77 < SvelteStartTag@39",
        "SvelteDirective 7-36 < SvelteStartTag@0",
        "SvelteDirectiveKey 46-56 < SvelteDirective@46",
        "SvelteDirectiveKey 7-17 < SvelteDirective@7",
        "SvelteElement 0-39 < Program@0",
        "SvelteElement 39-80 < Program@0",
        "SvelteFunctionBindingsExpression 27-35 < SvelteDirective@7",
        "SvelteFunctionBindingsExpression 72-76 < SvelteDirective@46",
        "SvelteName 1-6 < SvelteElement@0",
        "SvelteName 12-17 < SvelteDirectiveKey@7",
        "SvelteName 40-45 < SvelteElement@39",
        "SvelteName 51-56 < SvelteDirectiveKey@46",
        "SvelteStartTag 0-39 < SvelteElement@0",
        "SvelteStartTag 39-80 < SvelteElement@39",
      ],
      [],
    ],
    [
      // The last `{` before it is in the comment, and a line comment only ends at a line feed, so these aren't two
      // functions.
      "the value of a binding that is no two functions as a sequence, behind a brace in a comment or a line comment that ends at a carriage return",
      "<input bind:value={/* { */ get, set} /><input bind:value={// (\r get, set} />",
      [
        "Program 0-76 < null",
        "SequenceExpression 27-35 < SvelteDirective@7",
        "SequenceExpression 64-72 < SvelteDirective@46",
        "SvelteDirective 46-73 < SvelteStartTag@39",
        "SvelteDirective 7-36 < SvelteStartTag@0",
        "SvelteDirectiveKey 46-56 < SvelteDirective@46",
        "SvelteDirectiveKey 7-17 < SvelteDirective@7",
        "SvelteElement 0-39 < Program@0",
        "SvelteElement 39-76 < Program@0",
        "SvelteName 1-6 < SvelteElement@0",
        "SvelteName 12-17 < SvelteDirectiveKey@7",
        "SvelteName 40-45 < SvelteElement@39",
        "SvelteName 51-56 < SvelteDirectiveKey@46",
        "SvelteStartTag 0-39 < SvelteElement@0",
        "SvelteStartTag 39-76 < SvelteElement@39",
      ],
      [],
    ],
    [
      // Svelte decodes a text's references first. An `{#await}` keeps its texts.
      "blocks without the texts at either end that are white space once decoded",
      "{#if a}&#32;{:else}&nbsp;{/if}{#each xs as x}&#10;{:else}&Tab;{/each}{#key k}&#x20;x&nbsp{/key}{#await p}&nbsp;{/await}",
      [
        "Identifier 103-104 < SvelteAwaitBlock@95",
        "Identifier 37-39 < SvelteEachBlock@30",
        "Identifier 43-44 < SvelteEachBlock@30",
        "Identifier 5-6 < SvelteIfBlock@0",
        "Identifier 75-76 < SvelteKeyBlock@69",
        "Program 0-119 < null",
        "SvelteAwaitBlock 95-119 < Program@0",
        "SvelteAwaitPendingBlock 95-111 < SvelteAwaitBlock@95",
        "SvelteEachBlock 30-69 < Program@0",
        "SvelteElseBlock 12-25 < SvelteIfBlock@0",
        "SvelteElseBlock 50-62 < SvelteEachBlock@30",
        "SvelteIfBlock 0-30 < Program@0",
        "SvelteKeyBlock 69-95 < Program@0",
        "SvelteText 105-111 < SvelteAwaitPendingBlock@95",
        "SvelteText 77-89 < SvelteKeyBlock@69",
      ],
      [["x", []]],
    ],
  ])(
    "see the component as svelte-eslint-parser has it: %s",
    async (_, text, shape, references) => {
      const files = probing(text);
      if (text.includes('lang="ts"')) {
        Object.assign(files, typescriptParser, {
          "eslint.config.mjs": files["eslint.config.mjs"]
            .replace(
              'import parser from "svelte-eslint-parser";',
              '$&\nimport * as ts from "@typescript-eslint/parser";',
            )
            .replace("languageOptions: { parser }", "languageOptions: { parser, parserOptions: { parser: ts } }"),
        });
      }
      const result = await lint(files, ["-f", "json"]);
      const { nodes, bindings } = probed(result.raw);
      expect(nodes).toEqual(shape);
      expect(bindings.map(([name, , , refs]) => [name, refs])).toEqual(references);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "pass a markup sequence to the native rules as one expression, unless it's a binding's two functions",
    async () => {
      const text =
        "<input bind:value={/* { */ get, set} /><input bind:value={// (\r get, set} /><input bind:value={get, set} />{a, b}";
      const result = await lint(svelteRules(text, { "no-sequences": "error" }), ["-f", "json"], []);
      expect(summary(result.raw)).toMatchInlineSnapshot(`
        "a.svelte: 1:31 no-sequences Unexpected use of comma operator.
        a.svelte: 2:5 no-sequences Unexpected use of comma operator.
        a.svelte: 2:47 no-sequences Unexpected use of comma operator."
      `);
    },
    timeout,
  );

  // The references of each scope, and what each resolves to, as svelte-eslint-parser 1.9.0's scope manager has them:
  // `bind:` reads and writes, `$:` writes what it declares. The exported prop's write isn't a scope reference.
  test(
    "have the references of svelte-eslint-parser's scopes",
    async () => {
      const text = "<script>export let a; let b = 1; $: c = a + b;</script><input bind:value={b} />{c}";
      const result = await lint(probing(text), ["-f", "json"]);
      expect(probed(result.raw).references).toMatchInlineSnapshot(`
        [
          "a 40-41 r -> a@19-20",
          "b 26-27 w -> b@26-27",
          "b 44-45 r -> b@26-27",
          "b 74-75 rw -> b@26-27",
          "c 36-37 w -> c@36-37",
          "c 80-81 r -> c@36-37",
        ]
      `);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "see which component node each block scope stands for, where the blocks declare the same name",
    async () => {
      const text = [
        "<script>let value = 0, items = [], p;</script>",
        "{#each items as value}{#each value as value}{value}{/each}{/each}",
        "{#await p then value}{value}{:catch value}{value}{/await}",
        "<C let:value><i>{value}</i></C>",
        "{#snippet row(value)}{value}{/snippet}{@render row(value)}",
        "",
      ].join("\n");
      const result = await lint(probing(text), ["-f", "json"]);
      expect(probed(result.raw).bindings).toMatchInlineSnapshot(`
        [
          [
            "row",
            "Program@0",
            "SvelteSnippetBlock@203",
            [
              "SvelteRenderTag@241",
            ],
          ],
          [
            "value",
            "SvelteEachBlock@47",
            "SvelteEachBlock@47",
            [
              "SvelteEachBlock@69",
            ],
          ],
          [
            "value",
            "SvelteEachBlock@69",
            "SvelteEachBlock@69",
            [
              "SvelteMustacheTag@91",
            ],
          ],
          [
            "value",
            "SvelteAwaitThenBlock@113",
            "SvelteAwaitThenBlock@113",
            [
              "SvelteMustacheTag@134",
            ],
          ],
          [
            "value",
            "SvelteAwaitCatchBlock@141",
            "SvelteAwaitCatchBlock@141",
            [
              "SvelteMustacheTag@155",
            ],
          ],
          [
            "value",
            "SvelteElement@171",
            "SvelteElement@171",
            [
              "SvelteMustacheTag@187",
            ],
          ],
          [
            "value",
            "SvelteSnippetBlock@203",
            "SvelteSnippetBlock@203",
            [
              "SvelteMustacheTag@224",
            ],
          ],
        ]
      `);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );
});

// Each rule on a component where it reports something and leaves something alone, as ESLint reports it there.
describe.concurrent("eslint-plugin-svelte's native syntax rules", () => {
  test.each([
    [
      "no-dupe-else-if-blocks",
      "<script>let a, b;</script>\n{#if a || b}x{:else if b}y{:else if a && b}z{/if}\n{#if a}x{:else if b}y{/if}\n",
      "a.svelte: 2:24 svelte/no-dupe-else-if-blocks This branch can never execute. Its condition is a duplicate or covered by previous conditions in the `{#if}` / `{:else if}` chain.\na.svelte: 2:42 svelte/no-dupe-else-if-blocks This branch can never execute. Its condition is a duplicate or covered by previous conditions in the `{#if}` / `{:else if}` chain.",
    ],
    [
      "no-dupe-on-directives",
      "<script>let a, b;</script>\n<button on:click={a} on:click={ a } on:click={b} on:focus={a}>x</button>\n",
      "a.svelte: 2:9 svelte/no-dupe-on-directives This `on:click` directive is the same and duplicate directives in L2.\na.svelte: 2:22 svelte/no-dupe-on-directives This `on:click` directive is the same and duplicate directives in L2.",
    ],
    // In a `style` attribute's value, as eslint-plugin-svelte's safe CSS parser reads it: a mustache between
    // declarations stands for the strings it can evaluate to, and an at-rule or a mustache in a comment hides the whole
    // value.
    [
      "no-dupe-style-properties",
      '<div style="color: red; {x ? \'color: blue\' : \'margin: 0\'}; color: {c}"></div>\n<div style="color: red background: blue; background: x"></div>\n<div style="*colör: red; *colör: blue"></div>\n<div style:color="red" style="color: blue; /* color: x */"></div>\n<div style="color: red; @media x; color: blue"></div>\n<div style="color: red; /* {c} */ color: blue"></div>\n<div style="color: red; {x ? \'color: blue\' : \'color: green\'}"></div>\n<div style="{x ? \'color: blue\' : \'color: green\'}"></div>\n',
      "a.svelte: 1:13 svelte/no-dupe-style-properties Duplicate property 'color'.\na.svelte: 1:31 svelte/no-dupe-style-properties Duplicate property 'color'.\na.svelte: 1:60 svelte/no-dupe-style-properties Duplicate property 'color'.\na.svelte: 2:24 svelte/no-dupe-style-properties Duplicate property 'background'.\na.svelte: 2:42 svelte/no-dupe-style-properties Duplicate property 'background'.\na.svelte: 3:13 svelte/no-dupe-style-properties Duplicate property 'colör'.\na.svelte: 3:26 svelte/no-dupe-style-properties Duplicate property 'colör'.\na.svelte: 4:12 svelte/no-dupe-style-properties Duplicate property 'color'.\na.svelte: 4:31 svelte/no-dupe-style-properties Duplicate property 'color'.\na.svelte: 7:13 svelte/no-dupe-style-properties Duplicate property 'color'.\na.svelte: 7:31 svelte/no-dupe-style-properties Duplicate property 'color'.\na.svelte: 7:47 svelte/no-dupe-style-properties Duplicate property 'color'.",
    ],
    [
      "no-dupe-use-directives",
      "<script>let a;</script>\n<div use:act use:act={a} use:act|x use:act></div>\n",
      "a.svelte: 2:6 svelte/no-dupe-use-directives This `use:act` directive is the same and duplicate directives in L2.\na.svelte: 2:36 svelte/no-dupe-use-directives This `use:act` directive is the same and duplicate directives in L2.",
    ],
    [
      "no-inspect",
      "<script>\n  let n = $state(0);\n  $inspect(n);\n  const o = { $inspect, inspect: 1 };\n</script>\n<A {$inspect} />\n",
      "a.svelte: 3:3 svelte/no-inspect Do not use $inspect directive\na.svelte: 4:15 svelte/no-inspect Do not use $inspect directive\na.svelte: 4:15 svelte/no-inspect Do not use $inspect directive\na.svelte: 6:5 svelte/no-inspect Do not use $inspect directive\na.svelte: 6:5 svelte/no-inspect Do not use $inspect directive",
    ],
    [
      "no-object-in-text-mustaches",
      '<p>{{ a: 1 }} {[1]} {() => 1} {class {}} {x}</p>\n<A b={{ c: 1 }} d="e{{ f: 1 }}" />\n',
      "a.svelte: 1:4 svelte/no-object-in-text-mustaches Unexpected object in text mustache interpolation.\na.svelte: 1:15 svelte/no-object-in-text-mustaches Unexpected array in text mustache interpolation.\na.svelte: 1:21 svelte/no-object-in-text-mustaches Unexpected function in text mustache interpolation.\na.svelte: 1:31 svelte/no-object-in-text-mustaches Unexpected class in text mustache interpolation.\na.svelte: 2:21 svelte/no-object-in-text-mustaches Unexpected object in text mustache interpolation.",
    ],
    [
      "no-reactive-literals",
      "<svelte:options runes={false} />\n<script>\n  $: a = 1;\n  $: b = [c];\n</script>\n",
      "a.svelte: 3:3 svelte/no-reactive-literals Do not assign literal values inside reactive statements unless absolutely necessary. [1 suggestion]",
    ],
    [
      "no-shorthand-style-property-overrides",
      '<div style="margin-top: 1px; margin: 0; -webkit-margin-top: 1px; -webkit-margin: 0"></div>\n<div style="padding: 0; padding-top: 1px"></div>\n<div style="color: red; {`margin-top: ${a}`}; margin: 0; {\'border-top-color: red; border: 0\'}"></div>\n<div style:margin-left="1px" style:margin="0"></div>\n<div style="font-size: 1px; font-size: 2px font: x"></div>\n',
      "a.svelte: 1:30 svelte/no-shorthand-style-property-overrides Unexpected shorthand 'margin' after 'margin-top'.\na.svelte: 1:66 svelte/no-shorthand-style-property-overrides Unexpected shorthand '-webkit-margin' after '-webkit-margin-top'.\na.svelte: 3:47 svelte/no-shorthand-style-property-overrides Unexpected shorthand 'margin' after 'margin-top'.\na.svelte: 4:36 svelte/no-shorthand-style-property-overrides Unexpected shorthand 'margin' after 'margin-left'.\na.svelte: 5:44 svelte/no-shorthand-style-property-overrides Unexpected shorthand 'font' after 'font-size'.",
    ],
    [
      "no-svelte-internal",
      "<script>\n  import { noop } from 'svelte/internal';\n  import { onMount } from 'svelte';\n  export * from 'svelte/internal/client';\n</script>\n",
      "a.svelte: 2:3 svelte/no-svelte-internal Using svelte/internal is prohibited. This will be removed in Svelte 6.\na.svelte: 4:3 svelte/no-svelte-internal Using svelte/internal is prohibited. This will be removed in Svelte 6.",
    ],
    [
      "no-unknown-style-directive-property",
      '<div style:colour="red" style:color="red" style:--gap="1px" style:-webkit-x="1"></div>\n',
      "a.svelte: 1:12 svelte/no-unknown-style-directive-property Unexpected unknown style directive property 'colour'.",
    ],
    [
      "no-useless-children-snippet",
      "<Card>\n  {#snippet children()}x{/snippet}\n</Card>\n<List>\n  {#snippet children(item)}{item}{/snippet}\n</List>\n{#snippet header()}x{/snippet}\n<Box>{#snippet children(/* none */)}x{/snippet}</Box>\n",
      "a.svelte: 2:3 svelte/no-useless-children-snippet Found an unnecessary children snippet.\na.svelte: 8:6 svelte/no-useless-children-snippet Found an unnecessary children snippet.",
    ],
    [
      "no-useless-mustaches",
      "<p>{'a<b>'} {`c`} {'d\\n'} {e}</p>\n<img alt={'f'} title=\"g{'h'}\" />\n",
      'a.svelte: 1:4 svelte/no-useless-mustaches Unexpected mustache interpolation with a string literal value. [fix 3,11 "a&lt;b&gt;"]\na.svelte: 1:13 svelte/no-useless-mustaches Unexpected mustache interpolation with a string literal value. [fix 12,17 "c"]\na.svelte: 1:19 svelte/no-useless-mustaches Unexpected mustache interpolation with a string literal value.\na.svelte: 2:10 svelte/no-useless-mustaches Unexpected mustache interpolation with a string literal value. [fix 43,48 "\\"f\\""]\na.svelte: 2:24 svelte/no-useless-mustaches Unexpected mustache interpolation with a string literal value. [fix 57,62 "h"]',
    ],
    [
      "require-each-key",
      "{#each items as item}{/each}\n{#each items as item (item.id)}{/each}\n{#each { length: 3 }}{/each}\n",
      "a.svelte: 1:1 svelte/require-each-key Each block should have a key",
    ],
  ])(
    "svelte/%s",
    async (rule, text, expected) => {
      const result = await lint(svelteRules(text, { [`svelte/${rule}`]: "error" }), ["-f", "json"], []);
      expect(summary(result.raw)).toBe(expected);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  // The safe parser makes a separate declaration of what follows each word before another `:`, one after another.
  test(
    "svelte/no-dupe-style-properties reads a value of 100,000 declarations without a `;` between them",
    async () => {
      const declarations = Array.from({ length: 100_000 }, (_, i) => `p${i}:v`).join(" ");
      const text = `<div style="${declarations} p7:v"></div>\n`;
      const result = await lint(svelteRules(text, { "svelte/no-dupe-style-properties": "error" }), ["-f", "json"]);
      expect(summary(result.raw)).toBe(
        "a.svelte: 1:48 svelte/no-dupe-style-properties Duplicate property 'p7'.\n" +
          `a.svelte: 1:${13 + declarations.length + 1} svelte/no-dupe-style-properties Duplicate property 'p7'.`,
      );
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  // The parser builds `a || b || c` and `a.b.c` without recursion, and declares any number of constants that name each
  // other. Each input is deep enough to overflow a debug build's stack in a rule that recurses on it.
  const constants = (count: number, last: string) =>
    Array.from({ length: count }, (_, i) => `const v${i + 1} = ${i ? `v${i}` : last};`).join("\n");
  test.each([
    [
      "no-dupe-else-if-blocks",
      `<script>let a, b;</script>\n{#if ${repeated("a || ", 100_000)}b}x{:else if b}y{/if}\n`,
      `a.svelte: 2:${5 + 500_000 + 1 + 13} svelte/no-dupe-else-if-blocks This branch can never execute. Its condition is a duplicate or covered by previous conditions in the \`{#if}\` / \`{:else if}\` chain.`,
    ],
    [
      "no-immutable-reactive-statements",
      `<script>\n  let x = {};\n  $: y = x${repeated(".a", 40_000)};\n</script>\n`,
      "a.svelte: 3:10 svelte/no-immutable-reactive-statements This statement is not reactive because all variables referenced in the reactive statement are immutable.",
    ],
    [
      "no-not-function-handler",
      `<script>\n${constants(50_000, "{}")}\n</script>\n<button on:click={v50000}>x</button>\n`,
      "a.svelte: 50003:19 svelte/no-not-function-handler Unexpected object in event handler.",
    ],
  ])(
    "svelte/%s on deeply nested code",
    async (rule, text, expected) => {
      const result = await lint(svelteRules(text, { [`svelte/${rule}`]: "error" }), ["-f", "json"], []);
      expect(summary(result.raw)).toBe(expected);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "run under the runes, Svelte and SvelteKit context that eslint-plugin-svelte finds",
    async () => {
      const page = "<script>\n  let { data, user } = $props();\n  $: a = 1;\n  $inspect(data);\n</script>\n";
      const module = '<script context="module">\n  export function load() {}\n</script>\n';
      const rules = Object.fromEntries(
        [
          "no-reactive-literals",
          "no-inspect",
          "valid-prop-names-in-kit-pages",
          "no-export-load-in-svelte-module-in-kit-pages",
        ].map(it => [`svelte/${it}`, "error"]),
      );
      const files = {
        ...svelteRules(page, rules),
        "package.json": JSON.stringify({ name: "app", devDependencies: { "@sveltejs/kit": "^2.5.0" } }),
        // What svelte-eslint-parser reads from it without running it.
        "svelte.config.js":
          "const files = { routes: 'app/pages' };\nexport default { kit: { files }, compilerOptions: { runes: false } };\n",
        "app/pages/+page.svelte": page,
        "app/pages/+layout.svelte": module,
        "src/routes/+page.svelte": page,
      };
      delete files["a.svelte"];
      const result = await lint(files, ["-f", "json"], []);
      // Only in the config's routes, and without runes there.
      const literal =
        "svelte/no-reactive-literals Do not assign literal values inside reactive statements unless absolutely necessary.";
      expect(summary(result.raw)).toBe(
        [
          "+layout.svelte: 2:19 svelte/no-export-load-in-svelte-module-in-kit-pages disallow exporting load functions in `*.svelte` module in SvelteKit page components.",
          "+page.svelte: 2:15 svelte/valid-prop-names-in-kit-pages disallow invalid props in SvelteKit route components.",
          `+page.svelte: 3:3 ${literal} [1 suggestion]`,
          `+page.svelte: 3:3 ${literal} [1 suggestion]`,
        ].join("\n"),
      );
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "svelte/no-reactive-functions throws like it does under ESLint 10",
    async () => {
      const text =
        "<svelte:options runes={false} />\n<script>\n  $: format = (value) => value.toFixed(2);\n</script>\n";
      const result = await lint(svelteRules(text, { "svelte/no-reactive-functions": "error" }), ["-f", "json"]);
      expect(result.stderr).toContain(
        'TypeError: source.isSpaceBetweenTokens is not a function\nOccurred while linting <dir>/a.svelte:3\nRule: "svelte/no-reactive-functions"',
      );
      expect(result.exitCode).toBe(2);
    },
    timeout,
  );

  // svelte/no-inspect listens to every `Identifier` in ESLint's tree, and svelte-eslint-parser finds runes by them: a
  // `generics` type parameter is one, and an import without `as` has two.
  const inspected = (text: string) => {
    const rules = { "svelte/no-inspect": "error", "svelte/no-reactive-literals": "error" };
    return {
      ...svelteRules(text, {}),
      ...typescriptParser,
      "eslint.config.mjs": `
          import parser from "svelte-eslint-parser";
          import svelte from "eslint-plugin-svelte";
          import * as ts from "@typescript-eslint/parser";
          export default [{
            files: ["**/*.svelte"],
            languageOptions: { parser, parserOptions: { parser: { ts } } },
            plugins: { svelte },
            rules: ${JSON.stringify(rules)},
          }];`,
    };
  };
  test.each([
    [
      '<script lang="ts" generics="$inspect"></script>\n',
      "a.svelte: 1:29 svelte/no-inspect Do not use $inspect directive",
    ],
    [
      '<script lang="ts">\n  import { type $inspect } from "x";\n</script>\n',
      "a.svelte: 2:17 svelte/no-inspect Do not use $inspect directive\na.svelte: 2:17 svelte/no-inspect Do not use $inspect directive",
    ],
    ['<script lang="ts" generics="$state">\n  $: a = 1;\n</script>\n', ""],
  ])(
    "svelte/no-inspect and svelte/no-reactive-literals on %j",
    async (text, expected) => {
      const result = await lint(inspected(text), ["-f", "json"], []);
      expect(summary(result.raw)).toBe(expected);
    },
    timeout,
  );

  test(
    "svelte/no-inspect reports a generics type parameter whose name has an escape, at its source position",
    async () => {
      const result = await lint(inspected('<script lang="ts" generics="\\u0024inspect"></script>\n'), ["-f", "json"]);
      const [{ messages }] = JSON.parse(result.raw);
      expect(messages.map((it: Record<string, number>) => [it.line, it.column, it.endLine, it.endColumn])).toEqual([
        [1, 29, 1, 42],
      ]);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  // svelte-eslint-parser reads `svelte.config.js` without running it, including destructured constants: in an object
  // pattern it follows the first property with a name, wherever the name it looks for is.
  test.each([
    ["destructured", "const { runes } = { runes: false };\nexport default { compilerOptions: { runes } };\n", false],
    [
      "destructured deeper",
      "const { compilerOptions } = { compilerOptions: { runes: false } };\nexport default { compilerOptions };\n",
      false,
    ],
    [
      "destructured with a default",
      "const { runes = false } = {};\nexport default { compilerOptions: { runes } };\n",
      false,
    ],
    [
      "destructured after another property",
      "const { a, runes } = { a: 1, runes: false };\nexport default { compilerOptions: { runes } };\n",
      true,
    ],
    ["as `0n`, which is falsy", "export default { compilerOptions: { runes: 0n } };\n", false],
    ["as `0x0n`, which is falsy", "export default { compilerOptions: { runes: 0x0n } };\n", false],
    ["as `1n`", "export default { compilerOptions: { runes: 1n } };\n", true],
  ])(
    "the runes mode of a svelte.config.js that has it %s",
    async (_, config, runes) => {
      const text = "<script>\n  $: x = 1;\n  $inspect(x);\n</script>\n";
      const rules = { "svelte/no-reactive-literals": "error", "svelte/no-inspect": "error" };
      const files = { ...svelteRules(text, rules), "svelte.config.js": config };
      const result = await lint(files, ["-f", "json"], []);
      expect(summary(result.raw)).toBe(
        runes
          ? "a.svelte: 3:3 svelte/no-inspect Do not use $inspect directive"
          : "a.svelte: 2:3 svelte/no-reactive-literals Do not assign literal values inside reactive statements unless absolutely necessary. [1 suggestion]",
      );
    },
    timeout,
  );

  test(
    "reads the routes of a svelte.config.js that destructures them",
    async () => {
      const module = '<script context="module">\n  export function load() {}\n</script>\n';
      const rules = { "svelte/no-export-load-in-svelte-module-in-kit-pages": "error" };
      const files = {
        ...svelteRules(module, rules),
        "package.json": JSON.stringify({ name: "app", devDependencies: { "@sveltejs/kit": "^2.5.0" } }),
        "svelte.config.js": "const { files } = { files: { routes: 'pages' } };\nexport default { kit: { files } };\n",
        "pages/+page.svelte": module,
        "src/routes/+layout.svelte": module,
      };
      delete files["a.svelte"];
      const result = await lint(files, ["-f", "json"], []);
      expect(summary(result.raw)).toBe(
        "+page.svelte: 2:19 svelte/no-export-load-in-svelte-module-in-kit-pages disallow exporting load functions in `*.svelte` module in SvelteKit page components.",
      );
    },
    timeout,
  );

  // svelte-eslint-parser parses `svelte.config.js` with espree before the component, and espree's error becomes the
  // component's parsing error, at its position in the config.
  test.each([
    ["export default { compilerOptions: ;\n", "1:35 2 null Parsing error: Unexpected token ;"],
    [
      "export default { compilerOptions: { runes: false } } satisfies Config;\n",
      "1:54 2 null Parsing error: Unexpected token satisfies",
    ],
  ])(
    "a svelte.config.js that espree cannot parse: %j",
    async (config, expected) => {
      const rules = { "svelte/no-inspect": "error" };
      const files = { ...svelteRules("<script>\n  $inspect(1);\n</script>\n", rules), "svelte.config.js": config };
      const result = await lint(files, ["-f", "json"], []);
      expect(places(result.raw)).toEqual([expected]);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  // ESLint 10.11.0 with svelte-eslint-parser 1.9.0, as a non-root user: what `readFileSync` throws, without a position.
  test.skipIf(isWindows || process.getuid?.() === 0)(
    "a svelte.config.js that cannot be read",
    async () => {
      const rules = { "svelte/no-inspect": "error" };
      const files = {
        ...svelteRules("<script>\n  $inspect(1);\n</script>\n", rules),
        "svelte.config.js": "export default { compilerOptions: { runes: true } };\n",
      };
      const locked = (dir: string) => chmodSync(join(dir, "svelte.config.js"), 0);
      const result = await lint(files, ["-f", "json", "a.svelte"], [], {}, undefined, locked);
      expect(JSON.parse(result.stdout)[0].messages).toEqual([
        {
          ruleId: null,
          fatal: true,
          severity: 2,
          message: "Parsing error: EACCES: permission denied, open '<dir>/svelte.config.js'",
        },
      ]);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  // `getSvelteKitContext` calls `replace` on the routes, which every eslint-plugin-svelte rule requests when ESLint
  // creates it, after the component is parsed.
  test.each([
    ['<script context="module">\n  export function load() {}\n</script>\n', []],
    ["<script>const =;</script>\n", ["1:15 2 null Parsing error: Unexpected token ="]],
  ])(
    "routes of SvelteKit that are no string make the first rule of eslint-plugin-svelte fail to load on %j",
    async (text, parseErrors) => {
      const rules = {
        "no-undef": "error",
        "svelte/no-export-load-in-svelte-module-in-kit-pages": "error",
        "svelte/no-inspect": "error",
      };
      const files = {
        ...svelteRules(text, rules),
        "package.json": JSON.stringify({ name: "app", devDependencies: { "@sveltejs/kit": "^2.5.0" } }),
        "svelte.config.js": "export default { kit: { files: { routes: 42 } } };\n",
        "src/routes/+page.svelte": text,
      };
      delete files["a.svelte"];
      const result = await lint(files, ["-f", "json", "src/routes/+page.svelte"], []);
      if (parseErrors.length) {
        expect(places(result.raw)).toEqual(parseErrors);
        expect(result.exitCode).toBe(1);
        return;
      }
      expect(result.stderr).toContain(
        "Error while loading rule 'svelte/no-export-load-in-svelte-module-in-kit-pages': ((intermediate value) ?? (intermediate value))?.replace is not a function\nOccurred while linting <dir>/src/routes/+page.svelte",
      );
      expect(result.exitCode).toBe(2);
    },
    timeout,
  );

  // ESLint creates the rules in config order, and the first failure's error ends the run. The fake `eslint` throws what
  // ESLint's `Linter` makes of the error. `local/boom` is off, and the comment that turns it on makes ESLint run it.
  test.each([["svelte/no-inspect", "((intermediate value) ?? (intermediate value))?.replace is not a function"]])(
    "where the routes of SvelteKit are no string, a rule that fails to load before one that only ESLint runs is %s",
    async (first, said) => {
      const rules = { "svelte/no-inspect": "error", "local/boom": "off" };
      const files = {
        ...svelteRules('<script>/* eslint local/boom: "error" */</script>\n<p></p>\n', {}),
        "package.json": JSON.stringify({ name: "app", devDependencies: { "@sveltejs/kit": "^2.5.0" } }),
        "svelte.config.js": "export default { kit: { files: { routes: 42 } } };\n",
        "eslint.config.mjs": `
          import parser from "svelte-eslint-parser";
          import svelte from "eslint-plugin-svelte";
          const boom = { create() { throw new Error("Error while loading rule 'local/boom': Local failure"); } };
          export default [{
            files: ["**/*.svelte"],
            languageOptions: { parser },
            plugins: { svelte, local: { rules: { boom } } },
            rules: ${JSON.stringify(rules)},
          }];`,
      };
      const result = await lint(files, ["-f", "json", "a.svelte"], []);
      expect(result.stderr).toContain(`Error while loading rule '${first}': ${said}`);
      expect(result.exitCode).toBe(2);
    },
    timeout,
  );

  // `svelte/late`, which has no native port, only ESLint runs, so ESLint runs `local/early` too. ESLint creates all
  // rules in config order before it visits a node, so the first one that throws while being created fails.
  test.each([
    [["local/early", "svelte/late"], "Error while loading rule 'local/early': EARLY"],
    [["svelte/late", "local/early"], "Error while loading rule 'svelte/late': LATE"],
  ])(
    "of the rules %j, one of a plugin and one that only ESLint runs, the first that fails to load fails",
    async (order, said) => {
      const rules = Object.fromEntries(order.map(it => [it, "error"]));
      const files = {
        ...svelteRules("<p></p>\n", {}),
        ...sveltePackage(`{ late: { create() { throw new Error("LATE"); } } }`),
        ...eslintTen(true),
        "eslint.config.mjs": `
        import parser from "svelte-eslint-parser";
        import svelte from "eslint-plugin-svelte";
        const early = { create() { throw new Error("EARLY"); } };
        export default [{
          files: ["**/*.svelte"],
          languageOptions: { parser },
          plugins: { svelte, local: { rules: { early } } },
          rules: ${JSON.stringify(rules)},
        }];`,
      };
      const result = await lint(files, ["-f", "json", "a.svelte"], []);
      expect(result.stderr).toContain(said);
      expect(result.exitCode).toBe(2);
    },
    timeout,
  );

  // A fake `eslint` that sets the rules up and calls their listeners the way ESLint 10's `runRules` does, and reports
  // their throws the way its `Linter` does. Its configs have `getRuleDefinition`, so the worker traces the rules that
  // only it runs.
  const settingUpEslint = {
    "node_modules/eslint/lib/config/flat-config-array.js": `
      exports.FlatConfigArray = class extends Array {
        constructor(configs) {
          super();
          this.push(...configs);
        }
        normalize() {}
        getConfig() {
          const [rules, plugins] = ["rules", "plugins"].map(key => Object.assign({}, ...Array.from(this, it => it[key])));
          return { ...Object.assign({}, ...this), rules, plugins, getRuleDefinition(id) { const [prefix, name] = id.split("/"); return this.plugins[prefix]?.rules[name]; } };
        }
      };`,
    "node_modules/eslint/index.js": `
      "use strict";
      exports.Linter = class {
        verify(text, configs, { filename, ruleFilter }) {
          const config = configs.getConfig(filename);
          const program = { type: "Program", range: [0, text.length], loc: { start: { line: 1, column: 0 } } };
          try {
            const listeners = [];
            for (const [ruleId, setting] of Object.entries(config.rules)) {
              const [severity] = [setting].flat();
              if (severity === "off" || severity === 0 || !ruleFilter({ ruleId, severity: 2 })) continue;
              let made;
              try {
                made = config.getRuleDefinition(ruleId).create({ id: ruleId, report() {} });
              } catch (ex) {
                ex.message = \`Error while loading rule '\${ruleId}': \${ex.message}\`;
                throw ex;
              }
              if (made == null) throw new Error(\`The create() function for rule '\${ruleId}' did not return an object.\`);
              for (const key of Object.keys(made)) listeners.push([ruleId, made[key]]);
            }
            for (const [ruleId, listener] of listeners) {
              try {
                listener(program);
              } catch (error) {
                Object.assign(error, { ruleId, currentNode: program });
                throw error;
              }
            }
          } catch (err) {
            err.message += \`\\nOccurred while linting \${filename}\`;
            if (err.currentNode) err.message += \`:\${err.currentNode.loc.start.line}\`;
            if (err.ruleId) err.message += \`\\nRule: "\${err.ruleId}"\`;
            throw err;
          }
          return [];
        }
        getSuppressedMessages() {
          return [];
        }
      };`,
  };

  // `local/early` throws in `create`. `svelte/late`, which has no native port, only ESLint runs, so it runs both.
  // ESLint creates all rules before it calls a listener, so a throw from a `svelte/late` listener comes after
  // `local/early` in either order, even when its message looks like a rule that failed to load. If `svelte/late` fails
  // while ESLint sets it up, without saying it failed to load, it fails first if it comes first. The expected output is
  // what ESLint 10.11.0 says with the same rules.
  test.each([
    ["has a listener whose error says it failed to load", "listener", "early", "local/early"],
    ["has a listener whose error says it failed to load", "listener", "late", "local/early"],
    ["throws a string in create", "string", "early", "local/early"],
    ["throws a string in create", "string", "late", "svelte/late"],
    ["has a listener that throws as ESLint reads it", "getter", "early", "local/early"],
    ["has a listener that throws as ESLint reads it", "getter", "late", "svelte/late"],
  ])(
    "where the rule that only ESLint runs %s, of it and one of a plugin the first to fail as it is set up fails (%s, %s first)",
    async (_, kind, first, fails) => {
      const late = {
        listener: `create() { return { Program() { throw new Error("Error while loading rule 'svelte/late': LATE"); } }; }`,
        string: `create() { throw "late string"; }`,
        getter: `create() { return { get Program() { throw new Error("getter failure"); } }; }`,
      }[kind];
      const said = {
        "local/early": "Error while loading rule 'local/early': EARLY",
        "svelte/late":
          kind === "string" ? "Cannot create property 'message' on string 'late string'" : "getter failure",
      }[fails];
      const order = first === "early" ? ["local/early", "svelte/late"] : ["svelte/late", "local/early"];
      const files = {
        ...svelteRules("<p></p>\n", {}),
        ...sveltePackage(`{ late: { ${late} } }`),
        ...settingUpEslint,
        "eslint.config.mjs": `
        import parser from "svelte-eslint-parser";
        import svelte from "eslint-plugin-svelte";
        const early = { create() { throw new Error("EARLY"); } };
        export default [{
          files: ["**/*.svelte"],
          languageOptions: { parser },
          plugins: { svelte, local: { rules: { early } } },
          rules: ${JSON.stringify(Object.fromEntries(order.map(it => [it, "error"])))},
        }];`,
      };
      const result = await lint(files, ["-f", "json", "a.svelte"], []);
      expect(result.stderr).toBe(`error: ${said}\nOccurred while linting <dir>/a.svelte`);
      expect(result.exitCode).toBe(2);
    },
    timeout,
  );

  // `svelte/keys`, which only ESLint runs, returns listeners whose keys can't be read. ESLint reads them after creating
  // the rule, so that throw doesn't say the rule failed to load. The expected output is what ESLint 10.11.0 says.
  test(
    "a rule that only ESLint runs whose listeners throw while ESLint reads their keys fails like in ESLint",
    async () => {
      const files = {
        ...svelteRules("<p></p>\n", {}),
        ...sveltePorts(`keys: { create: () => new Proxy({}, { ownKeys() { throw new Error("keys failure"); } }) },`),
        ...eslintTen(true),
        "eslint.config.mjs": `
          import parser from "svelte-eslint-parser";
          import svelte from "eslint-plugin-svelte";
          export default [{ files: ["**/*.svelte"], languageOptions: { parser }, plugins: { svelte },
            rules: { "svelte/keys": "error" } }];`,
      };
      const result = await lint(files, ["-f", "json", "a.svelte"], []);
      expect(result.stderr).toBe("error: keys failure\nOccurred while linting <dir>/a.svelte");
      expect(result.exitCode).toBe(2);
    },
    timeout,
  );

  // A comment configures `local/bad`, so only ESLint runs it. `svelte/no-inspect` fails to load when SvelteKit's routes
  // aren't a string. ESLint parses the listener keys as selectors and calls the listeners after creating every rule, so
  // a throw from `local/bad` there comes after `svelte/no-inspect` in either order, including when the `eslint` has no
  // `SourceCodeTraverser`, whose traversal signals that every rule is set up. It reads the keys and listeners while
  // setting `local/bad` up, so their throws fail first if `local/bad` comes first. The expected output is what ESLint
  // 10.11.0 says with the same rules and comment.
  const loading =
    "Error while loading rule 'svelte/no-inspect': ((intermediate value) ?? (intermediate value))?.replace is not a function";
  test.each(
    [
      ["a key that is no selector", `{ "Program[": () => {} }`, loading],
      ["a listener that is no function", "{ Program: 5 }", loading],
      [
        "a listener that throws as it is read",
        `{ get Program() { throw new Error("getter failure"); } }`,
        "getter failure",
      ],
      [
        "keys that throw as they are read",
        `new Proxy({}, { ownKeys() { throw new Error("keys failure"); } })`,
        "keys failure",
      ],
      [
        "a function whose listener throws as it is read",
        `Object.defineProperty(() => {}, "Program", { enumerable: true, get() { throw new Error("getter failure"); } })`,
        "getter failure",
      ],
    ].flatMap(([what, listeners, ifFirst]) =>
      [true, false].flatMap(withTraverser =>
        ["bad", "native"].map(first => [what, withTraverser, first, listeners, first === "bad" ? ifFirst : loading]),
      ),
    ),
  )(
    "of a rule that only ESLint runs with %s and one here that fails to load, the first to fail as it is set up fails (traverser: %p, %s first)",
    async (_, withTraverser, first, listeners, said) => {
      const order = first === "bad" ? ["local/bad", "svelte/no-inspect"] : ["svelte/no-inspect", "local/bad"];
      const files = {
        ...svelteRules('<script>/* eslint local/bad: "error" */</script>\n<p></p>\n', {}),
        ...eslintTen(withTraverser as boolean),
        "package.json": JSON.stringify({ name: "app", devDependencies: { "@sveltejs/kit": "^2.5.0" } }),
        "svelte.config.js": "export default { kit: { files: { routes: 42 } } };\n",
        "eslint.config.mjs": `
          import parser from "svelte-eslint-parser";
          import svelte from "eslint-plugin-svelte";
          const bad = { create: () => (${listeners}) };
          export default [{ files: ["**/*.svelte"], languageOptions: { parser }, plugins: { svelte, local: { rules: { bad } } },
            rules: ${JSON.stringify(Object.fromEntries(order.map(it => [it, "error"])))} }];`,
      };
      const result = await lint(files, ["-f", "json", "a.svelte"], []);
      expect(result.stderr).toBe(`error: ${said}\nOccurred while linting <dir>/a.svelte`);
      expect(result.exitCode).toBe(2);
    },
    timeout,
  );

  // `local/bad` returns its listeners as properties of a function, which ESLint reads like an object. `svelte/late`,
  // which has no native port, has ESLint run `local/bad` too. ESLint reports on leaving the `Program` after
  // `svelte/no-at-html-tags` reports on entering `{@html x}` at the same position, whatever the rule order. The
  // expected output is what ESLint 10.11.0 says with the same rules.
  test(
    "a rule that only ESLint runs and returns its listeners on a function reports in ESLint's order",
    async () => {
      const files = {
        ...svelteRules("{@html x}\n", {}),
        ...sveltePorts(`late: { create: () => ({}) },`),
        ...eslintTen(false),
        "eslint.config.mjs": `
          import parser from "svelte-eslint-parser";
          import svelte from "eslint-plugin-svelte";
          const bad = { create: context => Object.assign(() => {}, { "Program:exit"(node) { context.report({ node, message: "Bad." }); } }) };
          export default [{ files: ["**/*.svelte"], languageOptions: { parser }, plugins: { svelte, local: { rules: { bad } } },
            rules: { "local/bad": "error", "svelte/no-at-html-tags": "error", "svelte/late": "error" } }];`,
      };
      const result = await lint(files, ["-f", "json", "a.svelte"]);
      expect(summary(result.raw)).toBe(
        "a.svelte: 1:1 svelte/no-at-html-tags `{@html}` can lead to XSS attack.\na.svelte: 1:1 local/bad Bad.",
      );
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  // `local/boom` runs natively, in the host, and throws while being created.
  test.each([
    [["local/boom", "svelte/no-inspect"], "local/boom", "Local failure"],
    [
      ["svelte/no-inspect", "local/boom"],
      "svelte/no-inspect",
      "((intermediate value) ?? (intermediate value))?.replace is not a function",
    ],
  ])(
    "where the routes of SvelteKit are no string, of the rules %j the first that fails to load is %s",
    async (order, first, said) => {
      const rules = Object.fromEntries(order.map(it => [it, "error"]));
      const files = {
        ...svelteRules("<p></p>\n", {}),
        "package.json": JSON.stringify({ name: "app", devDependencies: { "@sveltejs/kit": "^2.5.0" } }),
        "svelte.config.js": "export default { kit: { files: { routes: 42 } } };\n",
        "eslint.config.mjs": `
          import parser from "svelte-eslint-parser";
          import svelte from "eslint-plugin-svelte";
          const boom = { create() { throw new Error("Local failure"); } };
          export default [{
            files: ["**/*.svelte"],
            languageOptions: { parser },
            plugins: { svelte, local: { rules: { boom } } },
            rules: ${JSON.stringify(rules)},
          }];`,
      };
      const result = await lint(files, ["-f", "json", "a.svelte"], []);
      expect(result.stderr).toContain(`Error while loading rule '${first}': ${said}`);
      expect(result.exitCode).toBe(2);
    },
    timeout,
  );

  // An earlier rule that fails while being set up fails first, even if its error doesn't say it failed to load.
  test.each([
    ["returns nothing", "create() {}", "The create() function for rule 'local/empty' did not return an object."],
    [
      "returns null",
      "create() { return null; }",
      "The create() function for rule 'local/empty' did not return an object.",
    ],
    [
      "throws a string",
      'create() { throw "local string"; }',
      "Cannot create property 'message' on string 'local string'",
    ],
    [
      "has a listener that throws as it is read",
      'create() { return { get Program() { throw new Error("getter failure"); } }; }',
      "getter failure",
    ],
  ])(
    "where the routes of SvelteKit are no string, a rule before the one that fails to load that %s fails first",
    async (_, create, said) => {
      const files = {
        ...svelteRules("<p></p>\n", {}),
        "package.json": JSON.stringify({ name: "app", devDependencies: { "@sveltejs/kit": "^2.5.0" } }),
        "svelte.config.js": "export default { kit: { files: { routes: 42 } } };\n",
        "eslint.config.mjs": `
          import parser from "svelte-eslint-parser";
          import svelte from "eslint-plugin-svelte";
          const empty = { ${create} };
          export default [{
            files: ["**/*.svelte"],
            languageOptions: { parser },
            plugins: { svelte, local: { rules: { empty } } },
            rules: { "local/empty": "error", "svelte/no-inspect": "error" },
          }];`,
      };
      const result = await lint(files, ["-f", "json", "a.svelte"], []);
      expect(result.stderr).toContain(`error: ${said}\nOccurred while linting <dir>/a.svelte`);
      expect(result.exitCode).toBe(2);
    },
    timeout,
  );

  // `local/touch` runs in the host. ESLint creates the rules before the one that fails to load, and calls no listener.
  test.each([
    [["local/touch", "svelte/no-inspect"], "create\n"],
    [["svelte/no-inspect", "local/touch"], ""],
  ])(
    "where the routes of SvelteKit are no string, of the rules %j only those before the one that fails to load are made",
    async (order, events) => {
      const rules = Object.fromEntries(order.map(it => [it, "error"]));
      const files = {
        ...svelteRules("<p></p>\n", {}),
        "package.json": JSON.stringify({ name: "app", devDependencies: { "@sveltejs/kit": "^2.5.0" } }),
        "svelte.config.js": "export default { kit: { files: { routes: 42 } } };\n",
        "events.txt": "",
        "eslint.config.mjs": `
          import { appendFileSync } from "node:fs";
          import parser from "svelte-eslint-parser";
          import svelte from "eslint-plugin-svelte";
          const events = new URL("./events.txt", import.meta.url);
          const touch = {
            create() {
              appendFileSync(events, "create\\n");
              return { Program() { appendFileSync(events, "visit\\n"); } };
            },
          };
          export default [{
            files: ["**/*.svelte"],
            languageOptions: { parser },
            plugins: { svelte, local: { rules: { touch } } },
            rules: ${JSON.stringify(rules)},
          }];`,
      };
      const result = await lint(files, ["-f", "json", "a.svelte"], ["events.txt"]);
      expect(result.files["events.txt"]).toBe(events);
      expect(result.stderr).toContain(
        "Error while loading rule 'svelte/no-inspect': ((intermediate value) ?? (intermediate value))?.replace is not a function",
      );
      expect(result.exitCode).toBe(2);
    },
    timeout,
  );

  // A `svelte/compiler` that warns about each `<img` without an `alt` and each `WARN`, and fails on `FAIL`, and a
  // `typescript` that leaves the code unchanged, with a source map for that. Each compilation is a line in
  // `compiled.txt`.
  const fakeCompiler = {
    "node_modules/svelte/package.json": JSON.stringify({
      name: "svelte",
      version: "5.57.2",
      exports: { "./compiler": "./compiler.js", "./package.json": "./package.json" },
    }),
    "node_modules/svelte/compiler.js": `
      const { appendFileSync } = require("node:fs");
      const loc = (code, at) => {
        const before = code.slice(0, at);
        return { line: before.split("\\n").length, column: at - before.lastIndexOf("\\n") - 1, character: at };
      };
      exports.VERSION = "5.57.2";
      exports.compile = (code, options) => {
        appendFileSync("compiled.txt", JSON.stringify(options) + "\\n");
        if (code.includes("FAIL")) throw Object.assign(new Error("Failed."), { code: "js_parse_error" });
        const warnings = [];
        for (const [pattern, code_] of [[/<img(?![^>]*alt)[^>]*>/g, "a11y_missing_attribute"], [/WARN/g, "state_referenced_locally"]])
          for (const it of code.matchAll(pattern))
            warnings.push({ code: code_, start: loc(code, it.index), end: loc(code, it.index + it[0].length) });
        return { warnings };
      };`,
    "node_modules/typescript/package.json": JSON.stringify({ name: "typescript", version: "6.0.3", main: "index.js" }),
    "node_modules/typescript/index.js": `
      exports.ScriptTarget = { ESNext: 99 };
      exports.ModuleKind = { ESNext: 99 };
      exports.ImportsNotUsedAsValues = { Preserve: 1 };
      exports.transpileModule = code => ({
        outputText: code,
        sourceMapText: JSON.stringify({ mappings: code.split("\\n").map((_, i) => (i ? "AACA" : "AAAA")).join(";") }),
      });`,
  };

  const ignoring = (text: string) => ({
    ...svelteRules(text, {}),
    ...typescriptParser,
    ...fakeCompiler,
    "eslint.config.mjs": `
      import parser from "svelte-eslint-parser";
      import svelte from "eslint-plugin-svelte";
      import * as ts from "@typescript-eslint/parser";
      export default [{
        files: ["**/*.svelte"],
        languageOptions: { parser, parserOptions: { parser: ts } },
        plugins: { svelte },
        rules: { "svelte/no-unused-svelte-ignore": "error" },
      }];`,
  });

  // The compiler warns about the transformed script, which maps back. A comment before an element or a block applies to
  // its contents. A style sheet that no project preprocessor reads isn't compiled, so its comments count as used.
  test(
    "svelte/no-unused-svelte-ignore asks the project's compiler and reports the comments that ignore none of its warnings",
    async () => {
      const text = [
        '<script lang="ts">',
        "  // svelte-ignore state_referenced_locally",
        "  const copy: number = WARN;",
        "  // svelte-ignore non_reactive_update",
        "  let other = 1;",
        "</script>",
        "<!-- svelte-ignore a11y_missing_attribute -->",
        "<div>",
        "  {#if copy}",
        '    <img src="a.png" />',
        "  {/if}",
        "</div>",
        "<!-- svelte-ignore a11y_autofocus (a note), a11y_missing_attribute -->",
        '<img src="b.png" />',
        "<!-- svelte-ignore -->",
        "<p>{other}</p>",
        "<!-- svelte-ignore css_unused_selector -->",
        '<style lang="scss">',
        "  .unused { color: red; }",
        "</style>",
        "",
      ].join("\n");
      const files = { ...ignoring(text), "b.svelte": "<p>no comment</p>\n" };
      const result = await lint(files, ["-f", "json", "a.svelte", "b.svelte"], ["compiled.txt"]);
      const [a, b] = JSON.parse(result.raw);
      expect(places(JSON.stringify([a]))).toEqual([
        "4:20-4:39 2 svelte/no-unused-svelte-ignore svelte-ignore comment is used, but not warned",
        "13:20-13:34 2 svelte/no-unused-svelte-ignore svelte-ignore comment is used, but not warned",
        "15:1-15:23 2 svelte/no-unused-svelte-ignore svelte-ignore comment must include the code",
      ]);
      expect(b.messages).toEqual([]);
      // Only the component with a `svelte-ignore` comment is compiled.
      expect(result.files["compiled.txt"]).toBe('{"experimental":{},"generate":false}\n');
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  // A warning about the script's last statement belongs to that statement, even if no `;` ends it.
  test.each(["", ";"])(
    "svelte/no-unused-svelte-ignore before the script's last statement, ended with %j",
    async end => {
      const text = `<script>\n  let { items } = $props()\n  // svelte-ignore state_referenced_locally\n  let n = WARN${end}\n</script>\n{#each items as x (x)}<p data-n={n++}>{x}</p>{/each}\n`;
      const result = await lint(ignoring(text), ["-f", "json", "a.svelte"], []);
      expect(places(result.raw)).toEqual([]);
      expect(result.exitCode).toBe(0);
    },
    timeout,
  );

  // The project's JavaScript only runs if the config has loaded eslint-plugin-svelte. Here `svelte/compiler` is next to
  // the component, and would say so if it were loaded.
  test(
    "svelte/no-unused-svelte-ignore loads no compiler and reports nothing if the config hasn't loaded the plugin",
    async () => {
      const text = "<!-- svelte-ignore a11y_autofocus -->\n<p>x</p>\n<!-- svelte-ignore -->\n";
      const files = {
        ...ignoring(text),
        "loaded.txt": "no",
        "node_modules/svelte/compiler.js": `require("node:fs").writeFileSync("loaded.txt", "yes");\nexports.VERSION = "5.57.2";\nexports.compile = () => ({ warnings: [] });`,
        "eslint.config.mjs": `
          import parser from "svelte-eslint-parser";
          export default [{ files: ["**/*.svelte"], languageOptions: { parser } }];`,
      };
      const args = ["--rule", "svelte/no-unused-svelte-ignore: error", "-f", "json", "a.svelte"];
      const result = await lint(files, args, ["loaded.txt"]);
      expect(places(result.raw)).toEqual([]);
      expect(result.files["loaded.txt"]).toBe("no");
      expect(result.exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "svelte/no-unused-svelte-ignore reports nothing about codes if the compiler fails",
    async () => {
      const text =
        "<script>\n  const FAIL = 1;\n</script>\n<!-- svelte-ignore a11y_autofocus -->\n<p>{FAIL}</p>\n<!-- svelte-ignore -->\n";
      const result = await lint(ignoring(text), ["-f", "json", "a.svelte"], []);
      expect(places(result.raw)).toEqual([
        "6:1-6:23 2 svelte/no-unused-svelte-ignore svelte-ignore comment must include the code",
      ]);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  // A throw outside of `compile` is the rule's own error, as under ESLint, not a compiler that warns about nothing.
  test(
    "svelte/no-unused-svelte-ignore ends the run if asking the compiler throws",
    async () => {
      const text = "<!-- svelte-ignore a11y_autofocus -->\n<p>x</p>\n";
      const files = {
        ...ignoring(text),
        "node_modules/svelte/compiler.js": `Object.defineProperty(exports, "VERSION", { get() { throw new Error("The compiler is broken."); } });\nexports.compile = () => ({ warnings: [] });`,
      };
      const result = await lint(files, ["-f", "json", "a.svelte"], []);
      expect(result.stderr).toContain(
        "Error while loading rule 'svelte/no-unused-svelte-ignore': The compiler is broken.\nOccurred while linting <dir>/a.svelte",
      );
      expect(result.raw).toBe("");
      expect(result.exitCode).toBe(2);
    },
    timeout,
  );

  // @jridgewell/sourcemap-codec's `decode` treats a non-digit, and anything past the end, as 0. The map of the script's
  // last line ends in the middle of a number, so the warning there maps to nowhere.
  test(
    "svelte/no-unused-svelte-ignore reads a source map that ends in the middle of a number",
    async () => {
      const text =
        '<script lang="ts">\n  // svelte-ignore state_referenced_locally\n  const copy: number = WARN;\n</script>\n';
      const files = {
        ...ignoring(text),
        "node_modules/typescript/index.js": `
          exports.ScriptTarget = { ESNext: 99 };
          exports.ModuleKind = { ESNext: 99 };
          exports.ImportsNotUsedAsValues = { Preserve: 1 };
          exports.transpileModule = code => ({ outputText: code, sourceMapText: JSON.stringify({ mappings: "AAAA;AACA;g" }) });`,
      };
      const result = await lint(files, ["-f", "json", "a.svelte"], []);
      expect(places(result.raw)).toEqual([
        "2:20-2:44 2 svelte/no-unused-svelte-ignore svelte-ignore comment is used, but not warned",
      ]);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  // For a file that isn't a component eslint-plugin-svelte knows no runes, so a rule that needs them doesn't run there.
  test(
    "a rule that needs runes doesn't run on a file that isn't a component",
    async () => {
      const files = { "a.js": "const $inspect = () => {};\n$inspect();\n" };
      const result = await lint(files, ["--rule", "svelte/no-inspect: error", "-f", "json", "a.js"]);
      expect(places(result.raw)).toEqual([]);
      expect(result.exitCode).toBe(0);
    },
    timeout,
  );
});

// eslint-plugin-svelte has TypeScript compile the scripts to the `target` of typescript-eslint's program, otherwise to
// `ESNext`.
describe.concurrent("svelte/no-unused-svelte-ignore with the program's target", () => {
  // A `typescript` that reads a config file's `target`, `files` and `references`, and records each target it compiles
  // to in `targets.txt`. Below ES2022 it lowers the private field into a `WeakMap`, which this `svelte/compiler`
  // rejects, as Svelte rejects a `$state` that isn't a field or declaration.
  const compilers = {
    "node_modules/svelte/package.json": JSON.stringify({
      name: "svelte",
      version: "5.57.2",
      exports: { "./compiler": "./compiler.js", "./package.json": "./package.json" },
    }),
    "node_modules/svelte/compiler.js": `
      exports.VERSION = "5.57.2";
      exports.compile = code => {
        if (code.includes("WeakMap")) throw Object.assign(new Error("Misplaced."), { code: "state_invalid_placement" });
        return { warnings: [] };
      };`,
    "node_modules/typescript/package.json": JSON.stringify({ name: "typescript", version: "6.0.3", main: "index.js" }),
    "node_modules/typescript/index.js": `
      const { appendFileSync, existsSync, readFileSync } = require("node:fs");
      const path = require("node:path");
      exports.ScriptTarget = { ES2020: 7, ESNext: 99 };
      exports.ModuleKind = { ESNext: 99 };
      exports.ImportsNotUsedAsValues = { Preserve: 1 };
      exports.ScriptKind = { Deferred: 7 };
      exports.sys = { useCaseSensitiveFileNames: true, fileExists: existsSync };
      exports.getParsedCommandLineOfConfigFile = file => {
        if (!existsSync(file)) return undefined;
        const { compilerOptions = {}, files = [], references = [] } = JSON.parse(readFileSync(file, "utf8"));
        const at = it => path.resolve(path.dirname(file), it);
        return {
          options: { target: exports.ScriptTarget[compilerOptions.target] },
          fileNames: files.map(at),
          projectReferences: references.map(it => ({ path: at(it.path) })),
        };
      };
      exports.resolveProjectReferencePath = ({ path: it }) => (it.endsWith(".json") ? it : path.join(it, "tsconfig.json"));
      exports.transpileModule = (code, { compilerOptions: { target } }) => {
        appendFileSync("targets.txt", target + "\\n");
        return {
          outputText: target < 9 ? code.replace("#count = $state(0);", "#count = new WeakMap($state(0));") : code,
          sourceMapText: JSON.stringify({ mappings: code.split("\\n").map((_, i) => (i ? "AACA" : "AAAA")).join(";") }),
        };
      };`,
  };
  const text = [
    '<script lang="ts">',
    "class Counter { #count = $state(0); get count() { return this.#count; } }",
    "const counter = new Counter();",
    "</script>",
    "<!-- svelte-ignore a11y_autofocus -->",
    "<p>{counter.count}</p>",
  ].join("\n");
  const linted = (parserOptions: Record<string, unknown>, files: Record<string, string>) => ({
    ...svelteRules(text, {}),
    ...typescriptParser,
    ...compilers,
    ...files,
    "eslint.config.mjs": `
      import parser from "svelte-eslint-parser";
      import svelte from "eslint-plugin-svelte";
      import * as ts from "@typescript-eslint/parser";
      export default [{
        files: ["**/*.svelte"],
        languageOptions: { parser, parserOptions: { parser: ts, extraFileExtensions: [".svelte"], ...${JSON.stringify(parserOptions)} } },
        plugins: { svelte },
        rules: { "svelte/no-unused-svelte-ignore": "error" },
      }];`,
  });
  const unused = ["5:20-5:34 2 svelte/no-unused-svelte-ignore svelte-ignore comment is used, but not warned"];
  const app = JSON.stringify({ compilerOptions: { target: "ES2020" }, files: ["a.svelte"] });
  const other = JSON.stringify({ files: ["b.ts"] });
  const solution = JSON.stringify({ files: [], references: [{ path: "./tsconfig.app.json" }] });

  test.each([
    ["no project", {}, { "tsconfig.json": app }, "99", unused],
    ["`project: true`", { project: true }, { "tsconfig.json": app }, "7", []],
    [
      "the second `project` that has the file",
      { project: ["./tsconfig.json", "./tsconfig.app.json"] },
      { "tsconfig.json": other, "tsconfig.app.json": app },
      "7",
      [],
    ],
    [
      "`projectService` and a reference",
      { projectService: true },
      { "tsconfig.json": solution, "tsconfig.app.json": app },
      "7",
      [],
    ],
  ])(
    "with %s",
    async (_, parserOptions, files, target, reported) => {
      const result = await lint(linted(parserOptions, files), ["-f", "json", "a.svelte"], ["targets.txt"]);
      expect(result.files["targets.txt"]).toBe(`${target}\n`);
      expect(places(result.raw)).toEqual(reported);
      expect(result.exitCode).toBe(reported.length ? 1 : 0);
    },
    timeout,
  );
});

// Each rule about a component's scopes, on a component where it reports something and leaves something alone, as ESLint
// reports it there with svelte-eslint-parser 1.9.0 and eslint-plugin-svelte 3.23.1.
describe.concurrent("eslint-plugin-svelte's native scope rules", () => {
  test.each([
    [
      "infinite-reactive-loop",
      { "svelte/infinite-reactive-loop": "error" },
      "<svelte:options runes={false} />\n<script>\n  import { tick } from 'svelte';\n  let a = 0;\n  let b = 0;\n  const bump = async () => { await fetch(''); a += 1; };\n  $: if (a) tick().then(() => { a = 1; });\n  $: if (b) { b = 2; }\n  $: bump(a);\n</script>\n",
      "a.svelte: 6:47 svelte/infinite-reactive-loop Possibly it may occur an infinite reactive loop.\na.svelte: 7:33 svelte/infinite-reactive-loop Possibly it may occur an infinite reactive loop.\na.svelte: 9:6 svelte/infinite-reactive-loop Possibly it may occur an infinite reactive loop because this function may update `a`.",
    ],
    [
      "no-dom-manipulating",
      { "svelte/no-dom-manipulating": "error" },
      "<script>\n  let div;\n  let span;\n  let comp;\n  const clear = () => { div.remove(); span.textContent = ''; span.focus(); comp.remove(); };\n</script>\n<div bind:this={div}></div>\n<span bind:this={span}>x</span>\n<Comp bind:this={comp} />\n<button on:click={clear}>x</button>\n",
      "a.svelte: 5:25 svelte/no-dom-manipulating Don't manipulate the DOM directly. The Svelte runtime can get confused if there is a difference between the actual DOM and the DOM expected by the Svelte runtime.\na.svelte: 5:39 svelte/no-dom-manipulating Don't manipulate the DOM directly. The Svelte runtime can get confused if there is a difference between the actual DOM and the DOM expected by the Svelte runtime.",
    ],
    [
      "no-immutable-reactive-statements",
      { "svelte/no-immutable-reactive-statements": "error" },
      "<svelte:options runes={false} />\n<script>\n  const a = 1;\n  let b = 2;\n  export let c;\n  $: x = a * 2;\n  $: y = b * 2;\n  $: z = c;\n  function f() { b = 3; }\n</script>\n{x}{y}{z}<button on:click={f}>x</button>\n",
      "a.svelte: 6:10 svelte/no-immutable-reactive-statements This statement is not reactive because all variables referenced in the reactive statement are immutable.",
    ],
    [
      "no-inner-declarations",
      { "svelte/no-inner-declarations": ["error", "both", { "blockScopedFunctions": "disallow" }] },
      "<script>\n  var a = 1;\n  function f() { var b = 2; return b; }\n  if (a) {\n    var c = 3;\n    function g() {}\n  }\n</script>\n",
      "a.svelte: 5:5 svelte/no-inner-declarations Move variable declaration to program root.\na.svelte: 6:5 svelte/no-inner-declarations Move function declaration to program root.",
    ],
    [
      "no-not-function-handler",
      { "svelte/no-not-function-handler": "error" },
      "<script>\n  const handler = 'x';\n  const ok = () => {};\n</script>\n<button on:click={handler}>a</button>\n<button onclick={{}}>b</button>\n<button on:click={ok}>c</button>\n<button onclick={ok}>d</button>\n",
      "a.svelte: 5:19 svelte/no-not-function-handler Unexpected string value in event handler.\na.svelte: 6:18 svelte/no-not-function-handler Unexpected object in event handler.",
    ],
    [
      "no-reactive-reassign",
      { "svelte/no-reactive-reassign": "error" },
      "<svelte:options runes={false} />\n<script>\n  let n = 0;\n  $: double = n * 2;\n  $: items = [n];\n  function reset() { double = 0; items.push(1); n = 1; }\n</script>\n<input bind:value={double} />\n<button on:click={reset}>{items}</button>\n",
      "a.svelte: 6:22 svelte/no-reactive-reassign Assignment to reactive value 'double'.\na.svelte: 6:34 svelte/no-reactive-reassign Assignment to reactive value 'items'.\na.svelte: 8:8 svelte/no-reactive-reassign Assignment to reactive value 'double'.",
    ],
    [
      "no-store-async",
      { "svelte/no-store-async": "error" },
      "<script>\n  import { readable, writable } from 'svelte/store';\n  const a = readable(0, async (set) => { set(await fetch('')); });\n  const b = writable(0, (set) => set(1));\n</script>\n",
      "a.svelte: 3:25 svelte/no-store-async Do not pass async functions to svelte stores.",
    ],
    [
      "no-unnecessary-state-wrap",
      { "svelte/no-unnecessary-state-wrap": "error" },
      "<script>\n  import { SvelteSet } from 'svelte/reactivity';\n  const set = $state(new SvelteSet());\n  const plain = new SvelteSet();\n  let other = $state(new Set());\n</script>\n",
      "a.svelte: 3:22 svelte/no-unnecessary-state-wrap SvelteSet is already reactive, $state wrapping is unnecessary. [1 suggestion]",
    ],
    [
      "prefer-svelte-reactivity",
      { "svelte/prefer-svelte-reactivity": "error" },
      "<script>\n  const a = new Map();\n  a.set(1, 2);\n  const b = new Set([1]);\n  const c = new URL('https://bun.sh');\n  c.hash = 'x';\n</script>\n{a}{b}{c}\n",
      "a.svelte: 2:13 svelte/prefer-svelte-reactivity Found a mutable instance of the built-in Map class. Use SvelteMap instead.",
    ],
    [
      // Upstream's tracker stops following a variable once it has found a mutable instance in it, and a store's `$s`
      // isn't a variable.
      "prefer-svelte-reactivity after a mutable instance, and on a store",
      { "svelte/prefer-svelte-reactivity": "error" },
      '<script>\n  import { writable } from "svelte/store";\n  let items = $state(new Map());\n  function a() { items = new Map(items); items.set(1, 2); }\n  function b() { items = new Map(); }\n  const s = writable(new Set());\n  $s = new Set();\n  $s.add(1);\n</script>\n{a}{b}\n',
      "a.svelte: 4:26 svelte/prefer-svelte-reactivity Found a mutable instance of the built-in Map class. Use SvelteMap instead.",
    ],
    [
      // The `Date` walk pops the variable that the `Date` check left, so the `Map` walk follows it again.
      "prefer-svelte-reactivity on another class after a mutable instance",
      { "svelte/prefer-svelte-reactivity": "error" },
      '<script>\n  let value = new Date();\n  value.setDate(1);\n  value = new Map();\n  value.set("x", 1);\n</script>\n',
      "a.svelte: 2:15 svelte/prefer-svelte-reactivity Found a mutable instance of the built-in Date class. Use SvelteDate instead.\na.svelte: 4:11 svelte/prefer-svelte-reactivity Found a mutable instance of the built-in Map class. Use SvelteMap instead.",
    ],
    [
      // Through an alias the `Date` walk has two frames, which pop `value` and `D`. Within one `Map` walk the second
      // `new Map()` of `other` isn't followed, and the `Set` walk follows it again.
      "prefer-svelte-reactivity through an alias, and one global after another",
      { "svelte/prefer-svelte-reactivity": "error" },
      '<script>\n  const D = Date;\n  let value = new D();\n  value.setDate(1);\n  value = new Map();\n  value.set("x", 1);\n  let other = new Map();\n  other.set(1, 2);\n  other = new Map();\n  other.set(1, 2);\n  other = new Set();\n  other.add(1);\n</script>\n',
      "a.svelte: 3:15 svelte/prefer-svelte-reactivity Found a mutable instance of the built-in Date class. Use SvelteDate instead.\na.svelte: 5:11 svelte/prefer-svelte-reactivity Found a mutable instance of the built-in Map class. Use SvelteMap instead.\na.svelte: 7:15 svelte/prefer-svelte-reactivity Found a mutable instance of the built-in Map class. Use SvelteMap instead.\na.svelte: 11:11 svelte/prefer-svelte-reactivity Found a mutable instance of the built-in Set class. Use SvelteSet instead.",
    ],
    [
      "prefer-writable-derived",
      { "svelte/prefer-writable-derived": "error" },
      "<script>\n  let { value } = $props();\n  let copy = $state(value);\n  $effect(() => {\n    copy = value;\n  });\n  let other = $state(0);\n  $effect(() => {\n    other = value;\n    other += 1;\n  });\n</script>\n",
      "a.svelte: 3:7 svelte/prefer-writable-derived Prefer using writable $derived instead of $state and $effect [1 suggestion]",
    ],
    [
      "valid-each-key",
      { "svelte/valid-each-key": "error" },
      "<script>\n  let items = [];\n  let id = 1;\n</script>\n{#each items as item (id)}{item}{/each}\n{#each items as item (item.id)}{item}{/each}\n{#each items as item, i (i)}{item}{/each}\n",
      "a.svelte: 5:23 svelte/valid-each-key Expected key to use the variables which are defined by the `{#each}` block.",
    ],
    [
      "runes-off-rules-with-runes",
      {
        "svelte/no-reactive-reassign": "error",
        "svelte/no-immutable-reactive-statements": "error",
        "svelte/infinite-reactive-loop": "error",
      },
      "<script>\n  let n = $state(0);\n  $: d = n * 2;\n  function f() { d = 1; }\n</script>\n{d}<button on:click={f}>x</button>\n",
      "",
    ],
  ])(
    "svelte/%s",
    async (_, rules, text, expected) => {
      const result = await lint(svelteRules(text, rules), ["-f", "json"], []);
      expect(summary(result.raw)).toBe(expected);
      expect(result.exitCode).toBe(expected ? 1 : 0);
    },
    timeout,
  );

  // It runs where `semver.satisfies(VERSION, ">=5.25.0")`, which an invalid version, like one with an empty prerelease,
  // doesn't satisfy.
  test.each([
    ["5.25.0", true],
    ["5.25.0+b-1", true],
    ["5.25.0-next.1", false],
    ["5.25.0-", false],
    ["5.25.0-+build", false],
  ])(
    "svelte/prefer-writable-derived under Svelte %s",
    async (version, isReported) => {
      const text =
        "<script>\n  let { value } = $props();\n  let copy = $state(value);\n  $effect(() => {\n    copy = value;\n  });\n</script>\n{copy}\n";
      const files = {
        ...svelteRules(text, { "svelte/prefer-writable-derived": "error" }),
        "node_modules/svelte/package.json": JSON.stringify({ name: "svelte", version }),
      };
      const result = await lint(files, ["-f", "json"], []);
      const expected = isReported
        ? "a.svelte: 3:7 svelte/prefer-writable-derived Prefer using writable $derived instead of $state and $effect [1 suggestion]"
        : "";
      expect(summary(result.raw)).toBe(expected);
      expect(result.exitCode).toBe(isReported ? 1 : 0);
    },
    timeout,
  );

  // It only runs under Svelte 3 and 4, where the plugin finds them, and on a TypeScript script.
  test.each([
    [
      "4.2.20",
      "<script lang=\"ts\">\n  import { createEventDispatcher } from 'svelte';\n  const a = createEventDispatcher();\n  const b = createEventDispatcher<{ x: number }>();\n</script>\n",
      "a.svelte: 3:13 svelte/require-event-dispatcher-types Type parameters missing for the `createEventDispatcher` function call.",
    ],
    [
      "4.2.20",
      "<script>\n  import { createEventDispatcher } from 'svelte';\n  const a = createEventDispatcher();\n  const b = createEventDispatcher();\n</script>\n",
      "",
    ],
    [
      "5.57.2",
      "<script lang=\"ts\">\n  import { createEventDispatcher } from 'svelte';\n  const a = createEventDispatcher();\n  const b = createEventDispatcher<{ x: number }>();\n</script>\n",
      "",
    ],
  ])(
    "svelte/require-event-dispatcher-types under Svelte %s on %j",
    async (version, text, expected) => {
      const files = {
        ...svelteRules(text, {}),
        ...typescriptParser,
        "node_modules/svelte/package.json": JSON.stringify({ name: "svelte", version }),
        "eslint.config.mjs": `
          import parser from "svelte-eslint-parser";
          import svelte from "eslint-plugin-svelte";
          import * as ts from "@typescript-eslint/parser";
          export default [{
            files: ["**/*.svelte"],
            languageOptions: { parser, parserOptions: { parser: { ts } } },
            plugins: { svelte },
            rules: { "svelte/require-event-dispatcher-types": "error" },
          }];`,
      };
      const result = await lint(files, ["-f", "json"], []);
      expect(summary(result.raw)).toBe(expected);
      expect(result.exitCode).toBe(expected ? 1 : 0);
    },
    timeout,
  );

  // The rules read the variables as svelte-eslint-parser's scope manager has them: a store's `$x` is a reference that
  // reads `x`, a second `$: x = ..` writes `x`, a prop is written where it's exported, also as a constant, and
  // `{@const}` isn't a script `const`.
  test.each([
    [
      "$x of a store is reassigned",
      { "svelte/no-reactive-reassign": "error" },
      "<script>\n$: x = store;\n$x = 1;\n</script>",
      "a.svelte: 3:1 svelte/no-reactive-reassign Assignment to reactive value '$x'.",
    ],
    [
      "$x of a store makes it mutable",
      { "svelte/no-immutable-reactive-statements": "error" },
      "<script>\nlet x = [];\n$: y = x;\nfunction update() { $x = []; }\n</script>",
      "",
    ],
    [
      "$x of a store is the element",
      { "svelte/no-dom-manipulating": "error" },
      "<script>\nlet el;\nfunction clear() { $el.remove(); }\n</script>\n<div bind:this={$el} />",
      "a.svelte: 3:20 svelte/no-dom-manipulating Don't manipulate the DOM directly. The Svelte runtime can get confused if there is a difference between the actual DOM and the DOM expected by the Svelte runtime.",
    ],
    // A top-level snippet's body comes after the rest of the template, and each `$x` except the first one counts twice.
    [
      "$x of a store is the element, in a snippet",
      { "svelte/no-dom-manipulating": "error" },
      '<script>\nimport { writable } from "svelte/store";\nconst el = writable(null);\n</script>\n{#snippet removeButton()}\n  <button onclick={() => $el.remove()}>Remove</button>\n{/snippet}\n<div bind:this={$el}></div>\n{@render removeButton()}',
      "a.svelte: 6:26 svelte/no-dom-manipulating Don't manipulate the DOM directly. The Svelte runtime can get confused if there is a difference between the actual DOM and the DOM expected by the Svelte runtime.\na.svelte: 6:26 svelte/no-dom-manipulating Don't manipulate the DOM directly. The Svelte runtime can get confused if there is a difference between the actual DOM and the DOM expected by the Svelte runtime.",
    ],
    [
      "$x of a store is reassigned, in a snippet",
      { "svelte/no-reactive-reassign": "error" },
      '<script>\nimport { writable } from "svelte/store";\nexport let store = writable("");\n$: value = store;\n</script>\n{#snippet input()}\n  <input bind:value={$value} />\n{/snippet}\n<input bind:value={$value} />\n{@render input()}',
      "a.svelte: 7:10 svelte/no-reactive-reassign Assignment to reactive value '$value'.\na.svelte: 7:10 svelte/no-reactive-reassign Assignment to reactive value '$value'.\na.svelte: 9:8 svelte/no-reactive-reassign Assignment to reactive value '$value'.",
    ],
    [
      "a second $: assigns again",
      { "svelte/no-reactive-reassign": "error" },
      "<script>\n$: x = input;\n$: x = input + 1;\n</script>",
      "a.svelte: 3:4 svelte/no-reactive-reassign Assignment to reactive value 'x'.",
    ],
    [
      "a prop exported by name is written",
      { "svelte/no-immutable-reactive-statements": "error" },
      "<script>\nlet value = 1;\nexport { value };\n$: doubled = value * 2;\n</script>",
      "",
    ],
    [
      "an exported let is written",
      { "svelte/no-unnecessary-state-wrap": ["error", { allowReassign: true }] },
      '<script>\nimport { SvelteSet } from "svelte/reactivity";\nexport let items = $state(new SvelteSet());\n</script>',
      "",
    ],
    [
      "an exported const is written",
      { "svelte/no-unnecessary-state-wrap": ["error", { allowReassign: true }] },
      '<script>\nimport { SvelteSet } from "svelte/reactivity";\nexport const items = $state(new SvelteSet());\n</script>',
      "",
    ],
    [
      "{@const} is no const of a script",
      { "svelte/no-not-function-handler": "error" },
      "{#each rows as row}\n  {@const handler = 1}\n  <button onclick={handler} />\n{/each}",
      "",
    ],
  ])(
    "see the variables of svelte-eslint-parser: %s",
    async (_, rules, text, expected) => {
      const result = await lint(svelteRules(text, rules), ["-f", "json"], []);
      expect(summary(result.raw)).toBe(expected);
      expect(result.exitCode).toBe(expected ? 1 : 0);
    },
    timeout,
  );

  // Each variable that `$:` declares is looked up by its assignment, not by scanning all of them for each statement.
  test(
    "lint many $: statements",
    async () => {
      const statements = Array.from({ length: 1600 }, (_, i) => `$: a${i} = input;`).join("\n");
      const text = `<script>\nlet input = 0;\n${statements}\nfunction f() { a7 = 1; input = 2; }\n</script>`;
      const rules = { "svelte/no-reactive-reassign": "error", "svelte/no-immutable-reactive-statements": "error" };
      const result = await lint(svelteRules(text, rules), ["-f", "json"], []);
      expect(summary(result.raw)).toBe(
        "a.svelte: 1603:16 svelte/no-reactive-reassign Assignment to reactive value 'a7'.",
      );
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  // The variables, definitions and references a JavaScript plugin rule sees in svelte-eslint-parser's scope manager
  // match svelte-eslint-parser 1.9.0's, recorded in oracle/svelte-scopes.expected.json: for stores, `$:`, props,
  // `{@const}`, blocks, snippets, `let:`, classes, `arguments`, and the components in
  // oracle/svelte-scopes.witnesses.json. `probe/scopes` writes them the way svelte-scopes.mjs does. The references
  // svelte-eslint-parser adds have no identifier in the tree. They don't set `svelteVirtualReference` here, which no
  // eslint-plugin-svelte rule reads, and they're the only references whose identifier isn't in the tree: the ones for
  // directive types aren't created.
  test(
    "have the variables of svelte-eslint-parser's scope manager",
    async () => {
      const components: Record<string, string> = { ...scopeCases, ...scopeWitnesses };
      const recorder = pathToFileURL(join(import.meta.dir, "oracle/svelte-scopes.mjs")).href;
      const files: Record<string, string> = {
        ...svelteRules("", {}),
        ...typescriptParser,
        ...components,
        "node_modules/svelte/package.json": JSON.stringify({ name: "svelte", version: "5.57.2" }),
        "eslint.config.mjs": `
          import parser from "svelte-eslint-parser";
          import * as ts from "@typescript-eslint/parser";
          import { scopesOf } from ${JSON.stringify(recorder)};
          const scopes = {
            create: ({ sourceCode, report }) => ({
              Program: node => report({ node, message: JSON.stringify(scopesOf(sourceCode, sourceCode.text, sourceCode.hasBOM, () => true)) }),
            }),
          };
          export default [{
            files: ["**/*.svelte"],
            languageOptions: { parser, parserOptions: { parser: ts } },
            plugins: { probe: { rules: { scopes } } },
            rules: { "probe/scopes": "error" },
          }];`,
      };
      const result = await lint(files, ["-f", "json", ...Object.keys(components)]);
      const found: Record<string, unknown[]> = {};
      const handedOff: string[] = [];
      for (const { filePath, messages } of JSON.parse(result.raw)) {
        const name = filePath.replaceAll("\\", "/").split("/").at(-1);
        const probed = messages.find((it: { ruleId: string }) => it.ruleId === "probe/scopes");
        // ESLint lints a component that isn't read here the way Svelte reads it, and its fake `Linter` runs no
        // `Program` listener.
        if (!probed) handedOff.push(name);
        else found[name] = scopeDifferences(JSON.parse(probed.message), scopesOfParser[name]);
      }
      expect(handedOff.sort()).toEqual([]);
      expect(Object.keys(found).length + handedOff.length).toBe(Object.keys(components).length);
      expect(Object.fromEntries(Object.entries(found).filter(([, it]) => it.length > 0))).toEqual({});
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );
});

// A component linted with eslint-plugin-svelte's processor, as `processor: "svelte/svelte"` names it, `local/shout`,
// which only ESLint runs, and `rules`. With `aliases`, the plugin is also `sv`. `local` holds more `local` rules, as
// object properties.
function processed(
  text: string,
  rules: Record<string, unknown>,
  {
    settings = {},
    processor = true,
    aliases = false,
    local = "",
  }: { settings?: object; processor?: boolean; aliases?: boolean; local?: string },
) {
  return {
    ...svelteRules(text, {}),
    ...sveltePorts(`shout: ${quietShout}, ${local}`),
    "eslint.config.mjs": `
      import parser from "svelte-eslint-parser";
      import svelte from "eslint-plugin-svelte";
      export default [{
        files: ["**/*.svelte"],
        languageOptions: { parser },
        plugins: { svelte, ${aliases ? "sv: svelte, " : ""}local: svelte },
        ${processor ? 'processor: "svelte/svelte",' : ""}
        settings: ${JSON.stringify(settings)},
        rules: ${JSON.stringify(rules)},
      }];`,
  };
}

// `line:column-endLine:endColumn severity rule message`, the suppressed ones last.
function places(json: string) {
  type Message = {
    line: number;
    column: number;
    endLine?: number;
    endColumn?: number;
    severity: number;
    ruleId: string | null;
    message: string;
  };
  const [{ messages, suppressedMessages }]: { messages: Message[]; suppressedMessages: Message[] }[] = JSON.parse(json);
  const line = (it: Message, suppressed: boolean) =>
    `${it.line}:${it.column}${it.endLine ? `-${it.endLine}:${it.endColumn}` : ""} ${it.severity} ${it.ruleId} ${it.message}${suppressed ? " [suppressed]" : ""}`;
  return [...messages.map(it => line(it, false)), ...suppressedMessages.map(it => line(it, true))];
}

// The rules from eslint-plugin-svelte's tests of `svelte/comment-directive` and `settings.svelte.ignoreWarnings`, with
// `no-restricted-syntax` replacing `space-infix-ops`, which is about layout and doesn't run here.
const commentDirective = {
  "no-undef": "error",
  "no-restricted-syntax": ["error", "BinaryExpression"],
  "svelte/no-at-html-tags": "error",
  "svelte/comment-directive": "error",
};
const reportingUnused = {
  "no-unused-vars": "error",
  "svelte/comment-directive": ["error", { reportUnusedDisableDirectives: true }],
  "svelte/no-at-html-tags": "error",
  "svelte/no-at-debug-tags": "error",
};
const ignoring = {
  "no-undef": "error",
  "no-restricted-syntax": ["error", "BinaryExpression"],
  "svelte/no-at-html-tags": "error",
  "svelte/no-at-debug-tags": "error",
  "svelte/system": "error",
};

// What ESLint 10 with svelte-eslint-parser 1.9.0 and eslint-plugin-svelte 3.23.1 reports on each, or the `--fix`
// output. The first 32 are the plugin's own processor tests.
describe.concurrent("eslint-plugin-svelte's native processor", () => {
  test.each([
    [
      "disable all rules if <!-- eslint-disable -->",
      `
      <!-- eslint-disable -->
      {@html a+b}
      `,
      commentDirective,
      {},
      [],
    ],
    [
      "disable specific rules if <!-- eslint-disable no-restricted-syntax -->",
      `
      <!-- eslint-disable no-restricted-syntax -->
      {@html a+b}
      `,
      commentDirective,
      {},
      [
        "3:7-3:18 2 svelte/no-at-html-tags `{@html}` can lead to XSS attack.",
        "3:14-3:15 2 no-undef 'a' is not defined.",
        "3:16-3:17 2 no-undef 'b' is not defined.",
      ],
    ],
    [
      "enable all rules if <!-- eslint-enable -->",
      `
      <!-- eslint-disable -->
      {@html a+b}
      <!-- eslint-enable -->
      {@html a+b}
       `,
      commentDirective,
      {},
      [
        "5:7-5:18 2 svelte/no-at-html-tags `{@html}` can lead to XSS attack.",
        "5:14-5:17 2 no-restricted-syntax Using 'BinaryExpression' is not allowed.",
        "5:14-5:15 2 no-undef 'a' is not defined.",
        "5:16-5:17 2 no-undef 'b' is not defined.",
      ],
    ],
    [
      "enable specific rules if <!-- eslint-enable no-restricted-syntax -->",
      `
      <!-- eslint-disable svelte/no-at-html-tags, no-restricted-syntax -->
      {@html a+b}
      <!-- eslint-enable no-restricted-syntax -->
      {@html a+b}
      `,
      commentDirective,
      {},
      [
        "3:14-3:15 2 no-undef 'a' is not defined.",
        "3:16-3:17 2 no-undef 'b' is not defined.",
        "5:14-5:17 2 no-restricted-syntax Using 'BinaryExpression' is not allowed.",
        "5:14-5:15 2 no-undef 'a' is not defined.",
        "5:16-5:17 2 no-undef 'b' is not defined.",
      ],
    ],
    [
      "should not affect to the code in <script>.",
      `
      <!-- eslint-disable -->
      {@html a+b}
      <script>
        a;
      </script>
      `,
      commentDirective,
      {},
      ["5:9-5:10 2 no-undef 'a' is not defined."],
    ],
    [
      "disable specific rules if <!-- eslint-disable no-restricted-syntax ,, , svelte/no-at-html-tags -->",
      `
      <!-- eslint-disable no-restricted-syntax ,, , svelte/no-at-html-tags -->
      {@html a+b}
      `,
      commentDirective,
      {},
      ["3:14-3:15 2 no-undef 'a' is not defined.", "3:16-3:17 2 no-undef 'b' is not defined."],
    ],
    [
      "disable all rules if <!-- eslint-disable-line -->",
      `
      {@html a+b} <!-- eslint-disable-line -->
      `,
      commentDirective,
      {},
      [],
    ],
    [
      "disable specific rules if <!-- eslint-disable-line no-restricted-syntax -->",
      `
      {@html a+b} <!-- eslint-disable-line no-restricted-syntax -->
      `,
      commentDirective,
      {},
      [
        "2:7-2:18 2 svelte/no-at-html-tags `{@html}` can lead to XSS attack.",
        "2:14-2:15 2 no-undef 'a' is not defined.",
        "2:16-2:17 2 no-undef 'b' is not defined.",
      ],
    ],
    [
      "don't disable rules if <!-- eslint-disable-line --> is on another line",
      `
      <!-- eslint-disable-line -->
      {@html a+b}
      <!-- eslint-disable-line -->
      `,
      commentDirective,
      {},
      [
        "3:7-3:18 2 svelte/no-at-html-tags `{@html}` can lead to XSS attack.",
        "3:14-3:17 2 no-restricted-syntax Using 'BinaryExpression' is not allowed.",
        "3:14-3:15 2 no-undef 'a' is not defined.",
        "3:16-3:17 2 no-undef 'b' is not defined.",
      ],
    ],
    [
      "disable all rules if <!-- eslint-disable-next-line -->",
      `
      <!-- eslint-disable-next-line -->
      {@html a+b}
      `,
      commentDirective,
      {},
      [],
    ],
    [
      "disable specific rules if <!-- eslint-disable-next-line no-restricted-syntax -->",
      `
      <!-- eslint-disable-next-line no-restricted-syntax -->
      {@html a+b}
      `,
      commentDirective,
      {},
      [
        "3:7-3:18 2 svelte/no-at-html-tags `{@html}` can lead to XSS attack.",
        "3:14-3:15 2 no-undef 'a' is not defined.",
        "3:16-3:17 2 no-undef 'b' is not defined.",
      ],
    ],
    [
      "don't disable rules if <!-- eslint-disable-next-line --> is on another line",
      `
      <!-- eslint-disable-next-line -->

      {@html a+b} <!-- eslint-disable-next-line -->
      <!-- eslint-disable-next-line -->
      `,
      commentDirective,
      {},
      [
        "4:7-4:18 2 svelte/no-at-html-tags `{@html}` can lead to XSS attack.",
        "4:14-4:17 2 no-restricted-syntax Using 'BinaryExpression' is not allowed.",
        "4:14-4:15 2 no-undef 'a' is not defined.",
        "4:16-4:17 2 no-undef 'b' is not defined.",
      ],
    ],
    [
      "should affect only the next line",
      `
      <!-- eslint-disable-next-line svelte/no-at-html-tags, no-restricted-syntax -->
      {@html a+b}
      {@html a+b}
      `,
      commentDirective,
      {},
      [
        "3:14-3:15 2 no-undef 'a' is not defined.",
        "3:16-3:17 2 no-undef 'b' is not defined.",
        "4:7-4:18 2 svelte/no-at-html-tags `{@html}` can lead to XSS attack.",
        "4:14-4:17 2 no-restricted-syntax Using 'BinaryExpression' is not allowed.",
        "4:14-4:15 2 no-undef 'a' is not defined.",
        "4:16-4:17 2 no-undef 'b' is not defined.",
      ],
    ],
    [
      "disable all rules if <!-- eslint-disable -- description -->",
      `
      <!-- eslint-disable -- description -->
      {@html a+b}
      `,
      commentDirective,
      {},
      [],
    ],
    [
      "enable all rules if <!-- eslint-enable -- description -->",
      `
      <!-- eslint-disable -- description -->
      {@html a+b}
      <!-- eslint-enable -- description -->
      {@html a+b}
      `,
      commentDirective,
      {},
      [
        "5:7-5:18 2 svelte/no-at-html-tags `{@html}` can lead to XSS attack.",
        "5:14-5:17 2 no-restricted-syntax Using 'BinaryExpression' is not allowed.",
        "5:14-5:15 2 no-undef 'a' is not defined.",
        "5:16-5:17 2 no-undef 'b' is not defined.",
      ],
    ],
    [
      "enable specific rules if <!-- eslint-enable no-restricted-syntax -- description -->",
      `
      <!-- eslint-disable svelte/no-at-html-tags, no-restricted-syntax -- description -->
      {@html a+b}
      <!-- eslint-enable no-restricted-syntax -- description -->
      {@html a+b}
      `,
      commentDirective,
      {},
      [
        "3:14-3:15 2 no-undef 'a' is not defined.",
        "3:16-3:17 2 no-undef 'b' is not defined.",
        "5:14-5:17 2 no-restricted-syntax Using 'BinaryExpression' is not allowed.",
        "5:14-5:15 2 no-undef 'a' is not defined.",
        "5:16-5:17 2 no-undef 'b' is not defined.",
      ],
    ],
    [
      "disable all rules if <!-- eslint-disable-line -- description -->",
      `
      {@html a+b} <!-- eslint-disable-line -- description -->
      `,
      commentDirective,
      {},
      [],
    ],
    [
      "disable specific rules if <!-- eslint-disable-line no-restricted-syntax -- description -->",
      `
      {@html a+b} <!-- eslint-disable-line no-restricted-syntax -- description -->
      `,
      commentDirective,
      {},
      [
        "2:7-2:18 2 svelte/no-at-html-tags `{@html}` can lead to XSS attack.",
        "2:14-2:15 2 no-undef 'a' is not defined.",
        "2:16-2:17 2 no-undef 'b' is not defined.",
      ],
    ],
    [
      "disable all rules if <!-- eslint-disable-next-line -- description -->",
      `
      <!-- eslint-disable-next-line -- description -->
      {@html a+b}
      `,
      commentDirective,
      {},
      [],
    ],
    [
      "disable specific rules if <!-- eslint-disable-next-line no-restricted-syntax -- description -->",
      `
      <!-- eslint-disable-next-line no-restricted-syntax -- description -->
      {@html a+b}
      `,
      commentDirective,
      {},
      [
        "3:7-3:18 2 svelte/no-at-html-tags `{@html}` can lead to XSS attack.",
        "3:14-3:15 2 no-undef 'a' is not defined.",
        "3:16-3:17 2 no-undef 'b' is not defined.",
      ],
    ],
    [
      "reportUnusedDisableDirectives: report unused <!-- eslint-disable -->",
      `
        <!-- eslint-disable -->
        <div>Hello</div>
      `,
      reportingUnused,
      {},
      ["2:9-2:32 2 svelte/comment-directive Unused eslint-disable directive (no problems were reported)."],
    ],
    [
      "reportUnusedDisableDirectives: dont report unused <!-- eslint-disable -->",
      `
        <!-- eslint-disable -->
        <div>{@html foo}{@debug foo}</div>
      `,
      reportingUnused,
      {},
      [],
    ],
    [
      "reportUnusedDisableDirectives: disable and report unused <!-- eslint-disable -->",
      `
        <!-- eslint-disable -->
        <div>{@html foo}{@debug foo}</div>
        <!-- eslint-enable -->
        <!-- eslint-disable -->
        <div>Hello</div>
      `,
      reportingUnused,
      {},
      ["5:9-5:32 2 svelte/comment-directive Unused eslint-disable directive (no problems were reported)."],
    ],
    [
      "reportUnusedDisableDirectives: report unused <!-- eslint-disable svelte/no-at-debug-tags, svelte/no-at-html-tags -->",
      `
        <!-- eslint-disable svelte/no-at-debug-tags, svelte/no-at-html-tags -->
        <div>Hello</div>
      `,
      reportingUnused,
      {},
      [
        "2:29-2:52 2 svelte/comment-directive Unused eslint-disable directive (no problems were reported from 'svelte/no-at-debug-tags').",
        "2:54-2:76 2 svelte/comment-directive Unused eslint-disable directive (no problems were reported from 'svelte/no-at-html-tags').",
      ],
    ],
    [
      "reportUnusedDisableDirectives: report unused <!-- eslint-disable-next-line svelte/no-at-debug-tags, svelte/no-at-html-tags -->",
      `
        <!-- eslint-disable-next-line svelte/no-at-debug-tags, svelte/no-at-html-tags -->
        <div>Hello</div>
        <div>{@html foo}{@debug foo}</div>
      `,
      reportingUnused,
      {},
      [
        "2:39-2:62 2 svelte/comment-directive Unused eslint-disable-next-line directive (no problems were reported from 'svelte/no-at-debug-tags').",
        "2:64-2:86 2 svelte/comment-directive Unused eslint-disable-next-line directive (no problems were reported from 'svelte/no-at-html-tags').",
        "4:14-4:25 2 svelte/no-at-html-tags `{@html}` can lead to XSS attack.",
        "4:25-4:37 2 svelte/no-at-debug-tags Unexpected `{@debug}`.",
      ],
    ],
    [
      "reportUnusedDisableDirectives: dont report used <!-- eslint-disable-next-line svelte/no-at-debug-tags, svelte/no-at-html-tags -->",
      `
        <!-- eslint-disable-next-line svelte/no-at-debug-tags, svelte/no-at-html-tags -->
        <div>{@html foo}{@debug foo}</div>
      `,
      reportingUnused,
      {},
      [],
    ],
    [
      "reportUnusedDisableDirectives: dont report used, with duplicate eslint-disable",
      `
        <!-- eslint-disable -->
        <!-- eslint-disable-next-line svelte/no-at-debug-tags, svelte/no-at-html-tags -->
        <div>{@html foo}</div><!-- eslint-disable-line svelte/no-at-debug-tags, svelte/no-at-html-tags -->
      `,
      reportingUnused,
      {},
      [],
    ],
    [
      "reportUnusedDisableDirectives: report unused <!-- eslint-enable -->",
      `
        <!-- eslint-enable -->
      `,
      reportingUnused,
      {},
      ["2:9-2:31 2 svelte/comment-directive Unused eslint-enable directive (reporting is not suppressed)."],
    ],
    [
      "reportUnusedDisableDirectives: report unused <!-- eslint-enable svelte/no-at-debug-tags -->",
      `
        <!-- eslint-disable svelte/no-at-html-tags -->
        <div>{@html foo}</div>
        <!-- eslint-enable svelte/no-at-debug-tags -->
      `,
      reportingUnused,
      {},
      [
        "4:28-4:51 2 svelte/comment-directive Unused eslint-enable directive (reporting from 'svelte/no-at-debug-tags' is not suppressed).",
      ],
    ],
    [
      "ignoreWarnings: disable rules if ignoreWarnings: [ruleName]",
      `
      {@html a+b}
      {@debug a}
      <script>
        a+b;
      </script>
      {@html a+b}
      {@debug a}
      `,
      ignoring,
      {
        "settings": { "svelte": { "ignoreWarnings": ["no-undef", "no-restricted-syntax", "svelte/no-at-debug-tags"] } },
      },
      [
        "2:7-2:18 2 svelte/no-at-html-tags `{@html}` can lead to XSS attack.",
        "5:9-5:12 2 no-restricted-syntax Using 'BinaryExpression' is not allowed.",
        "5:9-5:10 2 no-undef 'a' is not defined.",
        "5:11-5:12 2 no-undef 'b' is not defined.",
        "7:7-7:18 2 svelte/no-at-html-tags `{@html}` can lead to XSS attack.",
      ],
    ],
    [
      "ignoreWarnings: disable rules if ignoreWarnings: [regexp]",
      `
      {@html a+b}
      {@debug a}
      <script>
        a+b;
      </script>
      {@html a+b}
      {@debug a}
      `,
      ignoring,
      { "settings": { "svelte": { "ignoreWarnings": ["no-undef", "/debug/", "/^no-restricted/"] } } },
      [
        "2:7-2:18 2 svelte/no-at-html-tags `{@html}` can lead to XSS attack.",
        "5:9-5:12 2 no-restricted-syntax Using 'BinaryExpression' is not allowed.",
        "5:9-5:10 2 no-undef 'a' is not defined.",
        "5:11-5:12 2 no-undef 'b' is not defined.",
        "7:7-7:18 2 svelte/no-at-html-tags `{@html}` can lead to XSS attack.",
      ],
    ],
    [
      "ignoreWarnings: without settings",
      `
      {@html a+b}
      {@debug a}
      <script>
        a+b;
      </script>
      {@html a+b}
      {@debug a}
      `,
      { "svelte/system": "error" },
      {},
      [],
    ],
    [
      "without the processor, HTML comments and ignoreWarnings do nothing",
      `<!-- eslint-disable -->
{@html a+b}
<!-- eslint-enable -->
`,
      {
        "no-unused-vars": "error",
        "svelte/comment-directive": ["error", { "reportUnusedDisableDirectives": true }],
        "svelte/no-at-html-tags": "error",
        "svelte/no-at-debug-tags": "error",
        "svelte/system": "error",
        "no-undef": "error",
      },
      { "settings": { "svelte": { "ignoreWarnings": ["no-undef"] } }, "processor": false },
      [
        "2:1-2:12 2 svelte/no-at-html-tags `{@html}` can lead to XSS attack.",
        "2:8-2:9 2 no-undef 'a' is not defined.",
        "2:10-2:11 2 no-undef 'b' is not defined.",
      ],
    ],
    [
      "with the processor and its rules off, HTML comments and ignoreWarnings do nothing",
      `<!-- eslint-disable -->
{@html a}
`,
      {
        "svelte/no-at-html-tags": "error",
        "svelte/comment-directive": "off",
        "svelte/system": "off",
        "no-undef": "error",
      },
      { "settings": { "svelte": { "ignoreWarnings": ["no-undef"] } } },
      ["2:1-2:10 2 svelte/no-at-html-tags `{@html}` can lead to XSS attack.", "2:8-2:9 2 no-undef 'a' is not defined."],
    ],
    [
      "a comment of the script turns svelte/comment-directive off",
      `<script>
  /* eslint svelte/comment-directive: "off" */
</script>
<!-- eslint-disable -->
{@html a}
`,
      { "svelte/no-at-html-tags": "error", "svelte/comment-directive": "error" },
      {},
      ["5:1-5:10 2 svelte/no-at-html-tags `{@html}` can lead to XSS attack."],
    ],
    [
      "comments of the script suppress, HTML comments remove",
      `<script>
  /* eslint-disable svelte/no-at-html-tags */
  let b = 1;
</script>
<!-- eslint-disable-next-line no-undef -->
{@html a + b}
{@html c}
`,
      {
        "no-unused-vars": "error",
        "svelte/comment-directive": ["error", { "reportUnusedDisableDirectives": true }],
        "svelte/no-at-html-tags": "error",
        "svelte/no-at-debug-tags": "error",
        "no-undef": "error",
      },
      {},
      [
        "7:8-7:9 2 no-undef 'c' is not defined.",
        "6:1-6:14 2 svelte/no-at-html-tags `{@html}` can lead to XSS attack. [suppressed]",
        "7:1-7:10 2 svelte/no-at-html-tags `{@html}` can lead to XSS attack. [suppressed]",
      ],
    ],
    [
      "a comment of the script suppresses an unused HTML directive",
      `<script>
  /* eslint-disable svelte/comment-directive */
</script>
<!-- eslint-disable -->
<p>x</p>
`,
      reportingUnused,
      {},
      ["4:1-4:24 2 svelte/comment-directive Unused eslint-disable directive (no problems were reported). [suppressed]"],
    ],
    [
      "the plugin under another name: its unused reports stay",
      `<!-- eslint-disable-next-line sv/no-at-html-tags -->
<p>{@html a}</p>
<!-- eslint-disable -->
<p>x</p>
`,
      { "sv/no-at-html-tags": "error", "sv/comment-directive": ["error", { "reportUnusedDisableDirectives": true }] },
      { "aliases": true },
      [
        "1:31-1:49 2 sv/comment-directive Unused eslint-disable-next-line directive (no problems were reported from 'sv/no-at-html-tags').",
        "3:1-3:24 2 sv/comment-directive Unused eslint-disable directive (no problems were reported).",
      ],
    ],
    [
      "the plugin under two names: each comment-directive reports",
      `<!-- eslint-disable-next-line svelte/no-at-html-tags -->
<p>{@html a}</p>
<!-- eslint-disable-line -->
`,
      {
        "svelte/no-at-html-tags": "error",
        "svelte/comment-directive": ["error", { "reportUnusedDisableDirectives": true }],
        "sv/comment-directive": ["error", { "reportUnusedDisableDirectives": true }],
      },
      { "aliases": true },
      [
        "1:31-1:53 2 sv/comment-directive Unused eslint-disable-next-line directive (no problems were reported from 'svelte/no-at-html-tags').",
      ],
    ],
    [
      "svelte/system before svelte/comment-directive: what it ignores leaves a directive unused",
      `<!-- eslint-disable-next-line svelte/no-at-html-tags -->
<p>{@html a}</p>
`,
      {
        "svelte/system": "error",
        "svelte/comment-directive": ["error", { "reportUnusedDisableDirectives": true }],
        "svelte/no-at-html-tags": "error",
      },
      { "settings": { "svelte": { "ignoreWarnings": ["svelte/no-at-html-tags"] } } },
      [
        "1:31-1:53 2 svelte/comment-directive Unused eslint-disable-next-line directive (no problems were reported from 'svelte/no-at-html-tags').",
      ],
    ],
    [
      "svelte/comment-directive before svelte/system: the directive is used",
      `<!-- eslint-disable-next-line svelte/no-at-html-tags -->
<p>{@html a}</p>
`,
      {
        "svelte/comment-directive": ["error", { "reportUnusedDisableDirectives": true }],
        "svelte/system": "error",
        "svelte/no-at-html-tags": "error",
      },
      { "settings": { "svelte": { "ignoreWarnings": ["svelte/no-at-html-tags"] } } },
      [],
    ],
    [
      "ignoreWarnings that is no array",
      `{@html a}
`,
      { "svelte/system": "error", "svelte/no-at-html-tags": "error" },
      { "settings": { "svelte": { "ignoreWarnings": "svelte/no-at-html-tags" } } },
      [
        "1:1 2 svelte/system The `settings.svelte.ignoreWarnings` must be an array.",
        "1:1-1:10 2 svelte/no-at-html-tags `{@html}` can lead to XSS attack.",
      ],
    ],
    [
      "ignoreWarnings with an element that is no string",
      `{@html a}
`,
      { "svelte/system": "warn", "svelte/no-at-html-tags": "error" },
      { "settings": { "svelte": { "ignoreWarnings": ["svelte/no-at-html-tags", 1] } } },
      [
        "1:1 1 svelte/system The array element in the `settings.svelte.ignoreWarnings` must be a string.",
        "1:1-1:10 2 svelte/no-at-html-tags `{@html}` can lead to XSS attack.",
      ],
    ],
    [
      "ignoreWarnings with a global regular expression",
      `{@html a}{@html a}{@html a}
<p>{@html a}</p>
`,
      { "svelte/system": "error", "svelte/no-at-html-tags": "error" },
      { "settings": { "svelte": { "ignoreWarnings": ["/html/g"] } } },
      [
        "1:10-1:19 2 svelte/no-at-html-tags `{@html}` can lead to XSS attack.",
        "2:4-2:13 2 svelte/no-at-html-tags `{@html}` can lead to XSS attack.",
      ],
    ],
    [
      "a rule list that starts with a comma, a multi-line line directive, and two adjacent comments",
      `<!-- eslint-disable ,svelte/no-at-debug-tags -->
<!-- eslint-disable-line
-->
{@html a}<!-- eslint-disable --><!-- eslint-enable -->{@html b}
<!-- eslint-enable -->{@debug a}
`,
      reportingUnused,
      {},
      [
        "1:21-1:44 2 svelte/comment-directive Unused eslint-disable directive (no problems were reported from 'svelte/no-at-debug-tags').",
        "4:1-4:10 2 svelte/no-at-html-tags `{@html}` can lead to XSS attack.",
        "5:23-5:33 2 svelte/no-at-debug-tags Unexpected `{@debug}`.",
      ],
    ],
    [
      "non-ASCII text before the directives, and a script between them",
      `<p>Ünï 😀</p><!-- eslint-disable svelte/no-at-html-tags -->{@html a}
<script>
  let a = 1;
</script>
{@html a}<!-- eslint-enable svelte/no-at-html-tags -->{@html a}
`,
      reportingUnused,
      {},
      [
        "5:1-5:10 2 svelte/no-at-html-tags `{@html}` can lead to XSS attack.",
        "5:29-5:51 2 svelte/comment-directive Unused eslint-enable directive (reporting from 'svelte/no-at-html-tags' is not suppressed).",
        "5:55-5:64 2 svelte/no-at-html-tags `{@html}` can lead to XSS attack.",
      ],
    ],
    [
      "an unused directive of each kind, with severities",
      `<!-- eslint-disable-line no-undef -->
<!-- eslint-disable-next-line -->
<!-- eslint-enable svelte/no-at-html-tags -->
<!-- eslint-disable no-undef -- why -->
`,
      {
        "no-unused-vars": "error",
        "svelte/comment-directive": ["warn", { "reportUnusedDisableDirectives": true }],
        "svelte/no-at-html-tags": "error",
        "svelte/no-at-debug-tags": "error",
      },
      {},
      [
        "1:26-1:34 1 svelte/comment-directive Unused eslint-disable-line directive (no problems were reported from 'no-undef').",
        "4:21-4:29 1 svelte/comment-directive Unused eslint-disable directive (no problems were reported from 'no-undef').",
      ],
    ],
    [
      "fixes across passes skip what HTML comments disable",
      `<script>
  let a = 1;
</script>
<head>{!!a ? 1 : 2}</head>
<!-- eslint-disable-next-line no-extra-boolean-cast -->
<p>{!!a ? 1 : 2}</p>
<p>{!!a ? 1 : 2}</p><!-- eslint-disable-line prefer-const -->
`,
      {
        "svelte/no-raw-special-elements": "error",
        "no-extra-boolean-cast": "error",
        "prefer-const": "error",
        "svelte/comment-directive": ["error", { "reportUnusedDisableDirectives": true }],
      },
      {},
      {
        output: `<script>
  const a = 1;
</script>
<svelte:head>{a ? 1 : 2}</svelte:head>
<!-- eslint-disable-next-line no-extra-boolean-cast -->
<p>{!!a ? 1 : 2}</p>
<p>{a ? 1 : 2}</p><!-- eslint-disable-line prefer-const -->
`,
      },
    ],
    [
      "one HTML comment disables a core rule, a Svelte rule and a rule that only ESLint runs",
      `<!-- eslint-disable-next-line -->
<p>{@html LOUD}</p>
<p>{@html LOUD}</p>
<!-- eslint-disable-next-line local/shout -->
<p>LOUD</p>
`,
      {
        "no-undef": "error",
        "svelte/no-at-html-tags": "error",
        "local/shout": "error",
        "svelte/comment-directive": ["error", { "reportUnusedDisableDirectives": true }],
      },
      {},
      [
        "3:1 2 local/shout Shouting.",
        "3:4-3:16 2 svelte/no-at-html-tags `{@html}` can lead to XSS attack.",
        "3:11-3:15 2 no-undef 'LOUD' is not defined.",
      ],
    ],
    [
      // After a comma the name starts where the directive ends, and is as long as the name in UTF-16 code units from
      // there, which can end in the middle of a character beyond the BMP.
      "unused directives that name rules behind a comma, beyond ASCII",
      `<!-- eslint-disable ,é -->
<!-- eslint-disable ,😀 -->
`,
      reportingUnused,
      {},
      [
        "1:21-1:22 2 svelte/comment-directive Unused eslint-disable directive (no problems were reported from 'é').",
        "2:21-2:23 2 svelte/comment-directive Unused eslint-disable directive (no problems were reported from '😀').",
      ],
    ],
    [
      // The processor sees what a script comment suppresses, and removes it, so the HTML comment is used.
      "an HTML comment disables what a comment of the script suppresses",
      `<script>/* eslint-disable no-undef -- script */</script>
<!-- eslint-disable-next-line no-undef -->
{missing}
`,
      { "no-undef": "error", "svelte/comment-directive": ["error", { reportUnusedDisableDirectives: true }] },
      {},
      [],
    ],
    [
      "ignoreWarnings disables what a comment of the script suppresses",
      `<script>/* eslint-disable no-undef -- script */</script>

{missing}
`,
      { "no-undef": "error", "svelte/system": "error" },
      { settings: { svelte: { ignoreWarnings: ["no-undef"] } } },
      [],
    ],
  ] as [string, string, Record<string, unknown>, object, string[] | { output: string }][])(
    "%s",
    async (_, text, rules, options, expected) => {
      const fixes = !Array.isArray(expected);
      const args = fixes ? ["--fix"] : ["-f", "json"];
      const result = await lint(processed(text, rules, options), args, ["a.svelte"]);
      if (fixes) expect(result.files["a.svelte"]).toBe(expected.output);
      else expect(places(result.raw)).toEqual(expected);
    },
    timeout,
  );

  // ESLint creates the rule, and `new RegExp` throws.
  test.each([
    ["/(/", "Invalid regular expression: /(/: Unterminated group"],
    ["/a/gg", "Invalid flags supplied to RegExp constructor 'gg'"],
  ])(
    "ends the run where a pattern of settings.svelte.ignoreWarnings is invalid: %s",
    async (pattern, said) => {
      const settings = { svelte: { ignoreWarnings: [pattern] } };
      const files = processed("{@html a}\n", { "svelte/system": "error" }, { settings });
      const result = await lint(files, [], []);
      expect(result.stderr).toContain(`Error while loading rule 'svelte/system': ${said}\nOccurred while linting `);
      expect(result.exitCode).toBe(2);
    },
    timeout,
  );

  // `import/no-cycle` asks about the other files, and the component is linted again once they're all linted: the module
  // rules run again, and so do the rules that leave the processor the directives that disable messages, so it sees all
  // reports as in one run, including what it removed the first time.
  test(
    "removes a module rule's reports when the file is linted again",
    async () => {
      const text = `<!-- eslint-disable-next-line import/named -->
<script>import {missing} from "./dep.js";</script>
<!-- eslint-disable-next-line no-undef -->
{gone}
`;
      const rules = {
        "import/named": "error",
        "no-undef": "error",
        "import/no-cycle": ["error", { disableScc: true }],
        "svelte/comment-directive": ["error", { reportUnusedDisableDirectives: true }],
      };
      const files = {
        ...svelteRules(text, {}),
        "dep.js": "export const ok = 1;\n",
        "eslint.config.mjs": `
          import parser from "svelte-eslint-parser";
          import svelte from "eslint-plugin-svelte";
          export default [{
            files: ["**/*.svelte"],
            languageOptions: { parser },
            plugins: { svelte, sv: svelte, import: { meta: { name: "eslint-plugin-import" }, rules: {} } },
            processor: "sv/svelte",
            settings: { "import/parsers": { espree: [".js"] } },
            rules: ${JSON.stringify(rules)},
          }];`,
      };
      const result = await lint(files, ["-f", "json", "a.svelte", "dep.js"], []);
      expect(places(result.raw)).toEqual([]);
      expect(result.exitCode).toBe(0);
    },
    timeout,
  );

  // A fix produces `generics` that only typescript-eslint accepts, so ESLint lints the component, also when it's linted
  // again.
  test(
    "passes a component to ESLint when it's linted again for a module rule, like the first time",
    async () => {
      const text = '<script lang="ts" generics="T">import {ok} from "./dep.js";</script>\n';
      const files = {
        ...svelteRules(text, {}),
        ...typescriptParser,
        "dep.js": "export const ok = 1;\n",
        ...sveltePorts(`change: {
          create: ({ report }) => ({
            Line({ lines }) {
              const declared = "<script context=module>type await = number;</script>";
              const at = lines[0].indexOf('generics="T"') + 'generics="'.length;
              const rest = lines[0].slice(at + 1);
              if (at >= 'generics="'.length) report({ line: 1, message: "Rename T.", fix: { range: [at, at + 1 + rest.length], text: \`await\${rest}\${declared}\` } });
            },
          }),
        },`),
        "eslint.config.mjs": `
          import parser from "svelte-eslint-parser";
          import * as ts from "@typescript-eslint/parser";
          import local from "eslint-plugin-svelte";
          const cycle = { create: () => ({}) };
          export default [{
            files: ["**/*.svelte"],
            languageOptions: { parser, parserOptions: { parser: ts } },
            plugins: { import: { meta: { name: "eslint-plugin-import" }, rules: { "no-cycle": cycle } }, local },
            settings: { "import/parsers": { espree: [".js"] } },
            rules: { "import/no-cycle": ["error", { disableScc: true }], "local/change": "error" },
          }];`,
      };
      const result = await lint(files, ["--fix", "-f", "json", "a.svelte", "dep.js"], ["a.svelte"]);
      expect(places(result.raw)).toEqual([]);
      expect(result.files["a.svelte"]).toBe(
        '<script lang="ts" generics="await">import {ok} from "./dep.js";</script><script context=module>type await = number;</script>\n',
      );
      expect(result.exitCode).toBe(0);
    },
    timeout,
  );

  // ESLint reports `import/named` on entering the import and `no-restricted-syntax` on entering its specifier, whatever
  // the rule order. The processor sees them in that order, also when the file is linted again for the module rules, and
  // a pattern with the `g` flag tests each id from where it matched the previous one.
  const missingNamed = "1:17-1:24 2 import/named missing not found in './dep.js'";
  const restrictedSpecifier = "1:17-1:24 2 no-restricted-syntax Restricted.";
  test.each<[boolean, string, string[]]>([
    [true, "/import|no-restricted/g", [missingNamed]],
    [false, "/import|no-restricted/g", [missingNamed]],
    [true, "/./g", [missingNamed, restrictedSpecifier]],
    [false, "/./g", [missingNamed, restrictedSpecifier]],
  ])(
    "the processor sees what is reported when the file is linted again in ESLint's order (import/named first: %p, %s)",
    async (importFirst, pattern, expected) => {
      const of = [
        ["import/named", "error"],
        ["no-restricted-syntax", ["error", { selector: "ImportSpecifier", message: "Restricted." }]],
      ];
      const rules = {
        ...Object.fromEntries(importFirst ? of : of.toReversed()),
        "import/no-cycle": ["error", { disableScc: true }],
        "svelte/system": "error",
      };
      const files = {
        ...svelteRules('<script>import {missing} from "./dep.js";</script>\n', {}),
        "dep.js": "export const ok = 1;\n",
        "eslint.config.mjs": `
          import parser from "svelte-eslint-parser";
          import svelte from "eslint-plugin-svelte";
          export default [{
            files: ["**/*.svelte"],
            languageOptions: { parser },
            plugins: { svelte, import: { meta: { name: "eslint-plugin-import" }, rules: {} } },
            processor: "svelte/svelte",
            settings: { "import/parsers": { espree: [".js"] }, svelte: { ignoreWarnings: [${JSON.stringify(pattern)}] } },
            rules: ${JSON.stringify(rules)},
          }];`,
      };
      const result = await lint(files, ["-f", "json", "a.svelte", "dep.js"], []);
      expect(places(result.raw)).toEqual(expected);
    },
    timeout,
  );

  // A pattern with the `g` flag tests each id from its `lastIndex`, in UTF-16 code units, where the last match left it.
  test(
    "tests ids from where the last match of an ignoreWarnings pattern ends, in UTF-16 code units",
    async () => {
      const reports = 'create: ({ report }) => ({ Line: () => report({ line: 1, message: "Reported." }) })';
      const rules = { "svelte/system": "error", "local/é": "error", "local/aé": "error" };
      const settings = { svelte: { ignoreWarnings: ["/é/g"] } };
      const local = `"é": { ${reports} }, "aé": { ${reports} }`;
      const result = await lint(processed("<p></p>\n", rules, { settings, local }), ["-f", "json"], []);
      expect(places(result.raw)).toEqual([]);
    },
    timeout,
  );

  // Without the `u` flag `.` matches each half of 😀, so the id has 8 code units and each of 8 tests matches. With the
  // flag 😀 is one character, and the eighth test starts at the end.
  test.each([
    ["g", []],
    ["gy", []],
    ["gu", ["1:1 2 local/😀 Reported."]],
  ])(
    "a pattern of ignoreWarnings with the flags %s moves lastIndex between the halves of a character",
    async (flags, kept) => {
      const reports =
        "create: ({ report }) => ({ Line: () => { for (let i = 0; i < 8; i++) report({ line: 1, message: 'Reported.' }); } })";
      const rules = { "svelte/system": "error", "local/😀": "error" };
      const settings = { svelte: { ignoreWarnings: [`/./${flags}`] } };
      const local = `"😀": { ${reports} }`;
      const result = await lint(processed("<p></p>\n", rules, { settings, local }), ["-f", "json"], []);
      expect(places(result.raw)).toEqual(kept);
    },
    timeout,
  );

  test(
    "runs in place of the package's, even where ESLint runs one of the component's rules",
    async () => {
      const text = "<!-- eslint-disable-next-line local/shout -->\n<p>LOUD</p>\n";
      const rules = { "local/shout": "error", "svelte/comment-directive": "error", "svelte/system": "error" };
      const result = await lint(processed(text, rules, {}), ["-f", "json"], []);
      expect(places(result.raw)).toEqual([]);
      expect(result.exitCode).toBe(0);
    },
    timeout,
  );
});

// A typed project, as a config with `parserOptions.project` provides it for the eslint-plugin-svelte rules that read
// types: a `tsconfig.json` that includes the components, the types of `svelte/store` and SvelteKit's modules, and
// SvelteKit itself in `package.json`, for the navigation rule. The package's rules throw if ESLint runs them.
const typedProject = {
  ...svelteParser,
  ...typescriptParser,
  "node_modules/eslint-plugin-svelte/package.json": JSON.stringify({
    name: "eslint-plugin-svelte",
    version: "3.23.1",
    main: "index.js",
  }),
  "node_modules/eslint-plugin-svelte/index.js": `
    const here = name => ({ meta: { schema: [{ type: "object" }] }, create() { throw new Error(name + " ran in ESLint"); } });
    const names = ["require-store-reactive-access", "no-navigation-without-resolve", "no-unused-props"];
    module.exports = { meta: { name: "eslint-plugin-svelte", version: "3.23.1" }, rules: Object.fromEntries(names.map(it => [it, here(it)])) };`,
  "node_modules/svelte/package.json": JSON.stringify({
    name: "svelte",
    version: "5.57.2",
    exports: { "./store": { types: "./store.d.ts" } },
  }),
  "node_modules/svelte/store.d.ts": `
    export interface Readable<T> { subscribe(run: (value: T) => void, invalidate?: () => void): () => void }
    export interface Writable<T> extends Readable<T> { set(value: T): void }
    export function writable<T>(value: T): Writable<T>;`,
  "kit.d.ts": `
    declare module "$app/types" { export type ResolvedPathname = \`/\${string}\` & { readonly resolved: true } }
    declare module "$app/navigation" { export function goto(url: string): Promise<void> }
    declare module "$app/paths" { export function resolve(route: string): import("$app/types").ResolvedPathname }`,
  "package.json": JSON.stringify({ devDependencies: { "@sveltejs/kit": "^2.0.0" } }),
  "tsconfig.json": JSON.stringify({
    compilerOptions: { strict: true, lib: ["esnext", "dom"], module: "esnext", moduleResolution: "bundler" },
    include: ["*.svelte", "*.d.ts"],
  }),
};

// `files` in `typedProject`, linted with eslint-plugin-svelte's `rules`, with types if `project` names the
// `tsconfig.json`.
function typed(files: Record<string, string>, rules: Record<string, unknown>, project = '"./tsconfig.json"') {
  return {
    ...typedProject,
    ...files,
    "eslint.config.mjs": `
      import parser from "svelte-eslint-parser";
      import ts from "@typescript-eslint/parser";
      import svelte from "eslint-plugin-svelte";
      export default [{
        files: ["**/*.svelte"],
        languageOptions: { parser, parserOptions: { parser: ts, project: ${project}, extraFileExtensions: [".svelte"] } },
        plugins: { svelte },
        rules: ${JSON.stringify(rules)},
      }];`,
  };
}

// Stores as values: from `svelte/store`, a prop, in an `{#each}`, what an `{#await}` resolves to, what `{#if}` narrows,
// and two objects that only look like stores, whose `subscribe` takes one function or none.
const stores = `<script lang="ts">
  import { writable, type Readable } from "svelte/store";
  const root = writable(1);
  let { list, promise, maybe }: { list: Readable<number>[]; promise: Promise<Readable<string>>; maybe: Readable<number> | null } = $props();
  const one = { subscribe(run: (value: number) => void) { run(1); return () => {}; } };
  const flags = { subscribe(run: number, invalidate: boolean) { return () => {}; } };
  if (root) console.log(one, flags);
</script>
{root}{$root}{one}{flags}
{#each list as item}{item}{/each}
{#await promise then value}{value}{/await}
{#if maybe}{maybe}{/if}
`;

const navigation = `<script lang="ts">
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import type { ResolvedPathname } from "$app/types";
  let { resolved, plain }: { resolved: ResolvedPathname; plain: string } = $props();
  goto(resolved);
  goto(plain);
  goto(resolve("/about"));
</script>
<a href={resolved}>resolved</a><a href={plain}>plain</a>
`;

const storeRule = { "svelte/require-store-reactive-access": "error" };

describe.concurrent("eslint-plugin-svelte's native type-aware rules", () => {
  test(
    "find stores by their types, in the scripts and in the markup, when the config creates a program",
    async () => {
      const result = await lint(typed({ "a.svelte": stores }, storeRule), ["-f", "json"], []);
      expect(summary(result.raw)).toMatchInlineSnapshot(`
        "a.svelte: 7:7 svelte/require-store-reactive-access Use the $ prefix or the get function to access reactive values instead of accessing the raw store. [fix 426,426 "$"]
        a.svelte: 9:2 svelte/require-store-reactive-access Use the $ prefix or the get function to access reactive values instead of accessing the raw store. [fix 468,468 "$"]
        a.svelte: 10:22 svelte/require-store-reactive-access Use the $ prefix or the get function to access reactive values instead of accessing the raw store. [fix 514,514 "$"]
        a.svelte: 11:29 svelte/require-store-reactive-access Use the $ prefix or the get function to access reactive values instead of accessing the raw store. [fix 555,555 "$"]
        a.svelte: 12:13 svelte/require-store-reactive-access Use the $ prefix or the get function to access reactive values instead of accessing the raw store. [fix 582,582 "$"]"
      `);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  // typescript-eslint's `project` program throws when TypeScript can't parse the config, not when the options disagree.
  // The project service opens the file in either case. ESLint lints the component where it throws.
  test.each([
    ["project", { allowImportingTsExtensions: true }, true],
    ["project", { notAnOption: true }, false],
    ["projectService", { allowImportingTsExtensions: true }, true],
    ["projectService", { notAnOption: true }, true],
  ])(
    "with %s and the options %j in the configuration of TypeScript",
    async (mode, options, isHere) => {
      const project = mode === "project" ? '"./tsconfig.json"' : "undefined, projectService: true";
      const text =
        '<script lang="ts">\n  import { writable } from "svelte/store";\n  const store = writable(1);\n  if (store) {}\n</script>\n';
      const tsconfig = JSON.parse(typedProject["tsconfig.json"]);
      Object.assign(tsconfig.compilerOptions, options);
      const files = typed({ "a.svelte": text, "tsconfig.json": JSON.stringify(tsconfig) }, storeRule, project);
      const result = await lint(files, ["-f", "json"], []);
      if (!isHere) {
        expect(result.stderr).toContain("error: parsed in JavaScript");
        expect(result.exitCode).toBe(2);
        return;
      }
      expect(summary(result.raw)).toBe(
        'a.svelte: 4:7 svelte/require-store-reactive-access Use the $ prefix or the get function to access reactive values instead of accessing the raw store. [fix 97,97 "$"]',
      );
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  // typescript-eslint's project service throws for a file that `allowDefaultProject` matches and the project includes,
  // and gives a file no project includes the default project. ESLint lints the component in both cases. `*.js` matches
  // no component.
  test.each([
    [["a.svelte"], "a.svelte", false],
    [["other/*.svelte"], "other/c.svelte", false],
    [["*.js"], "a.svelte", true],
  ])(
    "with projectService and allowDefaultProject %j, %s",
    async (patterns, name, isHere) => {
      const text =
        '<script lang="ts">\n  import { writable } from "svelte/store";\n  const store = writable(1);\n  if (store) {}\n</script>\n';
      const service = `undefined, projectService: { allowDefaultProject: ${JSON.stringify(patterns)} }, tsconfigRootDir: import.meta.dirname`;
      const files = typed({ [name]: text }, storeRule, service);
      const result = await lint(files, ["-f", "json", name], []);
      if (!isHere) {
        expect(result.stderr).toContain("error: parsed in JavaScript");
        expect(result.exitCode).toBe(2);
        return;
      }
      expect(summary(result.raw)).toBe(
        'a.svelte: 4:7 svelte/require-store-reactive-access Use the $ prefix or the get function to access reactive values instead of accessing the raw store. [fix 97,97 "$"]',
      );
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "only find svelte/store's stores without a program",
    async () => {
      const result = await lint(typed({ "a.svelte": stores }, storeRule, "undefined"), ["-f", "json"], []);
      expect(summary(result.raw)).toMatchInlineSnapshot(`
        "a.svelte: 7:7 svelte/require-store-reactive-access Use the $ prefix or the get function to access reactive values instead of accessing the raw store. [fix 426,426 "$"]
        a.svelte: 9:2 svelte/require-store-reactive-access Use the $ prefix or the get function to access reactive values instead of accessing the raw store. [fix 468,468 "$"]"
      `);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "allow a ResolvedPathname with types, and only resolve() without",
    async () => {
      const rules = { "svelte/no-navigation-without-resolve": "error" };
      const [withTypes, without] = await Promise.all([
        lint(typed({ "a.svelte": navigation }, rules), ["-f", "json"], []),
        lint(typed({ "a.svelte": navigation }, rules, "undefined"), ["-f", "json"], []),
      ]);
      expect(summary(withTypes.raw)).toMatchInlineSnapshot(`
        "a.svelte: 7:8 svelte/no-navigation-without-resolve Unexpected goto() call without resolve().
        a.svelte: 10:35 svelte/no-navigation-without-resolve Unexpected href link without resolve()."
      `);
      expect(summary(without.raw)).toMatchInlineSnapshot(`
        "a.svelte: 6:8 svelte/no-navigation-without-resolve Unexpected goto() call without resolve().
        a.svelte: 7:8 svelte/no-navigation-without-resolve Unexpected goto() call without resolve().
        a.svelte: 10:4 svelte/no-navigation-without-resolve Unexpected href link without resolve().
        a.svelte: 10:35 svelte/no-navigation-without-resolve Unexpected href link without resolve()."
      `);
      expect([withTypes.exitCode, without.exitCode]).toEqual([1, 1]);
    },
    timeout,
  );

  // The parser builds `a + b + c` without recursion, and declares any number of constants that name each other.
  test(
    "svelte/no-navigation-without-resolve on deeply nested links",
    async () => {
      const constants = Array.from({ length: 40_000 }, (_, i) => `const v${i + 1} = ${i ? `v${i}` : '"/x"'};`);
      const text = `<script>\n  let h;\n${constants.join("\n")}\n</script>\n<a href={${repeated("h + ", 40_000)}h}>x</a>\n<a href={v40000}>y</a>\n`;
      const rules = { "svelte/no-navigation-without-resolve": "error" };
      const result = await lint(typed({ "a.svelte": text }, rules, "undefined"), ["-f", "json"], []);
      expect(summary(result.raw)).toBe(
        "a.svelte: 40004:4 svelte/no-navigation-without-resolve Unexpected href link without resolve().\n" +
          "a.svelte: 40005:4 svelte/no-navigation-without-resolve Unexpected href link without resolve().",
      );
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "report component positions, with the markup before the script and characters beyond ASCII",
    async () => {
      const text = `<p title="é">ünïcode {count}</p>
<script lang="ts">
  import { writable } from "svelte/store";
  // 😀
  const count = writable(0), label = \`\${count}\`;
</script>
{#each [count] as c}<b>{c}</b>{/each}
`;
      const result = await lint(typed({ "a.svelte": text }, storeRule), ["-f", "json"], []);
      expect(summary(result.raw)).toMatchInlineSnapshot(`
        "a.svelte: 1:23 svelte/require-store-reactive-access Use the $ prefix or the get function to access reactive values instead of accessing the raw store. [fix 22,22 "$"]
        a.svelte: 5:41 svelte/require-store-reactive-access Use the $ prefix or the get function to access reactive values instead of accessing the raw store. [fix 143,143 "$"]
        a.svelte: 7:25 svelte/require-store-reactive-access Use the $ prefix or the get function to access reactive values instead of accessing the raw store. [fix 186,186 "$"]"
      `);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "report the same for components regardless of how many are linted, in which order, or on how many threads",
    async () => {
      const files = typed(
        { "a.svelte": stores, "b.svelte": navigation },
        { ...storeRule, "svelte/no-navigation-without-resolve": "error" },
      );
      const runs = await Promise.all([
        lint(files, ["--threads", "1", "-f", "json", "a.svelte", "b.svelte"]),
        lint(files, ["--threads", "4", "-f", "json", "b.svelte", "a.svelte"]),
        lint(files, ["-f", "json", "a.svelte"]),
        lint(files, ["-f", "json", "b.svelte"]),
      ]);
      const [together, reversed, a, b] = runs.map(it => summary(it.raw));
      expect(reversed).toBe(together);
      expect([a, b].join("\n")).toBe(together);
      expect(together).toContain("b.svelte: 7:8 svelte/no-navigation-without-resolve");
    },
    timeout,
  );

  test(
    "fix in as many passes as it takes, with the types of each pass's output",
    async () => {
      const text = `<script lang="ts">
  import { writable } from "svelte/store";
  const inner = writable(1);
  const outer = writable(inner);
</script>
{outer}{#if $outer}{$outer}{/if}
`;
      const result = await lint(typed({ "a.svelte": text }, storeRule), ["--fix", "-f", "json"], ["a.svelte"]);
      expect(result.files["a.svelte"]).toMatchInlineSnapshot(`
        "<script lang="ts">
          import { writable } from "svelte/store";
          const inner = writable(1);
          const outer = writable(inner);
        </script>
        {$$outer}{#if $$outer}{$$outer}{/if}
        "
      `);
      expect(summary(result.raw)).toMatchInlineSnapshot(`""`);
      expect(result.exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "leave ESLint an untyped residual when its rules read no types",
    async () => {
      const files = typed({ "a.svelte": stores }, { ...storeRule, "svelte/sort-attributes": "error" });
      // A `Linter` that finds the file's config, like ESLint's, and a parser that creates a program when asked to, like
      // typescript-eslint's.
      files["node_modules/eslint/lib/config/flat-config-array.js"] = `
        exports.FlatConfigArray = class extends Array {
          constructor(configs) {
            super();
            this.push(...configs);
          }
          normalize() {}
          getConfig() {
            const [rules, plugins] = ["rules", "plugins"].map(key => Object.assign({}, ...Array.from(this, it => it[key])));
            return { ...Object.assign({}, ...this), rules, plugins };
          }
        };`;
      files["node_modules/eslint/index.js"] = `
        exports.Linter = class {
          verify(text, configs, { filename, ruleFilter }) {
            const config = configs.getConfig(filename);
            const { ast, services } = config.languageOptions.parser.parseForESLint(text, config.languageOptions.parserOptions);
            const messages = [];
            for (const [ruleId, setting] of Object.entries(config.rules)) {
              const [severity] = [setting].flat();
              if (!ruleFilter({ ruleId, severity })) continue;
              const [prefix, name] = ruleId.split("/");
              const report = ({ line, message }) => messages.push({ ruleId, severity: 2, message, line, column: 1 });
              config.plugins[prefix].rules[name].create({ sourceCode: { parserServices: services }, report }).Line(ast);
            }
            return messages;
          }
          getSuppressedMessages() {
            return [];
          }
        };`;
      files["node_modules/svelte-eslint-parser/index.js"] = `
        module.exports = {
          meta: { name: "svelte-eslint-parser", version: "1.9.0" },
          parseForESLint: (text, options) => ({ ast: { lines: text.split("\\n") }, services: options?.project ? { program: {} } : {} }),
        };`;
      files["node_modules/eslint-plugin-svelte/index.js"] = `
        const says = ({ report, sourceCode }) => ({ Line: () => report({ line: 1, message: sourceCode.parserServices.program ? "with a program" : "without a program" }) });
        const sorted = { meta: { schema: [] }, create: says };
        const here = { meta: { schema: [] }, create() { throw new Error("ran in ESLint"); } };
        const rules = { "sort-attributes": sorted, "require-store-reactive-access": here };
        module.exports = { meta: { name: "eslint-plugin-svelte", version: "3.23.1" }, rules };`;
      const result = await lint(files, ["-f", "json"]);
      const reported = summary(result.raw).split("\n");
      expect(reported.filter(it => it.includes("sort-attributes"))).toEqual([
        "a.svelte: 1:1 svelte/sort-attributes without a program",
      ]);
      expect(reported.length).toBe(6);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "leave them to ESLint when TypeScript can't read the config, because typescript-eslint throws there",
    async () => {
      const files = typed({ "a.svelte": stores }, storeRule);
      files["tsconfig.json"] = JSON.stringify({ extends: "./missing.json", include: ["*.svelte"] });
      const result = await lint(files, ["-f", "json"]);
      // ESLint parses the component, here with a throwing parser, to run the rule with types.
      expect(result.stderr).toContain("error: parsed in JavaScript");
      expect(result.exitCode).toBe(2);
    },
    timeout,
  );

  // A comment in the component disables ESLint's reports for the rule there, as it disables the native rule.
  test(
    "leave them to ESLint under the component's comments",
    async () => {
      const text =
        '<script lang="ts">\n  import { writable } from "svelte/store";\n  const store = writable(0);\n  // eslint-disable-next-line svelte/require-store-reactive-access\n  console.log(store + 1);\n</script>\n';
      const files = typed({ "a.svelte": text }, storeRule);
      files["tsconfig.json"] = JSON.stringify({ extends: "./missing.json", include: ["*.svelte"] });
      files["node_modules/eslint/index.js"] = `
        exports.Linter = class {
          verify(text, configs, { filename, ruleFilter }) {
            const config = configs.getConfig(filename);
            const { ast } = config.languageOptions.parser.parseForESLint(text, config.languageOptions.parserOptions);
            const messages = [];
            for (const [ruleId, setting] of Object.entries(config.rules)) {
              const [severity] = [setting].flat();
              if (!ruleFilter({ ruleId, severity })) continue;
              const [prefix, name] = ruleId.split("/");
              const report = ({ line, column, message }) => messages.push({ ruleId, severity: 2, message, line, column });
              config.plugins[prefix].rules[name].create({ report }).Line(ast);
            }
            return messages;
          }
          getSuppressedMessages() {
            return [];
          }
        };`;
      files["node_modules/eslint/lib/config/flat-config-array.js"] = `
        exports.FlatConfigArray = class extends Array {
          constructor(configs) {
            super();
            this.push(...configs);
          }
          normalize() {}
          getConfig() {
            const [rules, plugins] = ["rules", "plugins"].map(key => Object.assign({}, ...Array.from(this, it => it[key])));
            return { ...Object.assign({}, ...this), rules, plugins };
          }
        };`;
      files["node_modules/svelte-eslint-parser/index.js"] = `
        module.exports = {
          meta: { name: "svelte-eslint-parser", version: "1.9.0" },
          parseForESLint: text => ({ ast: { lines: text.split("\\n") }, services: {} }),
        };`;
      files["node_modules/eslint-plugin-svelte/index.js"] = `
        const store = { meta: { schema: [] }, create: ({ report }) => ({ Line: ({ lines }) => lines.forEach((line, i) => {
          if (line.includes("store + 1")) report({ line: i + 1, column: 15, message: "Raw store." });
        }) }) };
        module.exports = { meta: { name: "eslint-plugin-svelte", version: "3.23.1" }, rules: { "require-store-reactive-access": store } };`;
      const result = await lint(files, ["-f", "json"]);
      expect(summary(result.raw)).toBe("a.svelte: 5:15 svelte/require-store-reactive-access Raw store. [suppressed: ]");
      expect(result.exitCode).toBe(0);
    },
    timeout,
  );
});

// Components with typed props, and what eslint-plugin-svelte 3.23.1 with TypeScript 6.0.3 reports for them: the
// properties in TypeScript 6's insertion order (bases in `extends` order, a spread's right operand first), one report
// per printed type of a nested property, and what the imports' types declare, only with `checkImportedTypes`.
const propsOf = {
  "heritage.svelte": `<script lang="ts">
  interface Named { zName: string; aName: string }
  interface Dated { zDate: Date; aDate: Date }
  interface Item extends Dated, Named { zItem: number; aItem: number }
  let { aItem }: Item = $props();
</script>
{aItem}
`,
  "intersection.svelte": `<script lang="ts">
  interface Sizes { zSize: number; aSize: number }
  interface Colors { zColor: string; aColor: string }
  let { aSize }: Colors & Sizes = $props();
</script>
{aSize}
`,
  "imported.svelte": `<script lang="ts">
 import type { Imported } from "./types";
 interface Base { zBase: number; aBase: number }
 interface Local extends Base { used: { zNested: string; used: number; aNested: boolean }; zLocal: number; aLocal: number }
 let { used }: Local & Imported & Pick<{ zPick: boolean; aPick: number }, "zPick" | "aPick"> = $props();
</script>
{used.used}`,
  "types.ts": "export interface Imported { zImported: string; aImported: boolean }\n",
  // Both nested types print as `{ used: number; missing: number; }`, so only the first, `right`'s, is checked.
  "spread.svelte": `<script lang="ts">
 const base = { left: { used: 1, missing: 2 } };
 const both = { ...base, right: { used: 3, missing: 4 } };
 let props: typeof both = $props();
</script>{props.left.used}{props.right.used}`,
  "printed.svelte": `<script lang="ts">
  const defaults = { zDefault: 1, aDefault: 2 };
  const settings = { ...defaults, zSetting: true, aSetting: false };
  let { options }: { options: typeof settings; label: string } = $props();
</script>
{options.zDefault}
`,
  "index.svelte": `<script lang="ts">
 interface Props { used: number; zUnused: number; aUnused: number; [key: string]: number }
 let { used }: Props = $props();
</script>{used}`,
};

const unusedProps = (options: object = {}) => ({ "svelte/no-unused-props": ["error", options] });

// Where Bun differs from TypeScript 6 in the components of oracle/types-order/, as [TypeScript 6's, Bun's]: the keys of
// a mapped type over a union come in union order, `{[K in "z" | "a" | "m"]: number}` and `as Uppercase<K>`.
const unionOrder: Record<string, [string, string][]> = {
  "main.svelte": [
    ["3:7 'z' in 'mapped' is an unused property.", "3:7 'a' in 'mapped' is an unused property."],
    ["3:7 'a' in 'mapped' is an unused property.", "3:7 'm' in 'mapped' is an unused property."],
    ["3:7 'm' in 'mapped' is an unused property.", "3:7 'z' in 'mapped' is an unused property."],
    ["3:7 'Z' in 'remapped' is an unused property.", "3:7 'A' in 'remapped' is an unused property."],
    ["3:7 'A' in 'remapped' is an unused property.", "3:7 'Z' in 'remapped' is an unused property."],
  ],
};

describe.concurrent("native svelte/no-unused-props", () => {
  test.each([
    ["ignoreTypePatterns", "batch"],
    ["ignorePropertyPatterns", "batch"],
    ["ignoreTypePatterns", "stdin"],
    ["ignorePropertyPatterns", "stdin"],
    ["ignoreTypePatterns", "fix"],
    ["ignorePropertyPatterns", "fix"],
  ])(
    "surface invalid %s in the %s path",
    async (option, mode) => {
      const text = `<script lang="ts">
  let { used }: { used: number; unused: number } = $props();
</script>{used}`;
      const files = typed(
        { "a.svelte": text, "b.svelte": text },
        { ...unusedProps({ [option]: ["/[/"] }), "prefer-const": "error" },
      );
      const args =
        mode === "stdin"
          ? ["--stdin", "--stdin-filename", "a.svelte"]
          : mode === "fix"
            ? ["--fix", "a.svelte"]
            : ["a.svelte", "b.svelte"];
      const result = await lint(files, ["-f", "json", ...args], ["a.svelte"], {}, mode === "stdin" ? text : undefined);
      expect(result.stderr).toContain(
        "Error while loading rule 'svelte/no-unused-props': Invalid regular expression: /[/: Unterminated character class",
      );
      expect(result.stderr).toMatch(/Occurred while linting <dir>\/[ab]\.svelte/);
      expect(result.raw).toBe("");
      expect(result.files["a.svelte"]).toBe(text);
      expect(result.exitCode).toBe(2);
    },
    timeout,
  );

  test.each(["ignoreTypePatterns", "ignorePropertyPatterns"])(
    "doesn't compile %s without types",
    async option => {
      const files = typed({ "a.svelte": propsOf["spread.svelte"] }, unusedProps({ [option]: ["/[/"] }), "undefined");
      const result = await lint(files, ["-f", "json"], []);
      expect(summary(result.raw)).toBe("");
      expect(result.exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "keeps type-query paths distinct from runtime member accesses",
    async () => {
      const files = {
        "plain.svelte": `<script lang="ts">
  interface Props { user: { name: string; age: number }; count: number; unused: string }
  let p: Props = $props();
</script>{p.user.name}{p.count}`,
        "query.svelte": `<script lang="ts">
  interface Props { user: { name: string }; title: string }
  let props: Props = $props();
  type User = typeof props.user;
</script>
<p>{props.title}</p>`,
        "typeonly.svelte": `<script lang="ts">
  interface Props { a: { used: string; miss: number }; unused: number }
  let p: Props = $props();
  type A = typeof p.a;
</script>`,
        "typedestruct.svelte": `<script lang="ts">
  interface Props { a: { used: string; miss: number }; unused: number }
  let { a }: Props = $props();
  type A = typeof a;
</script>`,
      };
      const result = await lint(typed(files, unusedProps()), ["-f", "json"], []);
      expect(summary(result.raw)).toMatchInlineSnapshot(`
        "plain.svelte: 3:7 svelte/no-unused-props 'age' in 'user' is an unused property.
        plain.svelte: 3:7 svelte/no-unused-props 'unused' is an unused Props property.
        query.svelte: 3:7 svelte/no-unused-props 'user' is an unused Props property.
        query.svelte: 3:7 svelte/no-unused-props 'title' is an unused Props property.
        typedestruct.svelte: 3:7 svelte/no-unused-props 'unused' is an unused Props property.
        typeonly.svelte: 3:7 svelte/no-unused-props 'a' is an unused Props property.
        typeonly.svelte: 3:7 svelte/no-unused-props 'unused' is an unused Props property."
      `);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "reports the props in TypeScript 6's order",
    async () => {
      const result = await lint(typed(propsOf, unusedProps()), ["-f", "json"]);
      expect(summary(result.raw)).toMatchInlineSnapshot(`
        "heritage.svelte: 5:7 svelte/no-unused-props 'zDate' is an unused Props property.
        heritage.svelte: 5:7 svelte/no-unused-props 'aDate' is an unused Props property.
        heritage.svelte: 5:7 svelte/no-unused-props 'zName' is an unused Props property.
        heritage.svelte: 5:7 svelte/no-unused-props 'aName' is an unused Props property.
        heritage.svelte: 5:7 svelte/no-unused-props 'zItem' is an unused Props property.
        imported.svelte: 5:6 svelte/no-unused-props 'zNested' in 'used' is an unused property.
        imported.svelte: 5:6 svelte/no-unused-props 'aNested' in 'used' is an unused property.
        imported.svelte: 5:6 svelte/no-unused-props 'zLocal' is an unused Props property.
        imported.svelte: 5:6 svelte/no-unused-props 'aLocal' is an unused Props property.
        imported.svelte: 5:6 svelte/no-unused-props 'zBase' is an unused Props property.
        imported.svelte: 5:6 svelte/no-unused-props 'aBase' is an unused Props property.
        imported.svelte: 5:6 svelte/no-unused-props 'zPick' is an unused Props property.
        imported.svelte: 5:6 svelte/no-unused-props 'aPick' is an unused Props property.
        index.svelte: 3:6 svelte/no-unused-props 'zUnused' is an unused Props property.
        index.svelte: 3:6 svelte/no-unused-props 'aUnused' is an unused Props property.
        index.svelte: 3:6 svelte/no-unused-props Index signature is unused. Consider using rest operator (...) to capture remaining properties.
        intersection.svelte: 4:7 svelte/no-unused-props 'zColor' is an unused Props property.
        intersection.svelte: 4:7 svelte/no-unused-props 'aColor' is an unused Props property.
        intersection.svelte: 4:7 svelte/no-unused-props 'zSize' is an unused Props property.
        printed.svelte: 4:7 svelte/no-unused-props 'zSetting' in 'options' is an unused property.
        printed.svelte: 4:7 svelte/no-unused-props 'aSetting' in 'options' is an unused property.
        printed.svelte: 4:7 svelte/no-unused-props 'aDefault' in 'options' is an unused property.
        printed.svelte: 4:7 svelte/no-unused-props 'label' is an unused Props property.
        spread.svelte: 4:6 svelte/no-unused-props 'missing' in 'right' is an unused property."
      `);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  // What eslint-plugin-svelte 3.23.1 with TypeScript 6.0.3 reports for the components of oracle/types-order/ (see
  // oracle/types-order.mjs). TypeScript 6 orders a union's constituents in whatever order it created the types, and Bun
  // keeps them sorted. Where that shows, `unionOrder` has TypeScript 6's messages and Bun's.
  test(
    "reports type properties in TypeScript 6's order, and prints them as it prints them",
    async () => {
      const files = typed(typesOrderFiles(), unusedProps({ checkImportedTypes: true }));
      const result = await lint(files, ["-f", "json", ...typesOrderLinted]);
      const found: Record<string, string[]> = {};
      for (const { filePath, messages } of JSON.parse(result.raw)) {
        found[filePath.replaceAll("\\", "/").split("/").at(-1)] = messages.map(typesOrderShown);
      }
      // What TypeScript 6 reports, with Bun's reports in place of `unionOrder`'s.
      const expected = Object.fromEntries(
        Object.entries(typesOrderExpected.files).map(([name, messages]) => {
          const here = new Map(unionOrder[name] ?? []);
          return [name, (messages as string[]).map(it => here.get(it) ?? it)];
        }),
      );
      expect(found).toEqual(expected);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  // Each interface extends both interfaces of the level below, so the bases reach the first two by 2^40 paths. Each is
  // checked once.
  test(
    "checks heritage that many bases share once",
    async () => {
      let interfaces = "  interface A0 { z: number; a: number }\n  interface B0 { z: number; a: number }\n";
      for (let i = 1; i <= 40; i++) {
        interfaces += `  interface A${i} extends A${i - 1}, B${i - 1} {}\n  interface B${i} extends A${i - 1}, B${i - 1} {}\n`;
      }
      const text = `<script lang="ts">\n${interfaces}  let props: A40 = $props();\n</script>\n`;
      const result = await lint(typed({ "a.svelte": text }, unusedProps()), ["-f", "json"]);
      expect(summary(result.raw)).toMatchInlineSnapshot(`
        "a.svelte: 84:7 svelte/no-unused-props 'z' is an unused Props property.
        a.svelte: 84:7 svelte/no-unused-props 'a' is an unused Props property."
      `);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "reports nothing without types",
    async () => {
      const result = await lint(typed(propsOf, unusedProps(), "undefined"), ["-f", "json"], []);
      expect(summary(result.raw)).toBe("");
      expect(result.exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "checks what imported types declare with checkImportedTypes",
    async () => {
      const files = typed(propsOf, unusedProps({ checkImportedTypes: true }));
      const result = await lint(files, ["-f", "json", "imported.svelte"], []);
      expect(summary(result.raw)).toMatchInlineSnapshot(`
        "imported.svelte: 5:6 svelte/no-unused-props 'zNested' in 'used' is an unused property.
        imported.svelte: 5:6 svelte/no-unused-props 'aNested' in 'used' is an unused property.
        imported.svelte: 5:6 svelte/no-unused-props 'zLocal' is an unused Props property.
        imported.svelte: 5:6 svelte/no-unused-props 'aLocal' is an unused Props property.
        imported.svelte: 5:6 svelte/no-unused-props 'zBase' is an unused Props property.
        imported.svelte: 5:6 svelte/no-unused-props 'aBase' is an unused Props property.
        imported.svelte: 5:6 svelte/no-unused-props 'zImported' is an unused Props property.
        imported.svelte: 5:6 svelte/no-unused-props 'aImported' is an unused Props property.
        imported.svelte: 5:6 svelte/no-unused-props 'zPick' is an unused Props property.
        imported.svelte: 5:6 svelte/no-unused-props 'aPick' is an unused Props property."
      `);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  // What TypeScript 6.0.3 prints for these types (`typeChecker.typeToString`), which eslint-plugin-svelte 3.23.1
  // matches `ignoreTypePatterns` against: a pattern of the whole text only ignores the type if Bun prints it the same
  // way.
  test.each([
    ["heritage.svelte", "Item", ""],
    ["intersection.svelte", "Colors & Sizes", ""],
    // TypeScript 6 has `"zPick" | "aPick"`, in the order it created the types. Bun keeps a union sorted.
    ["imported.svelte", 'Local & Imported & Pick<{ zPick: boolean; aPick: number; }, "aPick" | "zPick">', ""],
    ["spread.svelte", "{ right: { used: number; missing: number; }; left: { used: number; missing: number; }; }", ""],
    [
      "printed.svelte",
      "{ options: { zSetting: boolean; aSetting: boolean; zDefault: number; aDefault: number; }; label: string; }",
      "",
    ],
    [
      "printed.svelte",
      "{ zSetting: boolean; aSetting: boolean; zDefault: number; aDefault: number; }",
      "printed.svelte: 4:7 svelte/no-unused-props 'label' is an unused Props property.",
    ],
    [
      "imported.svelte",
      "{ zNested: string; used: number; aNested: boolean; }",
      ["zLocal", "aLocal", "zBase", "aBase", "zPick", "aPick"]
        .map(it => `imported.svelte: 5:6 svelte/no-unused-props '${it}' is an unused Props property.`)
        .join("\n"),
    ],
  ])(
    "match ignoreTypePatterns against all of a type as TypeScript 6 prints it: %s, %s",
    async (name, printed, reported) => {
      const pattern = `/^${printed.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}$/`;
      const files = typed(propsOf, unusedProps({ ignoreTypePatterns: [pattern] }));
      const result = await lint(files, ["-f", "json", name], []);
      expect(summary(result.raw)).toBe(reported);
      expect(result.exitCode).toBe(reported === "" ? 0 : 1);
    },
    timeout,
  );

  // TypeScript 6 has the keys of `Pick` in whatever order it created the types of their union, here `mKey` before
  // `zKey`. Bun keeps the union in its own order.
  test(
    "keeps its own order for a union's members",
    async () => {
      const text = `<script lang="ts">
  type Keys = "mKey" | "zKey";
  let { aKey }: Pick<{ zKey: 1; aKey: 2; mKey: 3 }, Keys | "aKey"> & { mode: "z" | "a" } = $props();
</script>
{aKey}
`;
      const result = await lint(typed({ "a.svelte": text }, unusedProps()), ["-f", "json"], []);
      expect(summary(result.raw)).toMatchInlineSnapshot(`
        "a.svelte: 3:7 svelte/no-unused-props 'zKey' is an unused Props property.
        a.svelte: 3:7 svelte/no-unused-props 'mKey' is an unused Props property.
        a.svelte: 3:7 svelte/no-unused-props 'mode' is an unused Props property."
      `);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  // eslint-plugin-svelte only counts a string key if its value is a plain name without a default.
  test(
    "counts the destructuring's keys like upstream does",
    async () => {
      const text = `<script lang="ts">
  interface Props { "aria-label"?: string; "data-id": string; ["computed"]: number; title: string; zLast: boolean }
  let { "aria-label": label = "", "data-id": id, ["computed"]: computed, title }: Props = $props();
</script>
{label}{id}{computed}{title}
`;
      const result = await lint(typed({ "a.svelte": text }, unusedProps()), ["-f", "json"], []);
      expect(summary(result.raw)).toMatchInlineSnapshot(`
        "a.svelte: 3:7 svelte/no-unused-props 'aria-label' is an unused Props property.
        a.svelte: 3:7 svelte/no-unused-props 'zLast' is an unused Props property."
      `);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "reports the same for components regardless of how many are linted, in which order, or on how many threads",
    async () => {
      const files = typed(propsOf, unusedProps());
      const names = Object.keys(propsOf).filter(it => it.endsWith(".svelte"));
      const runs = await Promise.all([
        lint(files, ["--threads", "1", "-f", "json", ...names]),
        lint(files, ["--threads", "4", "-f", "json", ...names.toReversed()]),
        ...names.map(name => lint(files, ["-f", "json", name])),
      ]);
      const [together, reversed, ...alone] = runs.map(it => summary(it.raw));
      expect(reversed).toBe(together);
      expect(alone.filter(Boolean).sort().join("\n")).toBe(together);
      expect(together.split("\n").length).toBe(24);
    },
    timeout,
  );
});

// What svelte-eslint-parser's component program knows that the scripts' program alone doesn't: the types it gives to
// handlers, to component attribute values and to `let:` declarations, `$derived` in a separate function, and JSDoc in a
// JavaScript component. Svelte's types as far as those use them. The expected output is what ESLint with
// svelte-eslint-parser 1.9.0, typescript-eslint 8.71.1 and Svelte 5.57 reports for the same components.
const svelteTypes = {
  "node_modules/svelte/package.json": JSON.stringify({
    name: "svelte",
    version: "5.57.2",
    exports: {
      ".": { types: "./index.d.ts" },
      "./elements": { types: "./elements.d.ts" },
      "./store": { types: "./store.d.ts" },
    },
  }),
  "node_modules/svelte/index.d.ts": `
    export class SvelteComponent<Props extends Record<string, any> = Record<string, any>, Events extends Record<string, any> = any, Slots extends Record<string, any> = any> {
      [prop: string]: any;
      constructor(options: { target: Element; props?: Props });
      $$prop_def: Props;
      $$events_def: Events;
      $$slot_def: Slots;
    }
    export interface Component<Props extends Record<string, any> = {}, Exports extends Record<string, any> = {}> {
      (this: void, internals: unknown, props: Props): Exports;
    }
    export type ComponentEvents<Comp extends SvelteComponent> = Comp extends SvelteComponent<any, infer Events> ? Events : never;
    export type ComponentProps<Comp extends SvelteComponent | Component<any, any>> =
      Comp extends SvelteComponent<infer Props> ? Props : Comp extends Component<infer Props, any> ? Props : never;`,
  "node_modules/svelte/elements.d.ts": `
    type EventHandler<E extends Event = Event, T extends EventTarget = Element> = (event: E & { currentTarget: EventTarget & T }) => any;
    export interface DOMAttributes<T extends EventTarget> {
      "on:click"?: EventHandler<MouseEvent, T> | undefined | null;
      onclick?: EventHandler<MouseEvent, T> | undefined | null;
      "on:change"?: EventHandler<Event, T> | undefined | null;
      onchange?: EventHandler<Event, T> | undefined | null;
    }
    export interface HTMLAttributes<T extends EventTarget> extends DOMAttributes<T> { class?: string | undefined | null }
    export interface SvelteHTMLElements {
      button: HTMLAttributes<HTMLButtonElement>;
      select: HTMLAttributes<HTMLSelectElement>;
      [name: string]: { [name: string]: any };
    }`,
  "node_modules/svelte/store.d.ts": `
    export interface Readable<T> { subscribe(run: (value: T) => void, invalidate?: () => void): () => void }
    export interface Writable<T> extends Readable<T> { set(value: T): void }
    export function writable<T>(value: T): Writable<T>;
    export function readable<T>(value: T): Readable<T>;
    export function derived<S, T>(store: Readable<S>, fn: (value: S) => T): Readable<T>;`,
  "Widget.ts": `import {SvelteComponent} from "svelte";import type {Readable} from "svelte/store";export default class Widget extends SvelteComponent<{onselect?:(store:Readable<number>)=>void},{select:CustomEvent<Readable<number>>},{default:{store:Readable<number>}}> {}`,
};

describe.concurrent.each([
  ["project", '"./tsconfig.json"'],
  ["projectService", "undefined, projectService: true"],
])("JavaScript component project roots with %s", (mode, project) => {
  const helper = `/** @returns {import("svelte/store").Readable<number>} */
function getStore() { return { subscribe(run) { run(1); return () => {}; } }; }
`;
  const component = `<script>
const store = getStore();
</script>
{store}
`;
  const config = (allowJs?: boolean) =>
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        allowJs,
        lib: ["es5"],
        module: "esnext",
        moduleResolution: "bundler",
      },
      include: ["*.svelte", "*.ts", "*.js"],
      exclude: ["node_modules"],
    });

  describe.each([
    ["plain", false],
    ["fix", true],
  ] as const)("%s", (_, fix) => {
    test.each([
      ["unset", undefined],
      ["false", false],
      ["true", true],
    ] as const)("preserves the roots discovered with allowJs=%s", async (_, allowJs) => {
      const components: Record<string, string> = { "a.svelte": component };
      if (mode === "projectService") components["b.svelte"] = component.replace("<script>", '<script lang="ts">');
      const files = typed(
        { ...components, "helpers.js": helper, "tsconfig.json": config(allowJs) },
        storeRule,
        project,
      );
      const names = Object.keys(components);
      const args = [...(fix ? ["--fix"] : []), "-f", "json", ...names];
      const result = await lint(files, args, names);
      const hasGlobals = allowJs === true || mode === "project";
      const reports = [
        'a.svelte: 4:2 svelte/require-store-reactive-access Use the $ prefix or the get function to access reactive values instead of accessing the raw store. [fix 46,46 "$"]',
        ...(mode === "projectService"
          ? [
              'b.svelte: 4:2 svelte/require-store-reactive-access Use the $ prefix or the get function to access reactive values instead of accessing the raw store. [fix 56,56 "$"]',
            ]
          : []),
      ];
      expect(summary(result.raw)).toBe(hasGlobals && !fix ? reports.join("\n") : "");
      expect(result.files).toEqual(
        Object.fromEntries(
          Object.entries(components).map(([name, text]) => [
            name,
            hasGlobals && fix ? text.replace("{store}", "{$store}") : text,
          ]),
        ),
      );
      expect(result.exitCode).toBe(hasGlobals && !fix ? 1 : 0);
    });

    test.each([
      [
        "an imported JavaScript module",
        component.replace("const store", 'import { getStore } from "./helpers.js";\nconst store'),
        87,
      ],
      [
        "a JSDoc annotation",
        '<script>\n/** @type {import("svelte/store").Readable<number>} */\nlet store;\n</script>\n{store}\n',
        86,
      ],
    ] as const)("keeps types from %s with allowJs=false", async (_, text, offset) => {
      const files = typed(
        {
          "a.svelte": text,
          "helpers.js": helper.replace("function getStore", "export function getStore"),
          "tsconfig.json": config(false),
        },
        storeRule,
        project,
      );
      const result = await lint(files, [...(fix ? ["--fix"] : []), "-f", "json", "a.svelte"], ["a.svelte"]);
      expect(summary(result.raw)).toBe(
        fix
          ? ""
          : `a.svelte: 5:2 svelte/require-store-reactive-access Use the $ prefix or the get function to access reactive values instead of accessing the raw store. [fix ${offset},${offset} "$"]`,
      );
      expect(result.files).toEqual({ "a.svelte": fix ? text.replace("{store}", "{$store}") : text });
      expect(result.exitCode).toBe(fix ? 0 : 1);
    });
  });

  test("doesn't admit an excluded JavaScript component", async () => {
    const files = typed(
      {
        "a.svelte": component,
        "included.ts": "export {};\n",
        "helpers.js": helper,
        "tsconfig.json": JSON.stringify({
          compilerOptions: { allowJs: false },
          include: ["included.ts", "helpers.js"],
        }),
      },
      storeRule,
      project,
    );
    const result = await lint(files, ["--fix", "-f", "json", "a.svelte"], ["a.svelte"]);
    expect(result.stderr).toContain("error: parsed in JavaScript");
    expect(result.files).toEqual({ "a.svelte": component });
    expect(result.exitCode).toBe(2);
  });
});

const both = { ...storeRule, "svelte/no-navigation-without-resolve": "error" };
const imports = `import { writable, readable, derived, type Readable } from "svelte/store";`;
const script = (code: string, markup: string, lang = ' lang="ts"') =>
  `<script${lang}>\n${code}\n</script>\n${markup}\n`;

describe.concurrent("a component's typed program, as svelte-eslint-parser builds it", () => {
  test.each([
    [
      "onchange of a <select>",
      "a.svelte",
      script(
        `import {goto} from "$app/navigation";`,
        `<select onchange={event=>goto(event.currentTarget.value)}><option value="/settings">Settings</option></select>`,
      ),
      "a.svelte: 4:31 svelte/no-navigation-without-resolve Unexpected goto() call without resolve().",
    ],
    [
      "on:select of a component, whose events have types",
      "handler.svelte",
      script(
        `import Widget from "./Widget";`,
        `<Widget on:select={e=>console.log(-e.detail)}/><Widget onselect={store=>console.log(-store)}/>`,
      ),
      "handler.svelte: 4:36 svelte/require-store-reactive-access Use the $ prefix or the get function to access reactive values instead of accessing the raw store.",
    ],
    [
      "let: of the slot of a component",
      "slot.svelte",
      script(`import Widget from "./Widget";`, "<Widget let:store>{store}</Widget>"),
      'slot.svelte: 4:20 svelte/require-store-reactive-access Use the $ prefix or the get function to access reactive values instead of accessing the raw store. [fix 79,79 "$"]',
    ],
    [
      "$derived, which does not narrow what it reads",
      "derived.svelte",
      script(
        `${imports}let maybe:Readable<number>|number=1;const value=$derived(maybe);const text=$derived(maybe+1);`,
        "{value}{text}",
      ),
      'derived.svelte: 2:159 svelte/require-store-reactive-access Use the $ prefix or the get function to access reactive values instead of accessing the raw store. [fix 177,177 "$"]\nderived.svelte: 4:2 svelte/require-store-reactive-access Use the $ prefix or the get function to access reactive values instead of accessing the raw store. [fix 198,198 "$"]',
    ],
    [
      "JSDoc in a component of JavaScript",
      "js-jsdoc.svelte",
      script(`/** @type {import("svelte/store").Readable<number>} */\nlet store;`, "{store}", ""),
      'js-jsdoc.svelte: 5:2 svelte/require-store-reactive-access Use the $ prefix or the get function to access reactive values instead of accessing the raw store. [fix 86,86 "$"]',
    ],
    [
      "a computed key of a destructuring",
      "destructuring.svelte",
      script(`${imports}const key=writable("x");const obj={x:1};const {[key]:value}=obj;`, "{value}"),
      'destructuring.svelte: 2:123 svelte/require-store-reactive-access Use the $ prefix or the get function to access reactive values instead of accessing the raw store. [fix 141,141 "$"]',
    ],
    [
      "the decoded values of href and rel",
      "entity.svelte",
      script(
        "",
        `<a href="&#35;section">fragment</a><a href="https&#58;//example.com">url</a><a href="/x" rel="exter&#110;al">external</a>`,
      ),
      "",
    ],
  ])(
    "has the types of %s",
    async (_, name, text, expected) => {
      const result = await lint(typed({ ...svelteTypes, [name]: text }, both), ["-f", "json", name]);
      expect(summary(result.raw)).toBe(expected);
      expect(result.exitCode).toBe(expected ? 1 : 0);
    },
    timeout,
  );

  // An import of a component resolves to the ambient declarations' `*.svelte`, whether the component is linted too or
  // not.
  test(
    "reports the same for a component that imports another, with or without it",
    async () => {
      const files = typed(
        {
          ...svelteTypes,
          "Module.svelte": `<script module lang="ts">import {writable} from "svelte/store";export const store=writable(1);</script>`,
          "Consumer.svelte": script(`import {store} from "./Module.svelte";`, "{store}"),
        },
        storeRule,
      );
      const [alone, together] = await Promise.all([
        lint(files, ["-f", "json", "Consumer.svelte"]),
        lint(files, ["-f", "json", "Module.svelte", "Consumer.svelte"]),
      ]);
      expect([summary(alone.raw), summary(together.raw)]).toEqual(["", ""]);
      expect([alone.exitCode, together.exitCode]).toEqual([0, 0]);
    },
    timeout,
  );

  // typescript-eslint throws for a component that no `project` project has among its root files and that the project
  // service doesn't find. ESLint lints it and says so, and the fake parser here throws.
  test.each([
    ["project", '"./tsconfig.json"'],
    ["projectService", "undefined, projectService: true"],
  ])(
    "leaves a component that the configuration file does not include to ESLint, with %s",
    async (_, project) => {
      const files = typed({ ...svelteTypes, "a.svelte": stores, "included.ts": "export {};\n" }, storeRule, project);
      files["tsconfig.json"] = JSON.stringify({
        compilerOptions: { strict: true, lib: ["esnext", "dom"], module: "esnext", moduleResolution: "bundler" },
        include: ["included.ts", "*.d.ts"],
      });
      const result = await lint(files, ["-f", "json", "a.svelte"]);
      expect(result.stderr).toContain("error: parsed in JavaScript");
      expect(result.exitCode).toBe(2);
    },
    timeout,
  );
});

// A plugin whose rules read svelte-eslint-parser's tree, scopes and tokens. On a natively linted component they run in
// the plugin host on what Bun builds from the component, and the fake parser throws if anything parses it in
// JavaScript. The expected output is what ESLint 10 with svelte-eslint-parser 1.9 reports.
const readsComponents = `{
    rules: {
      label: {
        meta: { fixable: "code", hasSuggestions: true },
        create(context) {
          const { sourceCode } = context;
          return {
            'SvelteAttribute[key.name="aria-label"] > SvelteLiteral'(node) {
              const element = node.parent.parent.parent;
              if (sourceCode.getText(node) === "Label") return;
              context.report({
                node,
                message: element.type + " " + element.name.name + " " + sourceCode.getText(node) + " " + node.loc.start.line + ":" + node.loc.start.column,
                fix: fixer => fixer.replaceText(node, "Label"),
                suggest: [{ desc: "Remove it.", fix: fixer => fixer.remove(node.parent) }],
              });
            },
          };
        },
      },
      scope: {
        create(context) {
          const { sourceCode } = context;
          return {
            "SvelteMustacheTag > Identifier"(node) {
              const scope = sourceCode.getScope(node);
              let reference;
              for (let it = scope; it && !reference; it = it.upper) reference = it.references.find(r => r.identifier === node);
              const variable = reference && reference.resolved;
              const definition = variable && variable.defs[0];
              const tokens = sourceCode.getTokens(node.parent).map(it => it.type + ":" + it.value).join(" ");
              context.report({
                node,
                message: [scope.type, scope.block.type, definition ? definition.type + "@" + definition.name.range : "none", tokens].join(" "),
              });
            },
          };
        },
      },
    },
  }`;

const hostedComponent = `<script>
  let items = [1];
  let item = 0;
</script>
<button aria-label="Close" class:on={item}>{item}</button>
{#each items as item, i (item)}<span aria-label='Item'>{item /* eslint-disable-line local/scope */}{i}</span>{/each}
{#snippet row(item)}{item}{/snippet}
`;

function hosted(rules: Record<string, unknown>) {
  return {
    ...svelteParser,
    "eslint.config.mjs": `
      import parser from "svelte-eslint-parser";
      const local = ${readsComponents};
      export default [{ files: ["**/*.svelte"], languageOptions: { parser }, plugins: { local }, rules: ${JSON.stringify(rules)} }];`,
    "a.svelte": hostedComponent,
  };
}

describe.concurrent("plugin rules on a natively linted component", () => {
  const rules = { "local/label": "error", "local/scope": "error" };

  test(
    "run in the host, on svelte-eslint-parser's nodes, scopes and tokens where the component has them",
    async () => {
      const result = await lint(hosted(rules), ["-f", "json"]);
      expect(summary(result.raw)).toMatchInlineSnapshot(`
        "a.svelte: 5:21 local/label SvelteElement button Close 5:20 [fix 74,79 "Label"] [1 suggestion]
        a.svelte: 5:45 local/scope module Program Variable@34,38 Punctuator:{ Identifier:item Punctuator:}
        a.svelte: 6:50 local/label SvelteElement span Item 6:49 [fix 162,166 "Label"] [1 suggestion]
        a.svelte: 7:22 local/scope function SvelteSnippetBlock Parameter@244,248 Punctuator:{ Identifier:item Punctuator:}
        a.svelte: 6:57 local/scope function SvelteEachBlock Parameter@129,133 Punctuator:{ Identifier:item Punctuator:} [suppressed: ]
        a.svelte: 6:101 local/scope function SvelteEachBlock Parameter@135,136 Punctuator:{ Identifier:i Punctuator:} [suppressed: ]"
      `);
      expect(suggested(result.raw)).toEqual(["5:21 62,80", "6:50 150,167"]);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "fix the component in its own text",
    async () => {
      const result = await lint(hosted(rules), ["--fix"], ["a.svelte"]);
      expect(result.files["a.svelte"]).toBe(hostedComponent.replace('"Close"', '"Label"').replace("'Item'", "'Label'"));
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );
});

describe.concurrent("hosted component reports and services", () => {
  test.each(["SvelteMustacheTag", "SvelteMustacheTag:exit", 'SvelteMustacheTag[kind="raw"]', "Program"])(
    "merges %s with a native rule in listener order",
    async key => {
      const files = {
        ...svelteParser,
        ...sveltePlugin,
        "a.svelte": "{@html html}",
        "eslint.config.mjs": `
          import parser from "svelte-eslint-parser";
          import svelte from "eslint-plugin-svelte";
          const seen = { create: ({ report }) => ({
            [${JSON.stringify(key)}](node) { report({ node, message: "Hosted." }); },
          }) };
          export default [{ files: ["**/*.svelte"], languageOptions: { parser }, plugins: { svelte, local: { rules: { seen } } },
            rules: { "local/seen": "error", "svelte/no-at-html-tags": "error" } }];`,
      };
      const result = await lint(files, ["-f", "json"]);
      const native = "a.svelte: 1:1 svelte/no-at-html-tags `{@html}` can lead to XSS attack.";
      const hosted = "a.svelte: 1:1 local/seen Hosted.";
      expect(summary(result.raw)).toBe((key.endsWith(":exit") ? [native, hosted] : [hosted, native]).join("\n"));
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  test.each(["", "\ufeff"])(
    "keeps UTF-16 ranges and fixes in the component, with BOM %j",
    async bom => {
      const files = hosted({ "local/label": "error" });
      files["a.svelte"] = bom + '<script lang="ts">let label = "🔥";</script><button aria-label="🔥Close" />';
      files["eslint.config.mjs"] = files["eslint.config.mjs"].replace(
        "> SvelteLiteral'",
        "> SvelteLiteral[range.0=64][loc.start.column=64]'",
      );
      const result = await lint(files, ["-f", "json"]);
      expect(summary(result.raw)).toBe(
        'a.svelte: 1:65 local/label SvelteElement button 🔥Close 1:64 [fix 64,71 "Label"] [1 suggestion]',
      );
      const fixed = await lint(files, ["--fix"], ["a.svelte"]);
      expect(fixed.files["a.svelte"]).toBe(files["a.svelte"].replace("🔥Close", "Label"));
      expect(result.exitCode).toBe(1);
      expect(fixed.exitCode).toBe(0);
    },
    timeout,
  );

  test.each(["", ' lang="ts"'])(
    "identifies a component without a template visitor service, script%s",
    async lang => {
      const files = {
        ...svelteParser,
        "a.svelte": `<script${lang}>let p = Promise.resolve(1);</script>{#await p then value}{value}{/await}`,
        "eslint.config.mjs": `
          import parser from "svelte-eslint-parser";
          const inspect = { create({ sourceCode, report }) {
            return { SvelteAwaitThenBlock(node) {
              const { isSvelte, isSvelteScript, defineTemplateBodyVisitor } = sourceCode.parserServices;
              report({ node: node.value, message: JSON.stringify([
                isSvelte, isSvelteScript, typeof defineTemplateBodyVisitor,
                "typeAnnotation" in node.value,
                sourceCode.getNodeByRangeIndex(node.value.range[0]) === node.value,
              ]) });
            } };
          } };
          export default [{ files: ["**/*.svelte"], languageOptions: { parser }, plugins: { local: { rules: { inspect } } },
            rules: { "local/inspect": "error" } }];`,
      };
      const result = await lint(files, ["-f", "json"]);
      expect(JSON.parse(result.raw)[0].messages.map((it: { message: string }) => it.message)).toEqual([
        '[true,false,"undefined",false,true]',
      ]);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );
});

describe.concurrent("hosted component contracts", () => {
  function fixture(text: string, rule: string, { typed = false, config = "" } = {}) {
    return {
      ...svelteParser,
      ...typescriptParser,
      "a.svelte": text,
      "eslint.config.mjs": `
        import parser from "svelte-eslint-parser";
        import typescript from "@typescript-eslint/parser";
        const probe = { ${rule} };
        export default [
          { files: ["**/*.svelte"], languageOptions: { parser, parserOptions: ${typed ? "{ parser: typescript }" : "{}"} } },
          { files: ["**/*.svelte", "**/*.js"], plugins: { own: { rules: { probe } } },
            rules: { "own/probe": "error" }, ${config} },
        ];`,
    };
  }

  test(
    "parser errors prevent rule creation",
    async () => {
      const result = await lint(
        fixture("<script>const = 1;</script><p />", 'create() { throw new Error("RULE_EXECUTED_ON_INVALID_INPUT"); }'),
        ["-f", "json", "a.svelte"],
      );
      expect(summary(result.raw)).toBe("a.svelte: 1:15 null Parsing error: Unexpected token = [fatal]");
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  test.each([
    { args: ["--quiet"], unused: true },
    { args: [], unused: false },
    { args: ["--quiet", "--max-warnings", "0"], unused: false },
  ])(
    "filters warning rules before markVariableAsUsed with $args",
    async ({ args, unused }) => {
      const result = await lint(
        fixture(
          "<script>const x = 1;</script><p />",
          'create({ sourceCode }) { return { Program() { sourceCode.markVariableAsUsed("x"); } }; }',
          { config: 'rules: { "own/probe": "warn", "no-unused-vars": "error" }' },
        ),
        ["-f", "json", ...args, "a.svelte"],
      );
      expect(summary(result.raw)).toBe(
        unused ? "a.svelte: 1:15 no-unused-vars 'x' is assigned a value but never used." : "",
      );
      expect(result.exitCode).toBe(unused ? 1 : 0);
    },
    timeout,
  );

  test.each(["config", "cli", "enabled"])(
    "applies inline-global policy before projecting scopes: %s",
    async policy => {
      const result = await lint(
        fixture(
          "<script>/* global ghost */ ghost;</script><p />",
          `create({ sourceCode, report }) { return { "Program:exit"(node) {
            report({ node, message: "ghost=" + sourceCode.scopeManager.globalScope.set.has("ghost") });
          } }; }`,
          {
            config: `rules: { "own/probe": "error", "no-undef": "error" }, linterOptions: { noInlineConfig: ${policy === "config"} }`,
          },
        ),
        ["-f", "json", ...(policy === "cli" ? ["--no-inline-config"] : []), "a.svelte"],
      );
      const expected = [`a.svelte: 1:1 own/probe ghost=${policy === "enabled"}`];
      if (policy === "config") {
        expected.push(
          "a.svelte: 1:9 null '/* global ghost */' has no effect because you have 'noInlineConfig' setting in your config.",
        );
      }
      if (policy !== "enabled") expected.push("a.svelte: 1:28 no-undef 'ghost' is not defined.");
      expect(summary(result.raw)).toBe(expected.join("\n"));
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  // ESLint checks what `create` returned and reads the listeners outside of its per-rule error reporting, so it names
  // no rule. The expected output is what ESLint 10.11.0 says.
  test.each([
    ["whose keys throw", `new Proxy({}, { ownKeys() { throw new Error("keys failure"); } })`, "keys failure"],
    [
      "whose descriptors throw",
      `new Proxy({ Program() {} }, { getOwnPropertyDescriptor() { throw new Error("descriptor failure"); } })`,
      "descriptor failure",
    ],
    [
      "whose listener throws as it is read",
      `{ get Program() { throw new Error("getter failure"); } }`,
      "getter failure",
    ],
    ["that are none", "null", "The create() function for rule 'own/probe' did not return an object."],
  ])(
    "a rule in the host with listeners %s fails without naming the rule",
    async (_, listeners, said) => {
      const result = await lint(fixture("<p />", `create() { return ${listeners}; }`), ["-f", "json", "a.svelte"]);
      expect(result.stderr).toBe(`error: ${said}\nOccurred while linting <dir>/a.svelte`);
      expect(result.exitCode).toBe(2);
    },
    timeout,
  );

  test.each([false, true])(
    "an executed rule with no reports leaves its disable unused, fix=%s",
    async fix => {
      const result = await lint(
        fixture("<script>/* eslint-disable own/probe */ let x = 1;</script><p />", "create() { return {}; }"),
        ["-f", "json", ...(fix ? ["--fix-dry-run"] : []), "a.svelte"],
      );
      expect(summary(result.raw)).toBe(
        fix
          ? ""
          : "a.svelte: 1:9 null Unused eslint-disable directive (no problems were reported from 'own/probe'). [fix 8,38 \" \"]",
      );
      expect(JSON.parse(result.raw)[0].output).toBe(fix ? "<script>  let x = 1;</script><p />" : undefined);
      expect(result.exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "preserves style text while decoding markup and attribute entities",
    async () => {
      const result = await lint(
        fixture(
          '<style>.x::after { content: "&amp;" }</style><p title="&amp;">&amp;</p>',
          `create({ report }) { return {
            "SvelteText, SvelteLiteral"(node) { report({ node, message: JSON.stringify(node.value) }); },
          }; }`,
        ),
        ["-f", "json", "a.svelte"],
      );
      expect(JSON.parse(result.raw)[0].messages.map((it: { message: string }) => JSON.parse(it.message))).toEqual([
        '.x::after { content: "&amp;" }',
        "&",
        "&",
      ]);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  test.each([false, true])(
    "projects escaped identifier token values without changing ranges, typed=%s",
    async typed => {
      const text = `<script${typed ? ' lang="ts"' : ""}>const \\u0061 = 1;</script>{a}`;
      const start = text.indexOf("\\u0061");
      const result = await lint(
        fixture(
          text,
          `create({ sourceCode, report }) { return { Program(node) {
          report({ node, message: JSON.stringify(sourceCode.getTokens(node)
            .filter(token => token.type === "Identifier").map(token => [token.value, token.range, sourceCode.getText(token)])) });
        } }; }`,
          { typed },
        ),
        ["-f", "json", "a.svelte"],
      );
      expect(JSON.parse(JSON.parse(result.raw)[0].messages[0].message)).toEqual([
        [typed ? "\\u0061" : "a", [start, start + 6], "\\u0061"],
        ["a", [text.length - 2, text.length - 1], "a"],
      ]);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  test.each([false, true])(
    "retains definition metadata and node identity, typed=%s",
    async typed => {
      const result = await lint(
        fixture(
          `<script${typed ? ' lang="ts"' : ""}>const a=1,b=2; function f(...args${typed ? ": number[]" : ""}) { return args; }</script>{a}{b}`,
          `create({ sourceCode, report }) { return { Program(node) {
            const [declaration, fn] = node.body[0].body;
            report({ node, message: JSON.stringify(sourceCode.scopeManager.scopes.flatMap(scope => scope.variables)
              .filter(variable => ["a", "b", "args"].includes(variable.name)).map(variable => [variable.name,
                ...variable.defs.map(def => ({ kind: def.kind, index: def.index, rest: def.rest,
                  identity: variable.name === "args" ? def.node === fn && def.name === fn.params[0].argument
                    : def.parent === declaration && declaration.declarations.includes(def.node) && def.name === def.node.id,
                })),
              ])) });
          } }; }`,
          { typed },
        ),
        ["-f", "json", "a.svelte"],
      );
      expect(JSON.parse(JSON.parse(result.raw)[0].messages[0].message)).toEqual(
        typed
          ? [
              ["a", { identity: true }],
              ["b", { identity: true }],
              ["args", { rest: true, identity: true }],
            ]
          : [
              ["a", { kind: "const", index: 0, identity: true }],
              ["b", { kind: "const", index: 1, identity: true }],
              ["args", { kind: null, index: 0, rest: true, identity: true }],
            ],
      );
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  test.each([
    { code: "class C {}", outer: true },
    { code: "const value = class C {};", outer: false },
  ])(
    "preserves inner class definition fields for $code",
    async ({ code, outer }) => {
      const files = {
        ...fixture(
          `<script>${code}</script>`,
          `create({ sourceCode, report }) { return { Program(node) {
            const fields = sourceCode.scopeManager.scopes.flatMap(scope => scope.variables
              .filter(variable => variable.name === "C").flatMap(variable => variable.defs.map(def => [
                scope.type, ...["parent", "kind", "index"].map(key => def[key] === undefined ? "undefined" : def[key]),
              ])));
            report({ node, message: JSON.stringify(fields) });
          } }; }`,
        ),
        "b.js": code,
      };
      const result = await lint(files, ["-f", "json", "a.svelte", "b.js"]);
      const expected = [
        ...(outer ? [["module", null, null, null]] : []),
        ["class", "undefined", "undefined", "undefined"],
      ];
      expect(
        JSON.parse(result.raw).map((it: { messages: { message: string }[] }) =>
          it.messages.map(message => JSON.parse(message.message)),
        ),
      ).toEqual([[expected], [expected]]);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "configured off preserves parser-injected globals only on components",
    async () => {
      const result = await lint(
        {
          ...fixture(
            "<p />",
            `create({ sourceCode, report }) { return { Program(node) {
            report({ node, message: JSON.stringify(["$$props", "$state", "ghost"].map(name => {
              const variable = sourceCode.scopeManager.globalScope.set.get(name);
              return [name, !!variable, variable && Object.hasOwn(variable, "eslintImplicitGlobalSetting")];
            })) });
          } }; }`,
            { config: 'languageOptions: { globals: { $$props: "off", $state: "off", ghost: "off" } }' },
          ),
          "b.js": "",
        },
        ["-f", "json", "a.svelte", "b.js"],
      );
      expect(
        JSON.parse(result.raw).map((it: { messages: { message: string }[] }) => JSON.parse(it.messages[0].message)),
      ).toEqual([
        [
          ["$$props", true, false],
          ["$state", true, false],
          ["ghost", false, null],
        ],
        [
          ["$$props", false, null],
          ["$state", false, null],
          ["ghost", false, null],
        ],
      ]);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );
});

describe.concurrent("component service refusals", () => {
  function fixture(when: "create" | "Program") {
    return {
      ...svelteParser,
      "node_modules/svelte-eslint-parser/index.js": `
        module.exports = {
          meta: { name: "svelte-eslint-parser", version: "1.9.0" },
          parseForESLint: text => ({
            ast: { lines: text.split("\\n") },
            services: { getStyleContext() {} },
          }),
        };`,
      "eslint.config.mjs": `
        import { appendFileSync } from "node:fs";
        import parser from "svelte-eslint-parser";
        const seen = {
          meta: { fixable: "code" },
          create(context) {
            const filename = context.filename.split(/[\\\\/]/).at(-1);
            const services = () => {
              if (filename.endsWith(".svelte")) context.sourceCode.parserServices.getStyleContext();
            };
            if (${JSON.stringify(when)} === "create") services();
            return {
              Program(node) {
                services();
                appendFileSync("visits.txt", filename + "\\n");
                context.report({ node, message: "Visited." });
              },
              Line({ lines }) {
                services();
                appendFileSync("visits.txt", filename + "\\n");
                const at = lines.join("\\n").indexOf("before");
                context.report({ line: 1, message: "Visited.",
                  ...(at < 0 ? {} : { fix: { range: [at, at + 6], text: "after" } }) });
              },
            };
          },
        };
        export default [
          { files: ["**/*.svelte"], languageOptions: { parser } },
          { files: ["**/*.svelte", "**/*.js", "**/*.ts"], plugins: { local: { rules: { seen } } },
            rules: { "local/seen": "error" } },
        ];`,
      "visits.txt": "",
    };
  }

  // ESLint creates a program for a component it receives if the config asks for one.
  test.each(["create", "Program"] as const)(
    "a component whose rule in %s can be rejected with a typed program is linted",
    async when => {
      const files = fixture(when);
      files["eslint.config.mjs"] = files["eslint.config.mjs"].replace(
        "languageOptions: { parser } }",
        "languageOptions: { parser, parserOptions: { projectService: true } } }",
      );
      const result = await lint({ ...files, "a.svelte": "<p/>" }, ["-f", "json", "a.svelte"]);
      expect(summary(result.raw)).toBe("a.svelte: 1:1 local/seen Visited.");
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  // If the config creates programs, ESLint creates one for each component it receives, on the lanes only. Each time the
  // parser is asked for a program, it records the engine.
  test.each(["create", "Program"] as const)(
    "components whose rule in %s can be rejected are linted on the typed lanes",
    async when => {
      const files: Record<string, string> = fixture(when);
      files["eslint.config.mjs"] = files["eslint.config.mjs"].replace(
        "languageOptions: { parser } }",
        "languageOptions: { parser, parserOptions: { projectService: true } } }",
      );
      files["node_modules/svelte-eslint-parser/index.js"] = `
        const { appendFileSync } = require("node:fs");
        const realm = Math.random();
        module.exports = {
          meta: { name: "svelte-eslint-parser", version: "1.9.0" },
          parseForESLint(text, options) {
            if (options?.projectService) appendFileSync("programs.txt", realm + "\\n");
            return { ast: { lines: text.split("\\n") }, services: { getStyleContext() {} } };
          },
        };`;
      files["programs.txt"] = "";
      // Large enough to be worth more than one engine.
      const names = Array.from({ length: 32 }, (_, i) => `${i}.svelte`);
      for (const name of names) files[name] = `<p/><!--${Buffer.alloc(200_000, "x")}-->\n`;
      const result = await lint(files, ["-f", "json", "--threads", "4", ...names], ["programs.txt"], lanes(2));
      const programs = result.files["programs.txt"].split("\n").filter(Boolean);
      expect(programs.length).toBe(32);
      expect(new Set(programs).size).toBeLessThanOrEqual(2);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  test.each(["create", "Program"] as const)(
    "a rejection in %s preserves the rule on later JS, TS and component files",
    async when => {
      // Heavy files (>262144 bytes) share one keeper, largest first, without needing a large AST.
      const files = {
        ...fixture(when),
        "a.svelte": `<p/><!--${Buffer.alloc(400000, "x")}-->`,
        "b.js": `const b = 1; /*${Buffer.alloc(350000, "x")}*/`,
        "c.ts": `const c: number = 1; /*${Buffer.alloc(300000, "x")}*/`,
        "d.svelte": `<p/><!--${Buffer.alloc(280000, "x")}-->`,
      };
      const result = await lint(files, ["-f", "json", "a.svelte", "b.js", "c.ts", "d.svelte"], ["visits.txt"]);
      expect(summary(result.raw)).toMatchInlineSnapshot(`
        "a.svelte: 1:1 local/seen Visited.
        b.js: 1:1 local/seen Visited.
        c.ts: 1:1 local/seen Visited.
        d.svelte: 1:1 local/seen Visited."
      `);
      expect(result.files["visits.txt"]).toBe("a.svelte\nb.js\nc.ts\nd.svelte\n");
      expect(result.stderr).toBe("Linted 4 files");
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  // If a rule asks for services, ESLint runs it and every other plugin rule, only on the components where it asks, in
  // whatever order and on whatever thread the components are linted. Each rule records where it ran: its `Program`
  // listener runs in the host, `Line` in ESLint.
  test(
    "a rule rejected on a component makes ESLint run plugin rules on that component alone",
    async () => {
      const files = {
        ...fixture("create"),
        "eslint.config.mjs": `
          import parser from "svelte-eslint-parser";
          const rule = (name, asks) => ({ create(context) {
            if (asks(context.filename.split(/[\\\\/]/).at(-1))) context.sourceCode.parserServices.getStyleContext();
            return {
              Program(node) { context.report({ node, message: name + " in host" }); },
              Line() { context.report({ line: 1, message: name + " in eslint" }); },
            };
          } });
          const rules = { seen: rule("seen", it => it !== "b.svelte"), plain: rule("plain", () => false) };
          export default [
            { files: ["**/*.svelte"], languageOptions: { parser } },
            { files: ["**/*.svelte"], plugins: { local: { rules } }, rules: { "local/seen": "error", "local/plain": "error" } },
          ];`,
        "a.svelte": "<p/>",
        "b.svelte": "<p/>",
        "c.svelte": "<p/>",
      };
      const byFile = (raw: string) => Object.groupBy(summary(raw).split("\n"), it => it.split(":")[0]);
      const runs = await Promise.all([
        lint(files, ["-f", "json", "--threads", "1", "a.svelte", "b.svelte", "c.svelte"]),
        lint(files, ["-f", "json", "--threads", "1", "c.svelte", "b.svelte", "a.svelte"]),
        lint(files, ["-f", "json", "--threads", "4", "a.svelte", "b.svelte", "c.svelte"]),
        lint(files, ["-f", "json", "--threads", "4", "a.svelte", "b.svelte", "c.svelte"]),
      ]);
      for (const result of runs) {
        expect(byFile(result.raw)).toEqual({
          "a.svelte": ["a.svelte: 1:1 local/seen seen in eslint", "a.svelte: 1:1 local/plain plain in eslint"],
          "b.svelte": ["b.svelte: 1:1 local/seen seen in host", "b.svelte: 1:1 local/plain plain in host"],
          "c.svelte": ["c.svelte: 1:1 local/seen seen in eslint", "c.svelte: 1:1 local/plain plain in eslint"],
        });
        expect(result.exitCode).toBe(1);
      }
    },
    timeout,
  );

  // A processor from a plugin other than eslint-plugin-svelte has ESLint lint the component with all its rules, so
  // `local/seen` gets the services it asks for, and the processor gets both rules' reports.
  test(
    "a rule that asks for services on a component a processor receives runs in ESLint, under the processor",
    async () => {
      const files = {
        ...fixture("create"),
        ...sveltePackage(
          `{ late: { create: ({ report }) => ({ Line: () => report({ line: 1, message: "late in eslint" }) }) } }`,
        ),
        "eslint.config.mjs": `
          import parser from "svelte-eslint-parser";
          import sv from "eslint-plugin-svelte";
          const seen = { create(context) {
            context.sourceCode.parserServices.getStyleContext();
            return {
              Program(node) { context.report({ node, message: "seen in host" }); },
              Line() { context.report({ line: 1, message: "seen in eslint" }); },
            };
          } };
          const processor = {
            preprocess: text => [text],
            postprocess: ([messages]) => messages.map(it => ({ ...it, message: "processed: " + it.message })),
          };
          export default [
            { files: ["**/*.svelte"], languageOptions: { parser } },
            { files: ["**/*.svelte"], plugins: { svelte: { processors: { svelte: processor } }, sv, local: { rules: { seen } } },
              processor: "svelte/svelte", rules: { "local/seen": "error", "sv/late": "error" } },
          ];`,
        "a.svelte": "<p/>",
      };
      const result = await lint(files, ["-f", "json", "a.svelte"]);
      expect(summary(result.raw)).toBe(
        "a.svelte: 1:1 local/seen processed: seen in eslint\na.svelte: 1:1 sv/late processed: late in eslint",
      );
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  // A processor from a plugin other than eslint-plugin-svelte has ESLint lint the component with all its rules. Each
  // runs once, and so does the processor, for each time a fix has the component linted again. The expected output is
  // what ESLint 10.11.0 does with the same rules and processor.
  test.each([false, true])(
    "a rule that asks for services alongside one that only ESLint runs runs once, under the processor (--fix: %p)",
    async fix => {
      const files = {
        ...fixture("create"),
        ...sveltePackage(`(() => {
          const { appendFileSync } = require("node:fs");
          const note = it => appendFileSync("events.txt", it + "\\n");
          const late = { meta: { fixable: "code" }, create(context) {
            note("create late");
            return { Program(node) {
              note("listen late");
              const at = context.sourceCode.text.indexOf("before");
              context.report({ node, message: "Late.", ...(at < 0 ? {} : { fix: f => f.replaceTextRange([at, at + 6], "after") }) });
            } };
          } };
          return { late };
        })()`),
        ...eslintTen(true),
        "eslint.config.mjs": `
          import { appendFileSync } from "node:fs";
          import parser from "svelte-eslint-parser";
          import sv from "eslint-plugin-svelte";
          const note = it => appendFileSync("events.txt", it + "\\n");
          const seen = { create(context) {
            note("create seen");
            context.sourceCode.parserServices.getStyleContext();
            return { Program(node) { note("listen seen"); context.report({ node, message: "Seen." }); } };
          } };
          const processor = {
            supportsAutofix: true,
            preprocess: text => (note("preprocess"), [text]),
            postprocess: ([messages]) => (note("postprocess"), messages),
          };
          export default [
            { files: ["**/*.svelte"], languageOptions: { parser } },
            { files: ["**/*.svelte"], plugins: { svelte: { processors: { svelte: processor } }, sv, local: { rules: { seen } } },
              processor: "svelte/svelte", rules: { "local/seen": "error", "sv/late": "error" } },
          ];`,
        "a.svelte": "<p>before</p>\n",
        "events.txt": "",
      };
      const result = await lint(
        files,
        ["-f", "json", ...(fix ? ["--fix"] : []), "a.svelte"],
        ["events.txt", "a.svelte"],
      );
      const once = "preprocess\ncreate seen\ncreate late\nlisten seen\nlisten late\npostprocess\n";
      expect(result.files["events.txt"]).toBe(fix ? once + once : once);
      expect(result.files["a.svelte"]).toBe(fix ? "<p>after</p>\n" : "<p>before</p>\n");
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  // A processor from a plugin other than eslint-plugin-svelte has ESLint lint the component with all its rules, also
  // `sv/no-at-html-tags`, which would otherwise run natively, here a stand-in that reports where the real one does. The
  // processor gets the component once, and once more for each time a fix has it linted again. The expected output is
  // what ESLint 10.11.0 does with the same rules and processor.
  test.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ])(
    "a processor of another plugin gets a component once per pass (asks for services: %p, --fix: %p)",
    async (asks, fix) => {
      const files = {
        ...svelteParser,
        ...sveltePackage(`{ "no-at-html-tags": { create: ({ sourceCode, report }) => ({ Program() {
          const column = sourceCode.text.indexOf("{@html");
          report({ node: { loc: { start: { line: 1, column } } }, message: "\`{@html}\` can lead to XSS attack." });
        } }) } }`),
        ...eslintTen(true),
        "eslint.config.mjs": `
          import { appendFileSync } from "node:fs";
          import parser from "svelte-eslint-parser";
          import sv from "eslint-plugin-svelte";
          const note = it => appendFileSync("events.txt", it + "\\n");
          const plain = { meta: { fixable: "code" }, create(context) {
            ${asks ? "context.sourceCode.parserServices.getStyleContext();" : ""}
            return { Program(node) {
              const at = context.sourceCode.text.indexOf("before");
              context.report({ node, message: "Plain.", ...(at < 0 ? {} : { fix: f => f.replaceTextRange([at, at + 6], "after") }) });
            } };
          } };
          const processor = {
            supportsAutofix: true,
            preprocess: text => (note("preprocess"), [text]),
            postprocess: ([messages]) => (note("postprocess"), messages.map(it => ({ ...it, message: "processed: " + it.message }))),
          };
          export default [{ files: ["**/*.svelte"], languageOptions: { parser },
            plugins: { svelte: { processors: { svelte: processor } }, sv, local: { rules: { plain } } },
            processor: "svelte/svelte", rules: { "local/plain": "error", "sv/no-at-html-tags": "error" } }];`,
        "a.svelte": "<p>before</p>{@html x}\n",
        "events.txt": "",
      };
      const result = await lint(
        files,
        ["-f", "json", ...(fix ? ["--fix"] : []), "a.svelte"],
        ["events.txt", "a.svelte"],
      );
      expect(summary(result.raw)).toBe(
        [
          `a.svelte: 1:1 local/plain processed: Plain.${fix ? "" : ' [fix 3,9 "after"]'}`,
          `a.svelte: 1:${fix ? 13 : 14} sv/no-at-html-tags processed: \`{@html}\` can lead to XSS attack.`,
        ].join("\n"),
      );
      expect(result.files["events.txt"]).toBe(
        fix ? "preprocess\npostprocess\npreprocess\npostprocess\n" : "preprocess\npostprocess\n",
      );
      expect(result.files["a.svelte"]).toBe(fix ? "<p>after</p>{@html x}\n" : "<p>before</p>{@html x}\n");
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  // A block that a processor from a plugin other than eslint-plugin-svelte returns with a name is linted as the file
  // `a.svelte/block.js`, with the config for that path, which turns on `no-unused-vars`. The expected output is what
  // ESLint 10.11.0 does with the same config.
  test(
    "a processor of another plugin has a named block linted with the block's config",
    async () => {
      const files = {
        ...svelteParser,
        "eslint.config.mjs": `
          import parser from "svelte-eslint-parser";
          const processor = {
            preprocess: () => [{ text: "const x = 1;", filename: "block.js" }],
            postprocess: lists => lists.flat().map(it => ({ ...it, message: "processed: " + it.message })),
          };
          export default [
            { files: ["**/*.svelte"], languageOptions: { parser }, plugins: { svelte: { processors: { svelte: processor } } },
              processor: "svelte/svelte", rules: { "no-undef": "error" } },
            { files: ["**/*.svelte/*.js"], rules: { "no-unused-vars": "error" } },
          ];`,
        "a.svelte": "<p>hello</p>\n",
      };
      const result = await lint(files, ["-f", "json", "a.svelte"]);
      expect(summary(result.raw)).toBe(
        "a.svelte: 1:7 no-unused-vars processed: 'x' is assigned a value but never used.",
      );
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  // A processor from a plugin other than eslint-plugin-svelte has ESLint lint the component, so `import/no-cycle` and
  // `import/named`, rules about modules, here stand-ins that report what eslint-plugin-import 2.32.0 does, report the
  // cycle through b.js and the missing export there, and the processor gets both reports. The expected output is what
  // ESLint 10.11.0 does with eslint-plugin-import.
  test(
    "a processor of another plugin gets the reports of the rules about modules",
    async () => {
      const files = {
        ...svelteParser,
        ...eslintTen(true),
        "eslint.config.mjs": `
          import parser from "svelte-eslint-parser";
          const at = (line, column, message) => ({ create: ({ report }) => ({ Program() {
            report({ node: { loc: { start: { line, column } } }, message });
          } }) });
          const rules = { "no-cycle": at(2, 2, "Dependency cycle detected."), named: at(2, 14, "missing not found in './b.js'") };
          const processor = {
            preprocess: text => [text],
            postprocess: ([messages]) => messages.map(it => ({ ...it, message: "processed: " + it.message })),
          };
          export default [{ files: ["**/*.svelte"], languageOptions: { parser },
            plugins: { svelte: { processors: { svelte: processor } }, import: { meta: { name: "eslint-plugin-import" }, rules } },
            processor: "svelte/svelte",
            settings: { "import/parsers": { espree: [".js"] } },
            rules: { "import/no-cycle": "error", "import/named": "error" } }];`,
        "a.svelte": '<script>\n  import { b, missing } from "./b.js";\n</script>\n{b}{missing}\n',
        "b.js": 'import A from "./a.svelte";\nexport const b = A;\n',
      };
      const result = await lint(files, ["-f", "json", "a.svelte"]);
      expect(summary(result.raw)).toBe(
        [
          "a.svelte: 2:3 import/no-cycle processed: Dependency cycle detected.",
          "a.svelte: 2:15 import/named processed: missing not found in './b.js'",
        ].join("\n"),
      );
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  // ESLint creates every rule for a component before it calls a listener. `svelte/resid` only ESLint runs, so it runs
  // `local/hosted` too, and in either order no listener runs before both are created. The expected output is what
  // ESLint 10.11.0 does with the same rules.
  test.each([
    [["svelte/resid", "local/hosted"], "create resid\ncreate hosted\nlisten resid\nlisten hosted\n"],
    [["local/hosted", "svelte/resid"], "create hosted\ncreate resid\nlisten hosted\nlisten resid\n"],
  ])(
    "of the rules %j, one that only ESLint runs and one of another plugin, both are made before a listener runs",
    async (order, events) => {
      const rule = `name => ({ create() {
        appendFileSync("events.txt", "create " + name + "\\n");
        return { Program() { appendFileSync("events.txt", "listen " + name + "\\n"); } };
      } })`;
      const files = {
        ...svelteParser,
        ...sveltePackage(`(() => {
          const { appendFileSync } = require("node:fs");
          return { resid: (${rule})("resid") };
        })()`),
        ...eslintTen(true),
        "a.svelte": "<p></p>\n",
        "events.txt": "",
        "eslint.config.mjs": `
          import { appendFileSync } from "node:fs";
          import parser from "svelte-eslint-parser";
          import svelte from "eslint-plugin-svelte";
          const rule = ${rule};
          export default [{ files: ["**/*.svelte"], languageOptions: { parser },
            plugins: { svelte, local: { rules: { hosted: rule("hosted") } } },
            rules: ${JSON.stringify(Object.fromEntries(order.map(it => [it, "error"])))} }];`,
      };
      const result = await lint(files, ["-f", "json", "a.svelte"], ["events.txt"]);
      expect(result.files["events.txt"]).toBe(events);
      expect(result.exitCode).toBe(0);
    },
    timeout,
  );

  // ESLint creates `local/early` before `local/needs`, so on b.svelte it fails with the first one's error. That
  // `local/needs` asked for services on a.svelte doesn't change that.
  test(
    "a rule rejected on one component doesn't fail before an earlier rule on the next",
    async () => {
      const files = {
        ...fixture("create"),
        "eslint.config.mjs": `
          import parser from "svelte-eslint-parser";
          const name = context => context.filename.split(/[\\\\/]/).at(-1);
          const early = { create(context) {
            if (name(context) === "b.svelte") throw new Error("EARLY");
            return {};
          } };
          const needs = { create(context) {
            if (name(context) === "b.svelte") throw new Error("LATE");
            context.sourceCode.parserServices.getStyleContext();
            return {};
          } };
          export default [
            { files: ["**/*.svelte"], languageOptions: { parser } },
            { files: ["**/*.svelte"], plugins: { local: { rules: { early, needs } } },
              rules: { "local/early": "error", "local/needs": "error" } },
          ];`,
        "a.svelte": "<p/>",
        "b.svelte": "<p/>",
      };
      const result = await lint(files, ["-f", "json", "--threads", "1", "a.svelte", "b.svelte"]);
      expect(result.stderr).toContain(
        "Error while loading rule 'local/early': EARLY\nOccurred while linting <dir>/b.svelte",
      );
      expect(result.stderr).not.toContain("LATE");
      expect(result.exitCode).toBe(2);
    },
    timeout,
  );

  test(
    "fallback keeps running through component fix passes",
    async () => {
      const result = await lint(
        { ...fixture("create"), "a.svelte": "<p>before</p>" },
        ["--fix", "-f", "json", "a.svelte"],
        ["a.svelte"],
      );
      expect(result.files["a.svelte"]).toBe("<p>after</p>");
      expect(summary(result.raw)).toBe("a.svelte: 1:1 local/seen Visited.");
      expect(result.stderr).toBe("Fixed 1 problem in 1 file\nLinted 1 file");
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "an ordinary type refusal still disables the rule only on ordinary files",
    async () => {
      const files = fixture("create");
      files["eslint.config.mjs"] = files["eslint.config.mjs"].replace(
        'if (filename.endsWith(".svelte"))',
        `if (!filename.endsWith(".svelte")) {
          appendFileSync("visits.txt", "unsupported " + filename + "\\n");
          throw new Error("You have used a rule which requires type information.");
        }
        if (filename.endsWith(".svelte"))`,
      );
      const result = await lint(
        {
          ...files,
          "a.js": `const a = 1; /*${Buffer.alloc(400000, "x")}*/`,
          "b.svelte": `<p/><!--${Buffer.alloc(350000, "x")}-->`,
          "c.ts": `const c: number = 1; /*${Buffer.alloc(300000, "x")}*/`,
        },
        ["-f", "json", "a.js", "b.svelte", "c.ts"],
        ["visits.txt"],
      );
      expect(summary(result.raw)).toBe("b.svelte: 1:1 local/seen Visited.");
      expect(result.files["visits.txt"]).toBe("unsupported a.js\nb.svelte\n");
      expect(result.stderr).toContain(
        "1 rule did not run because rules that run in JavaScript cannot use type information: local/seen",
      );
      expect(result.exitCode).toBe(2);
    },
    timeout,
  );
});

test.concurrent(
  "component selectors read code coordinates and directive modifiers",
  async () => {
    const files = {
      ...svelteParser,
      "a.svelte":
        "<script>const fn = () => 1;</script><button on:click|once={fn}/><button on:click|once|capture={fn} on:focus={fn}/>",
      "eslint.config.mjs": `
      import parser from "svelte-eslint-parser";
      // An array is compared as \`String(array)\`: its elements joined by commas.
      const compared = ['="once"', '="once,capture"', '=""', '="[object Object]"', '!="once"'];
      const seen = { create: ({ sourceCode, report }) => ({
        'Identifier[name="fn"][range.0=14][loc.start.column=14]'(node) {
          report({ node, message: sourceCode.getText(node) });
        },
        'SvelteDirective[key.modifiers.length=1][key.modifiers.0="once"]'(node) {
          report({ node, message: node.key.modifiers.join(",") });
        },
        ...Object.fromEntries(compared.map(it => [\`SvelteDirective[key.modifiers\${it}]\`, node => {
          report({ node, message: \`\${it} \${node.key.modifiers.join(",")}\` });
        }])),
      }) };
      export default [{ files: ["**/*.svelte"], languageOptions: { parser }, plugins: { local: { rules: { seen } } },
        rules: { "local/seen": "error" } }];`,
    };
    const result = await lint(files, ["-f", "json"]);
    expect(
      JSON.parse(result.raw)[0]
        .messages.map((it: { message: string }) => it.message)
        .sort(),
    ).toEqual([
      '!="once" ',
      '!="once" once,capture',
      '="" ',
      '="once" once',
      '="once,capture" once,capture',
      "fn",
      "once",
    ]);
    expect(result.exitCode).toBe(1);
  },
  timeout,
);

// Recorded with ESLint 10.11.0 and svelte-eslint-parser 1.9.0: the `let:` patterns, which the program only has a copy
// of, have the tokens of all of JavaScript.
test.concurrent(
  "the tokens of a let: pattern in a component",
  async () => {
    const files = {
      ...svelteParser,
      "a.svelte":
        '<script>import C from "./C.svelte";</script>\n<C let:other={[b = .5, c = /x/g, d = `t${1}u`, e = typeof b >>> 1]} let:item={\\u0061}>{a}{b}{c}{d}{e}</C>\n',
      "eslint.config.mjs": `
      import parser from "svelte-eslint-parser";
      const tokens = { create: context => ({ SvelteDirective(node) {
        if (node.kind === "Let")
          context.report({ node, message: context.sourceCode.getTokens(node).map(t => \`\${t.type}:\${t.value}\`).join(" ") });
      } }) };
      export default [{ files: ["**/*.svelte"], languageOptions: { parser }, plugins: { local: { rules: { tokens } } },
        rules: { "local/tokens": "error" } }];`,
    };
    const result = await lint(files, ["-f", "json"]);
    expect(
      JSON.parse(result.raw)[0].messages.map((it: Record<string, string>) => `${it.line}:${it.column} ${it.message}`),
    ).toMatchInlineSnapshot(`
      [
        "2:4 HTMLIdentifier:let Punctuator:: HTMLIdentifier:other Punctuator:= Punctuator:{ Punctuator:[ Identifier:b Punctuator:= Numeric:.5 Punctuator:, Identifier:c Punctuator:= RegularExpression:/x/g Punctuator:, Identifier:d Punctuator:= Template:\`t\${ Numeric:1 Template:}u\` Punctuator:, Identifier:e Punctuator:= Keyword:typeof Identifier:b Punctuator:>>> Numeric:1 Punctuator:] Punctuator:}",
        "2:69 HTMLIdentifier:let Punctuator:: HTMLIdentifier:item Punctuator:= Punctuator:{ Identifier:a Punctuator:}",
      ]
    `);
    expect(result.exitCode).toBe(1);
  },
  timeout,
);

// Recorded with ESLint 10.11.0 and svelte-eslint-parser 1.9.0. The two files have the same final global settings but different
// insertion orders, so sharing a normalized lookup table must not make their observable scope order the same.
describe.concurrent("configured globals retain property order", () => {
  test.each([
    { extension: "js", typed: false, component: false },
    { extension: "ts", typed: true, component: false },
    { extension: "svelte", typed: false, component: true },
    { extension: "svelte", typed: true, component: true },
  ])(
    "$extension typed=$typed",
    async ({ extension, typed, component: isComponent }) => {
      const code = "zeta; alpha; later; beta;";
      const text = isComponent ? `<script${typed ? ' lang="ts"' : ""}>${code}</script>` : code;
      const parser = isComponent ? "svelte" : typed ? "typescript" : "undefined";
      const files = {
        ...svelteParser,
        ...typescriptParser,
        [`a.${extension}`]: text,
        [`b.${extension}`]: text,
        "eslint.config.mjs": `
        import svelte from "svelte-eslint-parser";
        import typescript from "@typescript-eslint/parser";
        const first = { zeta: "readonly", alpha: "writable", later: "off", 10: "readonly", erase: "readonly", Array: "writable" };
        const reverse = { alpha: "writable", zeta: "readonly", later: "off", 10: "readonly", erase: "readonly", Array: "writable" };
        const next = { beta: "readonly", alpha: "readonly", later: "writable", erase: "off", 2: "writable", Array: "readonly" };
        const wanted = new Set([...Object.keys(first), ...Object.keys(next)]);
        const order = { create(context) { return { "Program:exit"(node) {
          const scope = context.sourceCode.scopeManager.globalScope;
          const variables = scope.variables.filter(it => wanted.has(it.name));
          const references = context.sourceCode.scopeManager.scopes.flatMap(it => it.references).filter(it => wanted.has(it.identifier.name));
          context.report({ node, message: JSON.stringify({
            configured: Object.keys(context.languageOptions.globals),
            variables: variables.map(it => [it.name, it.writeable, it.eslintImplicitGlobalSetting]),
            set: [...scope.set.keys()].filter(it => wanted.has(it)),
            identity: variables.every(it => scope.set.get(it.name) === it) && references.every(it => it.resolved === scope.set.get(it.identifier.name)),
          }) });
        } }; } };
        export default [
          { files: ["**/*.${extension}"], languageOptions: { parser: ${parser}, parserOptions: ${typed ? "{ parser: typescript }" : "{}"} },
            plugins: { own: { rules: { order } } }, rules: { "own/order": "error", "no-undef": "error", "no-global-assign": "error" } },
          { files: ["**/a.*"], languageOptions: { globals: first } },
          { files: ["**/b.*"], languageOptions: { globals: reverse } },
          { languageOptions: { globals: next } },
        ];`,
      };
      // Use one lane so both orders pass through the same configuration cache and plugin realm.
      const result = await lint(files, ["-f", "json", "--threads", "1", `a.${extension}`, `b.${extension}`]);
      const messages: { messages: { ruleId: string; message: string }[] }[] = JSON.parse(result.raw);
      expect(messages.map(it => it.messages.map(it => it.ruleId))).toEqual([["own/order"], ["own/order"]]);
      expect(messages.map(it => JSON.parse(it.messages[0].message))).toEqual(
        [
          ["zeta", "alpha"],
          ["alpha", "zeta"],
        ].map(names => {
          const set = [...(typed ? ["Array", "2", "10"] : ["2", "10", "Array"]), ...names, "later", "beta"];
          return {
            configured: ["2", "10", ...names, "later", "erase", "Array", "beta"],
            variables: set.map(name => [
              name,
              name === "2" || name === "later",
              name === "2" || name === "later" ? "writable" : "readonly",
            ]),
            set,
            identity: true,
          };
        }),
      );
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );
});

describe.concurrent("component globals before rune inference", () => {
  test.each([undefined, false, true])(
    "configured runes %s without rune identifiers",
    async runes => {
      const files = {
        ...svelteParser,
        "a.svelte": "<p />",
        "eslint.config.mjs": `
        import parser from "svelte-eslint-parser";
        const order = { create: ({ sourceCode, report }) => ({ Program(node) {
          report({ node, message: sourceCode.scopeManager.globalScope.variables.filter(it => it.name.startsWith("$")).map(it => it.name).join(",") });
        } }) };
        export default [{ files: ["**/*.svelte"], languageOptions: { parser,
          parserOptions: ${JSON.stringify({ svelteFeatures: { runes } })} },
          plugins: { own: { rules: { order } } }, rules: { "own/order": "error" } }];`,
      };
      const result = await lint(files, ["-f", "json"]);
      expect(JSON.parse(result.raw)[0].messages.map((it: { message: string }) => it.message)).toEqual([
        runes === false
          ? "$$slots,$$props,$$restProps"
          : "$$slots,$$props,$$restProps,$state,$derived,$effect,$props,$bindable,$inspect,$host",
      ]);
      expect(result.exitCode).toBe(1);
    },
    timeout,
  );
});
