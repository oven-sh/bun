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
  using dir = tempDir("bun-lint-js-plugins", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "lint", ...(args.includes("--threads") ? [] : ["--threads", "2"]), ...args],
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
  test("jsPlugins of an .oxlintrc.json: messages, data, options with the defaults of the schema", async () => {
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
      "<dir>/a.js:1:1: No foo in a CallExpression. [Error/demo/no-foo]
      <dir>/a.js:2:19: No foo in a MemberExpression. [Error/demo/no-foo]
      <dir>/a.js:2:23: No foo in a MemberExpression. [Error/demo/no-foo]
      <dir>/b.ts:1:10: No foo in a TSTypeReference! [Warning/demo/no-foo]
      <dir>/b.ts:1:21: No foo in a TSTypeReference! [Warning/demo/no-foo]

      5 problems"
    `);
    expect(exitCode).toBe(1);
  }, timeout);

  test("--fix applies the fixes of a rule, also behind characters that are not ASCII", async () => {
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
  }, timeout);

  test("comments disable and configure a rule of a plugin", async () => {
    const { stdout, exitCode } = await lint(
      {
        ".oxlintrc.json": oxlintrc({ jsPlugins: ["./plugin.mjs"], rules: { "demo/no-foo": "error" } }),
        "plugin.mjs": noFoo,
        "a.js": "foo; // oxlint-disable-line demo/no-foo\n// eslint-disable-next-line demo/no-foo\nfoo;\nfoo;\n",
      },
      ["-f", "unix"],
    );
    expect(stdout).toMatchInlineSnapshot(`
      "<dir>/a.js:4:1: No foo in a ExpressionStatement. [Error/demo/no-foo]

      1 problem"
    `);
    expect(exitCode).toBe(1);
  }, timeout);

  test("selectors, :exit and the order of the listeners", async () => {
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
      "<dir>/a.js:1:1: *@0 *@0 *@0 call@0 a()@0 *@0 child@0 leaf:exit@0 *@2 call@2 *@2 child@2 leaf:exit@2 *@4 leaf:exit@4 call:exit@2 call:exit@0 [Error/order/trace]

      1 problem"
    `);
  }, timeout);

  test("tokens, comments, scopes and locations", async () => {
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
        ".oxlintrc.json": oxlintrc({ env: { node: true }, jsPlugins: ["./plugin.mjs"], rules: { "api/dump": "error" } }),
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
  }, timeout);

  test("a variable that a rule marks as used is used for no-unused-vars", async () => {
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
        ".oxlintrc.json": oxlintrc({ jsPlugins: ["./plugin.mjs"], rules: { "marks/used": "error", "no-unused-vars": "error" } }),
        "plugin.mjs": plugin,
        "a.js": "const a = 1;\nconst b = 2;\n",
      },
      ["-f", "unix"],
    );
    expect(stdout).toContain("'b' is assigned a value but never used");
    expect(stdout).not.toContain("'a' is assigned");
  }, timeout);

  test("createOnce, before and after of oxlint's API", async () => {
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
      "<dir>/a.js:1:1: 1 identifiers, created 1 time [Error/once/count]
      <dir>/b.js:1:1: 2 identifiers, created 1 time [Error/once/count]

      2 problems"
    `);
  }, timeout);

  test("a plugin in TypeScript, one from a package, one with an alias", async () => {
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
      "<dir>/a.js:1:1: typescript [Error/local/a]
      <dir>/a.js:1:1: package [Error/packaged/b]
      <dir>/a.js:1:1: alias [Error/other/c]

      3 problems"
    `);
  }, timeout);

  test("options that the schema refuses, and a rule that does not exist", async () => {
    const files = { "plugin.mjs": noFoo, "a.js": "1;\n" };
    const wrongOptions = await lint(
      {
        ...files,
        ".oxlintrc.json": oxlintrc({ jsPlugins: ["./plugin.mjs"], rules: { "demo/no-foo": ["error", { nope: 1 }] } }),
      },
      [],
    );
    expect(wrongOptions.stderr).toContain("demo/no-foo");
    expect(wrongOptions.stderr).toContain("nope");
    expect(wrongOptions.exitCode).toBe(2);
    const unknown = await lint(
      { ...files, ".oxlintrc.json": oxlintrc({ jsPlugins: ["./plugin.mjs"], rules: { "demo/nope": "error" } }) },
      [],
    );
    expect(unknown.stderr).toContain("Rule 'nope' not found in plugin 'demo'");
    expect(unknown.exitCode).toBe(2);
  }, timeout);

  test("a rule that throws is reported for the file, and the other files are linted", async () => {
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
      ["-f", "unix"],
    );
    expect(stdout).toContain("It went wrong.");
    expect(stdout).toContain("<dir>/a.js:1:1: fine [Error/throws/sometimes]");
    expect(stdout).toContain("<dir>/c.js:1:1: fine [Error/throws/sometimes]");
    expect(exitCode).toBe(1);
  }, timeout);

  test("more files than threads: every file gets its reports, and nothing else is said", async () => {
    const files: Record<string, string> = {
      ".oxlintrc.json": oxlintrc({ jsPlugins: ["./plugin.mjs"], rules: { "demo/no-foo": "error" } }),
      "plugin.mjs": noFoo,
    };
    // The file number `i` has `i % 5` of them.
    for (let i = 0; i < 300; i++) files[`src/${i}.ts`] = `export const x: number = ${i};\n` + "foo();\n".repeat(i % 5);
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
  }, timeout);

  test("plugins of an eslint.config.js: imported, and defined in the file", async () => {
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
  }, timeout);
});
