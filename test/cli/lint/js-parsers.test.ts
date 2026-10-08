import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, normalizeBunSnapshot, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
  await using proc = Bun.spawn({
    cmd: [bunExe(), "lint", "--threads", "2", ...args],
    env,
    cwd: String(dir),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
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
});
