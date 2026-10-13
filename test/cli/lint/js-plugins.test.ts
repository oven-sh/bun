import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, normalizeBunSnapshot, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { endChildren, spawn } from "../children";
import { cases as callCases } from "./oracle/jsplugins/calls/cases.mjs";
import { cases as codePathCases, fileOf, isTypeScript } from "./oracle/jsplugins/code-paths/cases.mjs";
import { cases as oxlintCases } from "./oracle/jsplugins/oxlint/cases.mjs";
import {
  cases as scopeCases,
  fileOf as scopeFileOf,
  globals as scopeGlobals,
} from "./oracle/jsplugins/scopes/cases.mjs";
import { cases as tokenCases, fileOf as tokenFileOf } from "./oracle/jsplugins/tokens/cases.mjs";
import { cases as treeCases } from "./oracle/jsplugins/trees/cases.mjs";

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
) {
  using dir = tempDir("bun-lint-js-plugins", files);
  await using proc = spawn({
    cmd: [bunExe(), "lint", ...(args.includes("--threads") ? [] : ["--threads", "2"]), ...args],
    env: { ...env, ...variables },
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

const oxlintrc = (config: object) =>
  JSON.stringify({ categories: { correctness: "off" }, ignorePatterns: ["plugin.mjs"], ...config });

// Each thread that lints a file starts a VM, which takes seconds in a debug build.
const timeout = isDebug || isASAN ? 120_000 : 10_000;

// As under ESLint 10.12.0.
test.concurrent(
  "the .env of the project is not in `process.env` of a plugin, and what is inherited is",
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

// Reports every identifier called `foo`, with what the API has to say about it.
const noFoo = `
export default {
  meta: { name: "eslint-plugin-demo" },
  rules: {
    "no-foo": {
      meta: {
        type: "problem",
        fixable: "code",
        hasSuggestions: true,
        messages: { found: "No {{ name }} in a {{parent}}{{suffix}}", rename: "Call it {{to}}." },
        schema: [{ type: "object", properties: { suffix: { type: "string", default: "." } }, additionalProperties: false }],
        defaultOptions: [{}],
      },
      create(context) {
        return {
          Identifier(node) {
            if (node.name !== "foo") return;
            context.report({
              node,
              messageId: "found",
              data: { name: node.name, parent: node.parent.type, suffix: context.options[0].suffix },
              fix: fixer => fixer.replaceText(node, "bar"),
              suggest: [{ messageId: "rename", data: { to: "baz" }, fix: fixer => fixer.replaceText(node, "baz") }],
            });
          },
        };
      },
    },
  },
};
`;

describe.concurrent("bun lint with plugins in JavaScript", () => {
  test(
    "jsPlugins of an .oxlintrc.json: messages, data, options with the defaults of the schema",
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
    "--fix applies the fixes of a rule, also behind characters that are not ASCII",
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

  test(
    "comments disable and configure a rule of a plugin",
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
    "selectors, :exit and the order of the listeners",
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

  test(
    "tokens, comments, scopes and locations",
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

  // As with oxlint 1.87: the mark is on the plugin's variable, and oxlint's own rules have their own.
  test(
    "a variable that a rule marks as used is still unused for oxlint's no-unused-vars",
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
    "createOnce, before and after of oxlint's API",
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

  // The two reports are oxlint 1.87's.
  test(
    "after runs once for a file, also when another rule's create threw for the file before it",
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
    "a plugin in TypeScript, one from a package, one with an alias",
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

  // As `react/jsx-one-expression-per-line` asks.
  test(
    "isSpaceBetweenTokens looks into the text between two elements, isSpaceBetween does not",
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

  // Nothing of it is built in.
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
    "eslint-plugin-regexp is a plugin like any other, the package of the project runs: %s",
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

  // To oxlint `n`, which a plugin can be called, and `node`, which is built in, are two plugins. What oxlint 1.87 prints, sorted.
  const calledN = {
    "n.js": `const rule = message => ({ create: context => ({ BinaryExpression(node) { context.report({ node, message }); } }) });
      export default { meta: { name: "eslint-plugin-n" }, rules: { "no-path-concat": rule("of the package"), "only-there": rule("only there") } };`,
    "a.js": `export const p = __dirname + "/x";\n`,
  };
  const besideNode = (more: object) =>
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
      "both are on, the other way round",
      { "rules": { "node/no-path-concat": "warn", "n/no-path-concat": "error" } },
      [
        "a.js:1:18: Use `path.join()` or `path.resolve()` instead of string concatenation [Warning/node(no-path-concat)]",
        "a.js:1:18: of the package [Error/n(no-path-concat)]",
      ],
      1,
    ],
    [
      "only what is built in",
      { "rules": { "node/no-path-concat": "warn" } },
      [
        "a.js:1:18: Use `path.join()` or `path.resolve()` instead of string concatenation [Warning/node(no-path-concat)]",
      ],
      0,
    ],
    [
      "only the plugin's",
      { "rules": { "n/no-path-concat": "warn" } },
      ["a.js:1:18: of the package [Warning/n(no-path-concat)]"],
      0,
    ],
    [
      "node is not among the plugins",
      { "plugins": [], "rules": { "n/no-path-concat": "warn", "node/no-path-concat": "error" } },
      ["a.js:1:18: of the package [Warning/n(no-path-concat)]"],
      0,
    ],
    [
      "a category turns on what is built in",
      { "categories": { "correctness": "off", "restriction": "warn" }, "rules": { "n/only-there": "error" } },
      [
        "a.js:1:18: Use `path.join()` or `path.resolve()` instead of string concatenation [Warning/node(no-path-concat)]",
        "a.js:1:18: only there [Error/n(only-there)]",
      ],
      1,
    ],
    [
      "an override turns off what is built in",
      {
        "rules": { "n/no-path-concat": "error", "node/no-path-concat": "warn" },
        "overrides": [{ "files": ["*.js"], "rules": { "node/no-path-concat": "off" } }],
      },
      ["a.js:1:18: of the package [Error/n(no-path-concat)]"],
      1,
    ],
    [
      "an override turns off the plugin's",
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
    "a plugin that is called n beside the node that is built in: %s",
    async (_, more, expected, exitCode) => {
      const result = await lint({ ...calledN, ".oxlintrc.json": besideNode(more) }, ["-f", "unix", "a.js"]);
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

  // As oxlint 1.87, three runs of three.
  test(
    "at one place, what is built in comes before what a plugin reports",
    async () => {
      const rules = { "n/no-path-concat": "error", "n/only-there": "warn", "node/no-path-concat": "warn" };
      const { stdout } = await lint({ ...calledN, ".oxlintrc.json": besideNode({ rules }) }, ["-f", "unix", "a.js"]);
      expect([...stdout.matchAll(/^a\.js:1:18: .* \[\w+\/(.*)\]$/gm)].map(it => it[1])).toEqual([
        "node(no-path-concat)",
        "n(no-path-concat)",
        "n(only-there)",
      ]);
    },
    timeout,
  );

  test(
    "a plugin that is called n beside the node that is built in: --print-config has what is built in, as oxlint's",
    async () => {
      const rules = { "n/no-path-concat": "error", "node/no-path-concat": "warn" };
      const { raw } = await lint({ ...calledN, ".oxlintrc.json": besideNode({ rules }) }, ["--print-config"]);
      expect(JSON.parse(raw).rules).toEqual({ "node/no-path-concat": "warn" });
    },
    timeout,
  );

  describe("a note says which rules ran in JavaScript that are built in", () => {
    const rules = { "n/no-path-concat": "error" };
    const packaged = (version: string) => ({
      "a.js": calledN["a.js"],
      "node_modules/eslint-plugin-n/package.json": JSON.stringify({
        name: "eslint-plugin-n",
        version,
        type: "module",
        main: "n.js",
      }),
      "node_modules/eslint-plugin-n/n.js": calledN["n.js"],
    });
    const notes = async (files: Record<string, string>, more: object, ...flags: string[]) =>
      (await lint({ ...files, ".oxlintrc.json": besideNode(more) }, [...flags, "a.js"])).stderr
        .split("\n")
        .filter(it => it.startsWith("note: ") || it.startsWith("  To use "));

    test(
      "a package, with its version",
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
      "a file, and rules that are not built in",
      async () => {
        const more = { "n/no-new-require": "warn", "n/only-there": "error", "n/no-sync": "off" };
        const plugin = calledN["n.js"].replace(
          `"only-there"`,
          `"no-new-require": rule("new"), "no-sync": rule("sync"), "only-there"`,
        );
        expect(await notes({ ...calledN, "n.js": plugin }, { rules: { ...rules, ...more } })).toEqual([
          `note: 2 "n" rules ran in JavaScript from ./n.js, but bun lint has them built in (version 18.4.1)`,
          `  To use the built-in rules, rename them to "node/.." and add "node" to "plugins". Keep ./n.js for the other rule. Reports may differ.`,
        ]);
      },
      timeout,
    );

    test(
      "nothing where nobody reads it, and nothing where there is nothing to say",
      async () => {
        for (const flags of [["--quiet"], ["--silent"], ["-f", "json"], ["-f", "unix"], ["-f", "github"]]) {
          expect([flags, await notes(calledN, { rules }, ...flags)]).toEqual([flags, []]);
        }
        expect(await notes(calledN, { rules: { "n/only-there": "error" } })).toEqual([]);
        expect(await notes(calledN, { rules: { "n/no-path-concat": "off", "node/no-path-concat": "error" } })).toEqual(
          [],
        );
        expect(await notes(calledN, { jsPlugins: [], rules })).toEqual([]);
      },
      timeout,
    );
  });

  test(
    "a plugin that is called n beside the node that is built in: each has its name in oxlint-suppressions.json",
    async () => {
      const rules = { "n/no-path-concat": "error", "node/no-path-concat": "error" };
      const { files } = await lint(
        { ...calledN, ".oxlintrc.json": besideNode({ rules }) },
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
    "options that the schema refuses, and a rule that does not exist",
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
      const places = JSON.parse(json.raw)[0].messages.map((it: any) => [it.message, it.line, it.column]);
      expect(places).toEqual([
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

  // As under ESLint 10.12.0.
  test.concurrent(
    "`-f json` has the `data` of a suggestion that has a `desc`",
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

  // As under ESLint 10.12.0 with eslint-plugin-react-hooks 7.1.1, which passes `desc` and `fix` only.
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

  // ESLint 10.12.0 and oxlint 1.87.0 call `fix`, and the `fix` of each suggestion, when a problem is reported, whoever reads what
  // they return.
  describe("a rule is asked for its fixes whatever is printed", () => {
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
    // Named, for `--silent` is a flag of oxlint.
    const eslint = (rule: string, flags: string[], severity?: string) =>
      lint(forEslint(rule, severity), ["-c", "eslint.config.mjs", ...flags, "a.js"]);
    const thrown = (rule: string, message: string) => ({
      stdout: "",
      stderr: `error: ${message}\nOccurred while linting <dir>/a.js:1\nRule: "demo/${rule}"`,
      exitCode: 2,
    });
    const said = ({ stdout, stderr, exitCode }: Awaited<ReturnType<typeof lint>>) => ({ stdout, stderr, exitCode });

    test.each([
      [[]],
      [["-f", "unix"]],
      [["-f", "json"]],
      [["-f", "pretty"]],
      [["--silent"]],
      [["--quiet", "-f", "unix"]],
    ])(
      "one that throws ends the run of ESLint's flavour: %j",
      async flags => {
        const [fix, suggestion, notFixable] = await Promise.all(
          ["fix-throws", "suggestion-throws", "not-fixable"].map(rule => eslint(rule, flags)),
        );
        expect(said(fix)).toEqual(thrown("fix-throws", "The fixer threw."));
        expect(said(suggestion)).toEqual(thrown("suggestion-throws", "The suggestion threw."));
        expect(said(notFixable)).toEqual(
          thrown("not-fixable", 'Fixable rules must set the `meta.fixable` property to "code" or "whitespace".'),
        );
      },
      timeout,
    );

    test(
      "with --quiet a rule that warns does not run, unless the warnings are counted",
      async () => {
        const [quiet, counted] = await Promise.all([
          eslint("fix-throws", ["--quiet", "-f", "unix"], "warn"),
          eslint("fix-throws", ["--quiet", "--max-warnings", "0", "-f", "unix"], "warn"),
        ]);
        expect({ stdout: quiet.stdout, exitCode: quiet.exitCode }).toEqual({ stdout: "", exitCode: 0 });
        expect(said(counted)).toEqual(thrown("fix-throws", "The fixer threw."));
      },
      timeout,
    );

    test(
      "what a fixer does shows in what the rule reports afterwards",
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
      "one that throws is reported for the file in oxlint's flavour: %j",
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

    // `supportsAutofix: false` is ESLint's `disableFixes`: then, and only then, no rule is asked.
    test.each([
      [true, 'fix={"range":[10,10],"text":"/**/"} suggestions=1', 'fix={"range":[0,3],"text":"let"} suggestions=0'],
      [false, "fix=null suggestions=0", "fix=null suggestions=0"],
    ])(
      "`postprocess` is given the fixes whatever is printed: supportsAutofix: %j",
      async (supportsAutofix, ofPlugin, builtIn) => {
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
            `<dir>/a.x:1:1: bad ${ofPlugin} [Error/demo/fixes]`,
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
    "a plugin that cannot be loaded",
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
    "what a plugin prints is printed, and process.exit() ends the run",
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
    "the exit handlers of a plugin run after the report, once for each thread that has loaded it",
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
    "what a plugin keeps about a file under its sourceCode or context is not there for the next file",
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
    "code paths, default options that are not JSON, and a plugin whose rules are in no fixed order",
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
      // The events are what ESLint 10 gives this rule.
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
    "more files than threads: every file gets its reports, and nothing else is said",
    async () => {
      const files: Record<string, string> = {
        ".oxlintrc.json": oxlintrc({ jsPlugins: ["./plugin.mjs"], rules: { "demo/no-foo": "error" } }),
        "plugin.mjs": noFoo,
      };
      // The file number `i` has `i % 5` of them.
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
    "plugins of an eslint.config.js: imported, and defined in the file",
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

  // As much of the package as a configuration uses.
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
    "the configuration file is not run again for a plugin that a module exports, also through fixupPluginRules",
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
      // What the process prints that evaluates the file is not shown.
      expect(stderr).not.toContain("The configuration file runs.");
      expect(stderr).toMatch(/JavaScript: [12] engines loaded [12] modules, /);
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "an engine runs the configuration file, for the files with a rule of a plugin that only it has",
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
    "a rule is loaded from the module that exports it, without the plugin and its other rules",
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

  // What a process has one of, like the caches of the resolver, is made with its first VM, and not for several threads at a time.
  test.skipIf(!isDebug)(
    "no other engine starts before the first is there",
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
      // How many there are depends on the number of cores.
      expect(steps.filter(it => it === "begins").length).toBe(steps.filter(it => it === "is made").length);
      expect(steps.slice(0, 2)).toEqual(["begins", "is made"]);
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "what JSON cannot say: a RegExp in the options, a function in the settings. And rules can change their options",
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

  // As `synckit` does it, which `eslint-plugin-prettier` is made with.
  test(
    "a rule waits for a worker of its own on every thread that lints",
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

  // As `@cspell/eslint-plugin` does it. With types the threads that lint begin anew for every project and every step of the
  // checker, while the workers have Bun's pool read files.
  test(
    "a rule waits for a worker of its own, which reads files, in projects with types",
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
        // As many threads in a pool, however many cores there are.
        env: { ...env, GOMAXPROCS: "8" },
        cwd: String(dir),
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const reports = stdout.split("\n").filter(it => it.endsWith(": 5 [Error/demo/length]")).length;
      // With what it says.
      expect({ reports, exitCode, stderr }).toEqual({ reports: 128, exitCode: 1, stderr: expect.any(String) });
    },
    timeout,
  );

  test(
    "there are as many engines as pay, with types and without, and they report the same",
    async () => {
      // `waits`: an engine stays in use with its first file until another engine has one. A thread only asks for an engine while
      // the others are in use, and whether they are is otherwise up to how the threads happen to run.
      const run = async (count: number, extension: string, size: number, threads: string, waits = false) => {
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
            let isFirst = ${waits};
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
        // One comment: thousands of them take a debug build minutes.
        const text = `foo;\n/*${Buffer.alloc(size, "x")}*/\n`;
        for (let i = 0; i < count; i++) files[`src/${i}.${extension}`] = text;
        // How many engines fit depends on how much memory is free, which is up to the machine that runs this.
        const variables = { BUN_LINT_MEMORY: String(64 * 2 ** 30) };
        const args = ["-f", "unix", "--timing", "--threads", threads, "src"];
        const { stdout, stderr, exitCode } = await lint(files, args, [], variables);
        expect(exitCode).toBe(1);
        return { stdout, engines: Number(/JavaScript: (\d+) engines/.exec(stderr)?.[1]) };
      };
      // 24 files of 250 KB, which are not heavy yet, are 6 MB, which three engines are for.
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
    'a rule written for ESLint 8, and a plugin that is an ES module with an export "module.exports"',
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
    "a rule that asks for types is taken out, the rest runs, and the run ends with an error that names it",
    async () => {
      // As `getParserServices` of @typescript-eslint/utils does it.
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
        "2 rules did not run because rules that run in JavaScript cannot use type information: typed/at-once, typed/later",
      );
      expect(stderr).not.toContain("You have used a rule");
      expect(exitCode).toBe(2);
      expect((await lint(files, ["--allow-unsupported", "a.js", "b.js"])).exitCode).toBe(1);
    },
    timeout,
  );

  // As `eslint-plugin-import` does it to read the modules that a file imports.
  test.each(["parser", "* as parser"])(
    "a rule parses a text of its own with languageOptions.parser, which is loaded when it is called: import %s",
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

  // As `eslint-plugin-rulesdir` and the plugin of nodejs/node: without the assignment the plugin has no rules.
  test(
    "a plugin that the configuration file tells where its rules are",
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

  // As `indent` of typescript-eslint 5, which hands ESLint's `indent` an object literal for a mapped type.
  test(
    "the nodes that typescript-estree makes for deprecated properties, and nodes that a rule makes up",
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

  // `require()` refuses such a module, and some without `await`: the rules of eslint-plugin-import-x in vitejs/vite.
  test(
    "the module of a rule is loaded by import(), and alone",
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
    "a plugin that waits for what never comes is an error",
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
    "a plugin that waits is loaded after a rule has left a rejection that nobody handles",
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
    "a rule gets the text in JSX as it is written under oxlint, and with what `&amp;` stands for under ESLint",
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
      const written = String.raw`
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
      expect(of("a.tsx")).toBe(sorted(written));
      expect(of("a.jsx")).toBe(sorted(written));
      expect(of("crlf.tsx")).toBe(sorted(written.replaceAll("\\n", "\\r\\n")));

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

  // What `@rushstack/eslint-patch` does when `eslint-config-next` loads it, in a package that is laid out as it is.
  test(
    "a configuration that looks for ESLint among the modules that have loaded it finds that of the project",
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
        // An engine runs this one too: nothing else has the plugin.
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

  // ESLint in Node.js gives up at 740: "Not enough stack space to parse input". So does the parser here between 300 and 400 in a
  // debug build, whose frames are larger.
  test(
    "a rule goes through a tree that is 2,000 deep",
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

  test("a path reaches a rule as the system writes it, also on Windows", async () => {
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

  // What eslint-plugin-turbo does with them: `physicalFilename.startsWith(directoryOfTheWorkspace)`.
  test(
    "context.filename and context.physicalFilename are what node:path makes of context.cwd",
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
      // The format is one that is the same whosever the configuration is.
      const [ofOxlint, ofEslint] = await Promise.all([
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
      const said = ({ raw }: { raw: string }) =>
        (JSON.parse(raw).results as { messages: { message: string }[] }[]).flatMap(it =>
          it.messages.map(it => JSON.parse(it.message)),
        );
      const all = { isJoined: true, isInside: true, isPhysicalJoined: true, methods: true };
      const file = { ...all, filename: ["src", "deep", "a.js"], physicalFilename: ["src", "deep", "a.js"] };
      const block = { ...all, filename: ["src", "b.txt", "0_x.js"], physicalFilename: ["src", "b.txt"] };
      expect(said(ofOxlint)).toEqual([file]);
      expect(said(ofEslint)).toEqual([block, file]);
    },
    timeout,
  );

  test(
    "fixes that take, give and replace the byte order mark",
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
    "what is no UTF-8 is as long for the places of nodes as in the text",
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
      // What ESLint 10.12 says.
      expect({ message, line, column }).toEqual({ message: "oldName 35,42 oldName 35", line: 2, column: 7 });
      expect(exitCode).toBe(1);
      const fixed = await lint(files, ["--fix", "a.js"], ["a.js"]);
      expect(fixed.files["a.js"].split("\n")[1]).toBe("const renamed = 1;");
    },
    timeout,
  );

  test(
    "what is no UTF-8 is as long for columns and for the fixes of native rules as in the text",
    async () => {
      const files = {
        "eslint.config.mjs": `export default [{ rules: { "no-var": "error", "no-debugger": "error" } }];`,
        "a.js": Buffer.from(
          "/* \xf0\x9f\x98 \xe2\x82 \xf0\x9f \xc3 \xed\xa0\x80 \xff */ debugger; var x = 1;\n",
          "latin1",
        ),
      };
      const { raw, exitCode } = await lint(files, ["-f", "json", "a.js"]);
      // What ESLint 10.12 says.
      expect(JSON.parse(raw)[0].messages.map(it => [it.ruleId, it.column, it.endColumn, it.fix?.range])).toEqual([
        ["no-debugger", 21, 30, undefined],
        ["no-var", 31, 41, [30, 33]],
      ]);
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "without rules in JavaScript there is no engine",
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

  // The first regular expression of a configuration starts JavaScriptCore, before anybody knows how many VMs there are going to be.
  test.skipIf(!isLinux || availableParallelism() < 2)(
    "threads that compile beside a VM: with a few VMs, not with many, and as BUN_JSC_useConcurrentJIT says",
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
        // 200 of them are 16 MB, which five engines are for.
        ...Object.fromEntries(
          Array.from({ length: count }, (_, i) => [`f${i}.js`, `1;\n/*${Buffer.alloc(80_000, "x")}*/\n`]),
        ),
      });
      const helpers = async (count: number, variables?: Record<string, string>) => {
        // As on a machine with 8 cores.
        const { raw } = await lint(files(count), ["--threads", "8", "-f", "json"], [], {
          GOMAXPROCS: "8",
          ...variables,
        });
        const results = JSON.parse(raw) as { messages: { ruleId: string; message: string }[] }[];
        const reported = results.flatMap(it => it.messages.filter(message => message.ruleId === "threads/helpers"));
        return [...new Set(reported.map(it => it.message))];
      };
      const [few, many, asked] = await Promise.all([
        helpers(2),
        helpers(200),
        helpers(200, { BUN_JSC_useConcurrentJIT: "1" }),
      ]);
      expect([few, many, asked]).toEqual([["1"], ["0"], ["1"]]);
    },
    timeout,
  );

  test(
    "files of 256 KB and more all go to one engine, with types and without, however many threads there are",
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
        // Not as JSON, which has the text of each file in it.
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

  // A VM takes seconds to start in a debug build: beside the first no other pays for files like these.
  test.skipIf(isDebug || isASAN)(
    "engines that grow over the memory that is for them are freed, and every file is linted",
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
        // Half of it is planned for the engines, and above three quarters one is freed.
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
    "a file in which nothing occurs that is listened to: no listener is called, and who asks for the tree has it",
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
    "a suggestion has the data that the rule gave, also if that is empty",
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
    "the settings that a rule sees are those of the configuration, with oxlint's too",
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
    "bun %s lint: plugins run, and neither they nor the configuration file make code from a string",
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

  // As nodejs/node makes a selector of them, and as rules tell `import "ws"` from `import "fs"`.
  test(
    "the modules that are built in are those of Node.js, for a configuration file and for a rule",
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

  // As `merge(...tseslint.configs.recommended, other)` of lodash does.
  test(
    "a plugin that the configuration file has put into what a package exports",
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

  // The other tests name a number of threads. A user does not.
  test(
    "a thread for each core, and more files than that",
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
    "no registry is asked for what a plugin imports or requires",
    async () => {
      const asked: string[] = [];
      using registry = Bun.serve({
        port: 0,
        fetch(request) {
          asked.push(new URL(request.url).pathname);
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
      expect(asked).toEqual([]);
    },
    timeout,
  );
});

describe.concurrent("context.report() in JavaScript plugins", () => {
  const oracle = join(import.meta.dir, "oracle", "jsplugins", "report");

  test(
    "messages, locations, merged fixes, suggestions and what bad input throws match ESLint",
    async () => {
      const { text } = require(join(oracle, "plugin.cjs"));
      const files = {
        "plugin.cjs": readFileSync(join(oracle, "plugin.cjs"), "utf8"),
        "eslint.config.cjs": `const demo = require("./plugin.cjs");
          module.exports = [{ plugins: { demo }, rules: Object.fromEntries(Object.keys(demo.rules).map(name => ["demo/" + name, "error"])) }];`,
        "a.js": text,
      };
      const { raw, exitCode } = await lint(files, ["-f", "json", "a.js"]);
      // Recorded with ESLint 10.12.0 by record.mjs in that directory.
      expect(JSON.parse(raw)[0].messages).toEqual(JSON.parse(readFileSync(join(oracle, "expected.json"), "utf8")));
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "a context, a `report` and a fixer kept from an earlier file work on the current file",
    async () => {
      const files = {
        "eslint.config.mjs": `
          const kept = [];
          const say = f => { try { return JSON.stringify(f()) ?? "undefined"; } catch (error) { return error.constructor.name; } };
          process.on("exit", () => {
            for (const it of kept) console.error("at exit:", say(() => it.report({ node: it.node, message: "late", fix: fixer => fixer.remove(it.node) })), say(() => it.fixer.remove(it.node)));
          });
          const rule = {
            meta: { fixable: "code" },
            create(context) {
              return {
                Program(node) {
                  for (const it of kept) {
                    it.context.report({ node: it.node, message: "the node of " + it.name });
                    it.report({ node: { ...it.node.body[0] }, message: "a copy from " + it.name, fix: fixer => [fixer.insertTextBefore(it.node.body[0], "("), fixer.insertTextAfter(it.node.body[0], ")")] });
                    context.report({ node, message: "the fixer of " + it.name + ": " + say(() => it.fixer.replaceText(it.node.body[0], "x")) });
                  }
                  let fixer;
                  context.report({ node, message: "first", fix: it => ((fixer = it), null) });
                  kept.push({ name: context.filename.slice(-4), context, report: context.report, fixer, node });
                  // Nobody is left to hear this, as in ESLint.
                  Promise.resolve().then(() => context.report({ loc: { line: 1, column: 1 }, message: "between files" }));
                },
              };
            },
          };
          export default [{ plugins: { demo: { rules: { keeps: rule } } }, rules: { "demo/keeps": "error" } }];`,
        // The larger file is linted first.
        "a.js": "first;\nfile;\nlonger;\n",
        "b.js": "b;",
      };
      const { raw, stderr, exitCode } = await lint(files, ["--threads", "1", "-f", "json", "a.js", "b.js"]);
      const said = JSON.parse(raw).map((result: any) =>
        result.messages.map((it: any) => [it.message, it.line, it.column, it.endLine, it.endColumn, it.fix]),
      );
      expect(said).toEqual([
        [["first", 1, 1, 4, 1, undefined]],
        [
          ["the node of a.js", 1, 1, 4, 1, undefined],
          // The text between the two insertions is that of b.js.
          ["a copy from a.js", 1, 1, 1, 7, { range: [0, 6], text: "(b;)" }],
          ['the fixer of a.js: {"range":[0,6],"text":"x"}', 1, 1, 1, 3, undefined],
          ["first", 1, 1, 1, 3, undefined],
        ],
      ]);
      expect(stderr.split("\n").filter(line => line.startsWith("at exit:"))).toEqual([
        'at exit: undefined {"range":[0,21],"text":""}',
        'at exit: undefined {"range":[0,2],"text":""}',
      ]);
      expect(exitCode).toBe(1);
    },
    timeout,
  );
});

// Recorded with ESLint 10.12.0 and @typescript-eslint/parser 8.71.1 by record.mjs in that directory.
test.concurrent(
  "the listeners of several rules are called in ESLint's order, for types, selectors, exits and code path events",
  async () => {
    const oracle = join(import.meta.dir, "oracle", "jsplugins", "calls");
    const expected: Record<string, string> = JSON.parse(
      Buffer.from(Bun.zstdDecompressSync(readFileSync(join(oracle, "expected.json.zst")))).toString(),
    );
    const config = `const log = require("./log.cjs");
      module.exports = [
        { files: ${JSON.stringify(Object.keys(callCases))}, plugins: { log }, rules: { "log/a": "error", "log/b": "error", "log/c": "error" } },
        ...["module", "script"].map(sourceType => ({
          files: [sourceType + ".js"],
          languageOptions: { sourceType, parserOptions: { ecmaFeatures: { jsx: true } } },
        })),
        { files: ["types.ts"], languageOptions: { parser: { meta: { name: "typescript-eslint/parser" } } } },
      ];`;
    const files = {
      "log.cjs": readFileSync(join(oracle, "log.cjs"), "utf8"),
      "eslint.config.cjs": config,
      ...callCases,
    };
    const { raw, exitCode } = await lint(files, ["-f", "json", ...Object.keys(callCases)]);
    const results: { filePath: string; messages: { message: string }[] }[] = JSON.parse(raw);
    for (const file of Object.keys(callCases)) {
      const result = results.find(it => it.filePath.replaceAll("\\", "/").endsWith(`/${file}`));
      expect({ file, calls: result?.messages.map(it => it.message.split("\n")) }).toEqual({
        file,
        calls: [expected[file].split("\n")],
      });
    }
    expect(exitCode).toBe(1);
  },
  timeout,
);

describe.concurrent("the nodes in JavaScript plugins", () => {
  const oracle = join(import.meta.dir, "oracle", "jsplugins", "trees");
  const dump = readFileSync(join(oracle, "dump.cjs"), "utf8");
  // Recorded with ESLint 10.12.0, @typescript-eslint/parser 8.71.1 and oxlint 1.87.0 by record.mjs in that directory.
  const expected: Record<"eslint" | "oxlint", Record<string, string>> = JSON.parse(
    Buffer.from(Bun.zstdDecompressSync(readFileSync(join(oracle, "expected.json.zst")))).toString(),
  );

  test(
    "they have the properties, the order, the attributes and the classes that espree and typescript-estree give them",
    async () => {
      const config = `const dump = require("./dump.cjs");
        module.exports = [
          { files: ${JSON.stringify(Object.keys(treeCases))}, plugins: { dump }, rules: { "dump/tree": "error" } },
          ...["module", "script"].map(sourceType => ({
            files: [sourceType + "*.js"],
            languageOptions: { sourceType, parserOptions: { ecmaFeatures: { jsx: true } } },
          })),
          { files: ["*.ts", "*.tsx"], languageOptions: { parser: { meta: { name: "typescript-eslint/parser" } } } },
        ];`;
      const { raw, exitCode } = await lint({ "dump.cjs": dump, "eslint.config.cjs": config, ...treeCases }, [
        "-f",
        "json",
        ...Object.keys(treeCases),
      ]);
      const results: { filePath: string; messages: { message: string }[] }[] = JSON.parse(raw);
      // One node to a line, so that a difference can be read.
      const lines = (tree: string | undefined) => tree?.split(/(?<=[[ ])(?=(?:Node )?\{ type: )/);
      for (const file of Object.keys(treeCases)) {
        const result = results.find(it => it.filePath.replaceAll("\\", "/").endsWith(`/${file}`));
        expect({ file, trees: result?.messages.map(it => lines(it.message)) }).toEqual({
          file,
          trees: [lines(expected.eslint[file])],
        });
      }
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "they are laid out as in oxlint with its configuration",
    async () => {
      const config = { ignorePatterns: ["dump.cjs"], jsPlugins: ["./dump.cjs"], rules: { "dump/shapes": "error" } };
      const files = Object.keys(expected.oxlint);
      const { raw, exitCode } = await lint({ "dump.cjs": dump, ".oxlintrc.json": oxlintrc(config), ...treeCases }, [
        "-f",
        "json",
        ...files,
      ]);
      const diagnostics: { filename: string; message: string }[] = JSON.parse(raw).diagnostics;
      for (const file of files) {
        const found = diagnostics.filter(it => it.filename.replaceAll("\\", "/") === file);
        expect({ file, shapes: found.map(it => it.message.split("\n")) }).toEqual({
          file,
          shapes: [expected.oxlint[file].split("\n")],
        });
      }
      expect(exitCode).toBe(1);
    },
    timeout,
  );
});

describe.concurrent("scopes in JavaScript plugins", () => {
  // Recorded with ESLint 10.12.0 and @typescript-eslint/parser 8.71.1 by record.mjs in that directory.
  test(
    "scopes, variables, definitions and references match eslint-scope and typescript-eslint's scope manager",
    async () => {
      const oracle = join(import.meta.dir, "oracle", "jsplugins", "scopes");
      const expected: Record<string, string> = JSON.parse(
        Buffer.from(Bun.zstdDecompressSync(readFileSync(join(oracle, "expected.json.zst")))).toString(),
      );
      const config = `const scopes = require("./dump.cjs");
        const globals = ${JSON.stringify(scopeGlobals)};
        module.exports = [
          { plugins: { scopes } },
          { files: ["scopes-first/**"], rules: { "scopes/all": "error" } },
          { files: ["references-first/**"], rules: { "scopes/references-first": "error" } },
          ...["module", "script", "commonjs"].map(sourceType => ({
            files: ["**/" + sourceType + "/*.js"],
            languageOptions: { sourceType, parserOptions: { ecmaFeatures: { jsx: true } }, globals },
          })),
          {
            files: ["**/*.ts", "**/*.tsx"],
            languageOptions: { parser: { meta: { name: "typescript-eslint/parser" } }, globals },
          },
        ];`;
      const files = {
        "dump.cjs": readFileSync(join(oracle, "dump.cjs"), "utf8"),
        "eslint.config.cjs": config,
        ...Object.fromEntries(scopeCases.map(it => [scopeFileOf(it), it.code])),
      };
      const { raw, exitCode } = await lint(files, ["-f", "json"]);
      const results: { filePath: string; messages: { message: string }[] }[] = JSON.parse(raw);
      for (const it of scopeCases) {
        const file = scopeFileOf(it);
        const result = results.find(result => result.filePath.replaceAll("\\", "/").endsWith(`/${file}`));
        expect({ file, lines: result?.messages.map(message => message.message.split("\n")) }).toEqual({
          file,
          lines: [expected[file].split("\n")],
        });
      }
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  // ESLint 8 counts them among the configured globals, and its `addDeclaredGlobals` treats them the same.
  test(
    "the global scope has the variables of /* eslint-env */ comments with an ESLint 8 configuration",
    async () => {
      const plugin = `const show = it =>
          it && [it.name, it.writeable, it.eslintImplicitGlobalSetting, it.eslintExplicitGlobal, it.references.length].join(" ");
        module.exports = { rules: { globals: { create: context => ({
          Program(node) {
            const scope = context.sourceCode.scopeManager.globalScope;
            const found = scope.references.map(it => String(show(it.resolved)));
            const asked = ["document", "process", "it"].map(name => scope.set.has(name) + " " + show(scope.set.get(name) ?? null));
            const through = scope.through.map(it => it.identifier.name).join(" ");
            context.report({ node, message: [...found, ...asked, through].join("; ") });
          },
        }) } } };`;
      const files = {
        ".eslintrc.json": JSON.stringify({ root: true, plugins: ["foo"], rules: { "foo/globals": "error" } }),
        "node_modules/eslint-plugin-foo/package.json": `{ "name": "eslint-plugin-foo", "main": "index.js" }`,
        "node_modules/eslint-plugin-foo/index.js": plugin,
        "a.js": "/* eslint-env browser, mocha */\n/* global it:writable */\nwindow; it; process; location = 1;\n",
      };
      const { raw, exitCode } = await lint(files, ["-f", "json", "a.js"]);
      expect(JSON.parse(raw)[0].messages.map((it: { message: string }) => it.message.split("; "))).toEqual([
        [
          "window false readonly false 1",
          "it true readonly true 1",
          "null",
          "location true writable false 1",
          "true document false readonly false 0",
          "false null",
          "true it true readonly true 1",
          "process",
        ],
      ]);
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  // The messages under ESLint 10.12.0.
  test(
    "a global variable has what ESLint sets on it when a rule gets to it through reference.resolved first",
    async () => {
      const config = `const show = it =>
          it &&
          [
            it.name,
            it.writeable,
            it.eslintImplicitGlobalSetting,
            it.eslintExplicitGlobal,
            it.eslintExplicitGlobalComments?.map(comment => comment.value),
            it.scope.type,
          ]
            .map(part => JSON.stringify(part) ?? "undefined")
            .join(" ");
        const rule = {
          create: context => ({
            Identifier(node) {
              const reference = context.sourceCode.getScope(node).references.find(it => it.identifier === node);
              if (reference) context.report({ node, message: String(show(reference.resolved)) });
            },
          }),
        };
        module.exports = [
          {
            plugins: { p: { rules: { rule } } },
            languageOptions: { globals: { foo: "readonly", bar: "writable" } },
            rules: { "p/rule": "error" },
          },
        ];`;
      const code = `/* global fromComment:writable */\nfoo(); bar = 1; JSON.parse(""); fromComment = 2; undeclared();\n`;
      const { raw, exitCode } = await lint({ "eslint.config.cjs": config, "a.js": code }, ["-f", "json", "a.js"]);
      const results: { messages: { message: string }[] }[] = JSON.parse(raw);
      expect(results[0].messages.map(it => it.message)).toEqual([
        `"foo" false "readonly" false undefined "global"`,
        `"bar" true "writable" false undefined "global"`,
        `"JSON" false "readonly" false undefined "global"`,
        `"fromComment" true undefined true [" global fromComment:writable "] "global"`,
        "null",
      ]);
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  // From then on JavaScriptCore stores every array of the realm in another way.
  // What is expected is what ESLint 10.12.0 with @typescript-eslint/parser 8.71.1 reports.
  test(
    "what the libraries of TypeScript define is in the global scope whichever way a rule looks at it first",
    async () => {
      const config = `
        const flagsOf = (object, key) => {
          const it = Object.getOwnPropertyDescriptor(object, key);
          return ["value" in it ? "value" : "accessor", it.writable, it.enumerable, it.configurable].join(" ");
        };
        const operations = {
          descriptor: it => [flagsOf(it, "variables"), Object.getOwnPropertyDescriptor(it, "variables").value.length, it.variables === it.variables],
          keys: it => Object.keys(it).join(),
          one: it => {
            const [array, record] = [it.set.get("Array"), it.set.get("Record")];
            return [it.variables.includes(array), record === it.set.get("Record"), it.variables.includes(record), it.set.size === it.variables.length];
          },
          names: it => ["NotThere", "Promise", "const", "__proto__", 1, "\\u00e9"].map(name => [it.set.has(name), it.set.get(name)?.name]),
          frozen: it => [Object.freeze(it).variables.length, flagsOf(it, "variables")],
          assigned: it => [(it.variables = [1]), flagsOf(it, "variables"), it.set.size],
          deleted: it => [delete it.variables, it.variables, "variables" in it, it.set.size],
          spread: it => [{ ...it }.variables === it.variables, it.variables.length],
          inherited: it => [Object.create(it).variables === it.variables, it.variables.length],
          order: it => [[...it.set.keys()].slice(0, 4), [...it.set.keys()].join() === it.variables.map(it => it.name).join(), it.variables.at(-1).name],
          iterated: it => {
            let count = 0;
            for (const [name, variable] of it.set) count += variable.name === name;
            it.set.forEach(() => count++);
            return [count, [...it.set.values()].length, [...it.set.entries()].length];
          },
          quiet: it => {
            const variable = it.set.get("WeakRef");
            const { defs, references, identifiers, isTypeVariable, isValueVariable, eslintImplicitGlobalSetting, writeable } = variable;
            const values = [defs, references, identifiers, isTypeVariable, isValueVariable, eslintImplicitGlobalSetting, writeable];
            return [Object.keys(variable).join(), variable.constructor.name, variable.scope === it, ...values];
          },
        };
        const rule = name => ({
          create: context => ({
            Program(node) {
              context.report({ node, message: name + " " + JSON.stringify(operations[name](context.sourceCode.scopeManager.globalScope)) });
            },
          }),
        });
        const names = Object.keys(operations);
        const own = { rules: Object.fromEntries(names.map(name => [name, rule(name)])) };
        const languageOptions = { parser: { meta: { name: "typescript-eslint/parser" } } };
        module.exports = names.map(name => ({ files: [name + ".ts"], plugins: { own }, rules: { ["own/" + name]: "error" }, languageOptions }));`;
      const names = "descriptor keys one names frozen assigned deleted spread inherited order iterated quiet".split(
        " ",
      );
      const code = "let a: Promise<Record<string, number>> = Array;\n";
      const { raw, exitCode } = await lint(
        { "eslint.config.cjs": config, ...Object.fromEntries(names.map(name => [`${name}.ts`, code])) },
        ["-f", "json", ...names.map(name => `${name}.ts`)],
      );
      const results: { messages: { message: string }[] }[] = JSON.parse(raw);
      expect(results.flatMap(it => it.messages.map(it => it.message)).sort()).toEqual([
        `assigned [[1],"value true true true",217]`,
        `deleted [true,null,false,217]`,
        `descriptor ["value true true true",217,true]`,
        `frozen [217,"value false true false"]`,
        `inherited [true,217]`,
        `iterated [434,217,217]`,
        `keys "$id,block,childScopes,functionExpressionScope,isStrict,leftToResolve,references,set,through,type,upper,variables,variableScope,implicit"`,
        `names [[false,null],[true,"Promise"],[true,"const"],[false,null],[false,null],[false,null]]`,
        `one [true,true,true,true]`,
        `order [["Intl","Map","WeakMap","SymbolConstructor"],true,"globalThis"]`,
        `quiet ["$id,defs,eslintUsed,identifiers,name,references,scope,writeable,eslintExplicitGlobal,eslintImplicitGlobalSetting,eslintExplicitGlobalComments,isTypeVariable,isValueVariable","ImplicitLibVariable",true,[],[],[],true,true,"readonly",false]`,
        `spread [true,217]`,
      ]);
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  // What is expected is what ESLint 10.12.0 with @typescript-eslint/parser 8.71.1 reports.
  test(
    "what a plugin writes to the global scope and its variables stays, and nothing of it is trusted",
    async () => {
      const config = `
        const summary = it => [it.variables.length, it.set.size, typeof it.set.get("Array"), it.set.has("mine"), it.set.has("Promise")];
        const put = value => it => {
          it.set.set("Array", value);
          it.set.set("mine", { name: "mine" });
          return summary(it);
        };
        const operations = {
          putNothing: it => (it.set.set("mine", { name: "mine" }), summary(it)),
          putNumber: put(1),
          putNull: it => [...put(null)(it), it.set.get("Array")],
          putString: put("x"),
          putObject: put({}),
          putUndefined: it => [...put(undefined)(it), it.set.has("Array")],
          putLookalike: it => put(Object.create(Object.getPrototypeOf(it.set.get("WeakRef"))))(it),
          putThenKeys: it => (it.set.set("Array", 1), it.set.set("mine", 2), [[...it.set.keys()].indexOf("Array") === it.variables.findIndex(it => it.name === "Array"), [...it.set.keys()].at(-1)]),
          deleted: it => [it.set.delete("Array"), it.set.delete("NotThere"), ...summary(it), it.variables.some(it => it.name === "Array")],
          deletedAndPutBack: it => { const array = it.set.get("Array"); it.set.delete("Array"); it.set.set("Array", array); return [...summary(it), [...it.set.keys()].at(-1)]; },
          cleared: it => (it.set.clear(), summary(it)),
          clearedAfter: it => { const before = it.variables.length; it.set.clear(); return [before, ...summary(it)]; },
          frozenSet: it => (Object.freeze(it.set), summary(it)),
          ownGet: it => { it.set.get = () => 1; return summary(it); },
          ownSet: it => { it.set.set = () => 1; it.set.set("mine", 2); return summary(it); },
          calledOnMap: it => { Map.prototype.set.call(it.set, "Array", 1); Map.prototype.set.call(it.set, "mine", 2); return summary(it); },
          noLength: it => { it.variables.length = 0; return summary(it); },
          noLengthAfter: it => { const before = it.set.size; it.variables.length = 0; return [before, ...summary(it)]; },
          assignedThenSet: it => { it.variables = []; return summary(it); },
          pushed: it => { it.variables.push(1); return summary(it); },
          changedVariable: it => { const array = it.set.get("Array"); delete array.name; array.extra = 1; Object.setPrototypeOf(array, null); return [...summary(it), it.set.get("Array") === array, it.variables.includes(array)]; },
          changedQuiet: it => { const quiet = it.set.get("WeakRef"); delete quiet.name; Object.setPrototypeOf(quiet, Object.prototype); return [...summary(it), it.set.get("WeakRef") === quiet, it.variables.includes(quiet)]; },
          changedOther: it => { const other = it.set.get("globalThis"); delete other.name; Object.setPrototypeOf(other, Object.getPrototypeOf(it.set.get("WeakRef"))); return [...summary(it), it.set.get("globalThis") === other, it.variables.at(-1) === other]; },
          oddNames: it => [1, null, undefined, {}, Symbol.iterator, "", "é", "a".repeat(300)].map(name => [it.set.get(name) === undefined, it.set.has(name)]),
          copied: it => [new Map(it.set).size, [...it.set].length, Array.from(it.set.values()).length],
        };
        const rule = name => ({
          create: context => ({
            Program(node) {
              context.report({ node, message: name + " " + JSON.stringify(operations[name](context.sourceCode.scopeManager.globalScope)) });
            },
          }),
        });
        const names = Object.keys(operations);
        const own = { rules: Object.fromEntries(names.map(name => [name, rule(name)])) };
        const languageOptions = { parser: { meta: { name: "typescript-eslint/parser" } } };
        module.exports = names.map(name => ({ files: [name + ".ts"], plugins: { own }, rules: { ["own/" + name]: "error" }, languageOptions }));`;
      const expected = [
        `assignedThenSet [0,217,"object",false,true]`,
        `calledOnMap [217,218,"number",true,true]`,
        `changedOther [217,217,"object",false,true,true,true]`,
        `changedQuiet [217,217,"object",false,true,true,true]`,
        `changedVariable [217,217,"object",false,true,true,true]`,
        `cleared [217,0,"undefined",false,false]`,
        `clearedAfter [217,217,0,"undefined",false,false]`,
        `copied [217,217,217]`,
        `deleted [true,false,217,216,"undefined",false,true,true]`,
        `deletedAndPutBack [217,217,"object",false,true,"Array"]`,
        `frozenSet [217,217,"object",false,true]`,
        `noLength [0,217,"object",false,true]`,
        `noLengthAfter [217,0,217,"object",false,true]`,
        `oddNames [[true,false],[true,false],[true,false],[true,false],[true,false],[true,false],[true,false],[true,false]]`,
        `ownGet [217,217,"number",false,true]`,
        `ownSet [217,217,"object",false,true]`,
        `pushed [218,217,"object",false,true]`,
        `putLookalike [217,218,"object",true,true]`,
        `putNothing [217,218,"object",true,true]`,
        `putNull [217,218,"object",true,true,null]`,
        `putNumber [217,218,"number",true,true]`,
        `putObject [217,218,"object",true,true]`,
        `putString [217,218,"string",true,true]`,
        `putThenKeys [true,"mine"]`,
        `putUndefined [217,218,"undefined",true,true,true]`,
      ];
      const names = expected.map(it => it.slice(0, it.indexOf(" ")));
      const code = "let a: Promise<Record<string, number>> = Array;\n";
      const { raw, exitCode } = await lint(
        { "eslint.config.cjs": config, ...Object.fromEntries(names.map(name => [`${name}.ts`, code])) },
        ["-f", "json", ...names.map(name => `${name}.ts`)],
      );
      const results: { messages: { message: string }[] }[] = JSON.parse(raw);
      expect(results.flatMap(it => it.messages.map(it => it.message)).sort()).toEqual(expected);
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  // The ids are what oxlint 1.87.0 gives the rule, in a run for each row: it has no two plugins of one name in a run.
  test(
    "the name of a plugin, and of the plugin in the name of a rule, without eslint-plugin and oxlint-plugin as oxlint takes them off",
    async () => {
      // `meta.name`, the plugin in the key of the rule, `context.id`.
      const cases = [
        ["eslint-plugin-foo", "eslint-plugin-foo", "foo/r"],
        ["eslint-plugin-foo", "foo", "foo/r"],
        ["oxlint-plugin-foo", "oxlint-plugin-foo", "foo/r"],
        ["oxlint-plugin-foo", "foo", "foo/r"],
        ["@scope/eslint-plugin", "@scope/eslint-plugin", "@scope/r"],
        ["@scope/eslint-plugin", "@scope", "@scope/r"],
        ["@scope/oxlint-plugin", "@scope/oxlint-plugin", "@scope/r"],
        ["@scope/oxlint-plugin", "@scope", "@scope/r"],
        ["@scope/eslint-plugin-foo", "@scope/eslint-plugin-foo", "@scope/foo/r"],
        ["@scope/eslint-plugin-foo", "@scope/foo", "@scope/foo/r"],
        ["@scope/oxlint-plugin-bar", "@scope/oxlint-plugin-bar", "@scope/bar/r"],
        ["@scope/oxlint-plugin-bar", "@scope/bar", "@scope/bar/r"],
        ["eslint-plugin", "eslint-plugin", "eslint-plugin/r"],
        ["oxlint-plugin", "oxlint-plugin", "oxlint-plugin/r"],
        ["@a/b", "@a/b", "@a/b/r"],
        ["eslint-plugin-eslint-plugin-x", "eslint-plugin-eslint-plugin-x", "eslint-plugin-x/r"],
        ["@s/eslint-plugin-", "@s/eslint-plugin-", "@s//r"],
        ["@s/eslint-plugin-", "@s/", "@s//r"],
        ["plain", "plain", "plain/r"],
        ["@scope/x/eslint-plugin-y", "@scope/x/eslint-plugin-y", "@scope/x/eslint-plugin-y/r"],
        ["Eslint-Plugin-Z", "Eslint-Plugin-Z", "Eslint-Plugin-Z/r"],
        ["eslint-plugin-react-hooks2", "eslint-plugin-react-hooks2", "react-hooks2/r"],
        ["eslint-plugin-react-hooks2", "react-hooks2", "react-hooks2/r"],
        ["@s/eslint-plugin/z", "@s/eslint-plugin/z", "@s/eslint-plugin/z/r"],
      ];
      const plugin = (name: string) =>
        `module.exports = { meta: { name: ${JSON.stringify(name)} }, rules: { r: { create: context => ({ Program(node) { context.report({ node, message: context.id }); } }) } } };`;
      const project = (directory: string, name: string, key: string) => ({
        [`${directory}p.cjs`]: plugin(name),
        [`${directory}.oxlintrc.json`]: oxlintrc({
          jsPlugins: ["./p.cjs"],
          ignorePatterns: ["p.cjs"],
          rules: { [`${key}/r`]: "error" },
        }),
        [`${directory}a.js`]: "a;\n",
      });
      const directory = (i: number) => `d${String(i).padStart(2, "0")}/`;
      const [accepted, ...refused] = await Promise.all([
        lint(Object.assign({}, ...cases.map(([name, key], i) => project(directory(i), name, key))), [
          "-f",
          "json",
          ".",
        ]),
        // oxlint: "Plugin 'foo' not found", "Plugin '@scope/x/y' not found".
        lint(project("", "foo/bar", "foo/bar"), ["a.js"]),
        lint(project("", "@scope/x/eslint-plugin-y", "@scope/x/y"), ["a.js"]),
      ]);
      const results: { filePath: string; messages: { message: string; ruleId: string }[] }[] = JSON.parse(accepted.raw);
      const found = results.flatMap(it => it.messages.map(({ message, ruleId }) => [message, ruleId]));
      expect(found).toEqual(cases.map(([, , id]) => [id, id]));
      expect(refused.map(it => [it.stderr.split("\n")[0], it.exitCode])).toEqual([
        ["error: 1 rule in .oxlintrc.json is not supported: foo/bar/r", 2],
        ["error: 1 rule in .oxlintrc.json is not supported: @scope/x/y/r", 2],
      ]);
    },
    timeout,
  );

  // ESLint 10.12.0 reports the same for `both`, and refuses `once`: "Rule must be an object with a `create` method".
  test(
    "with a configuration of ESLint a rule with create is created for each file, and the context of createOnce is that of the file being linted",
    async () => {
      const files = {
        "plugin.mjs": `const name = path => path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\\\")) + 1);
const say = (context, how) =>
  [how, context.id, name(context.filename), name(context.physicalFilename), JSON.stringify(context.options), context.settings.which, context.languageOptions.sourceType, context.sourceCode.text.trim()].join(" ");
let calls = 0;
export default {
  meta: { name: "p" },
  rules: {
    once: {
      meta: { schema: false },
      createOnce(context) {
        const call = ++calls;
        let seenBefore, program;
        return {
          before() { seenBefore = name(context.filename); },
          Program(node) { program = node; context.report({ node, message: say(context, \`createOnce#\${call} before:\${seenBefore}\`) }); },
          after() { context.report({ node: program, message: \`after \${name(context.filename)}\` }); },
        };
      },
    },
    both: {
      meta: { schema: false },
      create: context => ({ Program(node) { context.report({ node, message: say(context, "create") }); } }),
      createOnce: context => ({ Program(node) { context.report({ node, message: say(context, "createOnce") }); } }),
    },
  },
};
`,
        "eslint.config.mjs": `
          import p from "./plugin.mjs";
          export default [
            { plugins: { p }, rules: { "p/once": ["error", "all"], "p/both": ["error", "all"] }, settings: { which: "all" } },
            {
              files: ["b.js"],
              rules: { "p/once": ["error", "b"], "p/both": ["error", "b"] },
              settings: { which: "b" },
              languageOptions: { sourceType: "script" },
            },
          ];`,
        "a.js": "a;\n",
        "b.js": "b;\n",
        "c.js": "c;\n",
      };
      const expected = [
        `a.js p/once | createOnce#1 before:a.js p/once a.js a.js ["all"] all module a;`,
        `a.js p/both | create p/both a.js a.js ["all"] all module a;`,
        `a.js p/once | after a.js`,
        `b.js p/once | createOnce#2 before:b.js p/once b.js b.js ["b"] b script b;`,
        `b.js p/both | create p/both b.js b.js ["b"] b script b;`,
        `b.js p/once | after b.js`,
        `c.js p/once | createOnce#1 before:c.js p/once c.js c.js ["all"] all module c;`,
        `c.js p/both | create p/both c.js c.js ["all"] all module c;`,
        `c.js p/once | after c.js`,
      ];
      // In one realm, where the third file comes after two others, and in several.
      const runs = await Promise.all(
        ["1", "3"].map(threads => lint(files, ["--threads", threads, "-f", "json", "a.js", "b.js", "c.js"])),
      );
      for (const { raw, exitCode } of runs) {
        const results: { filePath: string; messages: { ruleId: string; message: string }[] }[] = JSON.parse(raw);
        const found = results.flatMap(({ filePath, messages }) =>
          messages.map(
            it => `${filePath.slice(-4)} ${it.ruleId} | ${it.message.replace(/createOnce#\d/, "createOnce#N")}`,
          ),
        );
        expect(found).toEqual(expected.map(it => it.replace(/createOnce#\d/, "createOnce#N")));
        expect(exitCode).toBe(1);
      }
    },
    timeout,
  );

  // As under ESLint 10.12.0.
  test(
    "a range with a hole is read like any other object",
    async () => {
      const config = `
        const rule = {
          create: context => ({
            Program(node) {
              const first = [4, 7], second = [4, 7], both = [4, 7];
              delete first[0];
              delete second[1];
              delete both[0];
              delete both[1];
              const texts = [first, second, both, [4, 7]].map(range => context.sourceCode.getText({ range }));
              context.report({ node, message: JSON.stringify(texts) });
            },
          }),
        };
        module.exports = [{ plugins: { own: { rules: { rule } } }, rules: { "own/rule": "error" } }];`;
      const { raw, exitCode } = await lint({ "eslint.config.cjs": config, "a.js": "var abc = 1;\n" }, [
        "-f",
        "json",
        "a.js",
      ]);
      const results: { messages: { message: string }[] }[] = JSON.parse(raw);
      expect(results.flatMap(it => it.messages.map(it => it.message))).toEqual([`["var abc","","","abc"]`]);
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "whatever a plugin throws, and wherever, the run ends with an error that can be read",
    async () => {
      const config = `
        const thrown = {
          plain: () => new Error("real error"),
          noLoc: node => ((node.loc = null), new Error("real error")),
          locThrows: node => (Object.defineProperty(node, "loc", { get() { throw new Error("from loc"); } }), new Error("real error")),
          bare: () => Object.create(null),
          bareMessage: () => Object.assign(new Error("x"), { message: Object.create(null) }),
          getter: () => ({ get message() { throw 2; } }),
          getters: () => ({ get message() { throw { get message() { throw 3; } }; } }),
          symbol: () => Symbol("s"),
          nothing: () => undefined,
          proxy: () => new Proxy({}, { get() { throw new Error("from a proxy"); } }),
          revoked: () => { const { proxy, revoke } = Proxy.revocable({}, {}); revoke(); return proxy; },
          toString: () => ({ toString() { throw new Error("from toString"); } }),
        };
        const { WHERE: where, WHAT: what } = process.env;
        const fail = node => { throw thrown[what](node); };
        const rule = {
          meta: { fixable: "code", schema: [] },
          create(context) {
            if (where === "create") fail({});
            return {
              Program(node) {
                if (where === "listener") fail(node);
                if (where === "fix") context.report({ node, message: "m", fix() { fail(node); } });
                if (where === "filter") context.sourceCode.getFirstToken(node, { filter() { fail(node); } });
                if (where === "data") context.report({ node, message: "{{a}}", data: { get a() { fail(node); } } });
              },
              onCodePathStart(path, node) { if (where === "path") fail(node); },
            };
          },
        };
        const processor = { preprocess: text => [{ text, filename: "0.js" }], postprocess() { fail({}); } };
        module.exports = [
          { files: ["**/*.js"], plugins: { own: { rules: { rule } } }, rules: { "own/rule": "error" } },
          { files: ["**/*.md"], processor },
        ];`;
      const cases = [
        ["listener", "plain", "real error"],
        ["listener", "noLoc", "real error"],
        ["listener", "locThrows", "real error"],
        ["listener", "bare", "No default value"],
        ["listener", "bareMessage", "No default value"],
        ["listener", "getter", "2"],
        ["listener", "getters", "An exception was thrown."],
        ["listener", "symbol", "Symbol(s)"],
        ["listener", "nothing", "undefined"],
        ["listener", "proxy", "from a proxy"],
        ["listener", "revoked", "Proxy has already been revoked. No more operations are allowed to be performed on it"],
        ["listener", "toString", "from toString"],
        // As in ESLint 10.12, which puts the rule into `message`.
        ["create", "bare", "Error while loading rule 'own/rule': undefined"],
        ["path", "noLoc", "real error"],
        ["fix", "getter", "2"],
        ["filter", "bare", "No default value"],
        ["data", "getters", "An exception was thrown."],
        ["postprocess", "bare", "No default value"],
      ];
      const results = await Promise.all(
        cases.map(async ([WHERE, WHAT]) => {
          const name = WHERE === "postprocess" ? "a.md" : "a.js";
          const { stderr, exitCode } = await lint({ "eslint.config.cjs": config, [name]: "a;\n" }, [name], [], {
            WHERE,
            WHAT,
          });
          return [WHERE, WHAT, stderr.split("\n")[0], exitCode];
        }),
      );
      expect(results).toEqual(cases.map(([where, what, message]) => [where, what, `error: ${message}`, 2]));
    },
    timeout,
  );

  test(
    "a plugin gets at nothing of the host through caller or through what it has put on Array.prototype",
    async () => {
      const config = `
        const seen = [];
        const original = Array.prototype[Symbol.iterator];
        Array.prototype[Symbol.iterator] = function () {
          for (let i = -1; i < 2; i++) {
            const it = i < 0 ? this : this[i];
            if (Array.isArray(it) && it[0]?.type === "Program") seen.push(it);
          }
          return original.call(this);
        };
        let said = false;
        const rule = {
          create: context => ({
            // Not strict, so that it has a \`caller\`.
            Identifier: new Function("report", "return function listener(node) { var names = []; for (var it = listener.caller; it; it = it.caller) names.push(it.name); report(node, names); };")(
              (node, names) => { if (!said) context.report({ node, message: "callers: " + names }); said = true; },
            ),
            "Program:exit"(node) {
              for (let i = 0; i < seen.length; i++) { delete seen[i][3]; seen[i].length = 2; seen[i][5e7] = 1; }
              const { sourceCode } = context;
              const found = [0, 5, 12, 30].map(index => sourceCode.getNodeByRangeIndex(index).type);
              const inner = node.body[1].body.body[0];
              context.report({ node, message: [seen.length, found, sourceCode.scopeManager.scopes.length, sourceCode.getAncestors(inner).length, sourceCode.getScope(inner).type].join(" | ") });
            },
          }),
        };
        module.exports = [{ languageOptions: { sourceType: "script" }, plugins: { own: { rules: { rule } } }, rules: { "own/rule": "error" } }];`;
      const { raw, exitCode } = await lint(
        { "eslint.config.cjs": config, "a.js": "var a = 1; function f(b) { return a + b; }\nf(a);\n" },
        ["-f", "json", "a.js"],
      );
      const results: { messages: { message: string }[] }[] = JSON.parse(raw);
      expect(results.flatMap(it => it.messages.map(it => it.message))).toEqual([
        "0 | VariableDeclaration,VariableDeclarator,FunctionDeclaration,ReturnStatement | 2 | 3 | function",
        "callers: ",
      ]);
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "nodes, scopes and code paths are right after a plugin has put an accessor with an index for a name on Array.prototype",
    async () => {
      const plugin = `Object.defineProperty(Array.prototype, "4294967290", { get() {}, set() {}, configurable: true });
        const rule = {
          create(context) {
            let segments = 0;
            return {
              onCodePathSegmentStart() {
                segments++;
              },
              "Program:exit"(node) {
                const { scopes } = context.sourceCode.scopeManager;
                const names = scopes.flatMap(scope => scope.variables.filter(it => it.defs.length > 0).map(it => it.name));
                const resolved = scopes.flatMap(scope => scope.references.map(it => it.resolved?.name ?? null));
                const message = JSON.stringify({ statements: node.body.map(it => it.type), segments, names, resolved });
                context.report({ node, message });
              },
            };
          },
        };
        export default { meta: { name: "p" }, rules: { rule } };`;
      const code = Array.from({ length: 12 }, (_, i) => `let v${i} = ${i === 0 ? "other" : `v${i - 1}`};`).join("\n");
      const config = { jsPlugins: ["./plugin.mjs"], rules: { "p/rule": "error" } };
      const files = { "plugin.mjs": plugin, ".oxlintrc.json": oxlintrc(config), "a.js": `${code}\nif (v11) v0;\n` };
      const { raw, exitCode } = await lint(files, ["-f", "json"]);
      const names = Array.from({ length: 12 }, (_, i) => `v${i}`);
      expect(JSON.parse(raw).diagnostics.map((it: { message: string }) => JSON.parse(it.message))).toEqual([
        {
          statements: [...names.map(() => "VariableDeclaration"), "IfStatement"],
          segments: 3,
          names,
          resolved: ["v0", null, ...names.slice(1).flatMap((name, i) => [name, `v${i}`]), "v11", "v0"],
        },
      ]);
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "with an oxlint config the scopes follow the kind of file: strict scopes of TypeScript, and arguments in CommonJS",
    async () => {
      const plugin = `export default { meta: { name: "p" }, rules: { rule: { create: context => ({
        Program(node) {
          const said = context.sourceCode.scopeManager.scopes.map(scope => {
            const own = scope.variables.filter(it => it.defs.length > 0 || it.name === "arguments");
            const names = own.map(it => it.name + ":" + it.defs.length + ":" + it.references.length);
            return scope.type + (scope.isStrict ? "!" : "") + "[" + names + "]";
          });
          context.report({ node, message: said.join(" ") });
        },
      }) } } };`;
      const types = [
        "interface I<T> { m(x: T): void }",
        "type C<T> = T extends infer U ? U : never;",
        "type M<T> = { [K in keyof T]: T[K] };",
        "enum E { A }",
        "namespace N { function f() {} }",
        "function g() {}",
        "",
      ].join("\n");
      const declared = "I:1:0,C:1:0,M:1:0,E:1:0,N:1:0,g:1:0";
      const inner =
        "type![T:1:1] functionType![x:1:0] type![T:1:1] conditionalType![U:1:1] type![T:1:2] mappedType![K:1:1] tsEnum![A:1:0] tsModule![f:1:0] function![arguments:0:0]";
      // What oxlint 1.87 says.
      const expected = {
        "types.ts": `global[${declared}] ${inner} function[arguments:0:0]`,
        "types.cts": `global[] function[arguments:0:0,${declared}] ${inner} function[arguments:0:0]`,
        "types.mts": `global[] module![${declared}] ${inner} function![arguments:0:0]`,
        "declared.cjs": "global[] function[arguments:1:1]",
        "declared.js": "global[arguments:1:1]",
        "implicit.cjs": "global[] function[arguments:0:1,first:1:0]",
      };
      const files = {
        "plugin.mjs": plugin,
        ".oxlintrc.json": oxlintrc({ jsPlugins: ["./plugin.mjs"], rules: { "p/rule": "error" } }),
        "types.ts": types,
        "types.cts": types,
        "types.mts": types,
        "declared.cjs": "var arguments;\narguments;\n",
        "declared.js": "var arguments;\narguments;\n",
        "implicit.cjs": "var first;\narguments;\n",
      };
      const { raw, exitCode } = await lint(files, ["-f", "json"]);
      const said = JSON.parse(raw).diagnostics.map((it: { filename: string; message: string }) => [
        it.filename,
        it.message,
      ]);
      expect(Object.fromEntries(said)).toEqual(expected);
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  // What oxlint 1.87 says. Its own no-unused-vars doesn't see the mark.
  test(
    "with an oxlint config markVariableAsUsed marks the variable it names in every kind of file",
    async () => {
      const plugin = `export default { meta: { name: "p" }, rules: { rule: { create: context => ({
        Program(node) {
          const returned = context.sourceCode.markVariableAsUsed("first", node);
          const declared = context.sourceCode.scopeManager.scopes.flatMap(it => it.variables).filter(it => it.defs.length);
          context.report({ node, message: returned + " " + declared.map(it => it.name + "=" + it.eslintUsed).join(" ") });
        },
      }) } } };`;
      const code = "var first = 1;\nvar second = 2;\n";
      const files = {
        "plugin.mjs": plugin,
        ".oxlintrc.json": oxlintrc({
          jsPlugins: ["./plugin.mjs"],
          rules: { "p/rule": "error", "no-unused-vars": "error" },
        }),
        "a.cjs": code,
        "b.js": code,
        "c.mjs": code,
      };
      const { raw, exitCode } = await lint(files, ["-f", "json"]);
      const said = JSON.parse(raw).diagnostics.map(
        (it: { filename: string; message: string }) =>
          `${it.filename} ${it.message.match(/'(\w+)'/)?.[1] ?? it.message}`,
      );
      expect(said.sort()).toEqual(
        ["a.cjs", "b.js", "c.mjs"].flatMap(file => [
          `${file} first`,
          `${file} second`,
          `${file} true first=true second=false`,
        ]),
      );
      expect(exitCode).toBe(1);
    },
    timeout,
  );
});

describe.concurrent("what a JavaScript plugin sees with an oxlint config", () => {
  const oracle = join(import.meta.dir, "oracle", "jsplugins", "oxlint");
  const dump = readFileSync(join(oracle, "dump.cjs"), "utf8");
  // By the name of a file. Recorded with oxlint 1.87.0 by record.mjs in that directory.
  const expected: Record<string, string> = JSON.parse(
    Buffer.from(Bun.zstdDecompressSync(readFileSync(join(oracle, "expected.json.zst")))).toString(),
  );
  type Diagnostic = { filename: string; message: string };
  const slashes = (path: string) => path.replaceAll("\\", "/");

  test(
    "trees with their values, the traversal, scopes, and what sourceCode says about each node are oxlint's in every kind of file",
    async () => {
      const config = { ignorePatterns: ["dump.cjs"], jsPlugins: ["./dump.cjs"], rules: { "dump/all": "error" } };
      const files = { "dump.cjs": dump, ".oxlintrc.json": oxlintrc(config), ...oxlintCases };
      const { raw, exitCode } = await lint(files, ["-f", "json"]);
      const diagnostics: Diagnostic[] = JSON.parse(raw).diagnostics;
      const parsed = (message: string) => (message.startsWith("{") ? JSON.parse(message) : message);
      for (const file of Object.keys(expected)) {
        const found = diagnostics.filter(it => slashes(it.filename) === file);
        expect({ file, said: found.map(it => parsed(it.message)) }).toEqual({ file, said: [parsed(expected[file])] });
      }
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  // In a JavaScript file nothing can fill in the fields of TypeScript, so they aren't made for each node, and an empty list is only made
  // when it's read. A plugin must not be able to tell. All of this is what the same plugin says under oxlint 1.87.
  describe("the fields of TypeScript in a JavaScript file", () => {
    const plugin = String.raw`const describe = (object, key) => { const it = Object.getOwnPropertyDescriptor(object, key); return it && JSON.stringify(it); };
const rule = { create: context => { const ids = []; return { Identifier(node) { ids.push(node); }, "Program:exit"(program) {
  const next = () => ids.pop();
  const said = {};
  let a = next(), b = next();
  said.keys = Object.keys(a).join();
  said.forIn = (() => { const keys = []; for (const key in a) keys.push(key); return keys.join(); })();
  said.has = [Object.hasOwn(a, "decorators"), "decorators" in a, a.propertyIsEnumerable("decorators")].join();
  said.descriptor = describe(a, "decorators");
  said.identity = [a.decorators === a.decorators, a.decorators === b.decorators, Array.isArray(a.decorators), Object.isFrozen(a.decorators), Object.getPrototypeOf(a.decorators) === Array.prototype].join();
  a.decorators.push(1); said.pushed = a.decorators.length + "/" + b.decorators.length;
  a = next(); said.json = JSON.stringify(a, (key, value) => (key === "parent" ? undefined : value));
  a = next(); said.spread = ({ ...a }).decorators === a.decorators;
  a = next(); said.assign = Object.assign({}, a).decorators === a.decorators;
  a = next(); said.entries = JSON.stringify(Object.entries(a).find(it => it[0] === "decorators"));
  a = next(); said.values = Object.values(a).filter(Array.isArray).map(it => it.length).join();
  a = next(); a.decorators = 5; said.written = [a.decorators, describe(a, "decorators"), Object.keys(a).join() === said.keys].join(" ");
  a = next(); said.deleted = [delete a.decorators, "decorators" in a, Object.keys(a).length].join();
  a = next(); Object.freeze(a); said.frozen = [Object.isFrozen(a), describe(a, "decorators"), a.decorators === a.decorators, Object.isFrozen(a.decorators), Object.isFrozen(a)].join(" ");
  a = next(); Object.seal(a); said.sealed = [describe(a, "decorators"), a.decorators === a.decorators, Object.isSealed(a)].join(" ");
  a = next(); Object.preventExtensions(a); said.closed = [a.decorators === a.decorators, Object.isExtensible(a), describe(a, "decorators")].join(" ");
  a = next(); Object.defineProperty(a, "decorators", { enumerable: false }); said.hidden = [describe(a, "decorators"), Object.keys(a).includes("decorators"), a.decorators === a.decorators].join(" ");
  a = next(); Object.defineProperty(a, "decorators", { writable: false }); said.readOnly = [describe(a, "decorators"), a.decorators === a.decorators].join(" ");
  a = next(); Object.defineProperty(a, "decorators", { get: () => 7, configurable: true }); said.getter = a.decorators;
  a = next(); said.inherited = Object.create(a).decorators === a.decorators;
  a = next(); said.reflect = [Reflect.get(a, "decorators", {}) === a.decorators, Reflect.has(a, "decorators"), Reflect.ownKeys(a).join() === said.keys].join();
  a = next(); said.reflectSet = [Reflect.set(a, "decorators", 1), a.decorators].join();
  a = next(); { const other = {}; said.setOnOther = [Reflect.set(a, "decorators", 1, other), other.decorators, Array.isArray(a.decorators)].join(); }
  a = next(); { const child = Object.create(a); child.decorators = 3; said.setOnChild = [child.decorators, Object.hasOwn(child, "decorators"), Array.isArray(a.decorators)].join(); }
  a = next(); said.descriptors = JSON.stringify(Object.getOwnPropertyDescriptors(a).decorators);
  a = next(); said.destructured = (({ decorators, ...rest }) => [decorators === a.decorators, "decorators" in rest].join())(a);
  a = next(); said.clone = JSON.stringify(structuredClone({ ...a, parent: null }).decorators);
  a = next(); a.extra = 1; said.added = [Object.keys(a).at(-1), a.decorators.length, a.decorators === a.decorators].join();
  said.others = [...new Set(ids.map(it => it.decorators))].length === ids.length;
  context.report({ node: program, message: JSON.stringify(said) });
} }; } };
const kinds = { create: context => { const said = []; return {
  "ObjectPattern, ArrayPattern, AssignmentPattern, RestElement"(node) { said.push(node.type + " " + describe(node, "decorators") + " " + (node.decorators === node.decorators) + " " + Object.keys(node)); },
  "ImportSpecifier, ExportSpecifier, ExportNamedDeclaration, ExportDefaultDeclaration, ExportAllDeclaration, CallExpression, NewExpression, TaggedTemplateExpression, VariableDeclaration, VariableDeclarator, ArrowFunctionExpression, FunctionExpression, FunctionDeclaration, Property, JSXOpeningElement"(node) { said.push(node.type + " " + JSON.stringify(node, (key, value) => (key === "" || value === null || typeof value !== "object" ? value : Array.isArray(value) ? value.length : "{}"))); },
  "Program:exit"(node) { context.report({ node, message: said.join("\n") }); } }; } };
export default { meta: { name: "lazy" }, rules: { rule, kinds } };
`;
    const config = oxlintrc({
      jsPlugins: ["./plugin.mjs"],
      overrides: [
        { files: ["ids.js"], rules: { "lazy/rule": "error" } },
        { files: ["kinds.jsx"], rules: { "lazy/kinds": "error" } },
      ],
    });
    const said = async (file: string, text: string) => {
      const files = { "plugin.mjs": plugin, ".oxlintrc.json": config, [file]: text };
      const { raw, exitCode } = await lint(files, ["-f", "json", file]);
      const diagnostics: Diagnostic[] = JSON.parse(raw).diagnostics;
      expect(exitCode).toBe(1);
      return diagnostics.map(it => it.message);
    };

    test(
      "`decorators` of an Identifier is a plain property with an array of its own, whatever is done to it first",
      async () => {
        const text = Array.from({ length: 40 }, (_, i) => `i${i}`).join("; ") + ";\n";
        const [message, ...more] = await said("ids.js", text);
        expect(JSON.parse(message)).toEqual({
          "keys": "type,decorators,name,optional,typeAnnotation,start,end,range,parent",
          "forIn": "type,decorators,name,optional,typeAnnotation,start,end,range,parent,loc",
          "has": "true,true,true",
          "descriptor": '{"value":[],"writable":true,"enumerable":true,"configurable":true}',
          "identity": "true,false,true,false,true",
          "pushed": "1/0",
          "json":
            '{"type":"Identifier","decorators":[],"name":"i37","optional":false,"typeAnnotation":null,"start":175,"end":178,"range":[175,178]}',
          "spread": true,
          "assign": true,
          "entries": '["decorators",[]]',
          "values": "0,2",
          "written": '5 {"value":5,"writable":true,"enumerable":true,"configurable":true} true',
          "deleted": "true,false,8",
          "frozen": 'true {"value":[],"writable":false,"enumerable":true,"configurable":false} true false true',
          "sealed": '{"value":[],"writable":true,"enumerable":true,"configurable":false} true true',
          "closed": 'true false {"value":[],"writable":true,"enumerable":true,"configurable":true}',
          "hidden": '{"value":[],"writable":true,"enumerable":false,"configurable":true} false true',
          "readOnly": '{"value":[],"writable":false,"enumerable":true,"configurable":true} true',
          "getter": 7,
          "inherited": true,
          "reflect": "true,true,true",
          "reflectSet": "true,1",
          "setOnOther": "true,1,true",
          "setOnChild": "3,true,true",
          "descriptors": '{"value":[],"writable":true,"enumerable":true,"configurable":true}',
          "destructured": "true,false",
          "clone": "[]",
          "added": "extra,0,true",
          "others": true,
        });
        expect(more).toEqual([]);
      },
      timeout,
    );

    test(
      "every type that has them has oxlint's values in oxlint's order",
      async () => {
        const text =
          'import { a as b } from "a";\nexport { b as c };\nexport * from "d";\nexport default b;\nexport const e = ({ f }, [g], h = 1, ...i) => j(f)`k`;\nnew L();\nvar m;\nfunction n() {}\n(function () {});\n({ o: 1, p() {} });\n<Q r />;\n';
        const [message, ...more] = await said("kinds.jsx", text);
        expect(message.split("\n")).toEqual([
          'ImportSpecifier {"type":"ImportSpecifier","imported":"{}","local":"{}","importKind":"value","start":9,"end":15,"range":2,"parent":"{}"}',
          'ExportNamedDeclaration {"type":"ExportNamedDeclaration","declaration":null,"specifiers":1,"source":null,"exportKind":"value","attributes":0,"start":28,"end":46,"range":2,"parent":"{}"}',
          'ExportSpecifier {"type":"ExportSpecifier","local":"{}","exported":"{}","exportKind":"value","start":37,"end":43,"range":2,"parent":"{}"}',
          'ExportAllDeclaration {"type":"ExportAllDeclaration","exported":null,"source":"{}","attributes":0,"exportKind":"value","start":47,"end":65,"range":2,"parent":"{}"}',
          'ExportDefaultDeclaration {"type":"ExportDefaultDeclaration","declaration":"{}","exportKind":"value","start":66,"end":83,"range":2,"parent":"{}"}',
          'ExportNamedDeclaration {"type":"ExportNamedDeclaration","declaration":"{}","specifiers":0,"source":null,"exportKind":"value","attributes":0,"start":84,"end":138,"range":2,"parent":"{}"}',
          'VariableDeclaration {"type":"VariableDeclaration","kind":"const","declarations":1,"declare":false,"start":91,"end":138,"range":2,"parent":"{}"}',
          'VariableDeclarator {"type":"VariableDeclarator","id":"{}","init":"{}","definite":false,"start":97,"end":137,"range":2,"parent":"{}"}',
          'ArrowFunctionExpression {"type":"ArrowFunctionExpression","expression":true,"async":false,"typeParameters":null,"params":4,"returnType":null,"body":"{}","id":null,"generator":false,"start":101,"end":137,"range":2,"parent":"{}"}',
          'ObjectPattern {"value":[],"writable":true,"enumerable":true,"configurable":true} true type,decorators,properties,optional,typeAnnotation,start,end,range,parent',
          'Property {"type":"Property","kind":"init","key":"{}","value":"{}","method":false,"shorthand":true,"computed":false,"optional":false,"start":104,"end":105,"range":2,"parent":"{}"}',
          'ArrayPattern {"value":[],"writable":true,"enumerable":true,"configurable":true} true type,decorators,elements,optional,typeAnnotation,start,end,range,parent',
          'AssignmentPattern {"value":[],"writable":true,"enumerable":true,"configurable":true} true type,decorators,left,right,optional,typeAnnotation,start,end,range,parent',
          'RestElement {"value":[],"writable":true,"enumerable":true,"configurable":true} true type,decorators,argument,optional,typeAnnotation,value,start,end,range,parent',
          'TaggedTemplateExpression {"type":"TaggedTemplateExpression","tag":"{}","typeArguments":null,"quasi":"{}","start":130,"end":137,"range":2,"parent":"{}"}',
          'CallExpression {"type":"CallExpression","callee":"{}","typeArguments":null,"arguments":1,"optional":false,"start":130,"end":134,"range":2,"parent":"{}"}',
          'NewExpression {"type":"NewExpression","callee":"{}","typeArguments":null,"arguments":0,"start":139,"end":146,"range":2,"parent":"{}"}',
          'VariableDeclaration {"type":"VariableDeclaration","kind":"var","declarations":1,"declare":false,"start":148,"end":154,"range":2,"parent":"{}"}',
          'VariableDeclarator {"type":"VariableDeclarator","id":"{}","init":null,"definite":false,"start":152,"end":153,"range":2,"parent":"{}"}',
          'FunctionDeclaration {"type":"FunctionDeclaration","id":"{}","generator":false,"async":false,"declare":false,"typeParameters":null,"params":0,"returnType":null,"body":"{}","expression":false,"start":155,"end":170,"range":2,"parent":"{}"}',
          'FunctionExpression {"type":"FunctionExpression","id":null,"generator":false,"async":false,"declare":false,"typeParameters":null,"params":0,"returnType":null,"body":"{}","expression":false,"start":172,"end":186,"range":2,"parent":"{}"}',
          'Property {"type":"Property","kind":"init","key":"{}","value":"{}","method":false,"shorthand":false,"computed":false,"optional":false,"start":192,"end":196,"range":2,"parent":"{}"}',
          'Property {"type":"Property","kind":"init","key":"{}","value":"{}","method":true,"shorthand":false,"computed":false,"optional":false,"start":198,"end":204,"range":2,"parent":"{}"}',
          'FunctionExpression {"type":"FunctionExpression","id":null,"generator":false,"async":false,"declare":false,"typeParameters":null,"params":0,"returnType":null,"body":"{}","expression":false,"start":199,"end":204,"range":2,"parent":"{}"}',
          'JSXOpeningElement {"type":"JSXOpeningElement","name":"{}","typeArguments":null,"attributes":1,"selfClosing":true,"start":209,"end":216,"range":2,"parent":"{}"}',
        ]);
        expect(more).toEqual([]);
      },
      timeout,
    );
  });

  const plugin = `const property = (object, key) => {
        const it = Object.getOwnPropertyDescriptor(object, key);
        return key + (it.get ? ":get" : "") + (it.enumerable ? "" : ":hidden");
      };
      const shape = it =>
        (Object.isFrozen(it) ? "frozen " : "") +
        (Object.getPrototypeOf(it) === Object.prototype ? "" : "other ") +
        Object.getOwnPropertyNames(it).map(key => property(it, key));
      const sorted = it => JSON.stringify(Object.fromEntries(Object.entries(it).sort()));
      const seen = new Set();
      const api = {
        create(context) {
          return {
            Program() {
              const { sourceCode, languageOptions } = context;
              const { parser, parserOptions } = languageOptions;
              const manager = sourceCode.scopeManager;
              for (const it of [manager, languageOptions, parser, parserOptions, parserOptions.ecmaFeatures]) seen.add(it);
              let thrown;
              try {
                parser.parse("a");
              } catch (error) {
                thrown = error.constructor.name + ": " + error.message;
              }
              const message = [
                "scopeManager " + shape(manager),
                [manager.getDeclaredVariables, manager.acquire].map(it => it.name + "/" + it.length).join(),
                "languageOptions " + shape(languageOptions),
                [languageOptions.sourceType, languageOptions.ecmaVersion].join(),
                "globals " + (Object.isFrozen(languageOptions.globals) ? "frozen " : "") + sorted(languageOptions.globals),
                "env " + (Object.isFrozen(languageOptions.env) ? "frozen " : "") + sorted(languageOptions.env),
                "parserOptions " + shape(parserOptions) + " " + JSON.stringify(parserOptions),
                "ecmaFeatures " + shape(parserOptions.ecmaFeatures),
                "parser " + shape(parser),
                [parser.name, parser.version, parser.parse.name + "/" + parser.parse.length, parser.latestEcmaVersion].join(),
                thrown,
                (Object.isFrozen(parser.supportedEcmaVersions) ? "frozen " : "") + parser.supportedEcmaVersions,
                "Syntax " + [Object.isFrozen(parser.Syntax), Object.getPrototypeOf(parser.Syntax), parser.Syntax === parser.Syntax, Object.keys(parser.Syntax).join() === Object.keys(sourceCode.visitorKeys).join(), parser.Syntax.Program].join(),
                "same " + [parser.VisitorKeys === sourceCode.visitorKeys, context.parserOptions === parserOptions, seen.size].join(),
                "parserServices " + shape(sourceCode.parserServices),
              ].join("\\n");
              context.report({ loc: { line: 1, column: 0 }, message });
            },
          };
        },
      };
      const globals = {
        create(context) {
          return {
            Program() {
              const { set, variables } = context.sourceCode.scopeManager.globalScope;
              const { env, globals } = context.languageOptions;
              const told = ["Array", "window", "process", "describe", "define", "foo", "bar", "baz"];
              let sum = 0;
              for (const name of variables.map(it => it.name).sort().join()) sum = (Math.imul(sum, 31) + name.charCodeAt(0)) | 0;
              const message = [
                variables.length,
                sum,
                Object.keys(env).sort().join() || "-",
                Object.keys(globals).sort().map(it => it + "=" + globals[it]).join() || "-",
                told.map(it => it + (set.has(it) ? (set.get(it).writeable ? "+w" : "+r") : "-")).join(" "),
              ].join(" ");
              context.report({ loc: { line: 1, column: 0 }, message });
            },
          };
        },
      };
      export default { meta: { name: "p" }, rules: { api, globals } };`;
  const base = { jsPlugins: ["../plugin.mjs"], rules: { "p/globals": "error" } };

  // What oxlint 1.87 says. It goes through `env` and `globals` in the order of a hash map, so the plugin sorts what it prints.
  test(
    "scopeManager, languageOptions and parserServices are the frozen objects of oxlint, the same for all files",
    async () => {
      const config = {
        ...base,
        rules: { "p/api": "error" },
        env: { amd: true, jest: false },
        globals: { b: "readonly", a: "writable", Array: "off" },
      };
      const kinds = {
        "a.js": ["script", true, false, false],
        "b.cjs": ["commonjs", true, true, false],
        "c.mjs": ["module", true, false, true],
        "d.ts": ["script", false, false, false],
        "e.tsx": ["script", true, false, false],
      };
      const files = {
        "plugin.mjs": plugin,
        ".oxlintrc.json": oxlintrc({}),
        "api/.oxlintrc.json": oxlintrc(config),
        ...Object.fromEntries(Object.keys(kinds).map(it => [`api/${it}`, "a;\n"])),
      };
      // One thread, so that one VM sees all the files.
      const { raw, exitCode } = await lint(files, ["-f", "json", "--threads", "1"]);
      const diagnostics: Diagnostic[] = JSON.parse(raw).diagnostics;
      const said = Object.fromEntries(diagnostics.map(it => [slashes(it.filename), it.message.split("\n")]));
      const inScript = [
        "scopeManager frozen scopes:get,globalScope:get,getDeclaredVariables,acquire",
        "getDeclaredVariables/1,acquire/2",
        "languageOptions frozen sourceType:get,ecmaVersion,parser,parserOptions,globals:get,env:get",
        "script,2026",
        'globals frozen {"Array":"off","a":"writable","b":"readonly"}',
        'env frozen {"amd":true}',
        'parserOptions frozen sourceType:get,ecmaFeatures {"sourceType":"script","ecmaFeatures":{"jsx":true,"globalReturn":false,"impliedStrict":false}}',
        "ecmaFeatures frozen jsx:get,globalReturn:get,impliedStrict:get",
        "parser frozen name,version,parse,VisitorKeys,Syntax:get,latestEcmaVersion,supportedEcmaVersions",
        "oxlint,1.87.0,parse/2,17",
        "Error: `context.languageOptions.parser.parse` not implemented yet.",
        "frozen 3,5,6,7,8,9,10,11,12,13,14,15,16,17",
        "Syntax true,,true,true,Program",
        "same true,true,5",
        "parserServices frozen ",
      ];
      const options = ([sourceType, jsx, globalReturn, impliedStrict]: (string | boolean)[]) =>
        JSON.stringify({ sourceType, ecmaFeatures: { jsx, globalReturn, impliedStrict } });
      expect(said).toEqual(
        Object.fromEntries(
          Object.entries(kinds).map(([file, kind]) => [
            `api/${file}`,
            inScript.map(it =>
              it.replace("script,2026", `${kind[0]},2026`).replace(options(kinds["a.js"]), options(kind)),
            ),
          ]),
        ),
      );
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  // What oxlint 1.87 says: how many variables the global scope has, a sum over their names, `env`, `globals`, and some variables.
  test(
    "the globals are those of the envs that are on and of globals: builtin only without env, overrides merge, extends doesn't count",
    async () => {
      const everyEnv =
        "amd applescript astro atomtest audioworklet browser builtin bun commonjs embertest es2015 es2016 es2017 es2018 es2019 es2020 es2021 es2022 es2023 es2024 es2025 es2026 es6 greasemonkey jasmine jest jquery meteor mocha mongo nashorn node phantomjs prototypejs protractor qunit serviceworker shared-node-browser shelljs svelte vitest vue webextensions worker";
      const inSub = (more: object) => ({ files: ["sub/**"], ...more });
      const configs: Record<string, object> = {
        "no-env": {},
        "env": { env: { browser: true }, globals: { foo: "readonly", bar: "off" } },
        "empty-env": { env: {} },
        "env-off": { env: { browser: false } },
        "unknown-env": { env: { nope: true } },
        "builtin-off": { env: { builtin: false, amd: true } },
        "override-adds": { overrides: [inSub({ env: { browser: true }, globals: { foo: "writable" } })] },
        "override-changes": {
          env: { browser: true },
          globals: { foo: "readonly", bar: "off" },
          overrides: [
            inSub({
              env: { builtin: true, browser: false, node: true },
              globals: { foo: "off", bar: "writable", baz: "readonly" },
            }),
          ],
        },
        "two-overrides": {
          overrides: [{ files: ["**/*.js"], env: { amd: true } }, inSub({ env: { amd: false, jest: true } })],
        },
        "override-builtin-off": { overrides: [inSub({ env: { builtin: false } })] },
        "extends": { extends: ["./base.json"] },
        "extends-and-env": { extends: ["./base.json"], env: { jest: true }, globals: { bar: "readonly" } },
        "globals": { globals: { foo: true, bar: false, baz: "readable", Array: "writeable", window: "off" } },
        "every-env": { env: Object.fromEntries(everyEnv.split(" ").map(it => [it, true])) },
      };
      const files: Record<string, string> = { "plugin.mjs": plugin, ".oxlintrc.json": oxlintrc({}) };
      for (const [name, config] of Object.entries(configs)) {
        files[`${name}/.oxlintrc.json`] = oxlintrc({ ...base, ...config });
        files[`${name}/base.json`] = JSON.stringify({ env: { amd: true }, globals: { foo: "writable" } });
        files[`${name}/a.js`] = files[`${name}/sub/b.js`] = "a;\n";
      }
      const { raw, exitCode } = await lint(files, ["-f", "json"]);
      const diagnostics: Diagnostic[] = JSON.parse(raw).diagnostics;
      expect(Object.fromEntries(diagnostics.map(it => [slashes(it.filename), it.message]))).toEqual({
        "builtin-off/a.js": "3 616407005 amd - Array- window- process- describe- define+r foo- bar- baz-",
        "builtin-off/sub/b.js": "3 616407005 amd - Array- window- process- describe- define+r foo- bar- baz-",
        "empty-env/a.js": "1 94844771 - - Array- window- process- describe- define- foo- bar- baz-",
        "empty-env/sub/b.js": "1 94844771 - - Array- window- process- describe- define- foo- bar- baz-",
        "env-off/a.js": "1 94844771 - - Array- window- process- describe- define- foo- bar- baz-",
        "env-off/sub/b.js": "1 94844771 - - Array- window- process- describe- define- foo- bar- baz-",
        "env/a.js":
          "1198 1747972463 browser bar=off,foo=readonly Array- window+r process- describe- define- foo+r bar- baz-",
        "env/sub/b.js":
          "1198 1747972463 browser bar=off,foo=readonly Array- window+r process- describe- define- foo+r bar- baz-",
        "every-env/a.js":
          "1639 -1319075877 amd,applescript,astro,atomtest,audioworklet,browser,builtin,bun,commonjs,embertest,es2015,es2016,es2017,es2018,es2019,es2020,es2021,es2022,es2023,es2024,es2025,es2026,es6,greasemonkey,jasmine,jest,jquery,meteor,mocha,mongo,nashorn,node,phantomjs,prototypejs,protractor,qunit,serviceworker,shared-node-browser,shelljs,svelte,vitest,vue,webextensions,worker - Array+r window+r process+r describe+r define+r foo- bar- baz-",
        "every-env/sub/b.js":
          "1639 -1319075877 amd,applescript,astro,atomtest,audioworklet,browser,builtin,bun,commonjs,embertest,es2015,es2016,es2017,es2018,es2019,es2020,es2021,es2022,es2023,es2024,es2025,es2026,es6,greasemonkey,jasmine,jest,jquery,meteor,mocha,mongo,nashorn,node,phantomjs,prototypejs,protractor,qunit,serviceworker,shared-node-browser,shelljs,svelte,vitest,vue,webextensions,worker - Array+r window+r process+r describe+r define+r foo- bar- baz-",
        "extends-and-env/a.js":
          "15 -1557638922 jest bar=readonly Array- window- process- describe+r define- foo- bar+r baz-",
        "extends-and-env/sub/b.js":
          "15 -1557638922 jest bar=readonly Array- window- process- describe+r define- foo- bar+r baz-",
        "extends/a.js": "66 930916712 builtin - Array+r window- process- describe- define- foo- bar- baz-",
        "extends/sub/b.js": "66 930916712 builtin - Array+r window- process- describe- define- foo- bar- baz-",
        "globals/a.js":
          "69 -762096136 builtin Array=writable,bar=readonly,baz=readonly,foo=writable,window=off Array+w window- process- describe- define- foo+w bar+r baz+r",
        "globals/sub/b.js":
          "69 -762096136 builtin Array=writable,bar=readonly,baz=readonly,foo=writable,window=off Array+w window- process- describe- define- foo+w bar+r baz+r",
        "no-env/a.js": "66 930916712 builtin - Array+r window- process- describe- define- foo- bar- baz-",
        "no-env/sub/b.js": "66 930916712 builtin - Array+r window- process- describe- define- foo- bar- baz-",
        "override-adds/a.js": "66 930916712 builtin - Array+r window- process- describe- define- foo- bar- baz-",
        "override-adds/sub/b.js":
          "1263 -1504104892 browser,builtin foo=writable Array+r window+r process- describe- define- foo+w bar- baz-",
        "override-builtin-off/a.js": "66 930916712 builtin - Array+r window- process- describe- define- foo- bar- baz-",
        "override-builtin-off/sub/b.js": "1 94844771 - - Array- window- process- describe- define- foo- bar- baz-",
        "override-changes/a.js":
          "1198 1747972463 browser bar=off,foo=readonly Array- window+r process- describe- define- foo+r bar- baz-",
        "override-changes/sub/b.js":
          "149 -543027797 builtin,node bar=writable,baz=readonly,foo=off Array+r window- process+r describe- define- foo- bar+w baz+r",
        "two-overrides/a.js": "68 -116936702 amd,builtin - Array+r window- process- describe- define+r foo- bar- baz-",
        "two-overrides/sub/b.js":
          "79 -71093976 builtin,jest - Array+r window- process- describe+r define- foo- bar- baz-",
        "unknown-env/a.js": "1 94844771 nope - Array- window- process- describe- define- foo- bar- baz-",
        "unknown-env/sub/b.js": "1 94844771 nope - Array- window- process- describe- define- foo- bar- baz-",
      });
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  // What oxlint 1.87 says, and ESLint 10.12 with @typescript-eslint/parser 8.71.1: the same.
  test.each(["oxlint", "eslint"])(
    "reference.maybeImplicitGlobal is typescript-eslint's: an object, null or undefined, with a config of %s",
    async whose => {
      const rule = `export default { meta: { name: "p" }, rules: { rule: { create: context => ({
        Program(node) {
          const said = context.sourceCode.scopeManager.scopes.flatMap(scope =>
            scope.references.map(it => {
              const maybe = it.maybeImplicitGlobal;
              const object = () => Object.keys(maybe) + "=" + maybe.node.type + "," + (maybe.pattern === it.identifier);
              return it.identifier.name + ":" + (maybe ? object() : maybe);
            }),
          );
          context.report({ node, message: said.join(" ") });
        },
      }) } } };`;
      const code =
        'x = 1; function f() { y = 2; x; } var a = 3; Object = 3; for (z in {}); for (var w of []); [p, q = 1] = []; ({ r } = {}); b += 1; c++; function h(d = 1, { e = 2 }) {} function i() { "use strict"; k = 1; } class C { m() { n = 1; } }';
      const types = " let t: T = 1 as const; (u as any) = 1;";
      const by = (type: string) => `node,pattern=${type},true`;
      const assigned = by("AssignmentExpression");
      const top = (maybe: string, inLoop: string) =>
        `x:${maybe} a:null Object:${maybe} z:${inLoop} w:null p:${maybe} q:${maybe} q:${maybe} r:${maybe} b:undefined c:undefined`;
      const inFunctions = (maybe: string) => `y:${maybe} x:undefined d:null e:null k:null n:null`;
      const expected = {
        "script.js": `${top(assigned, by("ForInStatement"))} ${inFunctions(assigned)}`,
        "script.ts": `${top(assigned, by("ForInStatement"))} t:null const:null T:null u:${assigned} ${inFunctions(assigned)}`,
        "module.mts": `${top("null", "null")} t:null const:null T:null u:null a:null ${inFunctions("null")}`,
      };
      const configs = {
        oxlint: { ".oxlintrc.json": oxlintrc({ jsPlugins: ["./plugin.mjs"], rules: { "p/rule": "error" } }) },
        eslint: {
          "eslint.config.mjs": `import p from "./plugin.mjs";
            const parser = { meta: { name: "typescript-eslint/parser" } };
            export default [
              { files: ["**/*.ts", "**/*.js", "**/*.mts"], plugins: { p }, rules: { "p/rule": "error" }, languageOptions: { parser } },
              { files: ["script.*"], languageOptions: { sourceType: "script", parserOptions: { sourceType: "script" } } },
            ];`,
        },
      };
      const files = {
        "plugin.mjs": rule,
        ...configs[whose as keyof typeof configs],
        "script.js": `${code}\n`,
        "script.ts": `${code}${types}\n`,
        "module.mts": `${code}${types} export { a };\n`,
      };
      const { raw, exitCode } = await lint(files, ["-f", "json", ...Object.keys(expected)]);
      const said: [string, string][] =
        whose === "oxlint"
          ? JSON.parse(raw).diagnostics.map((it: Diagnostic) => [it.filename, it.message])
          : JSON.parse(raw).map((it: { filePath: string; messages: { message: string }[] }) => [
              slashes(it.filePath).split("/").at(-1),
              it.messages.map(message => message.message).join("|"),
            ]);
      expect(Object.fromEntries(said)).toEqual(expected);
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  // What oxlint 1.87 says, and ESLint 10.12 with @typescript-eslint/parser 8.71.1: the same.
  test.each(["oxlint", "eslint"])(
    "the index of `a[b]!` in a pattern is referred to before the object, like that of `a[b]`, with a config of %s",
    async whose => {
      const rule = `export default { meta: { name: "p" }, rules: { rule: { create: context => ({
        "Program:exit"(node) {
          const lines = {};
          for (const it of context.sourceCode.scopeManager.scopes.flatMap(scope => scope.references))
            (lines[it.identifier.loc.start.line] ??= []).push(it.identifier.name);
          context.report({ node, message: Object.values(lines).map(it => it.join(" ")).join("|") });
        },
      }) } } };`;
      const rows = [
        ["[a[b]] = c;", "b a c"],
        ["[a![b]] = c;", "b a c"],
        ["[a[b]!] = c;", "b a c"],
        ["[a![b]!] = c;", "b a c"],
        ["[a[b]!!] = c;", "b a c"],
        ["[...a[b]!] = c;", "b a c"],
        ["[a[b]! = d] = c;", "b a d c"],
        ["({ k: a[b]! } = c);", "b a c"],
        ["({ k: a[b]! = d } = c);", "b a d c"],
        ["({ ...a[b]! } = c);", "b a c"],
        ["for (a[b]! of c);", "b a c"],
        ["for (a[b]! in c);", "b a c"],
        ["a[b]! = c;", "a b c"],
        ["[a.b!] = c;", "a c"],
        ["[a[b][d]!] = c;", "d a b c"],
        ["[a[b]![d]] = c;", "d a b c"],
        ["[a[b]![d]!] = c;", "d a b c"],
        ["[[a[b]!]] = c;", "b a c"],
        ["[x, a[b]!, y[z]] = c;", "x b a z y c"],
        ["[f(a[b])!.g] = c;", "f a b c"],
        ["[f(a[b])![g]!] = c;", "g f a b c"],
      ];
      const configs = {
        oxlint: { ".oxlintrc.json": oxlintrc({ jsPlugins: ["./plugin.mjs"], rules: { "p/rule": "error" } }) },
        eslint: {
          "eslint.config.mjs": `import p from "./plugin.mjs";
            const parser = { meta: { name: "typescript-eslint/parser" } };
            export default [{ files: ["**/*.ts"], plugins: { p }, rules: { "p/rule": "error" }, languageOptions: { parser } }];`,
        },
      };
      const files = {
        "plugin.mjs": rule,
        ...configs[whose as keyof typeof configs],
        "a.ts": rows.map(it => `${it[0]}\n`).join(""),
      };
      const { raw, exitCode } = await lint(files, ["-f", "json", "a.ts"]);
      const message: string =
        whose === "oxlint" ? JSON.parse(raw).diagnostics[0].message : JSON.parse(raw)[0].messages[0].message;
      expect(message.split("|").map((said, i) => [rows[i][0], said])).toEqual(rows);
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  // `loc`, `decorators`, `ast.tokens` and the properties of `sourceCode` are made when they're read. It must not show who reads them first, in
  // which realm or in which tier of the engine: they belong to the plugin's realm and stay the same objects.
  // This is what oxlint 1.87 and ESLint 10.12 say, where all of it is plain data.
  test.each(["oxlint", "eslint"])(
    "what is made on first read is the same from a node:vm context and in hot code, with a config of %s",
    async whose => {
      const plugin = String.raw`import vm from "node:vm";
const keys = ["decorators", "loc", "range"];
// The same functions for each realm. A loop is as long as it takes the JIT compilers to get to it.
const source =
  "({" +
  keys
    .map(
      key =>
        "first_KEY(list, Base) { let mine = 0; const out = []; for (let i = 0; i < list.length; i++) { const it = list[i].KEY; mine += it instanceof Base; out.push(it); } return [mine, out]; }," +
        "again_KEY(list, seen) { let changed = 0; for (let r = 0; r < 3; r++) for (let i = 0; i < list.length; i++) changed += list[i].KEY !== seen[i]; return changed; },",
    )
    .map((text, i) => text.replaceAll("KEY", keys[i]))
    .join("") +
  "methods(sourceCode, list) { let mine = 0; for (let r = 0; r < 3; r++) for (let i = 0; i < list.length; i++) mine += (sourceCode.getAncestors(list[i]) instanceof Array) + (sourceCode.getTokens(list[i]) instanceof Array); return mine; }," +
  "properties(sourceCode) { const { text, ast, lines, visitorKeys, scopeManager, parserServices } = sourceCode; let changed = 0; for (let r = 0; r < 20000; r++) changed += (sourceCode.text !== text) + (sourceCode.ast !== ast) + (sourceCode.lines !== lines) + (sourceCode.visitorKeys !== visitorKeys) + (sourceCode.scopeManager !== scopeManager) + (sourceCode.parserServices !== parserServices) + (sourceCode.hasBOM !== false); return [changed, lines instanceof Array, ast.tokens instanceof Array, ast.comments instanceof Array, ast.tokens[0].loc instanceof Object, scopeManager.scopes[0].variables instanceof Array].join(); }," +
  "Array, Object })";
const rule = {
  create(context) {
    const found = [];
    return {
      Identifier(node) {
        found.push(node);
      },
      "Program:exit"(program) {
        const { sourceCode } = context;
        const said = [];
        for (const [realm, list, it] of [
          ["main", found.slice(0, found.length / 2), (0, eval)(source)],
          ["vm", found.slice(found.length / 2), vm.runInContext(source, vm.createContext({}))],
        ]) {
          // One read each of a node that nothing has looked at.
          const node = list.pop();
          const inContext = text => vm.runInNewContext(text, { node, sourceCode });
          if (realm === "vm")
            said.push(
              "cold " +
                [
                  inContext("Array.isArray(node.range) && !(node.range instanceof Array)"),
                  inContext("typeof node.loc.start.line"),
                  inContext("'decorators' in node ? node.decorators.length : 'none'"),
                  inContext("sourceCode.getText(node)"),
                  inContext("sourceCode.getFirstToken(node).value"),
                  inContext("sourceCode.text.length"),
                  inContext("Reflect.get(node, 'loc', 42) === node.loc"),
                  node.range instanceof Array,
                  node.loc instanceof Object,
                ].join(),
            );
          for (const key of keys) {
            if (!(key in list[0])) continue;
            const [Base, MainBase] = key === "loc" ? [it.Object, Object] : [it.Array, Array];
            const [ofReader, seen] = it["first_" + key](list, Base);
            if (key === "decorators") for (const decorators of seen) decorators.push(1);
            const ofMain = seen.filter(it => it instanceof MainBase).length;
            const kept = key === "decorators" ? list.filter(it => it.decorators.length === 1).length : "-";
            said.push([realm, key, "reader's", ofReader, "main", ofMain, "changed", it["again_" + key](list, seen), "kept", kept].join(" "));
          }
          said.push([realm, "methods", it.methods(sourceCode, list), "properties", it.properties(sourceCode)].join(" "));
        }
        context.report({ node: program, message: said.join("\n") });
      },
    };
  },
};
export default { meta: { name: "p" }, rules: { rule } };
`;
      const expected = {
        oxlint: [
          "main decorators reader's 1500 main 1500 changed 0 kept 1500",
          "main loc reader's 1500 main 1500 changed 0 kept -",
          "main range reader's 1500 main 1500 changed 0 kept -",
          "main methods 9000 properties 0,true,true,true,true,true",
          "cold true,number,0,v3001,v3001,19909,true,true,true",
          "vm decorators reader's 0 main 1500 changed 0 kept 1500",
          "vm loc reader's 0 main 1500 changed 0 kept -",
          "vm range reader's 0 main 1500 changed 0 kept -",
          "vm methods 0 properties 0,false,false,false,false,false",
        ],
        eslint: [
          "main loc reader's 1500 main 1500 changed 0 kept -",
          "main range reader's 1500 main 1500 changed 0 kept -",
          "main methods 9000 properties 0,true,true,true,true,true",
          "cold true,number,none,v3001,v3001,19909,true,true,true",
          "vm loc reader's 0 main 1500 changed 0 kept -",
          "vm range reader's 0 main 1500 changed 0 kept -",
          "vm methods 0 properties 0,false,false,false,false,false",
        ],
      };
      const configs = {
        oxlint: { ".oxlintrc.json": oxlintrc({ jsPlugins: ["./plugin.mjs"], rules: { "p/rule": "error" } }) },
        eslint: {
          "eslint.config.mjs": `import p from "./plugin.mjs";
            export default [{ files: ["**/*.js"], plugins: { p }, rules: { "p/rule": "error" } }];`,
        },
      };
      const files = {
        "plugin.mjs": plugin,
        ...configs[whose as keyof typeof configs],
        "a.js": "// c\n" + Array.from({ length: 3002 }, (_, i) => `v${i};\n`).join(""),
      };
      const { raw, exitCode } = await lint(files, ["-f", "json", "a.js"]);
      const message: string =
        whose === "oxlint" ? JSON.parse(raw).diagnostics[0].message : JSON.parse(raw)[0].messages[0].message;
      expect(message.split("\n")).toEqual(expected[whose as keyof typeof expected]);
      expect(exitCode).toBe(1);
    },
    timeout,
  );
});

test.concurrent(
  "getAncestors returns every ancestor after a plugin has put an accessor with an index for a name on Array.prototype",
  async () => {
    const plugin = `Object.defineProperty(Array.prototype, "4294967290", { get() {}, set() {}, configurable: true });
      const rule = {
        create(context) {
          return {
            ReturnStatement(node) {
              context.report({ node, message: context.sourceCode.getAncestors(node).map(it => it.type).join() });
            },
          };
        },
      };
      export default { meta: { name: "p" }, rules: { rule } };`;
    const config = { jsPlugins: ["./plugin.mjs"], rules: { "p/rule": "error" } };
    const code = "function f(a) { if (a) { for (;;) { while (a) { return 1; } } } }\n";
    const { raw, exitCode } = await lint({ "plugin.mjs": plugin, ".oxlintrc.json": oxlintrc(config), "a.js": code }, [
      "-f",
      "json",
    ]);
    expect(JSON.parse(raw).diagnostics.map((it: { message: string }) => it.message)).toEqual([
      "Program,FunctionDeclaration,BlockStatement,IfStatement,BlockStatement,ForStatement,BlockStatement,WhileStatement,BlockStatement",
    ]);
    expect(exitCode).toBe(1);
  },
  timeout,
);

test.concurrent(
  "context.sourceCode is laid out and answers as in ESLint: text, lines, locations, indices, ancestors, scopes, directive comments, bad input",
  async () => {
    const oracle = join(import.meta.dir, "oracle", "jsplugins", "source-code");
    const { texts } = require(join(oracle, "plugin.cjs"));
    const files = {
      "plugin.cjs": readFileSync(join(oracle, "plugin.cjs"), "utf8"),
      "eslint.config.cjs": `const demo = require("./plugin.cjs");
        module.exports = [
          { files: ["**/*.js", "**/*.ts"], plugins: { demo }, rules: { "demo/all": "error" } },
          { files: ["**/*.ts"], languageOptions: { parser: { meta: { name: "typescript-eslint/parser" } } } },
        ];`,
      ...texts,
    };
    const { raw, exitCode } = await lint(files, ["-f", "json", ...Object.keys(texts)]);
    const said = Object.fromEntries(
      JSON.parse(raw).map((result: any) => [
        result.filePath.replaceAll("\\", "/").split("/").at(-1),
        JSON.parse(result.messages.find((it: any) => it.ruleId === "demo/all").message),
      ]),
    );
    // Recorded with ESLint 10.12.0 and @typescript-eslint/parser 8.71.1 by record.mjs in that directory.
    expect(said).toEqual(JSON.parse(readFileSync(join(oracle, "expected.json"), "utf8")));
    expect(exitCode).toBe(1);
  },
  timeout,
);

describe.concurrent("code paths in JavaScript plugins", () => {
  const oracle = join(import.meta.dir, "oracle", "jsplugins", "code-paths");
  const trace = readFileSync(join(oracle, "trace.cjs"), "utf8");
  // Recorded with ESLint 10.12.0 and @typescript-eslint/parser 8.71.1 by record.mjs in that directory.
  const expected: Record<string, string> = JSON.parse(
    Buffer.from(Bun.zstdDecompressSync(readFileSync(join(oracle, "expected.json.zst")))).toString(),
  );
  const filesOf = (cases: typeof codePathCases) => Object.fromEntries(cases.map(it => [fileOf(it), it.code]));
  const slashes = (path: string) => path.replaceAll("\\", "/");

  test(
    "events, graphs, traverseSegments and the properties of the objects match ESLint in JavaScript files",
    async () => {
      const cases = codePathCases.filter(it => !isTypeScript(it));
      const config = `const trace = require("./trace.cjs");
        module.exports = [
          { plugins: { trace } },
          { files: ["layout.js"], rules: { "trace/layout": "error" } },
          ...["module", "script", "commonjs"].map(sourceType => ({
            files: [sourceType + "/*.js"],
            rules: { "trace/all": "error" },
            languageOptions: { sourceType, parserOptions: { ecmaFeatures: { jsx: true } } },
          })),
        ];`;
      const files = { "trace.cjs": trace, "eslint.config.cjs": config, "layout.js": "a;", ...filesOf(cases) };
      const { raw, exitCode } = await lint(files, ["-f", "json"]);
      const results: { filePath: string; messages: { message: string }[] }[] = JSON.parse(raw);
      const messagesOf = (file: string) =>
        results.find(it => slashes(it.filePath).endsWith(`/${file}`))?.messages.map(it => it.message);
      for (const it of cases) {
        expect({ name: it.name, traces: messagesOf(fileOf(it)) }).toEqual({
          name: it.name,
          traces: [expected[it.name]],
        });
      }
      // The message under ESLint 10.12.0.
      expect(messagesOf("layout.js")?.map(it => it.split("\n"))).toEqual([
        [
          "CodePath own(id:value:wec,origin:value:wec,upper:value:wec,childCodePaths:value:wec,internal:value:) prototype(constructor:value:wc,initialSegment:getter:c,finalSegments:getter:c,returnedSegments:getter:c,thrownSegments:getter:c,traverseSegments:value:wc) keys(id,origin,upper,childCodePaths)",
          "CodePathSegment own(id:value:wec,nextSegments:value:wec,prevSegments:value:wec,allNextSegments:value:wec,allPrevSegments:value:wec,reachable:value:wec,internal:value:) prototype(constructor:value:wc,isLoopedPrevSegment:value:wc) keys(id,nextSegments,prevSegments,allNextSegments,allPrevSegments,reachable)",
          "in: initialSegment,traverseSegments,internal",
          'JSON: {"id":"s1","origin":"program","upper":null,"childCodePaths":[]} {"id":"s1_1","nextSegments":[],"prevSegments":[],"allNextSegments":[],"allPrevSegments":[],"reachable":true}',
          "the same array each time: true",
          "without options: s1_1,s1_1,s1_1",
          "controller: skip,break",
        ],
      ]);
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "events and graphs match ESLint with typescript-eslint's parser in TypeScript files",
    async () => {
      const cases = codePathCases.filter(isTypeScript);
      const config = { ignorePatterns: ["trace.cjs"], jsPlugins: ["./trace.cjs"], rules: { "trace/all": "error" } };
      const files = { "trace.cjs": trace, ".oxlintrc.json": oxlintrc(config), ...filesOf(cases) };
      const { raw, exitCode } = await lint(files, ["-f", "json"]);
      const diagnostics: { filename: string; message: string }[] = JSON.parse(raw).diagnostics;
      for (const it of cases) {
        const traces = diagnostics.filter(diagnostic => slashes(diagnostic.filename) === it.name);
        expect({ name: it.name, traces: traces.map(diagnostic => diagnostic.message) }).toEqual({
          name: it.name,
          traces: [expected[it.name]],
        });
      }
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  // ESLint 9 removed `currentSegments`. The first test checks that it's gone with a flat configuration.
  test(
    "codePath.currentSegments follows the traversal with an ESLint 8 configuration",
    async () => {
      const plugin = `module.exports = { rules: { paths: { create(context) {
        const seen = [];
        const stack = [];
        const now = label => seen.push(label + " [" + stack.at(-1).currentSegments.map(it => it.id) + "]");
        return {
          onCodePathStart: codePath => stack.push(codePath),
          onCodePathEnd(codePath, node) {
            now("end");
            stack.pop();
            if (node.type === "Program") context.report({ node, message: seen.join(" ") });
          },
          onCodePathSegmentStart: segment => now("+" + segment.id),
          onCodePathSegmentEnd: segment => now("-" + segment.id),
          onUnreachableCodePathSegmentStart: segment => now("+" + segment.id),
          onUnreachableCodePathSegmentEnd: segment => now("-" + segment.id),
          ReturnStatement: () => now("return"),
          ExpressionStatement: () => now("statement"),
          "FunctionDeclaration:exit": () => now("exit"),
        };
      } } } };`;
      const files = {
        ".eslintrc.json": JSON.stringify({ root: true, plugins: ["foo"], rules: { "foo/paths": "error" } }),
        "node_modules/eslint-plugin-foo/package.json": `{ "name": "eslint-plugin-foo", "main": "index.js" }`,
        "node_modules/eslint-plugin-foo/index.js": plugin,
        "a.js": "function f() { if (a) return; b(); throw c; d(); }\n",
        // Two segments are current in the `finally` block, and the listener for the first already sees both.
        "b.js": "function f() { try { if (a) return; b(); } finally { c(); } d(); }\n",
      };
      const { raw, exitCode } = await lint(files, ["-f", "json", "a.js", "b.js"]);
      const results: { messages: { message: string }[] }[] = JSON.parse(raw);
      // From ESLint's analyzer with the listeners called while it runs, as ESLint 8 calls them.
      expect(results.map(result => result.messages.map(it => it.message))).toEqual([
        [
          "+s1_1 [s1_1] +s2_1 [s2_1] -s2_1 [s2_1] +s2_2 [s2_2] return [s2_2] -s2_2 [s2_2] +s2_4 [s2_4] statement [s2_4] -s2_4 [s2_4] +s2_5 [s2_5] statement [s2_5] exit [s2_5] -s2_5 [s2_5] end [] -s1_1 [s1_1] end []",
        ],
        [
          "+s1_1 [s1_1] +s2_1 [s2_1] -s2_1 [s2_1] +s2_3 [s2_3] return [s2_3] -s2_3 [s2_3] +s2_5 [s2_5] statement [s2_5] -s2_5 [s2_5] +s2_6 [s2_6,s2_7] +s2_7 [s2_6,s2_7] statement [s2_6,s2_7] -s2_7 [s2_6,s2_7] statement [s2_6] exit [s2_6] -s2_6 [s2_6] end [] -s1_1 [s1_1] end []",
        ],
      ]);
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "an error thrown from a code path listener or a traverseSegments callback names the rule",
    async () => {
      const plugin = `const fail = () => { throw new Error("thrown on purpose"); };
        module.exports = { meta: { name: "throws" }, rules: {
          listener: { create: () => ({ onCodePathSegmentStart: fail }) },
          callback: { create: () => ({ onCodePathEnd: codePath => codePath.traverseSegments(fail) }) },
        } };`;
      const run = async (rule: string) => {
        const config = `const throws = require("./plugin.cjs");
          module.exports = [{ plugins: { throws }, rules: { "throws/${rule}": "error" } }];`;
        const { stderr, exitCode } = await lint({ "eslint.config.cjs": config, "plugin.cjs": plugin, "a.js": "a;\n" }, [
          "a.js",
        ]);
        return { lines: stderr.split("\n").filter(line => /^error:|^Rule:/.test(line)), exitCode };
      };
      // ESLint 10.12.0 prints the same two lines and exits with 2.
      expect(await Promise.all([run("listener"), run("callback")])).toEqual([
        { lines: ["error: thrown on purpose", 'Rule: "throws/listener"'], exitCode: 2 },
        { lines: ["error: thrown on purpose", 'Rule: "throws/callback"'], exitCode: 2 },
      ]);
    },
    timeout,
  );
});

describe.concurrent("JavaScript plugins and threads", () => {
  // A file that's linted with types, and standard input, are parsed on a thread that has no VM. A thread that has one parses them again.
  test(
    "markVariableAsUsed reaches no-unused-vars in files with types, files without, and standard input",
    async () => {
      const code =
        "function outer() { const keptInner = 1; const lostInner = 2; }\nconst kept = 1;\nconst lost = 2;\nouter();\n";
      const files = {
        "tsconfig.json": JSON.stringify({ compilerOptions: { noLib: true, types: [] } }),
        "eslint.config.mjs": `
          import own from "./plugin.mjs";
          export default [
            { files: ["**/*.js", "**/*.ts"], plugins: { own }, rules: { "own/keeps": "error", "no-unused-vars": "error" } },
            {
              files: ["typed/*.ts"],
              plugins: { "@typescript-eslint": { meta: { name: "@typescript-eslint/eslint-plugin" } } },
              languageOptions: { parser: { meta: { name: "typescript-eslint/parser" } }, parserOptions: { projectService: true } },
              rules: { "@typescript-eslint/no-floating-promises": "error" },
            },
          ];`,
        "plugin.mjs": `export default { rules: { keeps: { create: context => ({
          VariableDeclarator(node) {
            if (node.id.name.startsWith("kept")) context.sourceCode.markVariableAsUsed(node.id.name, node);
          },
        }) } } };`,
        "plain/a.js": code,
        "typed/a.ts": code,
      };
      using dir = tempDir("bun-lint-js-plugins", files);
      const run = async (args: string[], stdin: "ignore" | Buffer) => {
        await using proc = spawn({
          cmd: [bunExe(), "lint", "--threads", "2", "-f", "unix", ...args],
          env,
          cwd: String(dir),
          stdin,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
        return {
          names: Array.from(stdout.matchAll(/(\w+\.\w+):\d+:\d+: '(\w+)'/g), it => `${it[1]} ${it[2]}`),
          exitCode,
        };
      };
      const [ofFiles, ofStdin] = await Promise.all([
        run(["plain", "typed"], "ignore"),
        run(["--stdin", "--stdin-filename", "plain/b.js"], Buffer.from(code)),
      ]);
      expect(ofFiles).toEqual({ names: ["a.js lostInner", "a.js lost", "a.ts lostInner", "a.ts lost"], exitCode: 1 });
      expect(ofStdin).toEqual({ names: ["b.js lostInner", "b.js lost"], exitCode: 1 });
    },
    timeout,
  );

  test(
    "nested .oxlintrc.json files load their own jsPlugins while files are being discovered",
    async () => {
      const plugin = (
        name: string,
      ) => `export default { meta: { name: "${name}" }, rules: { seen: { create: context => ({
        Program(node) { context.report({ node, message: "by ${name}" }); },
      }) } } };`;
      const config = (name: string) =>
        JSON.stringify({
          categories: { correctness: "off" },
          ignorePatterns: ["own.mjs"],
          jsPlugins: ["./own.mjs"],
          rules: { [`${name}/seen`]: "error" },
        });
      const files: Record<string, string> = {
        ".oxlintrc.json": config("top"),
        "own.mjs": plugin("top"),
        "a.js": "1;\n",
      };
      const expected = ["a.js:1:1: by top [Error/top(seen)]"];
      for (let i = 0; i < 8; i++) {
        files[`d${i}/.oxlintrc.json`] = config(`p${i}`);
        files[`d${i}/own.mjs`] = plugin(`p${i}`);
        files[`d${i}/sub/a.js`] = "1;\n";
        expected.push(`d${i}/sub/a.js:1:1: by p${i} [Error/p${i}(seen)]`);
      }
      const { stdout, exitCode } = await lint(files, ["-f", "unix", "--threads", "8"]);
      expect(
        stdout
          .replaceAll("\\", "/")
          .split("\n")
          .filter(it => it.includes(": by "))
          .sort(),
      ).toEqual(expected.sort());
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "a project where one folder needs a plugin reports the same with 1, 3 and 16 threads, from one VM",
    async () => {
      const files: Record<string, string> = {
        "eslint.config.mjs": `
          import demo from "./plugin.mjs";
          export default [
            { rules: { "no-unused-vars": "error" } },
            { files: ["some/*.js"], plugins: { demo }, rules: { "demo/no-foo": "error" } },
          ];`,
        "plugin.mjs": noFoo,
      };
      for (let i = 0; i < 48; i++) files[`${i % 8 === 0 ? "some" : "other"}/${i}.js`] = `const unused${i} = foo;\n`;
      const run = async (threads: string) => {
        const { stdout, stderr, exitCode } = await lint(files, [
          "-f",
          "unix",
          "--timing",
          "--threads",
          threads,
          "some",
          "other",
        ]);
        return { stdout, vms: /JavaScript: (\d+) engines/.exec(stderr)?.[1], exitCode };
      };
      const [one, three, many] = await Promise.all(["1", "3", "16"].map(run));
      expect(one.stdout.split("\n").filter(it => it.endsWith("[Error/demo/no-foo]"))).toHaveLength(6);
      expect(one.stdout.split("\n").filter(it => it.endsWith("[Error/no-unused-vars]"))).toHaveLength(48);
      expect(one).toEqual({ stdout: expect.any(String), vms: "1", exitCode: 1 });
      expect(three).toEqual(one);
      expect(many).toEqual(one);
    },
    timeout,
  );

  test(
    "--threads 1 has one VM, also when a file of 256 KB and more is among the files",
    async () => {
      const files: Record<string, string> = {
        "eslint.config.mjs": `
          import demo from "./plugin.mjs";
          export default [{ plugins: { demo }, rules: { "demo/no-foo": "error" } }];`,
        "plugin.mjs": noFoo,
        "src/heavy.js": `foo;\n/*${Buffer.alloc(300_000, "x")}*/\n`,
      };
      for (let i = 0; i < 4; i++) files[`src/${i}.js`] = "foo;\n";
      const { stdout, stderr, exitCode } = await lint(files, ["-f", "unix", "--timing", "--threads", "1", "src"]);
      expect(stdout.split("\n").filter(it => it.endsWith("[Error/demo/no-foo]"))).toHaveLength(5);
      expect(stderr).toContain("JavaScript: 1 engines");
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  // As ESLint 10.12.0, which lints one file after the other.
  test(
    "if a rule throws in several files, the error for the first path is reported, however many threads there are",
    async () => {
      const files: Record<string, string> = {
        "eslint.config.mjs": `
          import own from "./plugin.mjs";
          export default [{ plugins: { own }, rules: { "own/throws": "error" } }];`,
        "plugin.mjs": `export default { rules: { throws: { create: context => ({
          Program() { if (context.filename.endsWith("7.js")) throw new Error("thrown on purpose"); },
        }) } } };`,
      };
      // 6 MB, which is work for several VMs.
      const text = `foo;\n/*${Buffer.alloc(250_000, "x")}*/\n`;
      for (let i = 0; i < 24; i++) files[`src/${i}.js`] = text;
      const run = async (threads: string) => {
        const { stderr, exitCode } = await lint(files, ["--threads", threads, "src"]);
        return { file: /^Occurred while linting .*[\\/](\d+\.js):1$/m.exec(stderr)?.[1], exitCode };
      };
      for (const it of await Promise.all(["1", "4", "8", "8"].map(run))) {
        expect(it).toEqual({ file: "17.js", exitCode: 2 });
      }
    },
    timeout,
  );

  test.skipIf(!isLinux)(
    "a rule that never returns doesn't keep bun lint alive once it's killed",
    async () => {
      using dir = tempDir("bun-lint-js-plugins", {
        "eslint.config.mjs": `
          import own from "./plugin.mjs";
          export default [{ plugins: { own }, rules: { "own/spins": "error" } }];`,
        "plugin.mjs": `export default { rules: { spins: { create: () => ({
          Program() { console.error("spinning"); for (;;); },
        }) } } };`,
        "a.js": "1;\n",
      });
      await using proc = spawn({
        cmd: [bunExe(), "lint", "--threads", "2", "a.js"],
        env,
        cwd: String(dir),
        stdin: "ignore",
        stdout: "ignore",
        stderr: "pipe",
      });
      const reader = proc.stderr.getReader();
      let said = "";
      while (!said.includes("spinning")) {
        const { value, done } = await reader.read();
        if (done) break;
        said += new TextDecoder().decode(value);
      }
      expect(said).toContain("spinning");
      proc.kill("SIGTERM");
      await proc.exited;
      expect(proc.signalCode).toBe("SIGTERM");
    },
    timeout,
  );
});

describe.concurrent("tokens and comments in JavaScript plugins", () => {
  const oracle = join(import.meta.dir, "oracle", "jsplugins", "tokens");
  const dump = readFileSync(join(oracle, "dump.cjs"), "utf8");
  // Recorded with ESLint 10.12.0, @typescript-eslint/parser 8.71.1 and oxlint 1.87.0 by record.mjs in that directory.
  const expected: Record<"eslint" | "oxlint", Record<string, string>> = JSON.parse(
    Buffer.from(Bun.zstdDecompressSync(readFileSync(join(oracle, "expected.json.zst")))).toString(),
  );
  const sources = Object.fromEntries(tokenCases.map(it => [tokenFileOf(it), it.code]));
  const sectionsOf = (message: string | undefined, wanted: RegExp) =>
    message?.split("\n").filter(line => wanted.test(line));

  test(
    "every method with every form of options, and the objects, match ESLint",
    async () => {
      const config = `const tokens = require("./dump.cjs");
        module.exports = [
          { ignores: ["*.cjs"] },
          { plugins: { tokens }, rules: { "tokens/all": "error" } },
          ...["module", "script"].map(sourceType => ({
            files: [sourceType + "/*.js"],
            languageOptions: { sourceType, parserOptions: { ecmaFeatures: { jsx: true } } },
          })),
          { files: ["*.ts", "*.tsx"], languageOptions: { parser: { meta: { name: "typescript-eslint/parser" } } } },
        ];`;
      const { raw, exitCode } = await lint({ "dump.cjs": dump, "eslint.config.cjs": config, ...sources }, [
        "-f",
        "json",
      ]);
      const results: { filePath: string; messages: { message: string }[] }[] = JSON.parse(raw);
      // Left out: methods that ESLint 10 doesn't have any more.
      const wanted = /^(?:[BDNE]:|L:(?:program|store|shape|parts|lists) )/;
      for (const it of tokenCases) {
        const file = `/${tokenFileOf(it)}`;
        const messages = results.find(result => result.filePath.replaceAll("\\", "/").endsWith(file))?.messages;
        expect({ name: it.name, sections: messages?.map(message => sectionsOf(message.message, wanted)) }).toEqual({
          name: it.name,
          sections: [sectionsOf(expected.eslint[it.name], wanted)],
        });
      }
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "the objects match oxlint with its configuration",
    async () => {
      const config = { ignorePatterns: ["dump.cjs"], jsPlugins: ["./dump.cjs"], rules: { "tokens/all": "error" } };
      const { raw, exitCode } = await lint({ "dump.cjs": dump, ".oxlintrc.json": oxlintrc(config), ...sources }, [
        "-f",
        "json",
      ]);
      const diagnostics: { filename: string; message: string }[] = JSON.parse(raw).diagnostics;
      // oxlint has other values or types for a few tokens in these two.
      for (const it of tokenCases.filter(it => it.name !== "escapes.ts" && it.name !== "jsx-names")) {
        const found = diagnostics.filter(diagnostic => diagnostic.filename.replaceAll("\\", "/") === tokenFileOf(it));
        expect({
          name: it.name,
          sections: found.map(it => sectionsOf(it.message, /^L:(?:program|shape|parts|lists) /)),
        }).toEqual({
          name: it.name,
          sections: [expected.oxlint[it.name].split("\n")],
        });
      }
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "odd arguments, receivers and filters do what they do in ESLint",
    async () => {
      const plugin = `
        const show = value =>
          Array.isArray(value) ? "[" + value.map(show).join(" ") + "]" : value !== null && typeof value === "object" ? value.value : String(value);
        const say = call => {
          try {
            return show(call());
          } catch (error) {
            return error.constructor.name + ": " + error.message;
          }
        };
        const fail = () => {
          throw new RangeError("thrown on purpose");
        };
        module.exports = { meta: { name: "odd" }, rules: { all: { create(context) {
          const { sourceCode } = context;
          return { Program(node) {
            const [first, second] = node.body;
            let calls = 0;
            const lines = {
              inherited: say(() => Object.create(sourceCode).getLastToken(first)),
              proxy: say(() => new Proxy(sourceCode, {}).getTokenAfter(first)),
              "node proxy": say(() => sourceCode.getFirstToken(new Proxy(second, {}))),
              "node inherited": say(() => sourceCode.getFirstToken(Object.create(second))),
              "only a range": say(() => sourceCode.getTokens({ range: first.range })),
              "typed array": say(() => sourceCode.getTokens({ range: new Uint32Array(first.range) })),
              "no node": say(() => sourceCode.getFirstToken()),
              null: say(() => sourceCode.getTokenBefore(null)),
              "no range": say(() => sourceCode.getTokenAfter({})),
              "no right": say(() => sourceCode.getFirstTokenBetween(first)),
              "range getter throws": say(() => sourceCode.getLastToken({ get range() { return fail(); } })),
              "location throws": say(() => sourceCode.getLastToken({ range: [0, { valueOf: fail }] })),
              "options getter throws": say(() => sourceCode.getLastToken(first, { get skip() { return fail(); } })),
              "filter throws": say(() => sourceCode.getFirstToken(first, fail)),
              "filter throws later": say(() => sourceCode.getTokens(node, () => (++calls === 3 ? fail() : true))),
              "after that": say(() => sourceCode.getTokens(first)),
              "filter calls back": say(() => sourceCode.getFirstTokens(first, { filter: token =>
                sourceCode.getTokenAfter(token, { filter: it => it.value === ";" }) !== null && sourceCode.getTokens(node).length > 0 })),
              "filter reports": say(() => sourceCode.getFirstToken(second, token => {
                context.report({ node: token, message: "from a filter: " + token.value });
                return true;
              })),
              "filter is a class": say(() => sourceCode.getFirstToken(first, class {})),
              "filter is a number": say(() => sourceCode.getFirstToken(first, { filter: 1 })),
              "negative skip": say(() => sourceCode.getFirstToken(first, -1)),
              "negative count": say(() => sourceCode.getFirstTokens(first, -1)),
              "skip is an object": say(() => sourceCode.getFirstToken(first, { skip: { valueOf: () => 1 } })),
              "skip is a symbol": say(() => sourceCode.getFirstToken(first, { skip: Symbol.iterator })),
              "huge skip": say(() => sourceCode.getFirstToken(first, 2 ** 31 - 1)),
              "huge count": say(() => sourceCode.getFirstTokens(first, 2 ** 31 - 1)),
              "huge padding": say(() => sourceCode.getTokens(second, 2 ** 31 - 1, 2 ** 31 - 1)),
              "far away": say(() => sourceCode.getTokenAfter({ range: [2 ** 40, 2 ** 40] })),
              "not a number": say(() => sourceCode.getTokens({ range: [NaN, NaN] })),
              same: String(sourceCode.getFirstToken(first) === node.tokens[0] && node.tokens === node.tokens &&
                sourceCode.getAllComments() === node.comments && sourceCode.getFirstToken(first).loc === node.tokens[0].loc),
              fresh: String(sourceCode.getTokens(node) !== sourceCode.getTokens(node)),
            };
            context.report({ node, message: Object.entries(lines).map(([name, line]) => name + ": " + line).join("\\n") });
          } };
        } } } };`;
      const config = `const odd = require("./plugin.cjs");
        module.exports = [{ plugins: { odd }, rules: { "odd/all": "error" } }];`;
      const files = { "plugin.cjs": plugin, "eslint.config.cjs": config, "a.js": "a = b; // c\nd(e);\n" };
      const { raw, exitCode } = await lint(files, ["-f", "json", "a.js"]);
      const [{ messages }]: { messages: { message: string }[] }[] = JSON.parse(raw);
      // What ESLint 10.12.0 reports when Bun runs it.
      expect(messages.map(it => it.message.split("\n"))).toEqual([
        [
          "inherited: ;",
          "proxy: d",
          "node proxy: d",
          "node inherited: d",
          "only a range: [a = b ;]",
          "typed array: [a = b ;]",
          "no node: TypeError: undefined is not an object (evaluating 'node.range')",
          "null: TypeError: null is not an object (evaluating 'node.range')",
          "no range: TypeError: undefined is not an object (evaluating 'node.range[1]')",
          "no right: TypeError: undefined is not an object (evaluating 'right.range')",
          "range getter throws: RangeError: thrown on purpose",
          "location throws: RangeError: thrown on purpose",
          "options getter throws: RangeError: thrown on purpose",
          "filter throws: RangeError: thrown on purpose",
          "filter throws later: RangeError: thrown on purpose",
          "after that: [a = b ;]",
          "filter calls back: [a = b ;]",
          "filter reports: d",
          "filter is a class: TypeError: Cannot call a class constructor without |new|",
          "filter is a number: Error: options.filter should be a function.",
          "negative skip: Error: options.skip should be zero or a positive integer.",
          "negative count: Error: options.count should be zero or a positive integer.",
          "skip is an object: =",
          "skip is a symbol: TypeError: Cannot convert a symbol to a number",
          "huge skip: null",
          "huge count: [a = b ;]",
          "huge padding: [a = b ; d ( e ) ;]",
          "far away: null",
          "not a number: []",
          "same: true",
          "fresh: true",
        ],
        ["from a filter: d"],
      ]);
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "the methods work without a receiver, and throw once the file is done",
    async () => {
      const plugin = `
        const { writeFileSync } = require("node:fs");
        const say = call => {
          try {
            return String(call()?.value);
          } catch (error) {
            return error.constructor.name + ": " + error.message;
          }
        };
        let earlier;
        module.exports = { meta: { name: "late" }, rules: { all: { create(context) {
          const { sourceCode } = context;
          return { Program(node) {
            const { getFirstToken, getTokenAfter } = sourceCode;
            const token = getFirstToken(node);
            // What is kept from an earlier file answers about this one.
            const lines = [token.value, getTokenAfter(token).value, say(() => earlier?.sourceCode.getFirstToken(earlier.node))];
            earlier ??= { sourceCode, node };
            context.report({ node, message: lines.join(" ") });
            queueMicrotask(() => writeFileSync("late.txt", [
              say(() => sourceCode.getFirstToken(node)),
              say(() => sourceCode.getAllComments()[0]),
              say(() => node.tokens[0]),
              token.value,
            ].join("\\n")));
          } };
        } } } };`;
      const config = `const late = require("./plugin.cjs");
        module.exports = [{ plugins: { late }, rules: { "late/all": "error" } }];`;
      const sources = { "a.js": "a + 1;\n", "b.js": "b - 2;\n" };
      const { raw, files, exitCode } = await lint(
        { "plugin.cjs": plugin, "eslint.config.cjs": config, ...sources },
        ["-f", "json", "--threads", "1", "a.js", "b.js"],
        ["late.txt"],
      );
      const results: { messages: { message: string }[] }[] = JSON.parse(raw);
      expect(results.map(result => result.messages.map(it => it.message))).toEqual([["a + undefined"], ["b - b"]]);
      expect(files["late.txt"].split("\n")).toEqual([
        "TypeError: No file is being linted",
        "TypeError: No file is being linted",
        "TypeError: No file is being linted",
        "b",
      ]);
      expect(exitCode).toBe(1);
    },
    timeout,
  );
});
