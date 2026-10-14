// A `with` clause can be nested in another one: a value in the options of an import type can hold an import type that has
// options of its own. TypeScript reports values that aren't strings, but every parser accepts them, so rules and plugins see them.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

type Case = {
  code: string;
  /** Every node a plugin's listeners are called with, indented by its number of ancestors. */
  tree: string;
  /** The names in the options, `with` included. */
  keys: string[];
  /** The values in the options. */
  values: string[];
};

// `tree` is what oxlint 1.87.0 and ESLint 10.12.0 with @typescript-eslint/parser 8.71.1 both print with the plugin below.
// `keys` and `values` are what that ESLint reports with the rules below.
const cases: Record<string, Case> = {
  "single.ts": {
    code: `type A = import("./a", { with: { x: "1", y: "2" } });`,
    tree: `
Program
  TSTypeAliasDeclaration
    Identifier A
    TSImportType
      Literal "./a"
      ObjectExpression
        Property
          Identifier with
          ObjectExpression
            Property
              Identifier x
              Literal "1"
            Property
              Identifier y
              Literal "2"
`,
    keys: ["with", "x", "y"],
    values: [`"1"`, `"2"`],
  },
  "side-by-side.ts": {
    code: `type A = [import("./a", { with: { x: "1" } }), import("./b", { with: { y: "2" } })];`,
    tree: `
Program
  TSTypeAliasDeclaration
    Identifier A
    TSTupleType
      TSImportType
        Literal "./a"
        ObjectExpression
          Property
            Identifier with
            ObjectExpression
              Property
                Identifier x
                Literal "1"
      TSImportType
        Literal "./b"
        ObjectExpression
          Property
            Identifier with
            ObjectExpression
              Property
                Identifier y
                Literal "2"
`,
    keys: ["with", "x", "with", "y"],
    values: [`"1"`, `"2"`],
  },
  "in-type-arguments.ts": {
    code: `type A = import("./a", { with: { outer: "1" } })<import("./c", { with: { inner: "2" } })>;`,
    tree: `
Program
  TSTypeAliasDeclaration
    Identifier A
    TSImportType
      Literal "./a"
      ObjectExpression
        Property
          Identifier with
          ObjectExpression
            Property
              Identifier outer
              Literal "1"
      TSTypeParameterInstantiation
        TSImportType
          Literal "./c"
          ObjectExpression
            Property
              Identifier with
              ObjectExpression
                Property
                  Identifier inner
                  Literal "2"
`,
    keys: ["with", "outer", "with", "inner"],
    values: [`"1"`, `"2"`],
  },
  "only-in-type-arguments.ts": {
    code: `type A = import("./a")<import("./c", { with: { inner: "2" } })>;`,
    tree: `
Program
  TSTypeAliasDeclaration
    Identifier A
    TSImportType
      Literal "./a"
      TSTypeParameterInstantiation
        TSImportType
          Literal "./c"
          ObjectExpression
            Property
              Identifier with
              ObjectExpression
                Property
                  Identifier inner
                  Literal "2"
`,
    keys: ["with", "inner"],
    values: [`"2"`],
  },
  "nested.ts": {
    code: `type N = import("./a", { with: { k: 0 as import("./c", { with: { inner: 1 } }), outer: 2 } });`,
    tree: `
Program
  TSTypeAliasDeclaration
    Identifier N
    TSImportType
      Literal "./a"
      ObjectExpression
        Property
          Identifier with
          ObjectExpression
            Property
              Identifier k
              TSAsExpression
                Literal 0
                TSImportType
                  Literal "./c"
                  ObjectExpression
                    Property
                      Identifier with
                      ObjectExpression
                        Property
                          Identifier inner
                          Literal 1
            Property
              Identifier outer
              Literal 2
`,
    keys: ["with", "k", "with", "inner", "outer"],
    values: [`0 as import("./c", { with: { inner: 1 } })`, `1`, `2`],
  },
  "nested-last.ts": {
    code: `type N = import("./a", { with: { outer: 2, k: 0 as import("./c", { with: { inner: 1 } }) } });`,
    tree: `
Program
  TSTypeAliasDeclaration
    Identifier N
    TSImportType
      Literal "./a"
      ObjectExpression
        Property
          Identifier with
          ObjectExpression
            Property
              Identifier outer
              Literal 2
            Property
              Identifier k
              TSAsExpression
                Literal 0
                TSImportType
                  Literal "./c"
                  ObjectExpression
                    Property
                      Identifier with
                      ObjectExpression
                        Property
                          Identifier inner
                          Literal 1
`,
    keys: ["with", "outer", "k", "with", "inner"],
    values: [`2`, `0 as import("./c", { with: { inner: 1 } })`, `1`],
  },
  "after-an-import-type.ts": {
    code: `type B = import("./b", { with: { before: "0" } });
type N = import("./a", { with: { k: 0 as import("./c", { with: { inner: 1 } }), outer: 2 } });`,
    tree: `
Program
  TSTypeAliasDeclaration
    Identifier B
    TSImportType
      Literal "./b"
      ObjectExpression
        Property
          Identifier with
          ObjectExpression
            Property
              Identifier before
              Literal "0"
  TSTypeAliasDeclaration
    Identifier N
    TSImportType
      Literal "./a"
      ObjectExpression
        Property
          Identifier with
          ObjectExpression
            Property
              Identifier k
              TSAsExpression
                Literal 0
                TSImportType
                  Literal "./c"
                  ObjectExpression
                    Property
                      Identifier with
                      ObjectExpression
                        Property
                          Identifier inner
                          Literal 1
            Property
              Identifier outer
              Literal 2
`,
    keys: ["with", "before", "with", "k", "with", "inner", "outer"],
    values: [`"0"`, `0 as import("./c", { with: { inner: 1 } })`, `1`, `2`],
  },
  "after-an-import.ts": {
    code: `import data from "./d.json" with { type: "json" };
type N = import("./a", { with: { k: 0 as import("./c", { with: { inner: 1 } }), outer: 2 } });`,
    tree: `
Program
  ImportDeclaration
    ImportDefaultSpecifier
      Identifier data
    Literal "./d.json"
    ImportAttribute
      Identifier type
      Literal "json"
  TSTypeAliasDeclaration
    Identifier N
    TSImportType
      Literal "./a"
      ObjectExpression
        Property
          Identifier with
          ObjectExpression
            Property
              Identifier k
              TSAsExpression
                Literal 0
                TSImportType
                  Literal "./c"
                  ObjectExpression
                    Property
                      Identifier with
                      ObjectExpression
                        Property
                          Identifier inner
                          Literal 1
            Property
              Identifier outer
              Literal 2
`,
    keys: ["with", "k", "with", "inner", "outer"],
    values: [`0 as import("./c", { with: { inner: 1 } })`, `1`, `2`],
  },
  "two-nested.ts": {
    code: `const q = 1;
type T = import("./m", { with: { a: 0 as import("./n", { with: { x: () => q } }), b: 0 as import("./o", { with: { y: () => q } }), c: () => q } });`,
    tree: `
Program
  VariableDeclaration
    VariableDeclarator
      Identifier q
      Literal 1
  TSTypeAliasDeclaration
    Identifier T
    TSImportType
      Literal "./m"
      ObjectExpression
        Property
          Identifier with
          ObjectExpression
            Property
              Identifier a
              TSAsExpression
                Literal 0
                TSImportType
                  Literal "./n"
                  ObjectExpression
                    Property
                      Identifier with
                      ObjectExpression
                        Property
                          Identifier x
                          ArrowFunctionExpression
                            Identifier q
            Property
              Identifier b
              TSAsExpression
                Literal 0
                TSImportType
                  Literal "./o"
                  ObjectExpression
                    Property
                      Identifier with
                      ObjectExpression
                        Property
                          Identifier y
                          ArrowFunctionExpression
                            Identifier q
            Property
              Identifier c
              ArrowFunctionExpression
                Identifier q
`,
    keys: ["with", "a", "with", "x", "b", "with", "y", "c"],
    values: [
      `0 as import("./n", { with: { x: () => q } })`,
      `() => q`,
      `0 as import("./o", { with: { y: () => q } })`,
      `() => q`,
      `() => q`,
    ],
  },
  "three-deep.ts": {
    code: `const q = 1;
type T = import("./m", { with: { a: 0 as import("./n", { with: { x: 0 as import("./o", { with: { y: () => q } }), x2: () => q } }), c: () => q } });`,
    tree: `
Program
  VariableDeclaration
    VariableDeclarator
      Identifier q
      Literal 1
  TSTypeAliasDeclaration
    Identifier T
    TSImportType
      Literal "./m"
      ObjectExpression
        Property
          Identifier with
          ObjectExpression
            Property
              Identifier a
              TSAsExpression
                Literal 0
                TSImportType
                  Literal "./n"
                  ObjectExpression
                    Property
                      Identifier with
                      ObjectExpression
                        Property
                          Identifier x
                          TSAsExpression
                            Literal 0
                            TSImportType
                              Literal "./o"
                              ObjectExpression
                                Property
                                  Identifier with
                                  ObjectExpression
                                    Property
                                      Identifier y
                                      ArrowFunctionExpression
                                        Identifier q
                        Property
                          Identifier x2
                          ArrowFunctionExpression
                            Identifier q
            Property
              Identifier c
              ArrowFunctionExpression
                Identifier q
`,
    keys: ["with", "a", "with", "x", "with", "y", "x2", "c"],
    values: [
      `0 as import("./n", { with: { x: 0 as import("./o", { with: { y: () => q } }), x2: () => q } })`,
      `0 as import("./o", { with: { y: () => q } })`,
      `() => q`,
      `() => q`,
      `() => q`,
    ],
  },
  "in-a-function.ts": {
    code: `type T = import("./m", { with: { a: () => { let u: import("./n", { with: { b: { x: 1 }, c: () => 2 } }); return u; } } });`,
    tree: `
Program
  TSTypeAliasDeclaration
    Identifier T
    TSImportType
      Literal "./m"
      ObjectExpression
        Property
          Identifier with
          ObjectExpression
            Property
              Identifier a
              ArrowFunctionExpression
                BlockStatement
                  VariableDeclaration
                    VariableDeclarator
                      Identifier u
                        TSTypeAnnotation
                          TSImportType
                            Literal "./n"
                            ObjectExpression
                              Property
                                Identifier with
                                ObjectExpression
                                  Property
                                    Identifier b
                                    ObjectExpression
                                      Property
                                        Identifier x
                                        Literal 1
                                  Property
                                    Identifier c
                                    ArrowFunctionExpression
                                      Literal 2
                  ReturnStatement
                    Identifier u
`,
    keys: ["with", "a", "with", "b", "x", "c"],
    values: [`() => { let u: import("./n", { with: { b: { x: 1 }, c: () => 2 } }); return u; }`, `{ x: 1 }`, `() => 2`],
  },
  "quoted.ts": {
    code: `type N = import("./a", { with: { "k": 0 as import("./c", { with: { "inner": "v1" } }), "outer": "v2" } });`,
    tree: `
Program
  TSTypeAliasDeclaration
    Identifier N
    TSImportType
      Literal "./a"
      ObjectExpression
        Property
          Identifier with
          ObjectExpression
            Property
              Literal "k"
              TSAsExpression
                Literal 0
                TSImportType
                  Literal "./c"
                  ObjectExpression
                    Property
                      Identifier with
                      ObjectExpression
                        Property
                          Literal "inner"
                          Literal "v1"
            Property
              Literal "outer"
              Literal "v2"
`,
    keys: ["with", "with"],
    values: [`0 as import("./c", { with: { "inner": "v1" } })`, `"v1"`, `"v2"`],
  },
  "quoted-after-an-import.ts": {
    code: `import data from "./d.json" with { "type": "json" };
type N = import("./a", { with: { "k": 0 as import("./c", { with: { "inner": "v1" } }), "outer": "v2" } });`,
    tree: `
Program
  ImportDeclaration
    ImportDefaultSpecifier
      Identifier data
    Literal "./d.json"
    ImportAttribute
      Literal "type"
      Literal "json"
  TSTypeAliasDeclaration
    Identifier N
    TSImportType
      Literal "./a"
      ObjectExpression
        Property
          Identifier with
          ObjectExpression
            Property
              Literal "k"
              TSAsExpression
                Literal 0
                TSImportType
                  Literal "./c"
                  ObjectExpression
                    Property
                      Identifier with
                      ObjectExpression
                        Property
                          Literal "inner"
                          Literal "v1"
            Property
              Literal "outer"
              Literal "v2"
`,
    keys: ["with", "with"],
    values: [`0 as import("./c", { with: { "inner": "v1" } })`, `"v1"`, `"v2"`],
  },
};

const files = Object.fromEntries(Object.entries(cases).map(([name, it]) => [name, it.code + "\n"]));
const names = Object.keys(cases);

// Each thread that runs a plugin starts a VM, which takes seconds in a debug build.
const timeout = isDebug || isASAN ? 120_000 : 10_000;

type Message = { ruleId: string; message: string; line: number; column: number; endColumn: number };

/** Lints every case in a directory that also has the files in `more`. */
async function lint(more: Record<string, string>) {
  using dir = tempDir("bun-lint-import-attributes", { ...files, ...more });
  await using proc = spawn({
    cmd: [bunExe(), "lint", "--threads", "2", "-f", "json", ...names],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  return { stdout, exitCode };
}

const typescript = `files: ["**/*.ts"], languageOptions: { parser: { meta: { name: "typescript-eslint/parser" } } }`;

describe.concurrent("import types with options inside the options of an import type", () => {
  const plugin = `
    const depth = node => (node.parent ? depth(node.parent) + 1 : 0);
    const label = node => (node.type === "Identifier" ? " " + node.name : node.type === "Literal" ? " " + node.raw : "");
    export default {
      meta: { name: "tree" },
      rules: {
        print: {
          create(context) {
            const lines = [];
            return {
              "*": node => void lines.push("  ".repeat(depth(node)) + node.type + label(node)),
              "Program:exit": node => context.report({ node, message: lines.join("\\n") }),
            };
          },
        },
      },
    };`;
  const expected = Object.fromEntries(names.map(name => [name, [cases[name].tree.trim()]]));

  test(
    "plugins get oxlint's tree with an .oxlintrc.json",
    async () => {
      const config = {
        jsPlugins: ["./plugin.mjs"],
        categories: { correctness: "off" },
        rules: { "tree/print": "error" },
      };
      const { stdout, exitCode } = await lint({ "plugin.mjs": plugin, ".oxlintrc.json": JSON.stringify(config) });
      const found: { filename: string; message: string }[] = JSON.parse(stdout).diagnostics;
      const printed = names.map(name => [name, found.filter(it => it.filename === name).map(it => it.message)]);
      expect(Object.fromEntries(printed)).toEqual(expected);
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "plugins get typescript-eslint's tree with an eslint.config.mjs",
    async () => {
      const config = `import tree from "./plugin.mjs";
        export default [{ ${typescript}, plugins: { tree }, rules: { "tree/print": "error" } }];`;
      const { stdout, exitCode } = await lint({ "plugin.mjs": plugin, "eslint.config.mjs": config });
      expect(byFile(stdout, it => it.message)).toEqual(expected);
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  /** `show` of each message, by the name of the file. */
  function byFile<T>(stdout: string, show: (message: Message, name: string) => T) {
    const results: { filePath: string; messages: Message[] }[] = JSON.parse(stdout);
    const of = (name: string) =>
      results.find(it => it.filePath.replaceAll("\\", "/").endsWith("/" + name))?.messages ?? [];
    return Object.fromEntries(names.map(name => [name, of(name).map(it => show(it, name))]));
  }

  /** What each rule reports in each file: the text of the reported range. None spans lines. */
  async function reported(rules: Record<string, unknown>) {
    const config = `export default [{ ${typescript}, rules: ${JSON.stringify(rules)} }];`;
    const { stdout, exitCode } = await lint({ "eslint.config.mjs": config });
    const text = (it: Message, name: string) =>
      files[name].split("\n")[it.line - 1].slice(it.column - 1, it.endColumn - 1);
    const all = byFile(stdout, (it, name) => ({ rule: it.ruleId, text: text(it, name) }));
    const of = (rule: string) =>
      Object.fromEntries(names.map(name => [name, all[name].filter(it => it.rule === rule).map(it => it.text)]));
    return { of, exitCode };
  }

  test("rules that read the options of an import type get each name once", async () => {
    const keys = [...new Set(names.flatMap(name => cases[name].keys))];
    const { of, exitCode } = await reported({
      "id-denylist": ["error", ...keys],
      "id-match": ["error", `^(?!(?:${keys.join("|")})$)`, { properties: true }],
      "id-length": ["error", { min: 20, exceptionPatterns: ["^[A-Z]$", "^(?:q|u|data)$"] }],
    });
    const expected = Object.fromEntries(names.map(name => [name, cases[name].keys]));
    expect(of("id-denylist")).toEqual(expected);
    expect(of("id-match")).toEqual(expected);
    expect(of("id-length")).toEqual(expected);
    expect(exitCode).toBe(1);
  });

  test("the way up from a value leads through the options of its own import type", async () => {
    const value = "TSImportType > ObjectExpression > Property > ObjectExpression > Property > .value";
    const { of, exitCode } = await reported({ "no-restricted-syntax": ["error", value] });
    expect(of("no-restricted-syntax")).toEqual(Object.fromEntries(names.map(name => [name, cases[name].values])));
    expect(exitCode).toBe(1);
  });

  test("rules that listen to string literals get each quoted string once", async () => {
    const patterns = [{ pattern: "^.*$", message: "A string.", in: ["strings"] }];
    const { of, exitCode } = await reported({ "bun/no-restricted-text": ["error", { patterns }] });
    const quoted = (code: string) => Array.from(code.matchAll(/"([^"]*)"/g), it => it[1]);
    expect(of("bun/no-restricted-text")).toEqual(Object.fromEntries(names.map(name => [name, quoted(files[name])])));
    expect(exitCode).toBe(1);
  });
});
