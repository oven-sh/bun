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
import expectedFromESLint8 from "./oracle/driver/eslintrc-cli.expected.json";
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
  /** Extra arguments that depend on the temporary directory's path. */
  args?: (dir: string) => string[];
};

/**
 * Runs `bun lint` on `files`. Returns the problems as `file:line:column rule`, the rest of the output, and the exit
 * code. It uses a format that's the same with either tool's config.
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
  // If a run fails or crashes, the assertion that fails is often about something else, so print the real cause.
  if (exitCode !== 0 && exitCode !== 1) console.error(`bun lint ${args.join(" ")}: exit code ${exitCode}\n${stderr}`);
  type Result = { filePath: string; messages: { ruleId: string | null; line?: number; column?: number }[] };
  const results: Result[] = stdout.startsWith('{"results":') ? JSON.parse(stdout).results : [];
  const problems = results.flatMap(({ filePath, messages }) => {
    const file = normalizeBunSnapshot(filePath, String(dir)).replace("<dir>/", "");
    return messages.map(it => `${file}:${it.line ?? 0}:${it.column ?? 0} ${it.ruleId ?? "-"}`);
  });
  return {
    problems: problems.sort(),
    /** The unmodified stdout. */
    raw: stdout,
    stdout: normalizeBunSnapshot(stdout, String(dir)),
    stderr: normalizeBunSnapshot(stderr, String(dir)),
    exitCode,
  };
}

// eqeqeq 2:7, no-debugger 2:13, no-var 1:1
const code = "var x = 1;\nif (x == 2) debugger;\n";
/** The prelude that `run` in evaluate.rs puts before a src/lint/driver script that runs a config file. */
const prelude = (path: string, argument: object | "" = "") =>
  `const given = ${JSON.stringify({ path, marker: "<marker>", argument: argument && JSON.stringify(argument), commandLine: [] })};\n`;
const rc = (config: object) => JSON.stringify({ root: true, ...config });
const eqeqeq = { rules: { eqeqeq: "error" } };
const noVar = { rules: { "no-var": "error" } };
const yaml = (rule: string) => `root: true\nrules:\n  ${rule}: error\n`;
/** True if the temporary directory is inside a repository. */
const isInRepository = (function look(directory: string): boolean {
  const isRoot = [".git", ".jj"].some(name => existsSync(join(directory, name)));
  return isRoot || (dirname(directory) !== directory && look(dirname(directory)));
})(realpathSync(tmpdir()));

// A stand-in for @eslint/eslintrc with the parts that `FlatCompat`'s functions are built from, in the same shape as in
// the package.
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

  test("from `FlatCompat` is replaced by the patterns it was built from", async () => {
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
  test("`basePath` can use the system's path separators", async () => {
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

  test("the script that runs the config file returns paths with `/`, also on Windows", async () => {
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

  test("a built-in plugin's package runs in JavaScript under a different name, and so does another plugin under the built-in name", async () => {
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

  // This is what ESLint 10.12 reports.
  test("the name a config gives to another package isn't treated as an alias of the built-in plugin", async () => {
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

  // This is what ESLint 10.12 prints with eslint-plugin-import 2.32.0.
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
    "an eslint-plugin-import rule's options are validated against its schema: %s",
    async (setting, expectedError, rule) => {
      const { stderr, exitCode } = await lint({
        "eslint.config.mjs": `const rule = { meta: { schema: false }, create: () => ({}) };
        const plugin = { meta: { name: "eslint-plugin-import", version: "2.32.0" }, rules: { "${rule}": rule } };
        export default [{ plugins: { import: plugin }, rules: { "import/${rule}": ${setting} } }];`,
        "a.js": "export {};\n",
      });
      if (expectedError === null) expect(stderr).not.toContain(`Key "rules"`);
      else expect(stderr).toContain(`Key "rules": Key ${expectedError}`);
      expect(exitCode).toBe(expectedError === null ? 0 : 2);
    },
  );

  // Same here. The schema uses `dependencies` to declare which options require which.
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
  ])("import/order: options that require other options: %s", async (options, expectedErrors) => {
    const { stderr, exitCode } = await lint({
      "eslint.config.mjs": `const order = { meta: { schema: false }, create: () => ({}) };
        const plugin = { meta: { name: "eslint-plugin-import", version: "2.32.0" }, rules: { order } };
        export default [{ plugins: { import: plugin }, rules: { "import/order": ["error", ${options}] } }];`,
      "a.js": "export {};\n",
    });
    if (expectedErrors === null) expect(stderr).not.toContain(`Key "rules"`);
    else expect(stderr).toEndWith(`Key "rules": Key "import/order":\n\t${expectedErrors.join("\n\t")}`);
    expect(exitCode).toBe(expectedErrors === null ? 0 : 2);
  });

  // This is what ESLint 10.12 prints. The first schema is react/jsx-newline's. Where validation stops at the first
  // error, that's the branch's error. Inside `anyOf` there's also a line about the branch.
  describe("`if`, `then` and `else` in a rule's schema", () => {
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
    test.each<[schema: object, option: unknown, expectedErrors: string[] | null]>([
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
    ])("%j validates %j like ESLint", async (schema, option, expectedErrors) => {
      const { stderr, exitCode } = await lint({
        "eslint.config.mjs": `const rule = { meta: { schema: [${JSON.stringify(schema)}] }, create: () => ({}) };
          export default [{ plugins: { x: { rules: { r: rule } } }, rules: { "x/r": ["error", ${JSON.stringify(option)}] } }];`,
        "a.js": "export {};\n",
      });
      if (expectedErrors === null) expect(stderr).not.toContain(`Key "rules"`);
      else expect(stderr).toEndWith(`Key "rules": Key "x/r":\n\t${expectedErrors.join("\n\t")}`);
      expect(exitCode).toBe(expectedErrors === null ? 0 : 2);
    });
  });

  test("import/order: classifies modules by name and by `settings`, and handles path groups, named imports and the fix", async () => {
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

  // Same as ESLint 10.12.
  test("config objects for different files can use different plugins under one name, but one file can't get both", async () => {
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
    const inlinePlugins = `const [one, two] = [${plugin("one")}, ${plugin("two")}];`;
    const messages = ({ raw }: { raw: string }) =>
      JSON.parse(raw).results.map((it: { messages: { message: string }[] }) => it.messages.map(it => it.message));
    const [fromModules, definedInline, forOneFile] = await Promise.all([
      lint({ ...files, "eslint.config.mjs": imported + objects(`files: ["x/**"],`) }, ["x", "y"]),
      lint({ ...files, "eslint.config.mjs": inlinePlugins + objects(`files: ["x/**"],`) }, ["x", "y"]),
      lint({ ...files, "eslint.config.mjs": imported + objects("") }, ["x", "y"]),
    ]);
    expect([messages(fromModules), messages(definedInline)]).toEqual([
      [["one ran"], ["two ran"]],
      [["one ran"], ["two ran"]],
    ]);
    expect(forOneFile.stderr).toContain(`Key "plugins": Cannot redefine plugin "p".`);
    expect(forOneFile.exitCode).toBe(2);
  });

  test("usedDeprecatedRules includes a JavaScript plugin's rules, in config order", async () => {
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

  test("--print-config includes a JavaScript plugin's rules", async () => {
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

  test("the languageOptions for a plugin's language aren't validated as JavaScript's", async () => {
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

  test("without a default export is an error", async () => {
    const { problems, stderr, exitCode } = await lint({ "eslint.config.mjs": "export const a = 1;\n", "a.js": code });
    expect(problems).toEqual([]);
    expect(stderr).toContain("<dir>/eslint.config.mjs exports nothing.");
    expect(exitCode).toBe(2);
  });

  test('`type: "any"` in a rule\'s schema allows everything', async () => {
    const { problems, stderr, exitCode } = await lint({
      "plugin.mjs": `export default { rules: { r: { meta: { schema: [{ type: "array", items: { type: "any" } }] }, create: context => ({ DebuggerStatement: node => context.report({ node, message: "found" }) }) } } };`,
      "eslint.config.mjs": `import p from "./plugin.mjs";\nexport default [{ ignores: ["plugin.mjs"] }, { plugins: { p }, rules: { "p/r": ["error", [{ a: 1 }, 1, "a"]] } }];`,
      "a.js": code,
    });
    expect(stderr).not.toContain("should be");
    expect(problems).toEqual(["a.js:2:13 p/r"]);
    expect(exitCode).toBe(1);
  });

  // Its output is looked up by the paths it was given, which have `/` on every system. `path.win32` turns them into
  // `\\`.
  test("the ESLint 8 script's output is keyed by the paths it was given, also on Windows", async () => {
    using dir = tempDir("bun-lint-config-files", {});
    const parts = ["start", "describe", "eslintrc"];
    const source = parts
      .map(it => readFileSync(join(import.meta.dir, `../../../src/lint/driver/evaluate-${it}.js`), "utf8"))
      .join("")
      .replaceAll('require("node:path")', 'require("node:path").win32');
    // A path that `require.resolve(..)` returned is looked up with `/`.
    const content = { extends: ["./base.json", String.raw`C:\t\other.json`], parser: "nowhere", plugins: ["nowhere"] };
    await using proc = spawn({
      cmd: [bunExe(), "--no-install", "-e", prelude("C:/t/.eslintrc.json", { pluginsFrom: "C:/t", content }) + source],
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
  test("the ESLint 8 script's output for an extended path is keyed by that path with `/`", async () => {
    using dir = tempDir("bun-lint-config-files", {});
    const parts = ["start", "describe", "eslintrc"];
    const source = parts
      .map(it => readFileSync(join(import.meta.dir, `../../../src/lint/driver/evaluate-${it}.js`), "utf8"))
      .join("")
      .replaceAll('require("node:path")', 'require("node:path").win32');
    const content = { extends: ["C:\\t\\base.json", ".\\near.json", "a-package"], parser: "C:\\t\\parser.js" };
    await using proc = spawn({
      cmd: [bunExe(), "--no-install", "-e", prelude("C:/t/.eslintrc.json", { pluginsFrom: "C:/t", content }) + source],
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
    // A parser is looked up as written. See `_loadParser` in src/lint/linter/config/eslintrc.rs.
    expect(Object.keys(config.parsers["C:/t/.eslintrc.json"])).toEqual(["C:\\t\\parser.js"]);
  });

  // The same goes for a file that it reads. `path.resolve` would remove the `/./` on every system.
  test("the ESLint 8 script's output for the file it runs is keyed by the path it was given", async () => {
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
      cmd: [bunExe(), "--no-install", "-e", prelude(path, { pluginsFrom: root }) + source.join("")],
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

  test("the script that runs the config file recognizes it however its path is spelled", async () => {
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
    // `bun lint` passes it with `/`, unlike Windows's own spelling. On other systems, `/./` or a symlink makes the
    // spelling differ.
    const paths = [`${root}/real/${isWindows ? "" : "./"}eslint.config.mjs`, `${root}/link/eslint.config.mjs`];
    const keys = await Promise.all(
      paths.map(async path => {
        await using proc = spawn({
          cmd: [bunExe(), "--no-install", "-e", prelude(path) + source.join("")],
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
    // There's no `module` key, because a plugin that's only defined in the config file can't be loaded without running
    // the file.
    expect(keys).toEqual([
      ["config", "described", "else", "index"],
      ["config", "described", "else", "index"],
    ]);
  });
});

// `import.source(..)` is a syntax error for Bun's parser, but Babel may accept it. No rule should run on an incomplete
// tree.
test.concurrent(
  "lists the files that only the config's parser can parse if the eslint package isn't installed",
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

// This is what ESLint 10.12 reports with @babel/eslint-parser 8.0.7, which does its own scope analysis: a file's code
// is only in a function scope with `globalReturn`, and never in a module. So in nodejs/node, which is "commonjs",
// `const { Symbol } = primordials;` defines the global variable, for built-in rules and for JavaScript rules.
test.concurrent("with Babel's parser, `commonjs` by itself doesn't wrap a file in a function scope", async () => {
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

// The built-in rule only runs where its output matches the package's byte for byte. If it can't be sure, the package's
// rule runs.
test.concurrent("prettier/prettier: the package's rule runs if the built-in one might differ", async () => {
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
  ["the packages' full names", ["eslint-import-resolver-node", { "eslint-import-resolver-typescript": {} }], []],
  ["webpack", "webpack", ["a.js:1:1 import/no-cycle"]],
  ["webpack and node", { node: {}, webpack: { config: "webpack.config.js" } }, ["a.js:1:1 import/no-cycle"]],
  ["in a list", ["node", { alias: {} }], ["a.js:1:1 import/no-cycle"]],
  ["in a list in a list", [["node"], [["webpack"]]], ["a.js:1:1 import/no-cycle"]],
  ["lists of known resolvers", [["node"], [], null], []],
  ["a value that means no resolver", 0, []],
  // The package reports an error for these.
  ["an invalid resolver", true, ["a.js:1:1 import/no-cycle"]],
  ["an invalid resolver in a list", ["node", 0], ["a.js:1:1 import/no-cycle"]],
  ["core modules that aren't a list", "node", ["a.js:1:1 import/no-cycle"], { "import/core-modules": 5 }],
  [
    "the built-in parsers",
    undefined,
    [],
    { "import/parsers": { "espree": [".js"], "@typescript-eslint/parser": [".ts"] } },
  ],
  ["another parser", "node", ["a.js:1:1 import/no-cycle"], { "import/parsers": { "@babel/eslint-parser": [".js"] } }],
  // This is how eslint-config-next writes them: `[require.resolve("eslint-import-resolver-node")]`.
  [
    "the packages' paths",
    {
      "/p/node_modules/eslint-import-resolver-node/index.js": {},
      "C:\\p\\node_modules\\eslint-import-resolver-typescript\\lib\\index.cjs": {},
    },
    [],
    { "import/parsers": { "/p/node_modules/.pnpm/a/node_modules/@typescript-eslint/parser/dist/index.js": [".ts"] } },
  ],
  [
    "another resolver's path",
    { "/p/node_modules/eslint-import-resolver-webpack/index.js": {} },
    ["a.js:1:1 import/no-cycle"],
  ],
] as [string, unknown, string[], object?][])(
  "import/resolver: the package's rule runs if a resolver isn't built in: %s",
  // With four parameters, a row of three would get `done` as the fourth.
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

// This is what eslint-import-resolver-typescript 4.4.5 resolves, with eslint-plugin-import 2.32.0 under ESLint 10.12.
// TypeScript itself resolves none of the first seven: no style sheets, no images, nothing with a `?` query, and under
// `node16` nothing without its extension.
test.concurrent("import/resolver: typescript resolves non-script files like the package", async () => {
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

// Recorded from eslint-import-resolver-typescript 4.4.5 with eslint-plugin-import 2.32.0 under ESLint 10.12. It doesn't
// read the tsconfig.json nearest to a file.
test.concurrent.each([
  // It reads the working directory's tsconfig.json and, among its references, the first one whose directory contains
  // the file. Vite's templates are set up like this.
  ["nothing", true, { "@/x": [], "~base/x": all, "#a/x": all, "#b/x": all }],
  [
    "one file with any name",
    { project: "tsconfig.base.json" },
    { "@/x": all, "~base/x": [], "#a/x": all, "#b/x": all },
  ],
  ["one directory", { project: "packages/a" }, { "@/x": all, "~base/x": all, "#a/x": [], "#b/x": all }],
  // It uses the closest tsconfig.json that includes the file. For a file that none of them includes, it tries each one.
  ["a pattern", { project: "packages/*/tsconfig.json" }, { "@/x": all, "~base/x": all, "#a/x": ["b"], "#b/x": ["a"] }],
  ["a list", { project: ["packages/a", "packages/b"] }, { "@/x": all, "~base/x": all, "#a/x": ["b"], "#b/x": ["a"] }],
] as [string, unknown, Record<string, string[]>][])(
  "import/resolver: typescript: which tsconfig.json it reads: %s",
  async (_, options, unresolvedIn) => {
    const names = Object.keys(unresolvedIn);
    const code = names.map(it => `import ${JSON.stringify(it)};\n`).join("");
    const paths = (name: string) => JSON.stringify({ compilerOptions: { paths: { [`${name}/*`]: ["./src/*"] } } });
    const files = {
      // This is how eslint-config-next writes it: `[require.resolve("eslint-import-resolver-typescript")]`.
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

// Recorded from eslint-import-resolver-typescript 4.4.5 with eslint-plugin-import 2.32.0 under ESLint 10.12.
// `core.wasm.js` can't be imported without its extension, because `core.wasm` is a different file. TypeScript would add
// `.js` to that.
test.concurrent(
  "import/resolver: typescript: a specifier that's an existing file resolves to it before any extension is tried",
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

// Recorded from eslint-import-resolver-typescript 4.4.5 with eslint-plugin-import 2.32.0 under ESLint 10.12. Node.js
// and TypeScript treat the `exports` target as the file itself.
test.concurrent(
  "import/resolver: typescript keeps resolving from an `exports` target: extensions, then a directory",
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

test.concurrent("import/ignore with a RegExp object instead of a string: the package's rule runs", async () => {
  const theirs = `{ create: context => ({ Program(node) { context.report({ node, message: "theirs" }); } }) }`;
  const config = (ignore: string) => `export default [
    { settings: { "import/ignore": [${ignore}] } },
    { plugins: { import: { meta: { name: "eslint-plugin-import" }, rules: { "no-cycle": ${theirs} } } }, rules: { "import/no-cycle": "error" } },
  ];`;
  const problems = async (ignore: string) =>
    (await lint({ "eslint.config.mjs": config(ignore), "a.js": "export {};\n" }, ["a.js"])).problems;
  expect(await problems(String.raw`/\.css$/`)).toEqual(["a.js:1:1 import/no-cycle"]);
  expect(await problems(String.raw`"\\.css$"`)).toEqual([]);
});

describe.concurrent("the note about an older installed version of a built-in plugin", () => {
  // The note is only printed if the run fails.
  const fails = ["--rule", "no-debugger: error"];
  const notes = async (files: Record<string, string>, ...flags: string[]) =>
    (await lint({ "a.js": "debugger;\n", ...files }, ["-f", "stylish", ...fails, ...flags, "a.js"])).stderr
      .split("\n")
      .filter(it => it.startsWith("note: "));
  const flat = (plugins: Record<string, { name?: string; version?: string }>) => ({
    "eslint.config.mjs": `export default [{ plugins: ${JSON.stringify(
      Object.fromEntries(Object.entries(plugins).map(([prefix, meta]) => [prefix, { meta, rules: {} }])),
    )} }];`,
  });
  const typescript = (version?: string) =>
    flat({ "@typescript-eslint": { name: "@typescript-eslint/eslint-plugin", version } });

  test("is printed if the installed version is older by a minor version or more", async () => {
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

  test("isn't printed for an older patch, a newer or unknown version, or a plugin that runs in JavaScript", async () => {
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

  test("isn't printed in quiet or machine-readable output", async () => {
    for (const flags of [["--quiet"], ["--silent"], ["-f", "json"], ["-f", "unix"]]) {
      expect([flags, await notes(typescript("8.43.0"), ...flags)]).toEqual([flags, []]);
    }
  });

  test("isn't printed if the run passes: with no problems, or with only warnings", async () => {
    const note =
      "note: @typescript-eslint/eslint-plugin 8.43.0 is installed, but bun lint's built-in rules match 8.71.1";
    const warns = ["--rule", "no-debugger: warn"];
    expect(await notes({ ...typescript("8.43.0"), "a.js": "export {};\n" })).toEqual([]);
    expect(await notes(typescript("8.43.0"), ...warns)).toEqual([]);
    expect(await notes(typescript("8.43.0"), ...warns, "--max-warnings", "1")).toEqual([]);
    expect(await notes(typescript("8.43.0"), ...warns, "--max-warnings", "0")).toEqual([note]);
  });

  test("with an .eslintrc.json, reads the version from the package", async () => {
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

describe.concurrent("an eslint.config.js is evaluated again on every run", () => {
  const timeout = isDebug || isASAN ? 120_000 : 30_000;

  /**
   * Creates a project. `write` writes a file with a modification time of a minute ago. `run` returns the rules that
   * report something.
   */
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
    "a package it tries to import is found as soon as it's installed",
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

  // Same as ESLint 10.12.0.
  test(
    "a config that depends on the command line isn't reused for a run with other flags",
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
    "no cache files are left in the project, whatever the config reads",
    async () => {
      using it = project({
        "eslint.config.mjs": `import { readFileSync } from "node:fs";
        const rule = readFileSync(new URL("./rule.txt", import.meta.url), "utf8");
        export default [{ rules: { [rule]: process.env.SOME_TOKEN ? "error" : "off" } }];`,
        "rule.txt": "no-var",
      });
      expect(await it.run({ SOME_TOKEN: "synthetic" })).toEqual(["no-var"]);
      expect(await it.run()).toEqual([]);
      const entries = readdirSync(it.root, { recursive: true }) as string[];
      expect(entries.map(name => name.replaceAll(sep, "/")).sort()).toEqual([
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

// Same as ESLint 10.12.0 and oxlint 1.87.0, which load a config in Node. `bun run` doesn't pass it to a script either.
test.concurrent.each([
  ["eslint.config.mjs", (rules: string) => `export default [{ rules: ${rules} }];`],
  ["oxlint.config.ts", (rules: string) => `export default { categories: { correctness: "off" }, rules: ${rules} };`],
])("`process.env` in %s has the inherited variables but not the project's .env", async (name, config) => {
  const rules = `{ "no-var": process.env.FROM_FILE ? "error" : "off", eqeqeq: process.env.INHERITED ? "error" : "off" }`;
  const files = { ".env": "FROM_FILE=1\n", [name]: config(rules), "a.js": code };
  const result = await lint(files, ["a.js"], { env: { INHERITED: "1" } });
  expect(result.problems).toEqual(["a.js:2:7 eqeqeq"]);
  expect(result.exitCode).toBe(1);
});

// Same as ESLint 10.12.0 and oxlint 1.87.0, which load a config in Node. On Windows the preload still runs.
test.skipIf(isWindows).each([
  ["eslint.config.mjs", (rules: string) => `export default [{ rules: ${rules} }];`],
  ["oxlint.config.ts", (rules: string) => `export default { categories: { correctness: "off" }, rules: ${rules} };`],
])("a `preload` in bunfig.toml doesn't run before %s", async (name, config) => {
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

// ESLint 10.12.0 and oxlint 1.87.0 load a config in their own process: `[node, <the tool>, ...arguments]`.
describe.concurrent("`process.argv` in a config file is bun lint's command line", () => {
  const kinds: [string, (rules: string) => string][] = [
    ["eslint.config.mjs", rules => `export default [{ rules: ${rules} }];`],
    ["oxlint.config.ts", rules => `export default { categories: { correctness: "off" }, rules: ${rules} };`],
    [".eslintrc.cjs", rules => `module.exports = { root: true, rules: ${rules} };`],
  ];
  const before = ["lint", "--threads", "2", "-f", "json-with-metadata"];
  /**
   * Code for a config file that throws, with what it sees, unless `process.argv` is exactly `before` followed by
   * `args`.
   */
  const sees = (args: string[]) => `
    const seen = JSON.stringify(process.argv.slice(1));
    if (seen !== ${JSON.stringify(JSON.stringify([...before, ...args]))} || process.argv[0] !== process.execPath)
      throw new Error(seen);
    if (JSON.stringify(Bun.argv) !== JSON.stringify(process.argv)) throw new Error(JSON.stringify(Bun.argv));\n`;

  test.each(kinds)("in %s", async (name, config) => {
    const args = ["--fix-dry-run", "a.js"];
    const files = { [name]: sees(args) + config(`{ "no-var": "off", eqeqeq: "error" }`), "a.js": code };
    const result = await lint(files, args);
    expect(result.problems).toEqual(["a.js:2:7 eqeqeq"]);
    expect(result.exitCode).toBe(1);
  });

  // If the child process parsed these, a second `--cwd sub` would mean `sub/sub`, `-c` a bunfig.toml, `-e` and `-p`
  // code to run, and `--help` and `--version` would end it.
  test.each(kinds)("the process that loads %s doesn't parse any of it as its own flags", async (name, config) => {
    const paths = ["a.js", "-e", "-p", "--help", "--version", "--watch", "--inspect-brk", "--silent", "--"];
    const args = ["--cwd", "sub", "-c", name, "--no-error-on-unmatched-pattern", "--", ...paths];
    const files = { [`sub/${name}`]: sees(args) + config(`{ eqeqeq: "error" }`), "sub/a.js": code };
    const result = await lint(files, args);
    expect(result.problems).toEqual(["sub/a.js:2:7 eqeqeq"]);
    expect(result.exitCode).toBe(1);
  });

  // Windows limits a command line to 32,767 characters.
  test.each(kinds)("the script that loads %s isn't passed on its process's command line", async (name, config) => {
    const rules = `{ eqeqeq: process.execArgv.join(" ").length < 200 ? "error" : "off" }`;
    const result = await lint({ [name]: config(rules), "a.js": code }, ["a.js"]);
    expect(result.problems).toEqual(["a.js:2:7 eqeqeq"]);
    expect(result.exitCode).toBe(1);
  });

  test("a plugin sees the same `process.argv`", async () => {
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

  // It isn't passed on the child process's command line or in its environment, because there's no room for it twice.
  test.skipIf(isWindows)("works with a one-megabyte command line", async () => {
    const names = Array.from({ length: 15_000 }, (_, index) => `a${index}`.padEnd(40, "b"));
    const args = [...names.flatMap(it => ["--global", it]), "a.js"];
    const rules = `{ eqeqeq: process.argv.length === ${1 + before.length + args.length} ? "error" : "off" }`;
    const files = { "eslint.config.mjs": `export default [{ rules: ${rules} }];`, "a.js": code };
    const result = await lint(files, args);
    expect(result.problems).toEqual(["a.js:2:7 eqeqeq"]);
    expect(result.exitCode).toBe(1);
  });
});

describe.concurrent("evaluating an eslint.config.js doesn't load the packages of built-in plugins", () => {
  const timeout = isDebug || isASAN ? 120_000 : 30_000;
  // A stand-in for the relevant parts of typescript-eslint, in the shape TypeScript compiles them to. Each large module
  // logs that it was loaded.
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

  /** Runs `bun lint`. Returns the reports and the large modules that were loaded. */
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
    "a config that only turns rules on loads none of the large modules",
    async () => {
      expect(await run(recommended)).toEqual({ reported: [builtIn], loaded: [], failure: undefined });
    },
    timeout,
  );

  test(
    "a rule that isn't built in runs from the package",
    async () => {
      const config = `export default [{ files: ["**/*.ts"], ...all.configs.recommended, rules: { "@typescript-eslint/not-built-in": "error" } }];`;
      expect(await run(config)).toMatchObject({ reported: ["1:1 not built in"], failure: undefined });
      const unknown = `export default [{ files: ["**/*.ts"], ...all.configs.recommended, rules: { "@typescript-eslint/nowhere": "error" } }];`;
      expect((await run(unknown)).failure).toContain(`Could not find "nowhere" in plugin "@typescript-eslint".`);
    },
    timeout,
  );

  test(
    "a config that reads from a module gets the real module",
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
    "a different major version of the package is loaded normally",
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

  // Each row is what oxlint 1.87 does. It also validates the options of a rule that's off, but not those of a rule
  // whose plugin (going by the name as written) isn't enabled.
  describe("an unknown property in an oxlint rule's options", () => {
    const typo = { zz: 1 };
    const caseError =
      "`unicorn/filename-case`:\n  unknown field `zz`, expected one of `cases`, `case`, `ignore`, `multipleFileExtensions`";
    const getterError = "`getter-return`:\n  unknown field `zz`, expected `allowImplicit`";
    const keyError =
      "`react/jsx-key`:\n  unknown field `zz`, expected one of `checkKeyMustBeforeSpread`, `warnOnDuplicates`, `checkFragmentShorthand`";
    test.each<[name: string, config: object, expectedError: string | undefined, flags?: string[]]>([
      ["a core rule", { rules: { "getter-return": ["error", typo] } }, getterError],
      ["a rule that's off", { rules: { "getter-return": ["off", typo] } }, getterError],
      ["under its other name", { rules: { "eslint/getter-return": ["error", typo] } }, getterError],
      ["without any plugin", { plugins: [], rules: { "getter-return": ["error", typo] } }, getterError],
      [
        "in an override",
        { overrides: [{ files: ["*.ts"], rules: { "getter-return": ["error", typo] } }] },
        getterError,
      ],
      ["in an extended file", { extends: ["./extended.json"] }, getterError],
      [
        "a rule with two valid properties",
        { rules: { yoda: ["error", "never", typo] } },
        "`yoda`:\n  unknown field `zz`, expected `exceptRange` or `onlyEquality`",
      ],
      [
        "the first of two unknown ones",
        { rules: { "getter-return": ["error", { b: 1, a: 2 }] } },
        getterError.replace("zz", "b"),
      ],
      ["a plugin that's on by default", { rules: { "unicorn/filename-case": ["error", typo] } }, caseError],
      ["a plugin from `plugins`", { plugins: ["react"], rules: { "react/jsx-key": ["error", typo] } }, keyError],
      ["a plugin enabled by a flag", { rules: { "react/jsx-key": ["error", typo] } }, keyError, ["--react-plugin"]],
      [
        "a plugin enabled in the override",
        { overrides: [{ files: ["*.ts"], plugins: ["react"], rules: { "react/jsx-key": ["error", typo] } }] },
        keyError,
      ],
      [
        "a plugin from `plugins`, with the rule in an override",
        { plugins: ["react"], overrides: [{ files: ["*.ts"], rules: { "react/jsx-key": ["error", typo] } }] },
        keyError,
      ],
      ["a known property", { rules: { "getter-return": ["error", { allowImplicit: true }] } }, undefined],
      ["one option more than the rule has", { rules: { "getter-return": ["error", {}, typo] } }, undefined],
      [
        "a plugin that isn't enabled",
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
        "a plugin that's only enabled in an override",
        { rules: { "react/jsx-key": ["error", typo] }, overrides: [{ files: ["*.ts"], plugins: ["react"] }] },
        undefined,
      ],
      [
        "a core rule under the name of a plugin that isn't enabled",
        { plugins: [], rules: { "@typescript-eslint/no-unused-vars": ["error", typo] } },
        undefined,
      ],
    ])("%s", async (_, config, expectedError, flags = []) => {
      const files = {
        ".oxlintrc.json": JSON.stringify({ categories: { correctness: "off" }, ...config }),
        "extended.json": JSON.stringify({ rules: { "getter-return": ["error", typo] } }),
        "a.js": "export {};\n",
      };
      // Like oxlint, it's printed on stdout.
      const { stdout, exitCode } = await lint(files, [...flags, "a.js"]);
      if (expectedError) expect(stdout).toContain(`Invalid configuration for rule ${expectedError}`);
      else expect(stdout).not.toContain("unknown field");
      expect(exitCode).toBe(expectedError ? 1 : 0);
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
    // The plugin isn't enabled.
    [{ rules: { "react/no-danger": ["error", 1] } }, undefined],
    [{ rules: { "no-debugger": ["error"] } }, undefined],
    [{ rules: { eqeqeq: ["error", "always"] } }, undefined],
  ])("options for an oxlint rule that doesn't accept any: %j", async (config, name) => {
    const files = {
      ".oxlintrc.json": JSON.stringify({ categories: { correctness: "off" }, ...config }),
      "a.js": "export {};\n",
    };
    const { stdout, exitCode } = await lint(files, ["a.js"]);
    const noOptionsMessage = "This rule does not accept configuration options.";
    if (name) expect(stdout).toContain(`Invalid configuration for rule \`${name}\`:\n  ${noOptionsMessage}`);
    else expect(stdout).not.toContain(noOptionsMessage);
    expect(exitCode).toBe(name ? 1 : 0);
  });

  // Each row is what oxlint 1.87 prints about a rule's options: the lines below "Invalid configuration for rule", or
  // `null` if it accepts them. It prints all the errors at once, sorted by their text.
  describe("oxlint rules' options", () => {
    // prettier-ignore
    const rows: [rule: string, options: unknown[], expectedError: string | null][] = [
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
    // A config file can only set each rule once, so the rows are spread over several files.
    const rounds: (typeof rows)[] = [];
    for (const row of rows) {
      const round = rounds.find(it => it.every(other => other[0] !== row[0]));
      if (round) round.push(row);
      else rounds.push([row]);
    }

    test.each(rounds.map((round, at) => [at, round] as const))("match oxlint: config file %i", async (_, round) => {
      const rules = Object.fromEntries(round.map(([rule, options]) => [rule, ["off", ...options]]));
      const files = {
        ".oxlintrc.json": JSON.stringify({ plugins, categories: { correctness: "off" }, rules }),
        "a.js": "export {};\n",
      };
      const { raw, exitCode } = await lint(files, ["a.js"]);
      const expected = round
        .filter(it => it[2] !== null)
        .map(([rule, , expectedError]) => {
          const name = rule.replace(/^(jsx|react)-(a11y|perf)\//, "$1_$2/");
          return `Invalid configuration for rule \`${name}\`:\n${expectedError}`;
        })
        .sort();
      const at = raw.indexOf("Invalid configuration");
      expect(at < 0 ? "" : raw.slice(at).trimEnd()).toBe(expected.join("\n\n"));
      expect(exitCode).toBe(expected.length > 0 ? 1 : 0);
    });

    const bad = (word: string) => ["error", word];
    const invalidRules = async (config: object, extended: object = {}, flags: string[] = []) => {
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
        "the file's rules before its overrides",
        ["eqeqeq"],
        { rules: { eqeqeq: bad("x") }, overrides: [forJs({ curly: bad("x") })] },
      ],
      [
        "one override at a time",
        ["curly", "yoda"],
        { overrides: [forJs({ yoda: bad("x"), curly: bad("x") }), forJs({ eqeqeq: bad("x") })] },
      ],
      [
        "the file's rules together with the extended file's",
        ["curly", "yoda"],
        { ...extending, rules: { yoda: bad("x") } },
        { rules: { curly: bad("x") } },
      ],
      [
        "not an extended rule that the file overrides",
        [],
        { ...extending, rules: { curly: "off" } },
        { rules: { curly: bad("x") } },
      ],
      [
        "the extended file's overrides first",
        ["curly"],
        { ...extending, overrides: [forJs({ yoda: bad("x") })] },
        { overrides: [forJs({ curly: bad("x") })] },
      ],
      ["a plugin enabled in the extended file", ["react/jsx-key"], extending, { plugins: ["react"], rules: key }],
      [
        "a plugin enabled in the extended file, for the file's own rules",
        ["react/jsx-key"],
        { ...extending, rules: key },
        { plugins: ["react"] },
      ],
      [
        "the file's plugin, for the extended file's rules",
        ["react/jsx-key"],
        { ...extending, plugins: ["react"] },
        { rules: key },
      ],
      ["both have plugins", ["react/jsx-key"], { ...extending, plugins: [] }, { plugins: ["react"], rules: key }],
      [
        "a plugin enabled by a flag, for the extended file's rules",
        ["react/jsx-key"],
        extending,
        { rules: key },
        ["--react-plugin"],
      ],
      [
        "a plugin enabled in an extended override",
        ["react/jsx-key"],
        extending,
        { overrides: [forJs(key, { plugins: ["react"] })] },
      ],
      ["an extended override without the plugin", [], extending, { overrides: [forJs(key)] }],
      [
        "an extended override, with the plugin enabled in that file",
        ["react/jsx-key"],
        extending,
        { plugins: ["react"], overrides: [forJs(key)] },
      ],
    ];
    test.each(looks.map(it => [it[0], it] as const))("which options are validated: %s", async (_, row) => {
      const [, rules, config, extended, flags] = row;
      expect(await invalidRules(config, extended, flags)).toEqual([rules, rules.length > 0 ? 1 : 0]);
    });
  });

  // oxlint 1.87 accepts each of these, and each is valid according to its configuration_schema.json. ESLint's rule
  // schemas reject them.
  test("accepts options that oxlint accepts and ESLint's rule schema rejects", async () => {
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
    // Each set gets its own directory, because one rejected config ends the run.
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

  // oxlint 1.87 accepts both. eslint-plugin-import's schemas allow neither.
  test.each([
    { "import/max-dependencies": ["error", 2] },
    { "import/consistent-type-specifier-style": ["error", "prefer-top-level-if-only-type-imports"] },
  ])("a plugin rule's ESLint schema isn't applied: %j", async rules => {
    const { stderr, exitCode } = await lint({
      ".oxlintrc.json": JSON.stringify({ plugins: ["import"], categories: { correctness: "off" }, rules }),
      "a.js": "export {};\n",
    });
    expect(stderr).not.toContain(`Key "rules"`);
    expect(exitCode).toBe(0);
  });

  test("disable comments are the only comments that configure anything", async () => {
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
    "`extends` %j, which is a missing file or a package name, is an error",
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

  test("`extends` in an oxlint.config.ts takes imported config objects", async () => {
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

  // Same as oxlint 1.87.0.
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
  ])("`extends` in an oxlint.config.ts rejects paths: %s", async (extended, message) => {
    const { problems, stdout, exitCode } = await lint({
      "oxlint.config.ts": `export default { extends: ${extended} };`,
      "base.json": JSON.stringify({ rules: { eqeqeq: "error" } }),
      "a.js": code,
    });
    expect(problems).toEqual([]);
    expect(stdout).toContain(message);
    expect(exitCode).toBe(1);
  });

  test("`options` in the working directory's config apply to the whole run", async () => {
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

  test("`files` in `overrides` doesn't add files to the run", async () => {
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

  // Notepad and Windows PowerShell's `Out-File -Encoding utf8` write the mark. Git and oxlint 1.87.0 skip it.
  test.each([
    ["\\r\\n", (text: string) => text.replaceAll("\n", "\r\n")],
    ["a byte order mark", (text: string) => "\uFEFF" + text],
    ["both", (text: string) => "\uFEFF" + text.replaceAll("\n", "\r\n")],
  ])("handles %s in an ignore file", async (_, transform) => {
    const files = {
      ".oxlintrc.json": JSON.stringify({ ...noVar, categories: { correctness: "off" } }),
      "dist/a.js": code,
      "b.gen.js": code,
      "keep.gen.js": code,
      "sub/c.js": code,
      "d.js": code,
    };
    const patterns = transform("dist\n# a comment\n\n*.gen.js\n!keep.gen.js\nsub/\n");
    const results = await Promise.all([
      lint({ ...files, ".gitignore": patterns }),
      lint({ ...files, ".eslintignore": patterns }),
      lint({ ...files, "mine": patterns }, ["--ignore-path", "mine", "."]),
    ]);
    expect(results.map(it => it.problems)).toEqual(results.map(() => ["d.js:1:1 no-var", "keep.gen.js:1:1 no-var"]));
  });

  // Matches oxlint 1.87.0. The first row is what `git worktree add` writes. A submodule has no `commondir`.
  test.each([
    ["read for a worktree", "gitdir: main/.git/worktrees/x\n", "../..\n", true],
    ["read with \\r\\n line endings", "gitdir: main/.git/worktrees/x\r\n", "../..\r\n", true],
    ["read with a commondir relative to the working directory", "gitdir: main/.git/worktrees/x\n", "main/.git\n", true],
    ["not read without a commondir", "gitdir: main/.git/worktrees/x\n", undefined, false],
    ["not read without a space after `gitdir:`", "gitdir:main/.git/worktrees/x\n", "../..\n", false],
  ])("info/exclude when .git is a file: %s", async (_, pointer, commondir, isRead) => {
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

  // Matches oxlint 1.87.0.
  describe("a nested repository", () => {
    const [o, top, i, s] = ["dist/o.js", "top.js", "vendor/lib/dist/i.js", "vendor/lib/src/s.js"];
    const [d, k] = ["vendor/lib/sub/deep/dist/d.js", "vendor/lib/sub/deep/k.js"];
    const names = [o, top, i, s, d, k];
    const tree = {
      ".oxlintrc.json": JSON.stringify({ ...noVar, categories: { correctness: "off" } }),
      ...Object.fromEntries(names.map(name => [name, code])),
    };
    const [outer, inner] = [{ ".git/HEAD": "" }, { "vendor/lib/.git/HEAD": "" }];
    /** Returns the files that were linted. */
    async function linted(files: Record<string, string>, args?: string[], options?: Options) {
      const { problems } = await lint({ ...tree, ...files }, args, options);
      return problems.map(it => it.split(":")[0]);
    }

    test.each<[string, Record<string, string>, Options]>([
      [".git is a directory", inner, {}],
      [".git is an empty directory", {}, { before: dir => mkdirSync(join(dir, "vendor", "lib", ".git")) }],
      [".git is a file, as in a submodule", { "vendor/lib/.git": "gitdir: ../../.git/modules/lib\n" }, {}],
      ["a Jujutsu repository", { "vendor/lib/.jj/working_copy/type": "" }, {}],
    ])("a .gitignore above its root doesn't apply inside it: %s", async (_, root, options) => {
      expect(await linted({ ...outer, ...root, ".gitignore": "dist/\n" }, ["."], options)).toEqual([top, i, s, d, k]);
    });

    test.each<[Record<string, string>, string[]]>([
      [{ "vendor/.gitignore": "dist/\n" }, names],
      [{ ".git/info/exclude": "src/\n" }, names],
      [{ "vendor/lib/.git/info/exclude": "src/\n" }, [o, top, i, d, k]],
      [{ "vendor/lib/.gitignore": "dist/\n", "vendor/lib/sub/deep/.git/HEAD": "" }, [o, top, s, d, k]],
      // .eslintignore isn't a Git file, so it applies in both repositories.
      [{ ".gitignore": "dist/\n", ".eslintignore": "src/\n" }, [top, i, d, k]],
    ])("no other Git ignore file from outside applies inside it, but its own do: %j", async (files, expected) => {
      expect(await linted({ ...outer, ...inner, ...files })).toEqual(expected);
    });

    test.each<[Record<string, string>, string]>([
      [{ ".gitignore": "dist/\n" }, "dist"],
      [{ ".git/info/exclude": "dist/\n" }, "dist"],
      [{ ".gitignore": "vendor/\n" }, "vendor/lib/src"],
    ])("a directory passed as an argument isn't searched if Git ignores it: %j %s", async (files, directory) => {
      expect(await linted({ ...outer, ...files }, [directory, top])).toEqual([top]);
    });

    describe.skipIf(isInRepository)("with an argument outside any repository", () => {
      test.each([
        ["dist", [o, s, d, k]],
        [top, [top, s, d, k]],
      ])("a .gitignore above its root applies inside it: %s", async (outside, expected) => {
        expect(await linted({ ...inner, ".gitignore": "i.js\n" }, ["vendor/lib", outside])).toEqual(expected);
      });
    });
  });

  // Matches oxlint 1.87.0. A junction doesn't need privileges on Windows. Elsewhere it's an ordinary symlink.
  test("follows a symlink to a directory, unless it points back to a directory that the walk is already in", async () => {
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
    const [direct, throughLink, all] = await Promise.all(
      ["project/pkg", "via/pkg", "."].map(where => lint(files, [where], { before })),
    );
    const below = (pkg: string) =>
      ["a.js", "linked/b.js", "up/elsewhere/b.js", "up/pkg/a.js", "up/pkg/linked/b.js"].map(
        it => `${pkg}/${it}:1:1 no-var`,
      );
    expect(direct.problems).toEqual(below("project/pkg"));
    expect(throughLink.problems).toEqual(below("via/pkg"));
    expect(all.problems).toEqual(
      ["project", "via"].flatMap(it =>
        ["elsewhere/b.js", "pkg/a.js", "pkg/linked/b.js"].map(file => `${it}/${file}:1:1 no-var`),
      ),
    );
  });

  // With two such links the walk used to double at each level and never finished.
  test("the walk ends with symlinks to a parent directory, to their own directory, and between two packages", async () => {
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

  test("a path longer than any OS allows is treated as a missing file", async () => {
    const files = { ".oxlintrc.json": JSON.stringify({ ...noVar, categories: { correctness: "off" } }), "a.js": code };
    // The limit is 4,096 bytes on Linux, 1,024 on macOS, and 32,767 characters on Windows, which is also the limit for
    // its whole command line.
    const long = Buffer.alloc(isWindows ? 30_000 : 40_000, "a/").toString() + "a.js";
    const { problems, exitCode } = await lint(files, [long, "a.js"]);
    expect(problems).toEqual(["a.js:1:1 no-var"]);
    expect(exitCode).toBe(1);
  });

  test("`defineConfig` can be imported from oxlint even if the package isn't installed", async () => {
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

  test("importing oxlint resolves to the installed package if there is one", async () => {
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

  test("a `!` pattern in `ignorePatterns` un-ignores a file in an ignored directory", async () => {
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

  test("a config file in a directory that a parent config ignores is still used", async () => {
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

  test("--ignore-pattern applies to the whole run, including files with a nested config", async () => {
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

  // oxlint 1.87 treats the parentheses as literal characters, so there these patterns match none of the files.
  // `@oxlint/migrate` copies them verbatim from an ESLint config.
  test("`files` and `excludeFiles` in `overrides` support `?(a|b)`, like ESLint", async () => {
    const { problems } = await lint({
      ".oxlintrc.json": JSON.stringify({
        ...noVar,
        categories: { correctness: "off" },
        overrides: [
          { files: ["**/*.?([cm])js"], rules: { "no-var": "off" } },
          { files: ["**/*.[jt]s?(x)"], excludeFiles: ["**/*.@(test|spec).*"], rules: { eqeqeq: "error" } },
        ],
      }),
      "a.js": code,
      "b.mjs": code,
      "src/c.tsx": code,
      "src/c.test.tsx": code,
    });
    expect(problems).toEqual([
      "a.js:2:7 eqeqeq",
      "src/c.test.tsx:1:1 no-var",
      "src/c.tsx:1:1 no-var",
      "src/c.tsx:2:7 eqeqeq",
    ]);
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
  ])("%j is rejected, like oxlint", async (config, why) => {
    const files = { ".oxlintrc.json": JSON.stringify(config), "a.js": code };
    const { problems, raw, stdout, exitCode } = await lint(files);
    expect(problems).toEqual([]);
    expect(stdout).toContain("Cannot use the configuration file <dir>/.oxlintrc.json:\n");
    // The message has backslashes, which `stdout` turns into slashes, so check the raw output.
    expect(raw).toContain(why);
    expect(exitCode).toBe(1);
  });

  test("accepts `overrides` patterns whose brackets and braces are closed, escaped or literal", async () => {
    const files = ["[]a]", "[!]]", "{[}]}", "\\{a", "a}", "{]}", "[{]", "a{b{c}}"];
    const config = { ...noVar, categories: { correctness: "off" }, overrides: [{ files, rules: {} }] };
    const { problems } = await lint({ ".oxlintrc.json": JSON.stringify(config), "a.js": code });
    expect(problems).toEqual(["a.js:1:1 no-var"]);
  });

  test("a JavaScript plugin can't use a built-in plugin's name", async () => {
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

  // `plugins` rejects "bun", so the note must not suggest it. oxlint 1.87 accepts a `name` in `jsPlugins`.
  test("the note about a JavaScript plugin named bun suggests a change that the config accepts", async () => {
    const rule = `{ create: () => ({}) }`;
    const files = {
      "bun.js": `export default { meta: { name: "bun" }, rules: { "no-array-just-to-count": ${rule}, own: ${rule}, other: ${rule} } };`,
      "a.js": "debugger;\n",
    };
    // The note is only printed if the run fails.
    const advice = async (config: { jsPlugins?: unknown[]; rules: object }) => {
      const rules = { ...config.rules, "no-debugger": "error" };
      const all = { categories: { correctness: "off" }, ...config, rules };
      const result = await lint({ ...files, ".oxlintrc.json": JSON.stringify(all) }, ["-f", "stylish", "a.js"]);
      expect(result.exitCode).toBe(1);
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
    // With the changes that the notes suggest, there's no note.
    expect(await advice({ rules: builtIn })).toEqual([]);
    const jsPlugins = [{ name: "bun-js", specifier: "./bun.js" }];
    expect(await advice({ jsPlugins, rules: { ...builtIn, "bun-js/own": "error" } })).toEqual([]);
  });

  test("oxlint.config.mts is read, and two oxlint config files in one directory are rejected", async () => {
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

  test("an override with an empty `files` list is accepted", async () => {
    const config = {
      ...noVar,
      categories: { correctness: "off" },
      overrides: [{ files: [], rules: { "no-var": "off" } }],
    };
    const { problems } = await lint({ ".oxlintrc.json": JSON.stringify(config), "a.js": code });
    expect(problems).toEqual(["a.js:1:1 no-var"]);
  });

  test("`options` are rejected in a nested config, and apply from an extended config", async () => {
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

  // Each row matches oxlint 1.87. It merges the rules of a file and of the files it extends into a hash table keyed by
  // plugin and rule, and applies them in the table's iteration order. `no-restricted-imports` and
  // `@typescript-eslint/no-restricted-imports` are two keys there but one rule, so the one that comes later in the
  // table wins, and that depends on what else is in the table. If two names map to the same key, the first one wins.
  test("a rule configured under two names, in a file and in the files it extends, resolves like oxlint", async () => {
    // `lines` are the reported lines of a.ts: 1 is the import that the `x` options restrict, 2 the one that the `y`
    // options restrict.
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

  test("-A, -W and -D reach a rule that's configured under two names, in a file or in the files it extends", async () => {
    const [short, long] = ["no-array-constructor", "typescript/no-array-constructor"];
    const config = (rules: Record<string, string>, ...extended: string[]) =>
      JSON.stringify({ "extends": extended, rules });
    // What oxlint 1.87.0 reports for a.ts with these flags.
    type Row = [files: Record<string, string>, flags: string[], severity: "off" | "warn" | "error"];
    const inOneFile = (severity: string) => ({
      ".oxlintrc.json": config({}, "./base.json"),
      "base.json": config({ [long]: severity, [short]: severity }),
    });
    const inTheFileAndInItsBase = (severity: string) => ({
      ".oxlintrc.json": config({ [long]: severity }, "./base.json"),
      "base.json": config({ [short]: severity }),
    });
    const inTwoFiles = (first: Record<string, string>, second: Record<string, string>) => ({
      ".oxlintrc.json": config({}, "./first.json", "./second.json"),
      "first.json": config(first),
      "second.json": config(second),
    });
    const rows: Row[] = [
      [inOneFile("warn"), [], "warn"],
      [inOneFile("warn"), ["-D", short], "error"],
      [inOneFile("warn"), ["-D", `eslint/${short}`], "error"],
      // oxlint has the rule in `eslint` only, so this name selects nothing.
      [inOneFile("warn"), ["-D", long], "warn"],
      [inOneFile("warn"), ["-A", short], "off"],
      [inOneFile("warn"), ["-A", short, "-D", short], "error"],
      [inOneFile("warn"), ["-A", "all"], "off"],
      [inOneFile("warn"), ["-A", "all", "-D", short], "error"],
      [inOneFile("error"), ["-W", short], "warn"],
      [inOneFile("error"), ["-A", short], "off"],
      [inOneFile("error"), ["-W", "pedantic"], "warn"],
      [inTheFileAndInItsBase("warn"), ["-D", short], "error"],
      [inTheFileAndInItsBase("error"), ["-W", short], "warn"],
      [inTheFileAndInItsBase("error"), ["-A", short], "off"],
      [inTwoFiles({ [short]: "warn" }, { [long]: "warn" }), ["-D", short], "error"],
      // A flag for another rule changes nothing.
      [inTwoFiles({ [long]: "error" }, { [short]: "off" }), [], "off"],
      [inTwoFiles({ [long]: "error" }, { [short]: "off" }), ["-D", "eqeqeq"], "off"],
      [inTwoFiles({ [long]: "off" }, { [short]: "error" }), [], "error"],
      [inTwoFiles({ [long]: "off" }, { [short]: "error" }), ["-D", "eqeqeq"], "error"],
    ];
    const run = async ([files, flags]: Row) => {
      const source = { "a.ts": "export const a = new Array(1, 2, 3);\n" };
      const { problems, exitCode } = await lint({ ...files, ...source }, [...flags, "a.ts"]);
      return [problems, exitCode];
    };
    const expected = { "off": [[], 0], "warn": [[`a.ts:1:18 ${short}`], 0], "error": [[`a.ts:1:18 ${short}`], 1] };
    expect(await Promise.all(rows.map(run))).toEqual(rows.map(([, , severity]) => expected[severity]));
  });

  test("`plugins` in an override apply only to that override", async () => {
    const files = Object.fromEntries(
      ["a.ts", "a.test.ts", "a.spec.test.ts"].map(name => [name, "beforeEach(() => {});\ntest('a', () => {});\n"]),
    );
    const vitestProblems = async (config: object) => {
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
        // The override's own rules can use those plugins. The top-level rules and another override's rules can't.
        vitestProblems({ plugins: [], overrides: [{ ...tests, rules: noHooks }] }),
        vitestProblems({ plugins: [], rules: noHooks, overrides: [tests] }),
        vitestProblems({ plugins: [], overrides: [tests, { ...specs, rules: noHooks }] }),
        // `categories` turn those plugins' rules on where the override applies, unless it lists every plugin that's
        // enabled there.
        vitestProblems({ plugins: ["unicorn"], ...restriction, overrides: [tests] }),
        vitestProblems({ ...restriction, overrides: [tests] }),
        vitestProblems({ plugins: [], ...restriction, overrides: [tests] }),
        vitestProblems({
          plugins: ["unicorn"],
          ...restriction,
          overrides: [{ ...tests, rules: { [timeout]: "off" } }],
        }),
        vitestProblems({ plugins: ["unicorn"], ...restriction, rules: { [timeout]: "off" }, overrides: [tests] }),
        vitestProblems({
          plugins: ["unicorn"],
          ...restriction,
          overrides: [tests, { ...specs, rules: { [timeout]: "off" } }],
        }),
      ]),
    ).toEqual([hooks, [], [], timeouts, timeouts, [], [], timeouts, timeouts]);
    // A category set on the command line doesn't affect those plugins.
    const oxlintrc = JSON.stringify({ plugins: ["unicorn"], categories: { correctness: "off" }, overrides: [tests] });
    const { problems } = await lint({ ...files, ".oxlintrc.json": oxlintrc }, [".", "-W", "restriction"]);
    expect(problems.filter(it => it.includes(" vitest/"))).toEqual([]);
  });

  // Each case matches oxlint 1.87.
  test("`categories` skip the plugins that overrides add if every matching override lists all plugins enabled for the file", async () => {
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
    const jestRule = { "jest/no-conditional-expect": "warn" };
    expect(
      await Promise.all([
        reported({ ...typescript, overrides: [tests(["typescript", "jest", "vitest"])] }),
        reported({ ...typescript, overrides: [tests(["jest", "vitest"])] }),
        // Every override that matches the file is considered, and no other.
        reported({ ...typescript, overrides: [tests(["typescript", "jest"]), tests(["typescript", "vitest"])] }),
        reported({
          ...typescript,
          overrides: [tests(["typescript", "jest"]), tests(["typescript", "vitest"], "src/**")],
        }),
        reported({ ...correctness, plugins: [], overrides: [tests(["jest"]), tests(["vitest"])] }),
        // A rule that the override itself lists is on.
        reported({ ...typescript, overrides: [{ ...tests(["typescript", "jest"]), rules: jestRule }] }),
        // An extended file without `plugins` adds typescript, unicorn and oxc.
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

  test("with `options.respectEslintDisableDirectives: false`, only oxlint-* comments apply", async () => {
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
    // The same goes for a comment that only oxlint treats as a directive. ESLint only accepts `eslint-enable` in a
    // block comment.
    const enables = { "a.js": "// eslint-enable\n// oxlint-enable\n", ".oxlintrc.json": JSON.stringify(off) };
    expect((await lint(enables, [".", "--report-unused-disable-directives"])).problems).toEqual(["a.js:2:3 -"]);
  });

  // Every row was checked against oxlint 1.87. It matches a built-in rule by the text after the last `/` in the name,
  // and reports every comment that silenced nothing, whatever the name is.
  test("a disable comment matches a built-in rule by the name after the last `/`, and is unused if it silences nothing", async () => {
    // `$` is replaced with the line number, to keep the names unique.
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
      // Rules that are off, rules of plugins that are off, and names that aren't rules.
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

  // oxlint 1.87 rejects this config: "Rule 'no-debuger' not found in plugin 'eslint'", "Plugin 'foo' not found". Bun's
  // rules come from one oxlint version, and a config written for a later version can list a newer rule, so it's only a
  // warning.
  test("warns once per name about an unknown rule that an .oxlintrc.json turns off", async () => {
    const config = {
      categories: { correctness: "off" },
      rules: {
        "no-debugger": "error",
        "no-debuger": "off",
        "foo/bar": "off",
        "unicorn/no-nul": "allow",
        "typescript/no-explicit-an": 0,
        // Not checked, because there's no list of this plugin's rules.
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

  // oxlint 1.87 fails with this message for each of the first three, before it lints anything.
  test("a JS plugin rule's options are validated for every entry in an .oxlintrc.json, even if it's off or matches no file", async () => {
    const plugin = `export default { meta: { name: "pl" }, rules: { opt: { meta: { schema: [{ enum: ["a", "b"] }] }, create: () => ({}) } } };\n`;
    const run = async (config: object) => {
      const oxlintrc = JSON.stringify({ categories: { correctness: "off" }, jsPlugins: ["./plugin.js"], ...config });
      const { stdout, stderr, exitCode } = await lint(
        { ".oxlintrc.json": oxlintrc, "plugin.js": plugin, "a.js": "a;\n" },
        ["a.js"],
      );
      const hasError = (stdout + stderr).includes(
        `Failed to setup JS plugin options:\nError: Options validation failed for rule 'pl/opt':\nOptions:\n[\n  "zzz"\n]\nErrors:\n\tValue "zzz" should be equal to one of the allowed values.`,
      );
      return [hasError, exitCode];
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

  // oxlint 1.87 prints this for each of the first five, before it lints anything.
  test("options for a JS plugin's rule that doesn't accept any are rejected, even if the rule is off", async () => {
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

  // Matches oxlint 1.87 and ESLint 10.12. oxlint uses Rust's `char::is_whitespace`, ESLint uses `\s`.
  test("whitespace around a disable comment's directive: oxlint accepts U+0085, ESLint accepts U+FEFF", async () => {
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

  // Matches oxlint 1.87 and ESLint 10.12.
  test("no-irregular-whitespace: with an oxlint config, a line separator that ends a // comment isn't reported", async () => {
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
    const positions = (problems: string[]) => problems.map(it => it.replace(" no-irregular-whitespace", ""));
    // c.js:2:1 is its second separator. This format counts lines like ESLint. oxlint's own formats print 1:11.
    expect(positions(oxlint.problems)).toEqual(["c.js:2:1", "d.js:1:3", "e.js:1:8"]);
    expect(positions(eslint.problems)).toEqual([
      "a.js:1:8",
      "b.js:1:8",
      "c.js:1:8",
      "c.js:2:1",
      "d.js:1:3",
      "e.js:1:8",
      "f.js:1:5",
    ]);
  });

  // Matches the output of oxlint 1.87, including the order.
  test("a file's problems are ordered: built-in rules by position, then JS plugins in report order, then unused disable comments", async () => {
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
  test("number_of_rules is set for a file outside the working directory, and null if the run uses two config files", async () => {
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
        // These runs use two config files.
        count("sub/in", dir => [join(dir, "other", "b.js")]),
        count("other", dir => [join(dir, "a.js"), join(dir, "sub", "c.js")]),
      ]),
    ).toEqual([1, 1, 1, 3, 1, 3, 3, null, null]);
  });

  // Each count is what oxlint 1.87 prints. In both tools the rules still run on the override's files. Only the count
  // skips them.
  test("number_of_rules doesn't count rules that categories turn on for a plugin that only an override enables", async () => {
    const base = {
      plugins: ["unicorn", "typescript", "import"],
      categories: { correctness: "warn", suspicious: "warn" },
    };
    const count = async (config: object) => {
      const files = { ".oxlintrc.json": JSON.stringify(config), "a.ts": "debugger;\n", "a.test.ts": "debugger;\n" };
      return JSON.parse((await lint(files, ["-f", "json"])).raw).number_of_rules;
    };
    const jestRule = { "jest/no-focused-tests": "error" };
    expect(
      await Promise.all([
        count(base),
        count({ ...base, overrides: [{ files: ["*.test.ts"], plugins: ["jest"] }] }),
        count({ ...base, overrides: [{ files: ["*.test.ts"], plugins: ["jest"], rules: jestRule }] }),
        count({ ...base, overrides: [{ files: ["*.nothing"], plugins: ["jest"], rules: jestRule }] }),
        count({ ...base, overrides: [{ files: ["*.ts"], plugins: ["jest", "react"] }] }),
        count({ overrides: [{ files: ["*.test.ts"], plugins: ["jest"] }] }),
      ]),
    ).toEqual([116, 116, 117, 117, 116, 96]);
  });

  // oxlint 1.87 accepts and rejects the same configs. It strips the comments, parses the rest with serde_json, and
  // deserializes that into its structs, so `null` is only valid for an `Option`, and an empty array is as good as an
  // empty struct.
  test("an .oxlintrc.json is parsed exactly as strictly as oxlint parses it", async () => {
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

  // This is what oxlint 1.87 prints below "Failed to parse oxlint config <path>.", or instead of it. It replaces
  // comments (including the line breaks in `/* */`) and a comma before a `}` or `]` with spaces, then parses the rest
  // with serde_json. Columns are in bytes.
  test("an .oxlintrc.json that isn't valid JSON is rejected with oxlint's message", async () => {
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
      const message = stdout.startsWith(start) ? stdout.slice(start.length).trimEnd() : stdout;
      return [text, message.replace("Failed to parse oxlint config <dir>/.oxlintrc.json.\n", ""), exitCode];
    };
    // `stdout` is normalized, which turns every backslash into a slash.
    expect(await Promise.all(rows.map(run))).toEqual(rows.map(([text, why]) => [text, why.replaceAll("\\", "/"), 1]));
  });

  // Matches oxlint 1.87.
  test("an override in an .oxlintrc.json can be an array of its fields, in order", async () => {
    const found = async (...fields: unknown[]) => {
      const config = { categories: { correctness: "off" }, overrides: [fields] };
      return (await lint({ ".oxlintrc.json": JSON.stringify(config), "a.js": "debugger;\n" }, ["a.js"])).problems;
    };
    const rules = { "no-debugger": "error" };
    expect(await found(["*.js"], [], null, null, null, null, rules)).toEqual(["a.js:1:1 no-debugger"]);
    expect(await found(["*.ts"], [], null, null, null, null, rules)).toEqual([]);
    expect(await found(["*.js"], ["a.js"], null, null, null, null, rules)).toEqual([]);
  });

  // Each row is what oxlint 1.87 reports. As with `JSON.parse`, the last value of a duplicate key wins.
  test("the last value of a duplicate key in an .oxlintrc.json wins", async () => {
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

  test("a disable comment for a rule that doesn't run on the file is unused, like oxlint", async () => {
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

  // Every row is what oxlint 1.87 prints. Without --type-aware it acts as if type-aware rules didn't exist.
  test("disable comments are unused with an .oxlintrc.json when the only rules left are type-aware rules", async () => {
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
      const position = (it: string) => it.split(/[: ]/).slice(1, 3).map(Number);
      return problems
        .sort((a, b) => position(a)[0] - position(b)[0] || position(a)[1] - position(b)[1])
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

  test("a warning lists the rules that a category turns on but that aren't supported yet", async () => {
    const config = {
      plugins: ["unicorn", "oxc", "react", "jsx-a11y", "jest"],
      categories: { correctness: "warn" },
    };
    const unsupportedRules = (stderr: string) =>
      /rules enabled by "categories" are not supported yet and did not run: (.*)/.exec(stderr)?.[1].split(", ") ?? [];
    const { stderr, exitCode } = await lint({ ".oxlintrc.json": JSON.stringify(config), "a.js": "export {};\n" });
    expect(exitCode).toBe(0);
    const lacking = unsupportedRules(stderr);
    // The list shrinks with each rule that gets implemented, and may end up empty.
    if (lacking.length === 0) return;
    expect(stderr).toContain(`warn: ${lacking.length} rules that the categories turn on`);
    const off = { ...config, rules: { [lacking[0]]: "off" } };
    const without = await lint({ ".oxlintrc.json": JSON.stringify(off), "a.js": "export {};\n" });
    expect(unsupportedRules(without.stderr)).toEqual(lacking.slice(1));
  });
});

// This is what oxlint 1.87 prints.
test("--print-config with an oxlint config spells each plugin's prefix in rule names like oxlint", async () => {
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

// A rule gets a duplicate key once, at its first position and with its last value, like the result of `JSON.parse`. So
// it sees the same thing whether it looks up the key or iterates over the entries.
describe.concurrent("a duplicate key in a rule's options or settings", () => {
  const plugin = `
    const show = (name, value) => console.log(name + " " + JSON.stringify(value) + " " + JSON.stringify(Object.keys(value)));
    const create = context => (show("options", context.options[0]), show("settings", context.settings.mine ?? {}), {});
    module.exports = { meta: { name: "mine" }, rules: { show: { meta: { schema: false }, create } } };\n`;
  const printed = (result: { raw: string; stderr: string }, name: string) =>
    (result.raw + result.stderr).split("\n").filter(it => it.startsWith(name + " "));

  // This is what oxlint 1.87 prints.
  test.each([
    [
      '{"size": 1, "color": "red", "size": 3, "shape": null, "size": 5}',
      '{"size":5,"color":"red","shape":null} ["size","color","shape"]',
    ],
    // The last value replaces the earlier one. Nothing is merged.
    ['{"box": {"w": 1, "h": 2}, "n": 0, "box": {"h": 3}}', '{"box":{"h":3},"n":0} ["box","n"]'],
    [
      '{"deep": {"list": [{"k": 1, "k": 2}], "list": [{"k": 3, "j": 4, "k": 5}]}}',
      '{"deep":{"list":[{"k":5,"j":4}]}} ["deep"]',
    ],
    ['{"size": "big", "size": ["small"]}', '{"size":["small"]} ["size"]'],
    ['{"size": 1, "\\u0073ize": 2}', '{"size":2} ["size"]'],
    // `__proto__` is an ordinary property here.
    [
      '{"__proto__": {"size": 1}, "color": "red", "__proto__": {"size": 2}}',
      '{"__proto__":{"size":2},"color":"red"} ["__proto__","color"]',
    ],
  ])("a JavaScript rule gets the last value from an .oxlintrc.json: %s", async (source, received) => {
    const config = `{ "jsPlugins": ["./plugin.cjs"], "settings": { "mine": ${source} }, "rules": { "mine/show": ["error", ${source}] } }`;
    const result = await lint({ ".oxlintrc.json": config, "plugin.cjs": plugin, "a.js": "export {};\n" }, ["a.js"]);
    expect(printed(result, "options")).toEqual([`options ${received}`]);
    expect(printed(result, "settings")).toEqual([`settings ${received}`]);
    expect(result.exitCode).toBe(0);
  });

  // Matches oxlint 1.87. The rule iterates over its only option, a map from a matcher's name to the message for it.
  test.each([
    ['{"toBe": "first", "toEqual": "other", "toBe": "last"}', ["2 toBe last", "3 toEqual other"]],
    ['{"toBe": "first", "toBe": null}', ["2 toBe undefined"]],
    // The first value isn't valid for this rule, but it's never validated.
    ['{"toBe": 1, "toBe": "last"}', ["2 toBe last"]],
  ])(
    "a built-in rule that iterates over the entries sees the last value from an .oxlintrc.json: %s",
    async (source, found) => {
      const files = {
        ".oxlintrc.json": `{ "plugins": ["jest"], "categories": { "correctness": "off" }, "rules": { "jest/no-restricted-matchers": ["error", ${source}] } }`,
        "a.test.js": 'test("t", () => {\n  expect(a).toBe(1);\n  expect(a).toEqual(1);\n});\n',
      };
      const { raw, exitCode } = await lint(files, ["-f", "json", "a.test.js"]);
      type Diagnostic = { message: string; help?: string; labels: { span: { line: number } }[] };
      const diagnostics: Diagnostic[] = JSON.parse(raw).diagnostics;
      const reported = diagnostics.map(it => `${it.labels[0].span.line} ${it.message.split("`")[1]} ${it.help}`);
      expect(reported).toEqual(found);
      expect(exitCode).toBe(1);
    },
  );

  // Matches oxlint 1.87 and ESLint 10.12. The outcome is `true` if the three-line file has too many lines, `false` if
  // it doesn't, and a string if the options are rejected.
  describe.each<[written: string, outcome: boolean | string]>([
    ['{"max": 1, "max": 100}', false],
    ['{"max": 100, "max": 1}', true],
    ['{"max": "many", "max": 100}', false],
    ['{"max": 100, "max": "many"}', "many"],
  ])("a built-in rule that looks up the key: %s", (source, outcome) => {
    const found = outcome === true ? ["max-lines"] : [];
    const rulesOf = (problems: string[]) => problems.map(it => it.split(" ")[1]);

    test("uses the last value from an .oxlintrc.json", async () => {
      const config = `{ "categories": { "correctness": "off" }, "rules": { "max-lines": ["error", ${source}] } }`;
      const { problems, raw, exitCode } = await lint({ ".oxlintrc.json": config, "a.js": "a;\nb;\nc;\n" }, ["a.js"]);
      expect(rulesOf(problems)).toEqual(found);
      if (typeof outcome === "string") expect(raw).toContain(`invalid type: string "${outcome}", expected u32`);
      expect(exitCode).toBe(outcome === false ? 0 : 1);
    });

    test("uses the last value from a comment", async () => {
      const files = {
        "eslint.config.mjs": "export default [{ rules: {} }];\n",
        "a.js": `/* eslint max-lines: ["error", ${source}] */\na;\nb;\n`,
      };
      const { problems, raw, exitCode } = await lint(files, ["a.js"]);
      expect(rulesOf(problems)).toEqual(outcome === false ? [] : ["max-lines"]);
      if (typeof outcome === "string") expect(raw).toContain(`Value \\"${outcome}\\" should be integer.`);
      expect(exitCode).toBe(outcome === false ? 0 : 1);
    });

    test("uses the last value from --rule", async () => {
      const files = { "eslint.config.mjs": "export default [{ rules: {} }];\n", "a.js": "a;\nb;\nc;\n" };
      const { problems, stderr, exitCode } = await lint(files, ["--rule", `max-lines: ["error", ${source}]`, "a.js"]);
      expect(rulesOf(problems)).toEqual(found);
      if (typeof outcome === "string") expect(stderr).toContain(`Value "${outcome}" should be integer.`);
      expect(exitCode).toBe(typeof outcome === "string" ? 2 : Number(outcome));
    });
  });

  // This is what ESLint 10.12 prints. It parses both with levn, which assigns each entry to an object, so `__proto__`
  // doesn't become a property.
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
  ])("a JavaScript rule, with an eslint.config.mjs: %s", (source, received) => {
    const files = {
      "eslint.config.mjs": `import mine from "./plugin.cjs";\nexport default [{ plugins: { mine } }];\n`,
      "plugin.cjs": plugin,
    };

    test("gets the last value from a comment", async () => {
      const code = `/* eslint mine/show: ["error", ${source}] */\nexport {};\n`;
      expect(printed(await lint({ ...files, "a.js": code }, ["a.js"]), "options")).toEqual([`options ${received}`]);
    });

    test("gets the last value from --rule", async () => {
      const result = await lint({ ...files, "a.js": "export {};\n" }, [
        "--rule",
        `mine/show: ["error", ${source}]`,
        "a.js",
      ]);
      expect(printed(result, "options")).toEqual([`options ${received}`]);
    });
  });

  // TOML doesn't allow duplicate keys.
  test.each([
    'max-lines = ["error", { max = 100, max = 1 }]\n',
    'max-lines = "off"\nmax-lines = ["error", { max = 1 }]\n',
    '"max-lines" = "off"\nmax-lines = ["error", { max = 1 }]\n',
  ])("a bunfig.toml is rejected: %j", async rules => {
    const { problems, stderr, exitCode } = await lint({ "bunfig.toml": `[lint.rules]\n${rules}`, "a.js": "a;\nb;\n" }, [
      "a.js",
    ]);
    expect(problems).toEqual([]);
    expect(stderr).toContain("error: Cannot redefine key");
    expect(exitCode).toBe(2);
  });

  // These are the messages of js-yaml 4, which parses these files for ESLint 8 and throws. It also parses an
  // `.eslintrc`, which can be JSON.
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
  ])("a %s is rejected", async (name, text, why) => {
    const { problems, stderr, exitCode } = await lint({ [name]: text, "a.js": "var a;\n" }, ["a.js"]);
    expect(problems).toEqual([]);
    expect(stderr).toContain(`Cannot read config file: <dir>/${name}\nError: ${why}`);
    expect(exitCode).toBe(2);
  });
});

describe.concurrent("ESLint 8 config files", () => {
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
  ])(
    "%s wins over a lower-priority config file in the same directory",
    async (first, firstText, second, secondText) => {
      const { problems } = await lint({ [first]: firstText, [second]: secondText, "a.js": code });
      expect(problems).toEqual(["a.js:2:7 eqeqeq"]);
    },
  );

  test("YAML aliases that expand to 100,000 values are read", async () => {
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
  ])("a malformed %s is an error", async (name, text) => {
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

  test("config files in parent directories also apply, up to one with `root`", async () => {
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

  test("a severity without options keeps the options from the parent directory's config", async () => {
    const { problems, exitCode } = await lint({
      ".eslintrc.json": rc({ rules: { eqeqeq: ["error", "smart"] } }),
      "sub/.eslintrc.json": JSON.stringify({ rules: { eqeqeq: "warn" } }),
      "sub/a.js": "if (x == null) {}\nif (x == 1) {}\n",
    });
    expect(problems).toEqual(["sub/a.js:2:7 eqeqeq"]);
    expect(exitCode).toBe(0);
  });

  test("`extends` loads files, also in `overrides`, and `overrides` can be nested", async () => {
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

  test("in a directory, .js files and files that `overrides` match are linted, or only the --ext extensions", async () => {
    const files = {
      ".eslintrc.json": rc({ ...eqeqeq, overrides: [{ files: ["*.one"] }] }),
      "a.js": code,
      "b.mjs": code,
      "c.one": code,
      "d.two": code,
    };
    expect((await lint(files)).problems).toEqual(["a.js:2:7 eqeqeq", "c.one:2:7 eqeqeq"]);
    // --ext replaces both.
    expect((await lint(files, ["--ext", ".two", "."])).problems).toEqual(["d.two:2:7 eqeqeq"]);
    // A file passed as an argument is linted, whatever its extension.
    expect((await lint(files, ["b.mjs", "d.two"])).problems).toEqual(["b.mjs:2:7 eqeqeq", "d.two:2:7 eqeqeq"]);
  });

  test("ignores files by default, and through `ignorePatterns`, .eslintignore, `eslintIgnore` and the command line", async () => {
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

  test("`env`, `globals` and `parserOptions` are applied", async () => {
    const { problems } = await lint({
      ".eslintrc.json": rc({
        env: { node: true },
        globals: { a: "readonly", process: "off" },
        rules: { "no-undef": "error", "no-global-assign": "error" },
        overrides: [{ files: ["module.js"], parserOptions: { ecmaVersion: 2022, sourceType: "module" } }],
      }),
      // `return` outside a function is allowed in CommonJS, which `env.node` implies.
      "script.js": "require('a'); a = 1; process; window;\nreturn;\n",
      "module.js": "import b from 'b';\nb;\n",
    });
    expect(problems).toEqual(["script.js:1:15 no-global-assign", "script.js:1:22 no-undef", "script.js:1:31 no-undef"]);
  });

  test("`/* eslint-env */` comments apply, but are an error with an eslint.config.js", async () => {
    const files = { "a.js": "/* eslint-env mocha, nonsense */\ndescribe();\nwindow;\n" };
    const legacy = await lint({ ...files, ".eslintrc.json": rc({ rules: { "no-undef": "error" } }) });
    expect(legacy.problems).toEqual(["a.js:3:1 no-undef"]);
    // The config's `globals` take precedence over the comment.
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

  test("--no-eslintrc, --env and --config work", async () => {
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
    // --config is merged with the config files that are found.
    const both = ["a.js:1:1 no-var", "a.js:2:13 no-undef", "a.js:2:7 eqeqeq"];
    expect((await lint(files, ["-c", "other.json", "a.js"])).problems).toEqual(both);
    expect((await lint(files, ["-c", "other.yml", "a.js"])).problems).toEqual(both);
  });

  test("are ignored in and below a directory with an eslint.config.js, unless ESLINT_USE_FLAT_CONFIG is false", async () => {
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

  test("built-in plugins and their configs load without installed packages", async () => {
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
  ])("%s is evaluated, and wins over %s in the same directory", async (first, second, secondText) => {
    const { problems, exitCode } = await lint({
      [first]: `module.exports = ${rc(eqeqeq)};`,
      [second]: secondText,
      "a.js": code,
    });
    expect(problems).toEqual(["a.js:2:7 eqeqeq"]);
    expect(exitCode).toBe(1);
  });

  test("an .eslintrc.js that exports null is skipped", async () => {
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

  test("`extends` loads packages, under every form of their names, and a JavaScript file", async () => {
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

  test("an .eslintrc with comments can extend a package", async () => {
    const { problems } = await lint({
      ".eslintrc": `{\n  // a comment\n  "root": true,\n  "extends": "one" /* another */\n}\n`,
      "node_modules/eslint-config-one/index.js": `module.exports = ${JSON.stringify(noVar)};`,
      "a.js": code,
    });
    expect(problems).toEqual(["a.js:1:1 no-var"]);
  });

  test("a plugin is resolved from the directory of the nested .eslintrc.json, not from the working directory", async () => {
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

  test("--resolve-plugins-relative-to sets the directory that plugins are resolved from", async () => {
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

  test("eslint:recommended is ESLint 8's, and doesn't turn off rules that aren't in it", async () => {
    const files = {
      "base.json": `{ "rules": { "no-constant-binary-expression": "error" } }`,
      "a.js": "var a = 1;\nif (a) { function f() {} f(); }\na + 1 == null;\n",
    };
    const recommendedOnly = await lint({ ...files, ".eslintrc.json": rc({ extends: ["eslint:recommended"] }) });
    expect(recommendedOnly.problems).toEqual(["a.js:2:10 no-inner-declarations"]);
    const after = await lint({ ...files, ".eslintrc.json": rc({ extends: ["./base.json", "eslint:recommended"] }) });
    expect(after.problems).toEqual(["a.js:2:10 no-inner-declarations", "a.js:3:1 no-constant-binary-expression"]);
  });

  test("with @rushstack/eslint-patch/modern-module-resolution, a plugin is resolved from the config that lists it", async () => {
    const { problems } = await lint({
      ".eslintrc.json": rc({ extends: "patched" }),
      "node_modules/eslint-config-patched/index.js": `require("@rushstack/eslint-patch/modern-module-resolution");
        module.exports = { plugins: ["inner"], rules: { "inner/no-x": "error" } };`,
      "node_modules/eslint-config-patched/node_modules/eslint-plugin-inner/index.js": `module.exports = { ${noX} };`,
      // This is what the package does when it can't find ESLint.
      "node_modules/@rushstack/eslint-patch/modern-module-resolution.js": `throw new Error("Failed to patch ESLint because the calling module was not recognized.");`,
      "a.js": code,
    });
    expect(problems).toEqual(["a.js:1:5 inner/no-x", "a.js:2:5 inner/no-x"]);
  });

  test("a package that isn't installed is never requested from a registry", async () => {
    const requested: string[] = [];
    using server = Bun.serve({
      port: 0,
      fetch(request) {
        requested.push(new URL(request.url).pathname);
        return new Response("{}", { status: 404 });
      },
    });
    const { stderr, exitCode } = await lint(
      { ".eslintrc.json": rc({ extends: "nowhere", plugins: ["nowhere"], parser: "nowhere-parser" }), "a.js": code },
      ["."],
      { env: { BUN_CONFIG_REGISTRY: server.url.href, NPM_CONFIG_REGISTRY: server.url.href } },
    );
    expect(stderr).toContain('ESLint couldn\'t find the config "nowhere" to extend from.');
    expect(requested).toEqual([]);
    expect(exitCode).toBe(2);
  });

  test("typescript-eslint's configs come from the installed version", async () => {
    const files = (version: string, configs: string) => ({
      ".eslintrc.json": rc({ extends: "plugin:@typescript-eslint/mine" }),
      "node_modules/@typescript-eslint/eslint-plugin/package.json": JSON.stringify({ version, main: "dist/index.js" }),
      // Version 8's configs are read without loading the plugin's entry point.
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

  test("a parser that bun lint replaces is resolved but not loaded, including eslint-config-next's", async () => {
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

  test("files are parsed as ES5 scripts, as in ESLint 8, unless the config says otherwise", async () => {
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

  test("ecmaVersion doesn't define globals, but an environment does", async () => {
    const files = { "a.js": "new Promise(function () {});\n" };
    const rules = { "no-undef": "error" };
    const version = await lint({ ...files, ".eslintrc.json": rc({ parserOptions: { ecmaVersion: 2022 }, rules }) });
    expect(version.problems).toEqual(["a.js:1:5 no-undef"]);
    expect((await lint({ ...files, ".eslintrc.json": rc({ env: { es6: true }, rules }) })).problems).toEqual([]);
  });

  test("environments have the globals that ESLint 8 ships with", async () => {
    const { problems } = await lint({
      ".eslintrc.json": rc({ env: { node: true, jest: true }, rules: { "no-undef": "error" } }),
      "a.js": "navigator;\nWebSocket;\nlocalStorage;\npit;\nfdescribe;\nIntl;\nprocess;\nstructuredClone;\n",
      "b.js": "/* eslint-env worker */\nCSSImageValue;\nimportScripts;\nWebSocket;\nreportError;\n",
    });
    expect(problems).toEqual(["a.js:1:1 no-undef", "a.js:2:1 no-undef", "a.js:3:1 no-undef", "b.js:2:1 no-undef"]);
  });

  test("a rule that ESLint 8 doesn't have is reported in every file", async () => {
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

  test("`noInlineConfig` warns about each directive comment and names the config file", async () => {
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

  test("the whole config is validated, even overrides for other files, with ESLint 8's messages", async () => {
    const { stderr, exitCode } = await lint({
      ".eslintrc.json": rc({ overrides: [{ files: ["*.ts"], rules: { eqeqeq: ["error", "sometimes"] } }] }),
      "a.js": code,
    });
    expect(stderr).toContain(".eslintrc.json#overrides[0]:");
    expect(stderr).toContain('Configuration for rule "eqeqeq" is invalid:');
    expect(stderr).toContain('Value "sometimes" should be equal to one of the allowed values.');
    expect(exitCode).toBe(2);
  });

  test("a missing plugin or parser is an error only for the files it applies to", async () => {
    const { problems, exitCode } = await lint({
      ".eslintrc.json": rc({ ...eqeqeq, overrides: [{ files: ["b.js"], plugins: ["nowhere"], parser: "nowhere" }] }),
      "a.js": code,
    });
    expect(problems).toEqual(["a.js:2:7 eqeqeq"]);
    expect(exitCode).toBe(1);
  });

  test("`eslint:all` is ESLint 8.57.1's", async () => {
    const { problems } = await lint({
      ".eslintrc.json": rc({ extends: "eslint:all", env: { es6: true } }),
      "a.js": "var one = new Symbol(), two = new Object();\n",
    });
    // Rules that were already deprecated in 8.57.1 aren't in it.
    expect(problems).toContain("a.js:1:15 no-new-symbol");
    expect(problems.filter(it => it.endsWith("no-new-object"))).toEqual([]);
  });

  test("typescript-eslint's default options are those of the installed major version", async () => {
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
    // `caughtErrors` defaults to "none" before version 8.
    const old = await lint(installed("7.18.0"));
    expect(old.problems).toEqual([]);
    // The note is printed once, on stderr so it stays out of the formatter's output, and it doesn't fail the run.
    expect(old.stderr.split("typescript-eslint 7.18.0 is installed.").length).toBe(2);
    expect(old.stdout).not.toContain("is installed.");
    expect(old.exitCode).toBe(0);
    expect((await lint(installed("7.18.0"), ["--quiet", "."])).stderr).toContain("is installed.");
    expect((await lint(installed("5.62.0"))).problems).toEqual([]);
    // Version 8 started reporting variables that are only used as types.
    const typeOnly = { "a.ts": "const a = 1;\nexport type A = typeof a;\n" };
    expect((await lint({ ...installed("7.18.0"), ...typeOnly }, ["a.ts"])).problems).toEqual([]);
    expect((await lint({ ...installed("8.0.0"), ...typeOnly }, ["a.ts"])).problems).toEqual([
      "a.ts:1:7 @typescript-eslint/no-unused-vars",
    ]);
    const current = await lint(installed("8.0.0"));
    expect(current.problems).toEqual(["a.js:1:21 @typescript-eslint/no-unused-vars"]);
    expect(current.stderr).not.toContain("is installed.");
  });

  test("options that only typescript-eslint versions before 8 accept are rejected with version 8 installed", async () => {
    const installed = (version: string, rules: object) => ({
      ".eslintrc.json": rc({ plugins: ["@typescript-eslint"], rules }),
      "node_modules/@typescript-eslint/eslint-plugin/package.json": JSON.stringify({ version, main: "index.js" }),
      "node_modules/@typescript-eslint/eslint-plugin/index.js": "module.exports = { rules: {}, configs: {} };",
      "a.js": "",
    });
    const acceptedBy5 = {
      "@typescript-eslint/restrict-plus-operands": ["off", { checkCompoundAssignments: true }],
      "@typescript-eslint/explicit-module-boundary-types": ["error", { shouldTrackReferences: true }],
    };
    const acceptedBy7 = {
      "@typescript-eslint/no-empty-object-type": ["error", { allowObjectTypes: "in-type-alias-with-name" }],
    };
    expect((await lint(installed("5.62.0", acceptedBy5))).exitCode).toBe(0);
    expect((await lint(installed("7.18.0", acceptedBy7))).exitCode).toBe(0);
    for (const rules of [acceptedBy5, acceptedBy7]) {
      const { stderr, exitCode } = await lint(installed("8.0.0", rules));
      expect(stderr).toContain("is invalid:");
      expect(exitCode).toBe(2);
    }
  });

  test("--print-config prints only the rules that the config files set", async () => {
    const files = { ".eslintrc.json": rc({ rules: { eqeqeq: "error" } }), "a.js": "" };
    const { stdout } = await lint(files, ["--print-config", "a.js"]);
    expect(Object.keys(JSON.parse(stdout).rules)).toEqual(["eqeqeq"]);
  });

  // oracle/driver/eslintrc-cli.expected.json has ESLint 8.57.1's result for each row, recorded by eslintrc-cli.mjs in
  // that directory. eslintrc-cli.differences.json lists the rows where `bun lint` behaves differently, and how.
  const rows = rowsOfESLint8.filter(it => !(it.posix && isWindows));
  // Each row starts two processes, which is too slow for a debug build. Each test runs four rows because eight take too
  // long on a busy machine.
  for (let start = 0; start < rows.length; start += 4) {
    const some = rows.slice(start, start + 4);
    test.skipIf(isDebug || isASAN)(
      `matches ESLint 8.57.1: ${some[0].name} ..`,
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
          const expected = expectedFromESLint8[row.name as keyof typeof expectedFromESLint8];
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

describe.concurrent("which tool's config files are used", () => {
  test("with a root .oxlintrc.json, an eslint.config.js in a subdirectory isn't read", async () => {
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

  test("with a root .oxlintrc.json, an ESLint 8 config file in a subdirectory isn't read", async () => {
    const { problems, exitCode } = await lint({
      ".oxlintrc.json": JSON.stringify({ categories: { correctness: "off" }, rules: { "no-var": "error" } }),
      "a.js": code,
      "sub/.eslintrc": "not: [valid",
      "sub/b.js": code,
    });
    expect(problems).toEqual(["a.js:1:1 no-var", "sub/b.js:1:1 no-var"]);
    expect(exitCode).toBe(1);
  });

  // Examples, fixtures and templates often have leftover ESLint config files.
  test("an ESLint config that can't be loaded doesn't fail the run below an .oxlintrc.json, even one above the working directory", async () => {
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

  test("with a root eslint.config.js, an .oxlintrc.json in a subdirectory isn't read", async () => {
    const { problems } = await lint({
      "eslint.config.js": `module.exports = [{ rules: { "no-var": "error" } }];`,
      "a.js": code,
      "sub/.oxlintrc.json": "not JSON",
      "sub/b.js": code,
    });
    expect(problems).toEqual(["a.js:1:1 no-var", "sub/b.js:1:1 no-var"]);
  });

  test("if the working directory has no config file, each subdirectory's own config file picks the tool", async () => {
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
  test("the oxlint config wins over an ESLint config, and a single note mentions it", async () => {
    const { problems, stderr, exitCode } = await lint(both, ["a.js", "sub/b.js"]);
    expect(problems).toEqual(["a.js:2:7 eqeqeq"]);
    expect(stderr).toBe(ignores("eslint.config.js"));
    expect(exitCode).toBe(1);
    // Even if the ESLint config is closer to the file than the oxlint config.
    const { "sub/.oxlintrc.json": _, ...above } = both;
    const below = await lint(above, ["b.js"], { cwd: "sub" });
    expect(below.problems).toEqual(["sub/b.js:2:7 eqeqeq"]);
    expect(below.stderr).toBe(ignores("eslint.config.js", "../.oxlintrc.json"));
    expect(below.exitCode).toBe(1);
    expect((await lint(both, ["--silent", "a.js"])).stderr).toBe("");
    expect((await lint(both, ["--nonsense"])).exitCode).toBe(1);
  });

  describe("a package with both configs in a repository without a root config", () => {
    const files = {
      "package.json": `{ "workspaces": ["packages/*"] }`,
      "packages/app/.oxlintrc.json": oxlintrc({ eqeqeq: "error" }),
      "packages/app/eslint.config.js": `module.exports = [{ rules: { "no-var": "error" } }];`,
      "packages/app/src/a.js": code,
    };
    const absolute = (dir: string) => [join(dir, "packages", "app", "src", "a.js")];

    // Rows are padded with `undefined` because a row shorter than the parameter list gets `done` as the next argument.
    test.each<[cwd: string, args: string[], up: string, more: Options["args"]]>([
      [".", ["."], "packages/app/", undefined],
      [".", ["packages/app"], "packages/app/", undefined],
      [".", ["packages/app/src/a.js"], "packages/app/", undefined],
      [".", [], "packages/app/", absolute],
      ["packages", ["app"], "app/", undefined],
      ["packages/app", ["."], "", undefined],
      ["packages/app", [], "", absolute],
      ["packages/app/src", ["a.js"], "../", undefined],
    ])("the oxlint config wins in %s with %j", async (cwd, args, up, more) => {
      const { problems, stderr, exitCode } = await lint(files, args, { cwd, args: more });
      expect(problems).toEqual(["packages/app/src/a.js:2:7 eqeqeq"]);
      expect(stderr).toContain(ignores(`${up}eslint.config.js`, `${up}.oxlintrc.json`));
      expect(exitCode).toBe(1);
    });

    test("--print-config prints the oxlint config from the root and from the package", async () => {
      const [fromRoot, fromPackage] = await Promise.all([
        lint(files, ["--print-config", "packages/app/src/a.js"]),
        lint(files, ["--print-config", "src/a.js"], { cwd: "packages/app" }),
      ]);
      expect(fromRoot.raw).toContain(`"eqeqeq": "deny"`);
      expect(fromRoot.raw).toBe(fromPackage.raw);
    });

    test("prints a note for each package with both configs", async () => {
      const copy = Object.entries(files).map(([name, text]) => [name.replace("/app/", "/web/"), text]);
      const { problems, stderr } = await lint({ ...files, ...Object.fromEntries(copy) });
      expect(problems).toEqual(["packages/app/src/a.js:2:7 eqeqeq", "packages/web/src/a.js:2:7 eqeqeq"]);
      const notes = ["app", "web"].map(it =>
        ignores(`packages/${it}/eslint.config.js`, `packages/${it}/.oxlintrc.json`),
      );
      expect(stderr).toContain(notes.join("\n"));
    });

    test.each([
      [".", ["."]],
      [".", ["packages/app/fixtures/b.js"]],
      ["packages/app", ["."]],
    ])("ignores ESLint configs below the oxlint config in %s with %j", async (cwd, args) => {
      const { "packages/app/eslint.config.js": _, ...rest } = files;
      const below = {
        ...rest,
        "packages/app/fixtures/eslint.config.js": `import "a-package-that-is-not-installed";`,
        "packages/app/fixtures/b.js": code,
        "packages/app/fixtures/old/.eslintrc": "not: [valid",
        "packages/app/fixtures/old/c.js": code,
      };
      const { problems, exitCode } = await lint(below, args, { cwd });
      expect(problems).toContain("packages/app/fixtures/b.js:2:7 eqeqeq");
      expect(problems.filter(it => !it.endsWith(" eqeqeq"))).toEqual([]);
      expect(exitCode).toBe(1);
    });

    test("a sibling package with only an ESLint config still uses it", async () => {
      const { problems } = await lint({
        ...files,
        "packages/old/eslint.config.js": files["packages/app/eslint.config.js"],
        "packages/old/a.js": code,
      });
      expect(problems).toEqual(["packages/app/src/a.js:2:7 eqeqeq", "packages/old/a.js:1:1 no-var"]);
    });
  });

  const [eslintConfig, oxlintConfig, legacy] = [
    both["eslint.config.js"],
    oxlintrc({ "no-debugger": "error" }),
    rc(noVar),
  ];
  const asModule = eslintConfig.replace("module.exports =", "export default");
  test.each([
    ["eslint.config.js", eslintConfig, "no-var"],
    ["eslint.config.mjs", asModule, "no-var"],
    ["eslint.config.cjs", eslintConfig, "no-var"],
    ["eslint.config.ts", asModule, "no-var"],
    ["eslint.config.mts", asModule, "no-var"],
    ["eslint.config.cts", eslintConfig, "no-var"],
    ["mine.js", eslintConfig, "no-var"],
    [".oxlintrc.json", oxlintConfig, "no-debugger"],
    [".oxlintrc.jsonc", `// Mine.\n${oxlintConfig}`, "no-debugger"],
    ["oxlint.config.ts", `export default ${oxlintConfig};`, "no-debugger"],
    ["oxlint.config.mts", `export default ${oxlintConfig};`, "no-debugger"],
    ["vite.config.ts", `export default { lint: ${oxlintConfig} };`, "no-debugger"],
    ["mine.json", oxlintConfig, "no-debugger"],
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
    // These are oxlint's defaults.
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
  ])("--flavor=%s uses that tool's config and prints no note", async (flavor, expected) => {
    const { problems, stderr } = await lint(both, [`--flavor=${flavor}`, "a.js", "sub/b.js"]);
    expect(problems).toEqual(expected);
    expect(stderr).not.toContain("is ignored");
  });

  test("--flavor rejects anything but eslint and oxlint", async () => {
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

  test("without a config file, the dependencies in package.json pick the tool", async () => {
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

  test("with an .eslintrc.json, --config with an oxlint config replaces it, and with an ESLint 8 config adds to it", async () => {
    const files = {
      ".eslintrc.json": JSON.stringify({ extends: "not-installed" }),
      "mine.json": oxlintrc({ "no-var": "error" }),
      "plain.json": JSON.stringify({ rules: { "no-var": "error" } }),
      "a.js": code,
    };
    expect((await lint(files, ["-c", "mine.json", "a.js"])).problems).toEqual(["a.js:1:1 no-var"]);
    // A file that could be either tool's is treated as an oxlint config.
    const plain = ["a.js:1:1 no-var", "a.js:2:13 no-debugger"];
    expect((await lint(files, ["-c", "plain.json", "a.js"])).problems).toEqual(plain);
    expect((await lint(files, ["-c", "plain.json", "--disable-nested-config", "a.js"])).problems).toEqual(plain);
    expect((await lint({ ...files, ".eslintrc.js": "throw 1;" }, ["-c", "plain.json", "."])).problems).toEqual(plain);
    // A file with a key that only ESLint 8 has is an ESLint 8 config, so it's used in addition to the .eslintrc.json.
    const legacy = await lint({ ...files, "legacy.json": JSON.stringify({ parserOptions: {} }) }, [
      "-c",
      "legacy.json",
      "a.js",
    ]);
    expect(legacy.stderr).toContain("not-installed");
  });

  test("Vite+: the `lint` field of vite.config.ts is the oxlint config", async () => {
    const lintField = (rule: string) => `lint: { categories: { correctness: "off" }, rules: { "${rule}": "error" } }`;
    const files = {
      "package.json": JSON.stringify({ devDependencies: { "vite-plus": "*" } }),
      "vite.config.ts": `import { defineConfig } from "vite-plus";\nexport default defineConfig({ ${lintField("no-var")} });`,
      "a.js": code,
      "packages/own/vite.config.ts": `export default ({ command }) => ({ ${lintField("eqeqeq")}, command });`,
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
    const withConfigFlag = await lint(files, ["-c", "packages/silent/vite.config.ts", "a.js"]);
    expect(withConfigFlag.stderr).toContain(
      "Expected a `lint` field in the default export of <dir>/packages/silent/vite.config.ts",
    );
    expect(withConfigFlag.exitCode).not.toBe(0);
    // If there's an oxlint config file, it's used and the vite.config.ts files aren't.
    const withFile = await lint({ ...files, ".oxlintrc.json": oxlintrc({ "no-debugger": "error" }) }, [
      "a.js",
      "packages/own/b.js",
    ]);
    expect(withFile.problems).toEqual(["a.js:2:13 no-debugger", "packages/own/b.js:2:13 no-debugger"]);
  });

  describe("the config file that's found picks the tool, regardless of flags", () => {
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
    // Expected: the ESLint config's rules, the oxlint config's rules, oxlint's defaults, Bun's defaults, no rules.
    const [eslintResult, oxlintResult] = [[["a.js:1:1 no-var"], 1] as const, [["a.js:2:7 eqeqeq"], 1] as const];
    const [defaults, builtIn] = [[["a.js:2:13 no-debugger"], 0] as const, [["a.js:2:13 no-debugger"], 1] as const];
    const [nothing, failsSilently] = [[[], 0] as const, [[], 1] as const];
    const rejects = (flag: string, tool: string, where: string) =>
      [[], 2, `error: ${flag} is an ${tool} flag and has no effect here\n  This run uses ${where}.`] as const;
    const withFlat = "eslint.config.js, an ESLint config";
    const withLegacy = ".eslintrc.json, an ESLint 8 config";
    const withOxlint = ".oxlintrc.json, an oxlint config";

    test.each<[keyof typeof projects, string[], readonly [readonly string[], number, string?]]>([
      ["eslint.config.js", [], eslintResult],
      ["eslint.config.js", ["--silent"], failsSilently],
      ["eslint.config.js", ["--silent", "-f", "unix"], failsSilently],
      ["eslint.config.js", ["--deny-warnings"], eslintResult],
      ["eslint.config.js", ["--disable-nested-config"], eslintResult],
      ["eslint.config.js", ["--fix-suggestions"], eslintResult],
      ["eslint.config.js", ["-D", "eqeqeq"], [["a.js:1:1 no-var", "a.js:2:7 eqeqeq"], 1]],
      ["eslint.config.js", ["-W", "no-var"], [["a.js:1:1 no-var"], 0]],
      ["eslint.config.js", ["-A", "no-var"], nothing],
      ["eslint.config.js", ["-A", "no-var", "--rule", "no-var: error"], eslintResult],
      ["eslint.config.js", ["-D", "correctness"], rejects("-D correctness", "oxlint", withFlat)],
      ["eslint.config.js", ["-A", "all"], rejects("-A all", "oxlint", withFlat)],
      ["eslint.config.js", ["--import-plugin"], rejects("--import-plugin", "oxlint", withFlat)],
      ["eslint.config.js", ["--disable-oxc-plugin"], rejects("--disable-oxc-plugin", "oxlint", withFlat)],
      ["eslint.config.js", ["--env", "browser"], rejects("--env browser", "ESLint 8", withFlat)],
      ["eslint.config.js", ["--rulesdir", "rules"], rejects("--rulesdir rules", "ESLint 8", withFlat)],
      ["eslint.config.js", ["--no-eslintrc"], rejects("--no-eslintrc", "ESLint 8", withFlat)],
      [
        "eslint.config.js",
        ["--resolve-plugins-relative-to", "."],
        rejects("--resolve-plugins-relative-to .", "ESLint 8", withFlat),
      ],
      ["eslint.config.js", ["--eslintrc"], eslintResult],
      ["eslint.config.js", ["--flavor=oxlint"], defaults],
      ["eslint.config.js and [lint.categories]", [], eslintResult],

      [".eslintrc.json", ["--silent"], failsSilently],
      [".eslintrc.json", ["--deny-warnings"], eslintResult],
      [".eslintrc.json", ["-A", "no-var"], nothing],
      [".eslintrc.json", ["-A", "all"], rejects("-A all", "oxlint", withLegacy)],
      [".eslintrc.json", ["--react-plugin"], rejects("--react-plugin", "oxlint", withLegacy)],
      [".eslintrc.json", ["--env", "browser"], eslintResult],
      [".eslintrc.json", ["--flavor=oxlint"], defaults],

      [".oxlintrc.json", ["--silent"], failsSilently],
      [".oxlintrc.json", ["--cache"], oxlintResult],
      [".oxlintrc.json", ["--stats"], oxlintResult],
      [".oxlintrc.json", ["--rule", "no-var: error"], [["a.js:1:1 no-var", "a.js:2:7 eqeqeq"], 1]],
      [".oxlintrc.json", ["--ext", ".js"], rejects("--ext .js", "ESLint", withOxlint)],
      [".oxlintrc.json", ["--parser", "espree"], rejects("--parser espree", "ESLint", withOxlint)],
      [
        ".oxlintrc.json",
        ["--report-unused-inline-configs", "error"],
        rejects("--report-unused-inline-configs error", "ESLint", withOxlint),
      ],
      [".oxlintrc.json", ["--env", "browser"], rejects("--env browser", "ESLint 8", withOxlint)],
      [".oxlintrc.json", ["--rulesdir", "rules"], rejects("--rulesdir rules", "ESLint 8", withOxlint)],
      [".oxlintrc.json", ["--no-eslintrc"], rejects("--no-eslintrc", "ESLint 8", withOxlint)],
      [".oxlintrc.json", ["--flavor=eslint"], builtIn],
      [".oxlintrc.json and [lint] ext", [], oxlintResult],

      ["no file", [], builtIn],
      ["no file", ["--silent"], failsSilently],
      ["no file", ["--deny-warnings"], builtIn],
      ["no file", ["--disable-nested-config"], builtIn],
      ["no file", ["-D", "correctness"], builtIn],
      ["no file", ["--import-plugin"], rejects("--import-plugin", "oxlint", "Bun's defaults")],
      ["no file", ["--fix-suggestions"], builtIn],
      ["no file", ["--fix-dangerously"], builtIn],
      ["no file", ["--type-check"], builtIn],
      // Only ESLint 8 has --env, so this is an ESLint 8 run, which has no rules on.
      ["no file", ["--env", "browser"], nothing],
      ["no file", ["--flavor=eslint", "--import-plugin"], rejects("--import-plugin", "oxlint", "Bun's defaults")],
      ["no file", ["--flavor=oxlint", "--env", "browser"], rejects("--env browser", "ESLint 8", "oxlint's defaults")],
      ["the dependency", [], defaults],
      ["the dependency", ["--cache"], defaults],
      ["the dependency", ["--parser", "espree"], rejects("--parser espree", "ESLint", "oxlint's defaults")],
      ["both", [], [...oxlintResult, ignores("eslint.config.js")]],
      [".eslintrc.json and .oxlintrc.json", [], [...oxlintResult, ignores(".eslintrc.json")]],
      ["both", ["--silent"], failsSilently],
      ["both", ["--deny-warnings"], oxlintResult],
      ["both", ["--cache"], oxlintResult],
      ["both", ["--ext", ".js"], rejects("--ext .js", "ESLint", withOxlint)],
      ["both", ["--env", "browser"], rejects("--env browser", "ESLint 8", withOxlint)],

      ["eslint.config.js and the dependency", [], eslintResult],
      ["eslint.config.js and the dependency", ["--silent"], failsSilently],
      [
        "eslint.config.js and the dependency",
        ["--deny-warnings", "-D", "correctness"],
        rejects("-D correctness", "oxlint", withFlat),
      ],
      ["eslint.config.js and the dependency", ["--cache"], eslintResult],
      ["eslint.config.js and the dependency", ["--rules"], nothing],

      ["files by other names", ["-c", "mine.js", "--threads", "8"], eslintResult],
      ["files by other names", ["-c", "mine.json", "--threads", "8"], oxlintResult],
      ["files by other names", ["-c", "mine.js", "--threads", "8", "--silent"], failsSilently],
      ["files by other names", ["-c", "mine.json", "--threads", "8", "--silent"], failsSilently],
      ["files by other names", ["-c", "mine.js", "-A", "no-var"], nothing],
      ["files by other names", ["-c", "mine.json", "-A", "eqeqeq"], nothing],
      [
        "files by other names",
        ["-c", "mine.js", "--import-plugin"],
        rejects("--import-plugin", "oxlint", "mine.js, an ESLint config"),
      ],
      [
        "files by other names",
        ["-c", "mine.json", "--ext", ".js"],
        rejects("--ext .js", "ESLint", "mine.json, an oxlint config"),
      ],
    ])("project with %s, flags %j", async (project, flags, [problems, exitCode, error]) => {
      const run = await lint({ ...projects[project], "a.js": code }, [...flags, "a.js"]);
      expect([run.problems, run.exitCode]).toEqual([[...problems], exitCode]);
      if (error !== undefined) expect(run.stderr).toEndWith(error);
    });

    test("even if it's found in a parent directory", async () => {
      const files = { ...flat, "sub/a.js": code };
      expect((await lint(files, ["--silent", "a.js"], { cwd: "sub" })).exitCode).toBe(1);
      expect((await lint(files, ["--deny-warnings", "a.js"], { cwd: "sub" })).problems).toEqual([
        "sub/a.js:1:1 no-var",
      ]);
    });

    test("even if it's in a subdirectory and the working directory has none", async () => {
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
      for (const [flags, message, uses] of [
        [["--env", "browser"], "--env browser is an ESLint 8 flag and has no effect here", withFile],
        [["--no-eslintrc"], "--no-eslintrc is an ESLint 8 flag and has no effect here", withFile],
        [["--import-plugin"], "--import-plugin is an oxlint flag and has no effect here", "Bun's defaults."],
      ] as const) {
        for (const args of [["."], ["one/a.js"]]) {
          const { problems, stderr, exitCode } = await lint(one, [...flags, ...args]);
          expect({ problems, stderr, exitCode }).toEqual({
            problems: [],
            stderr: `error: ${message}\n  This run uses ${uses}`,
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

    test("-D keeps the rule options from the config file", async () => {
      const files = {
        "eslint.config.js": `module.exports = [{ rules: { eqeqeq: ["off", "always", { null: "ignore" }] } }];`,
        "a.js": "x == null;\nx == 1;\n",
      };
      expect((await lint(files, ["-D", "eqeqeq", "a.js"])).problems).toEqual(["a.js:2:3 eqeqeq"]);
    });

    test("--print-config prints the ESLint config", async () => {
      const { raw, exitCode } = await lint({ ...flat, "a.js": code }, ["--print-config", "a.js", "--silent"]);
      expect(JSON.parse(raw).rules).toEqual({ "no-var": [2] });
      expect(exitCode).toBe(0);
    });

    test("an oxlint flag doesn't cause an .oxlintrc.json below an ESLint 8 config file to be read", async () => {
      const files = { ".eslintrc.json": rc(noVar), "sub/.oxlintrc.json": "not JSON", "sub/a.js": code };
      expect((await lint(files, ["--deny-warnings", "sub/a.js"])).problems).toEqual(["sub/a.js:1:1 no-var"]);
    });
  });
});

describe.concurrent("oxlint's command line", () => {
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
  ])(
    "%j is rejected, and the exit code is 1 with an .oxlintrc.json and 2 with an eslint.config.js",
    async (args, why) => {
      const forOxlint = await lint({ ".oxlintrc.json": oxlintrc, "a.js": code }, args);
      // oxlint prints config errors on stdout and command-line errors on stderr.
      expect(args[0] === "-c" ? forOxlint.stdout : forOxlint.stderr).toContain(why);
      expect(forOxlint.problems).toEqual([]);
      expect(forOxlint.exitCode).toBe(1);
      const forEslint = await lint({ "eslint.config.js": "module.exports = [];", "a.js": code }, args);
      expect(forEslint.stderr).toContain(why);
      expect(forEslint.exitCode).toBe(2);
    },
  );

  test("a run that uses oxlint because of --config or package.json also exits with 1", async () => {
    const broken = { "broken.json": "{", "a.js": code };
    expect((await lint(broken, ["-c", "broken.json"])).exitCode).toBe(1);
    const files = { "package.json": JSON.stringify({ devDependencies: { oxlint: "*" } }), "a.js": code };
    expect((await lint(files, ["--type-check"])).exitCode).toBe(1);
    // --type-check works on its own without a config file.
    expect((await lint({ "a.js": code }, ["--type-check"])).problems).toEqual(["a.js:2:13 no-debugger"]);
  });

  test("an .oxlintrc.json that can't be parsed exits with 1", async () => {
    const { exitCode } = await lint({ ".oxlintrc.json": "{", "a.js": code });
    expect(exitCode).toBe(1);
  });

  test("--type-check and `options.typeCheck` report type errors", async () => {
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
    const withoutTypeAware = await lint({ ...files, ".oxlintrc.json": oxlintrc }, ["--type-check"]);
    expect(withoutTypeAware.stdout).toContain("The `--type-check` option requires type-aware linting.");
    expect(withoutTypeAware.exitCode).toBe(1);
  });

  // These are oxlint 1.87.0's messages.
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
    // `stdout` has its backslashes normalized, and one of these messages contains backslashes.
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
  ])("an option value that oxlint accepts isn't a config error: %j", async config => {
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

  test("--print-config output matches oxlint's", async () => {
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

  test("--threads=0 is accepted", async () => {
    const { problems, exitCode } = await lint({ ".oxlintrc.json": oxlintrc, "a.js": code }, ["--threads=0"]);
    expect(problems).toEqual(["a.js:1:1 no-var"]);
    expect(exitCode).toBe(0);
  });

  test("--ignore-path sets the file that's read instead of .eslintignore", async () => {
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

  // Matches oxlint 1.87.0, which passes the value to the `ignore` crate as a file name to look for.
  describe("--ignore-path", () => {
    const [x, y, z, top] = ["packages/a/generated/x.js", "packages/a/src/y.js", "rest/z.js", "top.js"];
    const tree = { ".oxlintrc.json": oxlintrc, [x]: code, [y]: code, [z]: code, [top]: code };
    /** Returns the linted files. `$` in an argument is replaced with the directory that holds `tree`. */
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
      // The --ignore-path file wins even if the .gitignore is closer.
      [{ ".mine": "y.js\n", "packages/a/.gitignore": "!y.js\n" }, [x, z, top]],
      [{ ".mine": "!y.js\n", "packages/a/.gitignore": "y.js\n" }, [x, y, z, top]],
    ])("the closest file wins, and all of them take precedence over .gitignore: %j", async (files, expected) => {
      expect(await linted(files, ["--ignore-path", ".mine", "."])).toEqual(expected);
    });

    test(".eslintignore also takes precedence over .gitignore", async () => {
      const files = { ".eslintignore": "y.js\n", "packages/a/.gitignore": "!y.js\n" };
      expect(await linted(files, ["."])).toEqual([x, z, top]);
    });

    test.each([
      [{ ".mine": "src/\n" }, ["--ignore-path", ".mine", "a"], "packages", [x]],
      [{ ".mine": "src/\n" }, ["--ignore-path", ".mine"], "packages/a", [x]],
      [{ ".mine": "src/\n", "packages/a/.git/HEAD": "" }, ["--ignore-path", ".mine"], "packages/a", [x]],
      [{ ".eslintignore": "src/\n", "packages/a/.git/HEAD": "" }, ["packages/a"], ".", [x]],
    ])(
      "files in parent directories of the search root are read too, even above a repository root: %j %j",
      async (files, args, cwd, expected) => {
        expect(await linted(files, args, cwd)).toEqual(expected);
      },
    );

    // From the search root down, the crate looks for the name among each directory's entries. In parent directories, it
    // joins the value to the directory.
    test.each([
      [{ ".mine": "rest/\n" }, ["./.mine", "."], [x, y, z, top]],
      [{ "packages/a/.mine": "generated/\n" }, ["packages/a/.mine", "."], [x, y, z, top]],
      [{ ".mine": "/rest/\n" }, ["$/.mine", "."], [x, y, z, top]],
      [{ "packages/a/.mine": "/a/src/\n" }, ["a/.mine", "packages/a"], [x]],
      [{ ".mine": "/a/src/\n" }, ["$/.mine", "packages/a"], [x]],
    ])(
      "a value that's a path is only found in parent directories of the search root: %j %j",
      async (files, args, expected) => {
        expect(await linted(files, ["--ignore-path", ...args])).toEqual(expected);
      },
    );

    test.each([
      [{ ".eslintignore": "/top.js\n" }, ["$/top.js", z], [z, top]],
      [{ ".mine": "rest/*\n" }, ["--ignore-path", ".mine", "$/rest/z.js", top], [z, top]],
      [{ "packages/a/.mine": "top.js\nrest/z.js\n" }, ["--ignore-path", "packages/a/.mine", top, z, x], [x]],
      [{ "packages/a/.mine": "/generated/x.js\n" }, ["--ignore-path", "$/packages/a/.mine", x, top], [x, top]],
    ])(
      "patterns are matched against a file passed as an argument exactly as it's written: %j %j",
      async (files, args, expected) => {
        expect(await linted(files, args)).toEqual(expected);
      },
    );
  });

  test("node_modules is linted like any other directory unless a .gitignore lists it", async () => {
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

describe.concurrent("a config that asks for something unsupported", () => {
  const files = {
    // ESLint 8 has require-jsdoc and valid-jsdoc. ESLint 9 removed them.
    ".eslintrc.json": rc({
      env: { es6: true },
      rules: { "no-var": "error", "require-jsdoc": "warn", "valid-jsdoc": "error", "no-rule-that-is-off": "off" },
    }),
    "a.js": code,
  };

  test("an unsupported rule fails the run, and everything else is linted", async () => {
    const { problems, stderr, exitCode } = await lint(files);
    expect(problems).toEqual(["a.js:1:1 no-var"]);
    expect(stderr).toContain("2 rules in your .eslintrc config are not supported: require-jsdoc, valid-jsdoc");
    expect(stderr).not.toContain("no-rule-that-is-off");
    expect(stderr).toContain("\n  Everything else was linted. Use --allow-unsupported to make this a warning.");
    expect(exitCode).toBe(2);
  });

  test("an unsupported rule fails the run even if nothing else is wrong", async () => {
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

  test("files in a language that only a plugin can parse aren't linted, and the run fails", async () => {
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
      "4 files were not linted because they need eslint, which is not installed (3 *.one, 1 *.two): b.one, c.one, d.one, ..\n  Run bun add -d eslint",
    );
    expect(exitCode).toBe(2);
    expect((await lint(files, ["--allow-unsupported", "."])).exitCode).toBe(1);
  });

  // Windows doesn't allow these file names.
  test.skipIf(isWindows)("escapes control characters in printed file names", async () => {
    const files = {
      "eslint.config.mjs": `export default [
        { files: ["**/*.one"], plugins: { p: { languages: { l: {} } } }, language: "p/l" },
      ];`,
      "b\x1b[31m.one": "",
      "c\nd.one": "",
    };
    const { stderr, exitCode } = await lint(files);
    // The `lint` helper normalizes stderr, which turns every backslash into a slash.
    expect(stderr).toContain(
      "2 files were not linted because they need eslint, which is not installed (2 *.one): b/x1b[31m.one, c/nd.one\n  Run bun add -d eslint",
    );
    expect(exitCode).toBe(2);
  });
});

// ESLint deprecated its formatting rules, and eslint-plugin-react deprecated `jsx-space-before-closing`. They aren't
// built in because `bun fmt` does their job, but shared configs still turn them on.
describe.concurrent("deprecated formatting rules", () => {
  const rules = {
    semi: "error",
    // The options are ignored, even invalid ones.
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
  const stylishArgs = ["-f", "stylish", "."];
  const notes = (stderr: string) => stderr.split("\n").filter(it => it.startsWith("note: "));
  const note = (count: number, names: string) => `note: ${count} deprecated formatting rules did not run: ${names}`;

  test.each(flavors)("%s: they don't run, and only a run that fails prints a note", async (name, config) => {
    const files = { [name]: config(rules), "a.js": untidy };
    const [found, stylish, clean, warned] = await Promise.all([
      lint(files),
      lint(files, stylishArgs),
      lint({ ...files, "a.js": "   x = 'y'\n" }, stylishArgs),
      lint({ ...files, [name]: config({ ...rules, "no-debugger": "warn" }) }, stylishArgs),
    ]);
    expect(found.problems).toEqual(["a.js:1:1 no-debugger"]);
    expect(found.exitCode).toBe(1);
    expect(notes(stylish.stderr)).toEqual([note(3, "indent, quotes, semi")]);
    expect(notes(clean.stderr)).toEqual([]);
    expect(clean.exitCode).toBe(0);
    expect(warned.raw).toContain("1 problem (0 errors, 1 warning)");
    expect(notes(warned.stderr)).toEqual([]);
    expect(warned.exitCode).toBe(0);
  });

  test("prints one note for all files and config files, with the first three rule names", async () => {
    const on = (...names: string[]) => flavors[0][1](Object.fromEntries(names.map(it => [it, "error"])));
    const { stderr, exitCode } = await lint(
      {
        "a/eslint.config.mjs": on("semi", "eol-last", "no-debugger"),
        "a/a.js": "debugger",
        "a/b.js": "b",
        "b/eslint.config.mjs": on("semi", "comma-dangle", "arrow-parens"),
        "b/c.js": "/* eslint yield-star-spacing: 2 */ c",
      },
      ["-f", "stylish", "a", "b"],
    );
    expect(notes(stderr)).toEqual([note(5, "arrow-parens, comma-dangle, eol-last, ..")]);
    expect(exitCode).toBe(1);
  });

  test("the note uses the singular for one rule", async () => {
    const config = flavors[0][1]({ semi: 2, "no-debugger": 2 });
    const { stderr } = await lint({ "eslint.config.mjs": config, "a.js": "debugger" }, stylishArgs);
    expect(notes(stderr)).toEqual(["note: 1 deprecated formatting rule did not run: semi"]);
  });

  // Like a config that ends with eslint-config-prettier.
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
  ])("%s: prints no note for a rule that ends up off", async (_, config) => {
    const code = `/* eslint quotes: "off", no-debugger: "error" */ debugger`;
    const { stderr, exitCode } = await lint({ ...config, "a.js": code }, stylishArgs);
    expect(notes(stderr)).toEqual([]);
    expect(exitCode).toBe(1);
  });

  test("rules turned on by --rule or an inline config comment don't run either, and are in the note", async () => {
    const files = { "a.js": `/* eslint quotes: ["error", "sideways"], no-debugger: "error" */ ${untidy}` };
    const flags = ["--no-config-lookup", "--rule", "semi: error", "--rule", "indent: [warn, sideways]"];
    const [found, stylish] = await Promise.all([lint(files, [...flags, "."]), lint(files, [...flags, ...stylishArgs])]);
    expect(found.problems).toEqual(["a.js:1:66 no-debugger"]);
    expect(found.exitCode).toBe(1);
    expect(notes(stylish.stderr)).toEqual([note(3, "indent, quotes, semi")]);
  });

  // It's on stderr, so a tool that reads the report doesn't see it.
  test.each(["--quiet", "--format=json", "--format=unix", "--format=github", "--format=agent"])(
    "the note is printed with %s",
    async flag => {
      const files = { "a.js": untidy };
      const without = { "eslint.config.mjs": flavors[0][1]({ "no-debugger": "error" }) };
      const [noted, plain] = await Promise.all([
        lint({ ...files, "eslint.config.mjs": flavors[0][1](rules) }, [...stylishArgs, flag]),
        lint({ ...files, ...without }, [...stylishArgs, flag]),
      ]);
      expect(notes(noted.stderr)).toEqual([note(3, "indent, quotes, semi")]);
      // The two reports are identical except for `usedDeprecatedRules` and the temporary directory names. A Windows
      // path is escaped in JSON, so `lint` doesn't replace it.
      const report = (stdout: string) =>
        stdout.replace(/"usedDeprecatedRules":\[.*?\]\}\]/g, "").replace(/bun-lint-config-files_\w+/g, "");
      expect(report(noted.stdout)).toBe(report(plain.stdout));
    },
  );

  test("only --silent hides the note", async () => {
    const files = { "eslint.config.mjs": flavors[0][1](rules), "a.js": untidy };
    expect((await lint(files, [...stylishArgs, "--silent"])).stderr).toBe("");
  });

  test.each(flavors)(
    "%s: a disable comment for one of them isn't reported as unknown or unused, and a fix keeps it",
    async (name, config) => {
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
      expect(
        JSON.parse(found.raw).results[0].messages.map((it: any) => `${it.line}:${it.column} ${it.message}`),
      ).toEqual(["2:1 Unused eslint-disable directive (no problems were reported from 'no-debugger')."]);
      text[1] = "// eslint-disable-next-line indent";
      expect(JSON.parse(fixed.raw).results[0]).toMatchObject({ messages: [], output: text.join("\n") });
    },
  );

  // The comment may be there for one of these rules.
  test("a disable comment for all rules isn't reported as unused if one of them is on", async () => {
    const run = (rules: object) =>
      lint({ "eslint.config.mjs": flavors[0][1](rules), "a.js": "a // eslint-disable-line\n" }, [
        "--report-unused-disable-directives",
        "a.js",
      ]);
    const [off, on] = await Promise.all([run({ semi: "off" }), run({ semi: "error" })]);
    expect([off.problems, on.problems]).toEqual([["a.js:1:3 -"], []]);
  });

  // Matches ESLint 10.12.
  test("usedDeprecatedRules lists them, in config order", async () => {
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

  // Matches ESLint 10.12 with these eslint-plugin-* versions: react 7.37.5, import 2.32.0, react-hooks 7.1.1.
  test("usedDeprecatedRules also lists deprecated built-in plugin rules", async () => {
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

  // Matches ESLint 10.12 and 8.57.1, except that 8.57.1 prints the severities as written.
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
    // ESLint rejects these options.
    [{ "eslint.config.mjs": flavors[0][1]({ quotes: ["error", "sideways", 3] }) }, `{"quotes":[2,"sideways",3]}`],
  ])("--print-config includes them, on or off, in config order: %#", async (config, rules) => {
    const { raw, exitCode } = await lint({ ...config, "a.js": "" }, ["--print-config", "a.js"]);
    expect(JSON.stringify(JSON.parse(raw).rules)).toBe(rules);
    expect(exitCode).toBe(0);
  });

  const reports = `{ create: context => ({ Program: node => context.report({ node, message: "It ran." }) }) }`;

  test("a plugin's rule with the same name runs", async () => {
    const files = {
      "eslint.config.mjs": `export default [{
        plugins: { "@stylistic": { rules: { semi: ${reports} } }, mine: { rules: { indent: ${reports} } } },
        rules: { "@stylistic/semi": "error", "mine/indent": "error" },
      }];`,
      "a.js": "a\n",
    };
    const [found, stylish] = await Promise.all([lint(files, ["a.js"]), lint(files, ["-f", "stylish", "a.js"])]);
    expect(found.problems).toEqual(["a.js:1:1 @stylistic/semi", "a.js:1:1 mine/indent"]);
    expect(notes(stylish.stderr).filter(it => it.includes("formatting"))).toEqual([]);
  });

  test("a --rulesdir rule with the same name runs", async () => {
    const files = {
      ".eslintrc.json": rc({ rules: { semi: "error" } }),
      "rules/semi.js": `module.exports = ${reports};`,
      "a.js": "a\n",
    };
    expect((await lint(files, ["--rulesdir", "rules", "a.js"])).problems).toEqual(["a.js:1:1 semi"]);
  });

  test("react/jsx-space-before-closing is one of them, unless the package's rules run", async () => {
    const files = {
      "eslint.config.mjs": `export default [{
        plugins: { react: { meta: { name: "eslint-plugin-react" }, rules: { "jsx-space-before-closing": ${reports} } } },
        rules: { "react/jsx-space-before-closing": "error" },
      }];`,
      "a.js": "a\n",
    };
    const [builtIn, stylish, withPackageRules] = await Promise.all([
      lint(files, ["a.js"]),
      lint({ ...files, "a.js": "debugger\n" }, ["-f", "stylish", "--rule", "no-debugger: error", "a.js"]),
      lint(files, ["--no-native-plugin-rules", "a.js"]),
    ]);
    expect(builtIn.problems).toEqual([]);
    expect(builtIn.exitCode).toBe(0);
    expect(notes(stylish.stderr)).toEqual([
      "note: 1 deprecated formatting rule did not run: react/jsx-space-before-closing",
    ]);
    expect(withPackageRules.problems).toEqual(["a.js:1:1 react/jsx-space-before-closing"]);
  });

  // oxlint never had these rules, and it rejects a config file that has them.
  test("with an .oxlintrc.json, they're treated like any other rule that isn't built in", async () => {
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

// oxlint has both plugins built in, so a config written for it can list them. Turning on one of their rules by name
// fails the run, like any other rule that isn't built in. Many configs only list the plugin, which prints a note.
describe.concurrent("oxlint's jsdoc and vue plugins, which bun lint has no rules for", () => {
  const files = {
    "a.js": "/** @param {string} b */\nfunction f(a) { debugger }\nf();\n",
    "b.vue": '<script>\ndebugger\nexport default { data() { return { a: 1 } }, props: ["a"] };\n</script>\n',
  };
  const found = ["a.js:2:17 no-debugger", "b.vue:2:1 no-debugger"];
  const clean = { "a.js": "export {};\n", "b.vue": "<script>\nexport {};\n</script>\n" };
  const quiet = { categories: { correctness: "off" }, rules: { "no-debugger": "warn" } };
  const notSupported = (plugin: string, ...rules: string[]) =>
    `${rules.length} ${rules.length > 1 ? "rules" : "rule"} in .oxlintrc.json ${rules.length > 1 ? "are" : "is"} not supported: ${rules.join(", ")}`;
  const noRulesNote = (...plugins: string[]) =>
    `note: bun lint has no "${plugins.join('" or "')}" rules, so none of them ran`;
  const silent = { problems: found, exitCode: 0, errors: [], notes: [] };
  /** Returns the problems, the exit code, and stderr's "error: " lines (`errors`) and "note: " lines. */
  async function run(config: object, flags: string[] = [], more: Record<string, string> = {}) {
    const all = { ...files, ...more, ".oxlintrc.json": JSON.stringify(config) };
    const { problems, stderr, exitCode } = await lint(all, [...flags, "."]);
    const lines = stderr.split("\n");
    const errorLines = lines.filter(it => it.startsWith("error: ")).map(it => it.slice("error: ".length));
    const notes = lines.filter(it => it.startsWith("note: "));
    return { problems, exitCode, errors: errorLines.map(it => it.trim()), notes };
  }

  test("enabling one of their rules still runs the other rules, then exits 2 unless --allow-unsupported is passed", async () => {
    const rules = {
      ...quiet.rules,
      "jsdoc/require-param": "error",
      "vue/no-dupe-keys": ["warn", { groups: ["a"] }],
      "vue/max-props": "deny",
    };
    expect(await run({ ...quiet, plugins: ["jsdoc", "vue"], rules })).toEqual({
      problems: found,
      exitCode: 2,
      errors: [notSupported("jsdoc", "jsdoc/require-param"), notSupported("vue", "vue/no-dupe-keys", "vue/max-props")],
      notes: [],
    });
    const allowed = await lint(
      { ...files, ".oxlintrc.json": JSON.stringify({ ...quiet, plugins: ["jsdoc", "vue"], rules }) },
      ["--allow-unsupported", "."],
    );
    expect(allowed.stderr).toContain(
      `warn: ${notSupported("jsdoc", "jsdoc/require-param")}\n  bun lint has no "jsdoc" rules. Turn it off or remove it.\n`,
    );
    expect(allowed.exitCode).toBe(0);
  });

  test("a rule that's off, or whose plugin isn't enabled, prints nothing", async () => {
    const on = { ...quiet.rules, "jsdoc/require-param": "error", "vue/no-dupe-keys": "error" };
    const off = { ...quiet.rules, "jsdoc/require-param": "off", "vue/no-dupe-keys": "allow" };
    expect(await run({ ...quiet, plugins: ["jsdoc", "vue"], rules: off })).toEqual(silent);
    // Like oxlint, which doesn't run the rule either.
    expect(await run({ ...quiet, rules: on })).toEqual(silent);
    const base = { "base.json": JSON.stringify({ plugins: ["jsdoc", "vue"], rules: on }) };
    expect(await run({ ...quiet, extends: ["./base.json"], plugins: ["jsdoc", "vue"], rules: off }, [], base)).toEqual(
      silent,
    );
  });

  test("listing the plugins with every category off prints nothing", async () => {
    expect(await run({ ...quiet, plugins: ["jsdoc", "vue"] })).toEqual(silent);
  });

  test("enabling one of their rules in overrides fails the run", async () => {
    const overrides = [{ files: ["*.vue"], plugins: ["vue"], rules: { "vue/no-dupe-keys": "error" } }];
    expect(await run({ ...quiet, overrides })).toEqual({
      problems: found,
      exitCode: 2,
      errors: [notSupported("vue", "vue/no-dupe-keys")],
      notes: [],
    });
  });

  test.each([
    [["--vue-plugin", "-D", "vue/no-dupe-keys"], [notSupported("vue", "vue/no-dupe-keys")], []],
    [["--vue-plugin", "-W", "vue/no-dupe-keys"], [notSupported("vue", "vue/no-dupe-keys")], []],
    [["--vue-plugin", "-D", "vue/no-dupe-keys", "-A", "vue/no-dupe-keys"], [], []],
    [["--vue-plugin", "--jsdoc-plugin", "-D", "correctness"], [], [noRulesNote("jsdoc", "vue")]],
    [["--vue-plugin"], [], []],
    [["-D", "vue/no-dupe-keys"], [], []],
  ])("on the command line: %j", async (flags, errors, notes) => {
    expect(await run({ ...quiet, rules: {} }, flags, clean)).toEqual({
      problems: [],
      exitCode: errors.length > 0 ? 2 : 0,
      errors,
      notes,
    });
  });

  // `correctness` is on by default, and oxlint has rules from both plugins in it.
  test("listing a plugin prints a note if oxlint has rules from it in a category that's on", async () => {
    const config = (categories: object) => ({ categories: { correctness: "off", ...categories }, plugins: ["vue"] });
    const noted = { problems: [], exitCode: 0, errors: [], notes: [noRulesNote("vue")] };
    const passes = { problems: [], exitCode: 0, errors: [], notes: [] };
    expect(await run(config({ correctness: "error" }), [], clean)).toEqual(noted);
    expect(await run({ plugins: ["vue"] }, [], clean)).toEqual(noted);
    expect(await run(config({ restriction: "warn" }), [], clean)).toEqual(noted);
    // The other rules decide the exit code.
    expect(await run(config({ correctness: "error" }), [], { ...clean, "c.js": "debugger;\nexport {};\n" })).toEqual({
      ...noted,
      problems: ["c.js:1:1 no-debugger"],
      exitCode: 1,
    });
    // oxlint has no vue rules in `perf`.
    expect(await run(config({ perf: "error" }), [], clean)).toEqual(passes);
    expect(await run(config({}), [], clean)).toEqual(passes);
    // A plugin that an override lists gets the note only if a linted file matches the override.
    const override = (pattern: string) => ({ overrides: [{ files: [pattern], plugins: ["vue"] }] });
    expect(await run({ plugins: ["unicorn"], ...override("*.vue") }, [], clean)).toEqual(noted);
    expect(await run({ plugins: ["unicorn"], ...override("*.svelte") }, [], clean)).toEqual(passes);
    // oxlint 1.87 runs no vue rules here. It doesn't apply categories to an override's plugins if the override lists
    // every plugin that's on for the file.
    expect(await run({ plugins: [], ...override("*.vue") }, [], clean)).toEqual(passes);
  });

  test("fails the run and still prints the note if a rule is enabled and a plugin is only listed", async () => {
    const config = { plugins: ["jsdoc", "vue"], rules: { "vue/no-dupe-keys": "error" } };
    expect(await run(config, [], clean)).toEqual({
      problems: [],
      exitCode: 2,
      errors: [notSupported("vue", "vue/no-dupe-keys")],
      notes: [noRulesNote("jsdoc", "vue")],
    });
  });

  // The note goes to stderr, so a program that parses the report never sees it.
  test.each(["--format=json", "--format=github", "--format=unix", "--format=pretty", "--quiet"])(
    "prints the note with %s, and stdout is the same as without the note",
    async flag => {
      const config = (plugins: string[]) => ({
        ".oxlintrc.json": JSON.stringify({ plugins, rules: { "no-debugger": "error" } }),
      });
      const [noted, plain] = await Promise.all([
        lint({ ...files, ...config(["vue"]) }, [flag, "."]),
        lint({ ...files, ...config([]) }, [flag, "."]),
      ]);
      expect(noted.stderr.split("\n").filter(it => it.startsWith("note: "))).toEqual([noRulesNote("vue")]);
      const stripTimes = (stdout: string) =>
        stdout.replace(/"start_time": [\d.e-]+|\d+(\.\d+)?m?s\b|bun-lint-config-files_\w+/g, "");
      expect(stripTimes(noted.stdout)).toBe(stripTimes(plain.stdout));
      expect([noted.exitCode, plain.exitCode]).toEqual([1, 1]);
    },
  );

  test("only --silent hides the note", async () => {
    const all = { ...clean, ".oxlintrc.json": JSON.stringify({ plugins: ["vue"] }) };
    const { stderr, exitCode } = await lint(all, ["--silent", "."]);
    expect(stderr).not.toContain("note: ");
    expect(exitCode).toBe(0);
  });

  test("accepts settings for them", async () => {
    const settings = { jsdoc: { ignorePrivate: true, nothing: 1 }, vue: { nothing: 1 } };
    expect(await run({ ...quiet, settings })).toEqual(silent);
  });

  test("still rejects any other plugin that oxlint doesn't know", async () => {
    const { stdout, exitCode } = await lint({ ...files, ".oxlintrc.json": JSON.stringify({ plugins: ["jsdocs"] }) });
    expect(stdout).toContain(`Unknown plugin: 'jsdocs'.`);
    expect(exitCode).toBe(1);
  });

  test("a disable comment for one of their rules isn't reported as unused, or removed, while one of their rules is on", async () => {
    const text = [
      // oxlint's jsdoc rules only look at comments like this one. In a file without one, they couldn't have reported
      // anything.
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
    // oxlint removes the unused part from the script of a .vue file too.
    const fixed = await lint(all, ["--report-unused-disable-directives", "--fix-dry-run", "b.vue"]);
    expect(JSON.parse(fixed.raw).results[0].output).toBe(`<script>\n${text.replace(", no-debugger", "")}</script>\n`);
  });

  // oxlint 1.87 reports each of these comments as a whole. Its jsdoc rules only look at `/**` comments, so in a file
  // without one bun lint didn't skip anything they'd report, and a comment that's unused here is unused in oxlint too.
  test("without a /** comment, disable comments are reported as unused like in oxlint, even if jsdoc rules are on", async () => {
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
    // oxlint reports the same comments with these files. bun lint can't know what the jsdoc and vue rules would have
    // reported, and --fix-suggestions removes a comment that's reported as unused. So it only reports rule names that
    // neither plugin has.
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

  test("--rules doesn't list them", async () => {
    const { raw } = await lint({ ".oxlintrc.json": "{}" }, ["--rules", "-f", "json"]);
    const scopes = new Set(JSON.parse(raw).map((it: { scope: string }) => it.scope));
    expect([scopes.has("unicorn"), scopes.has("jsdoc"), scopes.has("vue")]).toEqual([true, false, false]);
  });

  // bun lint has never had built-in rules for these packages.
  test("with an ESLint config, jsdoc and vue rules come from the project's packages", async () => {
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

// Same as ESLint 10.12 with eslint-plugin-import 2.32.0 and eslint-plugin-react 7.37.5. `" ".repeat(n)` throws if n is
// negative or above the maximum string length, 2 ** 29 - 24, so the rule throws, which ends the run. Below that limit
// ESLint reports as usual, as long as the format doesn't print the fixes. Its `json` format throws on them.
describe.concurrent("a rule option that's used as a string length", () => {
  const element = 'const a = (\n  <b\n    c="d"\n  >\n    <e />\n  </b>\n);\n';
  const tooLong = "RangeError: Invalid string length";
  test.each<
    [rule: string, option: unknown, file: string, text: string, thrown: [error: string, line: number] | string[]]
  >([
    ["import/newline-after-import", { count: 2 ** 53 }, "a.js", '\nimport "a";\nb();\n', [tooLong, 2]],
    ["import/newline-after-import", { count: 2 ** 29 }, "a.js", '\nimport "a";\nb();\n', [tooLong, 2]],
    // `require` calls are checked in `Program:exit`, so the line is the start of the program.
    ["import/newline-after-import", { count: 2 ** 31 }, "a.js", '\n\nconst a = require("a");\nb();\n', [tooLong, 1]],
    ["react/jsx-indent", 2 ** 31, "a.jsx", element, [tooLong, 2]],
    // There's no JSX, so nothing is repeated.
    ["react/jsx-indent", 2 ** 31, "a.jsx", "a();\n", []],
    // One level of indentation fits. Two levels are too long.
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

// Same as ESLint 9.39.5, except for the error's name before the message.
test.concurrent.each([
  ["[", 'Syntax error in selector "[" at position 1: Expected " " or [^ [\\],():#!=><~+.] but end of input found.'],
  [
    { selector: "a >", message: "no" },
    'Syntax error in selector "a >" at position 3: Expected " ", "!", "#", "*", ".", ":", ":first-child", ":has(", ":is(", ":last-child", ":matches(", ":not(", ":nth-child(", ":nth-last-child(", "[", or [^ [\\],():#!=><~+.] but end of input found.',
  ],
  [":foo", "Unknown class name: foo"],
  [`${":not(".repeat(100_000)}a${")".repeat(100_000)}`, "Maximum call stack size exceeded"],
])("no-restricted-syntax with an invalid selector ends the run: %#", async (option, message) => {
  const files = { ".eslintrc.json": rc({ rules: { "no-restricted-syntax": ["error", "Foo", option] } }), "a.js": code };
  const { problems, stderr, exitCode } = await lint(files, ["a.js"]);
  // `lint` turns every backslash into a `/`.
  expect(stderr).toContain(`${message.replaceAll("\\", "/")}\nOccurred while linting <dir>/a.js`);
  expect({ problems, exitCode }).toEqual({ problems: [], exitCode: 2 });
});

// The selector parser handles deeper nesting than the matcher. How deep depends on the build and the platform. Between
// the two limits, each `:has()` used to treat a stack overflow as a node that doesn't match, and continued with the
// next node. ESLint 9.39.5 reports the ten nodes up to 999 levels.
test.concurrent.each(Array.from({ length: 24 }, (_, i) => Math.ceil(300 * 1.2 ** i)))(
  "no-restricted-syntax with `:has()` nested close to the stack limit reports every node or fails: %d",
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

// Same as ESLint 10.12. The rules of a plugin in the config are known whether or not the config turns one on.
test.concurrent(
  "comments can refer to a plugin's rule even if the config turns on none of that plugin's rules",
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

// ───────────── paths, as each platform writes and compares them ─────────────

// `bun lint --run-path-tests` is compiled into debug and canary builds only.
const hasRunner = isDebug || Bun.spawnSync({ cmd: [bunExe(), "--revision"], env: bunEnv }).stdout.includes("canary");

const quiet = { categories: { correctness: "off" } };

// A config picks Windows or POSIX path rules by what its base path looks like, so Windows paths can be tested on every
// platform. The expected results for flat configs come from `ConfigArray` in @eslint/config-array 0.23.5, which picks
// the same way.
describe.skipIf(!hasRunner)("Windows paths, on every platform", () => {
  async function resolveConfigs(cases: object[]) {
    using dir = tempDir("bun-lint-paths", { "cases.json": JSON.stringify(cases) });
    await using proc = spawn({
      cmd: [...command, "--run-path-tests", "configurations", join(String(dir), "cases.json")],
      env,
      // Not a directory whose `package.json` has a `lint` script.
      cwd: String(dir),
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(exitCode).toBe(0);
    return JSON.parse(stdout);
  }

  test("a file is inside a base path regardless of letter case and slash direction", async () => {
    expect(
      await resolveConfigs([
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
        // POSIX paths are case-sensitive.
        { basePath: "/proj", config: [noVar], files: ["/proj/a.js", "/PROJ/a.js"] },
      ]),
    ).toEqual([
      { files: [["no-var"], ["no-var"], "external", "external"], directories: [] },
      { files: [["no-var"], "ignored", [], ["no-var"]], directories: [] },
      { files: [["no-var"]], directories: [] },
      { files: [["no-var"], "external"], directories: [] },
    ]);
  });

  test("a base path can be on a network share or be the root of a drive", async () => {
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
      await resolveConfigs([
        onShare(String.raw`\\SERVER\Share\proj\src`),
        onShare("//server/share/proj/src"),
        onShare("src"),
        atRoot("X:/"),
        atRoot("X:"),
        // A run without a config file has the base path `/`, which contains every path.
        { basePath: "/", config: [noVar], files: ["C:/a/b.js", "D:/a/b.js", `${proj}/a.js`] },
      ]),
    ).toEqual([share, share, share, root, root, { files: [["no-var"], ["no-var"], ["no-var"]], directories: [] }]);
  });

  test("oxlint's `ignorePatterns` don't apply to files outside the config's directory", async () => {
    const config = { ...quiet, ...noVar, ignorePatterns: ["*.js"] };
    const expected = { files: [["no-var"], "ignored"], directories: [] };
    expect(
      await resolveConfigs([
        { basePath: "/proj/config", flavor: "oxlint", config, files: ["/proj/src/a.js", "/proj/config/a.js"] },
        { basePath: "C:/proj/config", flavor: "oxlint", config, files: ["C:/proj/src/a.js", "C:/proj/config/a.js"] },
      ]),
    ).toEqual([expected, expected]);
  });

  test.each(["oxlint", "eslintrc"])("`extends` in an %s config can use `\\`", async flavor => {
    const [{ error, files }] = await resolveConfigs([
      {
        basePath: "C:/proj",
        flavor,
        config: { ...(flavor === "oxlint" ? quiet : { root: true }), extends: [String.raw`..\shared\base.json`] },
        // A nested `extends` is relative to the file that has it.
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

// This is what ESLint 10.12.0, ESLint 8.57.1 and oxlint 1.87.0 do with the same files. Without a config file, bun lint
// behaves like oxlint.
describe.skipIf(isWindows).concurrent("a symlink that's dangling or points to itself or a parent directory", () => {
  const flavors: Record<string, Record<string, string>> = {
    "eslint.config.js": { "eslint.config.js": `export default [${JSON.stringify(noVar)}];` },
    ".eslintrc.json": { ".eslintrc.json": rc(noVar) },
    ".oxlintrc.json": { ".oxlintrc.json": JSON.stringify({ ...noVar, categories: { correctness: "off" } }) },
    "bunfig.toml": { "bunfig.toml": `[lint.rules]\n"no-var" = "error"\n` },
    "no file": {},
  };
  const others = { "a.js": code, "sub/b.js": code };
  /** Returns the files with problems, the output and the exit code. `links` maps each symlink's path to its target. */
  const linted = async (flavor: string, links: Record<string, string>, args = ["."], files = others) => {
    const inProject = Object.entries({ ...flavors[flavor], ...files }).map(([name, text]) => [`project/${name}`, text]);
    const before = (dir: string) =>
      Object.entries(links).forEach(([path, to]) => symlinkSync(to, join(dir, "project", path)));
    const all = { ...Object.fromEntries(inProject), "project/.keep": "", "outside/c.js": code };
    const { problems, stdout, stderr, exitCode } = await lint(all, args, { before, cwd: "project" });
    const names = problems.map(it => it.split(":")[0].replace("project/", ""));
    return { files: [...new Set(names)], stdout, stderr: stderr.replaceAll("<dir>/project/", "<dir>/"), exitCode };
  };
  const exceptFlatConfig = [".eslintrc.json", ".oxlintrc.json", "bunfig.toml", "no file"];
  const likeOxlint = [".oxlintrc.json", "bunfig.toml", "no file"];

  test.each(exceptFlatConfig)("a directory search skips a dangling symlink: %s", async flavor => {
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

  // ESLint prints "Error: ENOENT: no such file or directory, open '<dir>/gone.js'" and "Error: ELOOP: too many symbolic
  // links encountered, open ..".
  test.each([
    ["gone.js", "nowhere.js", "ENOENT"],
    ["self.js", "self.js", "ELOOP"],
  ])(
    "with an eslint.config.js, like ESLint, %s pointing to %s can't be read, which ends the run",
    async (name, to, code) => {
      const { files, stderr, exitCode } = await linted("eslint.config.js", { [name]: to });
      expect(stderr).toContain(`Cannot read <dir>/${name}: ${code}: `);
      expect({ files, exitCode }).toEqual({ files: [], exitCode: 2 });
      // ESLint doesn't resolve a link that it wouldn't lint.
      expect(
        await linted("eslint.config.js", { "gone": "nowhere", "self": "self", "sub/gone.md": "nowhere.md" }),
      ).toMatchObject({
        files: ["a.js", "sub/b.js"],
        exitCode: 1,
      });
    },
  );

  test.each(likeOxlint)("skips a symlink to itself and two symlinks to each other: %s", async flavor => {
    const links = { "self.js": "self.js", "self": "self", "sub/c.js": "d.js", "sub/d.js": "c.js" };
    expect(await linted(flavor, links)).toMatchObject({ files: ["a.js", "sub/b.js"], exitCode: 1 });
  });

  test.each([
    [{ "self.js": "self.js" }, ["."], "self.js"],
    // With any name, in any directory.
    [{ "self": "self" }, ["."], "self"],
    [{ "node_modules/self": "self" }, ["."], "node_modules/self"],
    [{ "sub/self.md": "self.md" }, ["**/*.js"], "sub/self.md"],
    [{ "self.js": "self.js" }, ["a.js", "self.js"], "self.js"],
  ])(
    "with an .eslintrc.json, like ESLint 8, every symlink is resolved, so %j ends the run",
    async (links, args, name) => {
      const files = { ...others, "node_modules/.keep": "" };
      const { stderr, exitCode } = await linted(".eslintrc.json", links as Record<string, string>, args, files);
      expect(stderr).toContain(`ELOOP: too many symbolic links encountered, stat '<dir>/${name}'`);
      expect(exitCode).toBe(2);
    },
  );

  test("a directory with only a dangling symlink has no files to lint", async () => {
    const only = (flavor: string) => linted(flavor, { "gone.js": "nowhere.js" }, ["."], {});
    const [eslint8, oxlint] = await Promise.all([only(".eslintrc.json"), only(".oxlintrc.json")]);
    // Same message as ESLint 8.57.1: 'No files matching the pattern "." were found.'
    expect(eslint8.stderr).toContain('pattern "."');
    expect(eslint8.exitCode).toBe(2);
    expect(oxlint.stdout).toContain("No files found to lint. Please check your paths and ignore patterns.");
    expect(oxlint.exitCode).toBe(1);
  });

  test("a dangling symlink passed as an argument is treated as a missing file", async () => {
    const asArgument = (flavor: string) => linted(flavor, { "gone.js": "nowhere.js" }, ["gone.js", "a.js"]);
    const [eslint, eslint8, oxlint] = await Promise.all(
      ["eslint.config.js", ".eslintrc.json", ".oxlintrc.json"].map(asArgument),
    );
    for (const { stderr, exitCode } of [eslint, eslint8]) {
      expect(stderr).toContain('No files matching the pattern "gone.js" were found.');
      expect(exitCode).toBe(2);
    }
    expect(oxlint).toMatchObject({ files: ["a.js"], exitCode: 1 });
  });

  test.each(exceptFlatConfig)("follows a symlink to a directory: %s", async flavor => {
    expect(await linted(flavor, { "linked": "sub", "sub/out": "../../outside" })).toMatchObject({
      files: ["a.js", "linked/b.js", "linked/out/c.js", "sub/b.js", "sub/out/c.js"],
      exitCode: 1,
    });
  });

  test.each(likeOxlint)("ignore files match the path through the symlink, not its target: %s", async flavor => {
    const files = { ...others, "hid/h.js": code, ".gitignore": "hid/\nskipped\n" };
    expect(await linted(flavor, { "shown": "hid", "skipped": "sub" }, ["."], files)).toMatchObject({
      files: ["a.js", "shown/h.js", "sub/b.js"],
      exitCode: 1,
    });
  });

  test.each(likeOxlint)("follows a symlink to a parent of the search root, once: %s", async flavor => {
    expect(await linted(flavor, { "up": ".." })).toMatchObject({
      files: ["a.js", "sub/b.js", "up/outside/c.js", "up/project/a.js", "up/project/sub/b.js"],
      exitCode: 1,
    });
  });

  test.each(likeOxlint)("skips a symlink to one of its parent directories inside the search root: %s", async flavor => {
    const links = { "here": ".", "sub/up": "..", "sub/too": "../sub" };
    expect(await linted(flavor, links)).toMatchObject({ files: ["a.js", "sub/b.js"], exitCode: 1 });
  });

  // ESLint 8 loops until the OS gives up: "ELOOP: too many symbolic links encountered, stat '<dir>/here/here/here/.."
  test.each([
    [{ "here": "." }, "here"],
    [{ "sub/up": ".." }, "sub/up"],
  ])("with an .eslintrc.json, like ESLint 8, following %j ends the run with ELOOP", async (links, name) => {
    const { stderr, exitCode } = await linted(".eslintrc.json", links as Record<string, string>);
    expect(stderr).toContain(`ELOOP: too many symbolic links encountered, stat '<dir>/${name}`);
    expect(exitCode).toBe(2);
    // Not if the link is ignored, because the search never enters it.
    const ignoring = { ".eslintrc.json": rc({ ...noVar, ignorePatterns: [name] }), ...others };
    expect(await linted("no file", links as Record<string, string>, ["."], ignoring)).toMatchObject({
      files: ["a.js", "sub/b.js"],
      exitCode: 1,
    });
  });
});

// Matches what ESLint 10.12.0 lints and which config files it runs. It decides whether to enter a directory with the
// config of that directory's parent. If the parent has no config file, the base path is the working directory, and
// everything outside it is ignored.
describe.concurrent("a search that goes outside an eslint.config.js project", () => {
  const scripts = ["mine", "mine/sub", "mine/nested", "theirs", "theirs/deep", "none", "none/in"];
  const inRepository = ["repo", "repo/packages/a", "repo/packages/b", "repo/packages/b/own", "repo/packages/c"];
  const files = Object.fromEntries([...scripts, ...inRepository].map(it => [`w/${it}/x.js`, "debugger;\n"]));
  const configured = ["mine", "mine/nested", "theirs", "theirs/deep", "repo", "repo/packages/b/own"];
  type More = { files?: Record<string, string>; links?: Record<string, string> };

  /** Returns the directories whose config file ran, and the files with problems. */
  const run = async (cwd: string, args: string[], more: More = {}) => {
    using logs = tempDir("bun-lint-config-files-ran", {});
    const log = join(String(logs), "ran.log");
    const before = (dir: string) => {
      for (const it of configured) {
        const logRun = `fs.appendFileSync(${JSON.stringify(log)}, ${JSON.stringify(it + "\n")});`;
        const text = `import fs from "node:fs";\n${logRun}\nexport default [{ rules: { "no-debugger": "error" } }];\n`;
        writeFileSync(join(dir, "w", it, "eslint.config.js"), text);
      }
      for (const [path, to] of Object.entries(more.links ?? {})) {
        symlinkSync(join(dir, "w", path, "..", to), join(dir, "w", path), "junction");
      }
    };
    const expandedArgs = args.map(it => it.replace("<w>", "<dir>/w"));
    const result = await lint({ ...files, ...more.files }, [], {
      cwd: `w/${cwd}`,
      before,
      args: dir => expandedArgs.map(it => it.replace("<dir>", dir.replaceAll("\\", "/"))),
    });
    const ran = existsSync(log) ? [...new Set(readFileSync(log, "utf8").split("\n").filter(Boolean))].sort() : [];
    return {
      ran,
      files: [...new Set(result.problems.map(it => it.split(":")[0].replace("w/", "")))],
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  };
  const filesInMine = ["mine/nested/x.js", "mine/sub/x.js", "mine/x.js"];

  test.each([[".."], ["<w>/**/x.js"], ["../**/x.js"], ["<w>"], [".", ".."]])(
    "only enters directories inside the working directory: %s",
    async (...args) => {
      expect(await run("mine", args)).toMatchObject({ ran: ["mine", "mine/nested"], files: filesInMine, exitCode: 1 });
    },
  );

  test("doesn't enter the working directory's siblings or parents", async () => {
    expect(await run("mine", ["../*/x.js"])).toMatchObject({ ran: ["mine"], files: ["mine/x.js"], exitCode: 1 });
    for (const [cwd, args] of [
      ["mine", ["../.."]],
      ["mine/sub", ["../.."]],
      ["mine/sub", ["<w>/**/x.js"]],
      ["repo/packages/a", ["../../.."]],
    ] as const) {
      const { ran, files, stderr, exitCode } = await run(cwd, [...args]);
      expect(stderr).toContain("are ignored.");
      // ESLint doesn't run any config file here. bun lint runs the one for the working directory.
      expect({ ran, files, exitCode }).toEqual({ ran: [cwd.split("/")[0]], files: [], exitCode: 2 });
    }
  });

  // ESLint prints "ESLint couldn't find an eslint.config.* file."
  test.each([
    ["../none", {}, "none/x.js"],
    ["../none/x.js", {}, "none/x.js"],
    ["../none/in", {}, "none/in/x.js"],
    // Any file, whatever its extension.
    ["..", { files: { "w/readme.md": "" } }, "readme.md"],
    ["<w>/**/x.js", { files: { "w/x.js": "debugger;\n" } }, "x.js"],
    // ESLint doesn't treat a link to a directory as a directory.
    ["..", { links: { "linked": "theirs" } }, "linked"],
  ])("a file with no config file ends the run: %s %j", async (argument, more, file) => {
    const { ran, files, stderr, exitCode } = await run("mine", [argument], more);
    expect(stderr).toContain(`Could not find config file.\n  No eslint.config.* was found next to <dir>/w/${file} or`);
    expect(ran.filter(it => !it.startsWith("mine"))).toEqual([]);
    expect({ files, exitCode }).toEqual({ files: [], exitCode: 2 });
  });

  test("a path passed as an argument is linted with its own config file if it has one", async () => {
    const theirs = { ran: ["mine", "theirs", "theirs/deep"], files: ["theirs/deep/x.js", "theirs/x.js"], exitCode: 1 };
    expect(await run("mine", ["../theirs"])).toMatchObject(theirs);
    expect(await run("mine", ["<w>/theirs"])).toMatchObject(theirs);
    expect(await run("mine", ["../theirs/x.js"])).toMatchObject({ ran: ["mine", "theirs"], files: ["theirs/x.js"] });
    expect(await run("mine", ["../theirs/deep"])).toMatchObject({ ran: ["mine", "theirs/deep"] });
  });

  test("a config file in a parent directory also applies to the working directory's siblings", async () => {
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

  test("a search doesn't follow a symlink out of the working directory, but as an argument it's a path like any other", async () => {
    const links = { "mine/link": "../theirs", "mine/bare": "../none" };
    for (const args of [["."], ["**/x.js"], [".."]]) {
      expect(await run("mine", args, { links })).toMatchObject({ ran: ["mine", "mine/nested"], files: filesInMine });
    }
    expect(await run("mine", ["link/x.js"], { links })).toMatchObject({
      ran: ["mine", "theirs"],
      files: ["mine/link/x.js"],
    });
    expect(await run("mine", ["link"], { links })).toMatchObject({
      ran: ["mine", "theirs", "theirs/deep"],
      files: ["mine/link/deep/x.js", "mine/link/x.js"],
    });
    // The config lookup walks up from the path through the link, not from the link's target.
    expect(await run("mine", ["bare"], { links })).toMatchObject({
      ran: ["mine"],
      files: ["mine/bare/in/x.js", "mine/bare/x.js"],
    });
  });

  test("with --config or --no-config-lookup, no other config file runs and the base path is the working directory", async () => {
    const all = { files: filesInMine, exitCode: 1 };
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

  test("without a config file in the working directory, each directory's own config file is used", async () => {
    expect(await run("none", [".."])).toMatchObject({
      ran: configured.toSorted(),
      files: Object.keys(files)
        .map(it => it.replace("w/", ""))
        .sort(),
      exitCode: 1,
    });
  });
});

// A config file is a program, or loads programs. ESLint exits with an error in a working directory like this, so
// there's no tool to match.
describe.concurrent("a pattern that goes outside a working directory with no config file", () => {
  const off = `{ rules: { "no-debugger": "off" } }`;
  /**
   * Returns a directory's files, for each kind of config. `logRun` is a statement that logs that the config's code ran.
   */
  const kinds: Record<string, (logRun: string) => Record<string, string>> = {
    "flat-js": logRun => ({ "eslint.config.js": `import fs from "node:fs";\n${logRun}\nexport default [${off}];\n` }),
    "flat-cts": logRun => ({
      "eslint.config.cts": `const fs = require("fs");\n${logRun}\nmodule.exports = [${off}];\n`,
    }),
    "rc-cjs": logRun => ({
      ".eslintrc.cjs": `const fs = require("fs");\n${logRun}\nmodule.exports = { root: true, ...${off} };\n`,
    }),
    "rc-json-extends": logRun => ({
      ".eslintrc.json": `{ "root": true, "extends": "./program.js" }`,
      "program.js": `const fs = require("fs");\n${logRun}\nmodule.exports = ${off};\n`,
    }),
    "rc-yaml-plugin": logRun => ({
      ".eslintrc.yaml": `root: true\nplugins: [local]\nrules: { no-debugger: off }\n`,
      "node_modules/eslint-plugin-local/package.json": `{ "name": "eslint-plugin-local", "version": "1.0.0", "main": "index.js" }`,
      "node_modules/eslint-plugin-local/index.js": `const fs = require("fs");\n${logRun}\nmodule.exports = { rules: {} };\n`,
    }),
    "package-json-extends": logRun => ({
      "package.json": `{ "name": "a", "eslintConfig": { "root": true, "extends": "./program.js" } }`,
      "program.js": `const fs = require("fs");\n${logRun}\nmodule.exports = ${off};\n`,
    }),
    "ox-ts": logRun => ({ "oxlint.config.ts": `import fs from "node:fs";\n${logRun}\nexport default ${off};\n` }),
    "ox-json-plugin": logRun => ({
      ".oxlintrc.json": `{ "jsPlugins": ["./plugin.js"], "rules": { "no-debugger": "off" } }`,
      "plugin.js": `import fs from "node:fs";\n${logRun}\nexport default { meta: { name: "local" }, rules: {} };\n`,
    }),
  };
  const all = (where: string) =>
    Object.keys(kinds)
      .map(it => `${where}/${it}`)
      .sort();
  const scripts = (where: string) => all(where).map(it => `${it}/x.js`);

  /**
   * Returns the programs that ran and the files with problems. A file has problems if it's linted with the defaults
   * instead of its own config.
   */
  const run = async (args: string[], cwd = "empty") => {
    using logs = tempDir("bun-lint-config-files-ran", {});
    const log = join(String(logs), "ran.log");
    const files: Record<string, string> = { "w/empty/x.js": "debugger;\n", "w/empty/plain/x.js": "debugger;\n" };
    for (const where of ["beside", "empty/below"]) {
      for (const [kind, makeFiles] of Object.entries(kinds)) {
        const logRun = `fs.appendFileSync(${JSON.stringify(log)}, ${JSON.stringify(`${where}/${kind}\n`)});`;
        files[`w/${where}/${kind}/x.js`] = "debugger;\n";
        for (const [name, text] of Object.entries(makeFiles(logRun))) files[`w/${where}/${kind}/${name}`] = text;
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
    "%s doesn't run config files outside the working directory, and lints the files there with the defaults",
    async pattern => {
      expect(await run([pattern])).toMatchObject({ ran: all("empty/below"), files: [...scripts("beside"), ...own] });
    },
  );

  test.each([["../beside/*/x.js"], ["<w>/beside/**/x.js"], ["../*/*/x.js"]])(
    "%s doesn't run config files in a sibling directory either",
    async pattern => {
      const { ran, files } = await run([pattern]);
      expect({ ran, beside: files.filter(it => it.startsWith("beside/")) }).toEqual({
        ran: [],
        beside: scripts("beside"),
      });
    },
  );

  test.each(["--flavor=oxlint", "--flavor=eslint"])(
    "doesn't run config files outside the working directory with %s either",
    async flavor => {
      const { ran, files } = await run([flavor, "<w>/**/x.js"]);
      expect(ran.filter(it => it.startsWith("beside/"))).toEqual([]);
      expect(files.filter(it => it.startsWith("beside/"))).toEqual(scripts("beside"));
    },
  );

  test("doesn't run config files outside a nested working directory either", async () => {
    expect(await run(["../**/x.js"], "empty/plain")).toMatchObject({
      ran: [],
      files: [...scripts("empty/below"), ...own],
    });
  });

  test("inside the working directory, each directory's own config is used", async () => {
    for (const args of [[], ["."], ["**/x.js"], ["./below/../**/x.js"]]) {
      expect(await run(args)).toMatchObject({ ran: all("empty/below"), files: own });
    }
  });

  test.each(Object.keys(kinds))(
    "a directory or file passed as an argument is linted with its own config: %s",
    async kind => {
      const ran = [`beside/${kind}`];
      expect(await run([`../beside/${kind}`])).toEqual({ ran, files: [] });
      expect(await run([`../beside/${kind}/x.js`])).toEqual({ ran, files: [] });
    },
  );

  test("passing a directory as an argument runs every config inside it", async () => {
    expect(await run(["../beside"])).toEqual({ ran: all("beside"), files: [] });
    expect(await run([".."])).toMatchObject({ ran: [...all("beside"), ...all("empty/below")], files: own });
    // The argument's config is also used for a file in it that a pattern matches.
    expect(await run(["../beside/flat-js", "../beside/*/x.js"])).toMatchObject({
      ran: ["beside/flat-js"],
      files: scripts("beside").filter(it => it !== "beside/flat-js/x.js"),
    });
  });
});

// The skipped files are the ones that `git check-ignore` lists. oxlint 1.87.0 doesn't find a submodule's info/exclude,
// and resolves a relative `gitdir` against its working directory.
describe.concurrent("a repository's info/exclude, without an oxlint config", () => {
  const names = ["a.js", "gen/b.js", "kept.js", "sub/a.js", "sub/anchored.js", "sub/named.js"];
  const excludes = "/a.js\nnamed.js\ngen/\n/sub/anchored.js\n";
  const notExcluded = ["kept.js", "sub/a.js"];
  /** Returns a file for each of `names`, with `prefix` before its path. */
  const tree = (prefix: string) => Object.fromEntries(names.map(name => [prefix + name, code]));
  /** Returns the files that were linted. */
  async function linted(files: Record<string, string>, args: string[], cwd: string) {
    const { problems } = await lint(files, args, { cwd });
    return [...new Set(problems.map(it => it.split(":")[0]))];
  }

  test("applies in a worktree created with `git worktree add --relative-paths`", async () => {
    const files = {
      ...tree("wt/"),
      "wt/.git": "gitdir: ../main/.git/worktrees/wt\n",
      "main/.git/worktrees/wt/commondir": "../..\n",
      "main/.git/info/exclude": excludes,
    };
    expect(
      await Promise.all([linted(files, ["."], "wt"), linted(files, ["."], "wt/sub"), linted(files, ["wt"], ".")]),
    ).toEqual([notExcluded.map(it => `wt/${it}`), ["wt/sub/a.js"], notExcluded.map(it => `wt/${it}`)]);
  });

  test("applies in a submodule", async () => {
    const files = {
      ...tree("vendor/lib/"),
      "top.js": code,
      ".git/info/exclude": "kept.js\n",
      ".git/modules/vendor/lib/info/exclude": excludes,
      "vendor/lib/.git": "gitdir: ../../.git/modules/vendor/lib\n",
    };
    const inLib = notExcluded.map(it => `vendor/lib/${it}`);
    expect(
      await Promise.all([
        linted(files, ["."], "."),
        linted(files, ["."], "vendor/lib"),
        linted(files, ["."], "vendor/lib/sub"),
      ]),
    ).toEqual([["top.js", ...inLib], inLib, ["vendor/lib/sub/a.js"]]);
  });

  test.each([
    ["no config", {}],
    ["an ESLint 8 config", { ".eslintrc.json": rc(eqeqeq) }],
  ])("can be passed to --ignore-path, with %s", async (_, configuration) => {
    const files = { ...tree(""), ...configuration, ".git/info/exclude": excludes };
    expect(
      await Promise.all([
        linted(files, ["--ignore-path", ".git/info/exclude", "."], "."),
        linted(files, ["--ignore-path", "../.git/info/exclude", "."], "sub"),
      ]),
    ).toEqual([notExcluded, ["sub/a.js"]]);
  });

  // oxlint matches a file passed as an argument against the patterns the way it's spelled on the command line. Here the
  // patterns are relative to the repository root, as in Git.
  test("can be passed to --ignore-path with an oxlint config, and its patterns stay relative to the repository root for files passed as arguments", async () => {
    const files = { ...tree(""), ".oxlintrc.json": JSON.stringify(noVar), ".git/info/exclude": excludes };
    const fromSub = names.map(name => (name.startsWith("sub/") ? name.slice(4) : `../${name}`));
    expect(
      await Promise.all([
        linted(files, ["--ignore-path", ".git/info/exclude", "."], "."),
        linted(files, ["--ignore-path", ".git/info/exclude", ...names], "."),
        linted(files, ["--ignore-path", "../.git/info/exclude", ".."], "sub"),
        linted(files, ["--ignore-path", "../.git/info/exclude", ...fromSub], "sub"),
      ]),
      // For a file passed as an argument, oxlint doesn't match the patterns against its parent directories.
    ).toEqual([notExcluded, ["gen/b.js", ...notExcluded], notExcluded, ["gen/b.js", ...notExcluded]]);
  });
});

// Uses a file with mode 000, which root could still open.
describe.skipIf(isWindows || process.getuid?.() === 0).concurrent("a file that can't be opened", () => {
  const files = { "a.js": code, "locked.js": code, "sub/b.js": code };
  const before = (dir: string) => chmodSync(join(dir, "locked.js"), 0);

  // oxlint 1.87.0: `x Failed to open file <dir>/locked.js with error "Permission denied (os error 13)"`, and
  // "Found 0 warnings and 3 errors.". Without a config file, bun lint behaves like oxlint.
  test.each([
    [".oxlintrc.json", JSON.stringify({ ...noVar, categories: { correctness: "off" } })],
    ["bunfig.toml", `[lint.rules]\n"no-var" = "error"\n`],
    [".keep", ""],
  ])("is reported as an error, and the other files are linted: %s", async (name, text) => {
    for (const args of [["."], ["locked.js", "a.js", "sub"]]) {
      const { problems, stdout, exitCode } = await lint({ ...files, [name]: text }, args, { before });
      expect(stdout).toContain("Failed to open file <dir>/locked.js with error ");
      expect(stdout).toContain("Permission denied (os error 13)");
      expect(problems).toContain(`${name === ".oxlintrc.json" ? "" : "locked.js"}:0:0 -`);
      // With an oxlint config, the problem doesn't belong to any file.
      expect([...new Set(problems.map(it => it.split(":")[0]))]).toEqual(
        [name === ".oxlintrc.json" ? "" : "locked.js", "a.js", "sub/b.js"].sort(),
      );
      expect(exitCode).toBe(1);
    }
  });

  // oxlint 1.87.0 has two kinds of problems without a location: one has no filename, the other has an empty filename.
  test("has no filename in oxlint's JSON, unlike the problems about suppressions, which have an empty one", async () => {
    const config = JSON.stringify({ ...noVar, categories: { correctness: "off" } });
    const stale = JSON.stringify({ "sub/b.js": { "no-debugger": { count: 1 } } });
    const all = { ...files, ".oxlintrc.json": config, "oxlint-suppressions.json": stale };
    const { raw } = await lint(all, ["-f", "json", "."], { before });
    type Diagnostic = { message: string; filename?: string; labels: unknown[] };
    const withoutLabels = (JSON.parse(raw).diagnostics as Diagnostic[]).filter(it => it.labels.length === 0);
    expect(withoutLabels.map(it => [it.message.split(" ").slice(0, 4).join(" "), it.filename])).toEqual([
      ["Failed to open file", undefined],
      ["There are suppressions that", ""],
      ["There are new violations", ""],
    ]);
  });

  // ESLint 10.12.0 and 8.57.1: "Error: EACCES: permission denied, open '<dir>/locked.js'", and nothing else.
  test.each([
    ["eslint.config.js", `export default [${JSON.stringify(noVar)}];`],
    [".eslintrc.json", rc(noVar)],
  ])("ends the run: %s", async (name, text) => {
    const { problems, stderr, exitCode } = await lint({ ...files, [name]: text }, ["."], { before });
    expect(stderr).toContain("Cannot read <dir>/locked.js: EACCES: ");
    expect({ problems, exitCode }).toEqual({ problems: [], exitCode: 2 });
  });
});

describe.concurrent("paths", () => {
  test("`ignorePatterns` in a --config file don't apply to files outside that file's directory", async () => {
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

// Same as ESLint 10.12.0 and 9.39.5. `{ max: Infinity }` is how people switch off a limit. ajv accepts it as an
// integer, and prints values the way `JSON.stringify` does.
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
  ] as [string, string[] | string][])("as a rule option: %s", async (rule, expected) => {
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

  // ESLint passes options through `structuredClone`, and ajv sees a `Map` as an object without properties.
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
  ] as [string, string[] | string][])("other values that JSON can't represent: %s", async (rule, expected) => {
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

  test("a JavaScript rule gets the original values in its options and settings", async () => {
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
