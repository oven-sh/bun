import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, normalizeBunSnapshot, tempDir } from "harness";
import { readFileSync } from "node:fs";
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

async function lint(files: Record<string, string>, args: string[], reads: string[] = []) {
  using dir = tempDir("bun-lint-js-plugins", files);
  await using proc = spawn({
    cmd: [bunExe(), "lint", ...(args.includes("--threads") ? [] : ["--threads", "2"]), ...args],
    env,
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
        const text = "foo;\n" + Buffer.alloc(size, "// comment\n").toString();
        for (let i = 0; i < count; i++) files[`src/${i}.${extension}`] = text;
        const { stdout, stderr, exitCode } = await lint(files, ["-f", "unix", "--timing", "--threads", threads, "src"]);
        expect(exitCode).toBe(1);
        return { stdout, engines: Number(/JavaScript: (\d+) engines/.exec(stderr)?.[1]) };
      };
      // 24 files of 250 KB are 6 MB, which three engines are for.
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
  test(
    "a rule parses a text of its own with languageOptions.parser, which is loaded when it is called",
    async () => {
      const { stdout, exitCode } = await lint(
        {
          "eslint.config.mjs": `
          import own from "./plugin.mjs";
          import parser from "./parser.cjs";
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
});
