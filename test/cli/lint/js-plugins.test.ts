import { afterAll, describe, expect, test } from "bun:test";
import { bunExe, isASAN, isDebug, isLinux, tempDir } from "harness";
import { mkdirSync, readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { endChildren, spawn } from "../children";
import { env, lint, noFoo, oxlintrc, timeout } from "./js-plugins";

afterAll(endChildren);

// Same as under ESLint 10.12.0.
test.concurrent(
  "a plugin's `process.env` has the inherited variables but not the project's .env",
  async () => {
    const files = {
      ".env": "FROM_FILE=1\n",
      "plugin.mjs": `const message = () => process.env.FROM_FILE + " " + process.env.INHERITED;
        export default { rules: { show: { create: context => ({ Program: node => context.report({ node, message: message() }) }) } } };`,
      "eslint.config.mjs": `import demo from "./plugin.mjs";
        export default [{ plugins: { demo }, rules: { "demo/show": "error" } }];`,
      "a.js": "a;\n",
    };
    const { raw, exitCode } = await lint(files, ["-f", "json", "a.js"], [], { INHERITED: "1" });
    expect(JSON.parse(raw)[0].messages.map((it: { message: string }) => it.message)).toEqual(["undefined 1"]);
    expect(exitCode).toBe(1);
  },
  timeout,
);

// Same as under ESLint 10.12.0. eslint-plugin-import-x looks for its "node" resolver in `<package directory>/node`.
test.concurrent(
  "`require.resolve()` in an installed plugin doesn't find the project's TypeScript files without their extension",
  async () => {
    const files = {
      "node_modules/eslint-plugin-demo/package.json": `{ "name": "eslint-plugin-demo", "main": "index.js" }`,
      "node_modules/eslint-plugin-demo/index.js": `const path = require("node:path");
        const find = name => {
          try {
            return path.relative(process.cwd(), require.resolve(path.resolve(name))).replaceAll(path.sep, "/");
          } catch (error) {
            return error.code;
          }
        };
        const all = () => ["node", "file", "file.ts", "js"].map(find).join(" ");
        const create = context => ({ Program: node => context.report({ node, message: context.options[0] + ", " + all() }) });
        module.exports = { found: all(), rules: { show: { meta: { schema: false }, create } } };`,
      "node/index.ts": "export {};\n",
      "file.ts": "export {};\n",
      "js/index.js": "",
      // The option is what the plugin finds while the configuration is read.
      "eslint.config.mjs": `import demo from "eslint-plugin-demo";
        export default [{ plugins: { demo }, rules: { "demo/show": ["error", demo.found] } }];`,
      "a.js": "a;\n",
    };
    const { raw, exitCode } = await lint(files, ["-f", "json", "a.js"]);
    const found = "MODULE_NOT_FOUND MODULE_NOT_FOUND file.ts js/index.js";
    expect(JSON.parse(raw)[0].messages.map((it: { message: string }) => it.message)).toEqual([`${found}, ${found}`]);
    expect(exitCode).toBe(1);
  },
  timeout,
);

describe.concurrent("bun lint with JavaScript plugins", () => {
  test(
    "jsPlugins in an .oxlintrc.json: messages, data, and options with the schema's defaults",
    async () => {
      const { stdout, exitCode } = await lint(
        {
          ".oxlintrc.json": oxlintrc({
            jsPlugins: ["./plugin.mjs"],
            rules: { "demo/no-foo": "error" },
            overrides: [{ files: ["b.ts"], rules: { "demo/no-foo": ["warn", { suffix: "!" }] } }],
          }),
          "plugin.mjs": noFoo,
          "a.js": "foo();\nlet é = '😀', x = foo.foo;\n",
          "b.ts": "const a: foo = 1 as foo;\n",
        },
        ["-f", "unix"],
      );
      expect(stdout).toMatchInlineSnapshot(`
      "a.js:1:1: No foo in a CallExpression. [Error/demo(no-foo)]
      a.js:2:22: No foo in a MemberExpression. [Error/demo(no-foo)]
      a.js:2:26: No foo in a MemberExpression. [Error/demo(no-foo)]
      b.ts:1:10: No foo in a TSTypeReference! [Warning/demo(no-foo)]
      b.ts:1:21: No foo in a TSTypeReference! [Warning/demo(no-foo)]

      5 problems"
    `);
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "--fix applies a rule's fixes, also after non-ASCII characters",
    async () => {
      const { files, exitCode } = await lint(
        {
          ".oxlintrc.json": oxlintrc({ jsPlugins: ["./plugin.mjs"], rules: { "demo/no-foo": "error" } }),
          "plugin.mjs": noFoo,
          "a.js": "﻿let é = '😀', x = foo.foo;\n",
        },
        ["--fix"],
        ["a.js"],
      );
      expect(files["a.js"]).toBe("﻿let é = '😀', x = bar.bar;\n");
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  // https://github.com/oven-sh/bun/issues/45154
  test(
    "loads a package in jsPlugins whose `exports` only has an `import` condition",
    async () => {
      const { stdout, exitCode } = await lint(
        {
          ".oxlintrc.json": oxlintrc({ jsPlugins: ["p"], rules: { "demo/no-foo": "error" } }),
          "node_modules/p/package.json": `{ "name": "p", "type": "module", "exports": { ".": { "import": "./i.js" } } }`,
          "node_modules/p/i.js": noFoo,
          "a.js": "foo;\n",
        },
        ["-f", "unix"],
      );
      expect(stdout).toMatchInlineSnapshot(`
      "a.js:1:1: No foo in a ExpressionStatement. [Error/demo(no-foo)]

      1 problem"
    `);
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "comments disable and configure a plugin's rule",
    async () => {
      const { stdout, exitCode } = await lint(
        {
          ".oxlintrc.json": oxlintrc({ jsPlugins: ["./plugin.mjs"], rules: { "demo/no-foo": "error" } }),
          "plugin.mjs": noFoo,
          "a.js": "foo; // oxlint-disable-line demo/no-foo\n// eslint-disable-next-line demo/no-foo\nfoo;\nfoo;\n",
        },
        ["-f", "unix"],
      );
      expect(stdout).toMatchInlineSnapshot(`
      "a.js:4:1: No foo in a ExpressionStatement. [Error/demo(no-foo)]

      1 problem"
    `);
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "supports selectors and :exit, and calls listeners in order",
    async () => {
      const plugin = `
      export default {
        meta: { name: "order" },
        rules: {
          trace: {
            create(context) {
              const seen = [];
              const note = name => node => seen.push(name + "@" + node.range[0]);
              return {
                "*": note("*"),
                CallExpression: note("call"),
                "CallExpression[callee.name='a']": note("a()"),
                "CallExpression > Identifier": note("child"),
                ":matches(Literal, Identifier):exit": note("leaf:exit"),
                "CallExpression:exit": note("call:exit"),
                "Program:exit"(node) {
                  context.report({ node, message: seen.join(" ") });
                },
              };
            },
          },
        },
      };`;
      const { stdout } = await lint(
        {
          ".oxlintrc.json": oxlintrc({ jsPlugins: ["./plugin.mjs"], rules: { "order/trace": "error" } }),
          "plugin.mjs": plugin,
          "a.js": "a(b(1));\n",
        },
        ["-f", "unix"],
      );
      expect(stdout).toMatchInlineSnapshot(`
      "a.js:1:1: *@0 *@0 *@0 call@0 a()@0 *@0 child@0 leaf:exit@0 *@2 call@2 *@2 child@2 leaf:exit@2 *@4 leaf:exit@4 call:exit@2 call:exit@0 [Error/order(trace)]

      1 problem"
    `);
    },
    timeout,
  );

  // eslint-plugin-sonarjs parses the text of a comment and asks for its tokens that way. The answers are those of ESLint 9.39.5.
  test(
    "new sourceCode.constructor(text, ast) is about the code that the rule has parsed",
    async () => {
      const plugin = `
      const token = (type, value, start) => ({ type, value, range: [start, start + value.length], loc: {} });
      export default {
        meta: { name: "api" },
        rules: {
          dump: {
            create(context) {
              return {
                Program(node) {
                  const text = "a(b); // c\\nd";
                  const tokens = [
                    token("Identifier", "a", 0),
                    token("Punctuator", "(", 1),
                    token("Identifier", "b", 2),
                    token("Punctuator", ")", 3),
                    token("Punctuator", ";", 4),
                    token("Identifier", "d", 11),
                  ];
                  const comments = [{ type: "Line", value: " c", range: [6, 10], loc: {} }];
                  const [first, second] = [{ type: "ExpressionStatement", range: [0, 5] }, { type: "ExpressionStatement", range: [11, 12] }];
                  const ast = { type: "Program", body: [first, second], tokens, comments, range: [0, 12], loc: {} };
                  const SourceCode = context.sourceCode.constructor;
                  const parsed = new SourceCode(text, ast);
                  const values = found => found.map(it => it.value);
                  const isSemicolon = it => it.value === ";";
                  const errorOf = run => {
                    try {
                      run();
                    } catch (thrown) {
                      return thrown.message;
                    }
                  };
                  context.report({
                    node,
                    message: JSON.stringify({
                      name: SourceCode.name,
                      isInstance: context.sourceCode instanceof SourceCode,
                      split: SourceCode.splitLines("a\\nb"),
                      own: new SourceCode().text,
                      text: parsed.text,
                      lines: parsed.lines,
                      isSameAst: parsed.ast === ast,
                      semicolons: [parsed.getLastToken(first, isSemicolon)?.value, parsed.getLastToken(second, isSemicolon)],
                      firstText: parsed.getText(first),
                      tokens: values(parsed.getTokens(first)),
                      lastTwo: values(parsed.getLastTokens(first, 2)),
                      after: [parsed.getTokenAfter(first).value, parsed.getTokenAfter(first, { includeComments: true }).value],
                      before: values(parsed.getCommentsBefore(second)),
                      between: parsed.commentsExistBetween(first, second),
                      all: values(parsed.tokensAndComments),
                      nodes: [0, 4, 5, 11].map(index => parsed.getNodeByRangeIndex(index)?.range ?? null),
                      locations: [0, 10, 11, 12].map(index => parsed.getLocFromIndex(index)),
                      indices: [parsed.getIndexFromLoc({ line: 1, column: 4 }), parsed.getIndexFromLoc({ line: 2, column: 1 })],
                      spaces: [parsed.isSpaceBetween(tokens[0], tokens[1]), parsed.isSpaceBetween(second, first)],
                      ancestors: parsed.getAncestors({ parent: { type: "A", parent: { type: "B" } } }).map(it => it.type),
                      errors: [
                        errorOf(() => new SourceCode(text, { type: "Program" })),
                        errorOf(() => parsed.getLocFromIndex(13)),
                        errorOf(() => parsed.getIndexFromLoc({ line: 1, column: 11 })),
                        errorOf(() => parsed.getScope(first)),
                      ],
                    }),
                  });
                },
              };
            },
          },
        },
      };`;
      const { raw } = await lint(
        {
          ".oxlintrc.json": oxlintrc({ jsPlugins: ["./plugin.mjs"], rules: { "api/dump": "error" } }),
          "plugin.mjs": plugin,
          "a.js": "linted(1, 2, 3)\n",
        },
        ["-f", "json"],
      );
      const [{ message }] = JSON.parse(raw).diagnostics;
      expect(JSON.parse(message)).toEqual({
        name: "SourceCode",
        isInstance: true,
        split: ["a", "b"],
        own: "linted(1, 2, 3)\n",
        text: "a(b); // c\nd",
        lines: ["a(b); // c", "d"],
        isSameAst: true,
        semicolons: [";", null],
        firstText: "a(b);",
        tokens: ["a", "(", "b", ")", ";"],
        lastTwo: [")", ";"],
        after: ["d", " c"],
        before: [" c"],
        between: true,
        all: ["a", "(", "b", ")", ";", " c", "d"],
        nodes: [
          [0, 5],
          [0, 5],
          [0, 12],
          [11, 12],
        ],
        locations: [
          { line: 1, column: 0 },
          { line: 1, column: 10 },
          { line: 2, column: 0 },
          { line: 2, column: 1 },
        ],
        indices: [4, 12],
        spaces: [false, true],
        ancestors: ["B", "A"],
        errors: [
          "AST is missing the tokens array.",
          "Index out of range (requested index 13, but source text has length 12).",
          "Column number out of range (column 11 requested, but the length of line 1 is 11).",
          "sourceCode.getScope() needs scopes, which bun lint does not have for code that a rule has parsed",
        ],
      });
    },
    timeout,
  );

  // From ESLint 8.57.1, 9.39.5 and 10.12.0, with their own parser.
  test.each([
    ["8.57.1", { "a.js": [6, 8], "b.cjs": [22, 26], "c.mjs": [0, 18], "d.js": [0, 0] }],
    ["9.39.5", { "a.js": [6, 8], "b.cjs": [22, 26], "c.mjs": [0, 18], "d.js": [0, 0] }],
    ["10.12.0", { "a.js": [0, 15], "b.cjs": [0, 29], "c.mjs": [0, 18], "d.js": [0, 0] }],
  ])(
    "the Program of the default parser and its parserOptions are those of eslint %s",
    async (version, ranges) => {
      const { raw } = await lint(
        {
          "eslint.config.mjs": `
            const dump = {
              create: context => ({
                Program(node) {
                  const { parserOptions, sourceType } = context.languageOptions;
                  const message = JSON.stringify({ range: node.range, end: node.loc.end, parserOptions, sourceType });
                  context.report({ node, message });
                },
              }),
            };
            export default [{
              files: ["?.*"],
              plugins: { api: { rules: { dump } } },
              languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
              rules: { "api/dump": "error" },
            }];`,
          "node_modules/eslint/package.json": JSON.stringify({ name: "eslint", version }),
          "a.js": "// c\n\na;\n// d\n\n",
          "b.cjs": "#!/usr/bin/env node\n  a; b  \n",
          "c.mjs": "// only a comment\n",
          "d.js": "",
        },
        ["-f", "json", "a.js", "b.cjs", "c.mjs", "d.js"],
      );
      const found = (JSON.parse(raw) as any[]).map(file => ({
        ...file.messages[0],
        ...JSON.parse(file.messages[0].message),
      }));
      expect(found.map(it => it.range)).toEqual(Object.values(ranges));
      expect(found.map(it => [it.endLine, it.endColumn])).toEqual(found.map(it => [it.end.line, it.end.column + 1]));
      expect(found.map(it => it.sourceType)).toEqual(["module", "commonjs", "module", "module"]);
      expect(found.map(it => it.parserOptions)).toEqual(
        found.map(it => ({ ecmaFeatures: { jsx: true }, sourceType: it.sourceType })),
      );
    },
    timeout,
  );

  // From ESLint 9.39.5 and 10.12.0 with @typescript-eslint/parser 8.71.1. `Promise` is only a type in the parser's libraries.
  // ESLint's own parser has no libraries.
  test.each([
    ["9.39.5", "a.ts", "through Foo:4 baz:5, Promise 1 4 2"],
    ["10.12.0", "a.ts", "through Promise:2 Foo:4 baz:5, Promise 1 4"],
    ["9.39.5", "a.js", "through Promise:1 baz:2, Promise none"],
    ["10.12.0", "a.js", "through Promise:1 baz:2, Promise none"],
  ])(
    "before ESLint 10, a value resolves to a type of TypeScript's libraries: eslint %s, %s",
    async (version, name, expected) => {
      const { raw } = await lint(
        {
          "eslint.config.mjs": `const globals = {
              create: context => ({
                "Program:exit"(node) {
                  const scope = context.sourceCode.scopeManager.globalScope;
                  const line = it => it.identifier.loc.start.line;
                  const through = scope.through.map(it => it.identifier.name + ":" + line(it)).join(" ");
                  const references = scope.set.get("Promise")?.references.map(line).join(" ") ?? "none";
                  context.report({ node, message: "through " + through + ", Promise " + references });
                },
              }),
            };
            export default [{
              files: ["a.*"],
              languageOptions: { ecmaVersion: 5, sourceType: "script" },
              plugins: { demo: { rules: { globals } } },
              rules: { "demo/globals": "error" },
            }];`,
          "node_modules/eslint/package.json": JSON.stringify({ name: "eslint", version }),
          "a.ts":
            "function f<T>(): Promise<T> {\n  return Promise.resolve({} as T);\n}\ntype A = () => Promise<Foo>;\nbaz(f);\n",
          "a.js": "Promise.resolve(1);\nbaz();\n",
        },
        ["-f", "json", name],
      );
      expect(JSON.parse(raw)[0].messages.map((it: { message: string }) => it.message)).toEqual([expected]);
    },
    timeout,
  );

  // From ESLint 9.39.5 and 10.12.0 with @typescript-eslint/parser 8.71.1. `Promise` is only a type in the parser's libraries.
  // ESLint's own parser has no libraries.
  test.each([
    ["9.39.5", "a.ts", "through Foo:4 baz:5, Promise 1 4 2"],
    ["10.12.0", "a.ts", "through Promise:2 Foo:4 baz:5, Promise 1 4"],
    ["9.39.5", "a.js", "through Promise:1 baz:2, Promise none"],
    ["10.12.0", "a.js", "through Promise:1 baz:2, Promise none"],
  ])(
    "before ESLint 10, a value resolves to a type of TypeScript's libraries: eslint %s, %s",
    async (version, name, expected) => {
      const { raw } = await lint(
        {
          "eslint.config.mjs": `const globals = {
              create: context => ({
                "Program:exit"(node) {
                  const scope = context.sourceCode.scopeManager.globalScope;
                  const line = it => it.identifier.loc.start.line;
                  const through = scope.through.map(it => it.identifier.name + ":" + line(it)).join(" ");
                  const references = scope.set.get("Promise")?.references.map(line).join(" ") ?? "none";
                  context.report({ node, message: "through " + through + ", Promise " + references });
                },
              }),
            };
            export default [{
              files: ["a.*"],
              languageOptions: { ecmaVersion: 5, sourceType: "script" },
              plugins: { demo: { rules: { globals } } },
              rules: { "demo/globals": "error" },
            }];`,
          "node_modules/eslint/package.json": JSON.stringify({ name: "eslint", version }),
          "a.ts":
            "function f<T>(): Promise<T> {\n  return Promise.resolve({} as T);\n}\ntype A = () => Promise<Foo>;\nbaz(f);\n",
          "a.js": "Promise.resolve(1);\nbaz();\n",
        },
        ["-f", "json", name],
      );
      expect(JSON.parse(raw)[0].messages.map((it: { message: string }) => it.message)).toEqual([expected]);
    },
    timeout,
  );

  // From ESLint 8.57.1, 9.39.5 and 10.12.0, and oxlint 1.87.0. `unicorn/prefer-string-slice` of eslint-plugin-unicorn 56 passes a
  // number.
  test.each([
    ["8.57.1", "1 + 2;\n", "", 0],
    ["9.39.5", "1 + 2;\n", "", 0],
    ["10.12.0", "f;\n", "'text' must be a string", 2],
    ["oxlint", "1 + 2;\n", "", 0],
  ])(
    "only ESLint 10 refuses a fix whose text isn't a string: %s",
    async (version, fixed, error, code) => {
      const number = `{
        meta: { fixable: "code" },
        create: context => ({
          Identifier: node =>
            context.report({
              node,
              message: "no",
              fix: fixer => [fixer.replaceText(node, 1), fixer.insertTextAfter(node, " + "), fixer.insertTextAfter(node, 2)],
            }),
        }),
      }`;
      const rules = { "demo/number": "error" };
      const config =
        version === "oxlint"
          ? {
              ".oxlintrc.json": oxlintrc({ jsPlugins: ["./plugin.mjs"], rules }),
              "plugin.mjs": `export default { meta: { name: "demo" }, rules: { number: ${number} } };`,
            }
          : {
              "eslint.config.mjs": `export default [{
                plugins: { demo: { rules: { number: ${number} } } },
                rules: ${JSON.stringify(rules)},
              }];`,
              "node_modules/eslint/package.json": JSON.stringify({ name: "eslint", version }),
            };
      const { files, stderr, exitCode } = await lint({ ...config, "a.js": "f;\n" }, ["--fix", "a.js"], ["a.js"]);
      expect(files).toEqual({ "a.js": fixed });
      expect(stderr).toContain(error);
      expect(exitCode).toBe(code);
    },
    timeout,
  );

  test(
    "provides tokens, comments, scopes and locations",
    async () => {
      const plugin = `
      export default {
        meta: { name: "api" },
        rules: {
          dump: {
            create(context) {
              const { sourceCode } = context;
              return {
                FunctionDeclaration(node) {
                  const scope = sourceCode.getScope(node);
                  context.report({
                    node,
                    message: JSON.stringify({
                      keys: Object.keys(node),
                      first: sourceCode.getFirstToken(node).value,
                      afterName: sourceCode.getTokenAfter(node.id, { includeComments: true }).type,
                      lastTwo: sourceCode.getLastTokens(node, 2).map(it => it.value),
                      comments: sourceCode.getAllComments().map(it => [it.type, it.value, it.loc.start.line]),
                      variables: scope.variables.map(it => [it.name, it.defs.map(def => def.type), it.references.length]),
                      through: scope.through.map(it => it.identifier.name),
                      console: sourceCode.scopeManager.globalScope.set.get("console")?.references.length,
                      declared: sourceCode.getDeclaredVariables(node).map(it => it.name),
                      ancestors: sourceCode.getAncestors(node.body).map(it => it.type),
                      text: sourceCode.getText(node.params[0]),
                      index: sourceCode.getIndexFromLoc(node.id.loc.start),
                      lines: sourceCode.lines.length,
                      filename: context.filename === context.physicalFilename && context.filename.endsWith("a.js"),
                      cwd: context.cwd === process.cwd(),
                    }),
                  });
                },
              };
            },
          },
        },
      };`;
      const { raw } = await lint(
        {
          ".oxlintrc.json": oxlintrc({
            env: { node: true },
            jsPlugins: ["./plugin.mjs"],
            rules: { "api/dump": "error" },
          }),
          "plugin.mjs": plugin,
          "a.js": "// one\nfunction f /* two */ (a = 1) {\n  let b = a + c;\n  console.log(b);\n}\n",
        },
        ["-f", "json"],
      );
      const [{ message }] = JSON.parse(raw).diagnostics;
      expect(JSON.parse(message)).toEqual({
        keys: expect.arrayContaining(["type", "id", "params", "body", "async", "generator", "range", "parent"]),
        first: "function",
        afterName: "Block",
        lastTwo: [";", "}"],
        comments: [
          ["Line", " one", 1],
          ["Block", " two ", 2],
        ],
        variables: [
          ["arguments", [], 0],
          ["a", ["Parameter"], 2],
          ["b", ["Variable"], 2],
        ],
        through: ["c", "console"],
        console: 1,
        declared: ["f", "a"],
        ancestors: ["Program", "FunctionDeclaration"],
        text: "a = 1",
        index: 16,
        lines: 6,
        filename: true,
        cwd: true,
      });
    },
    timeout,
  );

  // Same as oxlint 1.87: the mark is set on the plugin's copy of the variable, and oxlint's own rules have a separate
  // one.
  test(
    "oxlint's no-unused-vars still reports a variable that a plugin's rule marks as used",
    async () => {
      const plugin = `
      export default {
        meta: { name: "marks" },
        rules: {
          used: {
            create(context) {
              return {
                Program(node) {
                  context.sourceCode.markVariableAsUsed("a", node);
                },
              };
            },
          },
        },
      };`;
      const { stdout } = await lint(
        {
          ".oxlintrc.json": oxlintrc({
            jsPlugins: ["./plugin.mjs"],
            rules: { "marks/used": "error", "no-unused-vars": "error" },
          }),
          "plugin.mjs": plugin,
          "a.js": "const a = 1;\nconst b = 2;\n",
        },
        ["-f", "unix"],
      );
      expect(stdout.split("\n").filter(it => it.includes("no-unused-vars"))).toEqual([
        expect.stringMatching(/a\.js:1:7: .*'a'/),
        expect.stringMatching(/a\.js:2:7: .*'b'/),
      ]);
    },
    timeout,
  );

  test(
    "supports createOnce, before and after from oxlint's API",
    async () => {
      const plugin = `
      let created = 0;
      export default {
        meta: { name: "once" },
        rules: {
          count: {
            createOnce(context) {
              created++;
              let identifiers;
              return {
                before() {
                  identifiers = 0;
                  return !context.filename.endsWith("skipped.js");
                },
                Identifier() {
                  identifiers++;
                },
                after() {
                  context.report({ loc: { line: 1, column: 0 }, message: identifiers + " identifiers, created " + created + " time" });
                },
              };
            },
          },
        },
      };`;
      const { stdout } = await lint(
        {
          ".oxlintrc.json": oxlintrc({ jsPlugins: ["./plugin.mjs"], rules: { "once/count": "error" } }),
          "plugin.mjs": plugin,
          "a.js": "a;\n",
          "b.js": "a + b;\n",
          "skipped.js": "a + b + c;\n",
        },
        ["-f", "unix", "--threads", "1"],
      );
      expect(stdout).toMatchInlineSnapshot(`
      "a.js:1:1: 1 identifiers, created 1 time [Error/once(count)]
      b.js:1:1: 2 identifiers, created 1 time [Error/once(count)]

      2 problems"
    `);
    },
    timeout,
  );

  // oxlint 1.87 prints the same two reports.
  test(
    "after runs once per file, even if another rule's create threw for the previous file",
    async () => {
      const hooks = `
      let calls = 0;
      export default {
        meta: { name: "hooks" },
        rules: {
          count: {
            createOnce(context) {
              return {
                before() {
                  calls = 0;
                },
                after() {
                  context.report({ loc: { line: 1, column: 0 }, message: "after, call " + ++calls });
                },
              };
            },
          },
        },
      };`;
      const throws = `
      export default {
        meta: { name: "throws" },
        rules: {
          first: {
            create(context) {
              if (context.filename.endsWith("a.js")) throw new Error("thrown in create");
              return {};
            },
          },
        },
      };`;
      const { stdout } = await lint(
        {
          ".oxlintrc.json": oxlintrc({
            jsPlugins: ["./hooks.mjs", "./throws.mjs"],
            rules: { "hooks/count": "error", "throws/first": "error" },
          }),
          "hooks.mjs": hooks,
          "throws.mjs": throws,
          "a.js": "a;\n",
          "b.js": "b;\n",
          "c.js": "c;\n",
        },
        ["-f", "unix", "--threads", "1", "a.js", "b.js", "c.js"],
      );
      expect(stdout.split("\n").filter(line => line.includes("after, call"))).toEqual([
        "b.js:1:1: after, call 1 [Error/hooks(count)]",
        "c.js:1:1: after, call 1 [Error/hooks(count)]",
      ]);
    },
    timeout,
  );

  test(
    "loads a TypeScript plugin, a plugin from a package, and a plugin with an alias",
    async () => {
      const rule = (message: string) =>
        `{ create(context) { return { Program(node) { context.report({ node, message: ${JSON.stringify(message)} }); } }; } }`;
      const { stdout } = await lint(
        {
          ".oxlintrc.json": oxlintrc({
            jsPlugins: ["./local.ts", "eslint-plugin-packaged", { name: "other", specifier: "./aliased.cjs" }],
            rules: { "local/a": "error", "packaged/b": "error", "other/c": "error" },
          }),
          "local.ts": `const name: string = "local";\nexport default { meta: { name }, rules: { a: ${rule("typescript")} } };`,
          "node_modules/eslint-plugin-packaged/package.json": `{ "name": "eslint-plugin-packaged", "main": "index.js" }`,
          "node_modules/eslint-plugin-packaged/index.js": `module.exports = { rules: { b: ${rule("package")} } };`,
          "aliased.cjs": `module.exports = { meta: { name: "ignored" }, rules: { c: ${rule("alias")} } };`,
          "a.js": "1;\n",
        },
        ["-f", "unix", "a.js"],
      );
      expect(stdout).toMatchInlineSnapshot(`
      "a.js:1:1: typescript [Error/local(a)]
      a.js:1:1: package [Error/packaged(b)]
      a.js:1:1: alias [Error/other(c)]

      3 problems"
    `);
    },
    timeout,
  );

  // `react/jsx-one-expression-per-line` calls it like this.
  test(
    "isSpaceBetweenTokens looks inside the text between two elements, and isSpaceBetween doesn't",
    async () => {
      const { stdout, exitCode } = await lint(
        {
          "eslint.config.mjs": `
          const asks = {
            create: context => ({
              JSXElement(node) {
                const [first, , last] = node.children;
                if (last === undefined) return;
                const { sourceCode } = context;
                context.report({ node, message: sourceCode.isSpaceBetweenTokens(first, last) + " " + sourceCode.isSpaceBetween(first, last) });
              },
            }),
          };
          export default [
            { files: ["a.jsx"], languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } }, plugins: { own: { rules: { asks } } }, rules: { "own/asks": "error" } },
          ];`,
          "a.jsx": "<div>{a} {b}</div>;\n<div>{a}x{b}</div>;\n",
        },
        ["-f", "unix", "a.jsx"],
      );
      expect(stdout).toContain("a.jsx:1:1: true false [Error/own/asks]");
      expect(stdout).toContain("a.jsx:2:1: false false [Error/own/asks]");
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  // None of its rules are built in.
  test.each([
    [
      "eslint.config.mjs",
      `import regexp from "eslint-plugin-regexp";
       export default [{ plugins: { regexp }, rules: { "regexp/no-dupe-disjunctions": "error" } }];`,
      "a.js:1:1: of the package [Error/regexp/no-dupe-disjunctions]",
    ],
    [
      ".oxlintrc.json",
      oxlintrc({ jsPlugins: ["eslint-plugin-regexp"], rules: { "regexp/no-dupe-disjunctions": "error" } }),
      "a.js:1:1: of the package [Error/regexp(no-dupe-disjunctions)]",
    ],
  ])(
    "eslint-plugin-regexp is treated like any other plugin, so the project's package runs: %s",
    async (name, configuration, printed) => {
      const { stdout, stderr, exitCode } = await lint(
        {
          [name]: configuration,
          "node_modules/eslint-plugin-regexp/package.json": `{ "name": "eslint-plugin-regexp", "version": "3.0.0", "main": "index.js" }`,
          "node_modules/eslint-plugin-regexp/index.js": `
            const rule = { create: context => ({ Program: node => context.report({ node, message: "of the package" }) }) };
            module.exports = { meta: { name: "eslint-plugin-regexp", version: "3.0.0" }, rules: { "no-dupe-disjunctions": rule } };`,
          "a.js": "/a|a/;\n",
        },
        ["-f", "unix", "a.js"],
      );
      expect(stdout.split("\n").filter(it => it.includes("["))).toEqual([expect.stringContaining(printed)]);
      expect(stderr).not.toContain("note:");
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  // To oxlint, a JavaScript plugin named `n` and the built-in `node` are two separate plugins. The expected lines are
  // what oxlint 1.87 prints, sorted.
  const pluginN = {
    "n.js": `const rule = message => ({ create: context => ({ BinaryExpression(node) { context.report({ node, message }); } }) });
      export default { meta: { name: "eslint-plugin-n" }, rules: { "no-path-concat": rule("of the package"), "only-there": rule("only there") } };`,
    "a.js": `export const p = __dirname + "/x";\n`,
  };
  const withBuiltInNode = (more: object) =>
    JSON.stringify({ categories: { correctness: "off" }, plugins: ["node"], jsPlugins: ["./n.js"], ...more });
  test.each([
    [
      "both are on",
      { "rules": { "n/no-path-concat": "error", "node/no-path-concat": "warn" } },
      [
        "a.js:1:18: Use `path.join()` or `path.resolve()` instead of string concatenation [Warning/node(no-path-concat)]",
        "a.js:1:18: of the package [Error/n(no-path-concat)]",
      ],
      1,
    ],
    [
      "both are on, in the opposite order",
      { "rules": { "node/no-path-concat": "warn", "n/no-path-concat": "error" } },
      [
        "a.js:1:18: Use `path.join()` or `path.resolve()` instead of string concatenation [Warning/node(no-path-concat)]",
        "a.js:1:18: of the package [Error/n(no-path-concat)]",
      ],
      1,
    ],
    [
      "only the built-in rule is on",
      { "rules": { "node/no-path-concat": "warn" } },
      [
        "a.js:1:18: Use `path.join()` or `path.resolve()` instead of string concatenation [Warning/node(no-path-concat)]",
      ],
      0,
    ],
    [
      "only the plugin's rule is on",
      { "rules": { "n/no-path-concat": "warn" } },
      ["a.js:1:18: of the package [Warning/n(no-path-concat)]"],
      0,
    ],
    [
      "node isn't in `plugins`",
      { "plugins": [], "rules": { "n/no-path-concat": "warn", "node/no-path-concat": "error" } },
      ["a.js:1:18: of the package [Warning/n(no-path-concat)]"],
      0,
    ],
    [
      "a category turns on the built-in rule",
      { "categories": { "correctness": "off", "restriction": "warn" }, "rules": { "n/only-there": "error" } },
      [
        "a.js:1:18: Use `path.join()` or `path.resolve()` instead of string concatenation [Warning/node(no-path-concat)]",
        "a.js:1:18: only there [Error/n(only-there)]",
      ],
      1,
    ],
    [
      "an override turns off the built-in rule",
      {
        "rules": { "n/no-path-concat": "error", "node/no-path-concat": "warn" },
        "overrides": [{ "files": ["*.js"], "rules": { "node/no-path-concat": "off" } }],
      },
      ["a.js:1:18: of the package [Error/n(no-path-concat)]"],
      1,
    ],
    [
      "an override turns off the plugin's rule",
      {
        "rules": { "n/no-path-concat": "error", "node/no-path-concat": "warn" },
        "overrides": [{ "files": ["*.js"], "rules": { "n/no-path-concat": "off" } }],
      },
      [
        "a.js:1:18: Use `path.join()` or `path.resolve()` instead of string concatenation [Warning/node(no-path-concat)]",
      ],
      0,
    ],
  ] as [string, object, string[], number][])(
    "a plugin named n alongside the built-in node plugin: %s",
    async (_, more, expected, exitCode) => {
      const result = await lint({ ...pluginN, ".oxlintrc.json": withBuiltInNode(more) }, ["-f", "unix", "a.js"]);
      expect(
        result.stdout
          .split("\n")
          .filter(it => it.startsWith("a.js:"))
          .sort(),
      ).toEqual(expected);
      expect(result.exitCode).toBe(exitCode);
    },
    timeout,
  );

  // Same as oxlint 1.87, in three runs out of three.
  test(
    "at the same position, built-in rules' reports come before a plugin's",
    async () => {
      const rules = { "n/no-path-concat": "error", "n/only-there": "warn", "node/no-path-concat": "warn" };
      const { stdout } = await lint({ ...pluginN, ".oxlintrc.json": withBuiltInNode({ rules }) }, [
        "-f",
        "unix",
        "a.js",
      ]);
      expect([...stdout.matchAll(/^a\.js:1:18: .* \[\w+\/(.*)\]$/gm)].map(it => it[1])).toEqual([
        "node(no-path-concat)",
        "n(no-path-concat)",
        "n(only-there)",
      ]);
    },
    timeout,
  );

  test(
    "a plugin named n alongside the built-in node plugin: --print-config only lists the built-in rule, like oxlint",
    async () => {
      const rules = { "n/no-path-concat": "error", "node/no-path-concat": "warn" };
      const { raw } = await lint({ ...pluginN, ".oxlintrc.json": withBuiltInNode({ rules }) }, ["--print-config"]);
      expect(JSON.parse(raw).rules).toEqual({ "node/no-path-concat": "warn" });
    },
    timeout,
  );

  describe("the note about rules that ran in JavaScript although they're built in", () => {
    const rules = { "n/no-path-concat": "error" };
    const packaged = (version: string) => ({
      "a.js": pluginN["a.js"],
      "node_modules/eslint-plugin-n/package.json": JSON.stringify({
        name: "eslint-plugin-n",
        version,
        type: "module",
        main: "n.js",
      }),
      "node_modules/eslint-plugin-n/n.js": pluginN["n.js"],
    });
    const notes = async (files: Record<string, string>, more: object, ...flags: string[]) =>
      (await lint({ ...files, ".oxlintrc.json": withBuiltInNode(more) }, [...flags, "a.js"])).stderr
        .split("\n")
        .filter(it => it.startsWith("note: ") || it.startsWith("  To use "));

    test(
      "mentions a package with its version",
      async () => {
        const jsPlugins = ["eslint-plugin-n"];
        expect(await notes(packaged("17.16.2"), { jsPlugins, rules })).toEqual([
          `note: 1 "n" rule ran in JavaScript from eslint-plugin-n 17.16.2, but bun lint has it built in (version 18.4.1)`,
          `  To use the built-in rule, remove eslint-plugin-n from "jsPlugins" and add "node" to "plugins". Reports may differ.`,
        ]);
        expect(await notes(packaged("18.4.9"), { jsPlugins, rules }, "-f", "stylish")).toEqual([
          `note: 1 "n" rule ran in JavaScript from eslint-plugin-n 18.4.9, but bun lint has it built in (version 18.4.1)`,
          `  To use the built-in rule, remove eslint-plugin-n from "jsPlugins" and add "node" to "plugins".`,
        ]);
      },
      timeout,
    );

    test(
      "mentions a file, and says to keep it for rules that aren't built in",
      async () => {
        const more = { "n/no-new-require": "warn", "n/only-there": "error", "n/no-sync": "off" };
        const plugin = pluginN["n.js"].replace(
          `"only-there"`,
          `"no-new-require": rule("new"), "no-sync": rule("sync"), "only-there"`,
        );
        expect(await notes({ ...pluginN, "n.js": plugin }, { rules: { ...rules, ...more } })).toEqual([
          `note: 2 "n" rules ran in JavaScript from ./n.js, but bun lint has them built in (version 18.4.1)`,
          `  To use the built-in rules, rename them to "node/.." and add "node" to "plugins". Keep ./n.js for the other rule. Reports may differ.`,
        ]);
      },
      timeout,
    );

    test(
      "isn't printed in quiet or machine-readable output, if the run passes, or if no such rule ran",
      async () => {
        for (const flags of [["--quiet"], ["--silent"], ["-f", "json"], ["-f", "unix"], ["-f", "github"]]) {
          expect([flags, await notes(pluginN, { rules }, ...flags)]).toEqual([flags, []]);
        }
        expect(await notes(pluginN, { rules: { "n/no-path-concat": "warn" } })).toEqual([]);
        expect(await notes(pluginN, { rules: { "n/only-there": "error" } })).toEqual([]);
        expect(await notes(pluginN, { rules: { "n/no-path-concat": "off", "node/no-path-concat": "error" } })).toEqual(
          [],
        );
        expect(await notes(pluginN, { jsPlugins: [], rules })).toEqual([]);
      },
      timeout,
    );
  });

  test(
    "a plugin named n alongside the built-in node plugin: each is listed under its own name in oxlint-suppressions.json",
    async () => {
      const rules = { "n/no-path-concat": "error", "node/no-path-concat": "error" };
      const { files } = await lint(
        { ...pluginN, ".oxlintrc.json": withBuiltInNode({ rules }) },
        ["--suppress-all", "a.js"],
        ["oxlint-suppressions.json"],
      );
      expect(JSON.parse(files["oxlint-suppressions.json"])).toEqual({
        "a.js": { "n/no-path-concat": { count: 1 }, "node/no-path-concat": { count: 1 } },
      });
    },
    timeout,
  );

  test(
    "rejects options that the schema doesn't allow, and a rule that doesn't exist",
    async () => {
      const files = { "plugin.mjs": noFoo, "a.js": "1;\n" };
      const wrongOptions = await lint(
        {
          ...files,
          ".oxlintrc.json": oxlintrc({ jsPlugins: ["./plugin.mjs"], rules: { "demo/no-foo": ["error", { nope: 1 }] } }),
        },
        [],
      );
      expect(wrongOptions.stdout).toContain("demo/no-foo");
      expect(wrongOptions.stdout).toContain("nope");
      expect(wrongOptions.exitCode).toBe(1);
      const unknown = await lint(
        { ...files, ".oxlintrc.json": oxlintrc({ jsPlugins: ["./plugin.mjs"], rules: { "demo/nope": "error" } }) },
        [],
      );
      expect(unknown.stdout).toContain("Rule 'nope' not found in plugin 'demo'");
      expect(unknown.exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "a rule that throws is reported for the file, and the other files are linted",
    async () => {
      const plugin = `
      export default {
        meta: { name: "throws" },
        rules: {
          sometimes: {
            create(context) {
              return {
                Identifier(node) {
                  if (node.name === "boom") throw new Error("It went wrong.");
                  context.report({ node, message: "fine" });
                },
              };
            },
          },
        },
      };`;
      const { stdout, exitCode } = await lint(
        {
          ".oxlintrc.json": oxlintrc({ jsPlugins: ["./plugin.mjs"], rules: { "throws/sometimes": "error" } }),
          "plugin.mjs": plugin,
          "a.js": "ok;\n",
          "b.js": "\nboom;\n",
          "c.js": "ok;\n",
        },
        ["-f", "agent"],
      );
      expect(stdout).toContain("It went wrong.");
      expect(stdout).toContain("a.js:1:1: error throws(sometimes): fine");
      expect(stdout).toContain("c.js:1:1: error throws(sometimes): fine");
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  // ESLint 10.12.0 keeps these reports too. It prints `null` in JSON and 0 in `stylish`. Only its order differs, because it sorts
  // with NaN.
  test.concurrent(
    "a report whose line or column isn't a number is kept",
    async () => {
      const files = {
        "eslint.config.mjs": `
          const locs = [{ line: 3 }, 5, { line: "1", column: "2" }, { start: { line: 3 } }, { column: 2 }];
          const rule = {
            create: context => ({
              Program(node) {
                locs.forEach((loc, i) => context.report({ node, loc, message: "loc " + i }));
                context.report({ node, message: "last" });
              },
            }),
          };
          export default [{ plugins: { demo: { rules: { locs: rule } } }, rules: { "demo/locs": "error" } }];`,
        "a.js": "a;\nb;\nc;\n",
      };
      const [json, stylish] = await Promise.all([
        lint(files, ["-f", "json", "a.js"]),
        lint(files, ["-f", "stylish", "a.js"]),
      ]);
      const positions = JSON.parse(json.raw)[0].messages.map((it: any) => [it.message, it.line, it.column]);
      expect(positions).toEqual([
        ["loc 1", null, null],
        ["loc 2", null, null],
        ["loc 4", null, 3],
        ["last", 1, 1],
        ["loc 0", 3, null],
        ["loc 3", 3, null],
      ]);
      expect(
        stylish.stdout
          .split("\n")
          .filter(line => line.includes("demo/locs"))
          .map(line => line.trim().split(/\s+/)[0]),
      ).toEqual(["0:0", "0:0", "0:3", "1:1", "3:0", "3:0"]);
      expect({ json: json.exitCode, stylish: stylish.exitCode }).toEqual({ json: 1, stylish: 1 });
    },
    timeout,
  );

  // Same as under ESLint 10.12.0.
  test.concurrent(
    "`-f json` includes the `data` of a suggestion that has a `desc`",
    async () => {
      const files = {
        "eslint.config.mjs": `
          const rule = {
            meta: { hasSuggestions: true },
            create: context => ({
              Program(node) {
                context.report({ node, message: "bad", suggest: [{ desc: "Use {{name}}.", data: { name: "b" }, fix: fixer => fixer.replaceText(node, "b") }] });
              },
            }),
          };
          export default [{ plugins: { demo: { rules: { suggests: rule } } }, rules: { "demo/suggests": "error" } }];`,
        "a.js": "a;\n",
      };
      const { raw, exitCode } = await lint(files, ["-f", "json", "a.js"]);
      expect(JSON.parse(raw)[0].messages[0].suggestions).toEqual([
        { desc: "Use b.", data: { name: "b" }, fix: { range: [0, 3], text: "b" } },
      ]);
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  // Same as under ESLint 10.12.0 with eslint-plugin-react-hooks 7.1.1, which only passes `desc` and `fix`.
  test.concurrent(
    "`-f json` has no `data` for a built-in rule's suggestion that only has a `desc` upstream",
    async () => {
      const files = {
        "eslint.config.mjs": `export default [{
          files: ["**/*.jsx"],
          languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
          plugins: { "react-hooks": { meta: { name: "eslint-plugin-react-hooks" } } },
          rules: { "react-hooks/exhaustive-deps": "error" },
        }];`,
        "a.jsx": `import { useEffect } from "react";\nexport function A({ params }) {\n  useEffect(() => { console.log(params); }, []);\n  return null;\n}\n`,
      };
      const { raw, exitCode } = await lint(files, ["-f", "json", "a.jsx"]);
      expect(JSON.parse(raw)[0].messages[0].suggestions).toEqual([
        { desc: "Update the dependencies array to be: [params]", fix: { range: [111, 113], text: "[params]" } },
      ]);
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  // ESLint 10.12.0 and oxlint 1.87.0 call `fix`, and each suggestion's `fix`, as soon as a problem is reported, whether
  // or not anything uses the result.
  describe("a rule's fixers are called regardless of the output format", () => {
    const rules = `{
      "fix-throws": {
        meta: { fixable: "code" },
        create: context => ({
          VariableDeclaration: node =>
            context.report({ node, message: "bad", fix() { throw new Error("The fixer threw."); } }),
        }),
      },
      "suggestion-throws": {
        meta: { hasSuggestions: true },
        create: context => ({
          VariableDeclaration: node =>
            context.report({ node, message: "bad", suggest: [{ desc: "do", fix() { throw new Error("The suggestion threw."); } }] }),
        }),
      },
      "not-fixable": {
        create: context => ({
          VariableDeclaration: node => context.report({ node, message: "bad", fix: fixer => fixer.remove(node) }),
        }),
      },
      counts: {
        meta: { fixable: "code" },
        create(context) {
          let calls = 0;
          return {
            VariableDeclaration: node => context.report({ node, message: "counted", fix: () => (calls++, null) }),
            "Program:exit": node => context.report({ node, message: "calls: " + calls }),
          };
        },
      },
    }`;
    const forEslint = (rule: string, severity = "error") => ({
      "eslint.config.mjs": `export default [{ plugins: { demo: { rules: ${rules} } }, rules: { "demo/${rule}": "${severity}" } }];`,
      "a.js": "var a = 1;\n",
    });
    // Pass the config explicitly, because `--silent` is an oxlint flag.
    const eslint = (rule: string, flags: string[], severity?: string) =>
      lint(forEslint(rule, severity), ["-c", "eslint.config.mjs", ...flags, "a.js"]);
    const thrown = (rule: string, message: string) => ({
      stdout: "",
      stderr: `error: ${message}\nOccurred while linting <dir>/a.js:1\nRule: "demo/${rule}"`,
      exitCode: 2,
    });
    const outcome = ({ stdout, stderr, exitCode }: Awaited<ReturnType<typeof lint>>) => ({ stdout, stderr, exitCode });

    test.each([
      [[]],
      [["-f", "unix"]],
      [["-f", "json"]],
      [["-f", "pretty"]],
      [["--silent"]],
      [["--quiet", "-f", "unix"]],
    ])(
      "with an ESLint config, a fixer that throws ends the run: %j",
      async flags => {
        const [fix, suggestion, notFixable] = await Promise.all(
          ["fix-throws", "suggestion-throws", "not-fixable"].map(rule => eslint(rule, flags)),
        );
        expect(outcome(fix)).toEqual(thrown("fix-throws", "The fixer threw."));
        expect(outcome(suggestion)).toEqual(thrown("suggestion-throws", "The suggestion threw."));
        expect(outcome(notFixable)).toEqual(
          thrown("not-fixable", 'Fixable rules must set the `meta.fixable` property to "code" or "whitespace".'),
        );
      },
      timeout,
    );

    test(
      "with --quiet, a rule set to warn doesn't run unless --max-warnings counts the warnings",
      async () => {
        const [quiet, counted] = await Promise.all([
          eslint("fix-throws", ["--quiet", "-f", "unix"], "warn"),
          eslint("fix-throws", ["--quiet", "--max-warnings", "0", "-f", "unix"], "warn"),
        ]);
        expect({ stdout: quiet.stdout, exitCode: quiet.exitCode }).toEqual({ stdout: "", exitCode: 0 });
        expect(outcome(counted)).toEqual(thrown("fix-throws", "The fixer threw."));
      },
      timeout,
    );

    test(
      "a fixer's side effects are visible to the rule's later reports",
      async () => {
        const { stdout, exitCode } = await eslint("counts", ["-f", "unix"]);
        expect(stdout).toBe(
          "<dir>/a.js:1:1: counted [Error/demo/counts]\n<dir>/a.js:1:1: calls: 1 [Error/demo/counts]\n\n2 problems",
        );
        expect(exitCode).toBe(1);
      },
      timeout,
    );

    test.each([[[]], [["-f", "unix"]], [["-f", "json"]]])(
      "with an oxlint config, a fixer that throws is reported for the file: %j",
      async flags => {
        const { stdout, exitCode } = await lint(
          {
            ".oxlintrc.json": oxlintrc({ jsPlugins: ["./plugin.mjs"], rules: { "demo/fix-throws": "error" } }),
            "plugin.mjs": `export default { meta: { name: "demo" }, rules: ${rules} };`,
            "a.js": "var a = 1;\n",
          },
          flags,
        );
        expect(stdout).toContain("Error running JS plugin.");
        expect(stdout).toContain("The fixer threw.");
        expect(exitCode).toBe(1);
      },
      timeout,
    );

    // `supportsAutofix: false` sets ESLint's `disableFixes`, which is the only case where fixers aren't called.
    test.each([
      [true, 'fix={"range":[10,10],"text":"/**/"} suggestions=1', 'fix={"range":[0,3],"text":"let"} suggestions=0'],
      [false, "fix=null suggestions=0", "fix=null suggestions=0"],
    ])(
      "`postprocess` gets the fixes regardless of the output format: supportsAutofix: %j",
      async (supportsAutofix, fromPlugin, builtIn) => {
        const files = {
          "eslint.config.mjs": `
            const fixes = {
              meta: { fixable: "code", hasSuggestions: true },
              create: context => ({
                VariableDeclaration: node =>
                  context.report({
                    node,
                    message: "bad",
                    fix: fixer => fixer.insertTextAfter(node, "/**/"),
                    suggest: [{ desc: "remove", fix: fixer => fixer.remove(node) }],
                  }),
              }),
            };
            const shown = it => " fix=" + JSON.stringify(it.fix ?? null) + " suggestions=" + (it.suggestions?.length ?? 0);
            const processor = {
              supportsAutofix: ${supportsAutofix},
              preprocess: text => [{ text, filename: "0.js" }],
              postprocess: lists => lists.flat().map(it => ({ ...it, message: it.message + shown(it) })),
            };
            export default [
              { files: ["**/*.x"], processor },
              { plugins: { demo: { rules: { fixes } } }, rules: { "demo/fixes": "error", "no-var": "error" } },
            ];`,
          "a.x": "var a = 1;\n",
        };
        const { stdout, exitCode } = await lint(files, ["-f", "unix", "a.x"]);
        expect(stdout).toBe(
          [
            `<dir>/a.x:1:1: bad ${fromPlugin} [Error/demo/fixes]`,
            `<dir>/a.x:1:1: Unexpected var, use let or const instead. ${builtIn} [Error/no-var]`,
            "",
            "2 problems",
          ].join("\n"),
        );
        expect(exitCode).toBe(1);
      },
      timeout,
    );
  });

  test(
    "reports a plugin that can't be loaded",
    async () => {
      const run = (plugin: string, specifier = "./broken.mjs") =>
        lint({ ".oxlintrc.json": oxlintrc({ jsPlugins: [specifier] }), "broken.mjs": plugin, "a.js": "1;\n" }, [
          "a.js",
        ]);
      const [syntax, throws, nameless, missing] = await Promise.all([
        run("export default { rules: {"),
        run(`throw new Error("It cannot start.");`),
        run("export default { rules: {} };"),
        run("", "eslint-plugin-that-is-not-installed"),
      ]);
      expect(syntax.stdout).toContain("Failed to load JS plugin: ./broken.mjs");
      expect(throws.stdout).toMatchInlineSnapshot(`
      "error: Cannot use the configuration file <dir>/.oxlintrc.json:
      Failed to load JS plugin: ./broken.mjs
        Error: It cannot start.
          at <dir>/broken.mjs:1:11"
    `);
      expect(nameless.stdout).toMatchInlineSnapshot(`
      "error: Cannot use the configuration file <dir>/.oxlintrc.json:
      Failed to load JS plugin: ./broken.mjs
        Error: Plugin must either define \`meta.name\`, be loaded from an NPM package with a \`name\` field in \`package.json\`, or be given an alias in config"
    `);
      expect(missing.stdout).toMatchInlineSnapshot(`
      "error: Cannot use the configuration file <dir>/.oxlintrc.json:
      Failed to load JS plugin: eslint-plugin-that-is-not-installed
        ResolveMessage: Cannot find module 'eslint-plugin-that-is-not-installed'"
    `);
      for (const it of [syntax, throws, nameless, missing]) expect(it.exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "a plugin's output is printed, and process.exit() ends the run",
    async () => {
      const plugin = `
      export default {
        meta: { name: "process" },
        rules: {
          exits: {
            create(context) {
              return {
                Program() {
                  console.log("to stdout", ...process.argv.slice(1));
                  console.error("to stderr");
                  process.exit(7);
                },
              };
            },
          },
        },
      };`;
      const { stdout, stderr, exitCode } = await lint(
        {
          ".oxlintrc.json": oxlintrc({ jsPlugins: ["./plugin.mjs"], rules: { "process/exits": "error" } }),
          "plugin.mjs": plugin,
          "a.js": "1;\n",
        },
        ["-f", "unix"],
      );
      expect(stdout).toBe("to stdout lint --threads 2 -f unix");
      expect(stderr).toBe("to stderr");
      expect(exitCode).toBe(7);
    },
    timeout,
  );

  test(
    "a plugin's exit handlers run after the report, once for each thread that loaded it",
    async () => {
      const plugin = `
      let files = 0;
      process.on("exit", () => console.log("exit after " + files + " files"));
      export default {
        meta: { name: "counts" },
        rules: {
          files: {
            create(context) {
              files++;
              return {
                Program(node) {
                  context.report({ node, message: "reported" });
                },
              };
            },
          },
        },
      };`;
      const { stdout, exitCode } = await lint(
        {
          ".oxlintrc.json": oxlintrc({ jsPlugins: ["./plugin.mjs"], rules: { "counts/files": "error" } }),
          "plugin.mjs": plugin,
          "a.js": "1;\n",
          "b.js": "2;\n",
        },
        ["-f", "unix", "--threads", "1"],
      );
      const lines = stdout.split("\n");
      expect(lines.slice(0, 4)).toEqual([
        "a.js:1:1: reported [Error/counts(files)]",
        "b.js:1:1: reported [Error/counts(files)]",
        "",
        "2 problems",
      ]);
      expect(lines.slice(4)).toEqual(["exit after 2 files"]);
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "each file gets a new sourceCode and context, so a plugin's caches keyed by them don't leak between files",
    async () => {
      const plugin = `
      const bySourceCode = new WeakMap();
      const byContext = new WeakSet();
      export default {
        meta: { name: "caches" },
        rules: {
          first: {
            create(context) {
              const known = bySourceCode.get(context.sourceCode);
              bySourceCode.set(context.sourceCode, context.filename);
              const seen = byContext.has(context);
              byContext.add(context);
              return {
                Program(node) {
                  context.report({ node, message: "known: " + known + ", seen: " + seen });
                },
              };
            },
          },
        },
      };`;
      const { stdout } = await lint(
        {
          ".oxlintrc.json": oxlintrc({ jsPlugins: ["./plugin.mjs"], rules: { "caches/first": "error" } }),
          "plugin.mjs": plugin,
          "a.js": "1;\n",
          "b.js": "2;\n",
        },
        ["-f", "unix", "--threads", "1"],
      );
      expect(stdout).toMatchInlineSnapshot(`
      "a.js:1:1: known: undefined, seen: false [Error/caches(first)]
      b.js:1:1: known: undefined, seen: false [Error/caches(first)]

      2 problems"
    `);
    },
    timeout,
  );

  test(
    "supports code paths, non-JSON default options, and a plugin whose rules have no fixed order",
    async () => {
      const plugin = `
      const rules = {};
      await Promise.all(
        ["b", "a", "c"].map(async (name, i) => {
          for (let turns = (3 - i) * (process.pid % 3); turns > 0; turns--) await null;
          rules[name] = {
            meta: { schema: [{ type: "object" }], defaultOptions: [{ name, most: Infinity }] },
            create(context) {
              const events = [];
              return {
                onCodePathStart: codePath => events.push("start " + codePath.origin),
                onCodePathSegmentStart: segment => events.push(segment.id),
                onUnreachableCodePathSegmentStart: segment => events.push("unreachable " + segment.id),
                onCodePathEnd(codePath, node) {
                  if (node.type !== "Program") return;
                  const [{ name, most }] = context.options;
                  context.report({ node, message: [context.id, name, most, ...events].join(" ") });
                },
              };
            },
          };
        }),
      );
      export default { meta: { name: "paths" }, rules };`;
      const { stdout } = await lint(
        {
          ".oxlintrc.json": oxlintrc({
            jsPlugins: ["./plugin.mjs"],
            rules: { "paths/a": "error", "paths/b": "error", "paths/c": "error" },
          }),
          "plugin.mjs": plugin,
          "a.js": "function f(a) { if (a) return 1; else throw a; f(); }\n",
        },
        ["-f", "unix"],
      );
      // ESLint 10 sends this rule the same events.
      const events = "start program s1_1 start function s2_1 s2_2 s2_4 unreachable s2_6";
      expect(stdout.split("\n").slice(0, 3)).toEqual([
        `a.js:1:1: paths/a a Infinity ${events} [Error/paths(a)]`,
        `a.js:1:1: paths/b b Infinity ${events} [Error/paths(b)]`,
        `a.js:1:1: paths/c c Infinity ${events} [Error/paths(c)]`,
      ]);
    },
    timeout,
  );

  test(
    "with more files than threads, every file gets exactly its own reports",
    async () => {
      const files: Record<string, string> = {
        ".oxlintrc.json": oxlintrc({ jsPlugins: ["./plugin.mjs"], rules: { "demo/no-foo": "error" } }),
        "plugin.mjs": noFoo,
      };
      // File number `i` has `i % 5` of them.
      for (let i = 0; i < 300; i++)
        files[`src/${i}.ts`] = `export const x: number = ${i};\n` + "foo();\n".repeat(i % 5);
      for (const threads of isDebug || isASAN ? ["3"] : ["1", "3", "16"]) {
        const { raw, exitCode } = await lint(files, ["-f", "json", "--threads", threads]);
        const counts = new Map<string, number>();
        for (const it of JSON.parse(raw).diagnostics) {
          expect(it.code).toBe("demo(no-foo)");
          const name = it.filename.replaceAll("\\", "/");
          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
        const expected = Array.from({ length: 300 }, (_, i) => [`src/${i}.ts`, i % 5] as const).filter(it => it[1] > 0);
        expect([...counts].sort()).toEqual([...expected].sort());
        expect(exitCode).toBe(1);
      }
    },
    timeout,
  );

  test(
    "plugins in an eslint.config.js can be imported or defined in the file",
    async () => {
      const { stdout, exitCode } = await lint(
        {
          "eslint.config.mjs": `
          import demo from "./plugin.mjs";
          const inline = {
            rules: {
              "no-var": {
                create(context) {
                  return {
                    "VariableDeclaration[kind='var']"(node) {
                      context.report({ node, message: "A var in " + context.languageOptions.sourceType + " code, says " + context.id + "." });
                    },
                  };
                },
              },
            },
          };
          export default [
            { plugins: { renamed: demo, inline }, rules: { "renamed/no-foo": ["error", { suffix: "?" }], "inline/no-var": "warn", "no-debugger": "error" } },
          ];`,
          "plugin.mjs": noFoo,
          "a.js": "var a = foo;\ndebugger;\n",
        },
        ["-f", "unix", "a.js"],
      );
      expect(stdout).toMatchInlineSnapshot(`
      "<dir>/a.js:1:1: A var in module code, says inline/no-var. [Warning/inline/no-var]
      <dir>/a.js:1:9: No foo in a VariableDeclarator? [Error/renamed/no-foo]
      <dir>/a.js:2:1: Unexpected 'debugger' statement. [Error/no-debugger]

      3 problems"
    `);
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  // A stand-in for the package with only what a config uses.
  const compat = {
    "node_modules/@eslint/compat/package.json": JSON.stringify({
      name: "@eslint/compat",
      type: "module",
      exports: "./dist/esm/index.js",
    }),
    "node_modules/@eslint/compat/dist/esm/index.js": `
      const made = new WeakMap();
      export function fixupPluginRules(plugin) {
        if (made.has(plugin)) return made.get(plugin);
        const rules = Object.entries(plugin.rules).map(([name, rule]) => [name, { ...rule, create: rule.create.bind(rule) }]);
        const fixed = { ...plugin, rules: Object.fromEntries(rules) };
        made.set(plugin, fixed);
        return fixed;
      }`,
  };

  test(
    "doesn't run the config file again for a plugin that a module exports, even through fixupPluginRules",
    async () => {
      const { stdout, stderr, exitCode } = await lint(
        {
          ...compat,
          "eslint.config.mjs": `
          import { fixupPluginRules } from "@eslint/compat";
          import demo from "./plugin.mjs";
          console.error("The configuration file runs.");
          export default [
            { plugins: { demo }, rules: { "demo/no-foo": "error" } },
            { files: ["b.js"], plugins: { fixed: fixupPluginRules(demo) }, rules: { "fixed/no-foo": "warn" } },
          ];`,
          "plugin.mjs": noFoo,
          "a.js": "foo;\n",
          "b.js": "foo;\n",
        },
        ["-f", "unix", "--timing", "a.js", "b.js"],
      );
      expect(stdout).toMatchInlineSnapshot(`
        "<dir>/a.js:1:1: No foo in a ExpressionStatement. [Error/demo/no-foo]
        <dir>/b.js:1:1: No foo in a ExpressionStatement. [Error/demo/no-foo]
        <dir>/b.js:1:1: No foo in a ExpressionStatement. [Warning/fixed/no-foo]

        3 problems"
      `);
      // Output from the process that evaluates the config file isn't shown.
      expect(stderr).not.toContain("The configuration file runs.");
      expect(stderr).toMatch(/JavaScript: [12] engines loaded [12] modules, /);
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "an engine runs the config file for files that need a plugin defined only in that file",
    async () => {
      const files: Record<string, string> = {
        "eslint.config.mjs": `
          import demo from "./plugin.mjs";
          console.error("The configuration file runs.");
          const inline = { rules: { "no-bar": { create: context => ({ "Identifier[name='bar']"(node) { context.report({ node, message: "No bar." }); } }) } } };
          export default [
            { plugins: { demo }, rules: { "demo/no-foo": "error" } },
            { files: ["inline/*.js"], plugins: { inline }, rules: { "inline/no-bar": "error" } },
          ];`,
        "plugin.mjs": noFoo,
      };
      for (let i = 0; i < 8; i++) files[`inline/${i}.js`] = files[`other/${i}.js`] = "foo; bar;\n";
      const { raw, stderr, exitCode } = await lint(files, [
        "-f",
        "json",
        "--timing",
        "--threads",
        "3",
        "inline",
        "other",
      ]);
      const counts = JSON.parse(raw).map((it: any) => it.messages.length);
      expect(counts).toEqual([2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1]);
      expect(stderr.split("The configuration file runs.").length - 1).toBe(1);
      expect(stderr).toContain(`; loaded the whole config file for the plugin "inline"`);
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "loads a rule from the module that exports it, without the plugin and its other rules",
    async () => {
      const rule = (name: string) => `
        console.error("Loaded: the rule ${name}.");
        export default { create: context => ({ "Identifier[name='${name}']"(node) { context.report({ node, message: "No ${name}." }); } }) };`;
      const { stdout, stderr, exitCode } = await lint(
        {
          "eslint.config.mjs": `
          import many from "./many/index.mjs";
          export default [{ plugins: { many }, rules: { "many/no-a": "error", "many/no-c": "error" } }];`,
          "many/index.mjs": `
          import a from "./no-a.mjs";
          import b from "./no-b.mjs";
          import c from "./no-c.mjs";
          console.error("Loaded: the plugin.");
          // The last is not what its module exports.
          export default { rules: { "no-a": a, "no-b": b, "no-c": { ...c } } };`,
          "many/no-a.mjs": rule("a"),
          "many/no-b.mjs": rule("b"),
          "many/no-c.mjs": rule("c"),
          "only-a.js": "/* eslint many/no-c: off */ a; b; c;\n",
        },
        ["-f", "unix", "--threads", "1", "only-a.js"],
      );
      expect(stdout).toMatchInlineSnapshot(`
        "<dir>/only-a.js:1:29: No a. [Error/many/no-a]

        1 problem"
      `);
      expect(stderr.split("\n").filter(it => it.startsWith("Loaded"))).toEqual(["Loaded: the rule a."]);
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  // Per-process state, like the resolver's caches, is created with the first VM, and that isn't safe on several threads
  // at once.
  test.skipIf(!isDebug)(
    "no other engine starts before the first one is ready",
    async () => {
      const files: Record<string, string> = {
        "eslint.config.mjs": `
          import demo from "./plugin.mjs";
          export default [{ plugins: { demo }, rules: { "demo/no-foo": "error" } }];`,
        "plugin.mjs": noFoo,
      };
      for (let i = 0; i < 128; i++) files[`src/${i}.js`] = "foo;\n";
      using dir = tempDir("bun-lint-js-plugins", files);
      await using proc = spawn({
        cmd: [bunExe(), "lint", "--threads", "4", "src"],
        env: { ...env, BUN_DEBUG_lint_js: "1" },
        cwd: String(dir),
        stdin: "ignore",
        stdout: "pipe",
        stderr: "ignore",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      const steps = [...stdout.matchAll(/a VM (begins|is made)/g)].map(it => it[1]);
      // The number of engines depends on the number of cores.
      expect(steps.filter(it => it === "begins").length).toBe(steps.filter(it => it === "is made").length);
      expect(steps.slice(0, 2)).toEqual(["begins", "is made"]);
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "passes on non-JSON values (a RegExp in the options, a function in the settings), and rules can mutate their options",
    async () => {
      const { stdout, stderr, exitCode } = await lint(
        {
          "eslint.config.mjs": `
          import says from "./says.mjs";
          export default [
            { settings: { a: { one: 1, f() { return "f"; } }, list: [1] } },
            { settings: { a: { two: 2 }, list: [2] } },
            {
              plugins: { says },
              rules: { "says/options": ["error", { ignore: [/^a/u, /^b/giu], names: ["x"] }], "says/defaults": "error", "says/settings": "error" },
            },
          ];`,
          "says.mjs": `
          const rule = (meta, say) => ({ meta, create: context => ({ Program(node) { context.report({ node, message: say(context) }); } }) });
          export default {
            rules: {
              options: rule(
                { schema: [{ type: "object", properties: { ignore: { type: "array", uniqueItems: true }, names: { type: "array" } } }] },
                ({ options: [{ ignore, names }] }) => (names.push("y"), ignore.map(it => (it instanceof RegExp) + " " + it) + "; " + names.length),
              ),
              defaults: rule(
                { schema: [{ type: "object" }], defaultOptions: [{ names: ["a"] }] },
                ({ options }) => ((options[0].extra = 1), options[0].names.push("b"), JSON.stringify(options[0].names.slice(0, 2))),
              ),
              settings: rule({}, ({ settings }) => settings.a.f() + " " + JSON.stringify(settings)),
            },
          };`,
          "a.js": "",
        },
        ["-f", "unix", "--timing", "a.js"],
      );
      expect(stdout).toMatchInlineSnapshot(`
        "<dir>/a.js:1:1: true /^a/u,true /^b/giu; 2 [Error/says/options]
        <dir>/a.js:1:1: ["a","b"] [Error/says/defaults]
        <dir>/a.js:1:1: f {"a":{"one":1,"two":2},"list":[2]} [Error/says/settings]

        3 problems"
      `);
      expect(stderr).toContain(`; loaded the whole config file for "settings"`);
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  // This is what `synckit` does, which `eslint-plugin-prettier` is built on.
  test(
    "a rule can block on its own worker on every linting thread",
    async () => {
      const files: Record<string, string> = {
        "eslint.config.mjs": `
          import demo from "./plugin.mjs";
          export default [{ plugins: { demo }, rules: { "demo/length": "error" } }];`,
        "plugin.mjs": `
          import { MessageChannel, receiveMessageOnPort, Worker } from "node:worker_threads";
          let state = null;
          function lengthOf(text) {
            if (state === null) {
              const shared = new SharedArrayBuffer(4);
              const { port1, port2 } = new MessageChannel();
              const options = { workerData: { port: port2, shared }, transferList: [port2] };
              const worker = new Worker(new URL("./worker.mjs", import.meta.url), options);
              worker.unref();
              state = { worker, port: port1, flag: new Int32Array(shared) };
            }
            const before = Atomics.load(state.flag, 0);
            state.worker.postMessage(text);
            // In a loop: the worker may be between its add and its notify of the last message, which then wakes this one.
            while (Atomics.load(state.flag, 0) === before) Atomics.wait(state.flag, 0, before);
            return receiveMessageOnPort(state.port).message;
          }
          export default {
            rules: {
              length: {
                create: context => ({
                  Program(node) {
                    context.report({ node, message: String(lengthOf(context.sourceCode.text)) });
                  },
                }),
              },
            },
          };`,
        "worker.mjs": `
          import { parentPort, workerData } from "node:worker_threads";
          import { a } from "./a.mjs";
          import { b } from "./b.mjs";
          const flag = new Int32Array(workerData.shared);
          parentPort.on("message", async text => {
            const { c } = await import("./c.mjs");
            workerData.port.postMessage(text.length + a + b + c);
            Atomics.add(flag, 0, 1);
            Atomics.notify(flag, 0);
          });`,
        "a.mjs": "export const a = 0;",
        "b.mjs": "export const b = 0;",
        "c.mjs": "export const c = 0;",
      };
      for (let i = 0; i < 64; i++) files[`src/${i}.js`] = "foo;\n";
      const { stdout, exitCode } = await lint(files, ["-f", "unix", "--threads", "2", "src"]);
      expect(stdout.split("\n").filter(it => it.endsWith(": 5 [Error/demo/length]"))).toHaveLength(64);
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  // This is what `@cspell/eslint-plugin` does. With types, the linting threads are restarted for every project and
  // every step of the checker, while the workers read files on Bun's thread pool.
  test(
    "a rule can block on its own worker, which reads files, in projects with types",
    async () => {
      const files: Record<string, string> = {
        "eslint.config.mjs": `
          import demo from "./plugin.mjs";
          export default [{
            files: ["**/*.ts"],
            plugins: { demo, "@typescript-eslint": { meta: { name: "@typescript-eslint/eslint-plugin" } } },
            languageOptions: { parser: { meta: { name: "typescript-eslint/parser" } }, parserOptions: { projectService: true } },
            rules: { "demo/length": "error", "@typescript-eslint/no-floating-promises": "error" },
          }];`,
        "plugin.mjs": `
          import { MessageChannel, receiveMessageOnPort, Worker } from "node:worker_threads";
          let state = null;
          function lengthOf(text) {
            if (state === null) {
              const shared = new SharedArrayBuffer(4);
              const { port1, port2 } = new MessageChannel();
              const options = { workerData: { port: port2, shared }, transferList: [port2] };
              const worker = new Worker(new URL("./worker.mjs", import.meta.url), options);
              worker.unref();
              state = { worker, port: port1, flag: new Int32Array(shared) };
            }
            const before = Atomics.load(state.flag, 0);
            state.worker.postMessage(text);
            // In a loop: the worker may be between its add and its notify of the last message, which then wakes this one.
            while (Atomics.load(state.flag, 0) === before) Atomics.wait(state.flag, 0, before);
            return receiveMessageOnPort(state.port).message;
          }
          export default {
            rules: {
              length: {
                create: context => ({
                  Program(node) {
                    context.report({ node, message: String(lengthOf(context.sourceCode.text)) });
                  },
                }),
              },
            },
          };`,
        "worker.mjs": `
          import { readFile } from "node:fs/promises";
          import { parentPort, workerData } from "node:worker_threads";
          const flag = new Int32Array(workerData.shared);
          const here = new URL(import.meta.url);
          (async () => {
            for (;;) await readFile(here);
          })();
          parentPort.on("message", async text => {
            await readFile(here);
            workerData.port.postMessage(text.length);
            Atomics.add(flag, 0, 1);
            Atomics.notify(flag, 0);
          });`,
      };
      for (let project = 0; project < 16; project++) {
        files[`${project}/tsconfig.json`] = JSON.stringify({ compilerOptions: { noLib: true, types: [] } });
        for (let i = 0; i < 8; i++) files[`${project}/${i}.ts`] = "foo;\n";
      }
      using dir = tempDir("bun-lint-js-plugins", files);
      await using proc = spawn({
        cmd: [bunExe(), "lint", "-f", "unix", "--threads", "4"],
        // Fixes the thread pool's size, regardless of the number of cores.
        env: { ...env, GOMAXPROCS: "8" },
        cwd: String(dir),
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const reports = stdout.split("\n").filter(it => it.endsWith(": 5 [Error/demo/length]")).length;
      // Include stderr so that a failure shows it.
      expect({ reports, exitCode, stderr }).toEqual({ reports: 128, exitCode: 1, stderr: expect.any(String) });
    },
    timeout,
  );

  test(
    "starts only as many engines as are worth it, with and without types, and they report the same",
    async () => {
      // With `blockFirstFile`, an engine stays busy with its first file until another engine has a file too. A thread
      // only requests a new engine while the others are busy, which otherwise depends on thread scheduling.
      const run = async (count: number, extension: string, size: number, threads: string, blockFirstFile = false) => {
        const files: Record<string, string> = {
          "engines/.keep": "",
          "tsconfig.json": JSON.stringify({ compilerOptions: { noLib: true, types: [] } }),
          "eslint.config.mjs": `
            import demo from "./plugin.mjs";
            export default [
              { files: ["src/*"], plugins: { demo }, rules: { "demo/seen": "error" } },
              {
                files: ["**/*.ts"],
                plugins: { "@typescript-eslint": { meta: { name: "@typescript-eslint/eslint-plugin" } } },
                languageOptions: { parser: { meta: { name: "typescript-eslint/parser" } }, parserOptions: { projectService: true } },
                rules: { "@typescript-eslint/no-floating-promises": "error" },
              },
            ];`,
          "plugin.mjs": `
            import { readdirSync, writeFileSync } from "node:fs";
            const engines = new URL("./engines/", import.meta.url);
            // Each engine evaluates the module once.
            let isFirst = ${blockFirstFile};
            export default { rules: { seen: { create: context => ({ Program(node) {
              if (isFirst) {
                isFirst = false;
                writeFileSync(new URL(crypto.randomUUID(), engines), "");
                const end = Date.now() + 20_000;
                while (readdirSync(engines).length < 3 && Date.now() < end) Bun.sleepSync(2);
              }
              context.report({ node, message: "seen" });
            } }) } } };`,
        };
        // A single comment, because thousands of them take a debug build minutes.
        const text = `foo;\n/*${Buffer.alloc(size, "x")}*/\n`;
        for (let i = 0; i < count; i++) files[`src/${i}.${extension}`] = text;
        // The number of engines that fit depends on the machine's free memory, so set it explicitly.
        const variables = { BUN_LINT_MEMORY: String(64 * 2 ** 30) };
        const args = ["-f", "unix", "--timing", "--threads", threads, "src"];
        const { stdout, stderr, exitCode } = await lint(files, args, [], variables);
        expect(exitCode).toBe(1);
        return { stdout, engines: Number(/JavaScript: (\d+) engines/.exec(stderr)?.[1]) };
      };
      // 24 files of 250 KB, which is just under the large-file limit, add up to 6 MB, which is enough for three
      // engines.
      const [smallWithTypes, small, oneWithTypes, one, largeWithTypes, large] = await Promise.all([
        run(24, "ts", 0, "8"),
        run(24, "js", 0, "8"),
        run(24, "ts", 250_000, "1"),
        run(24, "js", 250_000, "1"),
        run(24, "ts", 250_000, "8", true),
        run(24, "js", 250_000, "8", true),
      ]);
      expect([smallWithTypes.engines, small.engines, oneWithTypes.engines, one.engines]).toEqual([1, 1, 1, 1]);
      for (const it of [largeWithTypes, large]) {
        expect(it.engines).toBeGreaterThan(1);
        expect(it.engines).toBeLessThanOrEqual(3);
      }
      expect(largeWithTypes.stdout).toBe(oneWithTypes.stdout);
      expect(large.stdout).toBe(one.stdout);
      expect(one.stdout.split("\n").filter(it => it.endsWith(": seen [Error/demo/seen]"))).toHaveLength(24);
    },
    timeout,
  );

  test(
    'runs a rule written for ESLint 8, and a plugin that\'s an ES module with a "module.exports" export',
    async () => {
      const { stdout, exitCode } = await lint(
        {
          "eslint.config.mjs": `
          import old from "./old.mjs";
          export default [{ plugins: { old }, rules: { "old/comments": "error" } }];`,
          "old.mjs": `
          const range = token => (token ? token.range.join("-") : "none");
          const plugin = {
            rules: {
              comments: {
                create: context => ({
                  "FunctionDeclaration, BlockStatement"(node) {
                    const { leading, trailing } = context.getComments(node);
                    const parts = [
                      leading.map(range),
                      trailing.map(range),
                      range(context.getJSDocComment(node)),
                      context.getSource(node).length,
                      context.getSourceLines().length,
                      context.getAllComments().length,
                      context.getFirstToken(node).value,
                      context.getScope().type,
                    ];
                    context.report({ node, message: parts.join(" | ") });
                  },
                }),
              },
            },
          };
          // Not a rule by itself: the whole plugin is loaded.
          plugin.rules = { ...plugin.rules };
          export { plugin as default, plugin as "module.exports" };`,
          "a.js": "/** a */\nexport function f() { /* b */ } // c\n",
        },
        ["-f", "unix", "a.js"],
      );
      expect(stdout).toMatchInlineSnapshot(`
        "<dir>/a.js:2:8:  |  | 0-8 | 24 | 3 | 3 | function | function [Error/old/comments]
        <dir>/a.js:2:21:  | 31-38 | none | 11 | 3 | 3 | { | function [Error/old/comments]

        2 problems"
      `);
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "a rule that requests types is skipped, the rest runs, and the run ends with an error that lists the rule",
    async () => {
      // This is what `getParserServices` in @typescript-eslint/utils does.
      const services = `context => {
        if (context.sourceCode.parserServices.program == null) {
          throw new Error("You have used a rule which requires type information, but don't have parserOptions set to generate type information for this file. See https://tseslint.com/typed-linting for enabling linting with type information.\\nParser: (unknown)");
        }
      }`;
      const files = {
        "eslint.config.mjs": `
          const services = ${services};
          const report = context => ({ Program(node) { context.report({ node, message: context.id }); } });
          const typed = {
            rules: {
              "at-once": { create: context => (services(context), report(context)) },
              later: { create: context => ({ "Program:exit"() { services(context); }, ...report(context) }) },
              untyped: { create: report },
            },
          };
          export default [{ plugins: { typed }, rules: { "typed/at-once": "error", "typed/later": "error", "typed/untyped": "error", "no-var": "error" } }];`,
        "a.js": "// eslint-disable-next-line typed/later\nvar a;\n",
        "b.js": "var b;\n",
      };
      const { stdout, stderr, exitCode } = await lint(files, [
        "-f",
        "unix",
        "--report-unused-disable-directives",
        "a.js",
        "b.js",
      ]);
      expect(stdout).toMatchInlineSnapshot(`
        "<dir>/a.js:1:1: typed/untyped [Error/typed/untyped]
        <dir>/a.js:2:1: Unexpected var, use let or const instead. [Error/no-var]
        <dir>/b.js:1:1: typed/untyped [Error/typed/untyped]
        <dir>/b.js:1:1: Unexpected var, use let or const instead. [Error/no-var]

        4 problems"
      `);
      expect(stderr).toContain(
        "2 rules did not run because there is no type information for the files: typed/at-once, typed/later",
      );
      expect(stderr).not.toContain("You have used a rule");
      expect(exitCode).toBe(2);
      expect((await lint(files, ["--allow-unsupported", "a.js", "b.js"])).exitCode).toBe(1);
    },
    timeout,
  );

  // This is how `eslint-plugin-import` parses the modules that a file imports.
  test.each(["parser", "* as parser"])(
    "a rule can parse other text with languageOptions.parser, which is loaded on first call: import %s",
    async imported => {
      const { stdout, exitCode } = await lint(
        {
          "eslint.config.mjs": `
          import own from "./plugin.mjs";
          import ${imported} from "./parser.cjs";
          export default [
            { files: ["a.ts"], plugins: { own }, rules: { "own/parses": "error" } },
            { files: ["a.ts"], languageOptions: { parser, parserOptions: { marker: "m" } } },
          ];`,
          "plugin.mjs": `
          const parses = {
            create: context => ({
              Program(node) {
                const { parser, parserOptions } = context.languageOptions;
                const before = globalThis.parserIsLoaded === true;
                const { ast } = parser.parseForESLint("other", parserOptions);
                context.report({ node, message: [parser.meta.name, typeof parser.parse, before, ast.type, ast.text, ast.options].join(" ") });
              },
            }),
          };
          export default { rules: { parses } };`,
          "parser.cjs": `
          globalThis.parserIsLoaded = true;
          const parseForESLint = (text, options) => ({ ast: { type: "Program", text, options: options?.marker } });
          module.exports = { meta: { name: "typescript-eslint/parser" }, parse: text => parseForESLint(text).ast, parseForESLint };`,
          "a.ts": "let a: number;\n",
        },
        ["-f", "unix", "a.ts"],
      );
      expect(stdout).toMatchInlineSnapshot(`
        "<dir>/a.ts:1:1: typescript-eslint/parser function false Program other m [Error/own/parses]

        1 problem"
      `);
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  // Like `eslint-plugin-rulesdir` and nodejs/node's plugin: without the assignment, the plugin has no rules.
  test(
    "a plugin whose rules directory is set by the config file",
    async () => {
      const rule = (message: string) =>
        `module.exports = { create: context => ({ Program(node) { context.report({ node, message: "${message}" }); } }) };`;
      const { stdout, exitCode } = await lint(
        {
          "eslint.config.mjs": `
          import local from "./local.cjs";
          import other from "./other.mjs";
          import { fileURLToPath } from "node:url";
          local.RULES_DIR = fileURLToPath(new URL("./rules", import.meta.url));
          export default [
            { files: ["a.js"], plugins: { other }, rules: { "other/last": "error" } },
            { files: ["a.js"], plugins: { local }, rules: { "local/one": "error", "local/two": "error" } },
          ];`,
          "local.cjs": `
          const { readdirSync } = require("node:fs");
          const { resolve } = require("node:path");
          let cache;
          module.exports = {
            get rules() {
              const directory = module.exports.RULES_DIR;
              if (!directory) return {};
              cache ??= Object.fromEntries(readdirSync(directory).map(file => [file.slice(0, -3), require(resolve(directory, file))]));
              return cache;
            },
          };`,
          "rules/one.js": rule("one"),
          "rules/two.js": rule("two"),
          "other.mjs": `export default { rules: { last: { create: context => ({ Program(node) { context.report({ node, message: "last" }); } }) } } };`,
          "a.js": "1;\n",
        },
        ["-f", "unix"],
      );
      expect(stdout.split("\n").sort()).toEqual([
        "",
        "3 problems",
        "<dir>/a.js:1:1: last [Error/other/last]",
        "<dir>/a.js:1:1: one [Error/local/one]",
        "<dir>/a.js:1:1: two [Error/local/two]",
      ]);
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  // From @typescript-eslint/parser 7.18.0 and 8.71.1. `no-unused-vars` of typescript-eslint 7, which eslint-plugin-unused-imports 3
  // runs, looks for the scope of `typeParameter.name` to mark the key of a mapped type as used.
  test.each([
    [
      "7.18.0",
      [
        "TSTypeParameter TSMappedType TSTypeAliasDeclaration Program, TSTypeOperator TSTypeParameter TSMappedType TSTypeAliasDeclaration Program, mappedType",
        "TSEnumMember TSEnumDeclaration Program",
        "TSImportType TSTypeAnnotation Identifier VariableDeclarator VariableDeclaration Program",
      ],
    ],
    ["8.71.1", [", , global", "none", "none"]],
  ])(
    "the nodes of deprecated properties have a parent if the installed parser is older than version 8: %s",
    async (version, expected) => {
      const { raw } = await lint(
        {
          "eslint.config.mjs": `
          const up = node => {
            const types = [];
            for (let it = node.parent; it; it = it.parent) types.push(it.type);
            return types.join(" ");
          };
          const old = {
            create: ({ sourceCode, report }) => ({
              TSMappedType(node) {
                const { name, constraint } = node.typeParameter;
                let scope = null;
                for (let it = name; it && !scope; it = it.parent) scope = sourceCode.scopeManager.acquire(it, true);
                scope ??= sourceCode.scopeManager.scopes[0];
                report({ node, message: [up(name), up(constraint.typeAnnotation), scope.type].join(", ") });
              },
              TSEnumDeclaration: node => report({ node, message: up(node.members[0].id) || "none" }),
              TSImportType: node => report({ node, message: up(node.argument) || "none" }),
            }),
          };
          export default [
            {
              files: ["a.ts"],
              plugins: { own: { rules: { old } } },
              languageOptions: { parser: { meta: { name: "typescript-eslint/parser" } } },
              rules: { "own/old": "error" },
            },
          ];`,
          "node_modules/@typescript-eslint/parser/package.json": JSON.stringify({
            name: "@typescript-eslint/parser",
            version,
          }),
          "a.ts": 'type A = { [K in keyof B]: 1 };\nenum E { a = 1 }\nlet c: import("d").e;\n',
        },
        ["-f", "json", "a.ts"],
      );
      expect(JSON.parse(raw)[0].messages.map((it: { message: string }) => it.message)).toEqual(expected);
    },
    timeout,
  );

  // Like typescript-eslint 5's `indent`, which passes ESLint's `indent` a made-up object literal for a mapped type.
  test(
    "supports the nodes typescript-estree creates for deprecated properties, and nodes that a rule makes up",
    async () => {
      const { stdout, exitCode } = await lint(
        {
          "eslint.config.mjs": `
          const old = {
            create: ({ sourceCode, report }) => ({
              TSMappedType(node) {
                const { typeParameter: key, typeAnnotation: value } = node;
                const made = { type: "Property", key, value, range: [sourceCode.getTokenBefore(key).range[0], value.range[1]], parent: node };
                const tokens = ["getFirstToken", "getLastToken", "getTokenBefore", "getTokenAfter"].map(it => sourceCode[it](made).value);
                const is = [key === node.typeParameter, Object.keys(node).includes("typeParameter"), "parent" in key];
                report({ node: key, message: [key.type, key.name.name, key.constraint.type, ...is, ...tokens, sourceCode.getText(made)].join(" ") });
              },
              TSImportType(node) {
                report({ node: node.argument, message: [node.argument.type, node.argument.literal.value].join(" ") });
              },
              // As \`no-unused-expressions\` of typescript-eslint.
              TSAsExpression(node) {
                report({ node: { ...node, expression: null }, message: "a copy" });
              },
            }),
          };
          export default [
            {
              files: ["a.ts"],
              plugins: { own: { rules: { old } } },
              languageOptions: { parser: { meta: { name: "typescript-eslint/parser" } } },
              rules: { "own/old": "error" },
            },
          ];`,
          "a.ts": `type A<T> = { [P in keyof T]: T[P] };\ntype B = import("b").C;\n1 as 2;\n`,
        },
        ["-f", "unix", "a.ts"],
      );
      expect(stdout).toMatchInlineSnapshot(`
        "<dir>/a.ts:1:16: TSTypeParameter P TSTypeOperator true false false [ ] { } [P in keyof T]: T[P] [Error/own/old]
        <dir>/a.ts:2:17: TSLiteralType b [Error/own/old]
        <dir>/a.ts:3:1: a copy [Error/own/old]

        3 problems"
      `);
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  // `require()` rejects a module like this, and some without `await`, such as eslint-plugin-import-x's rules in
  // vitejs/vite.
  test(
    "a rule's module is loaded with import(), and nothing else is loaded",
    async () => {
      const rule = (message: string) =>
        `await 0;\nexport default { create: context => ({ Program(node) { context.report({ node, message: "${message}" }); } }) };`;
      const { stdout, stderr, exitCode } = await lint(
        {
          "eslint.config.mjs": `
          import own from "./plugin.mjs";
          export default [{ files: ["a.js"], plugins: { own }, rules: { "own/one": "error" } }];`,
          "plugin.mjs": `
          import one from "./one.mjs";
          import two from "./two.mjs";
          export default { rules: { one, two } };`,
          "one.mjs": rule("one"),
          "two.mjs": rule("two"),
          "a.js": "1;\n",
        },
        ["-f", "unix", "--timing", "a.js"],
      );
      expect(stdout).toContain("<dir>/a.js:1:1: one [Error/own/one]");
      expect(stderr).toContain("JavaScript: 1 engines loaded 1 modules");
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "a plugin that awaits a promise that never settles is an error",
    async () => {
      const { stdout, stderr, exitCode } = await lint(
        {
          ".oxlintrc.json": oxlintrc({ jsPlugins: ["./plugin.mjs"], rules: { "waits/for": "error" } }),
          "plugin.mjs": `await new Promise(() => {});\nexport default { meta: { name: "waits" }, rules: { for: { create: () => ({}) } } };`,
          "a.js": "1;\n",
        },
        ["a.js"],
      );
      expect(stdout + stderr).toContain("./plugin.mjs\n  A promise never settled, and nothing is left to wait for.");
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "a plugin with a top-level await still loads after a rule leaves an unhandled rejection",
    async () => {
      const reports = (message: string, before = "") =>
        `{ create: context => ({ Program(node) { ${before} context.report({ node, message: "${message}" }); } }) }`;
      const { stdout, stderr, exitCode } = await lint(
        {
          "eslint.config.mjs": `
          import first from "./first.mjs";
          import second from "./second.mjs";
          export default [
            { files: ["a.js"], plugins: { first }, rules: { "first/rejects": "error" } },
            { files: ["b.js"], plugins: { second }, rules: { "second/late": "error" } },
          ];`,
          "first.mjs": `export default { rules: { rejects: ${reports("first", `Promise.reject(new Error("nobody handles this"));`)} } };`,
          "second.mjs": `await new Promise(resolve => setTimeout(resolve, 1));\nexport default { rules: { late: ${reports("second")} } };`,
          // The larger one is linted first.
          "a.js": "1; // first\n",
          "b.js": "1;\n",
        },
        ["-f", "unix", "--threads", "1", "a.js", "b.js"],
      );
      expect(stderr).toContain("error: nobody handles this");
      expect(stdout).toContain("<dir>/a.js:1:1: first [Error/first/rejects]");
      expect(stdout).toContain("<dir>/b.js:1:1: second [Error/second/late]");
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  // The rows are what oxlint 1.87.0 and ESLint 10.12 report for these files with this plugin.
  test(
    "a rule gets raw JSX text with an oxlint config, and text with `&amp;` decoded with an ESLint config",
    async () => {
      const text = String.raw`export const a = (
  <div title="a &amp; b" data-single='&apos; &#183; &#xB7;' data-none="&zzqx; &amp" data-lines="one
    &middot; two">
    one &middot; two
    three &amp; four
    <p>{"a &amp; b"}</p>
    <p inner=<i title="&lt;">&gt;</i>>12n</p>
  </div>
);
`;
      const plugin = String.raw`const say = value => JSON.stringify(value).replace(/[^ -~]/g, it => "\\u" + it.charCodeAt(0).toString(16).padStart(4, "0"));
const by = selector => ({ create: context => ({ [selector]: node => context.report({ node, message: "matches" }) }) });
export default {
  meta: { name: "shows" },
  rules: {
    strings: {
      create(context) {
        const show = node => {
          const token = context.sourceCode.getFirstToken(node);
          const parts = [node.type, say(node.value), "raw", say(node.raw), token.type, say(token.value)];
          context.report({ node, message: parts.concat("bigint" in node ? ["bigint", say(node.bigint)] : []).join(" ") });
        };
        return { JSXText: node => void (node.raw.trim() && show(node)), Literal: show };
      },
    },
    "text-written": by("JSXText[value=/&middot;/]"),
    "text-decoded": by("JSXText[value=/\\u00b7/]"),
    "attribute-written": by('JSXAttribute > Literal[value="a &amp; b"]'),
    "attribute-decoded": by('JSXAttribute > Literal[value="a & b"]'),
  },
};
`;
      const rawText = String.raw`
2:14 attribute-written matches
2:14 strings Literal "a &amp; b" raw "\"a &amp; b\"" JSXText "\"a &amp; b\""
2:38 strings Literal "&apos; &#183; &#xB7;" raw "'&apos; &#183; &#xB7;'" JSXText "'&apos; &#183; &#xB7;'"
2:71 strings Literal "&zzqx; &amp" raw "\"&zzqx; &amp\"" JSXText "\"&zzqx; &amp\""
2:96 strings Literal "one\n    &middot; two" raw "\"one\n    &middot; two\"" JSXText "\"one\n    &middot; two\""
3:19 strings JSXText "\n    one &middot; two\n    three &amp; four\n    " raw "\n    one &middot; two\n    three &amp; four\n    " JSXText "\n    one &middot; two\n    three &amp; four\n    "
3:19 text-written matches
6:9 strings Literal "a &amp; b" raw "\"a &amp; b\"" String "\"a &amp; b\""
7:23 strings Literal "&lt;" raw "\"&lt;\"" JSXText "\"&lt;\""
7:30 strings JSXText "&gt;" raw "&gt;" JSXText "&gt;"
7:39 strings JSXText "12n" raw "12n" JSXText "12n"`;
      const decoded = String.raw`
2:14 attribute-decoded matches
2:14 strings Literal "a & b" raw "\"a &amp; b\"" JSXText "\"a &amp; b\""
2:38 strings Literal "' \u00b7 \u00b7" raw "'&apos; &#183; &#xB7;'" JSXText "'&apos; &#183; &#xB7;'"
2:71 strings Literal "&zzqx; &amp" raw "\"&zzqx; &amp\"" JSXText "\"&zzqx; &amp\""
2:96 strings Literal "one\n    \u00b7 two" raw "\"one\n    &middot; two\"" JSXText "\"one\n    &middot; two\""
3:19 strings JSXText "\n    one \u00b7 two\n    three & four\n    " raw "\n    one &middot; two\n    three &amp; four\n    " JSXText "\n    one \u00b7 two\n    three & four\n    "
3:19 text-decoded matches
6:9 strings Literal "a &amp; b" raw "\"a &amp; b\"" String "\"a &amp; b\""
7:23 strings Literal "<" raw "\"&lt;\"" JSXText "\"&lt;\""
7:30 strings JSXText ">" raw "&gt;" JSXText ">"
7:39 strings JSXText "12n" raw "12n" JSXText "12n" bigint "12n"`;
      const names = ["strings", "text-written", "text-decoded", "attribute-written", "attribute-decoded"];
      const rules = Object.fromEntries(names.map(name => ["shows/" + name, "error"]));
      const files = { "plugin.mjs": plugin, "a.tsx": text, "a.jsx": text, "crlf.tsx": text.replaceAll("\n", "\r\n") };
      const sorted = (rows: string) => rows.trim().split("\n").sort().join("\n");
      const rows = (all: { line: number; column: number; rule: string; message: string }[]) =>
        sorted(
          all.map(it => `${it.line}:${it.column} ${it.rule.replace(/^shows[(/]|\)$/g, "")} ${it.message}`).join("\n"),
        );

      const oxlint = await lint({ ...files, ".oxlintrc.json": oxlintrc({ jsPlugins: ["./plugin.mjs"], rules }) }, [
        "-f",
        "json",
      ]);
      const reported = JSON.parse(oxlint.raw).diagnostics as any[];
      const of = (name: string) =>
        rows(
          reported
            .filter(it => it.filename === name)
            .map(it => ({ ...it.labels[0].span, rule: it.code, message: it.message })),
        );
      expect(of("a.tsx")).toBe(sorted(rawText));
      expect(of("a.jsx")).toBe(sorted(rawText));
      expect(of("crlf.tsx")).toBe(sorted(rawText.replaceAll("\\n", "\\r\\n")));

      const configuration = `
        import shows from "./plugin.mjs";
        const languageOptions = { parserOptions: { ecmaFeatures: { jsx: true } } };
        export default [{ files: ["**/*.jsx"], plugins: { shows }, languageOptions, rules: ${JSON.stringify(rules)} }];`;
      const eslint = await lint({ ...files, "eslint.config.mjs": configuration }, ["-f", "json", "a.jsx"]);
      const [{ messages }] = JSON.parse(eslint.raw) as [{ messages: any[] }];
      expect(rows(messages.map(it => ({ ...it, rule: it.ruleId })))).toBe(sorted(decoded));
    },
    timeout,
  );

  // This is what `@rushstack/eslint-patch` does when `eslint-config-next` loads it, in a package with the same layout.
  test(
    "a config that searches its parent modules for ESLint finds the project's ESLint",
    async () => {
      const files = {
        "node_modules/eslint/package.json": `{ "name": "eslint", "version": "9.0.0" }`,
        "node_modules/@eslint/eslintrc/package.json": `{ "name": "@eslint/eslintrc", "version": "3.0.0" }`,
        "node_modules/@rushstack/eslint-patch/package.json": `{ "name": "@rushstack/eslint-patch", "version": "1.15.0" }`,
        "node_modules/@rushstack/eslint-patch/modern-module-resolution.js": `require("./lib/modern-module-resolution");`,
        "node_modules/@rushstack/eslint-patch/lib/modern-module-resolution.js": `require("./_patch-base");`,
        "node_modules/@rushstack/eslint-patch/lib/_patch-base.js": `
          const path = require("path");
          const folderOf = (name, from) => path.dirname(require.resolve(name + "/package.json", { paths: [from.path] }));
          let bundle, eslint;
          for (let current = module; current && eslint === undefined; current = current.parent) {
            if (bundle !== undefined) {
              if (current.filename.startsWith(folderOf("eslint", current) + path.sep)) eslint = folderOf("eslint", current);
            } else if (current.filename === path.join(folderOf("@eslint/eslintrc", current), "dist/eslintrc.cjs")) {
              bundle = current.filename;
            }
          }
          if (eslint === undefined) throw new Error("Failed to patch ESLint because the calling module was not recognized.");`,
        "node_modules/eslint-config-mine/package.json": `{ "name": "eslint-config-mine", "main": "index.js" }`,
        "node_modules/eslint-config-mine/index.js": `
          require("@rushstack/eslint-patch/modern-module-resolution");
          module.exports = { rules: { "no-debugger": "error" } };`,
        "a.js": "debugger;\n",
      };
      const own = `{ rules: { program: { create: context => ({ Program(node) { context.report({ node, message: "own" }); } }) } } }`;
      const configurations = {
        "eslint.config.mjs": `
          import { createRequire } from "node:module";
          export default [createRequire(import.meta.url)("eslint-config-mine")];`,
        "eslint.config.cjs": `module.exports = [require("eslint-config-mine")];`,
        // An engine runs this config file too, because the plugin is only defined there.
        "eslint.config.js": `module.exports = [require("eslint-config-mine"), { plugins: { own: ${own} }, rules: { "own/program": "error" } }];`,
      };
      for (const [name, configuration] of Object.entries(configurations)) {
        const { stdout, exitCode } = await lint({ ...files, [name]: configuration }, ["-f", "unix", "a.js"]);
        expect(stdout).toContain("<dir>/a.js:1:1: Unexpected 'debugger' statement. [Error/no-debugger]");
        expect(stdout.includes("<dir>/a.js:1:1: own [Error/own/program]")).toBe(name === "eslint.config.js");
        expect(exitCode).toBe(1);
      }
    },
    timeout,
  );

  // ESLint in Node.js gives up at 740: "Not enough stack space to parse input". Bun's parser gives up between 300 and
  // 400 in a debug build, which has larger stack frames.
  test(
    "a rule can traverse a tree that's 2,000 levels deep",
    async () => {
      const depth = isDebug || isASAN ? 200 : 2000;
      const { stdout, exitCode } = await lint(
        {
          "eslint.config.mjs": `
          const deep = {
            create(context) {
              let seen = 0;
              return { ArrayExpression: () => void seen++, "Program:exit": node => context.report({ node, message: "arrays " + seen }) };
            },
          };
          export default [{ files: ["a.js"], plugins: { own: { rules: { deep } } }, rules: { "own/deep": "error" } }];`,
          "a.js": `x = ${Buffer.alloc(depth, "[")}${Buffer.alloc(depth, "]")};\n`,
        },
        ["-f", "unix", "a.js"],
      );
      expect(stdout).toContain(`<dir>/a.js:1:1: arrays ${depth} [Error/own/deep]`);
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  test("a rule gets paths with the system's separators, also on Windows", async () => {
    const source = readFileSync(join(import.meta.dir, "../../../src/lint/js_plugin/worker/paths.js"), "utf8");
    const paths = ["C:/proj/src/a.js", "C:/proj/a.md/0_x.js", "//server/share/a.js", "/proj/a\\b.js"];
    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        `${source}
        const { posix, win32 } = require("node:path");
        const paths = ${JSON.stringify(paths)};
        console.log(JSON.stringify([paths.map(it => nativePath(it, win32)), paths.map(it => nativePath(it, posix))]));`,
      ],
      env,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(JSON.parse(stdout)).toEqual([
      [
        String.raw`C:\proj\src\a.js`,
        String.raw`C:\proj\a.md\0_x.js`,
        String.raw`\\server\share\a.js`,
        String.raw`\proj\a\b.js`,
      ],
      paths,
    ]);
    expect(exitCode).toBe(0);
  });

  // eslint-plugin-turbo relies on this: `physicalFilename.startsWith(directoryOfTheWorkspace)`.
  test(
    "context.filename and context.physicalFilename are spelled like node:path joins from context.cwd",
    async () => {
      const where = `{
        rules: {
          is: {
            create(context) {
              return {
                Program(node) {
                  const { cwd, filename, physicalFilename } = context;
                  context.report({
                    node,
                    message: JSON.stringify({
                      filename: relative(cwd, filename).split(sep),
                      isJoined: filename === join(cwd, relative(cwd, filename)),
                      isInside: filename.startsWith(cwd + sep),
                      physicalFilename: relative(cwd, physicalFilename).split(sep),
                      isPhysicalJoined: physicalFilename === join(cwd, relative(cwd, physicalFilename)),
                      methods: context.getFilename() === filename && context.getPhysicalFilename() === physicalFilename,
                    }),
                  });
                },
              };
            },
          },
        },
      }`;
      const imports = `import { join, relative, sep } from "node:path";`;
      // This format is the same with either tool's config.
      const [withOxlint, withEslint] = await Promise.all([
        lint(
          {
            ".oxlintrc.json": oxlintrc({ jsPlugins: ["./plugin.mjs"], rules: { "where/is": "error" } }),
            "plugin.mjs": `${imports}\nexport default { meta: { name: "where" }, ...${where} };`,
            "src/deep/a.js": "a;\n",
          },
          ["-f", "json-with-metadata"],
        ),
        lint(
          {
            "eslint.config.mjs": `${imports}
            const processor = { preprocess: text => [{ text, filename: "x.js" }], postprocess: lists => lists.flat() };
            export default [
              { files: ["**/*.txt"], processor },
              { files: ["**/*.js"], plugins: { where: ${where} }, rules: { "where/is": "error" } },
            ];`,
            "src/deep/a.js": "a;\n",
            "src/b.txt": "b;\n",
          },
          ["-f", "json-with-metadata", "src"],
        ),
      ]);
      const messagesOf = ({ raw }: { raw: string }) =>
        (JSON.parse(raw).results as { messages: { message: string }[] }[]).flatMap(it =>
          it.messages.map(it => JSON.parse(it.message)),
        );
      const all = { isJoined: true, isInside: true, isPhysicalJoined: true, methods: true };
      const file = { ...all, filename: ["src", "deep", "a.js"], physicalFilename: ["src", "deep", "a.js"] };
      const block = { ...all, filename: ["src", "b.txt", "0_x.js"], physicalFilename: ["src", "b.txt"] };
      expect(messagesOf(withOxlint)).toEqual([file]);
      expect(messagesOf(withEslint)).toEqual([block, file]);
    },
    timeout,
  );

  test(
    "fixes can remove, add and replace the byte order mark",
    async () => {
      const rule = (test: string, fix: string) =>
        `{ meta: { fixable: "code" }, create: context => ({ Program(node) { if (${test}) context.report({ node, message: "mark", fix: fixer => ${fix} }); } }) }`;
      const { files, exitCode } = await lint(
        {
          "eslint.config.mjs": `const marks = { rules: {
              never: ${rule("context.sourceCode.hasBOM", "fixer.removeRange([-1, 0])")},
              always: ${rule("!context.sourceCode.hasBOM", 'fixer.insertTextBeforeRange([0, 1], "\\uFEFF")')},
              again: ${rule('context.sourceCode.text.startsWith("v")', 'fixer.insertTextBeforeRange([0, 1], "\\uFEFF//\\r\\n")')},
            } };
            export default ["never", "always", "again"].map(name => ({ files: [name + ".js"], plugins: { marks }, rules: { ["marks/" + name]: "error" } }));`,
          "never.js": "\uFEFFvar a;\r\n",
          "always.js": "var a;\r\n",
          "again.js": "\uFEFFvar a;\r\n",
        },
        ["--fix", "never.js", "always.js", "again.js"],
        ["never.js", "always.js", "again.js"],
      );
      expect(files).toEqual({
        "never.js": "var a;\r\n",
        "always.js": "\uFEFFvar a;\r\n",
        "again.js": "\uFEFF//\r\nvar a;\r\n",
      });
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  test(
    "node ranges count invalid UTF-8 the same way as the decoded text",
    async () => {
      const files = {
        "eslint.config.mjs": `const p = { rules: { r: { meta: { fixable: "code" }, create: context => ({ VariableDeclarator({ id }) {
            const at = context.sourceCode.text.indexOf(id.name);
            context.report({ node: id, message: [id.name, id.range, context.sourceCode.getText(id), at].join(" "), fix: fixer => fixer.replaceTextRange([at, at + id.name.length], "renamed") });
          } }) } } };
          export default [{ plugins: { p }, rules: { "p/r": "error" } }];`,
        "a.js": Buffer.from(
          "// \xe9 \xf0\x9f \xf0\x9f\x98 \xc3 \xed\xa0\x80 \x80 \xe2\x82 \xf5 \xc0\xaf \xf0\x9f\x98\x80 \xc3\xa9\nconst oldName = 1;\n",
          "latin1",
        ),
      };
      const { raw, exitCode } = await lint(files, ["-f", "json", "a.js"]);
      const [{ message, line, column }] = JSON.parse(raw)[0].messages;
      // This is what ESLint 10.12 reports.
      expect({ message, line, column }).toEqual({ message: "oldName 35,42 oldName 35", line: 2, column: 7 });
      expect(exitCode).toBe(1);
      const fixed = await lint(files, ["--fix", "a.js"], ["a.js"]);
      expect(fixed.files["a.js"].split("\n")[1]).toBe("const renamed = 1;");
    },
    timeout,
  );

  test(
    "columns and native rules' fix ranges count invalid UTF-8 the same way as the decoded text",
    async () => {
      const files = {
        "eslint.config.mjs": `export default [{ rules: { "no-var": "error", "no-debugger": "error" } }];`,
        "a.js": Buffer.from(
          "/* \xf0\x9f\x98 \xe2\x82 \xf0\x9f \xc3 \xed\xa0\x80 \xff */ debugger; var x = 1;\n",
          "latin1",
        ),
      };
      const { raw, exitCode } = await lint(files, ["-f", "json", "a.js"]);
      // This is what ESLint 10.12 reports.
      expect(JSON.parse(raw)[0].messages.map(it => [it.ruleId, it.column, it.endColumn, it.fix?.range])).toEqual([
        ["no-debugger", 21, 30, undefined],
        ["no-var", 31, 41, [30, 33]],
      ]);
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "doesn't start an engine if no rule runs in JavaScript",
    async () => {
      const { stderr, exitCode } = await lint(
        { "eslint.config.mjs": `export default [{ rules: { "no-debugger": "error" } }];`, "a.js": "debugger;\n" },
        ["--timing", "a.js"],
      );
      expect(stderr).toContain("JavaScript: 0 engines loaded 0 modules, 0.0 MB of source, in 0.0ms");
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  // The first regular expression in a config initializes JavaScriptCore, before the number of VMs is known.
  test.skipIf(!isLinux || availableParallelism() < 2)(
    "concurrent JIT threads are on with a few VMs, off with many, and BUN_JSC_useConcurrentJIT overrides that",
    async () => {
      const files = (count: number) => ({
        "eslint.config.mjs": `
        import threads from "./plugin.mjs";
        export default [{ plugins: { threads }, rules: { "threads/helpers": "error", "id-match": ["error", "^[a-z]+$"] } }];`,
        "plugin.mjs": `
        import { readdirSync, readFileSync } from "node:fs";
        const nameOf = id => {
          try {
            return readFileSync("/proc/self/task/" + id + "/comm", "utf8").trim();
          } catch {
            return "";
          }
        };
        // They start when there is something to compile.
        const twice = i => i * 2 + (i % 3);
        let counted;
        const helpers = () => {
          if (counted === undefined) {
            let sum = 0;
            for (let i = 0; i < 5e6; i++) sum += twice(i);
            counted = Math.sign(readdirSync("/proc/self/task").filter(id => nameOf(id) === "JITWorker").length * sum);
          }
          return counted;
        };
        export default {
          rules: { helpers: { create: context => ({ Program: node => context.report({ node, message: "" + helpers() }) }) } },
        };`,
        // 200 of them add up to 16 MB, which is enough for five engines.
        ...Object.fromEntries(
          Array.from({ length: count }, (_, i) => [`f${i}.js`, `1;\n/*${Buffer.alloc(80_000, "x")}*/\n`]),
        ),
      });
      const helpers = async (count: number, variables?: Record<string, string>) => {
        // Behave as on a machine with 8 cores.
        const { raw } = await lint(files(count), ["--threads", "8", "-f", "json"], [], {
          GOMAXPROCS: "8",
          ...variables,
        });
        const results = JSON.parse(raw) as { messages: { ruleId: string; message: string }[] }[];
        const reported = results.flatMap(it => it.messages.filter(message => message.ruleId === "threads/helpers"));
        return [...new Set(reported.map(it => it.message))];
      };
      const [few, many, forcedOn] = await Promise.all([
        helpers(2),
        helpers(200),
        helpers(200, { BUN_JSC_useConcurrentJIT: "1" }),
      ]);
      expect([few, many, forcedOn]).toEqual([["1"], ["0"], ["1"]]);
    },
    timeout,
  );

  test(
    "files of 256 KB or more all go to one engine, with and without types, with any number of threads",
    async () => {
      const run = async (heavy: number, extension: string, threads: string) => {
        const files: Record<string, string> = {
          "tsconfig.json": JSON.stringify({ compilerOptions: { noLib: true, types: [] } }),
          "eslint.config.mjs": `
            import own from "./plugin.mjs";
            export default [
              // A pattern, which starts JavaScriptCore before any engine does.
              { files: ["src/*"], plugins: { own }, rules: { "own/realm": "error", "id-match": ["error", "^[a-z]+$"] } },
              {
                files: ["**/*.ts"],
                plugins: { "@typescript-eslint": { meta: { name: "@typescript-eslint/eslint-plugin" } } },
                languageOptions: { parser: { meta: { name: "typescript-eslint/parser" } }, parserOptions: { projectService: true } },
                rules: { "@typescript-eslint/no-floating-promises": "error" },
              },
            ];`,
          "plugin.mjs": `
            const realm = String(Math.random());
            export default { rules: { realm: { create: context => ({ Program: node => context.report({ node, message: realm }) }) } } };`,
        };
        const text = (size: number) => `foo;\n/*${Buffer.alloc(size, "x")}*/\n`;
        for (let i = 0; i < heavy; i++) files[`src/heavy${i}.${extension}`] = text(270_000);
        for (let i = 0; i < 24; i++) files[`src/light${i}.${extension}`] = text(250_000);
        // Not `-f json`, which includes each file's text.
        const { raw, exitCode } = await lint(files, ["-f", "unix", "--threads", threads, "src"]);
        expect(exitCode).toBe(1);
        const realmsOf = (name: string) =>
          Array.from(raw.matchAll(/(heavy|light)\d+\.\w+:1:1: (\S+) \[Error\/own\/realm\]/g))
            .filter(it => it[1] === name)
            .map(it => it[2]);
        return {
          heavy: [realmsOf("heavy").length, new Set(realmsOf("heavy")).size],
          light: realmsOf("light").length,
        };
      };
      const more = availableParallelism() + 1;
      const [one, many, typed] = await Promise.all([run(1, "js", "8"), run(more, "js", "0"), run(9, "ts", "8")]);
      expect([one.heavy, many.heavy, typed.heavy]).toEqual([
        [1, 1],
        [more, 1],
        [9, 1],
      ]);
      expect([one.light, many.light, typed.light]).toEqual([24, 24, 24]);
    },
    timeout,
  );

  // A VM takes seconds to start in a debug build, so a second one isn't worth it there for files like these.
  test.skipIf(isDebug || isASAN)(
    "engines that outgrow their memory budget are freed, and every file is still linted",
    async () => {
      const run = async (count: number, threads: string) => {
        const files: Record<string, string> = {
          "eslint.config.mjs": `
            import own from "./plugin.mjs";
            // A pattern, which starts JavaScriptCore before any engine does.
            export default [{ files: ["src/*"], plugins: { own }, rules: { "own/grows": "error", "id-match": ["error", "^[a-z]+$"] } }];`,
          "plugin.mjs": `
            import { randomUUID } from "node:crypto";
            import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
            const kept = [];
            let isNoted = false;
            const grows = {
              create: context => ({
                Program(node) {
                  if (!isNoted) {
                    isNoted = true;
                    mkdirSync("engines", { recursive: true });
                    writeFileSync("engines/" + randomUUID(), "");
                  }
                  // It takes its time, so that a thread asks for an engine while the first is in use.
                  let sum = 0;
                  for (let i = 0; i < 1e7; i++) sum += i % 7;
                  // Nothing foresees it: as long as there is one engine it does not grow at all. From the second on each keeps
                  // 64 MB for every file, until the process is well over what is for the engines.
                  if (readdirSync("engines").length > 1 && process.memoryUsage.rss() < 1100 << 20) {
                    kept.push(new Uint8Array(64 << 20).fill(sum % 5));
                  }
                  context.report({ node, message: "seen" });
                },
              }),
            };
            export default { rules: { grows } };`,
        };
        const text = `foo;\n/*${Buffer.alloc(250_000, "x")}*/\n`;
        for (let i = 0; i < count; i++) files[`src/${i}.js`] = text;
        // Half of this is budgeted for the engines, and above three quarters an engine is freed.
        const variables = { BUN_LINT_MEMORY: String(1 << 30) };
        const { raw, stderr, exitCode } = await lint(
          files,
          ["-f", "unix", "--timing", "--threads", threads, "src"],
          [],
          variables,
        );
        expect(exitCode).toBe(1);
        const seen = raw.split(":1:1: seen [Error/own/grows]").length - 1;
        return { seen, freed: Number(/, engines freed to save memory: (\d+)/.exec(stderr)?.[1] ?? 0) };
      };
      const more = Math.max(40, availableParallelism() + 1);
      const [one, some, many] = await Promise.all([run(1, "8"), run(96, "8"), run(more, "0")]);
      expect(one).toEqual({ seen: 1, freed: 0 });
      expect([some.seen, many.seen]).toEqual([96, more]);
      expect(some.freed).toBeGreaterThan(0);
    },
    timeout,
  );

  test(
    "in a file without any node a rule listens for, no listener is called, and `after` can still read the tree",
    async () => {
      const run = async (count: number, threads: string) => {
        const files: Record<string, string> = {
          ".oxlintrc.json": oxlintrc({
            jsPlugins: ["./plugin.mjs"],
            rules: { "own/rare": "error", "own/selected": "error", "own/after": "error" },
          }),
          "plugin.mjs": `
            const seen = (context, what) => node => context.report({ node, message: what });
            export default {
              meta: { name: "own" },
              rules: {
                rare: { create: context => ({ WithStatement: seen(context, "with"), "LabeledStatement:exit": seen(context, "label") }) },
                selected: { create: context => ({ "CallExpression[callee.name='wanted']": seen(context, "call") }) },
                after: {
                  createOnce: context => ({
                    DebuggerStatement() {},
                    after: () => context.report({ loc: { line: 1, column: 0 }, message: "statements: " + context.sourceCode.ast.body.length }),
                  }),
                },
              },
            };`,
        };
        const texts = ["a; b;\n", "x: a;\n", "wanted();\n", "unwanted(); b; c;\n"];
        for (let i = 0; i < count; i++) files[`src/${i}.js`] = texts[i % texts.length];
        const { raw, exitCode } = await lint(files, ["-f", "unix", "--threads", threads, "src"]);
        expect(exitCode).toBe(1);
        const messages = Array.from(
          raw.matchAll(/src\/(\d+)\.js:\d+:\d+: (.*?) \[/g),
          it => `${Number(it[1]) % texts.length} ${it[2]}`,
        );
        return Object.fromEntries(
          Map.groupBy(messages, it => it)
            .entries()
            .map(([key, all]) => [key, all.length]),
        );
      };
      expect(await run(1, "8")).toEqual({ "0 statements: 2": 1 });
      const more = 4 * (availableParallelism() + 1);
      const each = more / 4;
      expect(await run(more, "0")).toEqual({
        "0 statements: 2": each,
        "1 label": each,
        "1 statements: 1": each,
        "2 call": each,
        "2 statements: 1": each,
        "3 statements: 3": each,
      });
    },
    timeout,
  );

  test(
    "a suggestion has the data the rule passed, even if it's empty",
    async () => {
      const { raw, exitCode } = await lint(
        {
          "eslint.config.mjs": `
          const rule = {
            meta: { hasSuggestions: true, messages: { a: "a", b: "b", c: "c {{ it }}" } },
            create: context => ({
              Program(node) {
                const fix = fixer => fixer.insertTextAfter(node, ";");
                const suggest = [{ messageId: "b", data: {}, fix }, { messageId: "b", fix }, { messageId: "c", data: { it: "x" }, fix }];
                context.report({ node, messageId: "a", suggest });
              },
            }),
          };
          export default [{ files: ["a.js"], plugins: { own: { rules: { rule } } }, rules: { "own/rule": "error" } }];`,
          "a.js": "1\n",
        },
        ["-f", "json", "a.js"],
      );
      const suggestions = JSON.parse(raw)[0].messages[0].suggestions;
      expect(suggestions.map((it: any) => [it.desc, it.data])).toEqual([
        ["b", {}],
        ["b", undefined],
        ["c x", { it: "x" }],
      ]);
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "a rule sees the config's settings, with an oxlint config too",
    async () => {
      const { stdout, exitCode } = await lint(
        {
          ".oxlintrc.json": JSON.stringify({
            jsPlugins: ["./plugin.mjs"],
            settings: { mine: { a: 1 } },
            rules: { "own/says": "error" },
          }),
          "plugin.mjs": `
          const says = { create: context => ({ Program: node => context.report({ node, message: JSON.stringify(context.settings) }) }) };
          export default { meta: { name: "own" }, rules: { says } };`,
          "a.js": "1;\n",
        },
        ["-f", "unix", "a.js"],
      );
      expect(stdout).toContain(`a.js:1:1: {"mine":{"a":1}} [Error/own(says)]`);
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  test.each(["--disallow-code-generation-from-strings", "--disallow-code-generation-from-strings=strict"])(
    "bun %s lint: plugins run, and neither they nor the config file can evaluate code from a string",
    async flag => {
      using dir = tempDir("bun-lint-js-plugins", {
        "eslint.config.mjs": `
          const tried = () => { try { return "allowed: " + new Function("return 1")(); } catch { return "refused"; } };
          const atFirst = tried();
          const tries = { create: context => ({ Identifier: node => context.report({ node, message: atFirst + ", " + tried() + " in a " + node.parent.type }) }) };
          export default [{ files: ["a.js"], plugins: { own: { rules: { tries } } }, rules: { "own/tries": "error" } }];`,
        "a.js": "foo;\n",
      });
      await using proc = spawn({
        cmd: [bunExe(), flag, "lint", "-f", "unix", "a.js"],
        env,
        cwd: String(dir),
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect(stdout).toContain("a.js:1:1: refused, refused in a ExpressionStatement [Error/own/tries]");
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  // nodejs/node builds a selector from this list, and rules use it to tell `import "ws"` from `import "fs"`.
  test(
    "a config file and a rule see Node.js's list of builtin modules",
    async () => {
      const { stdout, exitCode } = await lint(
        {
          "eslint.config.mjs": `
          import own from "./plugin.mjs";
          import { builtinModules, isBuiltin } from "node:module";
          const said = ["fs", "undici", "ws", "bun", "bun:test"].map(it => +builtinModules.includes(it) + "" + +isBuiltin(it)).join();
          export default [{ files: ["a.js"], plugins: { own }, settings: { said }, rules: { "own/says": "error" } }];`,
          "plugin.mjs": `
          import { builtinModules, isBuiltin } from "node:module";
          const said = ["fs", "undici", "ws", "bun", "bun:test"].map(it => +builtinModules.includes(it) + "" + +isBuiltin(it)).join();
          const says = { create: context => ({ Program: node => context.report({ node, message: context.settings.said + " " + said }) }) };
          export default { rules: { says } };`,
          "a.js": "1;\n",
        },
        ["-f", "unix", "a.js"],
      );
      expect(stdout).toContain("a.js:1:1: 11,00,00,00,00 11,00,00,00,00 [Error/own/says]");
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  // lodash's `merge(...tseslint.configs.recommended, other)` does this.
  test(
    "loads a plugin that the config file merged into an object that a package exports",
    async () => {
      const { stdout, exitCode } = await lint(
        {
          "node_modules/eslint-config-shared/package.json": JSON.stringify({
            name: "eslint-config-shared",
            main: "index.js",
          }),
          "node_modules/eslint-config-shared/index.js": `module.exports = { configs: { recommended: [{ plugins: {} }] } };`,
          "eslint.config.mjs": `
          import shared from "eslint-config-shared";
          const seen = { create: context => ({ Program: node => context.report({ node, message: "seen" }) }) };
          const [first] = shared.configs.recommended;
          first.plugins.own = { rules: { seen } };
          export default [{ ...first, files: ["a.js"], rules: { "own/seen": "error" } }];`,
          "a.js": "1;\n",
        },
        ["-f", "unix", "a.js"],
      );
      expect(stdout).toContain("<dir>/a.js:1:1: seen [Error/own/seen]");
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  // The other tests set the number of threads. Users don't.
  test(
    "lints every file with one thread per core and more files than threads",
    async () => {
      const count = 2 * availableParallelism() + 1;
      const files: Record<string, string> = {
        ".oxlintrc.json": oxlintrc({ jsPlugins: ["./plugin.mjs"], rules: { "demo/no-foo": "error" } }),
        "plugin.mjs": noFoo,
      };
      for (let i = 0; i < count; i++) files[`src/${i}.js`] = "foo();\n";
      const { raw, exitCode } = await lint(files, ["--threads", "0", "-f", "json"]);
      const names = JSON.parse(raw).diagnostics.map((it: { filename: string }) => it.filename.replaceAll("\\", "/"));
      expect(names.sort()).toEqual(Array.from({ length: count }, (_, i) => `src/${i}.js`).sort());
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "never contacts a registry for a package that a plugin imports or requires",
    async () => {
      const requests: string[] = [];
      using registry = Bun.serve({
        port: 0,
        fetch(request) {
          requests.push(new URL(request.url).pathname);
          return new Response("{}", { status: 404 });
        },
      });
      const variables = { BUN_CONFIG_REGISTRY: registry.url.href, NPM_CONFIG_REGISTRY: registry.url.href };
      const run = (plugin: string) =>
        lint(
          {
            ".oxlintrc.json": oxlintrc({ jsPlugins: ["./plugin.mjs"], rules: { "demo/x": "error" } }),
            "plugin.mjs": plugin,
            "a.js": "1;\n",
          },
          ["a.js"],
          [],
          variables,
        );
      const rules = (create: string) =>
        `export default { meta: { name: "demo" }, rules: { x: { create: () => ${create} } } };`;
      const [imported, required, awaited] = await Promise.all([
        run(`import "is-not-installed-anywhere";\n${rules("({})")}`),
        run(rules(`(require("is-not-installed-anywhere"), {})`)),
        run(`await import("is-not-installed-anywhere").catch(() => {});\n${rules("({})")}`),
      ]);
      expect(imported.stdout).toContain("Cannot find package 'is-not-installed-anywhere'");
      expect(required.stdout).toContain("Cannot find module 'is-not-installed-anywhere'");
      expect(awaited.exitCode).toBe(0);
      expect(requests).toEqual([]);
    },
    timeout,
  );
});
