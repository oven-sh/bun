import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, normalizeBunSnapshot, tempDir } from "harness";
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { endChildren, spawn } from "../children";
import { cases as rowsOfESLint8 } from "./oracle/driver/eslintrc-cli-cases.mjs";
import differencesFromESLint8 from "./oracle/driver/eslintrc-cli.differences.json";
import whatESLint8Does from "./oracle/driver/eslintrc-cli.expected.json";
import { argumentsOf, difference, environment, outcome, write } from "./oracle/driver/eslintrc-cli.mjs";

afterAll(endChildren);

const command = [bunExe(), "lint"];

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
  ESLINT_USE_FLAT_CONFIG: undefined,
};

type Options = { cwd?: string; env?: Record<string, string | undefined>; before?: (dir: string) => void };

/**
 * What is reported, as `file:line:column rule`, what else is printed, and the exit code. The format is one that is the same
 * whosever the configuration is.
 */
async function lint(files: Record<string, string>, args: string[] = ["."], options: Options = {}) {
  using dir = tempDir("bun-lint-config-files", files);
  options.before?.(String(dir));
  await using proc = spawn({
    cmd: [...command, "--threads", "2", "-f", "json-with-metadata", ...args],
    env: { ...env, ...options.env },
    cwd: join(String(dir), options.cwd ?? "."),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // Where a run ends with an error, or dies, the assertion that fails is often about something else.
  if (exitCode !== 0 && exitCode !== 1) console.error(`bun lint ${args.join(" ")}: exit code ${exitCode}\n${stderr}`);
  type Result = { filePath: string; messages: { ruleId: string | null; line?: number; column?: number }[] };
  const results: Result[] = stdout.startsWith('{"results":') ? JSON.parse(stdout).results : [];
  const problems = results.flatMap(({ filePath, messages }) => {
    const file = normalizeBunSnapshot(filePath, String(dir)).replace("<dir>/", "");
    return messages.map(it => `${file}:${it.line ?? 0}:${it.column ?? 0} ${it.ruleId ?? "-"}`);
  });
  return {
    problems: problems.sort(),
    /** As it was printed. */
    raw: stdout,
    stdout: normalizeBunSnapshot(stdout, String(dir)),
    stderr: normalizeBunSnapshot(stderr, String(dir)),
    exitCode,
  };
}

// eqeqeq 2:7, no-debugger 2:13, no-var 1:1
const code = "var x = 1;\nif (x == 2) debugger;\n";
const rc = (config: object) => JSON.stringify({ root: true, ...config });
const eqeqeq = { rules: { eqeqeq: "error" } };
const noVar = { rules: { "no-var": "error" } };
const yaml = (rule: string) => `root: true\nrules:\n  ${rule}: error\n`;

// The parts of @eslint/eslintrc that the functions of its `FlatCompat` are made of, in the shape that they have there.
const eslintrc = `
  const matchers = patterns => [patterns].flat().map(it =>
    it.startsWith("./") ? { pattern: it.slice(2), options: { matchBase: false } } : { pattern: it, options: { matchBase: true } });
  class OverrideTester {
    constructor(patterns, basePath) { Object.assign(this, { patterns, basePath }); }
    test() { return false; }
  }
  class ConfigArray extends Array {
    extractConfig() {
      const patterns = this.flatMap(it => it.ignorePatterns ?? []);
      return { ignores: Object.assign(() => false, { basePath: this.basePath, patterns }) };
    }
  }
  class FlatCompat {
    constructor({ baseDirectory }) { this.baseDirectory = baseDirectory; }
    config(config) {
      const elements = Object.assign(new ConfigArray(), { basePath: this.baseDirectory });
      const add = ({ files, excludedFiles, overrides = [], ...rest }, outer) => {
        const own = files ? [{ includes: matchers(files), excludes: excludedFiles ? matchers(excludedFiles) : null }] : [];
        const patterns = [...outer, ...own];
        elements.push({ ...rest, criteria: patterns.length > 0 ? new OverrideTester(patterns, this.baseDirectory) : null });
        for (const it of overrides) add(it, patterns);
      };
      add(config, []);
      const flat = elements.map(({ criteria, rules }) => ({ rules, ...(criteria && { files: [path => criteria.test(path)] }) }));
      if (elements.some(it => it.ignorePatterns)) flat.unshift({ ignores: [path => elements.extractConfig(path).ignores(path)] });
      return flat;
    }
  }
  module.exports = { FlatCompat, Legacy: { OverrideTester, ConfigArray } };`;

describe.concurrent("a function in an eslint.config.js", () => {
  test.each(["files", "ignores"])("in `%s` is an error", async key => {
    const { problems, stderr, exitCode } = await lint({
      "eslint.config.mjs": `export default [{ rules: { "no-var": "error" } }, { name: "mine", ${key}: [path => path.endsWith(".ts")], rules: { "no-debugger": "error" } }];`,
      "a.ts": code,
      "b.js": code,
    });
    expect(problems).toEqual([]);
    expect(stderr).toContain(`Config "mine": Key "${key}": A function is not supported, at user-defined index 1.`);
    expect(exitCode).toBe(2);
  });

  test("those of `FlatCompat` are the patterns that they are made of", async () => {
    const { problems, stderr, exitCode } = await lint({
      "node_modules/@eslint/eslintrc/index.js": eslintrc,
      "eslint.config.mjs": `
        import { FlatCompat } from "@eslint/eslintrc";
        export default new FlatCompat({ baseDirectory: import.meta.dirname }).config({
          ignorePatterns: ["ignored.js", "/build"],
          rules: { "no-var": "error" },
          overrides: [
            { files: ["*.ts", "*.mts"], excludedFiles: "*.d.ts", rules: { "no-debugger": "error" } },
            { files: "src/**/*.js", rules: { eqeqeq: "error" }, overrides: [{ files: "./src/only.js", rules: { "no-var": "off" } }] },
          ],
        });`,
      "a.js": code,
      "b.ts": code,
      "c.d.ts": code,
      "ignored.js": code,
      "build/d.js": code,
      ".hidden.js": code,
      "src/e.js": code,
      "src/only.js": code,
      "src/deep/only.js": code,
      "src/ignored.js": code,
    });
    expect(stderr).not.toContain("function");
    expect(problems).toEqual([
      "a.js:1:1 no-var",
      "b.ts:1:1 no-var",
      "b.ts:2:13 no-debugger",
      "src/deep/only.js:1:1 no-var",
      "src/deep/only.js:2:7 eqeqeq",
      "src/e.js:1:1 no-var",
      "src/e.js:2:7 eqeqeq",
      "src/only.js:2:7 eqeqeq",
    ]);
    expect(exitCode).toBe(1);
  });
});

describe.concurrent("an eslint.config.js", () => {
  test("`basePath` can be written as the system writes paths", async () => {
    const { problems } = await lint({
      "eslint.config.mjs": `import { join } from "node:path";
        export default [
          { basePath: join(import.meta.dirname, "src", "deep"), files: ["*.js"], rules: { "no-var": "error" } },
          { basePath: join("src", "deep"), ignores: ["ignored.js"] },
        ];`,
      "a.js": code,
      "src/b.js": code,
      "src/deep/c.js": code,
      "src/deep/ignored.js": code,
    });
    expect(problems).toEqual(["src/deep/c.js:1:1 no-var"]);
  });

  test("a path leaves the program that runs the file with `/`, also on Windows", async () => {
    const source = readFileSync(join(import.meta.dir, "../../../src/lint/driver/evaluate-describe.js"), "utf8");
    const paths = [String.raw`C:\proj\src`, String.raw`packages\a`, String.raw`\\server\share\a`, "C:/proj"];
    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        `${source}
        const { posix, win32 } = require("node:path");
        const paths = ${JSON.stringify(paths)};
        console.log(JSON.stringify([paths.map(it => portablePath(it, win32)), paths.map(it => portablePath(it, posix))]));`,
      ],
      env,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(JSON.parse(stdout)).toEqual([["C:/proj/src", "packages/a", "//server/share/a", "C:/proj"], paths]);
    expect(exitCode).toBe(0);
  });

  test("a plugin that is built in runs in JavaScript under another name, and so does another plugin under its name", async () => {
    const plugin = (name: string, rule: string) => `{
      meta: { name: "${name}", version: "1.0.0" },
      rules: { "${rule}": { create: context => ({ DebuggerStatement: node => context.report({ node, message: "from JavaScript" }) }) } },
    }`;
    const { problems, stderr, exitCode } = await lint(
      {
        "eslint.config.mjs": `export default [
          { files: ["**/*.js"], rules: { "ts/no-explicit-any": "error", "node/no-deprecated-api": "error", "import/first": "error" } },
          {
            plugins: {
              ts: ${plugin("@typescript-eslint/eslint-plugin", "no-explicit-any")},
              node: ${plugin("eslint-plugin-n", "no-deprecated-api")},
              import: ${plugin("eslint-plugin-import-x", "first")},
            },
          },
        ];`,
        "a.js": "debugger;\ndebugger; // eslint-disable-line ts/no-explicit-any, import/first\n",
      },
      ["a.js"],
    );
    expect(stderr).not.toContain("Could not find plugin");
    expect(problems).toEqual([
      "a.js:1:1 import/first",
      "a.js:1:1 node/no-deprecated-api",
      "a.js:1:1 ts/no-explicit-any",
      "a.js:2:1 node/no-deprecated-api",
    ]);
    expect(exitCode).toBe(1);
  });

  // What ESLint 10.12 reports.
  test("the name that another package has in the configuration is not an alias of the plugin that is built in", async () => {
    const { problems, exitCode } = await lint({
      "eslint.config.mjs": `const on = (name, rule, selector) => ({
          meta: { name, version: "1.0.0" },
          rules: {
            [rule]: {
              meta: { schema: false },
              create: context => ({ [selector]: node => context.report({ node, message: "from JavaScript" }) }),
            },
          },
        });
        const old = [2, { version: "13.5.0" }];
        export default [
          {
            plugins: {
              n: on("eslint-plugin-n", "no-unsupported-features/es-syntax", "AwaitExpression"),
              node: on("eslint-plugin-node", "no-unsupported-features/es-syntax", "DebuggerStatement"),
              import: on("eslint-plugin-import", "no-mutable-exports", "ExportNamedDeclaration > VariableDeclaration"),
              "import-x": on("eslint-plugin-import-x", "no-mutable-exports", "DebuggerStatement"),
            },
          },
          { files: ["rules.js"], rules: { "node/no-unsupported-features/es-syntax": old, "import-x/no-mutable-exports": 2 } },
          {
            files: ["disabled.js"],
            rules: {
              "n/no-unsupported-features/es-syntax": old,
              "node/no-unsupported-features/es-syntax": old,
              "import/no-mutable-exports": 2,
              "import-x/no-mutable-exports": 2,
            },
          },
        ];`,
      "rules.js": "debugger;\nexport let a = 1;\nawait a;\n",
      "comment.js":
        '/* eslint node/no-unsupported-features/es-syntax: [2, { version: "13.5.0" }], import-x/no-mutable-exports: 2 */\ndebugger;\nexport let a = 1;\nawait a;\n',
      "own.js":
        '/* eslint n/no-unsupported-features/es-syntax: [2, { version: "13.5.0" }], import/no-mutable-exports: 2 */\ndebugger;\nexport let a = 1;\nawait a;\n',
      "disabled.js":
        "debugger; // eslint-disable-line node/no-unsupported-features/es-syntax\ndebugger; // eslint-disable-line import-x/no-mutable-exports\ndebugger; // eslint-disable-line n/no-unsupported-features/es-syntax, import/no-mutable-exports\nexport let a = 1; // eslint-disable-line import-x/no-mutable-exports\nexport let b = 1; // eslint-disable-line import/no-mutable-exports\nawait a; // eslint-disable-line node/no-unsupported-features/es-syntax\nawait b; // eslint-disable-line n/no-unsupported-features/es-syntax\n",
    });
    expect(problems).toEqual([
      "comment.js:2:1 import-x/no-mutable-exports",
      "comment.js:2:1 node/no-unsupported-features/es-syntax",
      "disabled.js:1:1 import-x/no-mutable-exports",
      "disabled.js:2:1 node/no-unsupported-features/es-syntax",
      "disabled.js:3:1 import-x/no-mutable-exports",
      "disabled.js:3:1 node/no-unsupported-features/es-syntax",
      "disabled.js:3:11 -",
      "disabled.js:4:19 -",
      "disabled.js:4:8 import/no-mutable-exports",
      "disabled.js:6:1 n/no-unsupported-features/es-syntax",
      "disabled.js:6:10 -",
      "own.js:3:8 import/no-mutable-exports",
      "own.js:4:1 n/no-unsupported-features/es-syntax",
      "rules.js:1:1 import-x/no-mutable-exports",
      "rules.js:1:1 node/no-unsupported-features/es-syntax",
    ]);
    expect(exitCode).toBe(1);
  });

  // What eslint-plugin-import 2.32.0 reports and writes.
  // What ESLint 10.12 says with eslint-plugin-import 2.32.0.
  test.each([
    [
      `"error"`,
      `"import/enforce-node-protocol-usage":\n\tValue [] should NOT have fewer than 1 items.`,
      "enforce-node-protocol-usage",
    ],
    [`["error", "always"]`, null, "enforce-node-protocol-usage"],
    [`["error", "always", { js: "never", nonsense: 1 }]`, null, "extensions"],
    [
      `["error", "nonsense"]`,
      `"import/first":\n\tValue "nonsense" should be equal to one of the allowed values.`,
      "first",
    ],
    [`["error", { "prefer-inline": 1 }]`, `"import/no-duplicates":\n\tValue 1 should be boolean.`, "no-duplicates"],
    [`["error", 1]`, `"import/export":\n\tValue [1] should NOT have more than 0 items.`, "export"],
    [`["error", { devDependencies: ["**/*.test.js"] }]`, null, "no-extraneous-dependencies"],
  ])(
    "the options of a rule of eslint-plugin-import are validated by its schema: %s",
    async (setting, refusal, rule) => {
      const { stderr, exitCode } = await lint({
        "eslint.config.mjs": `const rule = { meta: { schema: false }, create: () => ({}) };
        const plugin = { meta: { name: "eslint-plugin-import", version: "2.32.0" }, rules: { "${rule}": rule } };
        export default [{ plugins: { import: plugin }, rules: { "import/${rule}": ${setting} } }];`,
        "a.js": "export {};\n",
      });
      if (refusal === null) expect(stderr).not.toContain(`Key "rules"`);
      else expect(stderr).toContain(`Key "rules": Key ${refusal}`);
      expect(exitCode).toBe(refusal === null ? 0 : 2);
    },
  );

  // The same. Its schema says with `dependencies` which options need which.
  test.each<[string, string[] | null]>([
    [
      "{sortTypesGroup:true}",
      [
        'Value {"sortTypesGroup":true,"distinctGroup":true,"named":false,"warnOnUnassignedImports":false} should have required property \'groups\'.',
        "Value true should be equal to one of the allowed values.",
        'Value {"sortTypesGroup":true,"distinctGroup":true,"named":false,"warnOnUnassignedImports":false} should match exactly one schema in oneOf.',
      ],
    ],
    [
      '{consolidateIslands:"inside-groups"}',
      [
        'Value {"consolidateIslands":"inside-groups","distinctGroup":true,"sortTypesGroup":false,"named":false,"warnOnUnassignedImports":false} should have required property \'newlines-between\'.',
        'Value {"consolidateIslands":"inside-groups","distinctGroup":true,"sortTypesGroup":false,"named":false,"warnOnUnassignedImports":false} should have required property \'newlines-between-types\'.',
        'Value {"consolidateIslands":"inside-groups","distinctGroup":true,"sortTypesGroup":false,"named":false,"warnOnUnassignedImports":false} should match some schema in anyOf.',
        'Value "inside-groups" should be equal to one of the allowed values.',
        'Value {"consolidateIslands":"inside-groups","distinctGroup":true,"sortTypesGroup":false,"named":false,"warnOnUnassignedImports":false} should match exactly one schema in oneOf.',
      ],
    ],
    ['{"newlines-between-types":"always"}', ["Value false should be equal to one of the allowed values."]],
    [
      '{sortTypesGroup:true,groups:["builtin"]}',
      [
        'Value ["builtin"] should NOT be valid.',
        "Value true should be equal to one of the allowed values.",
        'Value {"sortTypesGroup":true,"groups":["builtin"],"distinctGroup":true,"named":false,"warnOnUnassignedImports":false} should match exactly one schema in oneOf.',
      ],
    ],
    [
      '{sortTypesGroup:true,groups:[["builtin","external"],"index"]}',
      [
        'Value [["builtin","external"],"index"] should NOT be valid.',
        "Value true should be equal to one of the allowed values.",
        'Value {"sortTypesGroup":true,"groups":[["builtin","external"],"index"],"distinctGroup":true,"named":false,"warnOnUnassignedImports":false} should match exactly one schema in oneOf.',
      ],
    ],
    [
      '{sortTypesGroup:true,groups:["type"],"newlines-between-types":"never",consolidateIslands:"inside-groups"}',
      [
        'Value {"sortTypesGroup":true,"groups":["type"],"newlines-between-types":"never","consolidateIslands":"inside-groups","distinctGroup":true,"named":false,"warnOnUnassignedImports":false} should have required property \'newlines-between\'.',
        'Value "never" should be equal to one of the allowed values.',
        'Value {"sortTypesGroup":true,"groups":["type"],"newlines-between-types":"never","consolidateIslands":"inside-groups","distinctGroup":true,"named":false,"warnOnUnassignedImports":false} should match some schema in anyOf.',
        'Value "inside-groups" should be equal to one of the allowed values.',
        'Value {"sortTypesGroup":true,"groups":["type"],"newlines-between-types":"never","consolidateIslands":"inside-groups","distinctGroup":true,"named":false,"warnOnUnassignedImports":false} should match exactly one schema in oneOf.',
      ],
    ],
    [
      '{sortTypesGroup:false,"newlines-between-types":"never"}',
      ["Value false should be equal to one of the allowed values."],
    ],
    [
      '{consolidateIslands:"inside-groups","newlines-between":"always"}',
      [
        'Value "always" should be equal to one of the allowed values.',
        'Value {"consolidateIslands":"inside-groups","newlines-between":"always","distinctGroup":true,"sortTypesGroup":false,"named":false,"warnOnUnassignedImports":false} should have required property \'newlines-between-types\'.',
        'Value {"consolidateIslands":"inside-groups","newlines-between":"always","distinctGroup":true,"sortTypesGroup":false,"named":false,"warnOnUnassignedImports":false} should match some schema in anyOf.',
        'Value "inside-groups" should be equal to one of the allowed values.',
        'Value {"consolidateIslands":"inside-groups","newlines-between":"always","distinctGroup":true,"sortTypesGroup":false,"named":false,"warnOnUnassignedImports":false} should match exactly one schema in oneOf.',
      ],
    ],
    ['{consolidateIslands:"never"}', null],
    ['{sortTypesGroup:true,groups:["type"]}', null],
    ['{sortTypesGroup:true,groups:[["type","builtin"]],"newlines-between-types":"ignore"}', null],
    ['{consolidateIslands:"inside-groups","newlines-between":"always-and-inside-groups"}', null],
    [
      "{sortTypesGroup:true,groups:[]}",
      [
        "Value [] should NOT be valid.",
        "Value true should be equal to one of the allowed values.",
        'Value {"sortTypesGroup":true,"groups":[],"distinctGroup":true,"named":false,"warnOnUnassignedImports":false} should match exactly one schema in oneOf.',
      ],
    ],
    ["{sortTypesGroup:false}", null],
    [
      '{sortTypesGroup:true,groups:["type"],consolidateIslands:"inside-groups","newlines-between-types":"always-and-inside-groups"}',
      null,
    ],
    [
      '{sortTypesGroup:true,groups:["type","type"]}',
      ['Value ["type","type"] should NOT have duplicate items (items ## 0 and 1 are identical).'],
    ],
    [
      '{consolidateIslands:"x"}',
      [
        'Value "x" should be equal to one of the allowed values.',
        'Value "x" should be equal to one of the allowed values.',
        'Value {"consolidateIslands":"x","distinctGroup":true,"sortTypesGroup":false,"named":false,"warnOnUnassignedImports":false} should match exactly one schema in oneOf.',
      ],
    ],
  ])("import/order: options that need others: %s", async (options, refusal) => {
    const { stderr, exitCode } = await lint({
      "eslint.config.mjs": `const order = { meta: { schema: false }, create: () => ({}) };
        const plugin = { meta: { name: "eslint-plugin-import", version: "2.32.0" }, rules: { order } };
        export default [{ plugins: { import: plugin }, rules: { "import/order": ["error", ${options}] } }];`,
      "a.js": "export {};\n",
    });
    if (refusal === null) expect(stderr).not.toContain(`Key "rules"`);
    else expect(stderr).toEndWith(`Key "rules": Key "import/order":\n\t${refusal.join("\n\t")}`);
    expect(exitCode).toBe(refusal === null ? 0 : 2);
  });

  // What ESLint 10.12 says. The first schema is that of react/jsx-newline. Where the first error ends it all, that is the error of the
  // branch. Among alternatives there is a line about the branch, too.
  describe("`if`, `then` and `else` in the schema of a rule", () => {
    const flag = { default: false, type: "boolean" };
    const newline = {
      type: "object",
      properties: { prevent: flag, allowMultilines: flag },
      additionalProperties: false,
      if: { properties: { allowMultilines: { const: true } } },
      then: { properties: { prevent: { const: true } }, required: ["prevent"] },
    };
    const either = { type: "object", if: { required: ["a"] }, then: { required: ["b"] }, else: { required: ["c"] } };
    const branches = { if: { type: "string" }, then: { enum: ["x"] }, else: { type: "boolean" } };
    const among = { anyOf: [{ type: "number" }, branches] };
    const afterAll = { allOf: [{ type: "string" }], if: { const: "a" }, then: { minLength: 5 } };
    test.each<[schema: object, option: unknown, refusal: string[] | null]>([
      [newline, { allowMultilines: true }, ["Value false should be equal to constant."]],
      [newline, { prevent: false, allowMultilines: true }, ["Value false should be equal to constant."]],
      [newline, { prevent: true, allowMultilines: true }, null],
      [newline, { allowMultilines: false }, null],
      [newline, { allowMultilines: 1 }, ["Value 1 should be boolean."]],
      [newline, {}, null],
      [either, { a: 1 }, [`Value {"a":1} should have required property '.b'.`]],
      [either, { a: 1, b: 1 }, null],
      [either, {}, ["Value {} should have required property '.c'."]],
      [either, { c: 1 }, null],
      [
        among,
        "y",
        [
          'Value "y" should be number.',
          'Value "y" should be equal to one of the allowed values.',
          'Value "y" should match "then" schema.',
          'Value "y" should match some schema in anyOf.',
        ],
      ],
      [among, "x", null],
      [among, 1, null],
      [
        among,
        null,
        [
          "Value null should be number.",
          "Value null should be boolean.",
          'Value null should match "else" schema.',
          "Value null should match some schema in anyOf.",
        ],
      ],
      [among, true, null],
      [{ if: { type: "string" } }, "y", null],
      [{ then: { type: "string" }, else: { type: "string" } }, 1, null],
      [afterAll, "a", ['Value "a" should NOT be shorter than 5 characters.']],
      [afterAll, 1, ["Value 1 should be string."]],
    ])("%j with %j", async (schema, option, refusal) => {
      const { stderr, exitCode } = await lint({
        "eslint.config.mjs": `const rule = { meta: { schema: [${JSON.stringify(schema)}] }, create: () => ({}) };
          export default [{ plugins: { x: { rules: { r: rule } } }, rules: { "x/r": ["error", ${JSON.stringify(option)}] } }];`,
        "a.js": "export {};\n",
      });
      if (refusal === null) expect(stderr).not.toContain(`Key "rules"`);
      else expect(stderr).toEndWith(`Key "rules": Key "x/r":\n\t${refusal.join("\n\t")}`);
      expect(exitCode).toBe(refusal === null ? 0 : 2);
    });
  });

  test("import/order: the kinds of modules by their names and by `settings`, path groups, names in braces, the fix", async () => {
    const files = {
      "eslint.config.mjs": `const order = {
          meta: { schema: false },
          create: context => ({ Program: node => context.report({ node, message: "from JavaScript" }) }),
        };
        const options = {
          groups: ["builtin", "external", "internal", ["parent", "sibling", "index"]],
          pathGroups: [{ pattern: "#internal/**", group: "internal", position: "after" }],
          "newlines-between": "always",
          alphabetize: { order: "asc" },
          named: true,
        };
        export default [
          {
            plugins: { import: { meta: { name: "eslint-plugin-import", version: "2.32.0" }, rules: { order } } },
            settings: { "import/internal-regex": "^@app/" },
            rules: { "import/order": ["error", options] },
          },
        ];`,
      "package.json": "{}",
      "node_modules/lodash/index.js": "",
      "a.js":
        'import b from "./b"; // the sibling\nimport fs from "node:fs";\nimport { z, a } from "lodash";\nimport own from "#internal/y";\nimport app from "@app/x";\n\nimport up from "../up";\nfoo(b, fs, z, a, own, app, up);\n',
    };
    const { problems } = await lint(files, ["a.js"]);
    expect(problems).toEqual([
      "a.js:1:1 import/order",
      "a.js:1:1 import/order",
      "a.js:2:1 import/order",
      "a.js:3:1 import/order",
      "a.js:3:13 import/order",
      "a.js:4:1 import/order",
      "a.js:4:1 import/order",
    ]);
    const fixed = await lint(files, ["a.js", "--fix-dry-run"]);
    expect(JSON.parse(fixed.raw).results[0].output).toBe(
      'import fs from "node:fs";\n\nimport { a, z } from "lodash";\n\nimport app from "@app/x";\n\nimport own from "#internal/y";\n\nimport b from "./b"; // the sibling\nimport up from "../up";\nfoo(b, fs, z, a, own, app, up);\n',
    );
  });

  // What ESLint 10.12 prints.
  // ESLint 10.12 says the same.
  test("objects for different files can have different plugins under one name, one file cannot", async () => {
    const plugin = (name: string) =>
      `({ rules: { r: { create: context => ({ Program: node => context.report({ node, message: "${name} ran" }) }) } } })`;
    const files = {
      "one.cjs": `module.exports = ${plugin("one")};`,
      "two.cjs": `module.exports = ${plugin("two")};`,
      "x/a.js": "a;\n",
      "y/a.js": "a;\n",
    };
    const objects = (first: string) => `const rules = { "p/r": "error" };
      export default [{ ${first} plugins: { p: one }, rules }, { files: ["y/**"], plugins: { p: two }, rules }];`;
    const imported = `import one from "./one.cjs"; import two from "./two.cjs";`;
    const written = `const [one, two] = [${plugin("one")}, ${plugin("two")}];`;
    const messages = ({ raw }: { raw: string }) =>
      JSON.parse(raw).results.map((it: { messages: { message: string }[] }) => it.messages.map(it => it.message));
    const [ofModules, ofTheFile, forOneFile] = await Promise.all([
      lint({ ...files, "eslint.config.mjs": imported + objects(`files: ["x/**"],`) }, ["x", "y"]),
      lint({ ...files, "eslint.config.mjs": written + objects(`files: ["x/**"],`) }, ["x", "y"]),
      lint({ ...files, "eslint.config.mjs": imported + objects("") }, ["x", "y"]),
    ]);
    expect([messages(ofModules), messages(ofTheFile)]).toEqual([
      [["one ran"], ["two ran"]],
      [["one ran"], ["two ran"]],
    ]);
    expect(forOneFile.stderr).toContain(`Key "plugins": Cannot redefine plugin "p".`);
    expect(forOneFile.exitCode).toBe(2);
  });

  test("usedDeprecatedRules has the rules of a plugin in JavaScript, in the order of the configuration", async () => {
    const info = {
      message: "Gone.",
      replacedBy: [{ plugin: { name: "@scope/eslint-plugin-q" }, rule: { name: "r" } }, { rule: { name: "s" } }, {}],
    };
    const { stdout } = await lint(
      {
        "eslint.config.mjs": `
          const rule = meta => ({ meta, create: () => ({}) });
          const rules = {
            old: rule({ deprecated: true, replacedBy: ["p/new"] }),
            bare: rule({ deprecated: true }),
            info: rule({ deprecated: ${JSON.stringify(info)} }),
            fine: rule({ deprecated: false }),
            off: rule({ deprecated: true }),
          };
          export default [{
            plugins: { p: { rules } },
            rules: { "p/old": 2, "no-new-object": 2, "p/info": 1, "p/fine": 2, "p/off": 0, "p/bare": 2 },
          }];`,
        "a.js": "export {};\n",
      },
      ["a.js"],
    );
    const [{ usedDeprecatedRules: used }] = JSON.parse(stdout).results;
    expect(used.map((it: { ruleId: string }) => it.ruleId)).toEqual(["p/old", "no-new-object", "p/info", "p/bare"]);
    expect([used[0], used[2], used[3]]).toEqual([
      { ruleId: "p/old", replacedBy: ["p/new"] },
      { ruleId: "p/info", replacedBy: ["@scope/q/r", "s", ""], info },
      { ruleId: "p/bare", replacedBy: [] },
    ]);
  });

  test("--print-config has the rules of a plugin in JavaScript", async () => {
    const { stdout, exitCode } = await lint(
      {
        "eslint.config.mjs": `export default [{ plugins: { q: { meta: { name: "eslint-plugin-q", version: "1.2.3" } } } }, {
          plugins: {
            p: { rules: { r: { meta: { schema: false }, create: () => ({}) }, s: { create: () => ({}) } } },
            n: { meta: { name: "eslint-plugin-n" } },
          },
          rules: { "no-var": "error", "p/r": ["warn", { a: 1 }], "p/s": "off" },
        }];`,
        "a.js": code,
      },
      ["--print-config", "a.js"],
    );
    expect(JSON.parse(stdout).rules).toEqual({ "no-var": [2], "p/r": [1, { a: 1 }], "p/s": [0] });
    expect(JSON.parse(stdout).plugins).toEqual(["@", "q:eslint-plugin-q@1.2.3", "p", "n:eslint-plugin-n"]);
    expect(exitCode).toBe(0);
  });

  test("the options of the language of a plugin are not those of JavaScript", async () => {
    const { problems, stderr } = await lint({
      "eslint.config.mjs": `export default [
        { rules: { "no-var": "error" } },
        { files: ["**/*.jsonc"], plugins: { j: { languages: { jsonc: {} } } }, language: "j/jsonc", languageOptions: { allowTrailingCommas: true } },
      ];`,
      "a.js": code,
      "b.jsonc": "[1,]\n",
    });
    expect(stderr).not.toContain("allowTrailingCommas");
    expect(problems).toEqual(["a.js:1:1 no-var"]);
  });

  test("one that exports nothing is an error", async () => {
    const { problems, stderr, exitCode } = await lint({ "eslint.config.mjs": "export const a = 1;\n", "a.js": code });
    expect(problems).toEqual([]);
    expect(stderr).toContain("<dir>/eslint.config.mjs exports nothing.");
    expect(exitCode).toBe(2);
  });

  test('`type: "any"` in the schema of a rule allows everything', async () => {
    const { problems, stderr, exitCode } = await lint({
      "plugin.mjs": `export default { rules: { r: { meta: { schema: [{ type: "array", items: { type: "any" } }] }, create: context => ({ DebuggerStatement: node => context.report({ node, message: "found" }) }) } } };`,
      "eslint.config.mjs": `import p from "./plugin.mjs";\nexport default [{ ignores: ["plugin.mjs"] }, { plugins: { p }, rules: { "p/r": ["error", [{ a: 1 }, 1, "a"]] } }];`,
      "a.js": code,
    });
    expect(stderr).not.toContain("should be");
    expect(problems).toEqual(["a.js:2:13 p/r"]);
    expect(exitCode).toBe(1);
  });

  // What it answers is looked up by the paths that it was given, which have `/` on every system. `path.win32` makes `\\` of them.
  test("what the program for ESLint 8 answers has the paths that it was given as keys, also on Windows", async () => {
    using dir = tempDir("bun-lint-config-files", {});
    const parts = ["start", "describe", "eslintrc"];
    const source = parts
      .map(it => readFileSync(join(import.meta.dir, `../../../src/lint/driver/evaluate-${it}.js`), "utf8"))
      .join("")
      .replaceAll('require("node:path")', 'require("node:path").win32');
    // What `require.resolve(..)` returns is asked for with `/`.
    const content = { extends: ["./base.json", String.raw`C:\t\other.json`], parser: "nowhere", plugins: ["nowhere"] };
    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        source,
        JSON.stringify({ pluginsFrom: "C:/t", content }),
        "<marker>",
        "C:/t/.eslintrc.json",
      ],
      env,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "inherit",
    });
    const stdout = await proc.stdout.text();
    const { config } = JSON.parse(stdout.slice(stdout.lastIndexOf("<marker>") + "<marker>".length));
    expect({
      configs: Object.keys(config.configs),
      extended: Object.keys(config.configs["C:/t/.eslintrc.json"] ?? {}),
      parsers: Object.keys(config.parsers),
      plugins: Object.keys(config.plugins),
    }).toEqual({
      configs: ["C:/t/.eslintrc.json"],
      extended: ["./base.json", "C:/t/other.json"],
      parsers: ["C:/t/.eslintrc.json"],
      plugins: ["C:/t"],
    });
  });

  // `extends: [require.resolve("./base")]`
  test("what the program for ESLint 8 answers about a path that is extended is under that path with `/`", async () => {
    using dir = tempDir("bun-lint-config-files", {});
    const parts = ["start", "describe", "eslintrc"];
    const source = parts
      .map(it => readFileSync(join(import.meta.dir, `../../../src/lint/driver/evaluate-${it}.js`), "utf8"))
      .join("")
      .replaceAll('require("node:path")', 'require("node:path").win32');
    const content = { extends: ["C:\\t\\base.json", ".\\near.json", "a-package"], parser: "C:\\t\\parser.js" };
    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        source,
        JSON.stringify({ pluginsFrom: "C:/t", content }),
        "<marker>",
        "C:/t/.eslintrc.json",
      ],
      env,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "inherit",
    });
    const stdout = await proc.stdout.text();
    const { config } = JSON.parse(stdout.slice(stdout.lastIndexOf("<marker>") + "<marker>".length));
    expect(Object.keys(config.configs["C:/t/.eslintrc.json"])).toEqual([
      "C:/t/base.json",
      "./near.json",
      "eslint-config-a-package",
    ]);
    // A parser is asked for as it is written: `_loadParser` in src/lint/linter/config/eslintrc.rs.
    expect(Object.keys(config.parsers["C:/t/.eslintrc.json"])).toEqual(["C:\\t\\parser.js"]);
  });

  // The same for a file that it reads. `/./` is what `path.resolve` would take out, on every system.
  test("what the program for ESLint 8 answers about the file that it runs is under the path that it was given", async () => {
    using dir = tempDir("bun-lint-config-files", {
      ".eslintrc.js": `module.exports = { extends: "./base.json" };`,
      "base.json": "{}",
    });
    const parts = ["start", "describe", "eslintrc"];
    const source = parts.map(it =>
      readFileSync(join(import.meta.dir, `../../../src/lint/driver/evaluate-${it}.js`), "utf8"),
    );
    const root = String(dir).replaceAll("\\", "/");
    const path = `${root}/./.eslintrc.js`;
    await using proc = spawn({
      cmd: [bunExe(), "-e", source.join(""), JSON.stringify({ pluginsFrom: root }), "<marker>", path],
      env,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "inherit",
    });
    const stdout = await proc.stdout.text();
    const { config } = JSON.parse(stdout.slice(stdout.lastIndexOf("<marker>") + "<marker>".length));
    expect({ files: Object.keys(config.files), configs: Object.keys(config.configs) }).toEqual({
      files: [path],
      configs: [path],
    });
  });

  test("the program that runs the file knows it, however its path is spelled", async () => {
    using dir = tempDir("bun-lint-config-files", {
      "real/eslint.config.mjs": `export const local = { rules: { r: { create: () => ({}) } } };
        export default [{ plugins: { local }, rules: { "local/r": "error" } }];`,
    });
    symlinkSync(join(String(dir), "real"), join(String(dir), "link"), "junction");
    const parts = ["start", "describe", "eslint"];
    const source = parts.map(it =>
      readFileSync(join(import.meta.dir, `../../../src/lint/driver/evaluate-${it}.js`), "utf8"),
    );
    const root = String(dir).replaceAll("\\", "/");
    // `bun lint` writes it with `/`, which is not how Windows does. Elsewhere `/./` makes it another text, and so does a link.
    const paths = [`${root}/real/${isWindows ? "" : "./"}eslint.config.mjs`, `${root}/link/eslint.config.mjs`];
    const keys = await Promise.all(
      paths.map(async path => {
        await using proc = spawn({
          cmd: [bunExe(), "-e", source.join(""), "<marker>", path],
          env,
          cwd: join(path, ".."),
          stdout: "pipe",
          stderr: "inherit",
        });
        const stdout = await proc.stdout.text();
        const { config } = JSON.parse(stdout.slice(stdout.lastIndexOf("<marker>") + "<marker>".length));
        return Object.keys(config[0].$jsPlugins.local).sort();
      }),
    );
    // Not `module`: what only the file has is not to be had without running it.
    expect(keys).toEqual([
      ["config", "described", "else", "index"],
      ["config", "described", "else", "index"],
    ]);
  });
});

// `import.source(..)` is a syntax error here, and Babel may read it. No rule is to run on a tree with holes in it.
test.concurrent(
  "what only the parser of the configuration can read is named, if the package eslint is not there",
  async () => {
    const crashes = `{ create: context => ({ MemberExpression(node) { context.report({ node, message: node.object.type }); } }) }`;
    const files = {
      "eslint.config.mjs": `export default [{
      languageOptions: { parser: { meta: { name: "@babel/eslint-parser" }, parseForESLint() { throw new Error("called"); } } },
      plugins: { mine: { rules: { crashes: ${crashes} } } },
      rules: { "mine/crashes": "error", "no-var": "error" },
    }];`,
      "a.mjs": "var a = 1;\nexport { a };\n",
      "b.mjs": "const b = await import.source('./b.wasm');\nexport { b };\n",
    };
    const { problems, stderr, exitCode } = await lint(files, ["a.mjs", "b.mjs"]);
    expect(problems).toEqual(["a.mjs:1:1 no-var"]);
    expect(stderr).toContain(
      `1 file was not linted, only the parser of the configuration can read it: b.mjs. The package "eslint" lints with that parser, if it is installed`,
    );
    expect(exitCode).toBe(2);
    expect((await lint(files, ["--allow-unsupported", "a.mjs", "b.mjs"])).exitCode).toBe(1);
  },
);

// What ESLint 10.12 reports with @babel/eslint-parser 8.0.7, which analyzes the scopes itself: the code of a file is in the scope of a
// function only with `globalReturn`, and not in a module. So in nodejs/node, which is "commonjs", `const { Symbol } = primordials;`
// defines the global variable: for the rules here and for those in JavaScript.
test.concurrent("with the parser of Babel, `commonjs` alone puts no function around a file", async () => {
  const defines = `{ create: context => ({ Program(node) {
    if (context.sourceCode.scopeManager.globalScope.set.get("Symbol").defs.length > 0) context.report({ node, message: "defined" });
  } }) }`;
  const wraps = `{ create: context => ({ Program(node) {
    if (context.sourceCode.scopeManager.scopes.some(it => it.type === "function")) context.report({ node, message: "wrapped" });
  } }) }`;
  const inGlobalScope = ["1:1 mine/defines", "1:9 no-redeclare", "2:5 no-implicit-globals"];
  const cases: [sourceType: string, globalReturn: boolean, problems: string[]][] = [
    ["commonjs", false, inGlobalScope],
    ["commonjs", true, ["1:1 mine/wraps"]],
    ["script", false, inGlobalScope],
    ["script", true, ["1:1 mine/wraps"]],
    ["module", false, []],
    ["module", true, []],
  ];
  const objects = cases.map(
    ([sourceType, globalReturn], at) => `{
      files: ["d${at}/*.js"],
      languageOptions: { sourceType: "${sourceType}", parserOptions: { requireConfigFile: false, ecmaFeatures: { globalReturn: ${globalReturn} } } },
    }`,
  );
  const files = {
    "eslint.config.mjs": `const parser = { meta: { name: "@babel/eslint-parser", version: "8.0.7" }, parseForESLint() { throw new Error("called"); } };
    export default [{ ignores: ["eslint.config.mjs"] }, {
      languageOptions: { parser, globals: { Symbol: "readonly", primordials: "readonly" } },
      plugins: { mine: { rules: { defines: ${defines}, wraps: ${wraps} } } },
      rules: { "mine/defines": "error", "mine/wraps": "error", "no-redeclare": "error", "no-implicit-globals": "error" },
    }, ${objects.join(", ")}];`,
    ...Object.fromEntries(cases.map((_, at) => [`d${at}/a.js`, "const { Symbol } = primordials;\nvar b;\n"])),
  };
  const { problems } = await lint(files);
  expect(problems).toEqual(cases.flatMap(([, , problems], at) => problems.map(it => `d${at}/a.js:${it}`)));
});

// The rule here answers only where its text is that of the package, byte for byte. Where it cannot tell, the package's rule runs.
test.concurrent("prettier/prettier: what the rule here cannot answer for, the rule of the package does", async () => {
  const theirs = `{ create: context => ({ VariableDeclaration(node) { context.report({ node, message: "theirs" }); } }) }`;
  const plugin = `{ meta: { name: "eslint-plugin-prettier", version: "5.5.6" }, rules: { prettier: ${theirs} } }`;
  const config = `export default [{ plugins: { prettier: ${plugin} }, rules: { "prettier/prettier": "error", "no-var": "error" } }];`;
  const files = {
    "eslint.config.mjs": config,
    "a.js": "var a;\n",
    "b.js": "// eslint-disable-next-line prettier/prettier\nvar b;\n",
  };
  const { problems, exitCode } = await lint(files, ["a.js", "b.js"]);
  expect(problems).toEqual(["a.js:1:1 no-var", "a.js:1:1 prettier/prettier", "b.js:2:1 no-var"]);
  expect(exitCode).toBe(1);
});

test.concurrent.each([
  ["no setting", undefined, []],
  ["node", "node", []],
  ["node and typescript, with options", { node: { extensions: [".js"] }, typescript: {} }, []],
  ["by the names of the packages", ["eslint-import-resolver-node", { "eslint-import-resolver-typescript": {} }], []],
  ["webpack", "webpack", ["a.js:1:1 import/no-cycle"]],
  ["webpack beside node", { node: {}, webpack: { config: "webpack.config.js" } }, ["a.js:1:1 import/no-cycle"]],
  ["in a list", ["node", { alias: {} }], ["a.js:1:1 import/no-cycle"]],
  ["in a list in a list", [["node"], [["webpack"]]], ["a.js:1:1 import/no-cycle"]],
  ["lists of what is known", [["node"], [], null], []],
  ["what counts as none", 0, []],
  // The package reports that.
  ["what is no resolver", true, ["a.js:1:1 import/no-cycle"]],
  ["what is no resolver, in a list", ["node", 0], ["a.js:1:1 import/no-cycle"]],
  ["core modules that are no list", "node", ["a.js:1:1 import/no-cycle"], { "import/core-modules": 5 }],
  [
    "the parsers that are here",
    undefined,
    [],
    { "import/parsers": { "espree": [".js"], "@typescript-eslint/parser": [".ts"] } },
  ],
  ["another parser", "node", ["a.js:1:1 import/no-cycle"], { "import/parsers": { "@babel/eslint-parser": [".js"] } }],
  // As eslint-config-next writes them: `[require.resolve("eslint-import-resolver-node")]`.
  [
    "paths of the packages",
    {
      "/p/node_modules/eslint-import-resolver-node/index.js": {},
      "C:\\p\\node_modules\\eslint-import-resolver-typescript\\lib\\index.cjs": {},
    },
    [],
    { "import/parsers": { "/p/node_modules/.pnpm/a/node_modules/@typescript-eslint/parser/dist/index.js": [".ts"] } },
  ],
  [
    "the path of another",
    { "/p/node_modules/eslint-import-resolver-webpack/index.js": {} },
    ["a.js:1:1 import/no-cycle"],
  ],
] as [string, unknown, string[], object?][])(
  "import/resolver: the package answers for a resolver that is not known here: %s",
  // With four parameters the fourth is `done` for a row of three.
  async (_, resolver, expected, more = undefined) => {
    const theirs = `{ create: context => ({ Program(node) { context.report({ node, message: "theirs" }); } }) }`;
    const config = `export default [
    { settings: ${JSON.stringify({ "import/resolver": resolver, ...more })} },
    { plugins: { import: { meta: { name: "eslint-plugin-import" }, rules: { "no-cycle": ${theirs} } } }, rules: { "import/no-cycle": "error" } },
  ];`;
    const { problems } = await lint({ "eslint.config.mjs": config, "a.js": "export {};\n" }, ["a.js"]);
    expect(problems).toEqual(expected);
  },
);

// What eslint-import-resolver-typescript 4.4.5 finds, with eslint-plugin-import 2.32.0 under ESLint 10.12. TypeScript itself finds
// none of the first seven: no style sheet, no picture, nothing behind a `?`, and under `node16` nothing without its extension.
test.concurrent("import/resolver: typescript finds what is no script, as the package does", async () => {
  const compilerOptions = { module: "node16", moduleResolution: "node16", baseUrl: ".", paths: { "@/*": ["./src/*"] } };
  const found = ["./a.css", "./logo.svg?raw", "./data", "./b", "@/a.css", "src/logo.svg", "pkg/css"];
  const missing = ["./none.css", "@/none.svg", "pkg/dist/a.css", "./b.ts/"];
  const files = {
    "eslint.config.mjs": `export default [{
      settings: { "import/resolver": { typescript: true } },
      plugins: { import: { meta: { name: "eslint-plugin-import" }, rules: {} } },
      rules: { "import/no-unresolved": "error" },
    }];`,
    "package.json": "{}",
    "tsconfig.json": JSON.stringify({ compilerOptions }),
    "src/a.css": "",
    "src/logo.svg": "",
    "src/data.json": "{}",
    "src/b.ts": "export {};\n",
    "node_modules/pkg/package.json": JSON.stringify({ name: "pkg", exports: { "./css": "./dist/a.css" } }),
    "node_modules/pkg/dist/a.css": "",
    "src/a.mjs": [...found, ...missing].map(it => `import ${JSON.stringify(it)};\n`).join(""),
  };
  const { problems } = await lint(files, ["src/a.mjs"]);
  // `lint` sorts them as strings.
  expect(problems).toEqual(missing.map((_, at) => `src/a.mjs:${found.length + at + 1}:8 import/no-unresolved`).sort());
});

const linted = { main: "src/main.ts", e2e: "e2e/t.ts", a: "packages/a/src/i.ts", b: "packages/b/src/i.ts" };
const all = Object.keys(linted);

// Recorded from eslint-import-resolver-typescript 4.4.5 with eslint-plugin-import 2.32.0 under ESLint 10.12. It does not read the
// tsconfig.json that is nearest to a file.
test.concurrent.each([
  // That of the working directory, and of what it refers to the first in whose directory the file is: as Vite's templates have it.
  ["nothing", true, { "@/x": [], "~base/x": all, "#a/x": all, "#b/x": all }],
  ["one file, of any name", { project: "tsconfig.base.json" }, { "@/x": all, "~base/x": [], "#a/x": all, "#b/x": all }],
  ["one directory", { project: "packages/a" }, { "@/x": all, "~base/x": all, "#a/x": [], "#b/x": all }],
  // The closest that is for the file. For a file that none is for, each of them is asked.
  ["a pattern", { project: "packages/*/tsconfig.json" }, { "@/x": all, "~base/x": all, "#a/x": ["b"], "#b/x": ["a"] }],
  ["a list", { project: ["packages/a", "packages/b"] }, { "@/x": all, "~base/x": all, "#a/x": ["b"], "#b/x": ["a"] }],
] as [string, unknown, Record<string, string[]>][])(
  "import/resolver: typescript: which tsconfig.json it reads: %s",
  async (_, options, unresolvedIn) => {
    const names = Object.keys(unresolvedIn);
    const code = names.map(it => `import ${JSON.stringify(it)};\n`).join("");
    const paths = (name: string) => JSON.stringify({ compilerOptions: { paths: { [`${name}/*`]: ["./src/*"] } } });
    const files = {
      // As eslint-config-next names it: `[require.resolve("eslint-import-resolver-typescript")]`.
      "eslint.config.mjs": `export default [{
        files: ["**/*.ts"],
        settings: { "import/resolver": { "/p/node_modules/eslint-import-resolver-typescript/lib/index.cjs": ${JSON.stringify(options)} } },
        plugins: { import: { meta: { name: "eslint-plugin-import" }, rules: {} } },
        rules: { "import/no-unresolved": "error" },
      }];`,
      "package.json": "{}",
      "tsconfig.json": JSON.stringify({ files: [], references: [{ path: "./tsconfig.app.json" }] }),
      "tsconfig.app.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } }, include: ["src"] }),
      "tsconfig.base.json": paths("~base"),
      "packages/a/tsconfig.json": paths("#a"),
      "packages/b/tsconfig.json": paths("#b"),
      "e2e/tsconfig.json": "{}",
      "src/x.ts": "export {};\n",
      "packages/a/src/x.ts": "export {};\n",
      "packages/b/src/x.ts": "export {};\n",
      ...Object.fromEntries(Object.values(linted).map(it => [it, code])),
    };
    const { problems } = await lint(files, Object.values(linted));
    const expected = names.flatMap((name, at) =>
      unresolvedIn[name].map(it => `${linted[it as keyof typeof linted]}:${at + 1}:8 import/no-unresolved`),
    );
    expect(problems).toEqual(expected.sort());
  },
);

// Recorded from eslint-import-resolver-typescript 4.4.5 with eslint-plugin-import 2.32.0 under ESLint 10.12. `core.wasm.js` cannot be
// written without its extension: `core.wasm` is another file. TypeScript would add `.js` to that.
test.concurrent(
  "import/resolver: typescript: a name that is a file is that file, before anything is added to it",
  async () => {
    const never = Object.fromEntries(["js", "jsx", "mjs", "ts", "mts", "tsx"].map(it => [it, "never"]));
    const names = [
      "pkg.js-core/core.wasm.js?url",
      "pkg.js-core/worker.min.js?url",
      "pkg.js-core/core.wasm.js",
      "./a.css.ts",
      "@/b.ts",
    ];
    const files = {
      "eslint.config.mjs": `export default [{
      files: ["**/*.ts"],
      settings: { "import/resolver": { typescript: { project: "tsconfig.json" } } },
      plugins: { import: { meta: { name: "eslint-plugin-import" }, rules: {} } },
      rules: { "import/extensions": ["error", "always", ${JSON.stringify(never)}] },
    }];`,
      "package.json": "{}",
      "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
      "node_modules/pkg.js-core/package.json": `{ "name": "pkg.js-core" }`,
      "node_modules/pkg.js-core/core.wasm": "",
      "node_modules/pkg.js-core/core.wasm.js": "",
      "node_modules/pkg.js-core/worker.min.js": "",
      "src/a.css": "",
      "src/a.css.ts": "export {};\n",
      "src/b": "",
      "src/b.ts": "export {};\n",
      "src/main.ts": names.map(it => `import(${JSON.stringify(it)});\n`).join(""),
    };
    const { problems } = await lint(files, ["src/main.ts"]);
    expect(problems).toEqual(["src/main.ts:2:8 import/extensions"]);
  },
);

// Recorded from eslint-import-resolver-typescript 4.4.5 with eslint-plugin-import 2.32.0 under ESLint 10.12. Node.js and TypeScript take
// what `exports` names for the file.
test.concurrent(
  "import/resolver: typescript goes on from what `exports` names: extensions, then a directory",
  async () => {
    const found = ["exp/a", "exp/b", "exp/c", "exp/d", "exp/e", "exp/a.ts", "exp/style.css"];
    const missing = ["exp/none", "exp/a.css", "exp/dist/a", "other/a"];
    const files = {
      "eslint.config.mjs": `export default [{
      files: ["**/*.ts"],
      settings: { "import/resolver": { typescript: true } },
      plugins: { import: { meta: { name: "eslint-plugin-import" }, rules: {} } },
      rules: { "import/no-unresolved": "error" },
    }];`,
      "package.json": "{}",
      "tsconfig.json": "{}",
      "node_modules/exp/package.json": JSON.stringify({ name: "exp", exports: { "./*": "./dist/*" } }),
      "node_modules/exp/dist/a.ts": "",
      "node_modules/exp/dist/b.js": "",
      "node_modules/exp/dist/c.json": "{}",
      "node_modules/exp/dist/d/index.js": "",
      "node_modules/exp/dist/e.d.ts": "",
      "node_modules/exp/dist/style.css": "",
      "node_modules/other/package.json": JSON.stringify({ name: "other", exports: { "./b": "./b.js" } }),
      "node_modules/other/a.js": "",
      "src/main.ts": [...found, ...missing].map(it => `import ${JSON.stringify(it)};\n`).join(""),
    };
    const { problems } = await lint(files, ["src/main.ts"]);
    // `lint` sorts them as strings.
    expect(problems).toEqual(
      missing.map((_, at) => `src/main.ts:${found.length + at + 1}:8 import/no-unresolved`).sort(),
    );
  },
);

test.concurrent(
  "import/ignore with a regular expression that is not written as a string: the package answers",
  async () => {
    const theirs = `{ create: context => ({ Program(node) { context.report({ node, message: "theirs" }); } }) }`;
    const config = (ignore: string) => `export default [
    { settings: { "import/ignore": [${ignore}] } },
    { plugins: { import: { meta: { name: "eslint-plugin-import" }, rules: { "no-cycle": ${theirs} } } }, rules: { "import/no-cycle": "error" } },
  ];`;
    const problems = async (ignore: string) =>
      (await lint({ "eslint.config.mjs": config(ignore), "a.js": "export {};\n" }, ["a.js"])).problems;
    expect(await problems(String.raw`/\.css$/`)).toEqual(["a.js:1:1 import/no-cycle"]);
    expect(await problems(String.raw`"\\.css$"`)).toEqual([]);
  },
);

describe.concurrent("a note says that a plugin that is built in is installed in an older version", () => {
  const notes = async (files: Record<string, string>, ...flags: string[]) =>
    (await lint({ "a.js": "export {};\n", ...files }, ["-f", "stylish", ...flags, "a.js"])).stderr
      .split("\n")
      .filter(it => it.startsWith("note: "));
  const flat = (plugins: Record<string, { name?: string; version?: string }>) => ({
    "eslint.config.mjs": `export default [{ plugins: ${JSON.stringify(
      Object.fromEntries(Object.entries(plugins).map(([prefix, meta]) => [prefix, { meta, rules: {} }])),
    )} }];`,
  });
  const typescript = (version?: string) =>
    flat({ "@typescript-eslint": { name: "@typescript-eslint/eslint-plugin", version } });

  test("by a minor version or more", async () => {
    expect(await notes(typescript("8.43.0"))).toEqual([
      "note: @typescript-eslint/eslint-plugin 8.43.0 is installed; bun lint follows 8.71.1.",
    ]);
    expect(await notes(typescript("7.18.0"))).toEqual([
      "note: @typescript-eslint/eslint-plugin 7.18.0 is installed; bun lint follows 8.71.1.",
    ]);
    expect(
      await notes(
        flat({
          n: { name: "eslint-plugin-n", version: "17.16.2" },
          import: { name: "eslint-plugin-import", version: "2.31.0" },
          "react-hooks": { name: "eslint-plugin-react-hooks", version: "5.2.0" },
          react: { name: "eslint-plugin-react", version: "7.33.2" },
        }),
      ),
    ).toEqual([
      "note: eslint-plugin-n 17.16.2 is installed; bun lint follows 18.4.1.",
      "note: eslint-plugin-import 2.31.0 is installed; bun lint follows 2.32.0.",
      "note: eslint-plugin-react-hooks 5.2.0 is installed; bun lint follows 7.1.1.",
      "note: eslint-plugin-react 7.33.2 is installed; bun lint follows 7.37.5.",
    ]);
  });

  test("not by less, not if it is later, not if it does not say, not for a plugin that runs in JavaScript", async () => {
    for (const version of ["8.71.0", "8.71.9", "8.72.0", "9.0.0", undefined, "next"]) {
      expect([version, await notes(typescript(version))]).toEqual([version, []]);
    }
    expect(await notes(flat({ ts: { name: "@typescript-eslint/eslint-plugin", version: "8.43.0" } }))).toEqual([]);
    expect(await notes(flat({ n: { name: "eslint-plugin-node", version: "11.1.0" } }))).toEqual([]);
  });

  test("not where nobody reads it", async () => {
    for (const flags of [["--quiet"], ["--silent"], ["-f", "json"], ["-f", "unix"]]) {
      expect([flags, await notes(typescript("8.43.0"), ...flags)]).toEqual([flags, []]);
    }
  });

  test("with an .eslintrc.json, from the package", async () => {
    const files = {
      ".eslintrc.json": rc({
        plugins: ["@typescript-eslint"],
        rules: { "@typescript-eslint/no-explicit-any": "error" },
      }),
      "node_modules/@typescript-eslint/eslint-plugin/package.json": `{ "name": "@typescript-eslint/eslint-plugin", "version": "5.62.0", "main": "index.js" }`,
      "node_modules/@typescript-eslint/eslint-plugin/index.js": `module.exports = { rules: {} };`,
    };
    expect(await notes(files)).toEqual([
      "note: @typescript-eslint/eslint-plugin 5.62.0 is installed; bun lint follows 8.71.1.",
    ]);
  });
});

describe.concurrent("every run evaluates an eslint.config.js", () => {
  const timeout = isDebug || isASAN ? 120_000 : 30_000;

  /** A project. `write` writes a file as if that had been a minute ago. `run`: the rules that report something. */
  function project(files: Record<string, string>) {
    const dir = tempDir("bun-lint-config-evaluated", { "node_modules/.keep": "", "a.js": code });
    const root = String(dir);
    const write = (name: string, text: string) => {
      mkdirSync(dirname(join(root, name)), { recursive: true });
      writeFileSync(join(root, name), text);
      const time = Date.now() / 1000 - 60;
      utimesSync(join(root, name), time, time);
    };
    for (const [name, text] of Object.entries(files)) write(name, text);
    const run = async (more: Record<string, string> = {}) => {
      await using proc = spawn({
        cmd: [...command, "--threads", "2", "-f", "unix", "a.js"],
        env: { ...env, SOME_TOKEN: undefined, ...more },
        cwd: root,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "ignore",
      });
      const stdout = await proc.stdout.text();
      await proc.exited;
      return [...stdout.matchAll(/ \[Error\/(.+)\]\r?$/gm)].map(it => it[1]).sort();
    };
    return { [Symbol.dispose]: () => dir[Symbol.dispose](), root, write, run };
  }

  test(
    "a package that it looks for is found as soon as it is installed",
    async () => {
      using it = project({
        "eslint.config.mjs": `let optional;
        try {
          optional = (await import("eslint-config-optional")).default;
        } catch {}
        export default [optional ?? { rules: { "no-var": "error" } }];`,
      });
      expect(await it.run()).toEqual(["no-var"]);
      it.write("node_modules/eslint-config-optional/package.json", `{ "name": "eslint-config-optional" }`);
      it.write("node_modules/eslint-config-optional/index.js", `module.exports = { rules: { eqeqeq: "error" } };`);
      expect(await it.run()).toEqual(["eqeqeq"]);
    },
    timeout,
  );

  test(
    "nothing is left in the project, whatever it reads",
    async () => {
      using it = project({
        "eslint.config.mjs": `import { readFileSync } from "node:fs";
        const rule = readFileSync(new URL("./rule.txt", import.meta.url), "utf8");
        export default [{ rules: { [rule]: process.env.SOME_TOKEN ? "error" : "off" } }];`,
        "rule.txt": "no-var",
      });
      expect(await it.run({ SOME_TOKEN: "synthetic" })).toEqual(["no-var"]);
      expect(await it.run()).toEqual([]);
      const left = readdirSync(it.root, { recursive: true }) as string[];
      expect(left.map(name => name.replaceAll(sep, "/")).sort()).toEqual([
        "a.js",
        "eslint.config.mjs",
        "node_modules",
        "node_modules/.keep",
        "rule.txt",
      ]);
    },
    timeout,
  );
});

describe.concurrent("what is built in is not loaded to evaluate an eslint.config.js", () => {
  const timeout = isDebug || isASAN ? 120_000 : 30_000;
  // The parts of typescript-eslint that count, in the shape that TypeScript gives them. Each large module notes that it is loaded.
  const notes = (directory: string) =>
    `require("node:fs").appendFileSync(__dirname + "/${"../".repeat(directory.split("/").length)}loaded.txt", "${directory}\\n");\n`;
  const interop = `var __importDefault = mod => (mod && mod.__esModule ? mod : { default: mod });\n`;
  const esModule = `Object.defineProperty(exports, "__esModule", { value: true });\n`;
  const reports = (message: string) =>
    `{ meta: { schema: [] }, create: context => ({ Program(node) { context.report({ node, message: "${message}" }); } }) }`;
  const [typescript, estree, rules] = [
    "node_modules/typescript/lib",
    "node_modules/@typescript-eslint/typescript-estree/dist",
    "node_modules/@typescript-eslint/eslint-plugin/dist/rules",
  ];
  const description = (version: string, main: string) => JSON.stringify({ version, main });
  const packages = (version: string) => ({
    "node_modules/typescript/package.json": description("5.9.3", "lib/typescript.js"),
    [`${typescript}/typescript.js`]: `${notes(typescript)}module.exports = { version: "5.9.3" };`,
    "node_modules/@typescript-eslint/typescript-estree/package.json": description(version, "dist/index.js"),
    [`${estree}/index.js`]: `${notes(estree)}${esModule}${interop}
      const typescript_1 = __importDefault(require("typescript"));
      exports.roots = [];
      exports.addCandidateTSConfigRootDir = root => ({ count: exports.roots.push(root) });
      exports.version = typescript_1.default.version;`,
    "node_modules/@typescript-eslint/eslint-plugin/package.json": description(version, "dist/index.js"),
    "node_modules/@typescript-eslint/eslint-plugin/dist/index.js": `${interop}
      const rules_1 = __importDefault(require("./rules"));
      const typescript_estree_1 = require("@typescript-eslint/typescript-estree");
      const plugin = { meta: { name: "@typescript-eslint/eslint-plugin", version: "${version}" }, rules: rules_1.default };
      module.exports = {
        plugin,
        estree: typescript_estree_1,
        configs: {
          get recommended() {
            const noted = (0, typescript_estree_1.addCandidateTSConfigRootDir)("here");
            // Nobody knows what another version makes of it.
            if (${!version.startsWith("8.")} && noted.count !== 1) throw new Error("not noted");
            return { plugins: { "@typescript-eslint": plugin }, rules: { "@typescript-eslint/no-explicit-any": "error" } };
          },
        },
      };`,
    [`${rules}/index.js`]: `${notes(rules)}${esModule}
      exports.default = { "no-explicit-any": ${reports("the package's")}, "not-built-in": ${reports("not built in")} };`,
    "a.ts": "export const a: any = 1;\n",
  });

  /** What is reported, and the large modules that were loaded. */
  async function run(config: string, version = "8.71.1") {
    using dir = tempDir("bun-lint-config-stand-ins", {
      ...packages(version),
      "eslint.config.mjs": `import all from "@typescript-eslint/eslint-plugin";\n${config}`,
    });
    await using proc = spawn({
      cmd: [...command, "--threads", "2", "-f", "unix", "a.ts"],
      env,
      cwd: String(dir),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const file = join(String(dir), "loaded.txt");
    const loaded = existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : [];
    const reported = [...stdout.matchAll(/a\.ts:(\d+:\d+): (.+) \[Error\/.+\]\r?$/gm)].map(it => `${it[1]} ${it[2]}`);
    return { reported, loaded: [...new Set(loaded)].sort(), failure: /^error: .*/m.exec(stderr)?.[0] };
  }
  const builtIn = "1:17 Unexpected any. Specify a different type.";
  const recommended = `export default [{ files: ["**/*.ts"], ...all.configs.recommended }];`;

  test(
    "a configuration that only names rules loads none",
    async () => {
      expect(await run(recommended)).toEqual({ reported: [builtIn], loaded: [], failure: undefined });
    },
    timeout,
  );

  test(
    "a rule that is not built in is the package's",
    async () => {
      const config = `export default [{ files: ["**/*.ts"], ...all.configs.recommended, rules: { "@typescript-eslint/not-built-in": "error" } }];`;
      expect(await run(config)).toMatchObject({ reported: ["1:1 not built in"], failure: undefined });
      const unknown = `export default [{ files: ["**/*.ts"], ...all.configs.recommended, rules: { "@typescript-eslint/nowhere": "error" } }];`;
      expect((await run(unknown)).failure).toContain(`Could not find "nowhere" in plugin "@typescript-eslint".`);
    },
    timeout,
  );

  test(
    "who touches a module gets the module",
    async () => {
      const expected = {
        names: ["no-explicit-any", "not-built-in"],
        has: [true, false],
        kind: "function",
        version: "5.9.3",
        roots: ["here"],
      };
      const config = `all.configs.recommended;
      const { rules } = all.plugin;
      const found = { names: Object.keys(rules), has: ["not-built-in" in rules, "nowhere" in rules] };
      Object.assign(found, { kind: typeof rules["not-built-in"].create, version: all.estree.version, roots: all.estree.roots });
      if (JSON.stringify(found) !== ${JSON.stringify(JSON.stringify(expected))}) throw new Error(JSON.stringify(found));
      export default [{ files: ["**/*.ts"], plugins: { "@typescript-eslint": all.plugin }, rules: { "@typescript-eslint/no-explicit-any": "error" } }];`;
      expect(await run(config)).toEqual({
        reported: [builtIn],
        loaded: [rules, estree, typescript].sort(),
        failure: undefined,
      });
    },
    timeout,
  );

  test(
    "another major version of the package is loaded as it is",
    async () => {
      expect(await run(recommended, "9.0.0")).toEqual({
        reported: [builtIn],
        loaded: [rules, estree, typescript].sort(),
        failure: undefined,
      });
    },
    timeout,
  );
});

describe.concurrent("an .oxlintrc.json", () => {
  test.each([
    [{ node: true }, [4, 5, 6, 7, 8]],
    [{ devtools: true, chai: true }, [1, 2, 3, 4, 5, 6, 7, 8]],
    [{ bun: true }, [1, 2, 4, 6, 7, 8]],
    [{ audioworklet: true }, [3, 4, 5, 7, 8]],
    [{ browser: true }, [4, 5, 6, 7, 8]],
    [{ jasmine: true }, [1, 2, 3, 4, 5, 6]],
  ])("the environments are oxlint's: %j", async (env, lines) => {
    const { problems } = await lint({
      ".oxlintrc.json": JSON.stringify({
        plugins: [],
        categories: { correctness: "off" },
        rules: { "no-undef": "error" },
        env,
      }),
      "a.js":
        "QuotaExceededError;\nTemporal;\nnavigator;\n$0;\nBun;\nregisterProcessor;\nexpect;\nthrowUnless;\nexport {};\n",
    });
    expect(problems).toEqual(lines.map(line => `a.js:${line}:1 no-undef`));
  });

  // Each row is what oxlint 1.87 does. It looks at the options of a rule that is off, too, and not at those of a rule whose plugin is
  // not on, by the name that is written.
  describe("a property that a rule of oxlint does not know", () => {
    const typo = { zz: 1 };
    const ofCase =
      "`unicorn/filename-case`:\n  unknown field `zz`, expected one of `cases`, `case`, `ignore`, `multipleFileExtensions`";
    const ofGetter = "`getter-return`:\n  unknown field `zz`, expected `allowImplicit`";
    const ofKey =
      "`react/jsx-key`:\n  unknown field `zz`, expected one of `checkKeyMustBeforeSpread`, `warnOnDuplicates`, `checkFragmentShorthand`";
    test.each<[name: string, config: object, refusal: string | undefined, flags?: string[]]>([
      ["a core rule", { rules: { "getter-return": ["error", typo] } }, ofGetter],
      ["one that is off", { rules: { "getter-return": ["off", typo] } }, ofGetter],
      ["under its other name", { rules: { "eslint/getter-return": ["error", typo] } }, ofGetter],
      ["without any plugin", { plugins: [], rules: { "getter-return": ["error", typo] } }, ofGetter],
      ["in an override", { overrides: [{ files: ["*.ts"], rules: { "getter-return": ["error", typo] } }] }, ofGetter],
      ["in a file that is extended", { extends: ["./extended.json"] }, ofGetter],
      [
        "two names",
        { rules: { yoda: ["error", "never", typo] } },
        "`yoda`:\n  unknown field `zz`, expected `exceptRange` or `onlyEquality`",
      ],
      ["the first of two", { rules: { "getter-return": ["error", { b: 1, a: 2 }] } }, ofGetter.replace("zz", "b")],
      ["a plugin that is on by default", { rules: { "unicorn/filename-case": ["error", typo] } }, ofCase],
      ["a plugin of the file", { plugins: ["react"], rules: { "react/jsx-key": ["error", typo] } }, ofKey],
      ["a plugin of a flag", { rules: { "react/jsx-key": ["error", typo] } }, ofKey, ["--react-plugin"]],
      [
        "a plugin of the override",
        { overrides: [{ files: ["*.ts"], plugins: ["react"], rules: { "react/jsx-key": ["error", typo] } }] },
        ofKey,
      ],
      [
        "a plugin of the file, in an override",
        { plugins: ["react"], overrides: [{ files: ["*.ts"], rules: { "react/jsx-key": ["error", typo] } }] },
        ofKey,
      ],
      ["a name that it knows", { rules: { "getter-return": ["error", { allowImplicit: true }] } }, undefined],
      ["one option more than the rule has", { rules: { "getter-return": ["error", {}, typo] } }, undefined],
      [
        "a plugin that is not on",
        { plugins: ["react"], rules: { "unicorn/filename-case": ["error", typo] } },
        undefined,
      ],
      [
        "a plugin that a flag turns off",
        { rules: { "unicorn/filename-case": ["error", typo] } },
        undefined,
        ["--disable-unicorn-plugin"],
      ],
      [
        "a plugin that is only in an override",
        { rules: { "react/jsx-key": ["error", typo] }, overrides: [{ files: ["*.ts"], plugins: ["react"] }] },
        undefined,
      ],
      [
        "a core rule under the name of a plugin that is not on",
        { plugins: [], rules: { "@typescript-eslint/no-unused-vars": ["error", typo] } },
        undefined,
      ],
    ])("%s", async (_, config, refusal, flags = []) => {
      const files = {
        ".oxlintrc.json": JSON.stringify({ categories: { correctness: "off" }, ...config }),
        "extended.json": JSON.stringify({ rules: { "getter-return": ["error", typo] } }),
        "a.js": "export {};\n",
      };
      // As oxlint: on standard output.
      const { stdout, exitCode } = await lint(files, [...flags, "a.js"]);
      if (refusal) expect(stdout).toContain(`Invalid configuration for rule ${refusal}`);
      else expect(stdout).not.toContain("unknown field");
      expect(exitCode).toBe(refusal ? 1 : 0);
    });
  });

  // oxlint 1.87 takes each, and each is valid by its own configuration_schema.json. The schemas of ESLint's rules refuse them.
  test("options that oxlint takes and the schema of ESLint's rule does not", async () => {
    const sets: [rule: string, options: unknown[]][] = [
      ["max-classes-per-file", [0]],
      ["max-lines-per-function", [0]],
      ["no-param-reassign", [{}]],
      ["prefer-destructuring", [{}]],
      ["capitalized-comments", ["always", {}]],
      ["curly", ["all", "consistent"]],
      ["init-declarations", ["always", {}]],
      ["prefer-destructuring", [{}, {}]],
      ["no-warning-comments", [{ "decoration": ["^a$"] }]],
      ["one-var", [{}]],
      ["max-statements", [{ "ignoreTopLevelFunctions": true }]],
      ["no-warning-comments", [{ "decoration": [""] }]],
      ["max-statements", [{ "ignoreTopLevelFunctions": false }]],
      ["no-warning-comments", [{ "decoration": ["a", "^a$"] }]],
      ["max-classes-per-file", [{ "max": 0 }]],
      ["no-unused-vars", [{ "argsIgnorePattern": null }]],
      ["max-classes-per-file", [{ "ignoreExpressions": true, "max": 0 }]],
      ["max-statements", [{ "ignoreTopLevelFunctions": true, "max": 0 }]],
      ["no-magic-numbers", [{ "ignore": ["a"] }]],
      ["typescript/prefer-nullish-coalescing", [{ "ignorePrimitives": false }]],
      ["no-magic-numbers", [{ "ignore": ["^a$"] }]],
      ["no-magic-numbers", [{ "ignore": [""] }]],
      ["no-unused-vars", [{ "caughtErrorsIgnorePattern": null }]],
      ["init-declarations", ["always", { "ignoreForLoopInit": true }]],
      ["no-unused-vars", [{ "destructuredArrayIgnorePattern": null }]],
      ["init-declarations", ["always", { "ignoreForLoopInit": false }]],
      ["sort-keys", ["desc", { "minKeys": 0 }]],
      ["sort-keys", ["desc", { "minKeys": 1 }]],
      [
        "sort-keys",
        ["desc", { "allowLineSeparatedGroups": true, "caseSensitive": true, "minKeys": 0, "natural": true }],
      ],
      ["no-unused-vars", [{ "varsIgnorePattern": null }]],
      ["no-warning-comments", [{ "decoration": ["zz-nonsense"] }]],
      [
        "no-unused-vars",
        [
          {
            "args": "after-used",
            "argsIgnorePattern": null,
            "caughtErrors": "all",
            "caughtErrorsIgnorePattern": null,
            "destructuredArrayIgnorePattern": null,
            "fix": {},
            "ignoreClassWithStaticInitBlock": true,
            "ignoreRestSiblings": true,
            "ignoreUsingDeclarations": true,
            "reportUsedIgnorePattern": true,
            "reportVarsOnlyUsedAsTypes": true,
            "vars": "all",
            "varsIgnorePattern": null,
          },
        ],
      ],
      ["no-restricted-imports", ["import1", {}]],
      ["arrow-body-style", ["never", {}]],
      ["arrow-body-style", ["always", {}]],
      ["no-restricted-imports", ["fs", "crypto ", "stream", "os", {}]],
      ["no-magic-numbers", [{ "ignore": ["zz-nonsense"] }]],
      ["no-restricted-imports", ["fs", {}, "stream", "os"]],
      ["no-restricted-imports", ["fs", "crypto ", {}, "os"]],
      ["prefer-destructuring", [{}, { "enforceForDeclarationWithTypeAnnotation": true }]],
      ["prefer-destructuring", [{}, { "enforceForDeclarationWithTypeAnnotation": false }]],
      ["prefer-destructuring", [{}, { "enforceForRenamedProperties": true }]],
      ["prefer-destructuring", [{}, { "enforceForRenamedProperties": false }]],
      [
        "prefer-destructuring",
        [{}, { "enforceForDeclarationWithTypeAnnotation": true, "enforceForRenamedProperties": true }],
      ],
      ["no-restricted-imports", ["fs", "crypto ", "stream", {}]],
      ["no-restricted-imports", [{ "name": "foo", "message": 'Please import from "bar" instead.' }, {}]],
      ["no-restricted-imports", ["foo", { "name": "bar", "message": 'Please import from "baz" instead.' }, "baz", {}]],
      ["capitalized-comments", ["never", {}]],
      ["no-restricted-imports", ["foo", {}, "baz"]],
    ];
    // A directory for each: one that is refused ends the run.
    const files: Record<string, string> = { ".oxlintrc.json": "{}" };
    sets.forEach(([rule, options], i) => {
      const rules = { [rule]: ["error", ...options] };
      files[`d${i}/.oxlintrc.json`] = JSON.stringify({ categories: { correctness: "off" }, rules });
      files[`d${i}/a.js`] = "export {};\n";
    });
    const { stderr, exitCode } = await lint(files);
    expect(stderr).not.toContain(`Key "rules"`);
    expect(exitCode).toBe(0);
  });

  // oxlint 1.87 takes both. The schemas of eslint-plugin-import have neither.
  test.each([
    { "import/max-dependencies": ["error", 2] },
    { "import/consistent-type-specifier-style": ["error", "prefer-top-level-if-only-type-imports"] },
  ])("the schema that a rule of a plugin has for ESLint refuses nothing: %j", async rules => {
    const { stderr, exitCode } = await lint({
      ".oxlintrc.json": JSON.stringify({ plugins: ["import"], categories: { correctness: "off" }, rules }),
      "a.js": "export {};\n",
    });
    expect(stderr).not.toContain(`Key "rules"`);
    expect(exitCode).toBe(0);
  });

  test("only comments that disable rules configure anything", async () => {
    const { problems, exitCode } = await lint({
      ".oxlintrc.json": JSON.stringify({
        categories: { correctness: "off" },
        rules: { "no-var": "error", "no-undef": "error" },
      }),
      "env.js": "/* eslint-env mocha */\n",
      "rules.js": '/* eslint no-var: "off", no-debugger: "error" */\nvar a = 1;\ndebugger;\n',
      "global.js": "/* global b */\nb;\n",
      "broken.js": "/* eslint no-var: [ */\n/* globals c: nonsense */\n",
      "disabled.js": "// eslint-disable-next-line no-var\nvar d = 1;\n",
    });
    expect(problems).toEqual(["global.js:2:1 no-undef", "rules.js:2:1 no-var"]);
    expect(exitCode).toBe(1);
  });

  test.each([
    ["base.json", "base.json"],
    ["configs/base.json", "configs/base.json"],
    ["./base", "base"],
    [".base", ".base"],
  ])("`extends` %j is a path", async (name, file) => {
    const { problems, exitCode } = await lint({
      ".oxlintrc.json": JSON.stringify({ categories: { correctness: "off" }, extends: [name] }),
      [file]: JSON.stringify(noVar),
      "a.js": code,
    });
    expect(problems).toEqual(["a.js:1:1 no-var"]);
    expect(exitCode).toBe(1);
  });

  test.each(["nowhere.json", "./nowhere.json", "shared", "@scope/shared", "configs/base"])(
    "`extends` %j, which is no file or the name of a package, is an error",
    async name => {
      const { problems, stdout, exitCode } = await lint({
        ".oxlintrc.json": JSON.stringify({ categories: { correctness: "off" }, extends: [name] }),
        "node_modules/shared/index.json": JSON.stringify(noVar),
        "configs/base": JSON.stringify(noVar),
        "a.js": code,
      });
      expect(problems).toEqual([]);
      expect(stdout).toContain("<dir>/.oxlintrc.json");
      expect(stdout).toContain(JSON.stringify(name));
      expect(exitCode).toBe(1);
    },
  );

  test("`extends` of an oxlint.config.ts has objects that it has imported", async () => {
    const { problems, exitCode } = await lint(
      {
        "oxlint.config.ts": `import base from "./base.ts";
          export default {
            categories: { correctness: "off" },
            extends: [base, { rules: { eqeqeq: "error" } }],
            rules: { "no-debugger": "error" },
          };`,
        "base.ts": `export default { rules: { "no-var": "error", "no-debugger": "off" } };`,
        "a.js": code,
      },
      ["a.js"],
    );
    expect(problems).toEqual(["a.js:1:1 no-var", "a.js:2:13 no-debugger", "a.js:2:7 eqeqeq"]);
    expect(exitCode).toBe(1);
  });

  test("`options` of the configuration of the working directory are for the whole run", async () => {
    const rules = { "typescript/no-unnecessary-type-assertion": "error" };
    const typed = 'const s: string = "a";\nexport const t = s as string;\n';
    const { problems } = await lint({
      ".oxlintrc.json": JSON.stringify({ categories: { correctness: "off" }, options: { typeAware: true }, rules }),
      "sub/.oxlintrc.json": JSON.stringify({ categories: { correctness: "off" }, rules }),
      "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [] } }),
      "a.ts": typed,
      "sub/b.ts": typed,
    });
    expect(problems).toEqual([
      "a.ts:2:18 @typescript-eslint/no-unnecessary-type-assertion",
      "sub/b.ts:2:18 @typescript-eslint/no-unnecessary-type-assertion",
    ]);
  });

  test("braces in `ignorePatterns` are alternatives", async () => {
    const { problems } = await lint({
      ".oxlintrc.json": JSON.stringify({
        ...noVar,
        categories: { correctness: "off" },
        ignorePatterns: ["*.config.{js,ts}"],
      }),
      "a.js": code,
      "vite.config.ts": code,
      "sub/x.config.js": code,
    });
    expect(problems).toEqual(["a.js:1:1 no-var"]);
  });

  test("`files` of `overrides` do not make it lint a file", async () => {
    const { problems, exitCode } = await lint({
      ".oxlintrc.json": JSON.stringify({
        ...noVar,
        categories: { correctness: "off" },
        overrides: [{ files: ["**/cli.*"], rules: { "no-var": "off", eqeqeq: "error" } }],
      }),
      "a.js": code,
      "cli.js": code,
      "docs/cli.md": "# Not JavaScript\n",
    });
    expect(problems).toEqual(["a.js:1:1 no-var", "cli.js:2:7 eqeqeq"]);
    expect(exitCode).toBe(1);
  });

  // Notepad and `Out-File -Encoding utf8` of Windows PowerShell write the mark. Git and oxlint 1.87.0 pass over it.
  test.each([
    ["\\r\\n", (text: string) => text.replaceAll("\n", "\r\n")],
    ["a byte order mark", (text: string) => "\uFEFF" + text],
    ["both", (text: string) => "\uFEFF" + text.replaceAll("\n", "\r\n")],
  ])("%s in a file with patterns to ignore", async (_, written) => {
    const files = {
      ".oxlintrc.json": JSON.stringify({ ...noVar, categories: { correctness: "off" } }),
      "dist/a.js": code,
      "b.gen.js": code,
      "keep.gen.js": code,
      "sub/c.js": code,
      "d.js": code,
    };
    const patterns = written("dist\n# a comment\n\n*.gen.js\n!keep.gen.js\nsub/\n");
    const results = await Promise.all([
      lint({ ...files, ".gitignore": patterns }),
      lint({ ...files, ".eslintignore": patterns }),
      lint({ ...files, "mine": patterns }, ["--ignore-path", "mine", "."]),
    ]);
    expect(results.map(it => it.problems)).toEqual(results.map(() => ["d.js:1:1 no-var", "keep.gen.js:1:1 no-var"]));
  });

  // What oxlint 1.87.0 reports. A junction needs no privilege on Windows. Elsewhere it is a link like any other.
  test("a link to a directory is followed, unless it leads to a directory on the way from where the search starts", async () => {
    const files = {
      ".oxlintrc.json": JSON.stringify({ ...noVar, categories: { correctness: "off" } }),
      "project/pkg/a.js": code,
      "project/elsewhere/b.js": code,
    };
    const before = (dir: string) => {
      const project = join(dir, "project");
      symlinkSync(project, join(project, "pkg", "up"), "junction");
      symlinkSync(join(project, "elsewhere"), join(project, "pkg", "linked"), "junction");
      symlinkSync(project, join(dir, "via"), "junction");
    };
    const [straight, throughLink, all] = await Promise.all(
      ["project/pkg", "via/pkg", "."].map(where => lint(files, [where], { before })),
    );
    const below = (pkg: string) =>
      ["a.js", "linked/b.js", "up/elsewhere/b.js", "up/pkg/a.js", "up/pkg/linked/b.js"].map(
        it => `${pkg}/${it}:1:1 no-var`,
      );
    expect(straight.problems).toEqual(below("project/pkg"));
    expect(throughLink.problems).toEqual(below("via/pkg"));
    expect(all.problems).toEqual(
      ["project", "via"].flatMap(it =>
        ["elsewhere/b.js", "pkg/a.js", "pkg/linked/b.js"].map(file => `${it}/${file}:1:1 no-var`),
      ),
    );
  });

  // With two such links the walk doubled at each level, and did not end.
  test("links that lead back up, to the directory itself, and between two packages", async () => {
    const files = {
      ".oxlintrc.json": JSON.stringify({ ...noVar, categories: { correctness: "off" } }),
      "real/a/x.js": code,
      "packages/a/index.js": code,
      "packages/a/node_modules/.keep": "",
      "packages/b/index.js": code,
      "packages/b/node_modules/.keep": "",
    };
    const before = (dir: string) => {
      symlinkSync(join(dir, "real"), join(dir, "linked"), "junction");
      symlinkSync(join(dir, "real"), join(dir, "real", "a", "up"), "junction");
      symlinkSync(join(dir, "real"), join(dir, "real", "a", "up-too"), "junction");
      symlinkSync(join(dir, "real", "a"), join(dir, "real", "a", "self"), "junction");
      symlinkSync(join(dir, "packages", "b"), join(dir, "packages", "a", "node_modules", "b"), "junction");
      symlinkSync(join(dir, "packages", "a"), join(dir, "packages", "b", "node_modules", "a"), "junction");
    };
    const [direct, throughLink, packages] = await Promise.all(
      ["real", "linked", "packages"].map(where => lint(files, [where], { before })),
    );
    expect(direct.problems).toEqual(["real/a/x.js:1:1 no-var"]);
    expect(throughLink.problems).toEqual(["linked/a/x.js:1:1 no-var"]);
    expect(packages.problems).toEqual(
      ["a/index.js", "a/node_modules/b/index.js", "b/index.js", "b/node_modules/a/index.js"].map(
        it => `packages/${it}:1:1 no-var`,
      ),
    );
  });

  test("a path that is longer than any system takes is not there", async () => {
    const files = { ".oxlintrc.json": JSON.stringify({ ...noVar, categories: { correctness: "off" } }), "a.js": code };
    // Linux takes 4,096 bytes, macOS 1,024, Windows 32,767 characters, which is also all that its command line has.
    const long = Buffer.alloc(isWindows ? 30_000 : 40_000, "a/").toString() + "a.js";
    const { problems, exitCode } = await lint(files, [long, "a.js"]);
    expect(problems).toEqual(["a.js:1:1 no-var"]);
    expect(exitCode).toBe(1);
  });

  test("`defineConfig` of the package oxlint, which need not be installed", async () => {
    const { problems, exitCode } = await lint(
      {
        "oxlint.config.ts": `import { defineConfig } from "oxlint";
          export default defineConfig({ categories: { correctness: "off" }, rules: { "no-var": "error" } });`,
        "a.js": code,
      },
      ["a.js"],
    );
    expect(problems).toEqual(["a.js:1:1 no-var"]);
    expect(exitCode).toBe(1);
  });

  test("the package oxlint that is installed is the one that is imported", async () => {
    const { problems } = await lint(
      {
        "node_modules/oxlint/package.json": JSON.stringify({ name: "oxlint", main: "index.js" }),
        "node_modules/oxlint/index.js": `exports.defineConfig = config => ({ ...config, rules: { eqeqeq: "error" } });`,
        "oxlint.config.ts": `import { defineConfig } from "oxlint";
          export default defineConfig({ categories: { correctness: "off" }, rules: { "no-var": "error" } });`,
        "a.js": code,
      },
      ["a.js"],
    );
    expect(problems).toEqual(["a.js:2:7 eqeqeq"]);
  });

  test("a `!` in `ignorePatterns` takes a file out of a directory that is ignored", async () => {
    const { problems } = await lint({
      ".oxlintrc.json": JSON.stringify({
        ...noVar,
        categories: { correctness: "off" },
        ignorePatterns: ["src/**/*", "!src/deep/keep.js", "!src/top.js", "lib/", "!lib/keep.js"],
      }),
      "a.js": code,
      "src/top.js": code,
      "src/gone.js": code,
      "src/deep/keep.js": code,
      "src/deep/gone.js": code,
      "src/other/gone.js": code,
      "lib/keep.js": code,
      "lib/gone.js": code,
    });
    expect(problems).toEqual([
      "a.js:1:1 no-var",
      "lib/keep.js:1:1 no-var",
      "src/deep/keep.js:1:1 no-var",
      "src/top.js:1:1 no-var",
    ]);
  });

  test("a configuration file in a directory that one further up ignores counts", async () => {
    const own = JSON.stringify({ ...noVar, categories: { correctness: "off" } });
    const files = {
      ".oxlintrc.json": JSON.stringify({ ...JSON.parse(own), ignorePatterns: ["sub/", "other/", "third/**"] }),
      "a.js": code,
      "sub/.oxlintrc.json": own,
      "sub/b.js": code,
      "sub/deep/c.js": code,
      "other/d.js": code,
      "other/inner/.oxlintrc.json": own,
      "other/inner/e.js": code,
      "third/f.js": code,
      "third/x/.oxlintrc.json": JSON.stringify({ ...JSON.parse(own), ignorePatterns: ["y"] }),
      "third/x/g.js": code,
      "third/x/y/h.js": code,
    };
    expect((await lint(files)).problems).toEqual([
      "a.js:1:1 no-var",
      "other/inner/e.js:1:1 no-var",
      "sub/b.js:1:1 no-var",
      "sub/deep/c.js:1:1 no-var",
      "third/x/g.js:1:1 no-var",
    ]);
    expect((await lint(files, ["other"])).problems).toEqual(["other/inner/e.js:1:1 no-var"]);
    expect((await lint(files, ["--disable-nested-config"])).problems).toEqual(["a.js:1:1 no-var"]);
  });

  test("--ignore-pattern is for the whole run", async () => {
    const own = JSON.stringify({ ...noVar, categories: { correctness: "off" } });
    const files = {
      ".oxlintrc.json": own,
      "a.js": code,
      "src/b.js": code,
      "src/nested/.oxlintrc.json": own,
      "src/nested/c.js": code,
    };
    expect((await lint(files, ["--ignore-pattern=src/**"])).problems).toEqual(["a.js:1:1 no-var"]);
    expect((await lint(files, ["--ignore-pattern", "c.js"])).problems).toEqual([
      "a.js:1:1 no-var",
      "src/b.js:1:1 no-var",
    ]);
  });

  test("`files` of `overrides` have no `?(a|b)`", async () => {
    const { problems } = await lint({
      ".oxlintrc.json": JSON.stringify({
        ...noVar,
        categories: { correctness: "off" },
        overrides: [{ files: ["**/*.?([cm])js", "**/*.[jt]s?(x)"], rules: { "no-var": "off" } }],
      }),
      "a.js": code,
      "b.mjs": code,
    });
    expect(problems).toEqual(["a.js:1:1 no-var", "b.mjs:1:1 no-var"]);
  });

  test.each([
    [{ nonsense: 1 }, "unknown field `nonsense`, expected one of `$schema`, `plugins`,"],
    [{ root: true }, "unknown field `root`"],
    [
      { overrides: [{ files: ["*.js"], settings: {} }] },
      "unknown field `settings`, expected one of `files`, `excludeFiles`,",
    ],
    [{ overrides: [{ rules: {} }] }, "missing field `files`"],
    [{ overrides: [{ files: "*.js" }] }, ", expected a sequence"],
    [
      { overrides: [{ files: ["src/*.{js,ts"] }] },
      "Invalid glob pattern `src/*.{js,ts`: unclosed brace expansion at byte 6; missing '}'",
    ],
    [{ overrides: [{ files: ["a{b{c}"] }] }, "unclosed brace expansion at byte 1;"],
    [{ overrides: [{ files: ["*.js"], excludeFiles: ["{a,[}"] }] }, "unclosed character class at byte 3; missing ']'"],
    [{ overrides: [{ files: ["[!]"] }] }, "unclosed character class at byte 0;"],
    [{ overrides: [{ files: ["x\\"] }] }, "trailing backslash at byte 1 has no character to escape"],
    [{ options: { nonsense: 1 } }, "unknown field `nonsense`, expected one of `typeAware`,"],
    [{ options: { maxWarnings: -1 } }, "invalid value: integer `-1`, expected usize"],
    [{ options: { typeAware: "yes" } }, ", expected a boolean"],
    [{ categories: { nonsense: "error" } }, "unknown variant `nonsense`, expected one of `correctness`,"],
    [{ categories: [] }, "invalid type: sequence, expected a map"],
    [{ env: { browser: "yes" } }, ", expected a boolean"],
    [{ ignorePatterns: "a.js" }, ", expected a sequence"],
    [{ extends: "./base.json" }, ", expected a sequence"],
    [{ extends: ["eslint:recommended"] }, 'Unsupported named config "eslint:recommended" in extends.'],
    [{ plugins: "react" }, ", expected a sequence"],
    [{ rules: [] }, "invalid type: sequence, expected Record<string, SeverityConf"],
    [{ settings: 1 }, "invalid type: integer `1`, expected struct WellKnownOxlintSettings"],
    [{ $schema: 1 }, "invalid type: integer `1`, expected a string"],
  ])("%j is refused, as by oxlint", async (config, why) => {
    const { problems, stdout, exitCode } = await lint({ ".oxlintrc.json": JSON.stringify(config), "a.js": code });
    expect(problems).toEqual([]);
    expect(stdout).toContain("Cannot use the configuration file <dir>/.oxlintrc.json:\n");
    expect(stdout).toContain(why);
    expect(exitCode).toBe(1);
  });

  test("patterns of `overrides` that are closed, or do not open anything", async () => {
    const files = ["[]a]", "[!]]", "{[}]}", "\\{a", "a}", "{]}", "[{]", "a{b{c}}"];
    const config = { ...noVar, categories: { correctness: "off" }, overrides: [{ files, rules: {} }] };
    const { problems } = await lint({ ".oxlintrc.json": JSON.stringify(config), "a.js": code });
    expect(problems).toEqual(["a.js:1:1 no-var"]);
  });

  test("a plugin in JavaScript cannot have the name of one that is built in", async () => {
    const plugin = `export default { meta: { name: "unicorn" }, rules: {} };`;
    const byItself = await lint(
      { ".oxlintrc.json": JSON.stringify({ jsPlugins: ["./plugin.js"] }), "plugin.js": plugin, "a.js": code },
      ["a.js"],
    );
    expect(byItself.stdout).toContain("Plugin name 'unicorn' is reserved, and cannot be used for JS plugins.");
    expect(byItself.exitCode).toBe(1);
    const jsPlugins = [{ name: "react", specifier: "./plugin.js" }];
    const byAlias = await lint({ ".oxlintrc.json": JSON.stringify({ jsPlugins }), "plugin.js": plugin, "a.js": code }, [
      "a.js",
    ]);
    expect(byAlias.stdout).toContain(`"jsPlugins": [{ "name": "react-js", "specifier": "eslint-plugin-react" }]`);
    expect(byAlias.exitCode).toBe(1);
  });

  test("oxlint.config.mts is read, and two files of oxlint in one directory are refused", async () => {
    const program = `export default { categories: { correctness: "off" }, rules: { "no-var": "error" } };`;
    expect((await lint({ "oxlint.config.mts": program, "a.js": code }, ["a.js"])).problems).toEqual([
      "a.js:1:1 no-var",
    ]);
    const two = await lint({ ".oxlintrc.json": "{}", "oxlint.config.ts": program, "a.js": code }, ["a.js"]);
    expect(two.stdout).toContain("Both '.oxlintrc.json' and 'oxlint.config.ts' found in <dir>.");
    expect(two.exitCode).toBe(1);
    const below = await lint({
      ".oxlintrc.json": "{}",
      "sub/.oxlintrc.jsonc": "{}",
      "sub/oxlint.config.mts": program,
      "sub/a.js": code,
    });
    expect(below.stdout).toContain("Both '.oxlintrc.jsonc' and 'oxlint.config.mts' found in <dir>/sub.");
    expect(below.exitCode).toBe(1);
  });

  test("an override for no files is not refused", async () => {
    const config = {
      ...noVar,
      categories: { correctness: "off" },
      overrides: [{ files: [], rules: { "no-var": "off" } }],
    };
    const { problems } = await lint({ ".oxlintrc.json": JSON.stringify(config), "a.js": code });
    expect(problems).toEqual(["a.js:1:1 no-var"]);
  });

  test("`options` are refused further down, and count in what is extended", async () => {
    const warns = { categories: { correctness: "off" }, rules: { "no-var": "warn" } };
    const nested = await lint({
      ".oxlintrc.json": JSON.stringify(warns),
      "sub/.oxlintrc.json": JSON.stringify({ ...warns, options: { denyWarnings: true } }),
      "sub/a.js": code,
    });
    expect(nested.stdout).toContain(
      "Cannot use the configuration file <dir>/sub/.oxlintrc.json:\nThe `options.denyWarnings` option is only supported in the root config.",
    );
    expect(nested.exitCode).toBe(1);
    const extended = await lint({
      ".oxlintrc.json": JSON.stringify({ ...warns, extends: ["./base.json"] }),
      "base.json": JSON.stringify({ options: { denyWarnings: true } }),
      "a.js": code,
    });
    expect(extended.problems).toEqual(["a.js:1:1 no-var"]);
    expect(extended.exitCode).toBe(1);
  });

  // What oxlint 1.87 does with each.
  test("files that each extend the next one twice are not read 2^n times", async () => {
    const files: Record<string, string> = { "a.js": code, "d22.json": "{}" };
    for (let i = 0; i < 22; i++)
      files[i ? `d${i}.json` : ".oxlintrc.json"] = `{"extends":["./d${i + 1}.json","./d${i + 1}.json"]}`;
    const { stdout, stderr, exitCode } = await lint(files, ["a.js"]);
    expect(stdout + stderr).toContain('Too many files in "extends".');
    expect(exitCode).toBe(1);
  });

  test("`plugins` of an override count for that override alone", async () => {
    const files = Object.fromEntries(
      ["a.ts", "a.test.ts", "a.spec.test.ts"].map(name => [name, "beforeEach(() => {});\ntest('a', () => {});\n"]),
    );
    const ofVitest = async (config: object) => {
      const oxlintrc = JSON.stringify({ categories: { correctness: "off" }, ...config });
      const { problems } = await lint({ ...files, ".oxlintrc.json": oxlintrc });
      return problems.filter(it => it.includes(" vitest/"));
    };
    const [noHooks, timeout] = [{ "vitest/no-hooks": "error" }, "vitest/require-test-timeout"];
    const tests = { files: ["**/*.test.ts"], plugins: ["vitest"] };
    const specs = { files: ["**/*.spec.test.ts"] };
    const restriction = { categories: { correctness: "off", restriction: "warn" } };
    const hooks = ["a.spec.test.ts:1:1 vitest/no-hooks", "a.test.ts:1:1 vitest/no-hooks"];
    const timeouts = [`a.spec.test.ts:2:1 ${timeout}`, `a.test.ts:2:1 ${timeout}`];
    expect(
      await Promise.all([
        // Its own rules can name them. Those of the file and of another override cannot.
        ofVitest({ plugins: [], overrides: [{ ...tests, rules: noHooks }] }),
        ofVitest({ plugins: [], rules: noHooks, overrides: [tests] }),
        ofVitest({ plugins: [], overrides: [tests, { ...specs, rules: noHooks }] }),
        // The categories turn their rules on where it applies, unless it names all the plugins that are on there.
        ofVitest({ plugins: ["unicorn"], ...restriction, overrides: [tests] }),
        ofVitest({ ...restriction, overrides: [tests] }),
        ofVitest({ plugins: [], ...restriction, overrides: [tests] }),
        ofVitest({ plugins: ["unicorn"], ...restriction, overrides: [{ ...tests, rules: { [timeout]: "off" } }] }),
        ofVitest({ plugins: ["unicorn"], ...restriction, rules: { [timeout]: "off" }, overrides: [tests] }),
        ofVitest({
          plugins: ["unicorn"],
          ...restriction,
          overrides: [tests, { ...specs, rules: { [timeout]: "off" } }],
        }),
      ]),
    ).toEqual([hooks, [], [], timeouts, timeouts, [], [], timeouts, timeouts]);
    // What the command line says about a category is not about them.
    const oxlintrc = JSON.stringify({ plugins: ["unicorn"], categories: { correctness: "off" }, overrides: [tests] });
    const { problems } = await lint({ ...files, ".oxlintrc.json": oxlintrc }, [".", "-W", "restriction"]);
    expect(problems.filter(it => it.includes(" vitest/"))).toEqual([]);
  });

  // What oxlint 1.87 does with each.
  test("`categories` say nothing about the plugins of overrides that each name all the plugins of the file", async () => {
    const code = 'it("a", () => {\n  if (x) expect(1).toBe(1);\n});\n';
    const reported = async (config: object, extended: Record<string, object> = {}) => {
      const files = Object.entries({ ".oxlintrc.json": config, ...extended }).map(([name, it]) => [
        name,
        JSON.stringify(it),
      ]);
      const { problems } = await lint({ "__tests__/a.spec.ts": code, ...Object.fromEntries(files) });
      const rules = problems.map(it => it.split(" ")[1].split("/"));
      return rules.filter(it => it[1] === "no-conditional-expect").map(it => it[0]);
    };
    const correctness = { categories: { correctness: "error" } };
    const typescript = { ...correctness, plugins: ["typescript"] };
    const tests = (plugins: string[], files = "__tests__/**") => ({ files: [files], plugins, rules: {} });
    const named = { "jest/no-conditional-expect": "warn" };
    expect(
      await Promise.all([
        reported({ ...typescript, overrides: [tests(["typescript", "jest", "vitest"])] }),
        reported({ ...typescript, overrides: [tests(["jest", "vitest"])] }),
        // All that apply count, and only those.
        reported({ ...typescript, overrides: [tests(["typescript", "jest"]), tests(["typescript", "vitest"])] }),
        reported({
          ...typescript,
          overrides: [tests(["typescript", "jest"]), tests(["typescript", "vitest"], "src/**")],
        }),
        reported({ ...correctness, plugins: [], overrides: [tests(["jest"]), tests(["vitest"])] }),
        // What it names itself is on.
        reported({ ...typescript, overrides: [{ ...tests(["typescript", "jest"]), rules: named }] }),
        // A file without `plugins` that is extended adds typescript, unicorn and oxc.
        reported(
          { ...typescript, extends: ["./overrides.json"] },
          { "overrides.json": { overrides: [tests(["typescript", "jest", "vitest"])] } },
        ),
        reported(
          { ...typescript, extends: ["./overrides.json"] },
          { "overrides.json": { overrides: [tests(["typescript", "unicorn", "oxc", "jest", "vitest"])] } },
        ),
      ]),
    ).toEqual([[], ["jest", "vitest"], ["jest", "vitest"], [], ["jest", "vitest"], ["jest"], ["jest", "vitest"], []]);
  });

  test("`options.respectEslintDisableDirectives: false`: only comments of oxlint count", async () => {
    const config = { categories: { correctness: "off" }, rules: { "no-debugger": "error" } };
    const files = {
      "a.js":
        "// eslint-disable-next-line no-debugger\ndebugger;\n// oxlint-disable-next-line no-debugger\ndebugger;\n",
    };
    const off = { ...config, options: { respectEslintDisableDirectives: false } };
    expect((await lint({ ...files, ".oxlintrc.json": JSON.stringify(off) })).problems).toEqual([
      "a.js:2:1 no-debugger",
    ]);
    expect((await lint({ ...files, ".oxlintrc.json": JSON.stringify(config) })).problems).toEqual([]);
    // Also one that only oxlint takes for a directive: ESLint wants `eslint-enable` in a block comment.
    const enables = { "a.js": "// eslint-enable\n// oxlint-enable\n", ".oxlintrc.json": JSON.stringify(off) };
    expect((await lint(enables, [".", "--report-unused-disable-directives"])).problems).toEqual(["a.js:2:3 -"]);
  });

  test("a comment that disables a rule which does not run on the file is unused, as for oxlint", async () => {
    const { problems } = await lint(
      {
        ".oxlintrc.json": JSON.stringify({ categories: { correctness: "off" }, rules: { "no-unused-vars": "error" } }),
        "a.vue": "<script>\n// eslint-disable-next-line no-unused-vars\nconst a = 1;\n</script>\n",
        "a.js": "// eslint-disable-next-line no-unused-vars\nconst a = 1;\n",
      },
      [".", "--report-unused-disable-directives"],
    );
    expect(problems).toEqual(["a.vue:2:1 -"]);
  });

  test("the rules that a category turns on and that do not exist here are named, in a warning", async () => {
    const config = {
      plugins: ["unicorn", "oxc", "react", "jsx-a11y", "vue", "jest"],
      categories: { correctness: "warn" },
    };
    const named = (stderr: string) =>
      /rules that the categories turn on do not exist here yet and did not run: (.*)/.exec(stderr)?.[1].split(", ") ??
      [];
    const { stderr, exitCode } = await lint({ ".oxlintrc.json": JSON.stringify(config), "a.js": "export {};\n" });
    expect(exitCode).toBe(0);
    const lacking = named(stderr);
    // Fewer with each rule that is added.
    if (lacking.length === 0) return;
    expect(stderr).toContain(`warn: ${lacking.length} rules that the categories turn on`);
    const off = { ...config, rules: { [lacking[0]]: "off" } };
    const without = await lint({ ".oxlintrc.json": JSON.stringify(off), "a.js": "export {};\n" });
    expect(named(without.stderr)).toEqual(lacking.slice(1));
  });
});

// What oxlint 1.87 prints.
test("--print-config of oxlint: what each plugin is called in the name of a rule", async () => {
  const names = [
    "import/no-cycle",
    "jest/no-focused-tests",
    "jsdoc/require-param",
    "jsx_a11y/alt-text",
    "nextjs/no-img-element",
    "no-debugger",
    "node/no-path-concat",
    "oxc/no-accumulating-spread",
    "promise/param-names",
    "react/jsx-key",
    "react/rules-of-hooks",
    "react_perf/jsx-no-new-object-as-prop",
    "typescript/no-explicit-any",
    "unicorn/no-null",
    "vitest/no-import-node-test",
    "vue/no-dupe-keys",
  ];
  const plugins = [...new Set(names.filter(it => it.includes("/")).map(it => it.split("/")[0]))];
  const config = {
    categories: { correctness: "off" },
    plugins,
    rules: Object.fromEntries(names.map(it => [it, "warn"])),
  };
  const { stdout } = await lint({ ".oxlintrc.json": JSON.stringify(config) }, ["--print-config"]);
  expect(Object.keys(JSON.parse(stdout).rules).sort()).toEqual(names);
});

describe.concurrent("the configuration files of ESLint 8", () => {
  test.each([
    [".eslintrc.json", rc(eqeqeq)],
    [".eslintrc.json", `// a comment\n{ /* another */ "root": true, "rules": { "eqeqeq": "error" } }`],
    [".eslintrc.yml", yaml("eqeqeq")],
    [".eslintrc.yaml", yaml("eqeqeq")],
    [".eslintrc", rc(eqeqeq)],
    [".eslintrc", yaml("eqeqeq")],
    ["package.json", JSON.stringify({ name: "a", eslintConfig: { root: true, ...eqeqeq } })],
  ])("%s is read", async (name, text) => {
    const { problems, exitCode } = await lint({ [name]: text, "a.js": code });
    expect(problems).toEqual(["a.js:2:7 eqeqeq"]);
    expect(exitCode).toBe(1);
  });

  test.each([
    [".eslintrc.yaml", yaml("eqeqeq"), ".eslintrc.yml", yaml("no-var")],
    [".eslintrc.yml", yaml("eqeqeq"), ".eslintrc.json", rc(noVar)],
    [".eslintrc.json", rc(eqeqeq), ".eslintrc", rc(noVar)],
    [".eslintrc", rc(eqeqeq), "package.json", JSON.stringify({ eslintConfig: { root: true, ...noVar } })],
  ])("%s counts and not %s beside it", async (first, firstText, second, secondText) => {
    const { problems } = await lint({ [first]: firstText, [second]: secondText, "a.js": code });
    expect(problems).toEqual(["a.js:2:7 eqeqeq"]);
  });

  test.each([
    [".eslintrc.json", '{ "rules": '],
    [".eslintrc.json", ""],
    [".eslintrc.yml", "rules:\n  - a: [\n"],
    ["package.json", '{ "eslintConfig": '],
  ])("a %s that cannot be read is an error", async (name, text) => {
    const { problems, stderr, exitCode } = await lint({ [name]: text, "a.js": code });
    expect(problems).toEqual([]);
    expect(stderr).toContain(`Cannot read config file: <dir>/${name}`);
    expect(exitCode).toBe(2);
  });

  test.each([
    [{ nonsense: 1 }, 'Unexpected top-level property "nonsense"'],
    [
      { overrides: [{ files: ["*.js"], ignorePatterns: ["a"] }] },
      'Unexpected top-level property "overrides[0].ignorePatterns"',
    ],
    [{ rules: 1 }, 'Property "rules" is the wrong type (expected object but got `1`)'],
    [{ env: { nonsense: true } }, 'Environment key "nonsense" is unknown'],
    [{ extends: "nowhere" }, 'ESLint couldn\'t find the config "nowhere" to extend from.'],
    [{ extends: "./nowhere.json" }, 'ESLint couldn\'t find the config "./nowhere.json" to extend from.'],
    [{ extends: "plugin:nowhere/recommended" }, 'ESLint couldn\'t find the plugin "eslint-plugin-nowhere".'],
    [{ plugins: ["nowhere"] }, 'ESLint couldn\'t find the plugin "eslint-plugin-nowhere".'],
    [{ parser: "nowhere" }, "Failed to load parser 'nowhere'"],
    [{ processor: "nowhere/p" }, "'nowhere/p' was not found."],
  ])("%j is an error", async (config, message) => {
    const { problems, stderr, exitCode } = await lint({ ".eslintrc.json": rc(config), "a.js": code });
    expect(problems).toEqual([]);
    expect(stderr).toContain(".eslintrc.json");
    expect(stderr).toContain(message);
    expect(exitCode).toBe(2);
  });

  test("the files of the directories above count too, up to one with `root`", async () => {
    const { problems } = await lint({
      ".eslintrc.json": JSON.stringify({ rules: { "no-debugger": "error" } }),
      "a/.eslintrc.json": rc(eqeqeq),
      "a/b/.eslintrc.yml": "rules:\n  no-var: error\n",
      "a/b/c/package.json": '{ "name": "c" }',
      "a/b/c/d.js": code,
      "a/e.js": code,
    });
    expect(problems).toEqual(["a/b/c/d.js:1:1 no-var", "a/b/c/d.js:2:7 eqeqeq", "a/e.js:2:7 eqeqeq"]);
  });

  test("a severity alone keeps the options of the file above", async () => {
    const { problems, exitCode } = await lint({
      ".eslintrc.json": rc({ rules: { eqeqeq: ["error", "smart"] } }),
      "sub/.eslintrc.json": JSON.stringify({ rules: { eqeqeq: "warn" } }),
      "sub/a.js": "if (x == null) {}\nif (x == 1) {}\n",
    });
    expect(problems).toEqual(["sub/a.js:2:7 eqeqeq"]);
    expect(exitCode).toBe(0);
  });

  test("`extends` of files, in `overrides` too, and `overrides` in `overrides`", async () => {
    const { problems } = await lint({
      ".eslintrc.json": rc({
        extends: ["./one.yml", "./two.json"],
        overrides: [
          { files: ["a.js"], extends: ["./three.json"] },
          {
            files: ["*.js"],
            overrides: [{ files: ["b.js"], excludedFiles: ["sub/*"], rules: { "no-debugger": "error" } }],
          },
        ],
      }),
      "one.yml": "rules:\n  eqeqeq: error\n  no-var: error\n",
      "two.json": JSON.stringify({ rules: { eqeqeq: "off" } }),
      "three.json": JSON.stringify(eqeqeq),
      "a.js": code,
      "b.js": code,
      "sub/b.js": code,
    });
    expect(problems).toEqual([
      "a.js:1:1 no-var",
      "a.js:2:7 eqeqeq",
      "b.js:1:1 no-var",
      "b.js:2:13 no-debugger",
      "sub/b.js:1:1 no-var",
    ]);
  });

  test("of a directory the .js files are linted, and what `overrides` and --ext name", async () => {
    const files = {
      ".eslintrc.json": rc({ ...eqeqeq, overrides: [{ files: ["*.one"] }] }),
      "a.js": code,
      "b.mjs": code,
      "c.one": code,
      "d.two": code,
    };
    expect((await lint(files)).problems).toEqual(["a.js:2:7 eqeqeq", "c.one:2:7 eqeqeq"]);
    // It takes the place of both.
    expect((await lint(files, ["--ext", ".two", "."])).problems).toEqual(["d.two:2:7 eqeqeq"]);
    // What is named is linted, whatever it is called.
    expect((await lint(files, ["b.mjs", "d.two"])).problems).toEqual(["b.mjs:2:7 eqeqeq", "d.two:2:7 eqeqeq"]);
  });

  test("what is ignored: by itself, `ignorePatterns`, .eslintignore, `eslintIgnore`, the command line", async () => {
    const files = {
      ".eslintrc.json": rc({ ...eqeqeq, ignorePatterns: ["b.js"] }),
      "sub/.eslintrc.json": JSON.stringify({ ignorePatterns: ["c.js"] }),
      "a.js": code,
      "b.js": code,
      "c.js": code,
      "d.js": code,
      "sub/c.js": code,
      "node_modules/e.js": code,
      ".f.js": code,
    };
    const all = ["a.js:2:7 eqeqeq", "c.js:2:7 eqeqeq", "d.js:2:7 eqeqeq"];
    expect((await lint(files)).problems).toEqual(all);
    const withoutD = all.filter(it => !it.startsWith("d.js"));
    expect((await lint({ ...files, ".eslintignore": "# a comment\n\nd.js\n" })).problems).toEqual(withoutD);
    expect((await lint({ ...files, "package.json": '{ "eslintIgnore": ["d.js"] }' })).problems).toEqual(withoutD);
    expect((await lint({ ...files, "ignored": "d.js\n" }, ["--ignore-path", "ignored", "."])).problems).toEqual(
      withoutD,
    );
    expect((await lint(files, ["--ignore-pattern", "d.js", "."])).problems).toEqual(withoutD);
    expect((await lint(files, ["--no-ignore", "."])).problems).toEqual(
      [...all, "b.js:2:7 eqeqeq", "sub/c.js:2:7 eqeqeq"].sort(),
    );
  });

  test("the language: `env`, `globals`, `parserOptions`", async () => {
    const { problems } = await lint({
      ".eslintrc.json": rc({
        env: { node: true },
        globals: { a: "readonly", process: "off" },
        rules: { "no-undef": "error", "no-global-assign": "error" },
        overrides: [{ files: ["module.js"], parserOptions: { ecmaVersion: 2022, sourceType: "module" } }],
      }),
      // `return` outside of a function is for CommonJS, which `node` stands for.
      "script.js": "require('a'); a = 1; process; window;\nreturn;\n",
      "module.js": "import b from 'b';\nb;\n",
    });
    expect(problems).toEqual(["script.js:1:15 no-global-assign", "script.js:1:22 no-undef", "script.js:1:31 no-undef"]);
  });

  test("`/* eslint-env */` comments count, which are an error with an eslint.config.js", async () => {
    const files = { "a.js": "/* eslint-env mocha, nonsense */\ndescribe();\nwindow;\n" };
    const legacy = await lint({ ...files, ".eslintrc.json": rc({ rules: { "no-undef": "error" } }) });
    expect(legacy.problems).toEqual(["a.js:3:1 no-undef"]);
    // What the configuration says about a variable counts for more.
    const off = { globals: { describe: "off" }, rules: { "no-undef": "error" } };
    expect((await lint({ ...files, ".eslintrc.json": rc(off) })).problems).toEqual([
      "a.js:2:1 no-undef",
      "a.js:3:1 no-undef",
    ]);
    const flat = await lint(
      { ...files, "eslint.config.js": `module.exports = [{ rules: { "no-undef": "error" } }];` },
      ["a.js"],
    );
    expect(flat.problems).toEqual(["a.js:1:1 -", "a.js:2:1 no-undef", "a.js:3:1 no-undef"]);
  });

  test("--no-eslintrc, --env, --config", async () => {
    const files = {
      ".eslintrc.json": rc({ rules: { eqeqeq: "error", "no-undef": "error" } }),
      "other.json": JSON.stringify({ parserOptions: {}, ...noVar }),
      "other.yml": "rules:\n  no-var: error\n",
      "a.js": "var x = 1;\nif (x == 2) describe();\n",
    };
    expect((await lint(files, ["a.js"])).problems).toEqual(["a.js:2:13 no-undef", "a.js:2:7 eqeqeq"]);
    expect((await lint(files, ["--env", "mocha", "a.js"])).problems).toEqual(["a.js:2:7 eqeqeq"]);
    expect((await lint(files, ["--no-eslintrc", "a.js"])).problems).toEqual([]);
    expect((await lint(files, ["--no-eslintrc", "--rule", "no-var: error", "a.js"])).problems).toEqual([
      "a.js:1:1 no-var",
    ]);
    expect((await lint(files, ["--no-eslintrc", "-c", "other.yml", "a.js"])).problems).toEqual(["a.js:1:1 no-var"]);
    // It adds to the files that are found.
    const both = ["a.js:1:1 no-var", "a.js:2:13 no-undef", "a.js:2:7 eqeqeq"];
    expect((await lint(files, ["-c", "other.json", "a.js"])).problems).toEqual(both);
    expect((await lint(files, ["-c", "other.yml", "a.js"])).problems).toEqual(both);
  });

  test("they do not count beside or below an eslint.config.js, unless ESLINT_USE_FLAT_CONFIG is false", async () => {
    const files = {
      "eslint.config.js": `module.exports = [{ rules: { "no-var": "error" } }];`,
      ".eslintrc.json": rc(eqeqeq),
      "a.js": code,
      "sub/.eslintrc.json": rc(eqeqeq),
      "sub/b.js": code,
    };
    expect((await lint(files, ["a.js", "sub"])).problems).toEqual(["a.js:1:1 no-var", "sub/b.js:1:1 no-var"]);
    const legacy = await lint(files, ["a.js", "sub"], { env: { ESLINT_USE_FLAT_CONFIG: "false" } });
    expect(legacy.problems).toEqual(["a.js:2:7 eqeqeq", "sub/b.js:2:7 eqeqeq"]);
  });

  test("ESLINT_USE_FLAT_CONFIG=true without an eslint.config.js is an error", async () => {
    const files = { ".eslintrc.json": rc(eqeqeq), "a.js": code };
    const { problems, stderr, exitCode } = await lint(files, ["a.js"], { env: { ESLINT_USE_FLAT_CONFIG: "true" } });
    expect(problems).toEqual([]);
    expect(stderr).toContain("ESLINT_USE_FLAT_CONFIG is true");
    expect(exitCode).toBe(2);
  });

  test("what is built in is not a package", async () => {
    const { problems, exitCode } = await lint({
      ".eslintrc.json": rc({
        extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended", "./base.json"],
        plugins: ["@typescript-eslint", "@typescript-eslint/eslint-plugin", "eslint-plugin-import", "n"],
      }),
      "base.json": JSON.stringify(noVar),
      "a.js": code,
    });
    expect(problems).toEqual(["a.js:1:1 no-var", "a.js:2:13 no-debugger"]);
    expect(exitCode).toBe(1);
  });

  // Reports every `x`.
  const noX = `rules: { "no-x": { meta: { schema: [], messages: { x: "x" } }, create: context => ({ Identifier(node) { if (node.name === "x") context.report({ node, messageId: "x" }); } }) } }`;

  test.each([
    [".eslintrc.js", ".eslintrc.json", rc(noVar)],
    [".eslintrc.cjs", ".eslintrc.yaml", yaml("no-var")],
  ])("%s is run, and counts and not %s beside it", async (first, second, secondText) => {
    const { problems, exitCode } = await lint({
      [first]: `module.exports = ${rc(eqeqeq)};`,
      [second]: secondText,
      "a.js": code,
    });
    expect(problems).toEqual(["a.js:2:7 eqeqeq"]);
    expect(exitCode).toBe(1);
  });

  test("an .eslintrc.js that exports nothing is passed over", async () => {
    const { problems } = await lint({
      ".eslintrc.js": "module.exports = null;",
      ".eslintrc.json": rc(noVar),
      "a.js": code,
    });
    expect(problems).toEqual(["a.js:1:1 no-var"]);
  });

  test("an .eslintrc.js that throws is an error", async () => {
    const { problems, stderr, exitCode } = await lint({ ".eslintrc.js": `throw new Error("no");`, "a.js": code });
    expect(problems).toEqual([]);
    expect(stderr).toContain("Cannot read config file: <dir>/.eslintrc.js\nError: no");
    expect(exitCode).toBe(2);
  });

  test("`extends` of packages, by all their names, and of a program", async () => {
    const rules = (rules: object) => `module.exports = ${JSON.stringify({ rules })};`;
    const { problems } = await lint({
      ".eslintrc.json": rc({
        extends: ["one", "eslint-config-two", "@scope", "@scope/three", "one/strict", "./four.js"],
      }),
      "node_modules/eslint-config-one/index.js": `module.exports = { extends: "./inner", rules: { "no-var": "error" } };`,
      "node_modules/eslint-config-one/inner.js": rules({ eqeqeq: "error" }),
      "node_modules/eslint-config-one/strict.js": rules({ "no-debugger": "error" }),
      "node_modules/eslint-config-two/index.js": rules({ "no-magic-numbers": "error" }),
      "node_modules/@scope/eslint-config/index.js": rules({ "no-magic-numbers": "off", curly: "error" }),
      "node_modules/@scope/eslint-config-three/index.js": rules({ "id-length": "error" }),
      "four.js": rules({ "no-var": "off" }),
      "a.js": code,
    });
    expect(problems).toEqual(["a.js:1:5 id-length", "a.js:2:13 curly", "a.js:2:13 no-debugger", "a.js:2:7 eqeqeq"]);
  });

  test("an .eslintrc with comments names a package", async () => {
    const { problems } = await lint({
      ".eslintrc": `{\n  // a comment\n  "root": true,\n  "extends": "one" /* another */\n}\n`,
      "node_modules/eslint-config-one/index.js": `module.exports = ${JSON.stringify(noVar)};`,
      "a.js": code,
    });
    expect(problems).toEqual(["a.js:1:1 no-var"]);
  });

  test("a plugin is looked for from the directory of the file of the cascade, not from the working directory", async () => {
    const { problems } = await lint({
      ".eslintrc.json": rc({}),
      "sub/.eslintrc.json": JSON.stringify({
        extends: "plugin:near/all",
        env: { "near/e": true },
        rules: { "no-undef": "error" },
      }),
      "sub/node_modules/eslint-plugin-near/index.js": `module.exports = { ${noX},
        configs: { all: { plugins: ["near"], rules: { "near/no-x": "error" } } },
        environments: { e: { globals: { y: true } } } };`,
      "sub/a.js": "var x = y;\nz;\n",
    });
    expect(problems).toEqual(["sub/a.js:1:5 near/no-x", "sub/a.js:2:1 no-undef"]);
  });

  test("--resolve-plugins-relative-to", async () => {
    const files = {
      ".eslintrc.json": rc({ plugins: ["near"], rules: { "near/no-x": "error" } }),
      "elsewhere/node_modules/eslint-plugin-near/index.js": `module.exports = { ${noX} };`,
      "a.js": code,
    };
    const { problems } = await lint(files, ["--resolve-plugins-relative-to", "elsewhere", "a.js"]);
    expect(problems).toEqual(["a.js:1:5 near/no-x", "a.js:2:5 near/no-x"]);
    const without = await lint(files, ["a.js"]);
    expect(without.stderr).toContain(`ESLint couldn't find the plugin "eslint-plugin-near".`);
    expect(without.exitCode).toBe(2);
  });

  test("eslint:recommended is that of ESLint 8, and leaves alone what it does not have", async () => {
    const files = {
      "base.json": `{ "rules": { "no-constant-binary-expression": "error" } }`,
      "a.js": "var a = 1;;\na + 1 == null;\n",
    };
    const alone = await lint({ ...files, ".eslintrc.json": rc({ extends: ["eslint:recommended"] }) });
    expect(alone.problems).toEqual(["a.js:1:11 no-extra-semi"]);
    const after = await lint({ ...files, ".eslintrc.json": rc({ extends: ["./base.json", "eslint:recommended"] }) });
    expect(after.problems).toEqual(["a.js:1:11 no-extra-semi", "a.js:2:1 no-constant-binary-expression"]);
  });

  test("after @rushstack/eslint-patch/modern-module-resolution a plugin is looked for from the file that names it", async () => {
    const { problems } = await lint({
      ".eslintrc.json": rc({ extends: "patched" }),
      "node_modules/eslint-config-patched/index.js": `require("@rushstack/eslint-patch/modern-module-resolution");
        module.exports = { plugins: ["inner"], rules: { "inner/no-x": "error" } };`,
      "node_modules/eslint-config-patched/node_modules/eslint-plugin-inner/index.js": `module.exports = { ${noX} };`,
      // As the package does where it does not find ESLint.
      "node_modules/@rushstack/eslint-patch/modern-module-resolution.js": `throw new Error("Failed to patch ESLint because the calling module was not recognized.");`,
      "a.js": code,
    });
    expect(problems).toEqual(["a.js:1:5 inner/no-x", "a.js:2:5 inner/no-x"]);
  });

  test("what is not installed is not asked of a registry", async () => {
    const asked: string[] = [];
    using server = Bun.serve({
      port: 0,
      fetch(request) {
        asked.push(new URL(request.url).pathname);
        return new Response("{}", { status: 404 });
      },
    });
    const { stderr, exitCode } = await lint(
      { ".eslintrc.json": rc({ extends: "nowhere", plugins: ["nowhere"], parser: "nowhere-parser" }), "a.js": code },
      ["."],
      { env: { BUN_CONFIG_REGISTRY: server.url.href, NPM_CONFIG_REGISTRY: server.url.href } },
    );
    expect(stderr).toContain('ESLint couldn\'t find the config "nowhere" to extend from.');
    expect(asked).toEqual([]);
    expect(exitCode).toBe(2);
  });

  test("the configurations of typescript-eslint are those of the version that is installed", async () => {
    const files = (version: string, configs: string) => ({
      ".eslintrc.json": rc({ extends: "plugin:@typescript-eslint/mine" }),
      "node_modules/@typescript-eslint/eslint-plugin/package.json": JSON.stringify({ version, main: "dist/index.js" }),
      // Version 8 is not loaded for its configurations.
      "node_modules/@typescript-eslint/eslint-plugin/dist/index.js":
        version === "8.0.0"
          ? `throw new Error("loaded");`
          : `module.exports = { configs: { mine: require("./configs/mine") } };`,
      [`node_modules/@typescript-eslint/eslint-plugin/dist/${configs}/mine.js`]: `module.exports = { extends: ["./${configs}/base"] };`,
      [`node_modules/@typescript-eslint/eslint-plugin/dist/${configs}/base.js`]: `module.exports = ${JSON.stringify(eqeqeq)};`,
      "a.js": code,
    });
    for (const [version, configs] of [
      ["5.62.0", "configs"],
      ["8.0.0", "configs"],
      ["8.0.0", "configs/eslintrc"],
    ]) {
      const { problems } = await lint(files(version, configs));
      expect(problems).toEqual(["a.js:2:7 eqeqeq"]);
    }
  });

  test("a parser that is read here is looked for and not loaded, also that of eslint-config-next", async () => {
    const { problems } = await lint({
      ".eslintrc.json": rc({ extends: "next", overrides: [{ files: ["*.ts"], parser: "@typescript-eslint/parser" }] }),
      "node_modules/eslint-config-next/index.js": `module.exports = { parser: "./parser.js", rules: { eqeqeq: "error" } };`,
      "node_modules/eslint-config-next/parser.js": `throw new Error("loaded");`,
      "node_modules/@typescript-eslint/parser/index.js": `throw new Error("loaded");`,
      "a.js": code,
      "b.ts": code,
    });
    expect(problems).toEqual(["a.js:2:7 eqeqeq", "b.ts:2:7 eqeqeq"]);
  });

  test("the language is that of ESLint 8: ES5 and a script, unless something says otherwise", async () => {
    const files = { "a.js": "let a = 1;\n", "b.js": "var f = () => 1;\n", "c.js": "a ?? b;\n", "d.js": "var a;\n" };
    const es5 = await lint({ ...files, ".eslintrc.json": rc({}) });
    expect(es5.problems).toEqual(["a.js:1:5 -", "b.js:1:10 -", "c.js:1:4 -"]);
    expect(es5.stdout).toContain("Parsing error: Unexpected token a");
    expect(es5.exitCode).toBe(1);
    const es6 = await lint({ ...files, ".eslintrc.json": rc({ env: { es6: true } }) });
    expect(es6.problems).toEqual(["c.js:1:4 -"]);
    const es2020 = await lint({ ...files, ".eslintrc.json": rc({ parserOptions: { ecmaVersion: 2020 } }) });
    expect(es2020.problems).toEqual([]);
    const nonsense = await lint({ ...files, ".eslintrc.json": rc({ parserOptions: { ecmaVersion: 2025 } }) }, ["d.js"]);
    expect(nonsense.problems).toEqual(["d.js:0:0 -"]);
    expect(nonsense.stdout).toContain("Parsing error: Invalid ecmaVersion.");
  });

  test("a version brings no variables, an environment does", async () => {
    const files = { "a.js": "new Promise(function () {});\n" };
    const rules = { "no-undef": "error" };
    const version = await lint({ ...files, ".eslintrc.json": rc({ parserOptions: { ecmaVersion: 2022 }, rules }) });
    expect(version.problems).toEqual(["a.js:1:5 no-undef"]);
    expect((await lint({ ...files, ".eslintrc.json": rc({ env: { es6: true }, rules }) })).problems).toEqual([]);
  });

  test("the environments are those that ESLint 8 comes with", async () => {
    const { problems } = await lint({
      ".eslintrc.json": rc({ env: { node: true, jest: true }, rules: { "no-undef": "error" } }),
      "a.js": "navigator;\nWebSocket;\nlocalStorage;\npit;\nfdescribe;\nIntl;\nprocess;\nstructuredClone;\n",
      "b.js": "/* eslint-env worker */\nCSSImageValue;\nimportScripts;\nWebSocket;\nreportError;\n",
    });
    expect(problems).toEqual(["a.js:1:1 no-undef", "a.js:2:1 no-undef", "a.js:3:1 no-undef", "b.js:2:1 no-undef"]);
  });

  test("a rule that ESLint 8 does not have is a message in every file", async () => {
    const { problems, stdout, exitCode } = await lint({
      ".eslintrc.json": rc({
        rules: {
          "no-such-rule": "warn",
          "no-useless-assignment": "error",
          "react-hooks/rules-of-hooks": 2,
          "no-other": 0,
        },
      }),
      "a.js": code,
      "b.js": "",
    });
    const missing = ["1:1 no-such-rule", "1:1 no-useless-assignment", "1:1 react-hooks/rules-of-hooks"];
    expect(problems).toEqual([...missing.map(it => `a.js:${it}`), ...missing.map(it => `b.js:${it}`)]);
    expect(stdout).toContain("Definition for rule 'no-such-rule' was not found.");
    expect(exitCode).toBe(1);
  });

  test("`noInlineConfig` warns about each comment, with the name of the configuration", async () => {
    const { problems, stdout } = await lint({
      ".eslintrc.json": rc({ extends: "./base.json" }),
      "base.json": `{ "noInlineConfig": true }`,
      "a.js": "/* eslint-disable eqeqeq */\nvar a; // eslint-disable-line\n",
    });
    expect(problems).toEqual(["a.js:1:1 -", "a.js:2:8 -"]);
    const where = "has no effect because you have 'noInlineConfig' setting in your config (.eslintrc.json";
    expect(stdout).toContain(`'/*eslint-disable*/' ${where}`);
    expect(stdout).toContain(`'//eslint-disable-line' ${where}`);
  });

  test("all of a configuration is validated, also what is for other files, in the words of ESLint 8", async () => {
    const { stderr, exitCode } = await lint({
      ".eslintrc.json": rc({ overrides: [{ files: ["*.ts"], rules: { eqeqeq: ["error", "sometimes"] } }] }),
      "a.js": code,
    });
    expect(stderr).toContain(".eslintrc.json#overrides[0]:");
    expect(stderr).toContain('Configuration for rule "eqeqeq" is invalid:');
    expect(stderr).toContain('Value "sometimes" should be equal to one of the allowed values.');
    expect(exitCode).toBe(2);
  });

  test("a plugin or a parser that is missing is an error only for the files that have it", async () => {
    const { problems, exitCode } = await lint({
      ".eslintrc.json": rc({ ...eqeqeq, overrides: [{ files: ["b.js"], plugins: ["nowhere"], parser: "nowhere" }] }),
      "a.js": code,
    });
    expect(problems).toEqual(["a.js:2:7 eqeqeq"]);
    expect(exitCode).toBe(1);
  });

  test("`eslint:all` is that of 8.57.1", async () => {
    const { problems } = await lint({
      ".eslintrc.json": rc({ extends: "eslint:all", env: { es6: true } }),
      "a.js": "var one = new Symbol();;\n",
    });
    // Formatting rules were deprecated by then, and what is deprecated is not in it.
    expect(problems).toContain("a.js:1:15 no-new-symbol");
    expect(problems.filter(it => it.endsWith("semi"))).toEqual([]);
  });

  test("the default options of typescript-eslint are those of the major version that is installed", async () => {
    const installed = (version: string) => ({
      ".eslintrc.json": rc({
        parser: "@typescript-eslint/parser",
        plugins: ["@typescript-eslint"],
        rules: { "@typescript-eslint/no-unused-vars": "error" },
      }),
      "node_modules/@typescript-eslint/eslint-plugin/package.json": JSON.stringify({ version, main: "index.js" }),
      "node_modules/@typescript-eslint/eslint-plugin/index.js": "module.exports = { rules: {}, configs: {} };",
      "a.js": "try { f(); } catch (e) {}\n",
    });
    // `caughtErrors` is "none" before version 8.
    const old = await lint(installed("7.18.0"));
    expect(old.problems).toEqual([]);
    // It is said once, where no formatter writes, and the run does not fail for it.
    expect(old.stderr.split("typescript-eslint 7.18.0 is installed.").length).toBe(2);
    expect(old.stdout).not.toContain("is installed.");
    expect(old.exitCode).toBe(0);
    expect((await lint(installed("7.18.0"), ["--quiet", "."])).stderr).toContain("is installed.");
    expect((await lint(installed("5.62.0"))).problems).toEqual([]);
    // What is only used as a type is reported since version 8.
    const typeOnly = { "a.ts": "const a = 1;\nexport type A = typeof a;\n" };
    expect((await lint({ ...installed("7.18.0"), ...typeOnly }, ["a.ts"])).problems).toEqual([]);
    expect((await lint({ ...installed("8.0.0"), ...typeOnly }, ["a.ts"])).problems).toEqual([
      "a.ts:1:7 @typescript-eslint/no-unused-vars",
    ]);
    const current = await lint(installed("8.0.0"));
    expect(current.problems).toEqual(["a.js:1:21 @typescript-eslint/no-unused-vars"]);
    expect(current.stderr).not.toContain("is installed.");
  });

  test("options that only versions of typescript-eslint before 8 take", async () => {
    const installed = (version: string, rules: object) => ({
      ".eslintrc.json": rc({ plugins: ["@typescript-eslint"], rules }),
      "node_modules/@typescript-eslint/eslint-plugin/package.json": JSON.stringify({ version, main: "index.js" }),
      "node_modules/@typescript-eslint/eslint-plugin/index.js": "module.exports = { rules: {}, configs: {} };",
      "a.js": "",
    });
    const of5 = {
      "@typescript-eslint/restrict-plus-operands": ["off", { checkCompoundAssignments: true }],
      "@typescript-eslint/explicit-module-boundary-types": ["error", { shouldTrackReferences: true }],
    };
    const of7 = {
      "@typescript-eslint/no-empty-object-type": ["error", { allowObjectTypes: "in-type-alias-with-name" }],
    };
    expect((await lint(installed("5.62.0", of5))).exitCode).toBe(0);
    expect((await lint(installed("7.18.0", of7))).exitCode).toBe(0);
    for (const rules of [of5, of7]) {
      const { stderr, exitCode } = await lint(installed("8.0.0", rules));
      expect(stderr).toContain("is invalid:");
      expect(exitCode).toBe(2);
    }
  });

  test("files that each extend the next one twice", async () => {
    const files: Record<string, string> = { ".eslintrc.json": rc({ extends: "./d0.json" }), "a.js": "" };
    for (let i = 0; i < 22; i++)
      files[`d${i}.json`] = JSON.stringify({ extends: [`./d${i + 1}.json`, `./d${i + 1}.json`] });
    files["d22.json"] = "{}";
    const { stderr, exitCode } = await lint(files);
    expect(stderr).toContain('Too many files in "extends".');
    expect(exitCode).toBe(2);
  });

  test("--print-config has no settings that the files do not have", async () => {
    const files = { ".eslintrc.json": rc({ rules: { eqeqeq: "error" } }), "a.js": "" };
    const { stdout } = await lint(files, ["--print-config", "a.js"]);
    expect(Object.keys(JSON.parse(stdout).rules)).toEqual(["eqeqeq"]);
  });

  // What ESLint 8.57.1 does with each row is in oracle/driver/eslintrc-cli.expected.json, recorded by eslintrc-cli.mjs there.
  // eslintrc-cli.differences.json has the rows with which `bun lint` does something else, and what differs.
  const rows = rowsOfESLint8.filter(it => !(it.posix && isWindows));
  // Each row starts two processes: too slow for a debug build, and eight in a row take their time on a machine that is busy.
  for (let start = 0; start < rows.length; start += 4) {
    const some = rows.slice(start, start + 4);
    test.skipIf(isDebug || isASAN)(
      `what ESLint 8.57.1 does: ${some[0].name} ..`,
      async () => {
        const differs: Record<string, string> = {};
        for (const row of some) {
          using dir = tempDir("bun-lint-eslintrc", {});
          const directories = write(join(String(dir), "row"), row);
          await using proc = spawn({
            cmd: [...command, "--threads", "2", ...argumentsOf(row, directories.project)],
            env: environment(row, directories.home, env),
            cwd: directories.cwd,
            stdin: Buffer.from(row.stdin ?? ""),
            stdout: "pipe",
            stderr: "pipe",
          });
          const [stdout, stderr, status] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          const expected = whatESLint8Does[row.name as keyof typeof whatESLint8Does];
          const what = difference(expected, outcome({ status, stdout, stderr }, directories, row));
          if (what) differs[row.name] = what;
        }
        const known = differencesFromESLint8 as Record<string, string>;
        expect(differs).toEqual(
          Object.fromEntries(some.filter(it => it.name in known).map(it => [it.name, known[it.name]])),
        );
      },
      30_000,
    );
  }
});

describe.concurrent("whose configuration files count", () => {
  test("an eslint.config.js further down is not read", async () => {
    const { problems, exitCode } = await lint({
      ".oxlintrc.json": JSON.stringify({ categories: { correctness: "off" }, rules: { "no-var": "error" } }),
      "a.js": code,
      "sub/eslint.config.js": `import "a-package-that-is-not-installed";`,
      "sub/b.js": code,
      "sub/deeper/.oxlintrc.json": JSON.stringify({ categories: { correctness: "off" }, rules: { eqeqeq: "error" } }),
      "sub/deeper/c.js": code,
    });
    expect(problems).toEqual(["a.js:1:1 no-var", "sub/b.js:1:1 no-var", "sub/deeper/c.js:2:7 eqeqeq"]);
    expect(exitCode).toBe(1);
  });

  test("a file of ESLint 8 further down is not read", async () => {
    const { problems, exitCode } = await lint({
      ".oxlintrc.json": JSON.stringify({ categories: { correctness: "off" }, rules: { "no-var": "error" } }),
      "a.js": code,
      "sub/.eslintrc": "not: [valid",
      "sub/b.js": code,
    });
    expect(problems).toEqual(["a.js:1:1 no-var", "sub/b.js:1:1 no-var"]);
    expect(exitCode).toBe(1);
  });

  // What is left over from ESLint in examples, fixtures and templates.
  test("below an .oxlintrc.json, also one above the working directory, no file of ESLint ends the run", async () => {
    const files = {
      ".oxlintrc.json": JSON.stringify({ categories: { correctness: "off" }, rules: { "no-var": "error" } }),
      "docs/fiddles/.eslintrc.json": `{ "extends": "standard", "rules": { "import/order": "off" } }`,
      "docs/fiddles/a.js": code,
    };
    for (const [args, cwd] of [
      [["docs/fiddles"], "."],
      [["docs/fiddles/a.js"], "."],
      [["."], "docs"],
    ] as const) {
      const { problems, exitCode } = await lint(files, [...args], { cwd });
      expect(problems).toEqual(["docs/fiddles/a.js:1:1 no-var"]);
      expect(exitCode).toBe(1);
    }
  });

  test("an .oxlintrc.json below an eslint.config.js is not read", async () => {
    const { problems } = await lint({
      "eslint.config.js": `module.exports = [{ rules: { "no-var": "error" } }];`,
      "a.js": code,
      "sub/.oxlintrc.json": "not JSON",
      "sub/b.js": code,
    });
    expect(problems).toEqual(["a.js:1:1 no-var", "sub/b.js:1:1 no-var"]);
  });

  test("where the working directory has no configuration, each directory tells", async () => {
    const { problems } = await lint({
      "one/eslint.config.js": `module.exports = [{ rules: { "no-var": "error" } }];`,
      "one/a.js": code,
      "two/.oxlintrc.json": JSON.stringify({ categories: { correctness: "off" }, rules: { eqeqeq: "error" } }),
      "two/b.js": code,
      "three/.eslintrc.json": rc({ rules: { "no-debugger": "error" } }),
      "three/c.js": code,
    });
    expect(problems).toEqual(["one/a.js:1:1 no-var", "three/c.js:2:13 no-debugger", "two/b.js:2:7 eqeqeq"]);
  });

  const oxlintrc = (rules: object) => JSON.stringify({ categories: { correctness: "off" }, rules });
  const both = {
    "eslint.config.js": `module.exports = [{ rules: { "no-var": "error" } }];`,
    ".oxlintrc.json": oxlintrc({ eqeqeq: "error" }),
    "a.js": code,
    "sub/eslint.config.js": `module.exports = [{ rules: { "no-debugger": "error" } }];`,
    "sub/.oxlintrc.json": oxlintrc({ "no-debugger": "error" }),
    "sub/b.js": "var y = 1;\nif (y == 2) {}\n",
  };

  // `oxlint --fix && eslint --fix .`, each replaced by `bun lint`: one of the two tools would be left out, in silence.
  test("where files of both tools count and nothing decides, nothing is linted", async () => {
    const say = "Say which one this run is for: --flavor=oxlint or --flavor=eslint.";
    const { problems, stdout, stderr, exitCode } = await lint(both, ["--fix", "a.js", "sub/b.js"]);
    expect([problems, stdout]).toEqual([[], ""]);
    expect(stderr).toBe(`error: Both <dir>/eslint.config.js and <dir>/.oxlintrc.json are here. ${say}`);
    expect(exitCode).toBe(2);
    // Also where one is further up than the other.
    const { "sub/.oxlintrc.json": _, ...above } = both;
    const below = await lint(above, ["."], { cwd: "sub" });
    expect(below.stderr).toBe(`error: Both <dir>/sub/eslint.config.js and <dir>/.oxlintrc.json are here. ${say}`);
    expect(below.exitCode).toBe(2);
    expect((await lint(both, ["--nonsense"])).exitCode).toBe(1);
  });

  test("oxlint needs no file: an eslint.config.js and the dependency", async () => {
    const files = {
      "eslint.config.js": both["eslint.config.js"],
      "package.json": JSON.stringify({ devDependencies: { eslint: "*", oxlint: "*" } }),
      "a.js": code,
    };
    const { stderr, exitCode } = await lint(files, ["a.js"]);
    expect(stderr).toStartWith(
      "error: Both <dir>/eslint.config.js and the dependency on oxlint in <dir>/package.json are here. Say which one",
    );
    expect(exitCode).toBe(2);
    expect((await lint(files, ["--flavor=eslint", "a.js"])).problems).toEqual(["a.js:1:1 no-var"]);
    // Its defaults.
    expect((await lint(files, ["--flavor=oxlint", "a.js"])).problems).toEqual(["a.js:2:13 no-debugger"]);
    expect((await lint(files, ["--deny-warnings", "-D", "correctness", "a.js"])).problems).toEqual([
      "a.js:2:13 no-debugger",
    ]);
    expect((await lint(files, ["--type-aware", "a.js"])).exitCode).toBe(2);
    const { "package.json": _, ...alone } = files;
    expect((await lint(alone, ["a.js"])).problems).toEqual(["a.js:1:1 no-var"]);
    expect((await lint(alone, ["--type-aware", "a.js"])).problems).toEqual(["a.js:1:1 no-var"]);
    expect((await lint(alone, ["--deny-warnings", "a.js"])).problems).toEqual(["a.js:2:13 no-debugger"]);
  });

  test("--type-aware, which ESLint does not have, is for oxlint where there are files of both", async () => {
    const { problems, stderr } = await lint(both, ["--type-aware", "a.js"]);
    expect(problems).toEqual(["a.js:2:7 eqeqeq"]);
    expect(stderr).not.toContain("Both ");
    expect((await lint(both, ["--type-aware", "--cache", "a.js"])).problems).toEqual(["a.js:1:1 no-var"]);
  });

  test.each([["--cache"], ["--no-warn-ignored"], ["--ext", ".js"], ["--rule", "no-var: error"]])(
    "%s is a flag that only ESLint has, so the run is for ESLint",
    async (...flags) => {
      const { problems, stderr } = await lint(both, [...flags, "a.js"]);
      expect(problems).toEqual(["a.js:1:1 no-var"]);
      expect(stderr).not.toContain("Both ");
    },
  );

  test.each([
    ["eslint", ["a.js:1:1 no-var"]],
    ["oxlint", ["a.js:2:7 eqeqeq"]],
  ])("--flavor=%s", async (flavor, expected) => {
    const { problems, stderr } = await lint(both, [`--flavor=${flavor}`, "a.js", "sub/b.js"]);
    expect(problems).toEqual(expected);
    expect(stderr).not.toContain("Both ");
  });

  test("--flavor takes two values", async () => {
    const { stderr, exitCode } = await lint(both, ["--flavor=biome", "."]);
    expect(stderr).toContain("Option flavor: 'biome' not one of eslint or oxlint.");
    expect(exitCode).toBe(1);
  });

  test("flags that only oxlint has, without a configuration file, are for oxlint", async () => {
    // Its defaults warn about what is surely wrong.
    const { problems, exitCode } = await lint({ "a.js": code }, ["-D", "no-var", "a.js"]);
    expect(problems).toEqual(["a.js:1:1 no-var", "a.js:2:13 no-debugger"]);
    expect(exitCode).toBe(1);
    const allowed = await lint({ "a.js": code }, ["-A", "no-debugger", "a.js"]);
    expect(allowed.problems).toEqual([]);
    expect(allowed.exitCode).toBe(0);
  });

  test("without a configuration file, the package.json tells", async () => {
    const files = { "a.js": "debugger;\nvar a = 1;\nexport { a };\n", "sub/b.js": "debugger;\n" };
    const dependsOn = (...names: string[]) =>
      JSON.stringify({ devDependencies: Object.fromEntries(names.map(it => [it, "*"])) });
    // By default `no-debugger` is a warning for oxlint and an error for ESLint.
    const oxlint = await lint({ ...files, "package.json": dependsOn("oxlint") });
    expect(oxlint.exitCode).toBe(0);
    const below = await lint({ ...files, "package.json": dependsOn("oxlint"), "sub/package.json": "{}" }, ["."], {
      cwd: "sub",
    });
    expect(below.exitCode).toBe(0);
    const eslint = await lint({ ...files, "package.json": dependsOn("eslint") });
    expect(eslint.exitCode).toBe(1);
    const both = await lint({ ...files, "package.json": dependsOn("eslint", "oxlint") });
    expect(both.stderr).toContain(
      "No configuration file found, and <dir>/package.json has both eslint and oxlint: using the defaults of oxlint. Use --flavor=eslint for the other.",
    );
    expect(both.exitCode).toBe(0);
    const chosen = await lint({ ...files, "package.json": dependsOn("eslint", "oxlint") }, ["--flavor=eslint", "."]);
    expect(chosen.stderr).not.toContain("No configuration file found");
    expect(chosen.exitCode).toBe(1);
    expect((await lint(files)).exitCode).toBe(1);
  });

  test("beside a file of ESLint 8, --config with a file of oxlint and flags that only oxlint has are for oxlint", async () => {
    const files = {
      ".eslintrc.json": JSON.stringify({ extends: "not-installed" }),
      "mine.json": oxlintrc({ "no-var": "error" }),
      "plain.json": JSON.stringify({ rules: { "no-var": "error" } }),
      "a.js": code,
    };
    expect((await lint(files, ["-c", "mine.json", "a.js"])).problems).toEqual(["a.js:1:1 no-var"]);
    // What can be either is one of oxlint.
    const plain = ["a.js:1:1 no-var", "a.js:2:13 no-debugger"];
    expect((await lint(files, ["-c", "plain.json", "a.js"])).problems).toEqual(plain);
    expect((await lint(files, ["-c", "plain.json", "--disable-nested-config", "a.js"])).problems).toEqual(plain);
    expect((await lint({ ...files, ".eslintrc.js": "throw 1;" }, ["-c", "plain.json", "."])).problems).toEqual(plain);
    // One with what only ESLint 8 has adds to the files of ESLint 8.
    const legacy = await lint({ ...files, "legacy.json": JSON.stringify({ parserOptions: {} }) }, [
      "-c",
      "legacy.json",
      "a.js",
    ]);
    expect(legacy.stderr).toContain("not-installed");
  });

  test("Vite+: `lint` of the vite.config.ts", async () => {
    const lintOf = (rule: string) => `lint: { categories: { correctness: "off" }, rules: { "${rule}": "error" } }`;
    const files = {
      "package.json": JSON.stringify({ devDependencies: { "vite-plus": "*" } }),
      "vite.config.ts": `import { defineConfig } from "vite-plus";\nexport default defineConfig({ ${lintOf("no-var")} });`,
      "a.js": code,
      "packages/own/vite.config.ts": `export default ({ command }) => ({ ${lintOf("eqeqeq")}, command });`,
      "packages/own/b.js": code,
      "packages/silent/vite.config.ts": `export default { server: {} };`,
      "packages/silent/c.js": code,
    };
    const { problems, exitCode } = await lint(files, ["a.js", "packages/own/b.js", "packages/silent/c.js"]);
    expect(problems).toEqual(["a.js:1:1 no-var", "packages/own/b.js:2:7 eqeqeq", "packages/silent/c.js:1:1 no-var"]);
    expect(exitCode).toBe(1);
    const walked = await lint(files, ["packages"]);
    expect(walked.problems.filter(it => !it.includes("vite.config"))).toEqual([
      "packages/own/b.js:2:7 eqeqeq",
      "packages/silent/c.js:1:1 no-var",
    ]);
    const named = await lint(files, ["-c", "packages/silent/vite.config.ts", "a.js"]);
    expect(named.stderr).toContain(
      "Expected a `lint` field in the default export of <dir>/packages/silent/vite.config.ts",
    );
    expect(named.exitCode).not.toBe(0);
    // A configuration file of oxlint counts, and then these do not.
    const withFile = await lint({ ...files, ".oxlintrc.json": oxlintrc({ "no-debugger": "error" }) }, [
      "a.js",
      "packages/own/b.js",
    ]);
    expect(withFile.problems).toEqual(["a.js:2:13 no-debugger", "packages/own/b.js:2:13 no-debugger"]);
  });

  test("flags that only oxlint has, where there are both, are for oxlint", async () => {
    const { problems, stderr } = await lint(both, ["-D", "no-debugger", "a.js"]);
    expect(problems).toEqual(["a.js:2:13 no-debugger", "a.js:2:7 eqeqeq"]);
    expect(stderr).not.toContain("Both ");
  });
});

describe.concurrent("the command line of oxlint", () => {
  const oxlintrc = JSON.stringify({ categories: { correctness: "off" }, rules: { "no-var": "warn" } });

  test.each([
    [["--nonsense"], "Invalid option '--nonsense'"],
    [["--threads=x"], '--threads takes a number, not "x".'],
    [["--max-warnings=x"], "Invalid value for option 'max-warnings'"],
    [["--debug=nonsense"], "couldn't parse `nonsense`: 'nonsense' is not a known debug option"],
    [["--debug=files,timings"], "debug option 'files' cannot be combined with other debug options"],
    [["-f", "nonsense"], 'There is no formatter "nonsense".'],
    [["-c", "nowhere.json"], "nowhere.json"],
    [["--tsconfig", "nowhere.json"], 'nowhere.json" does not exist, Please provide a valid tsconfig file.'],
    [
      ["--report-unused-disable-directives", "--report-unused-disable-directives-severity=warn"],
      "cannot be used together",
    ],
  ])("%j is refused with 1 beside an .oxlintrc.json, with 2 beside an eslint.config.js", async (args, why) => {
    const forOxlint = await lint({ ".oxlintrc.json": oxlintrc, "a.js": code }, args);
    // oxlint says on standard output what is wrong with a configuration, and on standard error what is wrong with the command line.
    expect(args[0] === "-c" ? forOxlint.stdout : forOxlint.stderr).toContain(why);
    expect(forOxlint.problems).toEqual([]);
    expect(forOxlint.exitCode).toBe(1);
    const forEslint = await lint({ "eslint.config.js": "module.exports = [];", "a.js": code }, args);
    expect(forEslint.stderr).toContain(why);
    expect(forEslint.exitCode).toBe(2);
  });

  test("so does a run that is oxlint's by --config, by the package.json or by a flag", async () => {
    const broken = { "broken.json": "{", "a.js": code };
    expect((await lint(broken, ["-c", "broken.json"])).exitCode).toBe(1);
    const files = { "package.json": JSON.stringify({ devDependencies: { oxlint: "*" } }), "a.js": code };
    expect((await lint(files, ["--type-check"])).exitCode).toBe(1);
    expect((await lint({ "a.js": code }, ["-D", "no-var", "--type-check"])).exitCode).toBe(1);
    // Only oxlint has the flag.
    expect((await lint({ "a.js": code }, ["--type-check"])).exitCode).toBe(1);
    expect((await lint({ "a.js": code }, ["--flavor=eslint", "--type-check"])).exitCode).toBe(2);
  });

  test("a configuration that cannot be used ends the run with 1", async () => {
    const { exitCode } = await lint({ ".oxlintrc.json": "{", "a.js": code });
    expect(exitCode).toBe(1);
  });

  test("--type-check and `options.typeCheck` report what the type checker reports", async () => {
    const files = {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true, noEmit: true, types: [], noUnusedLocals: true },
      }),
      "a.ts": [
        "interface A { a: { b: number } }",
        'export const x: A = { a: { b: "s" } };',
        "// oxlint-disable-next-line",
        'export const y: number = "y";',
        "// @ts-expect-error",
        'export const w: number = "w";',
        "var unused = 1;",
        "",
      ].join("\n"),
      "clean.ts": "export const c: number = 1;\n",
      "b.js": "export const j = 1;\nj.nope;\n",
    };
    const expected = [
      "a.ts:2:28 typescript/TS2322",
      "a.ts:4:14 typescript/TS2322",
      "a.ts:7:1 no-var",
      "a.ts:7:5 typescript/TS6133",
    ];
    const byFlags = await lint({ ...files, ".oxlintrc.json": oxlintrc }, ["--type-aware", "--type-check"]);
    expect(byFlags.problems).toEqual(expected);
    expect(byFlags.exitCode).toBe(1);
    const options = { typeAware: true, typeCheck: true };
    const byFile = await lint({ ...files, ".oxlintrc.json": JSON.stringify({ ...JSON.parse(oxlintrc), options }) });
    expect(byFile.problems).toEqual(expected);
    expect((await lint({ ...files, ".oxlintrc.json": oxlintrc }, ["--type-aware"])).problems).toEqual([
      "a.ts:7:1 no-var",
    ]);
    const alone = await lint({ ...files, ".oxlintrc.json": oxlintrc }, ["--type-check"]);
    expect(alone.stdout).toContain("The `--type-check` option requires type-aware linting.");
    expect(alone.exitCode).toBe(1);
  });

  test("--print-config prints what oxlint prints", async () => {
    using dir = tempDir("bun-lint-print-config", {
      ".oxlintrc.json": JSON.stringify({
        plugins: ["import", "typescript"],
        categories: { style: "off", correctness: "off" },
        rules: {
          "no-var": "error",
          eqeqeq: ["warn", "smart"],
          "@typescript-eslint/no-explicit-any": 2,
          "eslint/no-console": "off",
          "unicorn/no-null": "error",
        },
        settings: { react: { version: "18.2.0" }, mine: 1 },
        globals: { a: "readable", b: true, c: "off" },
        extends: ["./base.json"],
        overrides: [{ files: ["*.test.js", "./a.js", "src/*.js"], rules: { "no-var": "off", eqeqeq: [2, "always"] } }],
      }),
      "base.json": JSON.stringify({ plugins: ["react"], rules: { "no-alert": "error", "no-var": "off" } }),
    });
    await using proc = spawn({
      cmd: [...command, "--print-config", "-D", "no-eval"],
      env,
      cwd: String(dir),
      stdout: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    const { settings, ...printed } = JSON.parse(stdout);
    expect(Object.entries(printed)).toEqual([
      ["plugins", ["react", "typescript", "import"]],
      ["categories", { correctness: "allow", style: "allow" }],
      [
        "rules",
        {
          eqeqeq: ["warn", ["smart"]],
          "no-alert": "deny",
          "no-console": "allow",
          "no-eval": "deny",
          "no-var": "deny",
          "typescript/no-explicit-any": "deny",
        },
      ],
      ["env", { builtin: true }],
      ["globals", { a: "readonly", b: "writable", c: "off" }],
      [
        "overrides",
        [
          {
            files: ["**/*.test.js", "a.js", "src/*.js"],
            env: null,
            globals: null,
            plugins: null,
            rules: { "no-var": "allow", eqeqeq: ["deny", ["always"]] },
          },
        ],
      ],
      ["ignorePatterns", []],
      ["extends", ["./base.json"]],
    ]);
    expect(Object.keys(printed.rules)).toEqual(Object.keys(printed.rules).toSorted());
    expect(Object.keys(settings)).toEqual(["jsx-a11y", "next", "react", "jsdoc", "vitest", "jest"]);
    expect(settings.react.version).toBe("18.2.0");
    expect(stdout.endsWith("\n}\n")).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("--threads=0", async () => {
    const { problems, exitCode } = await lint({ ".oxlintrc.json": oxlintrc, "a.js": code }, ["--threads=0"]);
    expect(problems).toEqual(["a.js:1:1 no-var"]);
    expect(exitCode).toBe(0);
  });

  test("--ignore-path names the file that is read instead of .eslintignore", async () => {
    const files = {
      ".oxlintrc.json": oxlintrc,
      ".eslintignore": "a.js\n",
      "mine": "b.js\n",
      "a.js": code,
      "b.js": code,
    };
    expect((await lint(files)).problems).toEqual(["b.js:1:1 no-var"]);
    expect((await lint(files, ["--ignore-path=mine"])).problems).toEqual(["a.js:1:1 no-var"]);
  });

  test("--init writes the defaults of oxlint, and not over a file", async () => {
    using dir = tempDir("bun-lint-init", { "a.js": "debugger;\n" });
    const run = async (...args: string[]) => {
      await using proc = spawn({
        cmd: [...command, ...args],
        env,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr: normalizeBunSnapshot(stderr, String(dir)), exitCode };
    };
    expect(await run("--init")).toEqual({ stdout: "Configuration file created\n", stderr: "", exitCode: 0 });
    expect(JSON.parse(readFileSync(join(String(dir), ".oxlintrc.json"), "utf8"))).toEqual({
      $schema: "./node_modules/oxlint/configuration_schema.json",
      plugins: ["typescript", "unicorn", "oxc"],
      categories: { correctness: "error" },
      rules: {},
      env: { builtin: true },
    });
    const again = await run("--init");
    expect(normalizeBunSnapshot(again.stdout, String(dir))).toContain("<dir>/.oxlintrc.json exists already.");
    expect(again.exitCode).toBe(1);
    // It is one that can be used.
    expect((await run("--allow-unsupported", "a.js")).exitCode).toBe(1);
  });

  test.each(["eslint.config.mjs", ".eslintrc.json"])(
    "--init beside %s writes nothing unless --flavor=oxlint",
    async name => {
      using dir = tempDir("bun-lint-init", {
        [name]: name.endsWith(".json") ? rc(noVar) : "export default [];",
        "sub/a.js": code,
      });
      const run = async (...args: string[]) => {
        await using proc = spawn({
          cmd: [...command, ...args],
          env,
          cwd: join(String(dir), "sub"),
          stderr: "pipe",
        });
        const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
        return { stderr: normalizeBunSnapshot(stderr, String(dir)), exitCode };
      };
      const refused = await run("--init");
      expect(refused.stderr).toContain(`which would count in place of <dir>/${name}. Use --flavor=oxlint to write it.`);
      expect(refused.exitCode).toBe(2);
      expect(existsSync(join(String(dir), "sub", ".oxlintrc.json"))).toBe(false);
      expect((await run("--init", "--flavor=oxlint")).exitCode).toBe(0);
      expect(existsSync(join(String(dir), "sub", ".oxlintrc.json"))).toBe(true);
    },
  );

  test("node_modules is a directory like any other, which a .gitignore has", async () => {
    const files = {
      ".oxlintrc.json": oxlintrc,
      "a.js": code,
      "node_modules/p/b.js": code,
      "fixtures/node_modules/p/c.js": code,
    };
    expect((await lint(files)).problems).toEqual([
      "a.js:1:1 no-var",
      "fixtures/node_modules/p/c.js:1:1 no-var",
      "node_modules/p/b.js:1:1 no-var",
    ]);
    const ignored = await lint({ ...files, ".gitignore": "node_modules\n!fixtures/node_modules\n" });
    expect(ignored.problems).toEqual(["a.js:1:1 no-var", "fixtures/node_modules/p/c.js:1:1 no-var"]);
  });
});

describe.concurrent("what the configuration asks for and cannot be done", () => {
  const files = {
    // ESLint 8 has the two rules. ESLint 9 has removed them.
    ".eslintrc.json": rc({
      env: { es6: true },
      rules: { "no-var": "error", "require-jsdoc": "warn", "valid-jsdoc": "error", "no-rule-that-is-off": "off" },
    }),
    "a.js": code,
  };

  test("a rule that does not exist: the rest is linted, and the run fails", async () => {
    const { problems, stderr, exitCode } = await lint(files);
    expect(problems).toEqual(["a.js:1:1 no-var"]);
    expect(stderr).toContain("2 rules of ESLint did not run: require-jsdoc, valid-jsdoc");
    expect(stderr).not.toContain("no-rule-that-is-off");
    expect(stderr).toContain("--allow-unsupported makes this a warning.");
    expect(exitCode).toBe(2);
  });

  test("it fails where nothing else is wrong, too", async () => {
    const { problems, exitCode } = await lint({ ...files, "a.js": "let x = 1;\nx;\n" });
    expect(problems).toEqual([]);
    expect(exitCode).toBe(2);
  });

  test("--allow-unsupported makes it a warning", async () => {
    const { problems, stderr, exitCode } = await lint(files, ["--allow-unsupported", "."]);
    expect(problems).toEqual(["a.js:1:1 no-var"]);
    expect(stderr).toContain("warn: 2 rules of ESLint did not run: require-jsdoc, valid-jsdoc");
    expect(exitCode).toBe(1);
    expect((await lint({ ...files, "a.js": "let x = 1;\nx;\n" }, ["--allow-unsupported", "."])).exitCode).toBe(0);
  });

  test("files in a language that is not read here", async () => {
    const files = {
      "eslint.config.mjs": `export default [
        { rules: { "no-var": "error" } },
        { files: ["**/*.one", "**/*.two"], plugins: { p: { languages: { l: {} } } }, language: "p/l" },
      ];`,
      "a.js": code,
      "b.one": "",
      "c.one": "",
      "d.one": "",
      "e.two": "",
    };
    const { problems, stderr, exitCode } = await lint(files);
    expect(problems).toEqual(["a.js:1:1 no-var"]);
    expect(stderr).toContain(
      "4 files were not linted, only JavaScript and TypeScript can be (3 *.one, 1 *.two): b.one, c.one, d.one, ..",
    );
    expect(exitCode).toBe(2);
    expect((await lint(files, ["--allow-unsupported", "."])).exitCode).toBe(1);
  });
});

// As ESLint 10.12 with eslint-plugin-import 2.32.0 and eslint-plugin-react 7.37.5: `" ".repeat(n)` throws beyond the longest string that
// JavaScript has, 2 ** 29 - 24, and for a negative n: the rule throws, which ends the run. Below that ESLint reports as ever, in a format
// that does not print the fixes: its `json` throws over them.
describe.concurrent("a number in the options of a rule that is the length of a text", () => {
  const indented = "if (a) {\n  b();\n}\n";
  const element = 'const a = (\n  <b\n    c="d"\n  >\n    <e />\n  </b>\n);\n';
  const tooLong = "RangeError: Invalid string length";
  test.each<
    [rule: string, option: unknown, file: string, text: string, thrown: [error: string, line: number] | string[]]
  >([
    ["indent", 2 ** 31, "a.js", indented, [tooLong, 1]],
    ["indent", 2 ** 53, "a.js", indented, [tooLong, 1]],
    ["indent", 2 ** 29 - 23, "a.js", indented, [tooLong, 1]],
    ["indent", 2 ** 29 - 24, "a.js", indented, ["a.js:2:1 indent"]],
    // Nothing is repeated.
    ["indent", 2 ** 31, "a.js", "a();\n", []],
    ["import/newline-after-import", { count: 2 ** 53 }, "a.js", '\nimport "a";\nb();\n', [tooLong, 2]],
    ["import/newline-after-import", { count: 2 ** 29 }, "a.js", '\nimport "a";\nb();\n', [tooLong, 2]],
    [
      "import/newline-after-import",
      { count: 2 ** 28 },
      "a.js",
      '\nimport "a";\nb();\n',
      ["a.js:2:1 import/newline-after-import"],
    ],
    // The calls are looked at when the program ends.
    ["import/newline-after-import", { count: 2 ** 31 }, "a.js", '\n\nconst a = require("a");\nb();\n', [tooLong, 1]],
    ["react/jsx-indent", 2 ** 31, "a.jsx", element, [tooLong, 2]],
    // Only twice as much is too long.
    ["react/jsx-indent", 2 ** 29 - 24, "a.jsx", element, [tooLong, 5]],
    ["react/jsx-indent", -1, "a.jsx", element, ["RangeError: Invalid count value: -1", 2]],
    ["react/jsx-indent-props", 2 ** 31, "a.jsx", element, [tooLong, 2]],
    ["react/jsx-indent-props", 2 ** 28, "a.jsx", element, ["a.jsx:3:5 react/jsx-indent-props"]],
  ])("%s: %j in %s %j", async (rule, option, file, text, expected) => {
    const files = {
      "eslint.config.mjs": `export default [{
        files: ["**/*.js", "**/*.jsx"],
        languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
        plugins: {
          import: { meta: { name: "eslint-plugin-import" }, rules: {} },
          react: { meta: { name: "eslint-plugin-react" }, rules: {} },
        },
        rules: { ${JSON.stringify(rule)}: ["error", ${JSON.stringify(option)}] },
      }];`,
      [file]: text,
    };
    const { problems, stderr, exitCode } = await lint(files, [file]);
    if (typeof expected[1] === "number") {
      expect(stderr).toContain(`${expected[0]}\nOccurred while linting <dir>/${file}:${expected[1]}\nRule: "${rule}"`);
      expect({ problems, exitCode }).toEqual({ problems: [], exitCode: 2 });
    } else {
      expect({ problems, exitCode }).toEqual({ problems: expected as string[], exitCode: expected.length ? 1 : 0 });
    }
  });

  // ESLint 8.57 names another line: that of the block.
  test("indent-legacy", async () => {
    const files = { ".eslintrc.json": rc({ rules: { "indent-legacy": ["error", 2 ** 31] } }), "a.js": indented };
    const { stderr, exitCode } = await lint(files, ["a.js"]);
    expect(stderr).toContain(`${tooLong}\nOccurred while linting <dir>/a.js:`);
    expect(stderr).toContain('\nRule: "indent-legacy"');
    expect(exitCode).toBe(2);
  });
});

// As ESLint 10.12. What is in a plugin of the configuration is known, whether or not a rule of it is on.
test.concurrent(
  "a rule that only a comment names, of a plugin of which the configuration turns no rule on",
  async () => {
    const files = {
      "eslint.config.mjs": `export default [{
      plugins: { p: { rules: { r: { create: context => ({ Program: node => context.report({ node, message: "m" }) }) } } } },
      rules: { "no-var": "error" },
    }];`,
      "a.js": `/* eslint p/r: "error" */\n${code}`,
      "b.js": `/* eslint p/r: "off" */\n// eslint-disable-next-line p/r\n${code}`,
      "c.js": `// eslint-disable-next-line p/nope\n${code}`,
    };
    const { problems, stderr, exitCode } = await lint(files, ["a.js", "b.js", "c.js"]);
    // In b.js the directive is unused.
    expect(problems).toEqual([
      "a.js:1:1 p/r",
      "a.js:2:1 no-var",
      "b.js:2:1 -",
      "b.js:3:1 no-var",
      "c.js:1:1 p/nope",
      "c.js:2:1 no-var",
    ]);
    expect(stderr).not.toContain("did not run");
    expect(exitCode).toBe(1);
  },
);

// ───────────── paths, as each system writes and compares them ─────────────

// `bun lint --run-path-tests` is compiled into debug and canary builds only.
const hasRunner = isDebug || Bun.spawnSync({ cmd: [bunExe(), "--revision"], env: bunEnv }).stdout.includes("canary");

const quiet = { categories: { correctness: "off" } };

// A configuration goes by what a base path looks like, so what it makes of the paths of Windows is tested on every system. What is
// expected of the flat ones is what `ConfigArray` of @eslint/config-array 0.23.5 answers, which goes by that too.
describe.skipIf(!hasRunner)("the paths of Windows, on every system", () => {
  async function configurations(cases: object[]) {
    using dir = tempDir("bun-lint-paths", { "cases.json": JSON.stringify(cases) });
    await using proc = spawn({
      cmd: [...command, "--run-path-tests", "configurations", join(String(dir), "cases.json")],
      env,
      // Not where a `package.json` has a script `lint`.
      cwd: String(dir),
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(exitCode).toBe(0);
    return JSON.parse(stdout);
  }

  test("what is in a directory is in it however the two are spelled", async () => {
    expect(
      await configurations([
        {
          basePath: "c:/proj",
          config: [noVar],
          files: ["C:/proj/src/a.js", "c:/PROJ/src/a.js", "D:/proj/src/a.js", "C:/project/a.js"],
        },
        {
          basePath: "C:/proj",
          config: [
            { basePath: String.raw`c:\Proj\SRC`, files: ["*.js"], ...noVar },
            { basePath: "C:/PROJ", ignores: ["src/ignored.js"] },
          ],
          files: ["C:/proj/src/a.js", "C:/proj/src/ignored.js", "C:/proj/src/deep/a.js", "C:/proj/SRC/a.js"],
        },
        { basePath: "C:/proj/Ünï", config: [noVar], files: ["C:/proj/üNÏ/a.js"] },
        // Elsewhere it is not.
        { basePath: "/proj", config: [noVar], files: ["/proj/a.js", "/PROJ/a.js"] },
      ]),
    ).toEqual([
      { files: [["no-var"], ["no-var"], "external", "external"], directories: [] },
      { files: [["no-var"], "ignored", [], ["no-var"]], directories: [] },
      { files: [["no-var"]], directories: [] },
      { files: [["no-var"], "external"], directories: [] },
    ]);
  });

  test("a share, and the root of a drive", async () => {
    const proj = "//server/share/proj";
    const onShare = (basePath: string) => ({
      basePath: proj,
      config: [{ basePath, ...noVar }, { ignores: ["dist/"] }],
      files: [`${proj}/src/a.js`, `${proj}/a.js`, "//server/share/other/a.js", `${proj}/dist/a.js`],
      directories: [`${proj}/dist`, `${proj}/src`],
    });
    const atRoot = (basePath: string) => ({
      basePath,
      config: [
        { basePath: "src", ...noVar },
        { files: ["lib/*.js"], ...eqeqeq },
      ],
      files: ["X:/src/a.js", "X:/lib/a.js", "x:/lib/a.js", "X:/a.js"],
    });
    const share = { files: [["no-var"], [], "external", "ignored"], directories: [true, false] };
    const root = { files: [["no-var"], ["eqeqeq"], ["eqeqeq"], []], directories: [] };
    expect(
      await configurations([
        onShare(String.raw`\\SERVER\Share\proj\src`),
        onShare("//server/share/proj/src"),
        onShare("src"),
        atRoot("X:/"),
        atRoot("X:"),
        // What has no configuration file has one in which everything is.
        { basePath: "/", config: [noVar], files: ["C:/a/b.js", "D:/a/b.js", `${proj}/a.js`] },
      ]),
    ).toEqual([share, share, share, root, root, { files: [["no-var"], ["no-var"], ["no-var"]], directories: [] }]);
  });

  test("`ignorePatterns` of oxlint say nothing about what is outside", async () => {
    const config = { ...quiet, ...noVar, ignorePatterns: ["*.js"] };
    const expected = { files: [["no-var"], "ignored"], directories: [] };
    expect(
      await configurations([
        { basePath: "/proj/config", flavor: "oxlint", config, files: ["/proj/src/a.js", "/proj/config/a.js"] },
        { basePath: "C:/proj/config", flavor: "oxlint", config, files: ["C:/proj/src/a.js", "C:/proj/config/a.js"] },
      ]),
    ).toEqual([expected, expected]);
  });

  test.each(["oxlint", "eslintrc"])("`extends` of %s with `\\`", async flavor => {
    const [{ error, files }] = await configurations([
      {
        basePath: "C:/proj",
        flavor,
        config: { ...(flavor === "oxlint" ? quiet : { root: true }), extends: [String.raw`..\shared\base.json`] },
        // What it extends in turn is next to it.
        extended: {
          "C:/shared/base.json": { extends: [String.raw`.\more.json`], ...eqeqeq },
          "C:/shared/more.json": noVar,
          "C:/proj/more.json": { rules: { "no-debugger": "error" } },
        },
        files: ["C:/proj/a.js"],
      },
    ]);
    expect(error).toBeUndefined();
    expect(files.map((it: string[]) => it.toSorted())).toEqual([["eqeqeq", "no-var"]]);
  });
});

describe.concurrent("paths", () => {
  test("`ignorePatterns` of a file that --config names say nothing about what is beside its directory", async () => {
    const { problems, exitCode } = await lint(
      {
        "config/.oxlintrc.json": JSON.stringify({ ...quiet, ...noVar, ignorePatterns: ["*.js"] }),
        "config/a.js": code,
        "src/a.js": code,
      },
      ["-c", "config/.oxlintrc.json", "src", "config"],
    );
    expect(problems).toEqual(["src/a.js:1:1 no-var"]);
    expect(exitCode).toBe(1);
  });
});
