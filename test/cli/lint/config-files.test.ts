import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, normalizeBunSnapshot, tempDir } from "harness";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
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

type Options = {
  cwd?: string;
  env?: Record<string, string | undefined>;
  before?: (dir: string) => void;
  /** More arguments, which have the directory in them. */
  args?: (dir: string) => string[];
};

/**
 * What is reported, as `file:line:column rule`, what else is printed, and the exit code. The format is one that is the same
 * whosever the configuration is.
 */
async function lint(files: Record<string, string>, args: string[] = ["."], options: Options = {}) {
  using dir = tempDir("bun-lint-config-files", files);
  options.before?.(String(dir));
  await using proc = spawn({
    cmd: [...command, "--threads", "2", "-f", "json-with-metadata", ...args, ...(options.args?.(String(dir)) ?? [])],
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
/** What precedes a program of src/lint/driver that runs a configuration file: `run` in evaluate.rs. */
const given = (path: string, argument: object | "" = "") =>
  `const given = ${JSON.stringify({ path, marker: "<marker>", argument: argument && JSON.stringify(argument), commandLine: [] })};\n`;
const rc = (config: object) => JSON.stringify({ root: true, ...config });
const eqeqeq = { rules: { eqeqeq: "error" } };
const noVar = { rules: { "no-var": "error" } };
const yaml = (rule: string) => `root: true\nrules:\n  ${rule}: error\n`;
/** Whether the temporary directory is in a repository. */
const isInRepository = (function look(directory: string): boolean {
  const isRoot = [".git", ".jj"].some(name => existsSync(join(directory, name)));
  return isRoot || (dirname(directory) !== directory && look(dirname(directory)));
})(realpathSync(tmpdir()));

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
    expect(stderr).toContain(`Config "mine": Key "${key}": Functions are not supported, at user-defined index 1.`);
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
        "--no-install",
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
      cmd: [bunExe(), "--no-install", "-e", given("C:/t/.eslintrc.json", { pluginsFrom: "C:/t", content }) + source],
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
      cmd: [bunExe(), "--no-install", "-e", given("C:/t/.eslintrc.json", { pluginsFrom: "C:/t", content }) + source],
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
      cmd: [bunExe(), "--no-install", "-e", given(path, { pluginsFrom: root }) + source.join("")],
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
          cmd: [bunExe(), "--no-install", "-e", given(path) + source.join("")],
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
      "1 file was not linted because only the parser in your config can read it: b.mjs\n  To lint with that parser, install eslint: bun add -d eslint",
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
      "note: @typescript-eslint/eslint-plugin 8.43.0 is installed, but bun lint's built-in rules match 8.71.1",
    ]);
    expect(await notes(typescript("7.18.0"))).toEqual([
      "note: @typescript-eslint/eslint-plugin 7.18.0 is installed, but bun lint's built-in rules match 8.71.1",
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
      "note: eslint-plugin-n 17.16.2 is installed, but bun lint's built-in rules match 18.4.1",
      "note: eslint-plugin-import 2.31.0 is installed, but bun lint's built-in rules match 2.32.0",
      "note: eslint-plugin-react-hooks 5.2.0 is installed, but bun lint's built-in rules match 7.1.1",
      "note: eslint-plugin-react 7.33.2 is installed, but bun lint's built-in rules match 7.37.5",
    ]);
  });

  test("not by less, not if it is later, not if it does not say, not for a plugin that runs in JavaScript", async () => {
    for (const version of ["8.71.0", "8.71.9", "8.72.0", "9.0.0", undefined, "next"]) {
      expect([version, await notes(typescript(version))]).toEqual([version, []]);
    }
    expect(await notes(flat({ ts: { name: "@typescript-eslint/eslint-plugin", version: "8.43.0" } }))).toEqual([]);
    expect(await notes(flat({ n: { name: "eslint-plugin-node", version: "11.1.0" } }))).toEqual([]);
  });

  // eslint-plugin-react-hooks 7.1.1 ships with `meta.version: "7.0.0"`.
  test("the version in the package's package.json wins over a stale meta.version", async () => {
    const hooks = flat({ "react-hooks": { name: "eslint-plugin-react-hooks", version: "7.0.0" } });
    const installed = (version: string) => ({
      "node_modules/eslint-plugin-react-hooks/package.json": JSON.stringify({
        name: "eslint-plugin-react-hooks",
        version,
      }),
    });
    expect(await notes({ ...hooks, ...installed("7.1.1") })).toEqual([]);
    expect(await notes({ ...hooks, ...installed("6.1.0") })).toEqual([
      "note: eslint-plugin-react-hooks 6.1.0 is installed, but bun lint's built-in rules match 7.1.1",
    ]);
    expect(await notes(hooks)).toEqual([
      "note: eslint-plugin-react-hooks 7.0.0 is installed, but bun lint's built-in rules match 7.1.1",
    ]);
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
      "note: @typescript-eslint/eslint-plugin 5.62.0 is installed, but bun lint's built-in rules match 8.71.1",
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
    const run = async (more: Record<string, string> = {}, flags: string[] = []) => {
      await using proc = spawn({
        cmd: [...command, "--threads", "2", "-f", "unix", ...flags, "a.js"],
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

  // As ESLint 10.12.0.
  test(
    "what it makes of the command line holds for that run",
    async () => {
      using it = project({
        "eslint.config.mjs": `export default [
          { rules: { "no-var": process.argv.includes("--fix") ? "error" : "off", eqeqeq: "error" } },
        ];`,
      });
      const text = () => readFileSync(join(it.root, "a.js"), "utf8");
      expect([await it.run(), text()]).toEqual([["eqeqeq"], code]);
      expect([await it.run({}, ["--fix"]), text()]).toEqual([["eqeqeq"], code.replace("var", "let")]);
      it.write("a.js", code);
      expect([await it.run(), text()]).toEqual([["eqeqeq"], code]);
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

// As ESLint 10.12.0 and oxlint 1.87.0, which read a configuration in Node. `bun run` does not hand it to a script either.
test.concurrent.each([
  ["eslint.config.mjs", (rules: string) => `export default [{ rules: ${rules} }];`],
  ["oxlint.config.ts", (rules: string) => `export default { categories: { correctness: "off" }, rules: ${rules} };`],
])("the .env of the project is not in `process.env` of %s, and what is inherited is", async (name, config) => {
  const rules = `{ "no-var": process.env.FROM_FILE ? "error" : "off", eqeqeq: process.env.INHERITED ? "error" : "off" }`;
  const files = { ".env": "FROM_FILE=1\n", [name]: config(rules), "a.js": code };
  const result = await lint(files, ["a.js"], { env: { INHERITED: "1" } });
  expect(result.problems).toEqual(["a.js:2:7 eqeqeq"]);
  expect(result.exitCode).toBe(1);
});

// As ESLint 10.12.0 and oxlint 1.87.0, which read a configuration in Node. On Windows it still runs.
test.skipIf(isWindows).each([
  ["eslint.config.mjs", (rules: string) => `export default [{ rules: ${rules} }];`],
  ["oxlint.config.ts", (rules: string) => `export default { categories: { correctness: "off" }, rules: ${rules} };`],
])("a `preload` of bunfig.toml does not run before %s", async (name, config) => {
  const files = {
    "bunfig.toml": 'preload = ["./preload.ts"]\n',
    "preload.ts": "globalThis.PRELOADED = true;\n",
    [name]: config(`{ "no-var": globalThis.PRELOADED ? "error" : "off", eqeqeq: "error" }`),
    "a.js": code,
  };
  const result = await lint(files, ["a.js"]);
  expect(result.problems).toEqual(["a.js:2:7 eqeqeq"]);
  expect(result.exitCode).toBe(1);
});

// ESLint 10.12.0 and oxlint 1.87.0 read a configuration in their own process: `[node, <the tool>, ...arguments]`.
describe.concurrent("`process.argv` of a configuration is the command line", () => {
  const kinds: [string, (rules: string) => string][] = [
    ["eslint.config.mjs", rules => `export default [{ rules: ${rules} }];`],
    ["oxlint.config.ts", rules => `export default { categories: { correctness: "off" }, rules: ${rules} };`],
    [".eslintrc.cjs", rules => `module.exports = { root: true, rules: ${rules} };`],
  ];
  const before = ["lint", "--threads", "2", "-f", "json-with-metadata"];
  /** Reports `var` if it sees `args`, and nothing else, after what `lint` begins with. Else the run fails and says what it sees. */
  const sees = (args: string[]) => `
    const seen = JSON.stringify(process.argv.slice(1));
    if (seen !== ${JSON.stringify(JSON.stringify([...before, ...args]))} || process.argv[0] !== process.execPath)
      throw new Error(seen);
    if (JSON.stringify(Bun.argv) !== JSON.stringify(process.argv)) throw new Error(JSON.stringify(Bun.argv));\n`;

  test.each(kinds)("%s", async (name, config) => {
    const args = ["--fix-dry-run", "a.js"];
    const files = { [name]: sees(args) + config(`{ "no-var": "off", eqeqeq: "error" }`), "a.js": code };
    const result = await lint(files, args);
    expect(result.problems).toEqual(["a.js:2:7 eqeqeq"]);
    expect(result.exitCode).toBe(1);
  });

  // `--cwd sub` once more would be `sub/sub`, `-c` a bunfig.toml, `-e` and `-p` a program, `--help` and `--version` the end.
  test.each(kinds)("the process that reads %s takes none of it for a flag of its own", async (name, config) => {
    const paths = ["a.js", "-e", "-p", "--help", "--version", "--watch", "--inspect-brk", "--silent", "--"];
    const args = ["--cwd", "sub", "-c", name, "--no-error-on-unmatched-pattern", "--", ...paths];
    const files = { [`sub/${name}`]: sees(args) + config(`{ eqeqeq: "error" }`), "sub/a.js": code };
    const result = await lint(files, args);
    expect(result.problems).toEqual(["sub/a.js:2:7 eqeqeq"]);
    expect(result.exitCode).toBe(1);
  });

  // Windows has room for 32,767 characters there.
  test.each(kinds)("the program that reads %s is not on the command line of its process", async (name, config) => {
    const rules = `{ eqeqeq: process.execArgv.join(" ").length < 200 ? "error" : "off" }`;
    const result = await lint({ [name]: config(rules), "a.js": code }, ["a.js"]);
    expect(result.problems).toEqual(["a.js:2:7 eqeqeq"]);
    expect(result.exitCode).toBe(1);
  });

  test("a plugin sees the same", async () => {
    const config = `
      const same = { meta: { schema: false }, create: context => ({ Program(node) {
        context.report({ node, message: String(JSON.stringify(context.options[0]) === JSON.stringify(process.argv)) });
      } }) };
      export default [{ plugins: { p: { rules: { same } } }, rules: { "p/same": ["error", process.argv] } }];`;
    using dir = tempDir("bun-lint-config-files", { "eslint.config.mjs": config, "a.js": code });
    await using proc = spawn({
      cmd: [...command, "-f", "unix", "--no-warn-ignored", "a.js"],
      env,
      cwd: String(dir),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(normalizeBunSnapshot(stdout, String(dir))).toBe("<dir>/a.js:1:1: true [Error/p/same]\n\n1 problem");
  });

  // It is not on the command line of the process that reads the file, nor in its environment: there is no room for it twice.
  test.skipIf(isWindows)("a command line of a megabyte", async () => {
    const names = Array.from({ length: 15_000 }, (_, index) => `a${index}`.padEnd(40, "b"));
    const args = [...names.flatMap(it => ["--global", it]), "a.js"];
    const rules = `{ eqeqeq: process.argv.length === ${1 + before.length + args.length} ? "error" : "off" }`;
    const files = { "eslint.config.mjs": `export default [{ rules: ${rules} }];`, "a.js": code };
    const result = await lint(files, args);
    expect(result.problems).toEqual(["a.js:2:7 eqeqeq"]);
    expect(result.exitCode).toBe(1);
  });
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
    return { reported, loaded: [...new Set(loaded)].sort(), failure: /^error: .*(\n.+)*/m.exec(stderr)?.[0] };
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

  // Each row is what oxlint 1.87 does. The name is the one it prints.
  test.each<[config: object, name: string | undefined]>([
    [{ rules: { "no-debugger": ["error", { a: 1 }] } }, "no-debugger"],
    [{ rules: { "no-debugger": ["off", 1] } }, "no-debugger"],
    [{ rules: { "no-debugger": ["error", null] } }, "no-debugger"],
    [{ rules: { "no-debugger": ["error", {}] } }, "no-debugger"],
    [{ rules: { "eslint/no-debugger": ["error", 1] } }, "no-debugger"],
    [{ overrides: [{ files: ["*.ts"], rules: { "no-debugger": ["error", 1] } }] }, "no-debugger"],
    [{ rules: { "@typescript-eslint/no-non-null-assertion": ["error", 1] } }, "typescript/no-non-null-assertion"],
    [{ plugins: ["jsx-a11y"], rules: { "jsx-a11y/html-has-lang": ["error", 1] } }, "jsx_a11y/html-has-lang"],
    [{ plugins: ["import"], rules: { "import-x/no-self-import": ["error", 1] } }, "import/no-self-import"],
    [{ plugins: ["jest"], rules: { "jest/no-focused-tests": ["error", 1] } }, "jest/no-focused-tests"],
    [{ plugins: ["vitest"], rules: { "vitest/no-focused-tests": ["error", 1] } }, "vitest/no-focused-tests"],
    [{ plugins: ["react"], rules: { "react/no-danger": ["error", 1] } }, "react/no-danger"],
    // The plugin is not on.
    [{ rules: { "react/no-danger": ["error", 1] } }, undefined],
    [{ rules: { "no-debugger": ["error"] } }, undefined],
    [{ rules: { eqeqeq: ["error", "always"] } }, undefined],
  ])("options for a rule of oxlint that takes none: %j", async (config, name) => {
    const files = {
      ".oxlintrc.json": JSON.stringify({ categories: { correctness: "off" }, ...config }),
      "a.js": "export {};\n",
    };
    const { stdout, exitCode } = await lint(files, ["a.js"]);
    const refusal = "This rule does not accept configuration options.";
    if (name) expect(stdout).toContain(`Invalid configuration for rule \`${name}\`:\n  ${refusal}`);
    else expect(stdout).not.toContain(refusal);
    expect(exitCode).toBe(name ? 1 : 0);
  });

  // Each row is what oxlint 1.87 says about the options of a rule: the lines below "Invalid configuration for rule", or `null` if it
  // takes them. It says everything at once, in the order of the texts.
  describe("the options of the rules of oxlint", () => {
    // prettier-ignore
    const rows: [rule: string, options: unknown[], refusal: string | null][] = [
      ["eqeqeq", ["sometimes"], "  unknown variant `sometimes`, expected `always` or `smart`, received `[ \"sometimes\" ]`"],
      ["eqeqeq", ["always", {"null": "x"}], "  unknown variant `x`, expected one of `always`, `never`, `ignore`, received `[ \"always\", { \"null\": \"x\" } ]`"],
      ["eqeqeq", ["always", {}, 1], "  invalid length 3, expected fewer elements in array, received `[ \"always\", {}, 1 ]`"],
      ["eqeqeq", [1], "  invalid type: integer `1`, expected string or map, received `[ 1 ]`"],
      ["eqeqeq", [{"always": 1}], "  invalid type: integer `1`, expected unit, received `[ { \"always\": 1 } ]`"],
      ["eqeqeq", [{}], "  invalid value: map, expected map with a single key, received `[ {} ]`"],
      ["max-lines", [-1], "  invalid type: integer `-1`, expected struct MaxLinesConfig\n  received config: `-1`"],
      ["max-lines", [{"max": -1}], "  invalid value: integer `-1`, expected u32\n  received config: `{ \"max\": -1 }`"],
      ["max-lines", [{"max": 1.5}], "  invalid type: floating point `1.5`, expected u32\n  received config: `{ \"max\": 1.5 }`"],
      ["max-lines", [{"max": 4294967296}], "  invalid value: integer `4294967296`, expected u32\n  received config: `{ \"max\": 4294967296 }`"],
      ["max-lines", ["300"], "  invalid type: string \"300\", expected struct MaxLinesConfig\n  received config: `\"300\"`"],
      ["max-lines", [{"max": "300"}], "  invalid type: string \"300\", expected u32\n  received config: `{ \"max\": \"300\" }`"],
      ["max-lines", [{"maxx": 1}], "  unknown field `maxx`, expected one of `max`, `skipBlankLines`, `skipComments`\n  received config: `{ \"maxx\": 1 }`"],
      ["max-lines", [[1, true, true, 1]], "  invalid length 4, expected fewer elements in array\n  received config: `[ 1, true, true, 1 ]`"],
      ["curly", ["nope"], "  unknown variant `nope`, expected one of `all`, `multi`, `multi-line`, `multi-or-nest`, received `[ \"nope\" ]`"],
      ["curly", ["all", "x"], "  unknown variant `x`, expected `consistent`, received `[ \"all\", \"x\" ]`"],
      ["no-debugger", [{}], "  This rule does not accept configuration options."],
      ["no-unused-vars", [{"varsIgnorePattern": "("}], "  Invalid 'varsIgnorePattern' option for no-unused-vars: regex parse error:\n    (\n    ^\nerror: unclosed group"],
      ["no-unused-vars", [{"vars": "x"}], "  Invalid 'vars' option for no-unused-vars: Expected  or all or local, got x"],
      ["no-unused-vars", [{"args": 1}], "  Invalid 'args' option for no-unused-vars: Expected a string, got 1"],
      ["no-unused-vars", [{"fix": {"imports": true}}], "  Invalid 'fix.imports' option for no-unused-vars: Expected a boolean or string, got true"],
      ["no-unused-vars", [[1, {"a": null}]], "  Invalid 'vars' option for no-unused-vars: Expected a string or an object, got [1,{\"a\":null}]"],
      ["no-unused-vars", [{"argsIgnorePattern": "(?=a)", "args": "all"}], "  Invalid 'argsIgnorePattern' option for no-unused-vars: regex parse error:\n    (?=a)\n    ^^^\nerror: look-around, including look-ahead and look-behind, is not supported"],
      ["getter-return", [{"allowImplicit": "yes"}], "  invalid type: string \"yes\", expected a boolean\n  received config: `{ \"allowImplicit\": \"yes\" }`"],
      ["getter-return", [null], "  invalid type: null, expected struct GetterReturn\n  received config: `null`"],
      ["getter-return", [[1]], "  invalid type: integer `1`, expected a boolean\n  received config: `[ 1 ]`"],
      ["getter-return", [{"zz": "a  b\u00a0c"}], "  unknown field `zz`, expected `allowImplicit`\n  received config: `{ \"zz\": \"a b c\" }`"],
      ["getter-return", [1e+21], "  invalid type: floating point `1e+21`, expected struct GetterReturn\n  received config: `1e+21`"],
      ["getter-return", [1.5e-07], "  invalid type: floating point `1.5e-7`, expected struct GetterReturn\n  received config: `1.5e-7`"],
      ["getter-return", [1e-05], "  invalid type: floating point `0.00001`, expected struct GetterReturn\n  received config: `0.00001`"],
      ["getter-return", [10000000000000000], "  invalid type: integer `10000000000000000`, expected struct GetterReturn\n  received config: `10000000000000000`"],
      ["getter-return", [123456789012], "  invalid type: integer `123456789012`, expected struct GetterReturn\n  received config: `123456789012`"],
      ["getter-return", ["a\n\"b\\\u0001\u00e9\u200b"], "  invalid type: string \"a\\n\\\"b\\\\\\u{1}\u00e9\\u{200b}\", expected struct GetterReturn\n  received config: `\"a\\n\\\"b\\\\\\u0001\u00e9\u200b\"`"],
      ["getter-return", [[true, 1]], "  invalid length 2, expected fewer elements in array\n  received config: `[ true, 1 ]`"],
      ["yoda", ["never", {"exceptRange": 1}], "  invalid type: integer `1`, expected a boolean, received `[ \"never\", { \"exceptRange\": 1 } ]`"],
      ["id-length", [{"min": -1}], "  invalid value: integer `-1`, expected u64\n  received config: `{ \"min\": -1 }`"],
      ["id-length", [{"exceptionPatterns": ["["]}], "  regex parse error:\n    [\n    ^\nerror: unclosed character class\n  received config: `{ \"exceptionPatterns\": [ \"[\" ] }`"],
      ["id-length", [{"properties": "sometimes"}], "  unknown variant `sometimes`, expected `always` or `never`\n  received config: `{ \"properties\": \"sometimes\" }`"],
      ["id-match", ["(?<n>a)(?<n>b)"], "  regex parse error:\n    (?<n>a)(?<n>b)\n       ^      ^\nerror: duplicate capture group name, received `[ \"(?<n>a)(?<n>b)\" ]`"],
      ["id-match", ["a{2,1}"], "  regex parse error:\n    a{2,1}\n     ^^^^^\nerror: invalid repetition count range, the start must be <= the end, received `[ \"a{2,1}\" ]`"],
      ["id-match", ["\\1"], "  regex parse error:\n    \\1\n    ^^\nerror: backreferences are not supported, received `[ \"\\\\1\" ]`"],
      ["id-match", ["[z-a]"], "  regex parse error:\n    [z-a]\n     ^^^\nerror: invalid character class range, the start must be <= the end, received `[ \"[z-a]\" ]`"],
      ["id-match", ["(?i-i)"], "  regex parse error:\n    (?i-i)\n      ^ ^\nerror: duplicate flag, received `[ \"(?i-i)\" ]`"],
      ["id-match", ["a\nb("], "  regex parse error:\n~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~\n1: a\n2: b(\n    ^\n~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~\nerror: unclosed group, received `[ \"a\\nb(\" ]`"],
      ["id-match", ["\\x{110000}"], "  regex parse error:\n    \\x{110000}\n       ^^^^^^\nerror: hexadecimal literal is not a Unicode scalar value, received `[ \"\\\\x{110000}\" ]`"],
      ["id-match", ["\u65e5\u672c("], "  regex parse error:\n    \u65e5\u672c(\n      ^\nerror: unclosed group, received `[ \"\u65e5\u672c(\" ]`"],
      ["id-denylist", ["a", 1], "  invalid type: integer `1`, expected a string, received `[ \"a\", 1 ]`"],
      ["func-names", ["always", {"generators": "x"}], "  unknown variant `x`, expected one of `always`, `as-needed`, `never`, received `[ \"always\", { \"generators\": \"x\" } ]`"],
      ["func-name-matching", ["x"], "  Expected configuration to match either the first or second tuple type"],
      ["func-name-matching", ["always", {"zz": 1}], "  Error deserializing second tuple element: unknown field `zz`, expected `considerPropertyDescriptor` or `includeCommonJSModuleExports`"],
      ["func-name-matching", ["always", {}, 1], "  Expected at most 2 elements in the configuration array"],
      ["func-name-matching", [{}, {}], "  Error deserializing first tuple element: invalid value: map, expected map with a single key"],
      ["logical-assignment-operators", ["never", {}], "  options object is only valid with \"always\", received `[ \"never\", {} ]`"],
      ["logical-assignment-operators", ["x"], "  unknown variant `x`, expected `always` or `never`, received `[ \"x\" ]`"],
      ["logical-assignment-operators", [1], "  expected [], [\"always\"], [\"never\"], or [\"always\", options], received `[ 1 ]`"],
      ["logical-assignment-operators", ["always", {"enforceForIfStatements": 1}], "  invalid type: integer `1`, expected a boolean, received `[ \"always\", { \"enforceForIfStatements\": 1 } ]`"],
      ["no-restricted-properties", [{}], "  expected either `object` or `property`"],
      ["no-restricted-properties", [{"object": "a", "allowObjects": ["b"]}], "  `allowObjects` requires `property`"],
      ["no-restricted-properties", [{"object": 1}], "  invalid type: integer `1`, expected a string"],
      ["no-restricted-properties", [{"object": "a"}, {"object": "a", "property": "b", "allowProperties": ["c"]}], "  `allowProperties` cannot be used with `property`"],
      ["sort-imports", [{"memberSyntaxSortOrder": ["none", "all"]}], "  memberSyntaxSortOrder must contain exactly 4 kinds, got 2\n  received config: `{ \"memberSyntaxSortOrder\": [ \"none\", \"all\" ] }`"],
      ["sort-imports", [{"memberSyntaxSortOrder": ["none", "all", "multiple", "multiple"]}], "  memberSyntaxSortOrder must contain 4 unique kinds, but duplicates were found\n  received config: `{ \"memberSyntaxSortOrder\": [ \"none\", \"all\", \"multiple\", \"multiple\" ] }`"],
      ["no-implicit-coercion", [{"allow": ["x"]}], "  Invalid operator 'x' in allow list. Valid values are: \"!!\", \"~\", \"+\", \"- -\", \"-\", \"*\"\n  received config: `{ \"allow\": [ \"x\" ] }`"],
      ["no-implicit-coercion", [{"allow": "!!"}], "  invalid type: string \"!!\", expected a sequence of operator strings\n  received config: `{ \"allow\": \"!!\" }`"],
      ["typescript/ban-ts-comment", [{"ts-check": "x"}], "  expected a boolean, `allow-with-description`, or a descriptionFormat object\n  received config: `{ \"ts-check\": \"x\" }`"],
      ["typescript/ban-ts-comment", [{"ts-check": {"descriptionFormat": "("}}], "  regex parse error:\n    (\n    ^\nerror: unclosed group\n  received config: `{ \"ts-check\": { \"descriptionFormat\": \"(\" } }`"],
      ["typescript/ban-ts-comment", [{"minimumDescriptionLength": -1}], "  invalid value: integer `-1`, expected u64\n  received config: `{ \"minimumDescriptionLength\": -1 }`"],
      ["typescript/ban-ts-comment", [{"ts-ignore": {"zz": 1}}], "  unknown field `zz`, expected `descriptionFormat`\n  received config: `{ \"ts-ignore\": { \"zz\": 1 } }`"],
      ["typescript/no-floating-promises", [{"allowForKnownSafeCalls": [{"from": "package", "name": "a"}]}], "  data did not match any variant of untagged enum TypeOrValueSpecifier\n  received config: `{ \"allowForKnownSafeCalls\": [ { \"from\": \"package\", \"name\": \"a\" } ] }`"],
      ["typescript/no-restricted-types", [{"types": {"k": false}}], "  data did not match any variant of untagged enum BanConfigValue\n  received config: `{ \"types\": { \"k\": false } }`"],
      ["typescript/array-type", [{"default": "x"}], "  unknown variant `x`, expected one of `array`, `array-simple`, `generic`\n  received config: `{ \"default\": \"x\" }`"],
      ["typescript/no-this-alias", [{"allowNames": [], "allowedNames": []}], "  duplicate field `allowedNames`\n  received config: `{ \"allowNames\": [], \"allowedNames\": [] }`"],
      ["unicorn/filename-case", [{"case": "x"}], "  unknown variant `x`, expected one of `kebabCase`, `camelCase`, `snakeCase`, `pascalCase`, `lowercase`, `screamingSnakeCase`\n  received config: `{ \"case\": \"x\" }`"],
      ["unicorn/import-style", [{"styles": {"k": true}}], "  module style override boolean must be `false`\n  received config: `{ \"styles\": { \"k\": true } }`"],
      ["react/jsx-no-literals", [{"zz": 1}], "  unknown field `zz`\n  received config: `{ \"zz\": 1 }`"],
      ["react/jsx-no-literals", [{"noStrings": 1, "elementOverrides": 1}], "  invalid type: integer `1`, expected a map\n  received config: `{ \"noStrings\": 1, \"elementOverrides\": 1 }`"],
      ["react/jsx-no-literals", [[]], "  invalid type: sequence, expected struct JsxNoLiteralsConfig\n  received config: `[]`"],
      ["react/jsx-no-script-url", [{"zz": 1}], "  Expected configuration to match either the first or second tuple type"],
      ["react/jsx-no-script-url", [[], null], "  Error deserializing second tuple element: invalid type: null, expected struct JsxNoScriptUrlOptions"],
      ["react/forbid-component-props", [{"forbid": [{"message": "a"}]}], "  data did not match any variant of untagged enum ForbidItem\n  received config: `{ \"forbid\": [ { \"message\": \"a\" } ] }`"],
      ["jsx-a11y/aria-role", [{"ignoreNonDOM": 1}], "  invalid type: integer `1`, expected a boolean\n  received config: `{ \"ignoreNonDOM\": 1 }`"],
      ["react-perf/jsx-no-new-object-as-prop", [{"nativeAllowList": "x"}], "  data did not match any variant of untagged enum NativeAllowList\n  received config: `{ \"nativeAllowList\": \"x\" }`"],
      ["jest/no-restricted-matchers", [{"toBe": 1}], "  invalid type: integer `1`, expected a string\n  received config: `{ \"toBe\": 1 }`"],
      ["jest/no-restricted-matchers", [[]], "  invalid type: sequence, expected struct NoRestrictedMatchersConfig\n  received config: `[]`"],
      ["jest/max-expects", [{"max": "x"}], "  invalid type: string \"x\", expected u32\n  received config: `{ \"max\": \"x\" }`"],
      ["vitest/max-expects", [{"max": -1}], "  invalid value: integer `-1`, expected u32\n  received config: `{ \"max\": -1 }`"],
      ["import/no-cycle", [{"maxDepth": -1}], "  invalid value: integer `-1`, expected u32\n  received config: `{ \"maxDepth\": -1 }`"],
      ["import/first", ["x"], "  unknown variant `x`, expected `absolute-first` or `disable-absolute-first`\n  received config: `\"x\"`"],
      ["import/no-nodejs-modules", [{}], "  missing field `allow`\n  received config: `{}`"],
      ["import/no-nodejs-modules", [[]], "  invalid length 0, expected struct NoNodejsModulesConfig with 1 element\n  received config: `[]`"],
      ["no-invalid-regexp", [{"allowConstructorFlags": ["ab"]}], "  invalid value: string \"ab\", expected a character\n  received config: `{ \"allowConstructorFlags\": [ \"ab\" ] }`"],
      ["no-invalid-regexp", [{"allowConstructorFlags": [1]}], "  invalid type: integer `1`, expected a character\n  received config: `{ \"allowConstructorFlags\": [ 1 ] }`"],
      ["no-fallthrough", [{"commentPattern": "("}], "  regex parse error:\n    (?iu)(\n         ^\nerror: unclosed group\n  received config: `{ \"commentPattern\": \"(\" }`"],
      ["capitalized-comments", ["always", {"ignorePattern": "("}], "  regex parse error:\n    ^\\s*(?:()\n        ^\nerror: unclosed group"],
      ["capitalized-comments", ["always", 1], "  invalid type: integer `1`, expected struct OptionsJson"],
      ["capitalized-comments", ["always", {"line": {"zz": 1}}], "  unknown field `zz`, expected one of `ignorePattern`, `ignoreInlineComments`, `ignoreConsecutiveComments`"],
      ["promise/param-names", [{"resolvePattern": "["}], "  regex parse error:\n    [\n    ^\nerror: unclosed character class\n  received config: `{ \"resolvePattern\": \"[\" }`"],
      ["one-var", [1], "  data did not match any variant of untagged enum OneVarConfig\n  received config: `1`"],
      ["prefer-destructuring", [{"zz": 1}], "  data did not match any variant of untagged enum PreferDestructuringOption, received `[ { \"zz\": 1 } ]`"],
      ["complexity", [{"max": 1, "maximum": 2}], "  duplicate field `max`\n  received config: `{ \"max\": 1, \"maximum\": 2 }`"],
      ["complexity", ["x"], "  invalid type: string \"x\", expected struct ComplexityConfig\n  received config: `\"x\"`"],
      ["jsdoc/require-param", [1], "  invalid type: integer `1`, expected struct RequireParamConfig"],
      ["vue/max-props", [{"maxProps": -1}], "  invalid value: integer `-1`, expected u32\n  received config: `{ \"maxProps\": -1 }`"],
      ["jsdoc/require-param-name", [1], "  This rule does not accept configuration options."],
      ["no-empty-function", [{"allow": ["x"]}], "  unknown variant `x`, expected one of `function`, `functions`, `arrow-functions`, `arrowFunctions`, `generator-functions`, `generatorFunctions`, `method`, `methods`, `generator-methods`, `generatorMethods`, `getter`, `getters`, `setter`, `setters`, `constructor`, `constructors`, `async-functions`, `asyncFunctions`, `async-methods`, `asyncMethods`, `private-constructors`, `privateConstructors`, `protected-constructors`, `protectedConstructors`, `decorated-functions`, `decoratedFunctions`, `override-methods`, `overrideMethods`\n  received config: `{ \"allow\": [ \"x\" ] }`"],
      ["node/no-new-require", [1], "  This rule does not accept configuration options."],
      ["nextjs/no-img-element", [null], "  This rule does not accept configuration options."],
      ["oxc/no-barrel-file", [{"threshold": "x"}], "  invalid type: string \"x\", expected u32\n  received config: `{ \"threshold\": \"x\" }`"],
      ["vue/no-reserved-props", [{"vueVersion": 4}], "  vueVersion must be either 2 or 3\n  received config: `{ \"vueVersion\": 4 }`"],
      ["vue/no-reserved-props", [{"vueVersion": 256}], "  invalid value: integer `256`, expected u8\n  received config: `{ \"vueVersion\": 256 }`"],
      ["vue/no-reserved-props", [[1, 1]], "  vueVersion must be either 2 or 3\n  received config: `[ 1, 1 ]`"],
      ["jsx-a11y/control-has-associated-label", [{"depth": 26, "labelAttributes": 1}], "  depth must be less than or equal to 25\n  received config: `{ \"depth\": 26, \"labelAttributes\": 1 }`"],
      ["jsx-a11y/control-has-associated-label", [{"labelAttributes": 1, "depth": 26}], "  invalid type: integer `1`, expected a sequence\n  received config: `{ \"labelAttributes\": 1, \"depth\": 26 }`"],
      ["jest/expect-expect", [{"assertFunctionNames": [1, "a.(.b"]}], "  invalid assert function pattern `a.(.b`: regex parse error:\n    (?ui)^a\\.(\\.b(\\.|$)\n             ^\nerror: unclosed group"],
      ["jest/expect-expect", [{"assertFunctionNames": ["**("]}], "  invalid assert function pattern `**(`: regex parse error:\n    (?ui)^[a-z\\d]*[a-z\\d]*((\\.|$)\n                          ^\nerror: unclosed group"],
      ["vitest/expect-expect", [{"assertFunctionNames": ["["]}], "  invalid assert function pattern `[`: regex parse error:\n    (?ui)^[(\\.|$)\n          ^\nerror: unclosed character class"],
      ["jest/prefer-ending-with-an-expect", [{"assertFunctionNames": ["a", "["]}], "  regex parse error:\n    (?ui)^[(\\.|$)\n          ^\nerror: unclosed character class\n  received config: `{ \"assertFunctionNames\": [ \"a\", \"[\" ] }`"],
      ["jest/prefer-ending-with-an-expect", [{"assertFunctionNames": ["(", 1]}], "  invalid type: integer `1`, expected a string\n  received config: `{ \"assertFunctionNames\": [ \"(\", 1 ] }`"],
      ["jest/prefer-ending-with-an-expect", [{"assertFunctionNames": ["("], "zz": 1}], "  regex parse error:\n    (?ui)^((\\.|$)\n          ^\nerror: unclosed group\n  received config: `{ \"assertFunctionNames\": [ \"(\" ], \"zz\": 1 }`"],
      ["no-restricted-globals", ["a", {"globals": 1}], "  Expected 'object' property to be an array"],
      ["no-restricted-globals", [{"globals": ["a", 1]}], "  Expected 'globals' array to contain either strings or objects"],
      ["one-var", [[null, null]], "  data did not match any variant of untagged enum OneVarConfig\n  received config: `[ null, null ]`"],
      ["react/forbid-elements", [{"forbid": [["x", null]]}], "  data did not match any variant of untagged enum ForbidItem\n  received config: `{ \"forbid\": [ [ \"x\", null ] ] }`"],
      ["react/forbid-dom-props", [{"forbid": [[null, null, null, "x"]]}], "  data did not match any variant of untagged enum ForbidDomPropsItem\n  received config: `{ \"forbid\": [ [ null, null, null, \"x\" ] ] }`"],
      ["typescript/no-restricted-types", [{"types": {"k": [null, null, null]}}], "  data did not match any variant of untagged enum BanConfigValue\n  received config: `{ \"types\": { \"k\": [ null, null, null ] } }`"],
      ["capitalized-comments", ["always", {"line": []}], "  invalid length 1, expected struct CommentConfigJson with 3 elements"],
      ["capitalized-comments", ["always", {"block": ["a", true]}], "  invalid length 2, expected struct CommentConfigJson with 3 elements"],
      ["react/jsx-fragments", [{"mode": "x"}], "  data did not match any variant of untagged enum JsxFragments\n  received config: `{ \"mode\": \"x\" }`"],
      ["react/jsx-fragments", [["syntax"]], "  data did not match any variant of untagged enum JsxFragments\n  received config: `[ \"syntax\" ]`"],
      ["id-match", ["(?-u)\\xFF"], "  regex parse error:\n    (?-u)\\xFF\n         ^^^^\nerror: pattern can match invalid UTF-8, received `[ \"(?-u)\\\\xFF\" ]`"],
      ["id-match", ["(?-u:[^a])"], "  regex parse error:\n    (?-u:[^a])\n         ^^^^\nerror: pattern can match invalid UTF-8, received `[ \"(?-u:[^a])\" ]`"],
      ["id-match", ["(?-u)[\u00e9]"], "  regex parse error:\n    (?-u)[\u00e9]\n          ^\nerror: Unicode not allowed here, received `[ \"(?-u)[\u00e9]\" ]`"],
      ["id-match", ["a\\pXb"], "  regex parse error:\n    a\\pXb\n     ^^^\nerror: Unicode property not found, received `[ \"a\\\\pXb\" ]`"],
      ["vue/no-reserved-props", [{"vueVersion": 2}], null],
      ["jsx-a11y/control-has-associated-label", [{"depth": 25}], null],
      ["jest/expect-expect", [{"assertFunctionNames": ["a.*.b", "**", "x*", "+"], "additionalTestBlockFunctions": ["("]}], null],
      ["jest/expect-expect", ["("], null],
      ["jest/expect-expect", [{"assertFunctionNames": "("}], null],
      ["jest/prefer-ending-with-an-expect", [{"assertFunctionNames": ["a.*.b", "**"], "additionalTestBlockFunctions": ["("]}], null],
      ["no-restricted-globals", ["a", {"name": "b", "message": "m"}, 1], null],
      ["no-restricted-globals", [{"globals": ["a", {"name": 1}], "checkGlobalObject": 1}], null],
      ["one-var", [[null, true]], null],
      ["react/forbid-dom-props", [{"forbid": [["x", null, null, null]]}], null],
      ["capitalized-comments", ["always", {"line": [null, null, null]}], null],
      ["react/jsx-fragments", [{"mode": "element", "zz": 1}], null],
      ["id-match", ["(?-u)\u00e9\\x{FF}\\B((?u).)"], null],
      ["id-match", ["\\pl\\p{Greek}"], null],
      ["no-use-before-define", ["x"], "  invalid type: string \"x\", expected struct NoUseBeforeDefineConfig\n  received config: `\"x\"`"],
      ["no-use-before-define", ["nofunc"], null],
      ["eqeqeq", ["always", {"null": "ignore"}], null],
      ["eqeqeq", ["smart"], null],
      ["eqeqeq", [{"always": null}], null],
      ["eqeqeq", [], null],
      ["max-lines", [300], null],
      ["max-lines", [{"max": 300, "skipComments": true}], null],
      ["max-lines", [0], null],
      ["max-lines", [1, 2], null],
      ["max-lines", [[1, true]], null],
      ["curly", ["multi", "consistent"], null],
      ["curly", ["all", null], null],
      ["getter-return", [{}], null],
      ["getter-return", [{}, {"zz": 1}], null],
      ["getter-return", [[]], null],
      ["getter-return", [[true]], null],
      ["no-unused-vars", [{"zz": 1}], null],
      ["no-unused-vars", [null], null],
      ["no-unused-vars", [{"varsIgnorePattern": "^_"}], null],
      ["no-unused-vars", [{"caughtErrors": true}], null],
      ["no-unused-vars", [{"varsIgnorePattern": 1}], null],
      ["no-unused-vars", ["local"], null],
      ["id-match", ["^[a-z]+$", {"properties": true}], null],
      ["id-match", ["(?x) a # c"], null],
      ["id-match", ["[[:alpha:]&&[^a]]\\b{start}\\p{Greek}\\x{41}"], null],
      ["func-name-matching", [{}], null],
      ["func-name-matching", ["never"], null],
      ["func-name-matching", ["always", {}], null],
      ["logical-assignment-operators", ["always", {"enforceForIfStatements": true}], null],
      ["logical-assignment-operators", ["never"], null],
      ["no-restricted-properties", [{"object": "a"}, {"property": "b", "allowObjects": ["c"]}], null],
      ["typescript/ban-ts-comment", [{"ts-check": {"descriptionFormat": "^: .+$"}, "ts-ignore": "allow-with-description", "ts-nocheck": true}], null],
      ["typescript/no-floating-promises", [{"allowForKnownSafeCalls": ["a", {"from": "file", "name": ["a"], "path": null}, {"from": "package", "name": "a", "package": "p"}]}], null],
      ["typescript/no-restricted-types", [{"types": {"a": true, "b": "m", "c": {"message": null, "fixWith": "d"}}}], null],
      ["radix", ["x"], null],
      ["max-statements", ["x"], null],
      ["no-restricted-imports", [{"paths": 1}], null],
      ["react/jsx-no-literals", [{"elementOverrides": {"a": {"allowElement": true, "noStrings": true}}, "noStrings": true}], null],
      ["react/forbid-component-props", [{"forbid": ["a", {"propName": "b", "message": null}, {"propNamePattern": "c"}]}], null],
      ["sort-imports", [{"memberSyntaxSortOrder": ["single", "multiple", "all", "none"]}], null],
      ["unicorn/import-style", [{"styles": {"k": false, "l": {"named": true}}}], null],
      ["jest/no-restricted-matchers", [{"toBe": "m", "toEqual": null}], null],
      ["capitalized-comments", ["x", {"zz": 1, "ignorePattern": "a", "line": {"ignoreInlineComments": true}}, 1], null],
      ["complexity", [20], null],
      ["complexity", [{"maximum": 2, "variant": "modified"}], null],
      ["no-invalid-regexp", [{"allowConstructorFlags": ["a", "\u00e9"]}], null],
    ];
    const plugins = [...new Set(rows.flatMap(([rule]) => (rule.includes("/") ? [rule.split("/")[0]] : [])))];
    // A rule is once in a file.
    const rounds: (typeof rows)[] = [];
    for (const row of rows) {
      const round = rounds.find(it => it.every(other => other[0] !== row[0]));
      if (round) round.push(row);
      else rounds.push([row]);
    }

    test.each(rounds.map((round, at) => [at, round] as const))("file %i", async (_, round) => {
      const rules = Object.fromEntries(round.map(([rule, options]) => [rule, ["off", ...options]]));
      const files = {
        ".oxlintrc.json": JSON.stringify({ plugins, categories: { correctness: "off" }, rules }),
        "a.js": "export {};\n",
      };
      const { raw, exitCode } = await lint(files, ["a.js"]);
      const expected = round
        .filter(it => it[2] !== null)
        .map(([rule, , refusal]) => {
          const name = rule.replace(/^(jsx|react)-(a11y|perf)\//, "$1_$2/");
          return `Invalid configuration for rule \`${name}\`:\n${refusal}`;
        })
        .sort();
      const at = raw.indexOf("Invalid configuration");
      expect(at < 0 ? "" : raw.slice(at).trimEnd()).toBe(expected.join("\n\n"));
      expect(exitCode).toBe(expected.length > 0 ? 1 : 0);
    });

    const bad = (word: string) => ["error", word];
    const said = async (config: object, extended: object = {}, flags: string[] = []) => {
      const files = {
        ".oxlintrc.json": JSON.stringify({ categories: { correctness: "off" }, ...config }),
        "extended.json": JSON.stringify(extended),
        "a.js": "export {};\n",
      };
      const { raw, exitCode } = await lint(files, [...flags, "a.js"]);
      return [[...raw.matchAll(/Invalid configuration for rule `([^`]+)`/g)].map(it => it[1]), exitCode];
    };
    const forJs = (rules: object, more: object = {}) => ({ files: ["*.js"], rules, ...more });
    const key = { "react/jsx-key": ["error", 1] };
    const extending = { extends: ["./extended.json"] };

    const looks: [name: string, rules: string[], config: object, extended?: object, flags?: string[]][] = [
      [
        "the file before its overrides",
        ["eqeqeq"],
        { rules: { eqeqeq: bad("x") }, overrides: [forJs({ curly: bad("x") })] },
      ],
      [
        "one override after the other",
        ["curly", "yoda"],
        { overrides: [forJs({ yoda: bad("x"), curly: bad("x") }), forJs({ eqeqeq: bad("x") })] },
      ],
      [
        "with what it extends",
        ["curly", "yoda"],
        { ...extending, rules: { yoda: bad("x") } },
        { rules: { curly: bad("x") } },
      ],
      ["not what it says otherwise", [], { ...extending, rules: { curly: "off" } }, { rules: { curly: bad("x") } }],
      [
        "the overrides of what it extends first",
        ["curly"],
        { ...extending, overrides: [forJs({ yoda: bad("x") })] },
        { overrides: [forJs({ curly: bad("x") })] },
      ],
      ["a plugin of what it extends", ["react/jsx-key"], extending, { plugins: ["react"], rules: key }],
      [
        "a plugin of what it extends, for its own rules",
        ["react/jsx-key"],
        { ...extending, rules: key },
        { plugins: ["react"] },
      ],
      ["its plugin, for what it extends", ["react/jsx-key"], { ...extending, plugins: ["react"] }, { rules: key }],
      ["both have plugins", ["react/jsx-key"], { ...extending, plugins: [] }, { plugins: ["react"], rules: key }],
      ["a plugin of a flag, for what it extends", ["react/jsx-key"], extending, { rules: key }, ["--react-plugin"]],
      [
        "a plugin of an override that it extends",
        ["react/jsx-key"],
        extending,
        { overrides: [forJs(key, { plugins: ["react"] })] },
      ],
      ["an override that it extends, without the plugin", [], extending, { overrides: [forJs(key)] }],
      [
        "an override that it extends, with the plugin of that file",
        ["react/jsx-key"],
        extending,
        { plugins: ["react"], overrides: [forJs(key)] },
      ],
    ];
    test.each(looks.map(it => [it[0], it] as const))("what is looked at: %s", async (_, row) => {
      const [, rules, config, extended, flags] = row;
      expect(await said(config, extended, flags)).toEqual([rules, rules.length > 0 ? 1 : 0]);
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

  // As oxlint 1.87.0.
  test.each([
    [`["./base.json"]`, "`extends[0]` must be a config object (strings/paths are not supported)."],
    [`[{ rules: {} }, "./base.json"]`, "`extends[1]` must be a config object (strings/paths are not supported)."],
    [`[{ extends: [{}, "./base.json"] }]`, "`extends[1]` must be a config object (strings/paths are not supported)."],
    [`[null]`, "`extends[0]` must be a config object (strings/paths are not supported)."],
    [`[[]]`, "`extends[0]` must be a config object (strings/paths are not supported)."],
    [`[[{}]]`, "`extends[0]` must be a config object (strings/paths are not supported)."],
    [`"./base.json"`, "`extends` must be an array of config objects (strings/paths are not supported)."],
    [`{}`, "`extends` must be an array of config objects (strings/paths are not supported)."],
    [`null`, "`extends` must be an array of config objects (strings/paths are not supported)."],
    [`0`, "`extends` must be an array of config objects (strings/paths are not supported)."],
  ])("`extends` of an oxlint.config.ts has no files: %s", async (extended, message) => {
    const { problems, stdout, exitCode } = await lint({
      "oxlint.config.ts": `export default { extends: ${extended} };`,
      "base.json": JSON.stringify({ rules: { eqeqeq: "error" } }),
      "a.js": code,
    });
    expect(problems).toEqual([]);
    expect(stdout).toContain(message);
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

  // What oxlint 1.87.0 reports. `git worktree add` writes the first. A submodule has no `commondir`.
  test.each([
    ["a working tree", "gitdir: main/.git/worktrees/x\n", "../..\n", true],
    ["\\r\\n", "gitdir: main/.git/worktrees/x\r\n", "../..\r\n", true],
    ["a directory that is named from where the process is", "gitdir: main/.git/worktrees/x\n", "main/.git\n", true],
    ["no commondir", "gitdir: main/.git/worktrees/x\n", undefined, false],
    ["no blank", "gitdir:main/.git/worktrees/x\n", "../..\n", false],
  ])("info/exclude where .git is a file: %s", async (_, pointer, commondir, isRead) => {
    const { problems } = await lint({
      ".oxlintrc.json": JSON.stringify({ ...noVar, categories: { correctness: "off" } }),
      ".git": pointer,
      ...(commondir === undefined ? {} : { "main/.git/worktrees/x/commondir": commondir }),
      "main/.git/worktrees/x/info/exclude": "gen.js\n",
      "main/.git/info/exclude": "gen.js\n",
      "gen.js": code,
      "kept.js": code,
      "sub/gen.js": code,
    });
    const all = ["gen.js:1:1 no-var", "kept.js:1:1 no-var", "sub/gen.js:1:1 no-var"];
    expect(problems).toEqual(isRead ? ["kept.js:1:1 no-var"] : all);
  });

  // What oxlint 1.87.0 lints.
  describe("a repository in a repository", () => {
    const [o, top, i, s] = ["dist/o.js", "top.js", "vendor/lib/dist/i.js", "vendor/lib/src/s.js"];
    const [d, k] = ["vendor/lib/sub/deep/dist/d.js", "vendor/lib/sub/deep/k.js"];
    const names = [o, top, i, s, d, k];
    const tree = {
      ".oxlintrc.json": JSON.stringify({ ...noVar, categories: { correctness: "off" } }),
      ...Object.fromEntries(names.map(name => [name, code])),
    };
    const [outer, inner] = [{ ".git/HEAD": "" }, { "vendor/lib/.git/HEAD": "" }];
    /** The files that are linted. */
    async function linted(files: Record<string, string>, args?: string[], options?: Options) {
      const { problems } = await lint({ ...tree, ...files }, args, options);
      return problems.map(it => it.split(":")[0]);
    }

    test.each<[string, Record<string, string>, Options]>([
      ["a directory", inner, {}],
      ["an empty directory", {}, { before: dir => mkdirSync(join(dir, "vendor", "lib", ".git")) }],
      ["a file, which a submodule has", { "vendor/lib/.git": "gitdir: ../../.git/modules/lib\n" }, {}],
      ["of Jujutsu", { "vendor/lib/.jj/working_copy/type": "" }, {}],
    ])("the .gitignore above its root does not count in it: %s", async (_, root, options) => {
      expect(await linted({ ...outer, ...root, ".gitignore": "dist/\n" }, ["."], options)).toEqual([top, i, s, d, k]);
    });

    test.each<[Record<string, string>, string[]]>([
      [{ "vendor/.gitignore": "dist/\n" }, names],
      [{ ".git/info/exclude": "src/\n" }, names],
      [{ "vendor/lib/.git/info/exclude": "src/\n" }, [o, top, i, d, k]],
      [{ "vendor/lib/.gitignore": "dist/\n", "vendor/lib/sub/deep/.git/HEAD": "" }, [o, top, s, d, k]],
      // It is not of Git.
      [{ ".gitignore": "dist/\n", ".eslintignore": "src/\n" }, [top, i, d, k]],
    ])("nor does any other file of Git, and its own do: %j", async (files, expected) => {
      expect(await linted({ ...outer, ...inner, ...files })).toEqual(expected);
    });

    test.each<[Record<string, string>, string]>([
      [{ ".gitignore": "dist/\n" }, "dist"],
      [{ ".git/info/exclude": "dist/\n" }, "dist"],
      [{ ".gitignore": "vendor/\n" }, "vendor/lib/src"],
    ])("a directory that is named is not searched if the files of Git have it: %j %s", async (files, directory) => {
      expect(await linted({ ...outer, ...files }, [directory, top])).toEqual([top]);
    });

    describe.skipIf(isInRepository)("with an argument that is in no repository", () => {
      test.each([
        ["dist", [o, s, d, k]],
        [top, [top, s, d, k]],
      ])("no root counts: %s", async (outside, expected) => {
        expect(await linted({ ...inner, ".gitignore": "i.js\n" }, ["vendor/lib", outside])).toEqual(expected);
      });
    });
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
    [{ settings: [1] }, "invalid type: integer `1`, expected struct JSXA11yPluginSettings"],
    [{ settings: [{}, {}, 1] }, "invalid type: integer `1`, expected struct ReactPluginSettings"],
    [{ settings: [{}, {}, {}, {}, {}, {}, {}] }, "invalid length 7, expected fewer elements in array"],
    [{ settings: { react: null } }, "invalid type: null, expected struct ReactPluginSettings"],
    [{ settings: { react: [1] } }, "invalid type: integer `1`, expected a sequence"],
    [{ settings: { react: { linkComponents: {} } } }, "invalid type: map, expected a sequence"],
    [{ settings: { react: { componentWrapperFunctions: [1] } } }, "invalid type: integer `1`, expected a string"],
    [
      { settings: { react: { formComponents: [{ name: "a" }] } } },
      "data did not match any variant of untagged enum CustomComponent",
    ],
    [{ settings: { "jsx-a11y": { components: { a: 1 } } } }, "invalid type: integer `1`, expected a string"],
    [{ settings: { "jsx-a11y": { attributes: { a: "b" } } } }, 'invalid type: string \\"b\\", expected a sequence'],
    [{ settings: { next: { rootDir: 1 } } }, "data did not match any variant of untagged enum OneOrMany"],
    [{ settings: { jsdoc: { ignorePrivate: 1 } } }, "invalid type: integer `1`, expected a boolean"],
    [
      { settings: { jsdoc: { tagNamePreference: { a: 1 } } } },
      "data did not match any variant of untagged enum TagNamePreference",
    ],
    [{ settings: { vitest: { typecheck: 1 } } }, "invalid type: integer `1`, expected a boolean"],
    [{ settings: { jest: null } }, "invalid type: null, expected struct JestPluginSettings"],
    [{ options: [1] }, "invalid type: integer `1`, expected a boolean"],
    [{ options: [null, null, null, -1] }, "invalid value: integer `-1`, expected usize"],
    [{ options: [null, null, null, null, null, null, null] }, "invalid length 7, expected fewer elements in array"],
    [{ options: { maxWarnings: 1.5 } }, "invalid type: floating point `1.5`, expected usize"],
    [
      { options: { reportUnusedDisableDirectives: "x" } },
      'invalid value: string \\"x\\", expected `allow`, `off`, `warn`, `deny` or `error`',
    ],
    [{ options: { reportUnusedDisableDirectives: 3 } }, "invalid value: integer `3`, expected `0`, `1` or `2`"],
    [{ options: { reportUnusedDisableDirectives: true } }, "data did not match any variant of untagged enum Repr"],
    [{ categories: { correctness: null } }, "data did not match any variant of untagged enum Repr"],
    [{ categories: { correctness: -1 } }, "data did not match any variant of untagged enum Repr"],
    [{ categories: { correctness: 3 } }, "invalid value: integer `3`, expected `0`, `1` or `2`"],
    [
      { categories: { correctness: "x" } },
      'invalid value: string \\"x\\", expected `allow`, `off`, `warn`, `deny` or `error`',
    ],
    [
      { rules: { "no-debugger": "Error" } },
      'Failed to parse rule severity, expected one of \\"allow\\", \\"off\\", \\"deny\\", \\"error\\" or \\"warn\\", but got \\"Error\\"',
    ],
    [{ rules: { "no-debugger": ["2"] } }, 'or \\"warn\\", but got \\"2\\"'],
    [{ rules: { "no-debugger": 3 } }, "Failed to parse rule severity, expected one of `0`, `1` or `2`, but got 3"],
    [{ rules: { "no-debugger": [1.5] } }, "expected one of `0`, `1` or `2`, but got 1.5"],
    [{ rules: { "no-debugger": -1 } }, "expected one of `0`, `1` or `2`, but got a negative number"],
    [
      { rules: { "no-debugger": [null, 1] } },
      "Failed to parse rule severity, expected a string or a number, but got Null",
    ],
    [
      { rules: { "no-debugger": [{ a: [1, "x", null, true, 1.5] }] } },
      'but got Object {\\"a\\": Array [Number(1), String(\\"x\\"), Null, Bool(true), Number(1.5)]}',
    ],
    [
      { rules: { "no-debugger": [] } },
      'Failed to rule value \\"[]\\" with error \\"Type should be `[SeverityConf, ...any[]`\\"',
    ],
    [
      { rules: { "no-debugger": { a: 1 } } },
      'Failed to rule value \\"{\\\\\\"a\\\\\\":1}\\" with error \\"Type should be `SeverityConf | [SeverityConf, ...any[]]`\\"',
    ],
    [
      { overrides: [{ files: ["*.js"], rules: { "no-debugger": true } }] },
      'Failed to rule value \\"true\\" with error',
    ],
    [{ settings: { "jsx-a11y": [] } }, "invalid length 0, expected struct JSXA11yPluginSettings with 3 elements"],
    [{ settings: { jest: { version: "latest" } } }, 'Invalid Jest version string: \\"latest\\"'],
    [{ settings: { jest: { version: "^29.0.0" } } }, 'Invalid Jest version string: \\"^29.0.0\\"'],
    [{ settings: { jest: { version: "" } } }, 'Invalid Jest version string: \\"\\"'],
    [{ settings: { jest: { version: -1 } } }, "Jest version cannot be negative: -1"],
    [
      { settings: { jest: { version: 29.5 } } },
      "invalid type: floating point `29.5`, expected Expected Jest version as a number or string",
    ],
    [
      { settings: { jest: { version: 1e21 } } },
      "invalid type: floating point `1e+21`, expected Expected Jest version as a number or string",
    ],
    [
      { settings: { react: { version: 18 } } },
      'invalid type: integer `18`, expected a version string like \\"18.2.0\\" or \\"17.0\\"',
    ],
    [
      { settings: { react: { linkComponents: [{ name: "a", attribute: "x", linkAttribute: "to" }] } } },
      "data did not match any variant of untagged enum CustomComponent",
    ],
    [
      { settings: { react: { linkComponents: [["a", "b"]] } } },
      "data did not match any variant of untagged enum CustomComponent",
    ],
    [
      { settings: { jsdoc: { tagNamePreference: { a: ["m"] } } } },
      "data did not match any variant of untagged enum TagNamePreference",
    ],
    [{ overrides: [[]] }, "invalid length 0, expected struct OxlintOverride with 7 elements"],
    [{ overrides: [[["*.js"]]] }, "invalid length 2, expected struct OxlintOverride with 7 elements"],
    [{ overrides: [[["*.js"], [], null]] }, "invalid length 3, expected struct OxlintOverride with 7 elements"],
    [
      { overrides: [[["*.js"], [], null, null, null, null, {}, 1]] },
      "invalid length 8, expected fewer elements in array",
    ],
    [{ overrides: [[["*.js"], 1]] }, "invalid type: integer `1`, expected a sequence"],
    [{ overrides: [[["*.js"], [], 1]] }, "invalid type: integer `1`, expected a map"],
    [{ overrides: [[["*.js"], [], null, null, null, null, null]] }, "invalid type: null, expected Record<string"],
    [{ overrides: [[["{"]]] }, "Invalid glob pattern `{`: unclosed brace expansion at byte 0;"],
    [
      { overrides: [[["*.js"], [], null, null, null, null, { eqeqeq: ["error", "x"] }]] },
      "Invalid configuration for rule `eqeqeq`:\n  unknown variant `x`, expected `always` or `smart`",
    ],
  ])("%j is refused, as by oxlint", async (config, why) => {
    const files = { ".oxlintrc.json": JSON.stringify(config), "a.js": code };
    const { problems, raw, stdout, exitCode } = await lint(files);
    expect(problems).toEqual([]);
    expect(stdout).toContain("Cannot use the configuration file <dir>/.oxlintrc.json:\n");
    // As it was printed: it has backslashes.
    expect(raw).toContain(why);
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

  // `plugins` refuses "bun", so the note must not ask for it. oxlint 1.87 takes a `name` in `jsPlugins`.
  test("the note about a plugin in JavaScript that is called like Bun's own gives advice that the config takes", async () => {
    const rule = `{ create: () => ({}) }`;
    const files = {
      "bun.js": `export default { meta: { name: "bun" }, rules: { "no-array-just-to-count": ${rule}, own: ${rule}, other: ${rule} } };`,
      "a.js": "export {};\n",
    };
    const advice = async (config: object) => {
      const all = { categories: { correctness: "off" }, ...config };
      const result = await lint({ ...files, ".oxlintrc.json": JSON.stringify(all) }, ["-f", "stylish", "a.js"]);
      expect(result.exitCode).toBe(0);
      return result.stderr.split("\n").filter(it => it.startsWith("  To use "));
    };
    const builtIn = { "bun/no-array-just-to-count": "error" };
    expect(await advice({ jsPlugins: ["./bun.js"], rules: builtIn })).toEqual([
      `  To use the built-in rule, remove ./bun.js from "jsPlugins".`,
    ]);
    expect(await advice({ jsPlugins: ["./bun.js"], rules: { ...builtIn, "bun/own": "error" } })).toEqual([
      `  To use the built-in rule, give the plugin another name: "jsPlugins": [{ "name": "bun-js", "specifier": "./bun.js" }]. Then rename the other rule to "bun-js/..".`,
    ]);
    expect(
      await advice({ jsPlugins: ["./bun.js"], rules: { ...builtIn, "bun/own": "error", "bun/other": "warn" } }),
    ).toEqual([
      `  To use the built-in rule, give the plugin another name: "jsPlugins": [{ "name": "bun-js", "specifier": "./bun.js" }]. Then rename the other rules to "bun-js/..".`,
    ]);
    // What the notes ask for.
    expect(await advice({ rules: builtIn })).toEqual([]);
    const jsPlugins = [{ name: "bun-js", specifier: "./bun.js" }];
    expect(await advice({ jsPlugins, rules: { ...builtIn, "bun-js/own": "error" } })).toEqual([]);
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

  // What oxlint 1.87 does with each. It folds the rules of a file and of what that extends into a hash table by plugin and rule, and
  // applies them in the order of the table: of `no-restricted-imports` and `@typescript-eslint/no-restricted-imports`, which are two
  // there and one rule, the later in the table counts, which depends on what else is in it. Of two names that are one in the table,
  // the first.
  test("one rule under two names, in a file and in what it extends", async () => {
    // The lines of a.ts that are reported: 1 for the module that `x` restricts, 2 for that of `y`.
    const rows: [files: Record<string, unknown>, lines: number[]][] = [
      [
        {
          "base.json": {
            "rules": {
              "@typescript-eslint/no-restricted-imports": ["error", { "paths": [{ "name": "mod-x", "message": "x" }] }],
            },
          },
          ".oxlintrc.json": {
            "categories": { "correctness": "off" },
            "extends": ["./base.json"],
            "rules": { "no-restricted-imports": ["error", { "paths": [{ "name": "mod-y", "message": "y" }] }] },
          },
        },
        [1],
      ],
      [
        {
          "base.json": {
            "rules": {
              "@typescript-eslint/no-restricted-imports": ["error", { "paths": [{ "name": "mod-x", "message": "x" }] }],
            },
          },
          ".oxlintrc.json": {
            "categories": { "correctness": "off" },
            "extends": ["./base.json"],
            "rules": {
              "no-console": "off",
              "no-debugger": "off",
              "eqeqeq": "off",
              "no-var": "off",
              "prefer-const": "off",
              "no-restricted-imports": ["error", { "paths": [{ "name": "mod-y", "message": "y" }] }],
            },
          },
        },
        [1],
      ],
      [
        {
          "base.json": {
            "rules": {
              "@typescript-eslint/no-restricted-imports": ["error", { "paths": [{ "name": "mod-x", "message": "x" }] }],
            },
          },
          ".oxlintrc.json": {
            "categories": { "correctness": "off" },
            "extends": ["./base.json"],
            "rules": {
              "no-console": "off",
              "no-debugger": "off",
              "eqeqeq": "off",
              "no-var": "off",
              "prefer-const": "off",
              "no-alert": "off",
              "no-restricted-imports": ["error", { "paths": [{ "name": "mod-y", "message": "y" }] }],
            },
          },
        },
        [2],
      ],
      [
        {
          "base.json": {
            "rules": {
              "@typescript-eslint/no-restricted-imports": ["error", { "paths": [{ "name": "mod-x", "message": "x" }] }],
            },
          },
          ".oxlintrc.json": {
            "categories": { "correctness": "off" },
            "extends": ["./base.json"],
            "rules": {
              "no-console": "off",
              "no-debugger": "off",
              "eqeqeq": "off",
              "no-var": "off",
              "prefer-const": "off",
              "no-alert": "off",
              "no-eval": "off",
              "curly": "off",
              "no-empty": "off",
              "no-undef": "off",
              "no-shadow": "off",
              "no-void": "off",
              "no-with": "off",
              "radix": "off",
              "yoda": "off",
              "no-new": "off",
              "no-proto": "off",
              "no-caller": "off",
              "no-labels": "off",
              "no-continue": "off",
              "no-bitwise": "off",
              "no-plusplus": "off",
              "no-ternary": "off",
              "no-undefined": "off",
              "no-unused-vars": "off",
              "no-restricted-imports": ["error", { "paths": [{ "name": "mod-y", "message": "y" }] }],
            },
          },
        },
        [1],
      ],
      [
        {
          "base.json": {
            "rules": {
              "@typescript-eslint/no-restricted-imports": ["error", { "paths": [{ "name": "mod-x", "message": "x" }] }],
            },
          },
          ".oxlintrc.json": {
            "categories": { "correctness": "off" },
            "extends": ["./base.json"],
            "rules": {
              "no-console": "off",
              "no-debugger": "off",
              "eqeqeq": "off",
              "no-var": "off",
              "prefer-const": "off",
              "no-alert": "off",
              "no-eval": "off",
              "curly": "off",
              "no-empty": "off",
              "no-undef": "off",
              "no-shadow": "off",
              "no-void": "off",
              "no-with": "off",
              "radix": "off",
              "yoda": "off",
              "no-new": "off",
              "no-proto": "off",
              "no-caller": "off",
              "no-labels": "off",
              "no-continue": "off",
              "no-bitwise": "off",
              "no-plusplus": "off",
              "no-ternary": "off",
              "no-undefined": "off",
              "no-unused-vars": "off",
              "sort-keys": "off",
              "sort-vars": "off",
              "no-restricted-imports": ["error", { "paths": [{ "name": "mod-y", "message": "y" }] }],
            },
          },
        },
        [2],
      ],
      [
        {
          "base.json": {
            "rules": { "no-restricted-imports": ["error", { "paths": [{ "name": "mod-x", "message": "x" }] }] },
          },
          ".oxlintrc.json": {
            "categories": { "correctness": "off" },
            "extends": ["./base.json"],
            "rules": {
              "@typescript-eslint/no-restricted-imports": ["error", { "paths": [{ "name": "mod-y", "message": "y" }] }],
            },
          },
        },
        [2],
      ],
      [
        {
          "base.json": { "rules": { "@typescript-eslint/no-restricted-imports": "off" } },
          ".oxlintrc.json": {
            "categories": { "correctness": "off" },
            "extends": ["./base.json"],
            "rules": { "no-restricted-imports": ["error", { "paths": [{ "name": "mod-y", "message": "y" }] }] },
          },
        },
        [],
      ],
      [
        {
          "base.json": {
            "rules": {
              "no-restricted-imports": ["error", { "paths": [{ "name": "mod-x", "message": "x" }] }],
              "eslint/no-restricted-imports": ["error", { "paths": [{ "name": "mod-y", "message": "y" }] }],
            },
          },
          ".oxlintrc.json": {
            "categories": { "correctness": "off" },
            "extends": ["./base.json"],
            "rules": { "no-console": "off" },
          },
        },
        [1],
      ],
      [
        {
          ".oxlintrc.json": {
            "categories": { "correctness": "off" },
            "rules": {
              "no-restricted-imports": ["error", { "paths": [{ "name": "mod-x", "message": "x" }] }],
              "eslint/no-restricted-imports": ["error", { "paths": [{ "name": "mod-y", "message": "y" }] }],
            },
          },
        },
        [2],
      ],
      [
        {
          "b1.json": {
            "rules": {
              "@typescript-eslint/no-restricted-imports": ["error", { "paths": [{ "name": "mod-x", "message": "x" }] }],
            },
          },
          "b2.json": {
            "rules": { "no-restricted-imports": ["warn", { "paths": [{ "name": "mod-y", "message": "y" }] }] },
          },
          ".oxlintrc.json": { "categories": { "correctness": "off" }, "extends": ["./b1.json", "./b2.json"] },
        },
        [1],
      ],
      [
        {
          "b1.json": {
            "rules": {
              "@typescript-eslint/no-restricted-imports": ["error", { "paths": [{ "name": "mod-x", "message": "x" }] }],
            },
          },
          "b2.json": {
            "extends": ["./b1.json"],
            "rules": { "no-restricted-imports": ["error", { "paths": [{ "name": "mod-y", "message": "y" }] }] },
          },
          ".oxlintrc.json": {
            "categories": { "correctness": "off" },
            "extends": ["./b2.json"],
            "rules": {
              "no-console": "off",
              "no-debugger": "off",
              "eqeqeq": "off",
              "no-var": "off",
              "prefer-const": "off",
              "no-alert": "off",
            },
          },
        },
        [2],
      ],
    ];
    const files: Record<string, string> = { ".oxlintrc.json": "{}" };
    for (const [at, [configs]] of rows.entries()) {
      for (const [name, config] of Object.entries(configs)) files[`r${at}/${name}`] = JSON.stringify(config);
      files[`r${at}/a.ts`] = 'import x from "mod-x";\nimport y from "mod-y";\n';
    }
    const { problems } = await lint(files);
    const expected = rows.flatMap(([, lines], at) => lines.map(line => `r${at}/a.ts:${line}:1 no-restricted-imports`));
    expect(problems).toEqual(expected.sort());
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

  // Every row was run on oxlint 1.87. It matches one of its own rules by the text after the last `/` of the name, and reports
  // every comment that silenced nothing, whatever the name is.
  test("which names in a disable comment silence a built-in rule, and which comments are unused", async () => {
    // `$` is the number of the line, to keep the names apart.
    const rows: { file: string; bad: string; good: string; silence: string[]; nothing: string[] }[] = [
      {
        file: "debugger.js",
        bad: "debugger;",
        good: "f();",
        silence: [
          "no-debugger",
          "eslint/no-debugger",
          "typescript/no-debugger",
          "@typescript-eslint/no-debugger",
          "react/no-debugger",
          "vitest/no-debugger",
          "@stylistic/no-debugger",
          "foo/no-debugger",
          "a/b/no-debugger",
          "foo/eslint/no-debugger",
          "/no-debugger",
        ],
        nothing: ["eslint(no-debugger)", "xno-debugger", "no-debugger-x", "x-no-debugger", "NO-DEBUGGER", "no-debugge"],
      },
      {
        file: "any.ts",
        bad: "export let a$: any;",
        good: "export let a$: number;",
        silence: [
          "no-explicit-any",
          "typescript/no-explicit-any",
          "@typescript-eslint/no-explicit-any",
          "typescript-eslint/no-explicit-any",
          "eslint/no-explicit-any",
          "ts/no-explicit-any",
          "react/no-explicit-any",
        ],
        nothing: [],
      },
      {
        file: "hooks.jsx",
        bad: "function f$() { useState(); } f$();",
        good: "function f$() { g(); } f$();",
        silence: [
          "rules-of-hooks",
          "react/rules-of-hooks",
          "react-hooks/rules-of-hooks",
          "react_hooks/rules-of-hooks",
          "eslint/rules-of-hooks",
          "foo/rules-of-hooks",
        ],
        nothing: [],
      },
      {
        file: "focused.test.js",
        bad: "it.only('a', () => {});",
        good: "it('a', () => {});",
        silence: ["no-focused-tests", "jest/no-focused-tests", "vitest/no-focused-tests", "foo/no-focused-tests"],
        nothing: [],
      },
      {
        file: "alt.jsx",
        bad: "x = <area />;",
        good: "x = <b />;",
        silence: ["alt-text", "jsx-a11y/alt-text", "jsx_a11y/alt-text", "a11y/alt-text"],
        nothing: [],
      },
      {
        file: "img.jsx",
        bad: "x = <img alt='a' />;",
        good: "x = <b />;",
        silence: [
          "no-img-element",
          "nextjs/no-img-element",
          "@next/next/no-img-element",
          "next/no-img-element",
          "@next/no-img-element",
        ],
        nothing: [],
      },
      {
        file: "require.js",
        bad: "x = new require('a');",
        good: "x = require('a');",
        silence: ["no-new-require", "node/no-new-require", "n/no-new-require", "eslint/no-new-require"],
        nothing: [],
      },
      // Two rules have this name. Either prefix silences both.
      {
        file: "import-namespace.ts",
        bad: "import * as a$ from 'a'; a$();",
        good: "import a$ from 'a'; a$();",
        silence: ["no-namespace", "import/no-namespace", "typescript/no-namespace", "foo/no-namespace"],
        nothing: [],
      },
      {
        file: "namespace.ts",
        bad: "export namespace N$ {}",
        good: "export const N$ = 1;",
        silence: ["no-namespace", "import/no-namespace", "@typescript-eslint/no-namespace", "foo/no-namespace"],
        nothing: [],
      },
      // Rules that are off, rules of plugins that are off, and names that are no rule's.
      {
        file: "off.js",
        bad: "",
        good: "console.log(1);",
        silence: [],
        nothing: [
          "no-console",
          "eslint/no-console",
          "foo/no-console",
          "typescript/no-console",
          "oxc/no-barrel-file",
          "no-barrel-file",
          "vitest/no-import-node-test",
          "check-access",
          "foo/check-access",
          "jsdoc/check-access",
          "jsdoc/require-param",
          "vue/max-props",
          "vue/no-export-in-script-setup",
          "foo/no-alert",
          "typescript/no-floating-promises",
          "nope",
          "foo/nope",
          "eslint/nope",
          "no-multiple-empty-lines",
          "@stylistic/semi",
          "prettier/prettier",
        ],
      },
    ];
    const comments = [
      (name: string) => `// oxlint-disable-next-line ${name}\n`,
      (name: string) => `/* eslint-disable-next-line ${name} */\n`,
    ];
    const files: Record<string, string> = {};
    const expected: string[] = [];
    for (const { file, bad, good, silence, nothing } of rows) {
      let [text, line] = ["", 1];
      const add = (name: string, code: string, outcome: "silenced" | "unused" | "reported") => {
        for (const comment of comments) {
          text += comment(name) + code.replaceAll("$", String(line)) + "\n";
          if (outcome !== "silenced") expected.push(`${file}:${line} unused`);
          if (outcome === "reported") expected.push(`${file}:${line + 1} reported`);
          line += 2;
        }
      };
      for (const name of silence) {
        add(name, bad, "silenced");
        add(name, good, "unused");
      }
      for (const name of nothing) {
        if (bad) add(name, bad, "reported");
        add(name, good, "unused");
      }
      files[file] = text;
    }
    const config = {
      categories: { correctness: "off" },
      plugins: ["typescript", "react", "import", "jest", "jsx-a11y", "nextjs", "node"],
      rules: {
        "no-debugger": "error",
        "no-console": "off",
        "typescript/no-explicit-any": "error",
        "react/rules-of-hooks": "error",
        "jest/no-focused-tests": "error",
        "jsx-a11y/alt-text": "error",
        "nextjs/no-img-element": "error",
        "node/no-new-require": "error",
        "import/no-namespace": "error",
        "typescript/no-namespace": "error",
      },
    };
    const { problems } = await lint({ ".oxlintrc.json": JSON.stringify(config), ...files }, [
      ".",
      "--report-unused-disable-directives",
    ]);
    const found = problems.map(it => it.replace(/:\d+ (.*)$/, (_, rule) => (rule === "-" ? " unused" : " reported")));
    expect(found.sort()).toEqual(expected.sort());
  });

  // oxlint 1.87 rejects this config: "Rule 'no-debuger' not found in plugin 'eslint'", "Plugin 'foo' not found". The rules here are
  // those of one oxlint version, and a config for a later one can name a rule that is new, so it's a warning.
  test("an unknown rule that an .oxlintrc.json turns off is a warning, once for each name", async () => {
    const config = {
      categories: { correctness: "off" },
      rules: {
        "no-debugger": "error",
        "no-debuger": "off",
        "foo/bar": "off",
        "unicorn/no-nul": "allow",
        "typescript/no-explicit-an": 0,
        // There is no list of the rules of this plugin.
        "jsdoc/whatever": "off",
      },
      overrides: [{ files: ["*.ts"], rules: { "no-debuger": "off", "react/jsx-kye": "off" } }],
    };
    const files = { ".oxlintrc.json": JSON.stringify(config), "a.js": "debugger;\n", "b.js": "debugger;\n" };
    const { problems, stderr, exitCode } = await lint(files);
    expect(problems).toEqual(["a.js:1:1 no-debugger", "b.js:1:1 no-debugger"]);
    expect(stderr.trim().split("\n")).toEqual([
      'warn: Unknown rule "no-debuger" is turned off in the oxlint config',
      '  Did you mean "no-debugger"?',
      'warn: Unknown rule "foo/bar" is turned off in the oxlint config',
      "  It has no effect. Fix the name or remove it.",
      'warn: Unknown rule "unicorn/no-nul" is turned off in the oxlint config',
      '  Did you mean "unicorn/no-null"?',
      'warn: Unknown rule "typescript/no-explicit-an" is turned off in the oxlint config',
      '  Did you mean "typescript/no-explicit-any"?',
      'warn: Unknown rule "react/jsx-kye" is turned off in the oxlint config',
      '  Did you mean "react/jsx-key"?',
    ]);
    expect(exitCode).toBe(1);
  });

  // oxlint 1.87 fails with this text for each of the first three, before it lints.
  test("the options of a JS plugin's rule are checked for every entry of an .oxlintrc.json", async () => {
    const plugin = `export default { meta: { name: "pl" }, rules: { opt: { meta: { schema: [{ enum: ["a", "b"] }] }, create: () => ({}) } } };\n`;
    const run = async (config: object) => {
      const oxlintrc = JSON.stringify({ categories: { correctness: "off" }, jsPlugins: ["./plugin.js"], ...config });
      const { stdout, stderr, exitCode } = await lint(
        { ".oxlintrc.json": oxlintrc, "plugin.js": plugin, "a.js": "a;\n" },
        ["a.js"],
      );
      const said = (stdout + stderr).includes(
        `Failed to setup JS plugin options:\nError: Options validation failed for rule 'pl/opt':\nOptions:\n[\n  "zzz"\n]\nErrors:\n\tValue "zzz" should be equal to one of the allowed values.`,
      );
      return [said, exitCode];
    };
    expect(
      await Promise.all([
        run({ rules: { "pl/opt": ["error", "zzz"] } }),
        run({ rules: { "pl/opt": ["off", "zzz"] } }),
        run({ overrides: [{ files: ["*.nothing"], rules: { "pl/opt": ["error", "zzz"] } }] }),
        run({ rules: { "pl/opt": ["off", "a"] } }),
      ]),
    ).toEqual([
      [true, 1],
      [true, 1],
      [true, 1],
      [false, 0],
    ]);
  });

  // oxlint 1.87 says so for each of the first five, before it lints.
  test("options for a JS plugin's rule that takes none are refused, also where the rule is off", async () => {
    const plugin = `const create = () => ({});
      export default { meta: { name: "pl" }, rules: { none: { create }, meta: { meta: { type: "problem" }, create }, empty: { meta: { schema: [] }, create }, any: { meta: { schema: false }, create } } };\n`;
    const run = async (rule: string, entry: unknown) => {
      const config = {
        categories: { correctness: "off" },
        jsPlugins: ["./plugin.js"],
        rules: { [`pl/${rule}`]: entry },
      };
      const files = { ".oxlintrc.json": JSON.stringify(config), "plugin.js": plugin, "a.js": "a;\n" };
      const { stdout, stderr, exitCode } = await lint(files, ["a.js"]);
      const text = `Failed to setup JS plugin options:\nError: Rule 'pl/${rule}' does not accept options`;
      return [(stdout + stderr).includes(text), exitCode];
    };
    expect(
      await Promise.all([
        run("none", ["off", {}]),
        run("none", ["error", {}]),
        run("none", ["off", null]),
        run("meta", ["off", {}]),
        run("empty", ["off", {}]),
        run("any", ["off", {}]),
        run("none", ["off"]),
        run("none", "off"),
      ]),
    ).toEqual([
      [true, 1],
      [true, 1],
      [true, 1],
      [true, 1],
      [true, 1],
      [false, 0],
      [false, 0],
      [false, 0],
    ]);
  });

  // What oxlint 1.87 and ESLint 10.12 do. oxlint goes by `char::is_whitespace` of Rust, ESLint by `\s`.
  test("white space beside the label of a disable comment: U+0085 for oxlint, U+FEFF for ESLint", async () => {
    const codes = [0x20, 0x85, 0xa0, 0x1680, 0x2003, 0x3000, 0xfeff, 0x180e, 0x200b];
    const files = (tool: string) =>
      Object.fromEntries(
        codes.flatMap(code => [
          [`a${code.toString(16)}.js`, `debugger; //${String.fromCodePoint(code)}${tool}-disable-line no-debugger\n`],
          [`b${code.toString(16)}.js`, `debugger; // ${tool}-disable-line${String.fromCodePoint(code)}no-debugger\n`],
        ]),
      );
    const rules = { "no-debugger": "error" };
    const [oxlint, eslint] = await Promise.all([
      lint({ ".oxlintrc.json": JSON.stringify({ categories: { correctness: "off" }, rules }), ...files("oxlint") }),
      lint({ "eslint.config.mjs": `export default [{ rules: ${JSON.stringify(rules)} }];\n`, ...files("eslint") }),
    ]);
    const notSilenced = (...names: string[]) =>
      names.flatMap(it => [`a${it}.js:1:1 no-debugger`, `b${it}.js:1:1 no-debugger`]).sort();
    expect(oxlint.problems).toEqual(notSilenced("feff", "180e", "200b"));
    expect(eslint.problems).toEqual(notSilenced("85", "180e", "200b"));
  });

  // What oxlint 1.87 and ESLint 10.12 report.
  test("no-irregular-whitespace: oxlint lets a line separator pass that ends a // comment", async () => {
    const files = {
      "a.js": "a; // c\u2028b;\n",
      "b.js": "a; // c\u2029b;\n",
      "c.js": "a; // c\u2028\u2028b;\n",
      "d.js": "a;\u2028b;\n",
      "e.js": "a; /* c\u2028d */ b;\n",
      "f.js": "// c\u2028",
    };
    const rules = { "no-irregular-whitespace": "error" };
    const [oxlint, eslint] = await Promise.all([
      lint({ ".oxlintrc.json": JSON.stringify({ categories: { correctness: "off" }, rules }), ...files }),
      lint({ "eslint.config.mjs": `export default [{ rules: ${JSON.stringify(rules)} }];\n`, ...files }),
    ]);
    const places = (problems: string[]) => problems.map(it => it.replace(" no-irregular-whitespace", ""));
    // The second separator of c.js. This format counts lines like ESLint. oxlint's own formats say 1:11.
    expect(places(oxlint.problems)).toEqual(["c.js:2:1", "d.js:1:3", "e.js:1:8"]);
    expect(places(eslint.problems)).toEqual([
      "a.js:1:8",
      "b.js:1:8",
      "c.js:1:8",
      "c.js:2:1",
      "d.js:1:3",
      "e.js:1:8",
      "f.js:1:5",
    ]);
  });

  // The lines of oxlint 1.87, in its order.
  test("the findings about a file: of the built-in rules by place, of JS plugins as they report, about comments last", async () => {
    const plugin = `export default { meta: { name: "pl" }, rules: {
      back: { create(c) { const all = []; return { Identifier(n) { all.push(n); }, "Program:exit"() { for (const n of all.reverse()) c.report({ node: n, message: "back " + n.name }); } }; } },
      fwd: { create(c) { return { Identifier(n) { c.report({ node: n, message: "fwd " + n.name }); } }; } },
    } };\n`;
    const rules = { "pl/fwd": "error", "pl/back": "error", "no-var": "warn", "no-debugger": "error" };
    const code = [
      "// oxlint-disable-next-line no-alert",
      "debugger;",
      "a; b;",
      "// oxlint-disable-next-line pl/back",
      "debugger;",
      "var c = 1; // oxlint-disable-line no-var",
      "d; // oxlint-disable-line pl/fwd",
      "// oxlint-disable-next-line no-eval",
      "debugger;",
    ];
    const files = {
      ".oxlintrc.json": JSON.stringify({ categories: { correctness: "off" }, jsPlugins: ["./plugin.js"], rules }),
      "plugin.js": plugin,
      "c.js": code.join("\n") + "\n",
    };
    const { stdout } = await lint(files, ["-f", "unix", "--report-unused-disable-directives", "c.js"]);
    const lines = stdout.split("\n").filter(it => it.startsWith("c.js:"));
    expect(lines.map(it => it.replace(/^c\.js:(\d+:\d+): .*?(\w+\([\w-]+\))?\]$/, "$1 $2").trim())).toEqual([
      "2:1 eslint(no-debugger)",
      "5:1 eslint(no-debugger)",
      "9:1 eslint(no-debugger)",
      "3:1 pl(fwd)",
      "3:4 pl(fwd)",
      "6:5 pl(fwd)",
      "7:1 pl(back)",
      "6:5 pl(back)",
      "3:4 pl(back)",
      "3:1 pl(back)",
      "1:1",
      "4:1",
      "8:1",
    ]);
  });

  // Each count is what oxlint 1.87 prints.
  test("number_of_rules is there for a file outside the working directory, unless it has another configuration", async () => {
    const rc = (rules: object) => JSON.stringify({ categories: { correctness: "off" }, rules });
    const files = {
      ".oxlintrc.json": rc({ "no-debugger": "error", "no-var": "error", "no-eval": "error" }),
      "a.js": "debugger;\n",
      "other/b.js": "debugger;\n",
      "sub/.oxlintrc.json": rc({ "no-debugger": "error" }),
      "sub/c.js": "debugger;\n",
      "sub/in/d.js": "debugger;\n",
    };
    const count = async (cwd: string, args: (dir: string) => string[]) =>
      JSON.parse((await lint(files, ["-f", "json"], { cwd, args })).raw).number_of_rules;
    expect(
      await Promise.all([
        count("sub/in", dir => [join(dir, "sub", "c.js")]),
        count("sub/in", dir => [join(dir, "sub")]),
        count("sub/in", dir => ["d.js", join(dir, "sub", "c.js")]),
        count("other", dir => [join(dir, "a.js"), "b.js"]),
        count("other", dir => ["-c", join(dir, "sub", ".oxlintrc.json"), join(dir, "sub", "c.js")]),
        count("sub/in", dir => ["-c", join(dir, ".oxlintrc.json"), join(dir, "other", "b.js")]),
        count("other", dir => ["--disable-nested-config", join(dir, "sub", "c.js")]),
        // These have two configuration files.
        count("sub/in", dir => [join(dir, "other", "b.js")]),
        count("other", dir => [join(dir, "a.js"), join(dir, "sub", "c.js")]),
      ]),
    ).toEqual([1, 1, 1, 3, 1, 3, 3, null, null]);
  });

  // Each count is what oxlint 1.87 prints. The rules run on the files of the override in both tools: only the count leaves them out.
  test("number_of_rules leaves out what categories turn on for a plugin that only an override has", async () => {
    const base = {
      plugins: ["unicorn", "typescript", "import"],
      categories: { correctness: "warn", suspicious: "warn" },
    };
    const count = async (config: object) => {
      const files = { ".oxlintrc.json": JSON.stringify(config), "a.ts": "debugger;\n", "a.test.ts": "debugger;\n" };
      return JSON.parse((await lint(files, ["-f", "json"])).raw).number_of_rules;
    };
    const named = { "jest/no-focused-tests": "error" };
    expect(
      await Promise.all([
        count(base),
        count({ ...base, overrides: [{ files: ["*.test.ts"], plugins: ["jest"] }] }),
        count({ ...base, overrides: [{ files: ["*.test.ts"], plugins: ["jest"], rules: named }] }),
        count({ ...base, overrides: [{ files: ["*.nothing"], plugins: ["jest"], rules: named }] }),
        count({ ...base, overrides: [{ files: ["*.ts"], plugins: ["jest", "react"] }] }),
        count({ overrides: [{ files: ["*.test.ts"], plugins: ["jest"] }] }),
      ]),
    ).toEqual([116, 116, 117, 117, 116, 96]);
  });

  // Each config is accepted or rejected as oxlint 1.87 does it. It takes out the comments, has serde_json read the rest, and
  // fills its structs from that: `null` is only good for an `Option`, and a list of nothing is as good as an empty struct.
  test("an .oxlintrc.json is read as strictly as oxlint reads it, and no more strictly", async () => {
    const rejected = [
      '{"rules":null}',
      '{"categories":null}',
      '{"settings":null}',
      '{"options":null}',
      '{"env":null}',
      '{"globals":null}',
      '{"overrides":null}',
      '{"extends":null}',
      '{"ignorePatterns":null}',
      '{"overrides":[{"files":["*.js"],"rules":null}]}',
      '{"overrides":[{"files":null}]}',
      '{"globals":{"a":null}}',
      '{"settings":[1]}',
      '{"settings":[{},{},{},{},{},{},{},{}]}',
      '{"options":[1]}',
      '{"rules":{"eqeqeq":"off","eqeqeq":["error","x"]}}',
      "{'rules':{}}",
      '{"rules":{"no-debugger":\'error\'}}',
      '\ufeff{"rules":{"no-debugger":"error"}}',
      '{"rules":{"max-lines":["error",{"max":0x10}]}}',
      '{"rules":{"max-lines":["error",{"max":1.}]}}',
      '{"rules":{"max-lines":["error",{"max":.5}]}}',
      '{"rules":{"max-lines":["error",{"max":01}]}}',
      '{"rules":{"no-debugger":"err\\x6fr"}}',
      '{"$schema":"\\ud800"}',
      '\u00a0{"rules":{"no-debugger":"error"}}',
      '\u000b{"rules":{"no-debugger":"error"}}',
    ];
    const accepted = [
      '{"plugins":null}',
      '{"jsPlugins":null}',
      '{"$schema":null}',
      '{"overrides":[{"files":["*.js"],"env":null}]}',
      '{"overrides":[{"files":["*.js"],"globals":null}]}',
      '{"overrides":[{"files":["*.js"],"plugins":null}]}',
      '{"settings":[]}',
      '{"settings":[{},{}]}',
      '{"options":[]}',
      '{"options":[null]}',
      '{"options":{"typeAware":null}}',
      '{"options":[false]}',
      '{"options":[null,null,null,1]}',
      '{"settings":[{},{},{},{},{},{}]}',
      '{"settings":{"zz":1}}',
      '{"settings":{"react":[]}}',
      '{"settings":{"react":{"zz":1,"version":null}}}',
      '{"settings":{"react":{"formComponents":["a",{"name":"a","attribute":"b","zz":1}]}}}',
      '{"settings":{"jsx-a11y":[null,{},{}]}}',
      '{"settings":{"next":{"rootDir":["a"]}}}',
      '{"settings":{"jsdoc":{"tagNamePreference":{"a":false,"b":"c","d":{"message":"m"}}}}}',
      '{"settings":{"jest":[1]}}',
      '{"settings":{"jsx-a11y":[null]}}',
      '{"settings":{"jest":{"version":"v29.7.0-beta.1"}}}',
      '{"settings":{"jest":{"version":"29.x"}}}',
      '{"settings":{"jest":{"version":29}}}',
      '{"settings":{"jest":{"version":null}}}',
      '{"settings":{"react":{"linkComponents":[{"name":"a","linkAttribute":"to"},{"name":"b","linkAttribute":["to"]}]}}}',
      '{"settings":{"react":{"formComponents":[{"name":"a","formAttribute":"to"},{"name":"b","linkAttribute":"to"}]}}}',
      '{"settings":{"react":{"linkComponents":[{"name":"a","attribute":"x","linkAttribute":["to"]}]}}}',
      '{"overrides":[[["*.js"],[],null,null]]}',
      "{,}",
      "{}/",
      "/**/{}",
      "{}#x",
      '{"rules":{"eqeqeq":["error","x"],"eqeqeq":"off"}}',
      '{"rules":{"no-var":"nonsense","no-var":"off"}}',
      '{"categories":{"correctness":"x","correctness":"warn"}}',
      '#!x\n{"rules":{"no-debugger":"error"}}',
      '{"rules":{"no-debugger":"error"}} # c',
      '{"rules":{"no-debugger":"error"}} // c',
      '// c\n{"rules":{"no-debugger":"error"}}',
      '{"rules":{"no-debugger":"error"},}',
      '{"rules":{"no-debugger":"err\\u006fr"}}',
      '{"$schema":"\\/"}',
    ];
    const run = async (config: string) => {
      const { problems, exitCode } = await lint({ ".oxlintrc.json": config, "a.js": "debugger;\n" });
      return [config, problems.length === 0 && exitCode === 1 ? "rejected" : problems.join()];
    };
    expect(await Promise.all([...rejected, ...accepted].map(run))).toEqual([
      ...rejected.map(config => [config, "rejected"]),
      ...accepted.map(config => [config, "a.js:1:1 no-debugger"]),
    ]);
  });

  // What oxlint 1.87 prints below "Failed to parse oxlint config <path>.", or in place of that. It makes blanks of the comments, of
  // the line breaks in `/* */` too, and of a comma before a `}` or `]`, and has serde_json read the rest. Columns are in bytes.
  test("an .oxlintrc.json that is no JSON is refused in the words of oxlint", async () => {
    // prettier-ignore
    const rows: [text: string, why: string][] = [
      ["{\n  \"rules\": {\n    \"no-debugger\": \"error\"\n    \"no-var\": \"off\"\n  }\n}\n", "expected `,` or `}` at line 4 column 5"],
      ["{\n  // c\n  \"rules\": { /* a\n b */ no-debugger: 1 }\n}\n", "key must be a string at line 3 column 25"],
      ["", "EOF while parsing a value at line 1 column 0"],
      ["\n", "EOF while parsing a value at line 2 column 0"],
      ["{", "EOF while parsing an object at line 1 column 1"],
      ["[1,", "EOF while parsing a value at line 1 column 3"],
      ["{\"a\"", "EOF while parsing an object at line 1 column 4"],
      ["{\"a\":", "EOF while parsing a value at line 1 column 5"],
      ["{\"a\":1", "EOF while parsing an object at line 1 column 6"],
      ["{\"a\" 1}", "expected `:` at line 1 column 6"],
      ["{\"a\":}", "expected value at line 1 column 6"],
      ["{\"a\":1 \"b\":2}", "expected `,` or `}` at line 1 column 8"],
      ["[1 2]", "expected `,` or `]` at line 1 column 4"],
      ["{a:1}", "key must be a string at line 1 column 2"],
      ["{\"a\":1,,}", "key must be a string at line 1 column 8"],
      ["[1, ,]", "expected value at line 1 column 5"],
      ["{\"a\":1,]", "expected `,` or `}` at line 1 column 8"],
      ["[1,]]", "trailing characters at line 1 column 5"],
      ["tru", "EOF while parsing a value at line 1 column 3"],
      ["truex", "trailing characters at line 1 column 5"],
      ["-", "EOF while parsing a value at line 1 column 1"],
      ["-a", "invalid number at line 1 column 2"],
      ["01", "invalid number at line 1 column 2"],
      ["1.", "EOF while parsing a value at line 1 column 2"],
      ["1.a", "invalid number at line 1 column 3"],
      ["1e+", "EOF while parsing a value at line 1 column 3"],
      ["1ea", "invalid number at line 1 column 3"],
      ["0x10", "trailing characters at line 1 column 2"],
      ["+1", "expected value at line 1 column 1"],
      [".5", "expected value at line 1 column 1"],
      ["1e400", "number out of range at line 1 column 5"],
      ["NaN", "expected value at line 1 column 1"],
      ["\"a", "EOF while parsing a string at line 1 column 2"],
      ["\"\\x\"", "invalid escape at line 1 column 3"],
      ["\"\\u12\"", "EOF while parsing a string at line 1 column 6"],
      ["\"\\uzzzz\"", "invalid escape at line 1 column 7"],
      ["\"\\ud800\"", "unexpected end of hex escape at line 1 column 8"],
      ["\"\\ud800\\n\"", "unexpected end of hex escape at line 1 column 9"],
      ["\"\\ud800\\u0041\"", "lone leading surrogate in hex escape at line 1 column 13"],
      ["\"\\udc00\"", "lone leading surrogate in hex escape at line 1 column 7"],
      ["\"a\tb\"", "control character (\\u0000-\\u001F) found while parsing a string at line 1 column 3"],
      ["\"a\nb\"", "control character (\\u0000-\\u001F) found while parsing a string at line 2 column 0"],
      ["{}\n\n  x", "trailing characters at line 3 column 3"],
      ["{},", "trailing characters at line 1 column 3"],
      ["/* a", "EOF while parsing a value at line 1 column 4"],
      ["/*\n\n*/x", "expected value at line 1 column 7"],
      ["/*\n\n*/{\n x}", "key must be a string at line 2 column 2"],
      ["// a\nx", "expected value at line 2 column 1"],
      ["# a\nx", "expected value at line 2 column 1"],
      ["{\"a\": /* c\n */ x}", "expected value at line 1 column 16"],
      ["{\"//\": x}", "expected value at line 1 column 8"],
      ["{'a':1}", "key must be a string at line 1 column 2"],
      ["\ufeff{}", "expected value at line 1 column 1"],
      ["\u00a0{}", "expected value at line 1 column 1"],
      ["\r\n{\r\n x}", "key must be a string at line 3 column 2"],
      ["\r{\r x}", "key must be a string at line 1 column 5"],
      ["{\"\u65e5\u672c\": x}", "expected value at line 1 column 12"],
      ["[1,2,3\n,4\n,x]", "expected value at line 3 column 2"],
      ["{} / x", "Failed to parse jsonc file <dir>/.oxlintrc.json: Kind(InvalidData)"],
      ["/x", "Failed to parse jsonc file <dir>/.oxlintrc.json: Kind(InvalidData)"],
      ["[]", "Expected a JSON object."],
      ["null", "Expected a JSON object."],
      ["[1,]", "Expected a JSON object."],
      ["[,]", "Expected a JSON object."],
      [Buffer.alloc(127, "[").toString() + "x", "expected value at line 1 column 128"],
      [Buffer.alloc(128, "[").toString() + "x", "recursion limit exceeded at line 1 column 128"],
    ];
    const run = async ([text]: [string, string]) => {
      const { stdout, exitCode } = await lint({ ".oxlintrc.json": text, "a.js": "debugger;\n" }, ["a.js"]);
      const start = "error: Cannot use the configuration file <dir>/.oxlintrc.json:\n";
      const said = stdout.startsWith(start) ? stdout.slice(start.length).trimEnd() : stdout;
      return [text, said.replace("Failed to parse oxlint config <dir>/.oxlintrc.json.\n", ""), exitCode];
    };
    // `stdout` has a slash for every backslash.
    expect(await Promise.all(rows.map(run))).toEqual(rows.map(([text, why]) => [text, why.replaceAll("\\", "/"), 1]));
  });

  // What oxlint 1.87 reports.
  test("an override of an .oxlintrc.json that is a list has the fields in their order", async () => {
    const found = async (...fields: unknown[]) => {
      const config = { categories: { correctness: "off" }, overrides: [fields] };
      return (await lint({ ".oxlintrc.json": JSON.stringify(config), "a.js": "debugger;\n" }, ["a.js"])).problems;
    };
    const rules = { "no-debugger": "error" };
    expect(await found(["*.js"], [], null, null, null, null, rules)).toEqual(["a.js:1:1 no-debugger"]);
    expect(await found(["*.ts"], [], null, null, null, null, rules)).toEqual([]);
    expect(await found(["*.js"], ["a.js"], null, null, null, null, rules)).toEqual([]);
  });

  // Each row is what oxlint 1.87 reports. As for `JSON.parse`, the last of two values with one key counts.
  test("of two entries with one key in an .oxlintrc.json the last counts", async () => {
    const rows: [config: string, found: string[]][] = [
      [
        '{"rules":{"no-debugger":"error"},"rules":{"no-debugger":"off"}}',
        ["2:5 no-unused-vars warning", "3:1 no-unused-expressions warning", "3:4 no-unused-expressions warning"],
      ],
      [
        '{"rules":{"no-debugger":"off"},"rules":{"no-debugger":"error"}}',
        [
          "1:1 no-debugger error",
          "2:5 no-unused-vars warning",
          "3:1 no-unused-expressions warning",
          "3:4 no-unused-expressions warning",
        ],
      ],
      [
        '{"rules":{"no-debugger":"error","no-debugger":"off"}}',
        ["2:5 no-unused-vars warning", "3:1 no-unused-expressions warning", "3:4 no-unused-expressions warning"],
      ],
      [
        '{"rules":{"no-debugger":"off","no-debugger":"error"}}',
        [
          "1:1 no-debugger error",
          "2:5 no-unused-vars warning",
          "3:1 no-unused-expressions warning",
          "3:4 no-unused-expressions warning",
        ],
      ],
      [
        '{"rules":{"no-debugger":"error"},"rules":{"no-var":"error"}}',
        [
          "1:1 no-debugger warning",
          "2:1 no-var error",
          "2:5 no-unused-vars warning",
          "3:1 no-unused-expressions warning",
          "3:4 no-unused-expressions warning",
        ],
      ],
      [
        '{"categories":{"correctness":"off"},"categories":{"correctness":"error"}}',
        [
          "1:1 no-debugger error",
          "2:5 no-unused-vars error",
          "3:1 no-unused-expressions error",
          "3:4 no-unused-expressions error",
        ],
      ],
      ['{"categories":{"correctness":"error","correctness":"off"}}', []],
      [
        '{"plugins":["unicorn"],"plugins":[],"rules":{"unicorn/no-null":"error"}}',
        [
          "1:1 no-debugger warning",
          "2:5 no-unused-vars warning",
          "3:1 no-unused-expressions warning",
          "3:4 no-unused-expressions warning",
        ],
      ],
      [
        '{"plugins":[],"plugins":["unicorn"],"rules":{"unicorn/no-null":"error"}}',
        [
          "1:1 no-debugger warning",
          "2:5 no-unused-vars warning",
          "2:9 no-null error",
          "3:1 no-unused-expressions warning",
          "3:4 no-unused-expressions warning",
        ],
      ],
      [
        '{"overrides":[{"files":["*.js"],"rules":{"no-debugger":"off"}}],"overrides":[]}',
        [
          "1:1 no-debugger warning",
          "2:5 no-unused-vars warning",
          "3:1 no-unused-expressions warning",
          "3:4 no-unused-expressions warning",
        ],
      ],
      [
        '{"overrides":[],"overrides":[{"files":["*.js"],"rules":{"no-debugger":"off"}}]}',
        ["2:5 no-unused-vars warning", "3:1 no-unused-expressions warning", "3:4 no-unused-expressions warning"],
      ],
      [
        '{"overrides":[{"files":["*.ts"],"files":["*.js"],"rules":{"no-debugger":"off"}}]}',
        ["2:5 no-unused-vars warning", "3:1 no-unused-expressions warning", "3:4 no-unused-expressions warning"],
      ],
      [
        '{"globals":{"a":"off","a":"readonly"},"rules":{"no-undef":"error"}}',
        [
          "1:1 no-debugger warning",
          "2:5 no-unused-vars warning",
          "3:1 no-unused-expressions warning",
          "3:4 no-undef error",
          "3:4 no-unused-expressions warning",
          "4:1 no-undef error",
          "4:17 no-undef error",
        ],
      ],
      [
        '{"globals":{"a":"readonly"},"globals":{},"rules":{"no-undef":"error"}}',
        [
          "1:1 no-debugger warning",
          "2:5 no-unused-vars warning",
          "3:1 no-undef error",
          "3:1 no-unused-expressions warning",
          "3:4 no-undef error",
          "3:4 no-unused-expressions warning",
          "4:1 no-undef error",
          "4:17 no-undef error",
        ],
      ],
      [
        '{"env":{"browser":true,"browser":false},"rules":{"no-undef":"error"}}',
        [
          "1:1 no-debugger warning",
          "2:5 no-unused-vars warning",
          "3:1 no-undef error",
          "3:1 no-unused-expressions warning",
          "3:4 no-undef error",
          "3:4 no-unused-expressions warning",
          "4:1 no-undef error",
          "4:17 no-undef error",
        ],
      ],
      [
        '{"rules":{"no-console":["error",{"allow":["log"],"allow":["warn"]}]}}',
        [
          "1:1 no-debugger warning",
          "2:5 no-unused-vars warning",
          "3:1 no-unused-expressions warning",
          "3:4 no-unused-expressions warning",
          "4:1 no-console error",
        ],
      ],
      [
        '{"rules":{"eslint/no-debugger":"off","no-debugger":"error"}}',
        [
          "1:1 no-debugger error",
          "2:5 no-unused-vars warning",
          "3:1 no-unused-expressions warning",
          "3:4 no-unused-expressions warning",
        ],
      ],
      [
        '{"rules":{"no-debugger":"error","eslint/no-debugger":"off"}}',
        ["2:5 no-unused-vars warning", "3:1 no-unused-expressions warning", "3:4 no-unused-expressions warning"],
      ],
    ];
    const text = "debugger;\nvar v = null;\na; window;\nconsole.log(1); console.warn(2);\n";
    const nested = rows.flatMap(([config], i) => [
      [`d${i}/.oxlintrc.json`, config],
      [`d${i}/a.js`, text],
    ]);
    const { raw } = await lint({ ".oxlintrc.json": "{}", ...Object.fromEntries(nested) });
    type Message = { ruleId: string; line: number; column: number; severity: number };
    const results: { filePath: string; messages: Message[] }[] = JSON.parse(raw).results;
    const found = Object.fromEntries(
      results.map(({ filePath, messages }) => [
        filePath.split(/[\\/]/).at(-2),
        messages
          .map(
            it => `${it.line}:${it.column} ${it.ruleId.split("/").at(-1)} ${["off", "warning", "error"][it.severity]}`,
          )
          .sort(),
      ]),
    );
    expect(found).toEqual(Object.fromEntries(rows.map(([, expected], i) => [`d${i}`, [...expected].sort()])));
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

  // Every row is what oxlint 1.87 prints. Without --type-aware it acts as if the rules that need types didn't exist.
  test("disable comments are unused under .oxlintrc.json when the only rules left are ones that need types", async () => {
    const text = [
      "declare function g(): void;",
      "export async function f() {",
      "  // oxlint-disable-next-line",
      "  g();",
      "  g(); // eslint-disable-line",
      "  // oxlint-disable-next-line typescript/await-thenable",
      "  g();",
      "  // eslint-disable-next-line @typescript-eslint/await-thenable",
      "  g();",
      "  g(); // oxlint-disable-line await-thenable",
      "  // oxlint-disable-next-line typescript/await-thenable, no-debugger",
      "  g();",
      "  // oxlint-disable-next-line typescript/await-thenable, no-debugger",
      "  debugger;",
      "  // oxlint-disable-next-line typescript/await-thenable",
      "  await 1;",
      "  // oxlint-disable-next-line",
      "  await 2;",
      "  /* oxlint-disable typescript/await-thenable */",
      "  await 3;",
      "  /* oxlint-enable typescript/await-thenable */",
      "  await 4;",
      "  /* oxlint-disable */",
      "  g();",
      "  /* oxlint-enable */",
      "}",
      "",
    ].join("\n");
    const run = async (config: object, ...flags: string[]) => {
      const files = {
        ".oxlintrc.json": JSON.stringify(config),
        "tsconfig.json": JSON.stringify({
          compilerOptions: { strict: true, noEmit: true, lib: ["es2022"], types: [] },
        }),
        "a.ts": text,
      };
      const { problems } = await lint(files, ["a.ts", "--report-unused-disable-directives", ...flags]);
      const place = (it: string) => it.split(/[: ]/).slice(1, 3).map(Number);
      return problems
        .sort((a, b) => place(a)[0] - place(b)[0] || place(a)[1] - place(b)[1])
        .map(it => it.replace("a.ts:", "").replace(" -", " unused").replace(/ .*\//, " "));
    };
    const only = (severity: string) => ({
      categories: { correctness: "off" },
      rules: { "no-debugger": "error", "typescript/await-thenable": severity },
    });
    // These silence nothing, whether or not the rule runs.
    const always = ["3:3", "5:8", "6:3", "8:3", "10:8", "11:3", "13:31"].map(it => `${it} unused`);
    const withoutTheRule = [...always, "15:3 unused", "17:3 unused", "21:3 unused", "25:3 unused"];
    const results = await Promise.all([
      run({}),
      run({}, "--type-aware"),
      run(only("error")),
      run(only("error"), "--type-aware"),
      run(only("off")),
      run(only("off"), "--type-aware"),
    ]);
    expect(results).toEqual([
      [
        ...always,
        "15:3 unused",
        "16:3 no-unnecessary-await",
        "20:3 no-unnecessary-await",
        "21:3 unused",
        "22:3 no-unnecessary-await",
        "25:3 unused",
      ],
      [
        ...always,
        "16:3 no-unnecessary-await",
        "20:3 no-unnecessary-await",
        "22:3 no-unnecessary-await",
        "22:9 await-thenable",
        "25:3 unused",
      ],
      withoutTheRule,
      [...always, "22:9 await-thenable", "25:3 unused"],
      withoutTheRule,
      withoutTheRule,
    ]);
  });

  test("the rules that a category turns on and that do not exist here are named, in a warning", async () => {
    const config = {
      plugins: ["unicorn", "oxc", "react", "jsx-a11y", "jest"],
      categories: { correctness: "warn" },
    };
    const named = (stderr: string) =>
      /rules enabled by "categories" are not supported yet and did not run: (.*)/.exec(stderr)?.[1].split(", ") ?? [];
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

// A rule is handed such a key once, at its first place and with its last value, as `JSON.parse` makes it. So it sees the same
// whether it asks for the key or walks the entries.
describe.concurrent("a key that is written more than once in what a rule is handed", () => {
  const plugin = `
    const show = (name, value) => console.log(name + " " + JSON.stringify(value) + " " + JSON.stringify(Object.keys(value)));
    const create = context => (show("options", context.options[0]), show("settings", context.settings.mine ?? {}), {});
    module.exports = { meta: { name: "mine" }, rules: { show: { meta: { schema: false }, create } } };\n`;
  const printed = (result: { raw: string; stderr: string }, name: string) =>
    (result.raw + result.stderr).split("\n").filter(it => it.startsWith(name + " "));

  // What oxlint 1.87 prints.
  test.each([
    [
      '{"size": 1, "color": "red", "size": 3, "shape": null, "size": 5}',
      '{"size":5,"color":"red","shape":null} ["size","color","shape"]',
    ],
    // The whole of the last one: nothing is merged.
    ['{"box": {"w": 1, "h": 2}, "n": 0, "box": {"h": 3}}', '{"box":{"h":3},"n":0} ["box","n"]'],
    [
      '{"deep": {"list": [{"k": 1, "k": 2}], "list": [{"k": 3, "j": 4, "k": 5}]}}',
      '{"deep":{"list":[{"k":5,"j":4}]}} ["deep"]',
    ],
    ['{"size": "big", "size": ["small"]}', '{"size":["small"]} ["size"]'],
    ['{"size": 1, "\\u0073ize": 2}', '{"size":2} ["size"]'],
    // A property like any other.
    [
      '{"__proto__": {"size": 1}, "color": "red", "__proto__": {"size": 2}}',
      '{"__proto__":{"size":2},"color":"red"} ["__proto__","color"]',
    ],
  ])("a rule in JavaScript, from an .oxlintrc.json: %s", async (written, handed) => {
    const config = `{ "jsPlugins": ["./plugin.cjs"], "settings": { "mine": ${written} }, "rules": { "mine/show": ["error", ${written}] } }`;
    const result = await lint({ ".oxlintrc.json": config, "plugin.cjs": plugin, "a.js": "export {};\n" }, ["a.js"]);
    expect(printed(result, "options")).toEqual([`options ${handed}`]);
    expect(printed(result, "settings")).toEqual([`settings ${handed}`]);
    expect(result.exitCode).toBe(0);
  });

  // What oxlint 1.87 reports. The rule walks its one option, a map from the name of a matcher to what is said about it.
  test.each([
    ['{"toBe": "first", "toEqual": "other", "toBe": "last"}', ["2 toBe last", "3 toEqual other"]],
    ['{"toBe": "first", "toBe": null}', ["2 toBe undefined"]],
    // The first value, which no map of the rule can have, is not looked at.
    ['{"toBe": 1, "toBe": "last"}', ["2 toBe last"]],
  ])("a built-in rule that walks the entries, from an .oxlintrc.json: %s", async (written, found) => {
    const files = {
      ".oxlintrc.json": `{ "plugins": ["jest"], "categories": { "correctness": "off" }, "rules": { "jest/no-restricted-matchers": ["error", ${written}] } }`,
      "a.test.js": 'test("t", () => {\n  expect(a).toBe(1);\n  expect(a).toEqual(1);\n});\n',
    };
    const { raw, exitCode } = await lint(files, ["-f", "json", "a.test.js"]);
    type Diagnostic = { message: string; help?: string; labels: { span: { line: number } }[] };
    const diagnostics: Diagnostic[] = JSON.parse(raw).diagnostics;
    const shown = diagnostics.map(it => `${it.labels[0].span.line} ${it.message.split("`")[1]} ${it.help}`);
    expect(shown).toEqual(found);
    expect(exitCode).toBe(1);
  });

  // What oxlint 1.87 and ESLint 10.12 do: `true` if the file, which has three lines, has too many, a text if the options are refused.
  describe.each<[written: string, outcome: boolean | string]>([
    ['{"max": 1, "max": 100}', false],
    ['{"max": 100, "max": 1}', true],
    ['{"max": "many", "max": 100}', false],
    ['{"max": 100, "max": "many"}', "many"],
  ])("a built-in rule that asks for the key: %s", (written, outcome) => {
    const found = outcome === true ? ["max-lines"] : [];
    const rulesOf = (problems: string[]) => problems.map(it => it.split(" ")[1]);

    test("from an .oxlintrc.json", async () => {
      const config = `{ "categories": { "correctness": "off" }, "rules": { "max-lines": ["error", ${written}] } }`;
      const { problems, raw, exitCode } = await lint({ ".oxlintrc.json": config, "a.js": "a;\nb;\nc;\n" }, ["a.js"]);
      expect(rulesOf(problems)).toEqual(found);
      if (typeof outcome === "string") expect(raw).toContain(`invalid type: string "${outcome}", expected u32`);
      expect(exitCode).toBe(outcome === false ? 0 : 1);
    });

    test("from a comment", async () => {
      const files = {
        "eslint.config.mjs": "export default [{ rules: {} }];\n",
        "a.js": `/* eslint max-lines: ["error", ${written}] */\na;\nb;\n`,
      };
      const { problems, raw, exitCode } = await lint(files, ["a.js"]);
      expect(rulesOf(problems)).toEqual(outcome === false ? [] : ["max-lines"]);
      if (typeof outcome === "string") expect(raw).toContain(`Value \\"${outcome}\\" should be integer.`);
      expect(exitCode).toBe(outcome === false ? 0 : 1);
    });

    test("from --rule", async () => {
      const files = { "eslint.config.mjs": "export default [{ rules: {} }];\n", "a.js": "a;\nb;\nc;\n" };
      const { problems, stderr, exitCode } = await lint(files, ["--rule", `max-lines: ["error", ${written}]`, "a.js"]);
      expect(rulesOf(problems)).toEqual(found);
      if (typeof outcome === "string") expect(stderr).toContain(`Value "${outcome}" should be integer.`);
      expect(exitCode).toBe(typeof outcome === "string" ? 2 : Number(outcome));
    });
  });

  // What ESLint 10.12 prints. It reads both with levn, which assigns each entry to an object: `__proto__` is no property then.
  describe.each([
    [
      '{"size": 1, "color": "red", "size": 3, "shape": null, "size": 5}',
      '{"size":5,"color":"red","shape":null} ["size","color","shape"]',
    ],
    ['{"box": {"w": 1, "h": 2}, "n": 0, "box": {"h": 3}}', '{"box":{"h":3},"n":0} ["box","n"]'],
    [
      '{"deep": {"list": [{"k": 1, "k": 2}], "list": [{"k": 3, "j": 4, "k": 5}]}}',
      '{"deep":{"list":[{"k":5,"j":4}]}} ["deep"]',
    ],
    [`{size: 1, "size": 2, 'size': 3}`, '{"size":3} ["size"]'],
    ['{"__proto__": {"size": 1}, "color": "red"}', '{"color":"red"} ["color"]'],
  ])("a rule in JavaScript, with an eslint.config.mjs: %s", (written, handed) => {
    const files = {
      "eslint.config.mjs": `import mine from "./plugin.cjs";\nexport default [{ plugins: { mine } }];\n`,
      "plugin.cjs": plugin,
    };

    test("from a comment", async () => {
      const code = `/* eslint mine/show: ["error", ${written}] */\nexport {};\n`;
      expect(printed(await lint({ ...files, "a.js": code }, ["a.js"]), "options")).toEqual([`options ${handed}`]);
    });

    test("from --rule", async () => {
      const result = await lint({ ...files, "a.js": "export {};\n" }, [
        "--rule",
        `mine/show: ["error", ${written}]`,
        "a.js",
      ]);
      expect(printed(result, "options")).toEqual([`options ${handed}`]);
    });
  });

  // TOML has no such thing.
  test.each([
    'max-lines = ["error", { max = 100, max = 1 }]\n',
    'max-lines = "off"\nmax-lines = ["error", { max = 1 }]\n',
    '"max-lines" = "off"\nmax-lines = ["error", { max = 1 }]\n',
  ])("a bunfig.toml is refused: %j", async rules => {
    const { problems, stderr, exitCode } = await lint({ "bunfig.toml": `[lint.rules]\n${rules}`, "a.js": "a;\nb;\n" }, [
      "a.js",
    ]);
    expect(problems).toEqual([]);
    expect(stderr).toContain("error: Cannot redefine key");
    expect(exitCode).toBe(2);
  });

  // The words of js-yaml 4, which reads these files for ESLint 8 and throws. It reads an `.eslintrc` too, which can be JSON.
  test.each([
    [
      ".eslintrc.yaml",
      "root: true\nrules:\n  max-lines: [error, {max: 100, max: 1}]\n",
      "duplicated mapping key (3:33)\n\n 1 | root: true\n 2 | rules:\n 3 |   max-lines: [error, {max: 100, max: 1}]\n-------------------------------------^",
    ],
    [
      ".eslintrc.yml",
      'root: true\nrules:\n  "no-var": off\n  eqeqeq: off\n  no-var: error\nenv: {}\nglobals: {}\nsettings: {}\n',
      'duplicated mapping key (5:3)\n\n 2 | rules:\n 3 |   "no-var": off\n 4 |   eqeqeq: off\n 5 |   no-var: error\n-------^\n 6 | env: {}\n 7 | globals: {}',
    ],
    [
      ".eslintrc",
      '{ "root": true, "rules": { "no-var": "off", "no-var": "error" } }\n',
      'duplicated mapping key (1:45)\n\n 1 |  ... e, "rules": { "no-var": "off", "no-var": "error" } }\n-----------------------------------------^',
    ],
  ])("a %s is refused", async (name, text, why) => {
    const { problems, stderr, exitCode } = await lint({ [name]: text, "a.js": "var a;\n" }, ["a.js"]);
    expect(problems).toEqual([]);
    expect(stderr).toContain(`Cannot read config file: <dir>/${name}\nError: ${why}`);
    expect(exitCode).toBe(2);
  });
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

  test("aliases of YAML that stand for 100,000 values are read", async () => {
    const level = (i: number) => `  a${i}: &a${i} [${Array(10).fill(i ? `*a${i - 1}` : "x")}]\n`;
    const settings = `settings:\n${[0, 1, 2, 3, 4].map(level).join("")}`;
    const { problems, exitCode } = await lint({ ".eslintrc.yaml": yaml("eqeqeq") + settings, "a.js": code });
    expect(problems).toEqual(["a.js:2:7 eqeqeq"]);
    expect(exitCode).toBe(1);
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
      "a.js": "var a = 1;\nif (a) { function f() {} f(); }\na + 1 == null;\n",
    };
    const alone = await lint({ ...files, ".eslintrc.json": rc({ extends: ["eslint:recommended"] }) });
    expect(alone.problems).toEqual(["a.js:2:10 no-inner-declarations"]);
    const after = await lint({ ...files, ".eslintrc.json": rc({ extends: ["./base.json", "eslint:recommended"] }) });
    expect(after.problems).toEqual(["a.js:2:10 no-inner-declarations", "a.js:3:1 no-constant-binary-expression"]);
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
      "a.js": "var one = new Symbol(), two = new Object();\n",
    });
    // What was deprecated by then is not in it.
    expect(problems).toContain("a.js:1:15 no-new-symbol");
    expect(problems.filter(it => it.endsWith("no-new-object"))).toEqual([]);
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

  const ignores = (ignored: string, used = ".oxlintrc.json") =>
    `note: Using ${used}. ${ignored} is ignored. Use --config to pick it.`;

  // A project with both configs is moving to oxlint.
  test("the oxlint config wins over an ESLint config, and one note says so", async () => {
    const { problems, stderr, exitCode } = await lint(both, ["a.js", "sub/b.js"]);
    expect(problems).toEqual(["a.js:2:7 eqeqeq"]);
    expect(stderr).toBe(ignores("eslint.config.js"));
    expect(exitCode).toBe(1);
    // Also where one is further up than the other.
    const { "sub/.oxlintrc.json": _, ...above } = both;
    const below = await lint(above, ["b.js"], { cwd: "sub" });
    expect(below.problems).toEqual(["sub/b.js:2:7 eqeqeq"]);
    expect(below.stderr).toBe(ignores("eslint.config.js", "../.oxlintrc.json"));
    expect(below.exitCode).toBe(1);
    expect((await lint(both, ["--silent", "a.js"])).stderr).toBe("");
    expect((await lint(both, ["--nonsense"])).exitCode).toBe(1);
  });

  const [ofESLint, ofOxlint, legacy] = [both["eslint.config.js"], oxlintrc({ "no-debugger": "error" }), rc(noVar)];
  const asModule = ofESLint.replace("module.exports =", "export default");
  test.each([
    ["eslint.config.js", ofESLint, "no-var"],
    ["eslint.config.mjs", asModule, "no-var"],
    ["eslint.config.cjs", ofESLint, "no-var"],
    ["eslint.config.ts", asModule, "no-var"],
    ["eslint.config.mts", asModule, "no-var"],
    ["eslint.config.cts", ofESLint, "no-var"],
    ["mine.js", ofESLint, "no-var"],
    [".oxlintrc.json", ofOxlint, "no-debugger"],
    [".oxlintrc.jsonc", `// Mine.\n${ofOxlint}`, "no-debugger"],
    ["oxlint.config.ts", `export default ${ofOxlint};`, "no-debugger"],
    ["oxlint.config.mts", `export default ${ofOxlint};`, "no-debugger"],
    ["vite.config.ts", `export default { lint: ${ofOxlint} };`, "no-debugger"],
    ["mine.json", ofOxlint, "no-debugger"],
    [".eslintrc.json", legacy, "no-var"],
    [".eslintrc", legacy, "no-var"],
    [".eslintrc.js", `module.exports = ${legacy};`, "no-var"],
    [".eslintrc.cjs", `module.exports = ${legacy};`, "no-var"],
    [".eslintrc.yaml", yaml("no-var"), "no-var"],
    [".eslintrc.yml", yaml("no-var"), "no-var"],
    ["legacy.json", legacy, "no-var"],
  ])("with both kinds of config file, --config picks %s and prints no note", async (name, text, rule) => {
    const files = { ...both, [`picked/${name}`]: text };
    const [byFlag, byKey] = await Promise.all([
      lint(files, ["--config", `picked/${name}`, "a.js"]),
      lint({ ...files, "bunfig.toml": `[lint]\nconfig = "picked/${name}"\n` }, ["a.js"]),
    ]);
    for (const { problems, stderr } of [byFlag, byKey]) {
      expect(problems.map(it => it.split(" ")[1])).toEqual([rule]);
      expect(stderr).not.toContain("is ignored");
    }
  });

  test("an eslint.config.js wins over a dependency on oxlint", async () => {
    const files = {
      "eslint.config.js": both["eslint.config.js"],
      "package.json": JSON.stringify({ devDependencies: { eslint: "*", oxlint: "*" } }),
      "a.js": code,
    };
    const { problems, stderr } = await lint(files, ["a.js"]);
    expect(problems).toEqual(["a.js:1:1 no-var"]);
    expect(stderr).not.toContain("is ignored");
    expect((await lint(files, ["--flavor=eslint", "a.js"])).problems).toEqual(["a.js:1:1 no-var"]);
    // Its defaults.
    expect((await lint(files, ["--flavor=oxlint", "a.js"])).problems).toEqual(["a.js:2:13 no-debugger"]);
    expect((await lint(files, ["--type-aware", "a.js"])).problems).toEqual(["a.js:1:1 no-var"]);
  });

  test.each([
    [["--type-aware"], ["a.js:2:7 eqeqeq"]],
    [["--cache"], ["a.js:2:7 eqeqeq"]],
    [["--no-warn-ignored"], ["a.js:2:7 eqeqeq"]],
    [
      ["--rule", "no-var: error"],
      ["a.js:1:1 no-var", "a.js:2:7 eqeqeq"],
    ],
    [
      ["-D", "no-debugger"],
      ["a.js:2:13 no-debugger", "a.js:2:7 eqeqeq"],
    ],
  ])("%j doesn't pick between an ESLint and an oxlint config", async (flags, expected) => {
    const { problems, stderr } = await lint(both, [...flags, "a.js"]);
    expect(problems).toEqual(expected);
    expect(stderr).toBe(ignores("eslint.config.js"));
  });

  test.each([
    ["eslint", ["a.js:1:1 no-var"]],
    ["oxlint", ["a.js:2:7 eqeqeq"]],
  ])("--flavor=%s", async (flavor, expected) => {
    const { problems, stderr } = await lint(both, [`--flavor=${flavor}`, "a.js", "sub/b.js"]);
    expect(problems).toEqual(expected);
    expect(stderr).not.toContain("is ignored");
  });

  test("--flavor takes two values", async () => {
    const { stderr, exitCode } = await lint(both, ["--flavor=biome", "."]);
    expect(stderr).toContain('--flavor must be eslint or oxlint, not "biome"');
    expect(exitCode).toBe(1);
  });

  // Covers every flag in the "Compatibility with oxlint" group of --help --all.
  test("oxlint flags keep Bun's default rules and output without a config file", async () => {
    const run = async (...args: string[]) => {
      using dir = tempDir("bun-lint-oxlint-flags", { "a.js": "export function f(a) {\n  if (a) {\n  }\n}\n" });
      const stdio = { stdin: "ignore", stdout: "pipe", stderr: "pipe" } as const;
      await using proc = spawn({ cmd: [...command, ...args], env, cwd: String(dir), ...stdio });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr: stderr.replace(/ \[[\d.]+m?s\]/, ""), exitCode };
    };
    const [help, plain, limited] = await Promise.all([run("--help", "--all"), run(), run("--max-warnings", "0")]);
    expect(plain.stdout).toContain("warn: Empty block statement.  no-empty\n");
    expect(plain.stdout).toEndWith("\n1 problem (0 errors, 1 warning)\n");
    expect([plain.stderr, plain.exitCode]).toEqual(["Linted 1 file\n", 0]);
    expect(limited).toEqual({
      stdout: plain.stdout,
      stderr: "error: Found too many warnings (maximum: 0).\nLinted 1 file\n",
      exitCode: 1,
    });

    const error = (text: string) => ({ stdout: "", stderr: `error: ${text}\n`, exitCode: 2 });
    const expected: Record<string, [args: string[], result: typeof plain]> = {
      allow: [["-A", "no-var"], plain],
      warn: [["-W", "no-empty"], plain],
      deny: [["-D", "no-var"], plain],
      "deny-warnings": [["--deny-warnings"], limited],
      silent: [["--silent"], { stdout: "", stderr: "", exitCode: 0 }],
      "disable-nested-config": [["--disable-nested-config"], plain],
      lsp: [["--lsp"], error("bun lint does not support --lsp")],
    };
    const group = help.stdout.slice(help.stdout.indexOf("Compatibility with oxlint"));
    const flags = [...group.matchAll(/^ +(?:-\w, )?--([a-z0-9-]+)/gm)].map(it => it[1]);
    // Every built-in rule is available without a config file, so there are no plugins to turn on or off.
    for (const flag of flags.filter(it => it.endsWith("-plugin"))) {
      const why = `--${flag} is an oxlint flag and has no effect here\n  This run uses Bun's defaults.`;
      expected[flag] = [[`--${flag}`], error(why)];
    }
    expect(Object.keys(expected).sort()).toEqual(flags.sort());
    const results = await Promise.all(Object.values(expected).map(([args]) => run(...args)));
    expect(Object.fromEntries(Object.keys(expected).map((flag, at) => [flag, results[at]]))).toEqual(
      Object.fromEntries(Object.entries(expected).map(([flag, [, result]]) => [flag, result])),
    );
    expect(await run("--deny-warnings", "--silent")).toEqual({ stdout: "", stderr: "", exitCode: 1 });
  });

  test("-A, -W and -D add to Bun's defaults without a config file", async () => {
    const files = { "a.js": "var x = 1;\nexport function f(a) {\n  if (a) {\n  }\n  return x;\n}\n" };
    const run = async (...flags: string[]) => {
      const { problems, exitCode } = await lint(files, [...flags, "a.js"]);
      return [problems, exitCode];
    };
    const [noVar, noEmpty] = ["a.js:1:1 no-var", "a.js:3:10 no-empty"];
    expect(await run()).toEqual([[noEmpty], 0]);
    expect(await run("-D", "no-var")).toEqual([[noVar, noEmpty], 1]);
    expect(await run("-W", "no-var")).toEqual([[noVar, noEmpty], 0]);
    expect(await run("-D", "eslint/no-var")).toEqual([[noVar, noEmpty], 1]);
    expect(await run("-D", "no-var", "-A", "no-var")).toEqual([[noEmpty], 0]);
    expect(await run("-A", "no-empty")).toEqual([[], 0]);
    // A category works like [lint.categories].
    const byKey = await lint({ ...files, "bunfig.toml": `[lint.categories]\nrestriction = "error"\n` }, ["a.js"]);
    expect(byKey.problems).toContain(noVar);
    expect(await run("-D", "restriction")).toEqual([byKey.problems, 1]);
  });

  test.each([
    [["-D", "no-vra"], `Unknown rule "no-vra"\n  Did you mean "no-var"?`],
    [["-A", "no-vra"], `Unknown rule "no-vra"\n  Did you mean "no-var"?`],
    [["-W", "indent"], `"indent" is a formatting rule\n  bun fmt does that`],
  ])("%j is rejected without a config file", async (flags, why) => {
    const { problems, stderr, exitCode } = await lint({ "a.js": code }, [...flags, "a.js"]);
    expect({ problems, stderr, exitCode }).toEqual({ problems: [], stderr: `error: ${why}`, exitCode: 2 });
  });

  test("without a root config file, --disable-nested-config skips config files in subdirectories", async () => {
    const files = { "a.js": code, "sub/.oxlintrc.json": oxlintrc({ eqeqeq: "error" }), "sub/b.js": code };
    expect((await lint(files)).problems).toEqual(["a.js:2:13 no-debugger", "sub/b.js:2:7 eqeqeq"]);
    expect((await lint(files, ["--disable-nested-config", "."])).problems).toEqual([
      "a.js:2:13 no-debugger",
      "sub/b.js:2:13 no-debugger",
    ]);
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
      "No config file found, and package.json depends on both eslint and oxlint\n  Using oxlint's defaults. Add a config file to change that.",
    );
    expect(both.exitCode).toBe(0);
    const chosen = await lint({ ...files, "package.json": dependsOn("eslint", "oxlint") }, ["--flavor=eslint", "."]);
    expect(chosen.stderr).not.toContain("No config file found");
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

  describe("the file that is found decides, whatever flags there are", () => {
    const flat = { "eslint.config.js": both["eslint.config.js"] };
    const oxlint = { ".oxlintrc.json": both[".oxlintrc.json"] };
    const projects = {
      "no file": {},
      "eslint.config.js": flat,
      ".eslintrc.json": { ".eslintrc.json": rc(noVar) },
      ".oxlintrc.json": oxlint,
      "both": { ...flat, ...oxlint },
      ".eslintrc.json and .oxlintrc.json": { ".eslintrc.json": rc(noVar), ...oxlint },
      "eslint.config.js and the dependency": { ...flat, "package.json": `{ "devDependencies": { "oxlint": "*" } }` },
      "the dependency": { "package.json": `{ "devDependencies": { "oxlint": "*" } }` },
      "files by other names": { "mine.js": both["eslint.config.js"], "mine.json": both[".oxlintrc.json"] },
      "eslint.config.js and [lint.categories]": {
        ...flat,
        "bunfig.toml": `[lint.categories]\ncorrectness = "error"\n`,
      },
      ".oxlintrc.json and [lint] ext": { ...oxlint, "bunfig.toml": `[lint]\next = [".js"]\n` },
    };
    // The rules of the file of ESLint, of that of oxlint, the defaults of oxlint, what is built in, no rule at all.
    const [ofESLint, ofOxlint] = [[["a.js:1:1 no-var"], 1] as const, [["a.js:2:7 eqeqeq"], 1] as const];
    const [defaults, builtIn] = [[["a.js:2:13 no-debugger"], 0] as const, [["a.js:2:13 no-debugger"], 1] as const];
    const [nothing, failsInSilence] = [[[], 0] as const, [[], 1] as const];
    const refused = (flag: string, whose: string, where: string) =>
      [[], 2, `error: ${flag} is an ${whose} flag and has no effect here\n  This run uses ${where}.`] as const;
    const withFlat = "eslint.config.js, an ESLint config";
    const withLegacy = ".eslintrc.json, an ESLint 8 config";
    const withOxlint = ".oxlintrc.json, an oxlint config";

    test.each<[keyof typeof projects, string[], readonly [readonly string[], number, string?]]>([
      ["eslint.config.js", [], ofESLint],
      ["eslint.config.js", ["--silent"], failsInSilence],
      ["eslint.config.js", ["--silent", "-f", "unix"], failsInSilence],
      ["eslint.config.js", ["--deny-warnings"], ofESLint],
      ["eslint.config.js", ["--disable-nested-config"], ofESLint],
      ["eslint.config.js", ["--fix-suggestions"], ofESLint],
      ["eslint.config.js", ["-D", "eqeqeq"], [["a.js:1:1 no-var", "a.js:2:7 eqeqeq"], 1]],
      ["eslint.config.js", ["-W", "no-var"], [["a.js:1:1 no-var"], 0]],
      ["eslint.config.js", ["-A", "no-var"], nothing],
      ["eslint.config.js", ["-A", "no-var", "--rule", "no-var: error"], ofESLint],
      ["eslint.config.js", ["-D", "correctness"], refused("-D correctness", "oxlint", withFlat)],
      ["eslint.config.js", ["-A", "all"], refused("-A all", "oxlint", withFlat)],
      ["eslint.config.js", ["--import-plugin"], refused("--import-plugin", "oxlint", withFlat)],
      ["eslint.config.js", ["--disable-oxc-plugin"], refused("--disable-oxc-plugin", "oxlint", withFlat)],
      ["eslint.config.js", ["--env", "browser"], refused("--env browser", "ESLint 8", withFlat)],
      ["eslint.config.js", ["--rulesdir", "rules"], refused("--rulesdir rules", "ESLint 8", withFlat)],
      ["eslint.config.js", ["--no-eslintrc"], refused("--no-eslintrc", "ESLint 8", withFlat)],
      [
        "eslint.config.js",
        ["--resolve-plugins-relative-to", "."],
        refused("--resolve-plugins-relative-to .", "ESLint 8", withFlat),
      ],
      ["eslint.config.js", ["--eslintrc"], ofESLint],
      ["eslint.config.js", ["--flavor=oxlint"], defaults],
      ["eslint.config.js and [lint.categories]", [], ofESLint],

      [".eslintrc.json", ["--silent"], failsInSilence],
      [".eslintrc.json", ["--deny-warnings"], ofESLint],
      [".eslintrc.json", ["-A", "no-var"], nothing],
      [".eslintrc.json", ["-A", "all"], refused("-A all", "oxlint", withLegacy)],
      [".eslintrc.json", ["--react-plugin"], refused("--react-plugin", "oxlint", withLegacy)],
      [".eslintrc.json", ["--env", "browser"], ofESLint],
      [".eslintrc.json", ["--flavor=oxlint"], defaults],

      [".oxlintrc.json", ["--silent"], failsInSilence],
      [".oxlintrc.json", ["--cache"], ofOxlint],
      [".oxlintrc.json", ["--stats"], ofOxlint],
      [".oxlintrc.json", ["--rule", "no-var: error"], [["a.js:1:1 no-var", "a.js:2:7 eqeqeq"], 1]],
      [".oxlintrc.json", ["--ext", ".js"], refused("--ext .js", "ESLint", withOxlint)],
      [".oxlintrc.json", ["--parser", "espree"], refused("--parser espree", "ESLint", withOxlint)],
      [
        ".oxlintrc.json",
        ["--report-unused-inline-configs", "error"],
        refused("--report-unused-inline-configs error", "ESLint", withOxlint),
      ],
      [".oxlintrc.json", ["--env", "browser"], refused("--env browser", "ESLint 8", withOxlint)],
      [".oxlintrc.json", ["--rulesdir", "rules"], refused("--rulesdir rules", "ESLint 8", withOxlint)],
      [".oxlintrc.json", ["--no-eslintrc"], refused("--no-eslintrc", "ESLint 8", withOxlint)],
      [".oxlintrc.json", ["--flavor=eslint"], builtIn],
      [".oxlintrc.json and [lint] ext", [], ofOxlint],

      ["no file", [], builtIn],
      ["no file", ["--silent"], failsInSilence],
      ["no file", ["--deny-warnings"], builtIn],
      ["no file", ["--disable-nested-config"], builtIn],
      ["no file", ["-D", "correctness"], builtIn],
      ["no file", ["--import-plugin"], refused("--import-plugin", "oxlint", "Bun's defaults")],
      ["no file", ["--fix-suggestions"], builtIn],
      ["no file", ["--fix-dangerously"], builtIn],
      ["no file", ["--type-check"], builtIn],
      // Only ESLint 8 has --env, so this is an ESLint 8 run, which has no rules on.
      ["no file", ["--env", "browser"], nothing],
      ["no file", ["--flavor=eslint", "--import-plugin"], refused("--import-plugin", "oxlint", "Bun's defaults")],
      ["no file", ["--flavor=oxlint", "--env", "browser"], refused("--env browser", "ESLint 8", "oxlint's defaults")],
      ["the dependency", [], defaults],
      ["the dependency", ["--cache"], defaults],
      ["the dependency", ["--parser", "espree"], refused("--parser espree", "ESLint", "oxlint's defaults")],
      ["both", [], [...ofOxlint, ignores("eslint.config.js")]],
      [".eslintrc.json and .oxlintrc.json", [], [...ofOxlint, ignores(".eslintrc.json")]],
      ["both", ["--silent"], failsInSilence],
      ["both", ["--deny-warnings"], ofOxlint],
      ["both", ["--cache"], ofOxlint],
      ["both", ["--ext", ".js"], refused("--ext .js", "ESLint", withOxlint)],
      ["both", ["--env", "browser"], refused("--env browser", "ESLint 8", withOxlint)],

      ["eslint.config.js and the dependency", [], ofESLint],
      ["eslint.config.js and the dependency", ["--silent"], failsInSilence],
      [
        "eslint.config.js and the dependency",
        ["--deny-warnings", "-D", "correctness"],
        refused("-D correctness", "oxlint", withFlat),
      ],
      ["eslint.config.js and the dependency", ["--cache"], ofESLint],
      ["eslint.config.js and the dependency", ["--rules"], nothing],

      ["files by other names", ["-c", "mine.js", "--threads", "8"], ofESLint],
      ["files by other names", ["-c", "mine.json", "--threads", "8"], ofOxlint],
      ["files by other names", ["-c", "mine.js", "--threads", "8", "--silent"], failsInSilence],
      ["files by other names", ["-c", "mine.json", "--threads", "8", "--silent"], failsInSilence],
      ["files by other names", ["-c", "mine.js", "-A", "no-var"], nothing],
      ["files by other names", ["-c", "mine.json", "-A", "eqeqeq"], nothing],
      [
        "files by other names",
        ["-c", "mine.js", "--import-plugin"],
        refused("--import-plugin", "oxlint", "mine.js, an ESLint config"),
      ],
      [
        "files by other names",
        ["-c", "mine.json", "--ext", ".js"],
        refused("--ext .js", "ESLint", "mine.json, an oxlint config"),
      ],
    ])("%s, %j", async (project, flags, [problems, exitCode, said]) => {
      const run = await lint({ ...projects[project], "a.js": code }, [...flags, "a.js"]);
      expect([run.problems, run.exitCode]).toEqual([[...problems], exitCode]);
      if (said !== undefined) expect(run.stderr).toEndWith(said);
    });

    test("also one that is found further up", async () => {
      const files = { ...flat, "sub/a.js": code };
      expect((await lint(files, ["--silent", "a.js"], { cwd: "sub" })).exitCode).toBe(1);
      expect((await lint(files, ["--deny-warnings", "a.js"], { cwd: "sub" })).problems).toEqual([
        "sub/a.js:1:1 no-var",
      ]);
    });

    test("also those further down, where the working directory has none", async () => {
      const one = { "one/eslint.config.js": both["eslint.config.js"], "one/a.js": code };
      const files = {
        ...one,
        "two/.oxlintrc.json": both[".oxlintrc.json"],
        "two/b.js": code,
        "three/.eslintrc.json": rc({ rules: { "no-debugger": "error" } }),
        "three/c.js": code,
      };
      for (const args of [["."], ["one/a.js", "two/b.js", "three/c.js"]]) {
        expect((await lint(files, ["--deny-warnings", ...args])).problems).toEqual([
          "one/a.js:1:1 no-var",
          "three/c.js:2:13 no-debugger",
          "two/b.js:2:7 eqeqeq",
        ]);
      }
      expect((await lint(files, ["--silent", "one"])).exitCode).toBe(1);
      const withFile = "one/eslint.config.js, an ESLint config.";
      for (const [flags, said, uses] of [
        [["--env", "browser"], "--env browser is an ESLint 8 flag and has no effect here", withFile],
        [["--no-eslintrc"], "--no-eslintrc is an ESLint 8 flag and has no effect here", withFile],
        [["--import-plugin"], "--import-plugin is an oxlint flag and has no effect here", "Bun's defaults."],
      ] as const) {
        for (const args of [["."], ["one/a.js"]]) {
          const { problems, stderr, exitCode } = await lint(one, [...flags, ...args]);
          expect({ problems, stderr, exitCode }).toEqual({
            problems: [],
            stderr: `error: ${said}\n  This run uses ${uses}`,
            exitCode: 2,
          });
        }
      }
    });

    test("--silent prints nothing, and --deny-warnings fails on a warning like --max-warnings 0", async () => {
      const files = {
        "eslint.config.js": `module.exports = [{ rules: { "no-var": "warn" } }];`,
        "a.js": "var x = 1;\n",
      };
      expect((await lint(files, ["a.js"])).exitCode).toBe(0);
      const denied = await lint(files, ["--deny-warnings", "a.js"]);
      expect([denied.problems, denied.exitCode]).toEqual([["a.js:1:1 no-var"], 1]);
      expect(denied.stderr).toStartWith("error: Found too many warnings (maximum: 0).\n");
      const { stdout, stderr, exitCode } = await lint(files, ["--deny-warnings", "--silent", "a.js"]);
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: "", stderr: "", exitCode: 1 });
    });

    test("-D leaves a rule the options that the file gives it", async () => {
      const files = {
        "eslint.config.js": `module.exports = [{ rules: { eqeqeq: ["off", "always", { null: "ignore" }] } }];`,
        "a.js": "x == null;\nx == 1;\n",
      };
      expect((await lint(files, ["-D", "eqeqeq", "a.js"])).problems).toEqual(["a.js:2:3 eqeqeq"]);
    });

    test("--print-config prints the configuration of ESLint", async () => {
      const { raw, exitCode } = await lint({ ...flat, "a.js": code }, ["--print-config", "a.js", "--silent"]);
      expect(JSON.parse(raw).rules).toEqual({ "no-var": [2] });
      expect(exitCode).toBe(0);
    });

    test("an .oxlintrc.json below a file of ESLint 8 is not read because of a flag", async () => {
      const files = { ".eslintrc.json": rc(noVar), "sub/.oxlintrc.json": "not JSON", "sub/a.js": code };
      expect((await lint(files, ["--deny-warnings", "sub/a.js"])).problems).toEqual(["sub/a.js:1:1 no-var"]);
    });
  });
});

describe.concurrent("the command line of oxlint", () => {
  const oxlintrc = JSON.stringify({ categories: { correctness: "off" }, rules: { "no-var": "warn" } });

  test.each([
    [["--nonsense"], "Invalid option '--nonsense'"],
    [["--threads=x"], '--threads takes a number, not "x"'],
    [["--max-warnings=x"], "Invalid value for option 'max-warnings'"],
    [["--debug=nonsense"], "couldn't parse `nonsense`: 'nonsense' is not a known debug option"],
    [["--debug=files,timings"], "debug option 'files' cannot be combined with other debug options"],
    [["-f", "nonsense"], 'Unknown format "nonsense"\n  Available formats: stylish, '],
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

  test("a run that uses oxlint because of --config or package.json also exits with 1", async () => {
    const broken = { "broken.json": "{", "a.js": code };
    expect((await lint(broken, ["-c", "broken.json"])).exitCode).toBe(1);
    const files = { "package.json": JSON.stringify({ devDependencies: { oxlint: "*" } }), "a.js": code };
    expect((await lint(files, ["--type-check"])).exitCode).toBe(1);
    // --type-check works on its own without a config file.
    expect((await lint({ "a.js": code }, ["--type-check"])).problems).toEqual(["a.js:2:13 no-debugger"]);
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

  // The texts are those of oxlint 1.87.0.
  test.each([
    [
      { settings: { react: { version: 1 } } },
      'invalid type: integer `1`, expected a version string like \\"18.2.0\\" or \\"17.0\\"',
    ],
    [{ settings: { react: { version: "detect" } } }, "invalid major version in settings.react.version"],
    [{ settings: { react: { version: "18.x" } } }, "invalid minor version in settings.react.version"],
    [{ settings: { react: { version: "18.2.0-rc.1" } } }, "invalid patch version in settings.react.version"],
    [{ settings: { react: { version: "18.2.0.1" } } }, "has too many components, expected major.minor.patch"],
    [{ settings: { react: { version: "" } } }, "version string cannot be empty for settings.react.version"],
    [
      { rules: { "no-unused-vars": ["error", { vars: "nope" }] } },
      "Invalid 'vars' option for no-unused-vars: Expected  or all or local, got nope",
    ],
    [
      { rules: { "no-unused-vars": ["off", "nope"] } },
      "Invalid 'vars' option for no-unused-vars: Expected  or all or local, got nope",
    ],
    [
      { rules: { "no-unused-vars": ["error", { args: 1 }] } },
      "Invalid 'args' option for no-unused-vars: Expected a string, got 1",
    ],
    [{ rules: { "no-unused-vars": ["error", { args: "some" }] } }, "Expected  or after-used or all or none, got some"],
    [
      { rules: { "no-unused-vars": ["error", { caughtErrors: "some" }] } },
      "Invalid 'caughtErrors' option for no-unused-vars: Expected  or all or none, got some",
    ],
    [
      { rules: { "no-unused-vars": ["error", 1] } },
      "Invalid 'vars' option for no-unused-vars: Expected a string or an object, got 1",
    ],
  ])("an option value that oxlint rejects is a config error: %j", async (config, why) => {
    // `stdout` has its backslashes normalized, and one of these texts has some.
    const { raw, exitCode } = await lint({ ".oxlintrc.json": JSON.stringify(config), "a.js": code });
    expect(raw).toContain(why);
    expect(exitCode).toBe(1);
  });

  test.each([
    { settings: { react: { version: "18" } } },
    { settings: { react: { version: "18.2" } } },
    { settings: { react: { version: null } } },
    { rules: { "no-unused-vars": ["error", "local"] } },
    { rules: { "no-unused-vars": ["error", { vars: "all", args: "after-used", caughtErrors: "none" }] } },
    { rules: { "no-unused-vars": ["error", { caughtErrors: false }] } },
  ])("an option value that oxlint accepts is not: %j", async config => {
    const { stdout } = await lint({ ".oxlintrc.json": JSON.stringify(config), "a.js": code });
    expect(stdout).toStartWith('{"results":');
  });

  // Rules that look at several files lint a file a second time, without types.
  test("--type-check still reports type errors when import rules are on", async () => {
    const files = {
      "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [] } }),
      "q.ts": "export const q = 1;\n",
      "b.ts": [
        'import { q } from "./q";',
        'import { q as r } from "./q";',
        "// oxlint-disable-next-line",
        'const n: number = "x";',
        "var old = await 1;",
        "export default [n, q, r, old];",
        "",
      ].join("\n"),
    };
    const rules = { "no-var": "error", "import/no-duplicates": "error", "typescript/await-thenable": "error" };
    const config = JSON.stringify({ plugins: ["import", "typescript"], categories: { correctness: "off" }, rules });
    const { problems, exitCode } = await lint({ ...files, ".oxlintrc.json": config }, ["--type-aware", "--type-check"]);
    expect(problems).toEqual([
      "b.ts:1:19 import/no-duplicates",
      "b.ts:4:7 typescript/TS2322",
      "b.ts:5:1 no-var",
      "b.ts:5:17 @typescript-eslint/await-thenable",
    ]);
    expect(exitCode).toBe(1);
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

  // What oxlint 1.87.0 lints. It hands the value to the crate `ignore` as the name of a file to look for.
  describe("--ignore-path", () => {
    const [x, y, z, top] = ["packages/a/generated/x.js", "packages/a/src/y.js", "rest/z.js", "top.js"];
    const tree = { ".oxlintrc.json": oxlintrc, [x]: code, [y]: code, [z]: code, [top]: code };
    /** The files that are linted. `$` in an argument is the directory that `tree` is in. */
    async function linted(files: Record<string, string>, args: string[], cwd?: string) {
      const before = (dir: string) => args.forEach((it, index) => (args[index] = it.replace("$", () => dir)));
      const { problems } = await lint({ ...tree, ...files }, args, { cwd, before });
      return problems.map(it => it.split(":")[0]);
    }

    test.each([
      [".eslintignore", [y, top]],
      [".mine", [y, top]],
      [".only-here", [x, z, top]],
    ])("%s is read in every directory that has it", async (name, expected) => {
      const files = {
        ".eslintignore": "rest/\n",
        ".mine": "rest/\n",
        "packages/a/.eslintignore": "generated/\n",
        "packages/a/.mine": "generated/\n",
        "packages/a/.only-here": "src/\n",
      };
      expect(await linted(files, ["--ignore-path", name, "."])).toEqual(expected);
    });

    test.each([
      [{ ".mine": "*.js\n", "packages/a/.mine": "!y.js\n" }, [y]],
      [{ ".mine": "src/\n", "packages/a/.mine": "!src/\n" }, [x, y, z, top]],
      // Wherever the two are.
      [{ ".mine": "y.js\n", "packages/a/.gitignore": "!y.js\n" }, [x, z, top]],
      [{ ".mine": "!y.js\n", "packages/a/.gitignore": "y.js\n" }, [x, y, z, top]],
    ])("the nearest file decides, and all of them come before .gitignore: %j", async (files, expected) => {
      expect(await linted(files, ["--ignore-path", ".mine", "."])).toEqual(expected);
    });

    test("so does .eslintignore", async () => {
      const files = { ".eslintignore": "y.js\n", "packages/a/.gitignore": "!y.js\n" };
      expect(await linted(files, ["."])).toEqual([x, z, top]);
    });

    test.each([
      [{ ".mine": "src/\n" }, ["--ignore-path", ".mine", "a"], "packages", [x]],
      [{ ".mine": "src/\n" }, ["--ignore-path", ".mine"], "packages/a", [x]],
      [{ ".mine": "src/\n", "packages/a/.git/HEAD": "" }, ["--ignore-path", ".mine"], "packages/a", [x]],
      [{ ".eslintignore": "src/\n", "packages/a/.git/HEAD": "" }, ["packages/a"], ".", [x]],
    ])("so do the files above the search, and above a repository: %j %j", async (files, args, cwd, expected) => {
      expect(await linted(files, args, cwd)).toEqual(expected);
    });

    // From there on the crate looks for the name among the entries of a directory. Above, it joins it to the directory.
    test.each([
      [{ ".mine": "rest/\n" }, ["./.mine", "."], [x, y, z, top]],
      [{ "packages/a/.mine": "generated/\n" }, ["packages/a/.mine", "."], [x, y, z, top]],
      [{ ".mine": "/rest/\n" }, ["$/.mine", "."], [x, y, z, top]],
      [{ "packages/a/.mine": "/a/src/\n" }, ["a/.mine", "packages/a"], [x]],
      [{ ".mine": "/a/src/\n" }, ["$/.mine", "packages/a"], [x]],
    ])("a path is only found above where the search starts: %j %j", async (files, args, expected) => {
      expect(await linted(files, ["--ignore-path", ...args])).toEqual(expected);
    });

    test.each([
      [{ ".eslintignore": "/top.js\n" }, ["$/top.js", z], [z, top]],
      [{ ".mine": "rest/*\n" }, ["--ignore-path", ".mine", "$/rest/z.js", top], [z, top]],
      [{ "packages/a/.mine": "top.js\nrest/z.js\n" }, ["--ignore-path", "packages/a/.mine", top, z, x], [x]],
      [{ "packages/a/.mine": "/generated/x.js\n" }, ["--ignore-path", "$/packages/a/.mine", x, top], [x, top]],
    ])("the lines are compared with a file that is named as it is spelled: %j %j", async (files, args, expected) => {
      expect(await linted(files, args)).toEqual(expected);
    });
  });

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
    expect(stderr).toContain("2 rules in your .eslintrc config are not supported: require-jsdoc, valid-jsdoc");
    expect(stderr).not.toContain("no-rule-that-is-off");
    expect(stderr).toContain("\n  Everything else was linted. Use --allow-unsupported to make this a warning.");
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
    expect(stderr).toContain("warn: 2 rules in your .eslintrc config are not supported: require-jsdoc, valid-jsdoc");
    expect(exitCode).toBe(1);
    expect((await lint({ ...files, "a.js": "let x = 1;\nx;\n" }, ["--allow-unsupported", "."])).exitCode).toBe(0);
  });

  test("without a config file, a comment that turns on a rule that isn't built in is reported as a problem", async () => {
    const files = { "a.js": "/* eslint promise/not-there: error, jest/nope: error */\nexport {};\n" };
    const { problems, stderr, exitCode } = await lint(files);
    expect(problems).toEqual(["a.js:1:1 jest/nope", "a.js:1:1 promise/not-there"]);
    expect(stderr).not.toContain("did not run");
    expect(exitCode).toBe(1);
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
      "4 files were not linted because bun lint only supports JavaScript and TypeScript (3 *.one, 1 *.two): b.one, c.one, d.one, ..",
    );
    expect(exitCode).toBe(2);
    expect((await lint(files, ["--allow-unsupported", "."])).exitCode).toBe(1);
  });
});

// ESLint has deprecated its rules about layout, and eslint-plugin-react its `jsx-space-before-closing`. They are not built in: `bun fmt`
// does their work. The configurations that people share still turn them on.
describe.concurrent("the deprecated rules about layout", () => {
  const rules = {
    semi: "error",
    // Nothing looks at the options.
    quotes: ["error", "sideways", 3],
    indent: "warn",
    "max-len": "off",
    "no-debugger": "error",
  };
  const untidy = "debugger\n   x = 'y'\n";
  const flavors: [name: string, config: (rules: object) => string][] = [
    ["eslint.config.mjs", rules => `export default [{ rules: ${JSON.stringify(rules)} }];\n`],
    [".eslintrc.json", rules => rc({ rules })],
  ];
  const forPeople = ["-f", "stylish", "."];
  const notes = (stderr: string) => stderr.split("\n").filter(it => it.startsWith("note: "));
  const note = (count: number, names: string) => `note: ${count} deprecated formatting rules did not run: ${names}`;

  test.each(flavors)("%s: they do not run, which is a note and no error", async (name, config) => {
    const files = { [name]: config(rules), "a.js": untidy };
    const [found, shown, clean] = await Promise.all([
      lint(files),
      lint(files, forPeople),
      lint({ ...files, "a.js": "   x = 'y'\n" }, forPeople),
    ]);
    expect(found.problems).toEqual(["a.js:1:1 no-debugger"]);
    expect(found.exitCode).toBe(1);
    expect(notes(shown.stderr)).toEqual([note(3, "indent, quotes, semi")]);
    expect(notes(clean.stderr)).toEqual([note(3, "indent, quotes, semi")]);
    expect(clean.exitCode).toBe(0);
  });

  test("one note for all files and configuration files, with the first three names", async () => {
    const on = (...names: string[]) => flavors[0][1](Object.fromEntries(names.map(it => [it, "error"])));
    const { stderr, exitCode } = await lint(
      {
        "a/eslint.config.mjs": on("semi", "eol-last"),
        "a/a.js": "a",
        "a/b.js": "b",
        "b/eslint.config.mjs": on("semi", "comma-dangle", "arrow-parens"),
        "b/c.js": "/* eslint yield-star-spacing: 2 */ c",
      },
      ["-f", "stylish", "a", "b"],
    );
    expect(notes(stderr)).toEqual([note(5, "arrow-parens, comma-dangle, eol-last, ..")]);
    expect(exitCode).toBe(0);
  });

  test("one alone", async () => {
    const { stderr } = await lint({ "eslint.config.mjs": flavors[0][1]({ semi: 2 }), "a.js": "a" }, forPeople);
    expect(notes(stderr)).toEqual(["note: 1 deprecated formatting rule did not run: semi"]);
  });

  // As after eslint-config-prettier.
  test.each([
    [
      "eslint.config.mjs",
      { "eslint.config.mjs": `export default [{ rules: { semi: 2 } }, { rules: { semi: 0, indent: "off" } }];` },
    ],
    [
      ".eslintrc.json",
      {
        ".eslintrc.json": rc({ extends: "./base.json", rules: { semi: 0, indent: "off" } }),
        "base.json": `{ "rules": { "semi": 2 } }`,
      },
    ],
  ])("%s: nothing is said about one that is off in the end", async (_, config) => {
    const { stderr, exitCode } = await lint({ ...config, "a.js": `/* eslint quotes: "off" */ a` }, forPeople);
    expect(notes(stderr)).toEqual([]);
    expect(exitCode).toBe(0);
  });

  test("--rule, and a comment that configures", async () => {
    const files = { "a.js": `/* eslint quotes: ["error", "sideways"], no-debugger: "error" */ ${untidy}` };
    const flags = ["--no-config-lookup", "--rule", "semi: error", "--rule", "indent: [warn, sideways]"];
    const [found, shown] = await Promise.all([lint(files, [...flags, "."]), lint(files, [...flags, ...forPeople])]);
    expect(found.problems).toEqual(["a.js:1:66 no-debugger"]);
    expect(found.exitCode).toBe(1);
    expect(notes(shown.stderr)).toEqual([note(3, "indent, quotes, semi")]);
  });

  // It is on stderr, so what reads a report does not see it.
  test.each(["--quiet", "--format=json", "--format=unix", "--format=github", "--format=agent"])(
    "the note is there with %s",
    async flag => {
      const files = { "a.js": untidy };
      const without = { "eslint.config.mjs": flavors[0][1]({ "no-debugger": "error" }) };
      const [noted, plain] = await Promise.all([
        lint({ ...files, "eslint.config.mjs": flavors[0][1](rules) }, [...forPeople, flag]),
        lint({ ...files, ...without }, [...forPeople, flag]),
      ]);
      expect(notes(noted.stderr)).toEqual([note(3, "indent, quotes, semi")]);
      // But for `usedDeprecatedRules`.
      // But for the two temporary directories too: in JSON a path of Windows is escaped, so it is not replaced.
      const report = (stdout: string) =>
        stdout.replace(/"usedDeprecatedRules":\[.*?\]\}\]/g, "").replace(/bun-lint-config-files_\w+/g, "");
      expect(report(noted.stdout)).toBe(report(plain.stdout));
    },
  );

  test("only --silent hides it", async () => {
    const files = { "eslint.config.mjs": flavors[0][1](rules), "a.js": untidy };
    expect((await lint(files, [...forPeople, "--silent"])).stderr).toBe("");
  });

  test.each(flavors)("%s: a comment that disables one is neither wrong nor unused, and stays", async (name, config) => {
    const text = [
      "debugger // eslint-disable-line semi, no-debugger",
      "// eslint-disable-next-line indent, no-debugger",
      "x",
      "/* eslint-disable quotes */",
      "/* eslint-enable quotes */",
      "",
    ];
    const files = { [name]: config({ "no-debugger": "error" }), "a.js": text.join("\n") };
    const unused = ["--report-unused-disable-directives", "a.js"];
    const [found, fixed] = await Promise.all([lint(files, unused), lint(files, ["--fix-dry-run", ...unused])]);
    expect(JSON.parse(found.raw).results[0].messages.map((it: any) => `${it.line}:${it.column} ${it.message}`)).toEqual(
      ["2:1 Unused eslint-disable directive (no problems were reported from 'no-debugger')."],
    );
    text[1] = "// eslint-disable-next-line indent";
    expect(JSON.parse(fixed.raw).results[0]).toMatchObject({ messages: [], output: text.join("\n") });
  });

  // One of them may be what it is there for.
  test("a comment that disables all rules is not called unused where one is on", async () => {
    const run = (rules: object) =>
      lint({ "eslint.config.mjs": flavors[0][1](rules), "a.js": "a // eslint-disable-line\n" }, [
        "--report-unused-disable-directives",
        "a.js",
      ]);
    const [off, on] = await Promise.all([run({ semi: "off" }), run({ semi: "error" })]);
    expect([off.problems, on.problems]).toEqual([["a.js:1:3 -"], []]);
  });

  // What ESLint 10.12 prints.
  test("usedDeprecatedRules has them, in the order of the configuration", async () => {
    const old = (replacedBy: string) =>
      `{ meta: { deprecated: true, replacedBy: ["${replacedBy}"] }, create: () => ({}) }`;
    const { raw } = await lint(
      {
        "eslint.config.mjs": `export default [{
          plugins: { p: { rules: { one: ${old("1")}, two: ${old("2")} } } },
          rules: { "p/one": 2, semi: 2, "p/two": 2, "no-new-object": 2, indent: 0, quotes: 1, eqeqeq: 2 },
        }];`,
        "a.js": "a;\n",
      },
      ["a.js"],
    );
    const used: { ruleId: string; replacedBy: string[]; info?: { deprecatedSince: string } }[] =
      JSON.parse(raw).results[0].usedDeprecatedRules;
    expect(used.map(it => [it.ruleId, it.replacedBy, it.info?.deprecatedSince])).toEqual([
      ["p/one", ["1"], undefined],
      ["semi", ["@stylistic/semi"], "8.53.0"],
      ["p/two", ["2"], undefined],
      ["no-new-object", ["no-object-constructor"], "8.50.0"],
      ["quotes", ["@stylistic/quotes"], "8.53.0"],
    ]);
  });

  // What ESLint 10.12 prints with eslint-plugin-react 7.37.5, eslint-plugin-import 2.32.0 and eslint-plugin-react-hooks 7.1.1.
  test("usedDeprecatedRules has the built-in rules of plugins too", async () => {
    const plugin = (name: string) => `{ meta: { name: "eslint-plugin-${name}" }, rules: {} }`;
    const { raw } = await lint(
      {
        "eslint.config.mjs": `export default [{
          plugins: { react: ${plugin("react")}, "react-hooks": ${plugin("react-hooks")}, import: ${plugin("import")} },
          rules: {
            "react/jsx-sort-default-props": 2, "import/imports-first": 1, "import/first": 2,
            "react-hooks/component-hook-factories": 2, "react/jsx-space-before-closing": 2,
          },
        }];`,
        "a.js": "a;\n",
      },
      ["a.js"],
    );
    expect(JSON.parse(raw).results[0].usedDeprecatedRules).toEqual([
      { ruleId: "react/jsx-sort-default-props", replacedBy: ["sort-default-props"] },
      { ruleId: "import/imports-first", replacedBy: [] },
      { ruleId: "react-hooks/component-hook-factories", replacedBy: [] },
      { ruleId: "react/jsx-space-before-closing", replacedBy: ["jsx-tag-spacing"] },
    ]);
  });

  // What ESLint 10.12 and 8.57.1 print, the latter with the severities as they are written.
  test.each([
    [
      {
        "eslint.config.mjs": `export default [
          {
            plugins: { p: { rules: { one: { create: () => ({}) } } } },
            rules: {
              "no-var": "error", semi: "error", "p/one": "warn", quotes: ["warn", "double", { avoidEscape: true }],
              eqeqeq: ["error", "smart"], indent: "off", "max-len": [0, 100], "no-debugger": 1,
            },
          },
          { rules: { semi: ["warn", "never"], indent: 0 } },
        ];`,
      },
      `{"no-var":[2],"semi":[1,"never"],"p/one":[1],"quotes":[1,"double",{"avoidEscape":true}],"eqeqeq":[2,"smart"],"indent":[0],"max-len":[0,100],"no-debugger":[1]}`,
    ],
    [
      {
        ".eslintrc.json": rc({
          extends: "./base.json",
          rules: { "no-var": "error", semi: ["warn", "never"], quotes: 1, indent: "off", eqeqeq: [2, "smart"] },
        }),
        "base.json": `{ "rules": { "quotes": ["error", "single"], "max-len": [0, 100] } }`,
      },
      `{"no-var":[2],"semi":[1,"never"],"quotes":[1,"single"],"indent":[0],"eqeqeq":[2,"smart"],"max-len":[0,100]}`,
    ],
    // ESLint refuses these options.
    [{ "eslint.config.mjs": flavors[0][1]({ quotes: ["error", "sideways", 3] }) }, `{"quotes":[2,"sideways",3]}`],
  ])("--print-config has them, on or off, where the configuration has them: %#", async (config, rules) => {
    const { raw, exitCode } = await lint({ ...config, "a.js": "" }, ["--print-config", "a.js"]);
    expect(JSON.stringify(JSON.parse(raw).rules)).toBe(rules);
    expect(exitCode).toBe(0);
  });

  const reports = `{ create: context => ({ Program: node => context.report({ node, message: "It ran." }) }) }`;

  test("a rule of a plugin that is called the same runs", async () => {
    const files = {
      "eslint.config.mjs": `export default [{
        plugins: { "@stylistic": { rules: { semi: ${reports} } }, mine: { rules: { indent: ${reports} } } },
        rules: { "@stylistic/semi": "error", "mine/indent": "error" },
      }];`,
      "a.js": "a\n",
    };
    const [found, shown] = await Promise.all([lint(files, ["a.js"]), lint(files, ["-f", "stylish", "a.js"])]);
    expect(found.problems).toEqual(["a.js:1:1 @stylistic/semi", "a.js:1:1 mine/indent"]);
    expect(notes(shown.stderr).filter(it => it.includes("formatting"))).toEqual([]);
  });

  test("so does one of --rulesdir", async () => {
    const files = {
      ".eslintrc.json": rc({ rules: { semi: "error" } }),
      "rules/semi.js": `module.exports = ${reports};`,
      "a.js": "a\n",
    };
    expect((await lint(files, ["--rulesdir", "rules", "a.js"])).problems).toEqual(["a.js:1:1 semi"]);
  });

  test("react/jsx-space-before-closing is one of them, unless the rules of the package run", async () => {
    const files = {
      "eslint.config.mjs": `export default [{
        plugins: { react: { meta: { name: "eslint-plugin-react" }, rules: { "jsx-space-before-closing": ${reports} } } },
        rules: { "react/jsx-space-before-closing": "error" },
      }];`,
      "a.js": "a\n",
    };
    const [builtIn, shown, ofThePackage] = await Promise.all([
      lint(files, ["a.js"]),
      lint(files, ["-f", "stylish", "a.js"]),
      lint(files, ["--no-native-plugin-rules", "a.js"]),
    ]);
    expect(builtIn.problems).toEqual([]);
    expect(builtIn.exitCode).toBe(0);
    expect(notes(shown.stderr)).toEqual([
      "note: 1 deprecated formatting rule did not run: react/jsx-space-before-closing",
    ]);
    expect(ofThePackage.problems).toEqual(["a.js:1:1 react/jsx-space-before-closing"]);
  });

  // oxlint has never had them, and refuses the file.
  test("beside an .oxlintrc.json they are rules like any other that is not built in", async () => {
    const files = {
      ".oxlintrc.json": JSON.stringify({
        rules: { semi: "error", "eslint/quotes": "warn", indent: "off", "no-debugger": "error" },
      }),
      "a.js": untidy,
    };
    const { problems, stderr, exitCode } = await lint(files, ["a.js"]);
    expect(problems).toEqual(["a.js:1:1 no-debugger"]);
    expect(stderr).toContain("2 rules in .oxlintrc.json are not supported: semi, quotes");
    expect(stderr).not.toContain("formatting");
    expect(exitCode).toBe(2);
  });
});

// oxlint has them built in. A configuration that is written for it can name them. It fails like any other that asks for a rule which is
// not built in if it turns on one of their rules by name. Many only list the plugin, which is a note.
describe.concurrent("the plugins jsdoc and vue of oxlint, of which no rule is built in", () => {
  const files = {
    "a.js": "/** @param {string} b */\nfunction f(a) { debugger }\nf();\n",
    "b.vue": '<script>\ndebugger\nexport default { data() { return { a: 1 } }, props: ["a"] };\n</script>\n',
  };
  const found = ["a.js:2:17 no-debugger", "b.vue:2:1 no-debugger"];
  const clean = { "a.js": "export {};\n", "b.vue": "<script>\nexport {};\n</script>\n" };
  const quiet = { categories: { correctness: "off" }, rules: { "no-debugger": "warn" } };
  const named = (plugin: string, ...rules: string[]) =>
    `${rules.length} ${rules.length > 1 ? "rules" : "rule"} in .oxlintrc.json ${rules.length > 1 ? "are" : "is"} not supported: ${rules.join(", ")}`;
  const ofCategories = (...plugins: string[]) =>
    `note: bun lint has no "${plugins.join('" or "')}" rules, so none of them ran`;
  const silent = { problems: found, exitCode: 0, said: [], notes: [] };
  /** What is reported, the exit code, what is said about what cannot be done, and the notes. */
  async function run(config: object, flags: string[] = [], more: Record<string, string> = {}) {
    const all = { ...files, ...more, ".oxlintrc.json": JSON.stringify(config) };
    const { problems, stderr, exitCode } = await lint(all, [...flags, "."]);
    const lines = stderr.split("\n");
    const said = lines.filter(it => it.startsWith("error: ")).map(it => it.slice("error: ".length));
    const notes = lines.filter(it => it.startsWith("note: "));
    return { problems, exitCode, said: said.map(it => it.trim()), notes };
  }

  test("a rule of theirs that is on: the rest is linted, and the run fails", async () => {
    const rules = {
      ...quiet.rules,
      "jsdoc/require-param": "error",
      "vue/no-dupe-keys": ["warn", { groups: ["a"] }],
      "vue/max-props": "deny",
    };
    expect(await run({ ...quiet, plugins: ["jsdoc", "vue"], rules })).toEqual({
      problems: found,
      exitCode: 2,
      said: [named("jsdoc", "jsdoc/require-param"), named("vue", "vue/no-dupe-keys", "vue/max-props")],
      notes: [],
    });
    const allowed = await lint(
      { ...files, ".oxlintrc.json": JSON.stringify({ ...quiet, plugins: ["jsdoc", "vue"], rules }) },
      ["--allow-unsupported", "."],
    );
    expect(allowed.stderr).toContain(
      `warn: ${named("jsdoc", "jsdoc/require-param")}\n  bun lint has no "jsdoc" rules. Turn it off or remove it.\n`,
    );
    expect(allowed.exitCode).toBe(0);
  });

  test("a rule that is off, or of a plugin that is not on, says nothing", async () => {
    const on = { ...quiet.rules, "jsdoc/require-param": "error", "vue/no-dupe-keys": "error" };
    const off = { ...quiet.rules, "jsdoc/require-param": "off", "vue/no-dupe-keys": "allow" };
    expect(await run({ ...quiet, plugins: ["jsdoc", "vue"], rules: off })).toEqual(silent);
    // As in oxlint, where it does not run either.
    expect(await run({ ...quiet, rules: on })).toEqual(silent);
    const base = { "base.json": JSON.stringify({ plugins: ["jsdoc", "vue"], rules: on }) };
    expect(await run({ ...quiet, extends: ["./base.json"], plugins: ["jsdoc", "vue"], rules: off }, [], base)).toEqual(
      silent,
    );
  });

  test("the plugins alone say nothing", async () => {
    expect(await run({ ...quiet, plugins: ["jsdoc", "vue"] })).toEqual(silent);
  });

  test("in overrides", async () => {
    const overrides = [{ files: ["*.vue"], plugins: ["vue"], rules: { "vue/no-dupe-keys": "error" } }];
    expect(await run({ ...quiet, overrides })).toEqual({
      problems: found,
      exitCode: 2,
      said: [named("vue", "vue/no-dupe-keys")],
      notes: [],
    });
  });

  test.each([
    [["--vue-plugin", "-D", "vue/no-dupe-keys"], [named("vue", "vue/no-dupe-keys")], []],
    [["--vue-plugin", "-W", "vue/no-dupe-keys"], [named("vue", "vue/no-dupe-keys")], []],
    [["--vue-plugin", "-D", "vue/no-dupe-keys", "-A", "vue/no-dupe-keys"], [], []],
    [["--vue-plugin", "--jsdoc-plugin", "-D", "correctness"], [], [ofCategories("jsdoc", "vue")]],
    [["--vue-plugin"], [], []],
    [["-D", "vue/no-dupe-keys"], [], []],
  ])("%j", async (flags, said, notes) => {
    expect(await run({ ...quiet, rules: {} }, flags, clean)).toEqual({
      problems: [],
      exitCode: said.length > 0 ? 2 : 0,
      said,
      notes,
    });
  });

  // `correctness` is on unless a file says otherwise, and oxlint has rules of both in it.
  test("a plugin that is only listed, and a category that oxlint has rules of it in: a note", async () => {
    const config = (categories: object) => ({ categories: { correctness: "off", ...categories }, plugins: ["vue"] });
    const noted = { problems: [], exitCode: 0, said: [], notes: [ofCategories("vue")] };
    const passes = { problems: [], exitCode: 0, said: [], notes: [] };
    expect(await run(config({ correctness: "error" }), [], clean)).toEqual(noted);
    expect(await run({ plugins: ["vue"] }, [], clean)).toEqual(noted);
    expect(await run(config({ restriction: "warn" }), [], clean)).toEqual(noted);
    // The exit code is that of the other rules.
    expect(await run(config({ correctness: "error" }), [], { ...clean, "c.js": "debugger;\nexport {};\n" })).toEqual({
      ...noted,
      problems: ["c.js:1:1 no-debugger"],
      exitCode: 1,
    });
    // It has none that are about speed.
    expect(await run(config({ perf: "error" }), [], clean)).toEqual(passes);
    expect(await run(config({}), [], clean)).toEqual(passes);
    // For the files of an override that are linted.
    const override = (pattern: string) => ({ overrides: [{ files: [pattern], plugins: ["vue"] }] });
    expect(await run({ plugins: ["unicorn"], ...override("*.vue") }, [], clean)).toEqual(noted);
    expect(await run({ plugins: ["unicorn"], ...override("*.svelte") }, [], clean)).toEqual(passes);
    // oxlint 1.87 runs none of them there: the override names all the plugins of the file.
    expect(await run({ plugins: [], ...override("*.vue") }, [], clean)).toEqual(passes);
  });

  test("a rule that is named and a plugin that is only listed: the run fails, and the note is there", async () => {
    const config = { plugins: ["jsdoc", "vue"], rules: { "vue/no-dupe-keys": "error" } };
    expect(await run(config, [], clean)).toEqual({
      problems: [],
      exitCode: 2,
      said: [named("vue", "vue/no-dupe-keys")],
      notes: [ofCategories("jsdoc", "vue")],
    });
  });

  // It is on stderr, so what reads a report does not see it.
  test.each(["--format=json", "--format=github", "--format=unix", "--format=pretty", "--quiet"])(
    "the note is there with %s",
    async flag => {
      const config = (plugins: string[]) => ({
        ".oxlintrc.json": JSON.stringify({ plugins, rules: { "no-debugger": "error" } }),
      });
      const [noted, plain] = await Promise.all([
        lint({ ...files, ...config(["vue"]) }, [flag, "."]),
        lint({ ...files, ...config([]) }, [flag, "."]),
      ]);
      expect(noted.stderr.split("\n").filter(it => it.startsWith("note: "))).toEqual([ofCategories("vue")]);
      const timeless = (stdout: string) =>
        stdout.replace(/"start_time": [\d.e-]+|\d+(\.\d+)?m?s\b|bun-lint-config-files_\w+/g, "");
      expect(timeless(noted.stdout)).toBe(timeless(plain.stdout));
      expect([noted.exitCode, plain.exitCode]).toEqual([1, 1]);
    },
  );

  test("only --silent hides it", async () => {
    const all = { ...clean, ".oxlintrc.json": JSON.stringify({ plugins: ["vue"] }) };
    const { stderr, exitCode } = await lint(all, ["--silent", "."]);
    expect(stderr).not.toContain("note: ");
    expect(exitCode).toBe(0);
  });

  test("settings for them are taken", async () => {
    const settings = { jsdoc: { ignorePrivate: true, nothing: 1 }, vue: { nothing: 1 } };
    expect(await run({ ...quiet, settings })).toEqual(silent);
  });

  test("any other plugin that oxlint does not know is still refused", async () => {
    const { stdout, exitCode } = await lint({ ...files, ".oxlintrc.json": JSON.stringify({ plugins: ["jsdocs"] }) });
    expect(stdout).toContain(`Unknown plugin: 'jsdocs'.`);
    expect(exitCode).toBe(1);
  });

  test("a comment that disables one of their rules is neither wrong nor unused, and stays, if such a rule is on", async () => {
    const text = [
      // oxlint's jsdoc rules look at comments like this one. Without any, none of them could have reported anything.
      "/** A function. */",
      "// oxlint-disable-next-line jsdoc/require-param",
      "a;",
      "// eslint-disable-next-line vue/no-dupe-keys, no-debugger",
      "a;",
      "/* oxlint-disable vue/max-props */",
      "",
    ].join("\n");
    const on = { ...quiet, plugins: ["jsdoc", "vue"], rules: { ...quiet.rules, "jsdoc/require-param": "warn" } };
    const all = { "a.js": text, "b.vue": `<script>\n${text}</script>\n`, ".oxlintrc.json": JSON.stringify(on) };
    const { problems, raw } = await lint(all, ["--report-unused-disable-directives", "."]);
    expect(problems).toEqual(["a.js:4:47 -", "b.vue:5:47 -"]);
    expect(JSON.parse(raw).results[0].messages[0].message).toBe(
      "Unused eslint-disable directive (no problems were reported from no-debugger).",
    );
    // From a script in such a file oxlint removes what is unused.
    const fixed = await lint(all, ["--report-unused-disable-directives", "--fix-dry-run", "b.vue"]);
    expect(JSON.parse(fixed.raw).results[0].output).toBe(`<script>\n${text.replace(", no-debugger", "")}</script>\n`);
  });

  // What oxlint 1.87 reports: each of these comments, whole. Its jsdoc rules only look at `/**` comments, so in a file without one
  // none of them was skipped, and a comment that silences nothing here silences nothing there.
  test("without a /** comment, comments are unused as for oxlint although rules of jsdoc are on", async () => {
    const text = [
      "// oxlint-disable-next-line jsdoc/require-param",
      "a;",
      "// eslint-disable-next-line vue/no-dupe-keys, no-debugger",
      "a;",
      "// oxlint-disable-next-line",
      "a;",
      "// oxlint-disable-next-line foo/no-debugger, no-dupe-keys",
      "a;",
      "/* oxlint-disable vue/max-props */",
      "",
    ].join("\n");
    const on = { ...quiet, plugins: ["jsdoc", "vue"], rules: { ...quiet.rules, "jsdoc/require-param": "warn" } };
    const all = { "a.js": text, "b.vue": `<script>\n${text}</script>\n`, ".oxlintrc.json": JSON.stringify(on) };
    const { problems } = await lint(all, ["--report-unused-disable-directives", "."]);
    expect(problems).toEqual([1, 3, 5, 7, 9].flatMap(line => [`a.js:${line}:1 -`, `b.vue:${line + 1}:1 -`]).sort());
    // oxlint reports the same with these. Here nobody knows what their rules would have reported, and a comment that is called
    // unused is one that --fix-suggestions removes. So only a name that none of their rules has is reported.
    const withBlock = { ...all, "a.js": `/** A function. */\n${text}`, "b.vue": "" };
    const withVue = {
      ...all,
      "b.vue": "",
      ".oxlintrc.json": JSON.stringify({ ...on, rules: { "vue/max-props": "warn" } }),
    };
    const [block, vue] = await Promise.all(
      [withBlock, withVue].map(files => lint(files, ["--report-unused-disable-directives", "a.js"])),
    );
    expect(block.problems).toEqual(["a.js:4:47 -", "a.js:8:29 -"]);
    expect(vue.problems).toEqual(["a.js:3:47 -", "a.js:7:29 -"]);
  });

  test("--rules does not list them", async () => {
    const { raw } = await lint({ ".oxlintrc.json": "{}" }, ["--rules", "-f", "json"]);
    const scopes = new Set(JSON.parse(raw).map((it: { scope: string }) => it.scope));
    expect([scopes.has("unicorn"), scopes.has("jsdoc"), scopes.has("vue")]).toEqual([true, false, false]);
  });

  // No rule here has ever answered for them.
  test("beside a configuration of ESLint they are the packages of the project", async () => {
    const plugin = (name: string) =>
      `module.exports = { meta: { name: "eslint-plugin-${name}" }, rules: { "no-dupe-keys": { create: context => ({ Program: node => context.report({ node, message: "of the package" }) }) } } };`;
    const { problems, exitCode } = await lint({
      "node_modules/eslint-plugin-vue/package.json": `{ "name": "eslint-plugin-vue", "version": "10.0.0", "main": "index.js" }`,
      "node_modules/eslint-plugin-vue/index.js": plugin("vue"),
      "node_modules/eslint-plugin-jsdoc/package.json": `{ "name": "eslint-plugin-jsdoc", "version": "60.0.0", "main": "index.js" }`,
      "node_modules/eslint-plugin-jsdoc/index.js": plugin("jsdoc"),
      "eslint.config.mjs": `
        import jsdoc from "eslint-plugin-jsdoc";
        import vue from "eslint-plugin-vue";
        export default [{ files: ["a.js"], plugins: { jsdoc, vue }, rules: { "vue/no-dupe-keys": "error", "jsdoc/no-dupe-keys": "warn" } }];`,
      "a.js": "a;\n",
    });
    expect(problems).toEqual(["a.js:1:1 jsdoc/no-dupe-keys", "a.js:1:1 vue/no-dupe-keys"]);
    expect(exitCode).toBe(1);
  });
});

// As ESLint 10.12 with eslint-plugin-import 2.32.0 and eslint-plugin-react 7.37.5: `" ".repeat(n)` throws beyond the longest string that
// JavaScript has, 2 ** 29 - 24, and for a negative n: the rule throws, which ends the run. Below that ESLint reports as ever, in a format
// that does not print the fixes: its `json` throws over them.
describe.concurrent("a number in the options of a rule that is the length of a text", () => {
  const element = 'const a = (\n  <b\n    c="d"\n  >\n    <e />\n  </b>\n);\n';
  const tooLong = "RangeError: Invalid string length";
  test.each<
    [rule: string, option: unknown, file: string, text: string, thrown: [error: string, line: number] | string[]]
  >([
    ["import/newline-after-import", { count: 2 ** 53 }, "a.js", '\nimport "a";\nb();\n', [tooLong, 2]],
    ["import/newline-after-import", { count: 2 ** 29 }, "a.js", '\nimport "a";\nb();\n', [tooLong, 2]],
    // The calls are looked at when the program ends.
    ["import/newline-after-import", { count: 2 ** 31 }, "a.js", '\n\nconst a = require("a");\nb();\n', [tooLong, 1]],
    ["react/jsx-indent", 2 ** 31, "a.jsx", element, [tooLong, 2]],
    // Nothing is repeated.
    ["react/jsx-indent", 2 ** 31, "a.jsx", "a();\n", []],
    // Only twice as much is too long.
    ["react/jsx-indent", 2 ** 29 - 24, "a.jsx", element, [tooLong, 5]],
    ["react/jsx-indent", -1, "a.jsx", element, ["RangeError: Invalid count value: -1", 2]],
    ["react/jsx-indent-props", 2 ** 31, "a.jsx", element, [tooLong, 2]],
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
});

// As ESLint 9.39.5, but for the kind of the error before the message.
test.concurrent.each([
  ["[", 'Syntax error in selector "[" at position 1: Expected " " or [^ [\\],():#!=><~+.] but end of input found.'],
  [
    { selector: "a >", message: "no" },
    'Syntax error in selector "a >" at position 3: Expected " ", "!", "#", "*", ".", ":", ":first-child", ":has(", ":is(", ":last-child", ":matches(", ":not(", ":nth-child(", ":nth-last-child(", "[", or [^ [\\],():#!=><~+.] but end of input found.',
  ],
  [":foo", "Unknown class name: foo"],
  [`${":not(".repeat(100_000)}a${")".repeat(100_000)}`, "Maximum call stack size exceeded"],
])("no-restricted-syntax with a selector that cannot be read: %#", async (option, message) => {
  const files = { ".eslintrc.json": rc({ rules: { "no-restricted-syntax": ["error", "Foo", option] } }), "a.js": code };
  const { problems, stderr, exitCode } = await lint(files, ["a.js"]);
  // `lint` has a `/` for each backslash.
  expect(stderr).toContain(`${message.replaceAll("\\", "/")}\nOccurred while linting <dir>/a.js`);
  expect({ problems, exitCode }).toEqual({ problems: [], exitCode: 2 });
});

// What reads a selector holds more levels than what matches it: how many depends on the build and on the system. Between
// the two, each `:has()` took the end of the stack for a node that does not match, and went on to the next one.
// ESLint 9.39.5 reports the ten nodes up to 999 levels.
test.concurrent.each(Array.from({ length: 24 }, (_, i) => Math.ceil(300 * 1.2 ** i)))(
  "no-restricted-syntax with `:has()` nested about as deep as the stack holds: %d",
  async depth => {
    const selector = `${":has(".repeat(depth)}*${")".repeat(depth)}`;
    const files = { ".eslintrc.json": rc({ rules: { "no-restricted-syntax": ["error", selector] } }), "a.js": code };
    const { problems, stderr, exitCode } = await lint(files, ["a.js"]);
    if (exitCode === 2) expect(stderr).toEndWith("Maximum call stack size exceeded\nOccurred while linting <dir>/a.js");
    expect({ problems: problems.length, exitCode }).toEqual(
      exitCode === 2 ? { problems: 0, exitCode } : { problems: 10, exitCode: 1 },
    );
  },
);

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

// What ESLint 10.12.0, ESLint 8.57.1 and oxlint 1.87.0 do with the same files. Without a configuration file as oxlint.
describe.skipIf(isWindows).concurrent("a symbolic link that leads nowhere, to itself, or back up", () => {
  const flavors: Record<string, Record<string, string>> = {
    "eslint.config.js": { "eslint.config.js": `export default [${JSON.stringify(noVar)}];` },
    ".eslintrc.json": { ".eslintrc.json": rc(noVar) },
    ".oxlintrc.json": { ".oxlintrc.json": JSON.stringify({ ...noVar, categories: { correctness: "off" } }) },
    "bunfig.toml": { "bunfig.toml": `[lint.rules]\n"no-var" = "error"\n` },
    "no file": {},
  };
  const others = { "a.js": code, "sub/b.js": code };
  /** The files with problems, what is printed, and the exit code. `links`: where each is, and what it has. */
  const linted = async (flavor: string, links: Record<string, string>, args = ["."], files = others) => {
    const inProject = Object.entries({ ...flavors[flavor], ...files }).map(([name, text]) => [`project/${name}`, text]);
    const before = (dir: string) =>
      Object.entries(links).forEach(([path, to]) => symlinkSync(to, join(dir, "project", path)));
    const all = { ...Object.fromEntries(inProject), "project/.keep": "", "outside/c.js": code };
    const { problems, stdout, stderr, exitCode } = await lint(all, args, { before, cwd: "project" });
    const names = problems.map(it => it.split(":")[0].replace("project/", ""));
    return { files: [...new Set(names)], stdout, stderr: stderr.replaceAll("<dir>/project/", "<dir>/"), exitCode };
  };
  const passingOver = [".eslintrc.json", ".oxlintrc.json", "bunfig.toml", "no file"];
  const asOxlint = [".oxlintrc.json", "bunfig.toml", "no file"];

  test.each(passingOver)("one that leads nowhere is passed over by a search: %s", async flavor => {
    const links = {
      "gone.js": "nowhere.js",
      "sub/gone.js": "/nowhere/at/all.js",
      "gone": "nowhere",
      "in.js": "gone/a.js",
    };
    for (const args of [["."], ["sub", "a.js"]]) {
      expect(await linted(flavor, links, args)).toMatchObject({ files: ["a.js", "sub/b.js"], exitCode: 1 });
    }
  });

  // "Error: ENOENT: no such file or directory, open '<dir>/gone.js'", "Error: ELOOP: too many symbolic links encountered, open .."
  test.each([
    ["gone.js", "nowhere.js", "ENOENT"],
    ["self.js", "self.js", "ELOOP"],
  ])("ESLint reads %s, which leads to %s, and that is the end of the run", async (name, to, code) => {
    const { files, stderr, exitCode } = await linted("eslint.config.js", { [name]: to });
    expect(stderr).toContain(`Cannot read <dir>/${name}: ${code}: `);
    expect({ files, exitCode }).toEqual({ files: [], exitCode: 2 });
    // It does not ask what a link is that it does not lint.
    expect(
      await linted("eslint.config.js", { "gone": "nowhere", "self": "self", "sub/gone.md": "nowhere.md" }),
    ).toMatchObject({
      files: ["a.js", "sub/b.js"],
      exitCode: 1,
    });
  });

  test.each(asOxlint)(
    "one that leads to itself, and two that lead to each other, are passed over: %s",
    async flavor => {
      const links = { "self.js": "self.js", "self": "self", "sub/c.js": "d.js", "sub/d.js": "c.js" };
      expect(await linted(flavor, links)).toMatchObject({ files: ["a.js", "sub/b.js"], exitCode: 1 });
    },
  );

  test.each([
    [{ "self.js": "self.js" }, ["."], "self.js"],
    // Whatever it is called, and wherever it is.
    [{ "self": "self" }, ["."], "self"],
    [{ "node_modules/self": "self" }, ["."], "node_modules/self"],
    [{ "sub/self.md": "self.md" }, ["**/*.js"], "sub/self.md"],
    [{ "self.js": "self.js" }, ["a.js", "self.js"], "self.js"],
  ])("ESLint 8 asks where every link leads, and %j is the end of the run", async (links, args, name) => {
    const files = { ...others, "node_modules/.keep": "" };
    const { stderr, exitCode } = await linted(".eslintrc.json", links as Record<string, string>, args, files);
    expect(stderr).toContain(`ELOOP: too many symbolic links encountered, stat '<dir>/${name}'`);
    expect(exitCode).toBe(2);
  });

  test("nothing but a link that leads nowhere is nothing", async () => {
    const only = (flavor: string) => linted(flavor, { "gone.js": "nowhere.js" }, ["."], {});
    const [eslint8, oxlint] = await Promise.all([only(".eslintrc.json"), only(".oxlintrc.json")]);
    // 'No files matching the pattern "." were found.'
    expect(eslint8.stderr).toContain('pattern "."');
    expect(eslint8.exitCode).toBe(2);
    expect(oxlint.stdout).toContain("No files found to lint. Please check your paths and ignore patterns.");
    expect(oxlint.exitCode).toBe(1);
  });

  test("one that leads nowhere and is an argument is a file that is not there", async () => {
    const named = (flavor: string) => linted(flavor, { "gone.js": "nowhere.js" }, ["gone.js", "a.js"]);
    const [eslint, eslint8, oxlint] = await Promise.all(
      ["eslint.config.js", ".eslintrc.json", ".oxlintrc.json"].map(named),
    );
    for (const { stderr, exitCode } of [eslint, eslint8]) {
      expect(stderr).toContain('No files matching the pattern "gone.js" were found.');
      expect(exitCode).toBe(2);
    }
    expect(oxlint).toMatchObject({ files: ["a.js"], exitCode: 1 });
  });

  test.each(passingOver)("one that leads to a directory is followed: %s", async flavor => {
    expect(await linted(flavor, { "linked": "sub", "sub/out": "../../outside" })).toMatchObject({
      files: ["a.js", "linked/b.js", "linked/out/c.js", "sub/b.js", "sub/out/c.js"],
      exitCode: 1,
    });
  });

  test.each(asOxlint)(
    "an ignore file is asked about the path with the link in it, not where that leads: %s",
    async flavor => {
      const files = { ...others, "hid/h.js": code, ".gitignore": "hid/\nskipped\n" };
      expect(await linted(flavor, { "shown": "hid", "skipped": "sub" }, ["."], files)).toMatchObject({
        files: ["a.js", "shown/h.js", "sub/b.js"],
        exitCode: 1,
      });
    },
  );

  test.each(asOxlint)("one that leads above where the search starts is followed, once: %s", async flavor => {
    expect(await linted(flavor, { "up": ".." })).toMatchObject({
      files: ["a.js", "sub/b.js", "up/outside/c.js", "up/project/a.js", "up/project/sub/b.js"],
      exitCode: 1,
    });
  });

  test.each(asOxlint)("one that leads back up is passed over: %s", async flavor => {
    const links = { "here": ".", "sub/up": "..", "sub/too": "../sub" };
    expect(await linted(flavor, links)).toMatchObject({ files: ["a.js", "sub/b.js"], exitCode: 1 });
  });

  // It goes round until the system has had enough: "ELOOP: too many symbolic links encountered, stat '<dir>/here/here/here/.."
  test.each([
    [{ "here": "." }, "here"],
    [{ "sub/up": ".." }, "sub/up"],
  ])("ESLint 8 follows %j to the end of the run", async (links, name) => {
    const { stderr, exitCode } = await linted(".eslintrc.json", links as Record<string, string>);
    expect(stderr).toContain(`ELOOP: too many symbolic links encountered, stat '<dir>/${name}`);
    expect(exitCode).toBe(2);
    // Not where it does not go.
    const ignoring = { ".eslintrc.json": rc({ ...noVar, ignorePatterns: [name] }), ...others };
    expect(await linted("no file", links as Record<string, string>, ["."], ignoring)).toMatchObject({
      files: ["a.js", "sub/b.js"],
      exitCode: 1,
    });
  });
});

// What ESLint 10.12.0 lints, and which configuration files it runs. It judges a directory by the configuration of the directory
// that it is in. Where that has no file, the base path is the working directory, and what is outside of it is ignored.
describe.concurrent("a search that leaves the project of an eslint.config.js", () => {
  const scripts = ["mine", "mine/sub", "mine/nested", "theirs", "theirs/deep", "none", "none/in"];
  const inRepository = ["repo", "repo/packages/a", "repo/packages/b", "repo/packages/b/own", "repo/packages/c"];
  const files = Object.fromEntries([...scripts, ...inRepository].map(it => [`w/${it}/x.js`, "debugger;\n"]));
  const configured = ["mine", "mine/nested", "theirs", "theirs/deep", "repo", "repo/packages/b/own"];
  type More = { files?: Record<string, string>; links?: Record<string, string> };

  /** The configuration files that ran, but for that of the working directory, which always does, and the files with problems. */
  const run = async (cwd: string, args: string[], more: More = {}) => {
    using logs = tempDir("bun-lint-config-files-ran", {});
    const log = join(String(logs), "ran.log");
    const before = (dir: string) => {
      for (const it of configured) {
        const says = `fs.appendFileSync(${JSON.stringify(log)}, ${JSON.stringify(it + "\n")});`;
        const text = `import fs from "node:fs";\n${says}\nexport default [{ rules: { "no-debugger": "error" } }];\n`;
        writeFileSync(join(dir, "w", it, "eslint.config.js"), text);
      }
      for (const [path, to] of Object.entries(more.links ?? {})) {
        symlinkSync(join(dir, "w", path, "..", to), join(dir, "w", path), "junction");
      }
    };
    const given = args.map(it => it.replace("<w>", "<dir>/w"));
    const result = await lint({ ...files, ...more.files }, [], {
      cwd: `w/${cwd}`,
      before,
      args: dir => given.map(it => it.replace("<dir>", dir.replaceAll("\\", "/"))),
    });
    const ran = existsSync(log) ? [...new Set(readFileSync(log, "utf8").split("\n").filter(Boolean))].sort() : [];
    return {
      ran,
      files: [...new Set(result.problems.map(it => it.split(":")[0].replace("w/", "")))],
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  };
  const ofMine = ["mine/nested/x.js", "mine/sub/x.js", "mine/x.js"];

  test.each([[".."], ["<w>/**/x.js"], ["../**/x.js"], ["<w>"], [".", ".."]])(
    "only what is in the working directory is entered: %s",
    async (...args) => {
      expect(await run("mine", args)).toMatchObject({ ran: ["mine", "mine/nested"], files: ofMine, exitCode: 1 });
    },
  );

  test("not the directories beside it, not those above it", async () => {
    expect(await run("mine", ["../*/x.js"])).toMatchObject({ ran: ["mine"], files: ["mine/x.js"], exitCode: 1 });
    for (const [cwd, args] of [
      ["mine", ["../.."]],
      ["mine/sub", ["../.."]],
      ["mine/sub", ["<w>/**/x.js"]],
      ["repo/packages/a", ["../../.."]],
    ] as const) {
      const { ran, files, stderr, exitCode } = await run(cwd, [...args]);
      expect(stderr).toContain("are ignored.");
      // ESLint runs none at all.
      expect({ ran, files, exitCode }).toEqual({ ran: [cwd.split("/")[0]], files: [], exitCode: 2 });
    }
  });

  // "ESLint couldn't find an eslint.config.* file."
  test.each([
    ["../none", {}, "none/x.js"],
    ["../none/x.js", {}, "none/x.js"],
    ["../none/in", {}, "none/in/x.js"],
    // Whatever it is called.
    ["..", { files: { "w/readme.md": "" } }, "readme.md"],
    ["<w>/**/x.js", { files: { "w/x.js": "debugger;\n" } }, "x.js"],
    // A link to a directory is no directory to ESLint.
    ["..", { links: { "linked": "theirs" } }, "linked"],
  ])("a file without a configuration file ends the run: %s %j", async (argument, more, file) => {
    const { ran, files, stderr, exitCode } = await run("mine", [argument], more);
    expect(stderr).toContain(`Could not find config file.\n  No eslint.config.* was found next to <dir>/w/${file} or`);
    expect(ran.filter(it => !it.startsWith("mine"))).toEqual([]);
    expect({ files, exitCode }).toEqual({ files: [], exitCode: 2 });
  });

  test("what is named and has a configuration file of its own is linted with that", async () => {
    const theirs = { ran: ["mine", "theirs", "theirs/deep"], files: ["theirs/deep/x.js", "theirs/x.js"], exitCode: 1 };
    expect(await run("mine", ["../theirs"])).toMatchObject(theirs);
    expect(await run("mine", ["<w>/theirs"])).toMatchObject(theirs);
    expect(await run("mine", ["../theirs/x.js"])).toMatchObject({ ran: ["mine", "theirs"], files: ["theirs/x.js"] });
    expect(await run("mine", ["../theirs/deep"])).toMatchObject({ ran: ["mine", "theirs/deep"] });
  });

  test("a configuration file above the working directory is for what is beside that", async () => {
    const own = ["repo", "repo/packages/b/own"];
    const [a, b, c] = ["a", "b", "c"].map(it => `repo/packages/${it}/x.js`);
    expect(await run("repo/packages/a", ["../b"])).toMatchObject({ ran: own, files: ["repo/packages/b/own/x.js", b] });
    expect(await run("repo/packages/a", ["../*/x.js"])).toMatchObject({ ran: ["repo"], files: [a, b, c] });
    expect(await run("repo/packages/a", ["../.."])).toMatchObject({
      ran: own,
      files: [a, "repo/packages/b/own/x.js", b, c, "repo/x.js"],
    });
    expect(await run("repo", [".."])).toMatchObject({
      ran: own,
      files: [a, "repo/packages/b/own/x.js", b, c, "repo/x.js"],
    });
  });

  test("a link in the working directory that leads out of it is not followed, and is a path like any other if it is named", async () => {
    const links = { "mine/link": "../theirs", "mine/bare": "../none" };
    for (const args of [["."], ["**/x.js"], [".."]]) {
      expect(await run("mine", args, { links })).toMatchObject({ ran: ["mine", "mine/nested"], files: ofMine });
    }
    expect(await run("mine", ["link/x.js"], { links })).toMatchObject({
      ran: ["mine", "theirs"],
      files: ["mine/link/x.js"],
    });
    expect(await run("mine", ["link"], { links })).toMatchObject({
      ran: ["mine", "theirs", "theirs/deep"],
      files: ["mine/link/deep/x.js", "mine/link/x.js"],
    });
    // The nearest file on the way up from the path with the link in it.
    expect(await run("mine", ["bare"], { links })).toMatchObject({
      ran: ["mine"],
      files: ["mine/bare/in/x.js", "mine/bare/x.js"],
    });
  });

  test("with --config and with --no-config-lookup no other file runs, and the base path is the working directory", async () => {
    const all = { files: ofMine, exitCode: 1 };
    expect(await run("mine", ["-c", "eslint.config.js", ".."])).toMatchObject({ ran: ["mine"], ...all });
    expect(await run("mine", ["-c", "eslint.config.js", "<w>/**/x.js"])).toMatchObject({ ran: ["mine"], ...all });
    expect(await run("mine", ["-c", "../theirs/eslint.config.js", ".."])).toMatchObject({ ran: ["theirs"], ...all });
    const rule = ["--no-config-lookup", "--rule", "no-debugger:error"];
    expect(await run("mine", [...rule, ".."])).toMatchObject({ ran: [], ...all });
    expect(await run("mine", [...rule, "<w>/**/x.js"])).toMatchObject({ ran: [], ...all });
    for (const args of [
      ["-c", "eslint.config.js", "../theirs"],
      ["-c", "eslint.config.js", "../.."],
      [...rule, "../theirs"],
    ]) {
      const { ran, files, stderr, exitCode } = await run("mine", args);
      expect(stderr).toContain("are ignored.");
      expect({ ran, files, exitCode }).toEqual({ ran: args[0] === "-c" ? ["mine"] : [], files: [], exitCode: 2 });
    }
  });

  test("without a configuration file in the working directory, each directory tells, as before", async () => {
    expect(await run("none", [".."])).toMatchObject({
      ran: configured.toSorted(),
      files: Object.keys(files)
        .map(it => it.replace("w/", ""))
        .sort(),
      exitCode: 1,
    });
  });
});

// A configuration file is a program, or names programs. ESLint stops in such a working directory, so there is no tool to follow.
describe.concurrent("a pattern that leaves a working directory without a configuration file", () => {
  const off = `{ rules: { "no-debugger": "off" } }`;
  /** The files of a directory with a configuration of each kind. `says`: a statement that writes down that it ran. */
  const kinds: Record<string, (says: string) => Record<string, string>> = {
    "flat-js": says => ({ "eslint.config.js": `import fs from "node:fs";\n${says}\nexport default [${off}];\n` }),
    "flat-cts": says => ({ "eslint.config.cts": `const fs = require("fs");\n${says}\nmodule.exports = [${off}];\n` }),
    "rc-cjs": says => ({
      ".eslintrc.cjs": `const fs = require("fs");\n${says}\nmodule.exports = { root: true, ...${off} };\n`,
    }),
    "rc-json-extends": says => ({
      ".eslintrc.json": `{ "root": true, "extends": "./program.js" }`,
      "program.js": `const fs = require("fs");\n${says}\nmodule.exports = ${off};\n`,
    }),
    "rc-yaml-plugin": says => ({
      ".eslintrc.yaml": `root: true\nplugins: [local]\nrules: { no-debugger: off }\n`,
      "node_modules/eslint-plugin-local/package.json": `{ "name": "eslint-plugin-local", "version": "1.0.0", "main": "index.js" }`,
      "node_modules/eslint-plugin-local/index.js": `const fs = require("fs");\n${says}\nmodule.exports = { rules: {} };\n`,
    }),
    "package-json-extends": says => ({
      "package.json": `{ "name": "a", "eslintConfig": { "root": true, "extends": "./program.js" } }`,
      "program.js": `const fs = require("fs");\n${says}\nmodule.exports = ${off};\n`,
    }),
    "ox-ts": says => ({ "oxlint.config.ts": `import fs from "node:fs";\n${says}\nexport default ${off};\n` }),
    "ox-json-plugin": says => ({
      ".oxlintrc.json": `{ "jsPlugins": ["./plugin.js"], "rules": { "no-debugger": "off" } }`,
      "plugin.js": `import fs from "node:fs";\n${says}\nexport default { meta: { name: "local" }, rules: {} };\n`,
    }),
  };
  const all = (where: string) =>
    Object.keys(kinds)
      .map(it => `${where}/${it}`)
      .sort();
  const scripts = (where: string) => all(where).map(it => `${it}/x.js`);

  /** The programs that ran, and the files with problems: those that have the defaults, and not their own configuration. */
  const run = async (args: string[], cwd = "empty") => {
    using logs = tempDir("bun-lint-config-files-ran", {});
    const log = join(String(logs), "ran.log");
    const files: Record<string, string> = { "w/empty/x.js": "debugger;\n", "w/empty/plain/x.js": "debugger;\n" };
    for (const where of ["beside", "empty/below"]) {
      for (const [kind, of] of Object.entries(kinds)) {
        const says = `fs.appendFileSync(${JSON.stringify(log)}, ${JSON.stringify(`${where}/${kind}\n`)});`;
        files[`w/${where}/${kind}/x.js`] = "debugger;\n";
        for (const [name, text] of Object.entries(of(says))) files[`w/${where}/${kind}/${name}`] = text;
      }
    }
    const result = await lint(files, [], {
      cwd: `w/${cwd}`,
      args: dir => args.map(it => it.replace("<w>", `${dir.replaceAll("\\", "/")}/w`)),
    });
    const ran = existsSync(log) ? [...new Set(readFileSync(log, "utf8").split("\n").filter(Boolean))].sort() : [];
    const found = [...new Set(result.problems.map(it => it.split(":")[0].replace("w/", "")))];
    return { ran, files: found.filter(it => it.endsWith("/x.js")) };
  };
  const own = ["empty/plain/x.js", "empty/x.js"];

  test.each([["<w>/**/x.js"], ["../**/x.js"]])(
    "nothing runs of what %s merely leads to, which has the defaults",
    async pattern => {
      expect(await run([pattern])).toMatchObject({ ran: all("empty/below"), files: [...scripts("beside"), ...own] });
    },
  );

  test.each([["../beside/*/x.js"], ["<w>/beside/**/x.js"], ["../*/*/x.js"]])("nor of what %s does", async pattern => {
    const { ran, files } = await run([pattern]);
    expect({ ran, beside: files.filter(it => it.startsWith("beside/")) }).toEqual({
      ran: [],
      beside: scripts("beside"),
    });
  });

  test.each(["--flavor=oxlint", "--flavor=eslint"])("nor with %s", async flavor => {
    const { ran, files } = await run([flavor, "<w>/**/x.js"]);
    expect(ran.filter(it => it.startsWith("beside/"))).toEqual([]);
    expect(files.filter(it => it.startsWith("beside/"))).toEqual(scripts("beside"));
  });

  test("not even beside the working directory, in the directory that it is in", async () => {
    expect(await run(["../**/x.js"], "empty/plain")).toMatchObject({
      ran: [],
      files: [...scripts("empty/below"), ...own],
    });
  });

  test("in and below the working directory each directory tells", async () => {
    for (const args of [[], ["."], ["**/x.js"], ["./below/../**/x.js"]]) {
      expect(await run(args)).toMatchObject({ ran: all("empty/below"), files: own });
    }
  });

  test.each(Object.keys(kinds))(
    "a directory that is named tells, and so does that of a file that is: %s",
    async kind => {
      const ran = [`beside/${kind}`];
      expect(await run([`../beside/${kind}`])).toEqual({ ran, files: [] });
      expect(await run([`../beside/${kind}/x.js`])).toEqual({ ran, files: [] });
    },
  );

  test("what is named is all that is in it", async () => {
    expect(await run(["../beside"])).toEqual({ ran: all("beside"), files: [] });
    expect(await run([".."])).toMatchObject({ ran: [...all("beside"), ...all("empty/below")], files: own });
    // Also for a pattern that leads there too.
    expect(await run(["../beside/flat-js", "../beside/*/x.js"])).toMatchObject({
      ran: ["beside/flat-js"],
      files: scripts("beside").filter(it => it !== "beside/flat-js/x.js"),
    });
  });
});

// With a file of mode 000, as somebody who is not root.
describe.skipIf(isWindows || process.getuid?.() === 0).concurrent("a file that cannot be opened", () => {
  const files = { "a.js": code, "locked.js": code, "sub/b.js": code };
  const before = (dir: string) => chmodSync(join(dir, "locked.js"), 0);

  // oxlint 1.87.0: `x Failed to open file <dir>/locked.js with error "Permission denied (os error 13)"`, and
  // "Found 0 warnings and 3 errors.". Without a configuration file as oxlint.
  test.each([
    [".oxlintrc.json", JSON.stringify({ ...noVar, categories: { correctness: "off" } })],
    ["bunfig.toml", `[lint.rules]\n"no-var" = "error"\n`],
    [".keep", ""],
  ])("is an error, and the others are linted: %s", async (name, text) => {
    for (const args of [["."], ["locked.js", "a.js", "sub"]]) {
      const { problems, stdout, exitCode } = await lint({ ...files, [name]: text }, args, { before });
      expect(stdout).toContain("Failed to open file <dir>/locked.js with error ");
      expect(stdout).toContain("Permission denied (os error 13)");
      expect(problems).toContain(`${name === ".oxlintrc.json" ? "" : "locked.js"}:0:0 -`);
      // For oxlint it is a problem of no file.
      expect([...new Set(problems.map(it => it.split(":")[0]))]).toEqual(
        [name === ".oxlintrc.json" ? "" : "locked.js", "a.js", "sub/b.js"].sort(),
      );
      expect(exitCode).toBe(1);
    }
  });

  // oxlint 1.87.0 has two kinds of problems without a place: one is in no file, the other in a file without a name.
  test("in oxlint's JSON it has no filename, unlike what is said about the suppressions", async () => {
    const config = JSON.stringify({ ...noVar, categories: { correctness: "off" } });
    const stale = JSON.stringify({ "sub/b.js": { "no-debugger": { count: 1 } } });
    const all = { ...files, ".oxlintrc.json": config, "oxlint-suppressions.json": stale };
    const { raw } = await lint(all, ["-f", "json", "."], { before });
    type Diagnostic = { message: string; filename?: string; labels: unknown[] };
    const placeless = (JSON.parse(raw).diagnostics as Diagnostic[]).filter(it => it.labels.length === 0);
    expect(placeless.map(it => [it.message.split(" ").slice(0, 4).join(" "), it.filename])).toEqual([
      ["Failed to open file", undefined],
      ["There are suppressions that", ""],
      ["There are new violations", ""],
    ]);
  });

  // ESLint 10.12.0 and 8.57.1: "Error: EACCES: permission denied, open '<dir>/locked.js'", and nothing else.
  test.each([
    ["eslint.config.js", `export default [${JSON.stringify(noVar)}];`],
    [".eslintrc.json", rc(noVar)],
  ])("is the end of the run: %s", async (name, text) => {
    const { problems, stderr, exitCode } = await lint({ ...files, [name]: text }, ["."], { before });
    expect(stderr).toContain("Cannot read <dir>/locked.js: EACCES: ");
    expect({ problems, exitCode }).toEqual({ problems: [], exitCode: 2 });
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

// As ESLint 10.12.0 and 9.39.5. `{ max: Infinity }` is how one limit is switched off. ajv takes it for an integer, and prints a
// value as `JSON.stringify` does.
describe("an infinite number in an eslint.config.mjs", () => {
  const code =
    "function f(a) {\n  if (a) {\n    if (a) {\n      if (a) {\n        return 123;\n      }\n    }\n  }\n}\nf();\n";
  test.concurrent.each([
    [`"max-depth": ["error", 2]`, ["4:7 Blocks are nested too deeply (3). Maximum allowed is 2."]],
    [`"max-depth": ["error", Infinity]`, []],
    [`"max-depth": ["error", { max: Infinity }]`, []],
    [`"max-lines": ["error", { max: Infinity }]`, []],
    [`"complexity": ["error", Infinity]`, []],
    [`"no-magic-numbers": ["error", { ignore: [Infinity] }]`, ["5:16 No magic number: 123."]],
    [
      `"id-length": ["error", { min: Infinity }]`,
      ["1:10 Identifier name 'f' is too short (< Infinity).", "1:12 Identifier name 'a' is too short (< Infinity)."],
    ],
    [
      `"id-length": ["error", { max: -Infinity }]`,
      ["1:10 Identifier name 'f' is too short (< 2).", "1:12 Identifier name 'a' is too short (< 2)."],
    ],
    [
      `"max-depth": ["error", -Infinity]`,
      'Key "rules": Key "max-depth":\n\tValue null should be >= 0.\n\tValue null should be object.\n\tValue null should match exactly one schema in oneOf.',
    ],
    [
      `"max-depth": ["error", { max: -Infinity }]`,
      'Key "rules": Key "max-depth":\n\tValue {"max":null} should be integer.\n\tValue null should be >= 0.\n\tValue {"max":null} should match exactly one schema in oneOf.',
    ],
    [`"p/limited": ["error", Infinity]`, 'Key "rules": Key "p/limited":\n\tValue null should be <= 10.'],
  ] as [string, string[] | string][])("an option of a rule: %s", async (rule, expected) => {
    const limited = `{ meta: { schema: [{ type: "integer", maximum: 10 }] }, create: () => ({}) }`;
    const files = {
      "eslint.config.mjs": `export default [{ plugins: { p: { rules: { limited: ${limited} } } }, rules: { ${rule} } }];\n`,
      "a.js": code,
    };
    const { raw, stderr, exitCode } = await lint(files, ["a.js"]);
    if (typeof expected === "string") {
      expect(stderr).toBe(`error: Invalid config in eslint.config.mjs\n${expected}`);
      expect(exitCode).toBe(2);
      return;
    }
    type Message = { line: number; column: number; message: string };
    const messages: Message[] = JSON.parse(raw).results[0].messages;
    expect(messages.map(it => `${it.line}:${it.column} ${it.message}`)).toEqual(expected);
    expect(exitCode).toBe(expected.length === 0 ? 0 : 1);
  });

  // ESLint hands options on as `structuredClone` makes them, and ajv sees an object without properties in a `Map`.
  test.concurrent.each([
    [
      `"max-depth": ["error", NaN]`,
      'Key "rules": Key "max-depth":\n\tValue null should be integer.\n\tValue null should be >= 0.\n\tValue null should be object.\n\tValue null should match exactly one schema in oneOf.',
    ],
    [
      `"max-depth": ["error", { max: NaN }]`,
      'Key "rules": Key "max-depth":\n\tValue {"max":null} should be integer.\n\tValue null should be integer.\n\tValue null should be >= 0.\n\tValue {"max":null} should match exactly one schema in oneOf.',
    ],
    [`"no-magic-numbers": ["error", { ignore: [NaN] }]`, ["4:9 No magic number: 123."]],
    [
      `"max-depth": ["error", function f() {}]`,
      'Config "mine": Key "rules": Key "max-depth": function f() {} could not be cloned.',
    ],
    [
      `"max-depth": ["error", { max: () => 1 }]`,
      'Config "mine": Key "rules": Key "max-depth": () => 1 could not be cloned.',
    ],
    [
      `"max-depth": ["off", Symbol("s")]`,
      'Config "mine": Key "rules": Key "max-depth": Symbol(s) could not be cloned.',
    ],
    [
      `"max-depth": ["error", new URL("http://a/")]`,
      'Config "mine": Key "rules": Key "max-depth": Cannot clone object of unsupported type.',
    ],
    [`"max-depth": ["error", new Map()]`, []],
    [`"max-depth": ["error", /x/]`, []],
    [
      `"max-depth": ["error", { max: new Set() }]`,
      'Key "rules": Key "max-depth":\n\tValue {"max":{}} should be integer.\n\tValue {} should be integer.\n\tValue {"max":{}} should match exactly one schema in oneOf.',
    ],
    [
      `"max-depth": ["error", new (class A { max = 2 })()]`,
      ["3:5 Blocks are nested too deeply (3). Maximum allowed is 2."],
    ],
    [
      `"max-depth": ["error", new (class A { x = 2 })()]`,
      'Key "rules": Key "max-depth":\n\tValue {"x":2} should be integer.\n\tValue {"x":2} should NOT have additional properties.\n\t\tUnexpected property "x". Expected properties: "maximum", "max".\n\tValue {"x":2} should match exactly one schema in oneOf.',
    ],
    [`"max-depth": ["error", 1n]`, "TypeError: Do not know how to serialize a BigInt"],
    [`"max-depth": ["error", undefined]`, []],
    [`"max-depth": ["error", { max: undefined }]`, []],
    [`"eqeqeq": ["error", undefined]`, []],
  ] as [string, string[] | string][])("what else JSON has no word for: %s", async (rule, expected) => {
    const files = {
      "eslint.config.mjs": `export default [{ name: "mine", rules: { ${rule} } }];\n`,
      "a.js": "if (a) {\n  if (b) {\n    if (c) {\n      d(123);\n    }\n  }\n}\n",
    };
    const { raw, stderr, exitCode } = await lint(files, ["a.js"]);
    if (typeof expected === "string") {
      expect(stderr).toBe(`error: Invalid config in eslint.config.mjs\n${expected}`);
      expect(exitCode).toBe(2);
      return;
    }
    type Message = { line: number; column: number; message: string };
    const messages: Message[] = JSON.parse(raw).results[0].messages;
    expect(messages.map(it => `${it.line}:${it.column} ${it.message}`)).toEqual(expected);
  });

  test("what a rule in JavaScript sees", async () => {
    const files = {
      "eslint.config.mjs": `
        const isPlain = it => Object.getPrototypeOf(it) === Object.prototype;
        const show = it => (isPlain(it) ? Object.entries(it).map(([key, value]) => key + "=" + value) : String(it));
        const rule = {
          meta: { schema: false },
          create: context => ({
            Program(node) {
              context.report({ node, message: "options " + context.options.map(show) + " settings " + context.settings.s });
            },
          }),
        };
        export default [{
          plugins: { p: { rules: { show: rule } } },
          settings: { s: -Infinity },
          rules: { "p/show": ["error", Infinity, { max: -Infinity }, NaN, /x/u] },
        }];`,
      "a.js": "a;\n",
    };
    const { raw } = await lint(files, ["a.js"]);
    const message = "options Infinity,max=-Infinity,NaN,/x/u settings -Infinity";
    expect(JSON.parse(raw).results[0].messages[0].message).toBe(message);
  });
});
