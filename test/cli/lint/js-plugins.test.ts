import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, normalizeBunSnapshot, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
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

async function lint(
  files: Record<string, string>,
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

  test(
    "a variable that a rule marks as used is used for no-unused-vars",
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
        .filter(it => it.startsWith("note: "));
    const advice = `remove it from "jsPlugins" and add "node" to "plugins".`;

    test(
      "a package, with its version",
      async () => {
        const jsPlugins = ["eslint-plugin-n"];
        expect(await notes(packaged("17.16.2"), { jsPlugins, rules })).toEqual([
          `note: 1 rule of "n" ran in JavaScript (eslint-plugin-n 17.16.2, from "jsPlugins"). bun lint has it built in, as of 18.4.1: ${advice} Reports may differ.`,
        ]);
        expect(await notes(packaged("18.4.9"), { jsPlugins, rules }, "-f", "stylish")).toEqual([
          `note: 1 rule of "n" ran in JavaScript (eslint-plugin-n 18.4.9, from "jsPlugins"). bun lint has it built in, as of 18.4.1: ${advice}`,
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
          `note: 2 rules of "n" ran in JavaScript (./n.js, from "jsPlugins"). bun lint has them built in, as of 18.4.1: write them "node/.." and add "node" to "plugins". Keep it for the other 1. Reports may differ.`,
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
      expect(stderr).toMatch(/JavaScript: [12] engines, which have loaded [12] modules, /);
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
      expect(stderr).toContain(`with the whole configuration file, which alone has the plugin "inline"`);
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
      expect(stderr).toContain(`with the whole configuration file, which alone has what is in "settings"`);
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
            Atomics.wait(state.flag, 0, before);
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
            Atomics.wait(state.flag, 0, before);
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
        stderr: "ignore",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect(stdout.split("\n").filter(it => it.endsWith(": 5 [Error/demo/length]"))).toHaveLength(128);
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "there are as many engines as pay, with types and without, and they report the same",
    async () => {
      const run = async (count: number, extension: string, size: number, threads: string) => {
        const files: Record<string, string> = {
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
          "plugin.mjs": `export default { rules: { seen: { create: context => ({ Program(node) { context.report({ node, message: "seen" }); } }) } } };`,
        };
        // One comment: thousands of them take a debug build minutes.
        const text = `foo;\n/*${Buffer.alloc(size, "x")}*/\n`;
        for (let i = 0; i < count; i++) files[`src/${i}.${extension}`] = text;
        const { stdout, stderr, exitCode } = await lint(files, ["-f", "unix", "--timing", "--threads", threads, "src"]);
        expect(exitCode).toBe(1);
        return { stdout, engines: Number(/JavaScript: (\d+) engines/.exec(stderr)?.[1]) };
      };
      // 24 files of 250 KB, which are not heavy yet, are 6 MB, which three engines are for.
      const [smallWithTypes, small, oneWithTypes, one, largeWithTypes, large] = await Promise.all([
        run(24, "ts", 0, "8"),
        run(24, "js", 0, "8"),
        run(24, "ts", 250_000, "1"),
        run(24, "js", 250_000, "1"),
        run(24, "ts", 250_000, "8"),
        run(24, "js", 250_000, "8"),
      ]);
      expect([smallWithTypes.engines, small.engines, oneWithTypes.engines, one.engines]).toEqual([1, 1, 1, 1]);
      // A thread only asks for an engine while the others are in use.
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
        "2 rules in JavaScript did not run, only the built-in rules have types: typed/at-once, typed/later",
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
      expect(stderr).toContain("JavaScript: 1 engines, which have loaded 1 modules");
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
      expect(stdout + stderr).toContain("./plugin.mjs\n  A promise is not settled, and nothing is left to wait for.");
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
    "without rules in JavaScript there is no engine",
    async () => {
      const { stderr, exitCode } = await lint(
        { "eslint.config.mjs": `export default [{ rules: { "no-debugger": "error" } }];`, "a.js": "debugger;\n" },
        ["--timing", "a.js"],
      );
      expect(stderr).toContain("JavaScript: 0 engines, which have loaded 0 modules, 0.0 MB of source, in 0.0ms");
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
        return { seen, freed: Number(/, freed to stay in the memory: (\d+)/.exec(stderr)?.[1] ?? 0) };
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
