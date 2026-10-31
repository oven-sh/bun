import { afterAll, describe, expect, test } from "bun:test";
import { bunExe, isLinux, tempDir } from "harness";
import { mkdirSync, readFileSync, symlinkSync } from "node:fs";
import { basename, join } from "node:path";
import { endChildren, spawn } from "../children";
import { env, lint, noFoo, oxlintrc, timeout } from "./js-plugins";
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
import { cases as typeCases, linted as typeFiles } from "./oracle/jsplugins/types/cases.mjs";

afterAll(endChildren);

describe.concurrent("bun lint with JavaScript plugins", () => {
  describe("where the config turns on type information", () => {
    // `reads` is what the rule does with the type of the first argument of each `it()`.
    const typed = (reads: string, rules = "") => ({
      "tsconfig.json": `{ "compilerOptions": { "strict": true, "target": "es2022", "types": [] } }`,
      "node_modules/typescript/package.json": `{ "name": "typescript", "version": "6.0.3" }`,
      "plugin.mjs": `
        // This is what \`getParserServices\` in @typescript-eslint/utils does.
        function services(context) {
          const services = context.sourceCode.parserServices;
          if (services?.esTreeNodeToTSNodeMap == null || services.tsNodeToESTreeNodeMap == null || services.program == null) {
            throw new Error("You have used a rule which requires type information, but don't have parserOptions set to generate type information for this file. See https://tseslint.com/typed-linting for enabling linting with type information.\\nParser: (unknown)");
          }
          return services;
        }
        const reads = ${reads};
        const create = context => ({
          CallExpression(node) {
            if (node.callee.name !== "it") return;
            context.report({ node: node.arguments[0], message: String(reads(services(context), node.arguments[0])) });
          },
        });
        // Many rules use types only if there are any, or look for what another parser provides.
        const optional = context => ({
          Program(node) {
            const { program, svelteParseContext } = context.sourceCode.parserServices;
            context.report({ node, message: program + " " + svelteParseContext });
          },
        });
        const ask = () => services({ sourceCode: { parserServices: {} } });
        // Asks the second time it runs on a file, and only then.
        const runs = new Map();
        const second = context => {
          runs.set(context.filename, (runs.get(context.filename) ?? 0) + 1);
          if (runs.get(context.filename) === 2) ask();
          return {};
        };
        export default {
          rules: { title: { create }, optional: { create: optional }, second: { create: second }, always: { create: ask } },
        };`,
      "eslint.config.mjs": `
        import demo from "./plugin.mjs";
        export default [{
          files: ["**/*.ts"],
          plugins: { demo, "@typescript-eslint": { meta: { name: "@typescript-eslint/eslint-plugin" } } },
          languageOptions: { parser: { meta: { name: "typescript-eslint/parser" } }, parserOptions: { projectService: true } },
          rules: { "demo/title": "error", ${rules} },
        }];`,
    });
    const facts = `(services, node) => {
      const type = services.getTypeAtLocation(node);
      return [type.flags, type.getFlags(), type.getCallSignatures().length, type.getConstructSignatures().length].join(" ");
    }`;
    const titles = `declare function it(title: unknown): void;
class Store {}
function load(): void;
function load(from: string): void;
function load() {}
const label: string = "a";
const count = 1;
enum Color {
  Red = "red",
}
it("text");
it(\`a\${count}\`);
it(label);
it(load);
it(Store);
it(count);
it(() => {});
it(class {});
it(load.name);
it(Color.Red);
it(label as any);
it(undefined);
it({});
it(count > 0);
it(Math.random() > 0 ? label : load);
`;
    const messagesOf = (raw: string) => JSON.parse(raw)[0].messages.map((it: { message: string }) => it.message);
    // \`type.flags\` of each title, as ESLint 10.12.0 with @typescript-eslint/parser 8.72.0 reports it with these versions of
    // TypeScript. TypeScript 6 renumbered \`ts.TypeFlags\`.
    const flags = {
      "5.9.3": [128, 128, 4, 524288, 524288, 256, 524288, 524288, 4, 1152, 1, 32768, 524288, 1048592, 1048576],
      "6.0.3": [
        1024, 1024, 32, 1048576, 1048576, 2048, 1048576, 1048576, 32, 33792, 1, 4, 1048576, 134217984, 134217728,
      ],
    };
    const signatures = [
      "0 0",
      "0 0",
      "0 0",
      "2 0",
      "0 1",
      "0 0",
      "1 0",
      "0 1",
      "0 0",
      "0 0",
      "0 0",
      "0 0",
      "0 0",
      "0 0",
      "0 0",
    ];

    test.concurrent.each([
      ["5.9.3", ""],
      ["6.0.3", ""],
      // The file is linted with types from the start.
      ["6.0.3", `"@typescript-eslint/no-floating-promises": "error"`],
    ] as const)(
      "a rule gets the flags and the signatures of an expression's type: typescript %s, %s",
      async (version, rules) => {
        const files = {
          ...typed(facts, rules),
          "node_modules/typescript/package.json": JSON.stringify({ name: "typescript", version }),
          "a.ts": titles,
        };
        const { raw, exitCode } = await lint(files, ["-f", "json", "a.ts"]);
        expect(messagesOf(raw)).toEqual(flags[version].map((it, i) => `${it} ${it} ${signatures[i]}`));
        expect(exitCode).toBe(1);
      },
      timeout,
    );

    // Same as ESLint 10.12.0 with @typescript-eslint/parser 8.72.0 and TypeScript 5.9.3.
    test.concurrent(
      "a rule gets the type of what an import binds",
      async () => {
        const reads = `(services, node) => {
          return node.parent.parent.parent.body.flatMap(it => it.specifiers ?? []).map(it => {
            const type = services.getTypeAtLocation(it);
            return [it.type, type.flags, type.getCallSignatures().length, type.getConstructSignatures().length].join(" ");
          }).join(", ");
        }`;
        const files = {
          ...typed(reads),
          "node_modules/typescript/package.json": `{ "name": "typescript", "version": "5.9.3" }`,
          "lib.ts": `export function fn() {}\nexport class K {}\nexport const n = 1;\nexport default function main() {}\nexport interface I {}\n`,
          "a.ts": `import main, { K, fn, n, type I } from "./lib";\nimport * as all from "./lib";\ndeclare function it(title: unknown): void;\nit([main, K, fn, n, all, {} as I]);\n`,
        };
        const { raw, exitCode } = await lint(files, ["-f", "json", "a.ts"]);
        expect(messagesOf(raw)[0].split(", ")).toEqual([
          "ImportDefaultSpecifier 524288 1 0",
          "ImportSpecifier 524288 0 1",
          "ImportSpecifier 524288 1 0",
          "ImportSpecifier 256 0 0",
          "ImportSpecifier 1 0 0",
          "ImportNamespaceSpecifier 524288 0 0",
        ]);
        expect(exitCode).toBe(1);
      },
      timeout,
    );

    // Same as ESLint 10.12.0 with @typescript-eslint/parser 8.72.0 and TypeScript 5.9.3.
    test.concurrent(
      "a rule gets the name of a type's symbol, from the type checker",
      async () => {
        const reads = `(services, node) => {
          const type = services.program.getTypeChecker().getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(node));
          return type.getSymbol()?.name + " " + type.symbol?.getName();
        }`;
        const names = {
          "new Map<string, number>()": "Map",
          "new Set([1])": "Set",
          "new Store()": "Store",
          "Store": "Store",
          "shape": "Shape",
          "{ a: 1 }": "__object",
          "[1]": "Array",
          "load": "load",
          "() => {}": "__function",
          '"a"': undefined,
          "1": undefined,
          "Color.Red": "Red",
          "Color": "Color",
          "either": undefined,
          "Promise.resolve(1)": "Promise",
          "undefined": undefined,
          "class {}": "__class",
          "Math": "Math",
        };
        const declarations = `declare function it(title: unknown): void;
class Store {}
interface Shape { a: 1 }
enum Color { Red }
function load() {}
declare const shape: Shape;
declare const either: Shape | Store;
`;
        const calls = Object.keys(names).map(it => `it(${it});\n`);
        const { raw, exitCode } = await lint({ ...typed(reads), "a.ts": declarations + calls.join("") }, [
          "-f",
          "json",
          "a.ts",
        ]);
        expect(messagesOf(raw)).toEqual(Object.values(names).map(it => `${it} ${it}`));
        expect(exitCode).toBe(1);
      },
      timeout,
    );

    // Recorded with ESLint 10.12.0, @typescript-eslint/parser 8.72.0 and TypeScript 5.9.3 by record.mjs in that directory.
    test.concurrent(
      "a rule gets the type of every kind of node",
      async () => {
        const oracle = join(import.meta.dir, "oracle", "jsplugins", "types");
        const expected = readFileSync(join(oracle, "expected.txt"), "utf8").trim().split("\n");
        const files = {
          ...typeCases,
          "node_modules/typescript/package.json": `{ "name": "typescript", "version": "5.9.3" }`,
          "ask.cjs": readFileSync(join(oracle, "ask.cjs"), "utf8"),
          "eslint.config.cjs": `module.exports = [{
            files: ["**/*.ts", "**/*.tsx"],
            plugins: { ask: require("./ask.cjs") },
            languageOptions: { parser: { meta: { name: "typescript-eslint/parser" } }, parserOptions: { projectService: true } },
            rules: { "ask/all": "error" },
          }];`,
        };
        const { raw, stderr, exitCode } = await lint(files, ["-f", "json", ...typeFiles]);
        type Message = { line: number; column: number; endLine: number; endColumn: number; message: string };
        const results: { filePath: string; messages: Message[] }[] = JSON.parse(raw);
        const said = results.flatMap(({ filePath, messages }) =>
          messages.map(
            it => `${basename(filePath)} ${it.line}:${it.column}-${it.endLine}:${it.endColumn} ${it.message}`,
          ),
        );
        const isRefused = (line: string) => line.endsWith(": refused");
        expect(said.map((line, i) => (isRefused(line) ? expected[i] : line))).toEqual(expected);
        // In this order: the `x = 1` of `({ x = 1 } = y)`, the function of `({ set a(v) {} })`, the `A` and the `B` of
        // `implements A.B.C`, the `import` of `import.meta`, the `a` of `<a:b />`, the `A.B` of `implements A.B.C`, the file, the
        // `set a(v) {}` of `({ set a(v) {} })`, the `import()` of `typeof import()`, the `A.B` of the type `A.B.C`, the `symbol` of
        // `unique symbol`, the `<T>` of `class A extends B<T>`, the `-1` of the type `-1`.
        const kinds = said
          .filter(isRefused)
          .map(it => it.slice(it.indexOf(" ", it.indexOf(" ") + 1) + 1, -": refused".length));
        expect([...new Set(kinds)].sort()).toEqual([
          "AssignmentPattern",
          "FunctionExpression",
          "Identifier in MemberExpression.object",
          "Identifier in MemberExpression.property",
          "Identifier in MetaProperty.meta",
          "JSXIdentifier in JSXNamespacedName.namespace",
          "MemberExpression",
          "Program",
          "Property",
          "TSImportType",
          "TSQualifiedName",
          "TSSymbolKeyword",
          "TSTypeParameterInstantiation",
          "UnaryExpression",
        ]);
        expect(said.filter(isRefused).length).toBe(27);
        expect(stderr).not.toContain(" did not run because");
        expect(exitCode).toBe(1);
      },
      timeout,
    );

    // `type.flags` is numbered by the `typescript` that the parser finds: with ESLint that one makes the types. Each of these is the same
    // under ESLint 10.12.0 with @typescript-eslint/parser 8.72.0, TypeScript 5.9.3 for the parser and 6.0.3 elsewhere.
    describe("the flags are those of the parser's typescript", () => {
      const version = (version: string) => JSON.stringify({ name: "typescript", version });
      const store = "node_modules/.pnpm/@typescript-eslint+parser@8.72.0_typescript@5.9.3/node_modules";
      const parser = {
        [`${store}/@typescript-eslint/parser/package.json`]: `{ "name": "@typescript-eslint/parser", "version": "8.72.0", "main": "index.js" }`,
        [`${store}/@typescript-eslint/parser/index.js`]: `module.exports = { meta: { name: "typescript-eslint/parser", version: "8.72.0" } };`,
        [`${store}/typescript/package.json`]: version("5.9.3"),
      };
      const withParser = (files: Record<string, string>) => ({
        ...files,
        ...parser,
        "eslint.config.mjs": `import parser from "@typescript-eslint/parser";\n${files["eslint.config.mjs"].replace(`parser: { meta: { name: "typescript-eslint/parser" } }`, "parser")}`,
        "a.ts": `declare function it(title: unknown): void;\nit("a");\n`,
      });
      const run = async (files: Record<string, string | undefined>) => {
        using dir = tempDir(
          "bun-lint-js-plugins",
          Object.fromEntries(Object.entries(files).filter(it => it[1] !== undefined)),
        );
        mkdirSync(join(String(dir), "node_modules/@typescript-eslint"), { recursive: true });
        // As pnpm links it.
        symlinkSync(
          join(String(dir), store, "@typescript-eslint/parser"),
          join(String(dir), "node_modules/@typescript-eslint/parser"),
          "junction",
        );
        await using proc = spawn({
          cmd: [bunExe(), "lint", "-f", "json", "a.ts"],
          env,
          cwd: String(dir),
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        return { messages: messagesOf(stdout), stderr, exitCode };
      };
      const flagsOf = "(services, node) => services.getTypeAtLocation(node).flags";

      test.concurrent(
        "which only the parser finds",
        async () => {
          const files = { ...withParser(typed(flagsOf)), "node_modules/typescript/package.json": undefined };
          expect(await run(files)).toMatchObject({ messages: ["128"], exitCode: 1 });
        },
        timeout,
      );

      test.concurrent(
        "and not of the one in the project's node_modules",
        async () => {
          expect(await run(withParser(typed(flagsOf)))).toMatchObject({ messages: ["128"], exitCode: 1 });
        },
        timeout,
      );

      test.concurrent(
        "and not of the one that the plugin finds",
        async () => {
          const {
            "plugin.mjs": plugin,
            "node_modules/typescript/package.json": _,
            ...files
          } = withParser(typed(flagsOf));
          const moved = {
            ...files,
            "eslint.config.mjs": files["eslint.config.mjs"].replace("./plugin.mjs", "./plugins/plugin.mjs"),
            "plugins/plugin.mjs": plugin,
            "plugins/node_modules/typescript/package.json": version("6.0.3"),
          };
          expect(await run(moved)).toMatchObject({ messages: ["128"], exitCode: 1 });
        },
        timeout,
      );
    });

    test.concurrent(
      "without a typescript, a rule that reads the flags is skipped, and another one runs",
      async () => {
        const { "node_modules/typescript/package.json": _, ...files } = typed(
          "(services, node) => services.getTypeAtLocation(node).flags",
        );
        const source = { "a.ts": `declare function it(title: unknown): void;\nit(it);\n` };
        const { raw, stderr, exitCode } = await lint({ ...files, ...source }, ["-f", "json", "a.ts"]);
        expect(messagesOf(raw)).toEqual([]);
        expect(stderr).toContain(
          "1 rule did not run in 1 file because rules that run in JavaScript cannot read this from a type: demo/title (Type.flags without typescript)",
        );
        expect(exitCode).toBe(2);
        const { "node_modules/typescript/package.json": __, ...others } = typed(
          "(services, node) => services.getTypeAtLocation(node).getCallSignatures().length",
        );
        const other = await lint({ ...others, ...source }, ["-f", "json", "a.ts"]);
        expect(messagesOf(other.raw)).toEqual(["1"]);
        expect(other.exitCode).toBe(1);
      },
      timeout,
    );

    // Types are found for the kinds of node that rules have wanted the type of before. For a new kind, the rules run again.
    test.concurrent.each([
      ["", "services.getTypeAtLocation(node.parent).flags"],
      [
        " and catches what's thrown",
        `(() => { try { return services.getTypeAtLocation(node.parent).flags; } catch { return "caught"; } })()`,
      ],
    ])(
      "a rule gets a type that it only wants once it has seen another one%s",
      async (_, then) => {
        const reads = `(services, node) => services.getTypeAtLocation(node).getCallSignatures().length > 0 ? ${then} : "none"`;
        const files = { ...typed(reads), "a.ts": `declare function it(title: unknown): void;\nit(it);\nit(1);\n` };
        const { raw, stderr, exitCode } = await lint(files, ["-f", "json", "a.ts"]);
        // `void`
        expect(messagesOf(raw)).toEqual(["16", "none"]);
        expect(stderr).not.toContain(" did not run ");
        expect(exitCode).toBe(1);
      },
      timeout,
    );

    // Same as ESLint 10.12.0 with @typescript-eslint/parser 8.72.0 and TypeScript 5.9.3, whose numbers are 4 and 1048576.
    test.concurrent(
      "a file that a project and one that it references both include has the types of the referenced one",
      async () => {
        const options = { strict: true, target: "es2022", types: [] };
        const text = `declare function it(title: unknown): void;\nconst list: string[] = [];\nit(list[0]);\nexport {};\n`;
        const { raw, exitCode } = await lint(
          {
            ...typed("(services, node) => services.getTypeAtLocation(node).flags"),
            "tsconfig.json": JSON.stringify({
              compilerOptions: { ...options, noUncheckedIndexedAccess: true },
              include: ["src"],
              references: [{ path: "./tsconfig.cli.json" }],
            }),
            "tsconfig.cli.json": JSON.stringify({
              compilerOptions: { ...options, composite: true },
              include: ["src/cli"],
            }),
            "src/cli/a.ts": text,
            "src/web/b.ts": text,
          },
          ["-f", "json", "src"],
        );
        const said = JSON.parse(raw).map((it: { messages: { message: string }[] }) =>
          it.messages.map(it => it.message),
        );
        // `string`, and `string | undefined`.
        expect(said).toEqual([["32"], ["134217728"]]);
        expect(exitCode).toBe(1);
      },
      timeout,
    );

    test.concurrent(
      "a rule that hasn't asked for types gets the same as without them",
      async () => {
        const files = {
          ...typed(facts, `"demo/optional": "error"`),
          "a.ts": `declare function it(title: unknown): void;\nit(it);\n`,
        };
        const { raw, exitCode } = await lint(files, ["-f", "json", "a.ts"]);
        expect(messagesOf(raw)).toEqual(["null undefined", "1048576 1048576 1 0"]);
        expect(exitCode).toBe(1);
      },
      timeout,
    );

    const twenty = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [`${i}.ts`, `declare function it(title: unknown): void;\nit(it);\n`]),
    );
    const withTypes = (stderr: string) => Number(/linted with types: (\d+) files/.exec(stderr)?.[1]);

    test.concurrent(
      "only the files on which a rule can use types are type checked",
      async () => {
        const [usable, unusable, never] = await Promise.all([
          lint({ ...typed(facts), ...twenty }, ["-f", "unix", "--timing", "."]),
          lint({ ...typed("services => services.program.getCompilerOptions()"), ...twenty }, [
            "-f",
            "unix",
            "--timing",
            ".",
          ]),
          lint({ ...typed(facts, `"demo/title": "off", "demo/optional": "warn"`), ...twenty }, [
            "--quiet",
            "--timing",
            ".",
          ]),
        ]);
        expect({
          files: withTypes(usable.stderr),
          problems: usable.stdout.split("\n").at(-1),
          exitCode: usable.exitCode,
        }).toEqual({
          files: 20,
          problems: "20 problems",
          exitCode: 1,
        });
        expect(unusable.stdout).toBe("");
        expect(unusable.stderr).toContain("demo/title (Program.getCompilerOptions)");
        expect({ files: withTypes(unusable.stderr), exitCode: unusable.exitCode }).toEqual({ files: 0, exitCode: 2 });
        expect({ files: withTypes(never.stderr), exitCode: never.exitCode }).toEqual({ files: 0, exitCode: 0 });
      },
      timeout,
    );

    test.concurrent(
      "a file whose `parserServices` aren't typescript-eslint's isn't type checked for a rule",
      async () => {
        const files = typed(facts);
        const espree = files["eslint.config.mjs"]
          .replace(`files: ["**/*.ts"]`, `files: ["**/*.js"]`)
          .replace(`parser: { meta: { name: "typescript-eslint/parser" } }, `, "");
        const { stderr, exitCode } = await lint(
          {
            ...files,
            "eslint.config.mjs": espree,
            "tsconfig.json": `{ "compilerOptions": { "allowJs": true } }`,
            "a.js": "it(it);\n",
          },
          ["--timing", "a.js"],
        );
        expect(stderr).toContain("1 rule did not run because there is no type information for the files: demo/title");
        expect({ files: withTypes(stderr), exitCode }).toEqual({ files: 0, exitCode: 2 });
      },
      timeout,
    );

    // Each of these is linted a fixed number of times, whatever its rules do.
    describe.each([
      ["in the config", "--fix-dry-run"],
      // The first is the same as under ESLint 10.12.0 with @typescript-eslint/parser 8.72.0.
      ["in a comment", "--stdin"],
      ["in a `files` block", "--fix-dry-run"],
      ["on the command line", "--stdin"],
    ] as const)("a rule that's turned on %s", (place, flag) => {
      const noTypes = "1 rule did not run because there is no type information for the files: ";
      const notKnown =
        "1 rule did not run in 1 file because rules that run in JavaScript cannot read this from a type: ";
      test.concurrent.each([
        ["gets types", facts, `"demo/title": "error"`, "a.ts", ["1024 1024 0 0"], ""],
        ["gets none under espree", facts, `"demo/title": "error"`, "a.js", [], noTypes + "demo/title"],
        [
          "reads what isn't known",
          "services => services.program.getCompilerOptions()",
          `"demo/title": "error"`,
          "a.ts",
          [],
          notKnown + "demo/title (Program.getCompilerOptions)",
        ],
        [
          "asks on its second run",
          facts,
          `"demo/title": "error", "demo/second": "error"`,
          "a.ts",
          ["1024 1024 0 0"],
          "",
        ],
        [
          "asks on every run",
          facts,
          `"demo/title": "error", "demo/always": "error"`,
          "a.ts",
          ["1024 1024 0 0"],
          noTypes + "demo/always",
        ],
      ])(
        "and %s",
        async (_, reads, rules, name, messages, refusal) => {
          const files = typed(reads, `"no-var": "error"`);
          const config = files["eslint.config.mjs"]
            .replace(`files: ["**/*.ts"]`, `files: ["**/*.ts", "**/*.js"]`)
            .replace(`"demo/title": "error", `, place === "in the config" ? `${rules}, ` : "")
            .replace(/\}\];$/, place === "in a `files` block" ? `}, { files: ["a.*"], rules: { ${rules} } }];` : "}];");
          const espree = config.replace(`parser: { meta: { name: "typescript-eslint/parser" } }, `, "");
          const comment = place === "in a comment" ? `/* eslint ${rules} */\n` : "";
          const text = `${comment}globalThis.it = () => {};\nit("a");\n`;
          const all = {
            ...files,
            "eslint.config.mjs": name === "a.js" ? espree : config,
            "tsconfig.json": `{ "compilerOptions": { "allowJs": true, "types": [] } }`,
            [name]: text,
          };
          const onCommandLine = rules.split(", ").flatMap(it => ["--rule", it.replaceAll('"', "")]);
          const args = ["-f", "json", ...(place === "on the command line" ? onCommandLine : [])];
          const expectResult = ({ raw, stderr, exitCode }: { raw: string; stderr: string; exitCode: number }) => {
            expect(messagesOf(raw)).toEqual(messages);
            if (refusal) expect(stderr).toContain(refusal);
            else expect(stderr).not.toContain(" did not run ");
            expect(exitCode).toBe(refusal ? 2 : 1);
          };
          expectResult(await lint(all, [...args, name]));
          if (flag === "--fix-dry-run") return expectResult(await lint(all, [...args, flag, name]));
          using dir = tempDir("bun-lint-js-plugins", all);
          await using proc = spawn({
            cmd: [bunExe(), "lint", ...args, "--stdin", "--stdin-filename", name],
            env,
            cwd: String(dir),
            stdin: Buffer.from(text),
            stdout: "pipe",
            stderr: "pipe",
          });
          const [raw, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          expectResult({ raw, stderr, exitCode });
        },
        timeout,
      );
    });

    // ESLint 10.12.0 fails on such a block: typescript-eslint doesn't find `a.md/0_0.ts` in a project.
    test.concurrent(
      "a block that a processor finds has no types",
      async () => {
        const files = typed(facts);
        const config = files["eslint.config.mjs"].replace(
          /\}\];$/,
          `}, { files: ["**/*.md"], plugins: { blocks: { processors: { all: {
            preprocess: text => [{ text, filename: "0.ts" }],
            postprocess: lists => lists.flat(),
          } } } }, processor: "blocks/all" }];`,
        );
        const { raw, stderr, exitCode } = await lint(
          { ...files, "eslint.config.mjs": config, "a.md": `declare function it(title: unknown): void;\nit("a");\n` },
          ["-f", "json", "a.md"],
        );
        expect(messagesOf(raw)).toEqual([]);
        expect(stderr).toContain("1 rule did not run because there is no type information for the files: demo/title");
        expect(exitCode).toBe(2);
      },
      timeout,
    );

    test.concurrent(
      "text from standard input has types too",
      async () => {
        using dir = tempDir("bun-lint-js-plugins", typed(facts));
        await using proc = spawn({
          cmd: [bunExe(), "lint", "-f", "json", "--stdin", "--stdin-filename", "a.ts"],
          env,
          cwd: String(dir),
          stdin: Buffer.from(`declare function it(title: unknown): void;\nit(it);\n`),
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stderr).toBe("");
        expect(messagesOf(stdout)).toEqual(["1048576 1048576 1 0"]);
        expect(exitCode).toBe(1);
      },
      timeout,
    );

    test.concurrent(
      "the other rules' fixes are applied once",
      async () => {
        const files = {
          ...typed(facts, `"no-var": "error"`),
          "a.ts": `declare function it(title: unknown): void;\nvar a = 1;\nit(a);\n`,
        };
        const { raw, files: written, exitCode } = await lint(files, ["-f", "json", "--fix", "a.ts"], ["a.ts"]);
        expect(messagesOf(raw)).toEqual(["64 64 0 0"]);
        expect(written["a.ts"]).toBe(`declare function it(title: unknown): void;\nlet a = 1;\nit(a);\n`);
        expect(exitCode).toBe(1);
      },
      timeout,
    );

    test.concurrent.each([
      ["(services, node) => services.getTypeAtLocation(node).getProperties()", "Type.getProperties"],
      ["(services, node) => services.getTypeAtLocation(node).symbol.flags", "Symbol.flags"],
      [
        "(services, node) => services.getTypeAtLocation(node).getCallSignatures()[0].getReturnType()",
        "Signature.getReturnType",
      ],
      ["(services, node) => services.getTypeAtLocation(node.parent.parent.parent)", "getTypeAtLocation(Program)"],
      ["(services, node) => services.getSymbolAtLocation(node)", "getSymbolAtLocation(Identifier)"],
      ["(services, node) => services.program.getCompilerOptions()", "Program.getCompilerOptions"],
      [
        "(services, node) => services.program.getTypeChecker().getSymbolAtLocation(node)",
        "TypeChecker.getSymbolAtLocation",
      ],
      [
        "(services, node) => services.program.getTypeChecker().getTypeAtLocation(node)",
        "TypeChecker.getTypeAtLocation(?)",
      ],
      ["(services, node) => services.esTreeNodeToTSNodeMap.get(node).kind", "Node.kind"],
      ["(services, node) => services.tsNodeToESTreeNodeMap.get(node)", "tsNodeToESTreeNodeMap.get"],
    ])(
      "a rule that reads anything else is skipped, and the error says what it read: %s",
      async (reads, named) => {
        const files = {
          ...typed(reads, `"no-var": "error"`),
          "a.ts": `declare function it(title: unknown): void;\nit(it);\nvar a = 1;\n`,
          "b.ts": `declare function it(title: unknown): void;\nit(it);\n`,
        };
        const { stdout, stderr, exitCode } = await lint(files, ["-f", "unix", "a.ts", "b.ts"]);
        expect(stdout).toBe(`<dir>/a.ts:3:1: Unexpected var, use let or const instead. [Error/no-var]\n\n1 problem`);
        expect(stderr).toContain(
          `1 rule did not run in 2 files because rules that run in JavaScript cannot read this from a type: demo/title (${named})`,
        );
        expect(exitCode).toBe(2);
      },
      timeout,
    );

    test.concurrent(
      "a rule that reads anything else in some files is skipped in those files only, whichever file is linted first",
      async () => {
        const base = typed("undefined", `"demo/rename": "error", "demo/symbols": "error", "no-var": "error"`);
        const plugin = base["plugin.mjs"].replace(
          "rules: {",
          `rules: {
            rename: {
              meta: { fixable: "code" },
              create: context => ({
                Identifier(node) {
                  if (node.parent.type !== "VariableDeclarator" || node.name.endsWith("_")) return;
                  const type = services(context).getTypeAtLocation(node);
                  if (node.name.startsWith("odd")) type[node.name];
                  context.report({ node, message: "rename " + node.name, fix: fixer => fixer.insertTextAfter(node, "_") });
                },
              }),
            },
            symbols: { create: context => ({ ClassDeclaration: node => services(context).getSymbolAtLocation(node.id) }) },`,
        );
        const names = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}.ts`);
        const odd: Record<string, string> = { "03.ts": "oddB", "11.ts": "oddA", "20.ts": "oddB", "21.ts": "oddA" };
        const text = (name: string, keyword: string, suffix: string) =>
          `${keyword} first${suffix} = 1;\n` +
          (name in odd ? `const ${odd[name]} = first${suffix};\n` : "") +
          (name === "21.ts" || name === "22.ts" ? "class A {}\n" : "") +
          `export {};\n`;
        const files = {
          ...base,
          "plugin.mjs": plugin,
          ...Object.fromEntries(names.map(name => [name, text(name, "var", "")])),
        };
        const refusal =
          "2 rules did not run in 5 files because rules that run in JavaScript cannot read this from a type: " +
          "demo/rename (Type.oddA, Type.oddB), demo/symbols (getSymbolAtLocation(Identifier))";
        const found = names.flatMap(name => [
          `<dir>/${name}:1:1: Unexpected var, use let or const instead. [Error/no-var]`,
          ...(name in odd ? [] : [`<dir>/${name}:1:5: rename first [Error/demo/rename]`]),
        ]);
        const threads = ["--threads", "8"];
        const runs = await Promise.all(
          [1, 2, 3].flatMap(() => [
            lint(files, [...threads, "-f", "unix", "."]),
            lint(files, [...threads, "-f", "unix", "--fix", "."], names),
          ]),
        );
        for (const [at, { stdout, stderr, files: written, exitCode }] of runs.entries()) {
          const fixes = at % 2 === 1;
          expect(stdout).toBe(fixes ? "" : [...found, "", `${found.length} problems`].join("\n"));
          expect(stderr).toContain(refusal);
          if (fixes) {
            const fixed = names.map(name => [name, text(name, "let", name in odd ? "" : "_")]);
            expect(written).toEqual(Object.fromEntries(fixed));
          }
          expect(exitCode).toBe(2);
        }
      },
      timeout,
    );

    test.concurrent(
      "a file isn't linted once more for each rule that reads anything else",
      async () => {
        const ids = ["a", "b", "c", "d"];
        const base = typed("undefined", `"demo/runs": "error", ${ids.map(id => `"demo/${id}": "error"`).join(", ")}`);
        const plugin = base["plugin.mjs"].replace(
          "rules: {",
          `rules: {
            ${ids.map(id => `${id}: { create: context => ({ Program: () => services(context).program.${id} }) },`).join("\n")}
            runs: {
              create(context) {
                runs.set(context.filename, (runs.get(context.filename) ?? 0) + 1);
                return { Program: node => context.report({ node, message: String(runs.get(context.filename)) }) };
              },
            },`,
        );
        const { raw, stderr, exitCode } = await lint(
          { ...base, "plugin.mjs": plugin, "a.ts": "export {};\n", "b.ts": "export {};\n" },
          ["--threads", "1", "-f", "json", "a.ts", "b.ts"],
        );
        const counts = JSON.parse(raw).map((it: { messages: { message: string }[] }) => Number(it.messages[0].message));
        // In the first file, each rule asks for types in one run and is refused in the next. From then on: one run in which
        // all of them are refused, and one without them.
        expect(counts.sort()).toEqual([2, 9]);
        expect(stderr).toContain(
          "4 rules did not run in 2 files because rules that run in JavaScript cannot read this from a type: " +
            "demo/a (Program.a), demo/b (Program.b), demo/c (Program.c), demo/d (Program.d)",
        );
        expect(exitCode).toBe(2);
      },
      timeout,
    );
  });
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
      const messages = JSON.parse(raw).map((result: any) =>
        result.messages.map((it: any) => [it.message, it.line, it.column, it.endLine, it.endColumn, it.fix]),
      );
      expect(messages).toEqual([
        [["first", 1, 1, 4, 1, undefined]],
        [
          ["the node of a.js", 1, 1, 4, 1, undefined],
          // The text between the two insertions comes from b.js.
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

  describe("a `loc` outside the file", () => {
    const outOfRange = "RangeError: Line/column pair translates to an out of range offset";
    const noLine = (line: number) =>
      `RangeError: Line number out of range (line ${line} requested). Line numbers should be 1-based, and less than or equal to number of lines in file (5).`;
    const notIntegers = "TypeError: Expected an object with integer `line` and `column` properties";
    type Place = (number | null)[];
    // Each entry has the `loc`, then ESLint 10.12.0's `line`, `column`, `endLine` and `endColumn`, then oxlint 1.87.0's
    // line and column or the error it says the rule threw, then the same fields as for ESLint without a config, if they
    // differ.
    const locCases: Record<string, [string, Place, string, Place?]> = {
      "line-0": ["{ line: 0, column: 0 }", [0, 1], "1:1", [1, 1]],
      "line-0-column-5": ["{ line: 0, column: 5 }", [0, 6], noLine(0), [1, 1]],
      "line-0-column-100": ["{ line: 0, column: 100 }", [0, 101], noLine(0), [1, 1]],
      "line-below-0": ["{ line: -1, column: 0 }", [-1, 1], noLine(-1), [1, 1]],
      "column-below-0": ["{ line: 1, column: -1 }", [1, 0], outOfRange],
      "column-far-below-0": ["{ line: 1, column: -5 }", [1, -4], outOfRange, [1, 0]],
      "column-below-0-in-line-2": ["{ line: 2, column: -1 }", [2, 0], "1:20"],
      "both-below-0": ["{ line: -3, column: -3 }", [-3, -2], noLine(-3), [1, 1]],
      "line-after-the-last": ["{ line: 6, column: 0 }", [6, 1], "5:1"],
      "line-far-after-the-last": ["{ line: 99, column: 0 }", [99, 1], noLine(99)],
      "column-after-the-line": ["{ line: 1, column: 21 }", [1, 22], "2:2"],
      "column-after-the-file": ["{ line: 1, column: 100 }", [1, 101], outOfRange],
      "huge-column": ["{ line: 1, column: 2000000000 }", [1, 2000000001], outOfRange],
      "huge-line": ["{ line: 2000000000, column: 0 }", [2000000000, 1], noLine(2000000000)],
      "start-in-line-0": [
        "{ start: { line: 0, column: 0 }, end: { line: 1, column: 6 } }",
        [0, 1, 1, 7],
        "1:1",
        [1, 1, 1, 7],
      ],
      "end-in-line-0": ["{ start: { line: 1, column: 0 }, end: { line: 0, column: 0 } }", [1, 1, 0, 1], "1:1", [1, 1]],
      "both-in-line-0": ["{ start: { line: 0, column: 0 }, end: { line: 0, column: 0 } }", [0, 1, 0, 1], "1:1", [1, 1]],
      "end-after-the-last-line": [
        "{ start: { line: 1, column: 0 }, end: { line: 99, column: 0 } }",
        [1, 1, 99, 1],
        noLine(99),
      ],
      "end-below-0": [
        "{ start: { line: 1, column: 0 }, end: { line: -1, column: -1 } }",
        [1, 1, -1, 0],
        noLine(-1),
        [1, 1],
      ],
      "huge-end": [
        "{ start: { line: 1, column: 0 }, end: { line: 1, column: 2000000000 } }",
        [1, 1, 1, 2000000001],
        outOfRange,
      ],
      "end-before-start": [
        "{ start: { line: 2, column: 3 }, end: { line: 1, column: 0 } }",
        [2, 4, 1, 1],
        "2:4",
        [2, 4],
      ],
      "line-NaN": ["{ line: NaN, column: 0 }", [null, 1], notIntegers, [1, 1]],
      "column-NaN": ["{ line: 1, column: NaN }", [1, null], notIntegers, [1, 0]],
      "line-null": ["{ line: null, column: 2 }", [0, 3], notIntegers, [1, 1]],
      "line-true": ["{ line: true, column: true }", [1, 2], notIntegers],
      "no-column": ["{ line: 2 }", [2, null], notIntegers, [2, 0]],
      "no-line": ["{ column: 2 }", [null, 3], notIntegers, [1, 1]],
      "empty": ["{}", [null, null], notIntegers, [1, 1]],
      "a-string": [`"abc"`, [null, null], "TypeError: `loc` must be an object if provided", [1, 1]],
      "start-null": ["{ start: null, line: 2, column: 2 }", [2, 3], "TypeError: `loc.start` must be an object"],
      // ESLint also has an `endLine` and an `endColumn` here, which are null.
      "end-a-string": [
        `{ start: { line: 1, column: 2 }, end: "x" }`,
        [1, 3],
        "TypeError: `loc.end` must be an object or null/undefined",
      ],
    };
    const names = Object.keys(locCases);
    const all = names.map(name => `${name}.js`);
    const files = {
      // The rule reports at the `loc` that the file is named after.
      "plugin.mjs": `const places = { ${names.map(name => `"${name}": ${locCases[name][0]}`).join(", ")} };
        const nameOf = context => context.filename.replace(/^.*[\\\\/]/, "").replace(".js", "");
        const create = context => ({
          "Program:exit": () => context.report({ message: nameOf(context), loc: places[nameOf(context)] }),
        });
        export default { meta: { name: "demo" }, rules: { at: { create } } };`,
      ...Object.fromEntries(
        all.map(file => [file, 'export const a = 1;\nexport const b = "é😀x";\n\nexport default a;\n']),
      ),
    };
    const eslint = {
      ...files,
      "eslint.config.mjs": `import demo from "./plugin.mjs";
        export default [{ files: ["*.js"], plugins: { demo }, rules: { "demo/at": "error" } }];`,
    };
    const oxlint = {
      ...files,
      ".oxlintrc.json": oxlintrc({ jsPlugins: ["./plugin.mjs"], rules: { "demo/at": "error" } }),
    };
    const withBunfig = {
      ...files,
      "bunfig.toml": `[lint]\nplugins = ["./plugin.mjs"]\nignorePatterns = ["plugin.mjs"]\n[lint.rules]\n"demo/at" = "error"\n`,
    };
    const nameOf = (path: string) => path.replace(/^.*[\\/]/, "").replace(".js", "");
    const inJson = (raw: string) =>
      Object.fromEntries(
        JSON.parse(raw).map((result: any) => [
          nameOf(result.filePath),
          result.messages.map((it: any) =>
            [it.line, it.column, it.endLine, it.endColumn].filter(it => it !== undefined),
          ),
        ]),
      );

    test(
      "with an ESLint config, it's printed unchanged, as in ESLint",
      async () => {
        const some = ["line-0.js", "line-below-0.js", "column-far-below-0.js"];
        const [json, stylish, unix] = await Promise.all([
          lint(eslint, ["-f", "json", ...all]),
          lint(eslint, ["-f", "stylish", ...some]),
          lint(eslint, ["-f", "unix", ...some]),
        ]);
        expect(inJson(json.raw)).toEqual(Object.fromEntries(names.map(name => [name, [locCases[name][1]]])));
        expect(stylish.stdout.split("\n").filter(line => line.includes("error  "))).toEqual([
          "  1  -4  error  column-far-below-0  demo/at",
          "  0:1  error  line-0  demo/at",
          "  -1:1  error  line-below-0  demo/at",
        ]);
        expect(unix.stdout.split("\n").slice(0, 3)).toEqual([
          "<dir>/column-far-below-0.js:1:-4: column-far-below-0 [Error/demo/at]",
          "<dir>/line-0.js:0:1: line-0 [Error/demo/at]",
          "<dir>/line-below-0.js:-1:1: line-below-0 [Error/demo/at]",
        ]);
        expect(json.exitCode).toBe(1);
      },
      timeout,
    );

    test(
      "with an ESLint config, a comment doesn't disable a report located before it",
      async () => {
        const text = "/* eslint-disable */\nfoo();\n/* eslint-enable */\nbar();\n";
        const { raw, exitCode } = await lint(
          {
            "eslint.config.mjs": `const create = context => ({
                Program() {
                  for (const line of [-1, 0, 1, 2, 4]) context.report({ message: "line " + line, loc: { line, column: 0 } });
                },
              });
              export default [{ plugins: { demo: { rules: { at: { create } } } }, rules: { "demo/at": "error" } }];`,
            "a.js": text,
          },
          ["-f", "json", "a.js"],
        );
        // Same as ESLint 10.12.0.
        expect(JSON.parse(raw)[0].messages.map((it: any) => it.message)).toEqual(["line -1", "line 0", "line 4"]);
        expect(exitCode).toBe(1);
      },
      timeout,
    );

    test(
      "with an oxlint config, it's moved or rejected the same way as in oxlint",
      async () => {
        const [json, pretty, agent] = await Promise.all([
          lint(oxlint, ["-f", "json", ...all]),
          lint(oxlint, ["line-0.js"]),
          lint(oxlint, ["-f", "agent", "line-0.js"]),
        ]);
        const found = JSON.parse(json.raw).diagnostics.map((it: any) => {
          const span = it.labels[0]?.span;
          return [nameOf(it.filename), span ? `${span.line}:${span.column}` : it.message.split("\n")[2]];
        });
        expect(Object.fromEntries(found)).toEqual(Object.fromEntries(names.map(name => [name, locCases[name][2]])));
        expect(pretty.stdout).toStartWith(`1 | export const a = 1;
    ^
error: line-0  demo/at
    at line-0.js:1:1
`);
        expect(agent.stdout).toBe("line-0.js:1:1: error demo(at): line-0");
        expect(json.exitCode).toBe(1);
      },
      timeout,
    );

    test(
      "without a config, a `loc` before the first line is moved to the start of the file",
      async () => {
        const [json, pretty] = await Promise.all([
          lint(withBunfig, ["-f", "json", ...all]),
          lint(withBunfig, ["line-0.js"]),
        ]);
        expect(inJson(json.raw)).toEqual(
          Object.fromEntries(names.map(name => [name, [locCases[name][3] ?? locCases[name][1]]])),
        );
        expect(pretty.stdout).toStartWith(`1 | export const a = 1;
    ^
error: line-0  demo/at
    at line-0.js:1:1
`);
        expect(json.exitCode).toBe(1);
      },
      timeout,
    );

    describe("and disable comments", () => {
      const found = "demo/line-0";
      // Each entry has the text, then what ESLint 10.12.0 reports, what oxlint 1.87.0 reports, and what's reported
      // without a config, where disable comments are matched against the position the report is shown at.
      const texts: Record<string, [string, string[], string[], string[]]> = {
        "none": ["export {};\n", [`${found} 0:1`], [`${found} 1:1`], [`${found} 1:1`]],
        "block": [
          "/* eslint-disable */\nexport {};\n",
          [`${found} 0:1`, "unused 1:1"],
          [`${found} 1:1`, "unused 1:1"],
          [],
        ],
        "block-rule": [
          "/* eslint-disable demo/line-0 */\nexport {};\n",
          [`${found} 0:1`, "unused 1:1"],
          [`${found} 1:1`, "unused 1:1"],
          [],
        ],
        "oxlint-block": ["/* oxlint-disable */\nexport {};\n", [`${found} 0:1`], [`${found} 1:1`, "unused 1:1"], []],
        "enabled-again": [
          "/* eslint-disable */ /* eslint-enable */\nexport {};\n",
          [`${found} 0:1`, "unused 1:1"],
          [`${found} 1:1`, "unused 1:22"],
          [],
        ],
        "line": [
          "export {}; // eslint-disable-line\n",
          [`${found} 0:1`, "unused 1:12"],
          [`${found} 1:1`, "unused 1:12"],
          [],
        ],
        "line-rule": [
          "export {}; // eslint-disable-line demo/line-0\n",
          [`${found} 0:1`, "unused 1:12"],
          [`${found} 1:1`, "unused 1:12"],
          [],
        ],
        "next-line": [
          "// eslint-disable-next-line\nexport {};\n",
          [`${found} 0:1`, "unused 1:1"],
          [`${found} 1:1`, "unused 1:1"],
          [`${found} 1:1`, "unused 1:1"],
        ],
        "indented": [
          "  /* eslint-disable */\nexport {};\n",
          [`${found} 0:1`, "unused 1:3"],
          [`${found} 1:1`, "unused 1:3"],
          [`${found} 1:1`, "unused 1:3"],
        ],
        "second-line": [
          "export {};\n/* eslint-disable */\n",
          [`${found} 0:1`, "unused 2:1"],
          [`${found} 1:1`, "unused 2:1"],
          [`${found} 1:1`, "unused 2:1"],
        ],
      };
      const names = Object.keys(texts);
      const args = ["--report-unused-disable-directives", "-f", "json", ...names.map(name => `${name}.js`)];
      const files = {
        "plugin.mjs": `const loc = { line: 0, column: 0 };
          const create = context => ({ "Program:exit": () => context.report({ message: "whole file", loc }) });
          export default { meta: { name: "demo" }, rules: { "line-0": { create } } };`,
        ...Object.fromEntries(names.map(name => [`${name}.js`, texts[name][0]])),
      };
      const expected = (at: 1 | 2 | 3) => Object.fromEntries(names.map(name => [name, texts[name][at]]));
      const messagesOf = (raw: string) =>
        Object.fromEntries(
          JSON.parse(raw).map((result: any) => [
            nameOf(result.filePath),
            result.messages.map((it: any) => `${it.ruleId ?? "unused"} ${it.line}:${it.column}`),
          ]),
        );

      test(
        "with an ESLint config, no comment disables a report at line 0, as in ESLint",
        async () => {
          const config = `import demo from "./plugin.mjs";
            export default [{ files: ["*.js"], plugins: { demo }, rules: { "demo/line-0": "error" } }];`;
          const { raw, exitCode } = await lint({ ...files, "eslint.config.mjs": config }, args);
          expect(messagesOf(raw)).toEqual(expected(1));
          expect(exitCode).toBe(1);
        },
        timeout,
      );

      test(
        "with an oxlint config, no comment disables it either, as in oxlint",
        async () => {
          const config = oxlintrc({ jsPlugins: ["./plugin.mjs"], rules: { "demo/line-0": "error" } });
          const { raw, exitCode } = await lint({ ...files, ".oxlintrc.json": config }, args);
          const all: Record<string, string[]> = {};
          for (const it of JSON.parse(raw).diagnostics) {
            const { line, column } = it.labels[0].span;
            (all[nameOf(it.filename)] ??= []).push(`${it.code ? found : "unused"} ${line}:${column}`);
          }
          expect(all).toEqual(expected(2));
          expect(exitCode).toBe(1);
        },
        timeout,
      );

      test(
        "without a config, a comment at the start of the file disables it, and counts as used",
        async () => {
          const config = `[lint]\nplugins = ["./plugin.mjs"]\n[lint.rules]\n"demo/line-0" = "error"\n`;
          const { raw, exitCode } = await lint({ ...files, "bunfig.toml": config }, args);
          expect(messagesOf(raw)).toEqual(expected(3));
          expect(exitCode).toBe(1);
        },
        timeout,
      );

      describe("for built-in rules that report the whole file", () => {
        const files = {
          "tsconfig.json": JSON.stringify({ compilerOptions: { strictNullChecks: false } }),
          "reported.ts": "export const a = 1;\n",
          "disabled.ts": "/* eslint-disable */\nexport const a = 1;\n",
          "reported.spec.js": "export const a = 1;\n",
          "disabled.spec.js": "/* eslint-disable vitest/consistent-test-filename */\nexport const a = 1;\n",
        };
        const rules = ["@typescript-eslint/no-unnecessary-condition", "vitest/consistent-test-filename"];
        const args = ["--report-unused-disable-directives", "-f", "json"];

        test("without a config, a comment at the start of the file disables them", async () => {
          const config = `[lint.rules]\n${rules.map(rule => `"${rule}" = "error"\n`).join("")}`;
          const { raw, exitCode } = await lint({ ...files, "bunfig.toml": config }, [...args, "."]);
          expect(
            JSON.parse(raw).map((result: any) => [
              result.filePath.replace(/^.*[\\/]/, ""),
              ...result.messages.map((it: any) => `${it.ruleId ?? "unused"} ${it.line}:${it.column}`),
            ]),
          ).toEqual([
            ["disabled.spec.js"],
            ["disabled.ts"],
            ["reported.spec.js", `${rules[1]} 1:1`],
            ["reported.ts", `${rules[0]} 1:1`],
          ]);
          expect(exitCode).toBe(1);
        });

        test("with an oxlint config, they have no location and no comment disables them, as in oxlint", async () => {
          const config = oxlintrc({ plugins: ["vitest"], rules: { [rules[1]]: "error" } });
          const project = { ...files, ".oxlintrc.json": config };
          const [json, agent] = await Promise.all([
            lint(project, [...args, "reported.spec.js", "disabled.spec.js"]),
            lint(project, ["-f", "agent", "reported.spec.js"]),
          ]);
          // Same as oxlint 1.87.0.
          expect(
            JSON.parse(json.raw)
              .diagnostics.map((it: any) => [it.filename, it.code ?? "unused", it.labels.length])
              .sort(),
          ).toEqual([
            ["disabled.spec.js", "unused", 1],
            ["disabled.spec.js", "vitest(consistent-test-filename)", 0],
            ["reported.spec.js", "vitest(consistent-test-filename)", 0],
          ]);
          expect(agent.stdout).toStartWith("reported.spec.js: error vitest(consistent-test-filename): ");
          expect(json.exitCode).toBe(1);
        });
      });
    });

    // ESLint doesn't have any of these formats.
    test.each([
      ["an ESLint config", eslint],
      ["no config", withBunfig],
    ])(
      "the other formats clamp it to a position in the file, with %s",
      async (_, config) => {
        const some = ["line-0.js", "line-below-0.js", "column-far-below-0.js", "huge-column.js", "huge-end.js"];
        const [pretty, agent, github, junit] = await Promise.all(
          ["pretty", "agent", "github", "junit"].map(format => lint(config, ["-f", format, ...some])),
        );
        expect(pretty.stdout.split("\n").filter(line => line.includes(" at "))).toEqual([
          "    at column-far-below-0.js:1:0",
          "    at huge-column.js:1:2000000001",
          "    at huge-end.js:1:1",
          "    at line-0.js:1:1",
          "    at line-below-0.js:1:1",
        ]);
        // The `^` doesn't go past the end of the line.
        expect(pretty.stdout).toContain("1 | export const a = 1;\n                       ^\nerror: huge-column");
        expect(agent.stdout.split("\n").filter(line => line.startsWith("<error") || line.includes("^"))).toEqual([
          `<error file="column-far-below-0.js" line="1" column="0" rule="demo/at">`,
          "    ^^^^^^^^^^^^^^^^^^^",
          `<error file="huge-column.js" line="1" column="2000000001" rule="demo/at">`,
          "                       ^",
          `<error file="huge-end.js" line="1" column="1" rule="demo/at">`,
          "    ^^^^^^^^^^^^^^^^^^^",
          `<error file="line-0.js" line="1" column="1" rule="demo/at">`,
          "    ^^^^^^^^^^^^^^^^^^^",
          `<error file="line-below-0.js" line="1" column="1" rule="demo/at">`,
          "    ^^^^^^^^^^^^^^^^^^^",
        ]);
        expect(github.stdout.split("\n")).toEqual([
          "::error file=column-far-below-0.js,line=1,col=1,endLine=1,endColumn=1,title=demo/at::column-far-below-0",
          "::error file=huge-column.js,line=1,col=2000000001,endLine=1,endColumn=2000000001,title=demo/at::huge-column",
          "::error file=huge-end.js,line=1,col=1,endLine=1,endColumn=2000000001,title=demo/at::huge-end",
          "::error file=line-0.js,line=1,col=1,endLine=1,endColumn=1,title=demo/at::line-0",
          "::error file=line-below-0.js,line=1,col=1,endLine=1,endColumn=1,title=demo/at::line-below-0",
        ]);
        expect(
          junit.stdout
            .split("\n")
            .filter(line => line.includes("<error"))
            .map(line => line.trim()),
        ).toEqual([
          `<error message="column-far-below-0">line 1, column 1, column-far-below-0</error>`,
          `<error message="huge-column">line 5, column 1, huge-column</error>`,
          `<error message="huge-end">line 1, column 1, huge-end</error>`,
          `<error message="line-0">line 1, column 1, line-0</error>`,
          `<error message="line-below-0">line 1, column 1, line-below-0</error>`,
        ]);
      },
      timeout,
    );
  });
});

// Recorded with ESLint 10.12.0 and @typescript-eslint/parser 8.71.1 by record.mjs in that directory.
test.concurrent(
  "several rules' listeners are called in ESLint's order, for node types, selectors, exits and code path events",
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

describe.concurrent("AST nodes in JavaScript plugins", () => {
  const oracle = join(import.meta.dir, "oracle", "jsplugins", "trees");
  const dump = readFileSync(join(oracle, "dump.cjs"), "utf8");
  // Recorded with ESLint 10.12.0, @typescript-eslint/parser 8.71.1 and oxlint 1.87.0 by record.mjs in that directory.
  const expected: Record<"eslint" | "oxlint", Record<string, string>> = JSON.parse(
    Buffer.from(Bun.zstdDecompressSync(readFileSync(join(oracle, "expected.json.zst")))).toString(),
  );

  test(
    "have the same properties, property order, attributes and classes as in espree and typescript-estree",
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
      // One node per line, so that a diff is readable.
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
    "have oxlint's layout with an oxlint config",
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

  // A rule written for espree or oxlint reads `node.start` and `node.end`. typescript-estree's nodes don't have them.
  // Without an ESLint or oxlint config there's no parser to match, so every file has them. Issue #46971.
  test(
    "have `start` and `end` in every file without an ESLint or oxlint config",
    async () => {
      const plugin = `const keys = it => Object.keys(it).join();
        const positions = it => [it.start, it.end, ...it.range].join();
        const selected = new Set();
        export default { meta: { name: "probe" }, rules: { positions: { create: context => ({
          // Selectors are matched natively, with the same properties.
          "VariableDeclaration[start=13][end>13]"(node) { selected.add(node); },
          "Program:exit"(node) {
            const [line, block] = context.sourceCode.getAllComments();
            const tokens = context.sourceCode.getTokens(node);
            const regex = tokens.find(it => it.type === "RegularExpression");
            const [declaration] = node.body;
            const annotation = declaration.declarations[0].id.typeAnnotation;
            context.report({ node, message: JSON.stringify({
              selected: selected.has(declaration), keys: keys(declaration), positions: positions(declaration),
              annotationKeys: annotation ? keys(annotation) : null, annotationPositions: annotation ? positions(annotation) : null,
              lineKeys: keys(line), linePositions: positions(line), blockKeys: keys(block), blockPositions: positions(block),
              tokenKeys: keys(tokens[0]), tokenPositions: positions(tokens[0]),
              regexKeys: keys(regex), regexPositions: positions(regex), regex: keys(regex.regex),
            }) });
          },
        }) } } };`;
      const files = {
        "plugin.mjs": plugin,
        "bunfig.toml": `[lint]\nplugins = ["./plugin.mjs"]\n[lint.rules]\n"probe/positions" = "error"\n`,
        "index.ts": "// a\n/* b */\nconst answer: number = 42, re = /c/g;\n",
        "index.js": "// a\n/* b */\nconst answer = 42, re = /c/g;\n",
      };
      const { raw, exitCode } = await lint(files, ["-f", "json", "index.ts", "index.js"]);
      const results: { filePath: string; messages: { ruleId: string; message: string }[] }[] = JSON.parse(raw);
      const said = Object.fromEntries(
        results.map(it => [
          it.filePath.replaceAll("\\", "/").split("/").at(-1),
          JSON.parse(it.messages.find(message => message.ruleId === "probe/positions")!.message),
        ]),
      );
      expect(said).toEqual({
        "index.ts": {
          selected: true,
          keys: "type,declarations,declare,kind,start,end,range,loc,parent",
          positions: "13,50,13,50",
          annotationKeys: "type,loc,start,end,range,typeAnnotation,parent",
          annotationPositions: "25,33,25,33",
          lineKeys: "type,loc,start,end,range,value",
          linePositions: "0,4,0,4",
          blockKeys: "type,loc,start,end,range,value",
          blockPositions: "5,12,5,12",
          tokenKeys: "type,loc,start,end,range,value",
          tokenPositions: "13,18,13,18",
          regexKeys: "type,loc,start,end,range,regex,value",
          regexPositions: "45,49,45,49",
          regex: "flags,pattern",
        },
        "index.js": {
          selected: true,
          keys: "type,start,end,loc,range,declarations,kind,parent",
          positions: "13,42,13,42",
          annotationKeys: null,
          annotationPositions: null,
          lineKeys: "type,value,start,end,range,loc",
          linePositions: "0,4,0,4",
          blockKeys: "type,value,start,end,range,loc",
          blockPositions: "5,12,5,12",
          tokenKeys: "type,value,start,end,loc,range",
          tokenPositions: "13,18,13,18",
          regexKeys: "type,value,start,end,loc,range,regex",
          regexPositions: "37,41,37,41",
          regex: "flags,pattern",
        },
      });
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  // The same trees as with an ESLint config, with `start` and `end` before `range` in the files that typescript-estree parses.
  // Bun picks the source type by what the file has, where ESLint's config sets it.
  test(
    "have those layouts, with `start` and `end`, without an ESLint or oxlint config",
    async () => {
      const config = `[lint]\nplugins = ["./dump.cjs"]\nignorePatterns = ["dump.cjs"]\n[lint.rules]\n"dump/tree" = "error"\n`;
      const { raw, exitCode } = await lint({ "dump.cjs": dump, "bunfig.toml": config, ...treeCases }, [
        "-f",
        "json",
        ...Object.keys(treeCases),
      ]);
      const results: { filePath: string; messages: { ruleId: string; message: string }[] }[] = JSON.parse(raw);
      const lines = (tree: string | undefined) => tree?.split(/(?<=[[ ])(?=(?:Node )?\{ type: )/);
      const withoutSourceType = (tree: string) => tree.replace(/sourceType: "\w+"/, "sourceType");
      for (const file of Object.keys(treeCases)) {
        const result = results.find(it => it.filePath.replaceAll("\\", "/").endsWith(`/${file}`));
        const found = result?.messages.filter(it => it.ruleId === "dump/tree").map(it => withoutSourceType(it.message));
        let tree = withoutSourceType(expected.eslint[file]);
        if (!file.endsWith(".js"))
          tree = tree.replace(/range: \[(\d+), (\d+)\]/g, "start: $1, end: $2, range: [$1, $2]");
        expect({ file, trees: found?.map(lines) }).toEqual({ file, trees: [lines(tree)] });
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
    "with an ESLint 8 config, the global scope has the variables from /* eslint-env */ comments",
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

  // ESLint 10.12.0 prints the same messages.
  test(
    "a global variable has ESLint's extra properties even if a rule first reaches it through reference.resolved",
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

  // The expected output is what ESLint 10.12.0 with @typescript-eslint/parser 8.71.1 reports.
  test(
    "the global scope has TypeScript's lib globals, however a rule first accesses it",
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

  // The expected output is what ESLint 10.12.0 with @typescript-eslint/parser 8.71.1 reports.
  test(
    "a plugin's writes to the global scope and its variables persist, and bun lint doesn't trust them",
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

  // The ids are what oxlint 1.87.0 passes to the rule, with one run per row, because it rejects two plugins with the
  // same name in one run.
  test(
    "strips eslint-plugin and oxlint-plugin from a plugin's name and from rule keys like oxlint",
    async () => {
      // `meta.name`, the plugin part of the rule's key, and `context.id`.
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
      const [accepted, ...rejected] = await Promise.all([
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
      expect(rejected.map(it => [it.stderr.split("\n")[0], it.exitCode])).toEqual([
        ["error: 1 rule in .oxlintrc.json is not supported: foo/bar/r", 2],
        ["error: 1 rule in .oxlintrc.json is not supported: @scope/x/y/r", 2],
      ]);
    },
    timeout,
  );

  // ESLint 10.12.0 reports the same for `both`, and rejects `once`: "Rule must be an object with a `create` method".
  test(
    "with an ESLint config, create runs for each file, and createOnce's context reflects the file being linted",
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
      // Once in a single realm, where the third file comes after two others, and once in several realms.
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

  // Same as under ESLint 10.12.0.
  test(
    "a range array with a hole is read like any other object",
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
    "whatever a plugin throws, and wherever it throws, the run ends with a readable error",
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
        // Same as ESLint 10.12, which adds the rule to `message`.
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
    "a plugin can't reach host internals through `caller` or through accessors it puts on Array.prototype",
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

  // An indexed accessor on Array.prototype makes JavaScriptCore switch every array in the realm to slow-put storage.
  test(
    "nodes, scopes and code paths are still correct after a plugin defines an indexed accessor on Array.prototype",
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
    "with an oxlint config, scopes depend on the kind of file: strict scopes in TypeScript, and `arguments` in CommonJS",
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
      // This is what oxlint 1.87 reports.
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
      const found = JSON.parse(raw).diagnostics.map((it: { filename: string; message: string }) => [
        it.filename,
        it.message,
      ]);
      expect(Object.fromEntries(found)).toEqual(expected);
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  // This is what oxlint 1.87 reports. Its own no-unused-vars doesn't see the mark.
  test(
    "with an oxlint config, markVariableAsUsed marks the named variable in every kind of file",
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
      const found = JSON.parse(raw).diagnostics.map(
        (it: { filename: string; message: string }) =>
          `${it.filename} ${it.message.match(/'(\w+)'/)?.[1] ?? it.message}`,
      );
      expect(found.sort()).toEqual(
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
  // Keyed by file name. Recorded with oxlint 1.87.0 by record.mjs in that directory.
  const expected: Record<string, string> = JSON.parse(
    Buffer.from(Bun.zstdDecompressSync(readFileSync(join(oracle, "expected.json.zst")))).toString(),
  );
  type Diagnostic = { filename: string; message: string };
  const slashes = (path: string) => path.replaceAll("\\", "/");

  test(
    "trees and their values, traversal order, scopes and sourceCode's answers for each node match oxlint in every kind of file",
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

  // From oxlint 1.87.0 and ESLint 10.12.0. `regexp/sort-flags` reads `regex.flags`.
  test.each([
    [".oxlintrc.json", ["gi /a/ig /a/gi", "dgimsuy /b/yusmigd /b/dgimsuy", "dv /c/vd /c/dv", " /d/ /d/"]],
    ["eslint.config.mjs", ["ig /a/ig /a/gi", "yusmigd /b/yusmigd /b/dgimsuy", "vd /c/vd /c/dv", " /d/ /d/"]],
  ])(
    "the flags of a regular expression are sorted as in oxlint, and as written with an ESLint config: %s",
    async (config, expected) => {
      const configs: Record<string, string> = {
        ".oxlintrc.json": oxlintrc({ jsPlugins: ["./plugin.mjs"], rules: { "demo/flags": "error" } }),
        "eslint.config.mjs": `import demo from "./plugin.mjs";
          export default [{ files: ["a.*"], plugins: { demo }, rules: { "demo/flags": "error" } }];`,
      };
      const files = {
        [config]: configs[config],
        "plugin.mjs": `const create = context => ({
            Literal: node => context.report({ node, message: [node.regex.flags, node.raw, node.value].join(" ") }),
          });
          export default { meta: { name: "demo" }, rules: { flags: { create } } };`,
        "a.js": "a(/a/ig, /b/yusmigd, /c/vd, /d/);\n",
        "a.ts": "a(/a/ig, /b/yusmigd, /c/vd, /d/);\n",
      };
      const { stdout } = await lint(files, ["-f", "unix", "a.js", "a.ts"]);
      const said = (name: string) =>
        stdout
          .split("\n")
          .filter(line => line.includes(name))
          .map(line => line.replace(/^.*?:\d+:\d+: | \[.*$/g, ""));
      expect({ js: said("a.js"), ts: said("a.ts") }).toEqual({ js: expected, ts: expected });
    },
    timeout,
  );

  // In a JavaScript file the TypeScript-only fields are always empty, so they aren't created for each node, and an
  // empty list is only created when it's read. A plugin must not be able to tell. The expected output is what the same
  // plugin reports under oxlint 1.87.
  describe("TypeScript-only fields in a JavaScript file", () => {
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
    const messagesFor = async (file: string, text: string) => {
      const files = { "plugin.mjs": plugin, ".oxlintrc.json": config, [file]: text };
      const { raw, exitCode } = await lint(files, ["-f", "json", file]);
      const diagnostics: Diagnostic[] = JSON.parse(raw).diagnostics;
      expect(exitCode).toBe(1);
      return diagnostics.map(it => it.message);
    };

    test(
      "an Identifier's `decorators` is a plain property with its own array, however it's first accessed",
      async () => {
        const text = Array.from({ length: 40 }, (_, i) => `i${i}`).join("; ") + ";\n";
        const [message, ...more] = await messagesFor("ids.js", text);
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
      "every node type that has them has oxlint's values in oxlint's order",
      async () => {
        const text =
          'import { a as b } from "a";\nexport { b as c };\nexport * from "d";\nexport default b;\nexport const e = ({ f }, [g], h = 1, ...i) => j(f)`k`;\nnew L();\nvar m;\nfunction n() {}\n(function () {});\n({ o: 1, p() {} });\n<Q r />;\n';
        const [message, ...more] = await messagesFor("kinds.jsx", text);
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

  // This is what oxlint 1.87 reports. It iterates over `env` and `globals` in hash map order, so the plugin sorts its
  // output.
  test(
    "scopeManager, languageOptions and parserServices are frozen objects shared by all files, as in oxlint",
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
      const found = Object.fromEntries(diagnostics.map(it => [slashes(it.filename), it.message.split("\n")]));
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
      expect(found).toEqual(
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

  // This is what oxlint 1.87 reports: the number of variables in the global scope, a checksum of their names, `env`,
  // `globals`, and some variables.
  test(
    "globals come from the enabled envs and `globals`: builtin only without env, overrides merge, extends is ignored",
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

  // oxlint 1.87 and ESLint 10.12 with @typescript-eslint/parser 8.71.1 both report this.
  test.each(["oxlint", "eslint"])(
    "reference.maybeImplicitGlobal matches typescript-eslint (an object, null or undefined) with an %s config",
    async tool => {
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
        ...configs[tool as keyof typeof configs],
        "script.js": `${code}\n`,
        "script.ts": `${code}${types}\n`,
        "module.mts": `${code}${types} export { a };\n`,
      };
      const { raw, exitCode } = await lint(files, ["-f", "json", ...Object.keys(expected)]);
      const found: [string, string][] =
        tool === "oxlint"
          ? JSON.parse(raw).diagnostics.map((it: Diagnostic) => [it.filename, it.message])
          : JSON.parse(raw).map((it: { filePath: string; messages: { message: string }[] }) => [
              slashes(it.filePath).split("/").at(-1),
              it.messages.map(message => message.message).join("|"),
            ]);
      expect(Object.fromEntries(found)).toEqual(expected);
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  // oxlint 1.87 and ESLint 10.12 with @typescript-eslint/parser 8.71.1 both report this.
  test.each(["oxlint", "eslint"])(
    "in a pattern, the reference to the index of `a[b]!` comes before the object's, as for `a[b]`, with an %s config",
    async tool => {
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
        ...configs[tool as keyof typeof configs],
        "a.ts": rows.map(it => `${it[0]}\n`).join(""),
      };
      const { raw, exitCode } = await lint(files, ["-f", "json", "a.ts"]);
      const message: string =
        tool === "oxlint" ? JSON.parse(raw).diagnostics[0].message : JSON.parse(raw)[0].messages[0].message;
      expect(message.split("|").map((cell, i) => [rows[i][0], cell])).toEqual(rows);
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  // `loc`, `decorators`, `ast.tokens` and `sourceCode`'s properties are created when they're first read. It must not
  // matter what reads them first, in which realm, or in which JIT tier: they belong to the plugin's realm and stay the
  // same objects. This is what oxlint 1.87 and ESLint 10.12 report, where all of it is plain data.
  test.each(["oxlint", "eslint"])(
    "lazily created properties are the same from a node:vm context and in hot code, with an %s config",
    async tool => {
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
        ...configs[tool as keyof typeof configs],
        "a.js": "// c\n" + Array.from({ length: 3002 }, (_, i) => `v${i};\n`).join(""),
      };
      const { raw, exitCode } = await lint(files, ["-f", "json", "a.js"]);
      const message: string =
        tool === "oxlint" ? JSON.parse(raw).diagnostics[0].message : JSON.parse(raw)[0].messages[0].message;
      expect(message.split("\n")).toEqual(expected[tool as keyof typeof expected]);
      expect(exitCode).toBe(1);
    },
    timeout,
  );
});

test.concurrent(
  "getAncestors returns every ancestor after a plugin defines an indexed accessor on Array.prototype",
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
  "context.sourceCode matches ESLint: layout, text, lines, locations, indices, ancestors, scopes, directive comments, bad input",
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
    const found = Object.fromEntries(
      JSON.parse(raw).map((result: any) => [
        result.filePath.replaceAll("\\", "/").split("/").at(-1),
        JSON.parse(result.messages.find((it: any) => it.ruleId === "demo/all").message),
      ]),
    );
    // Recorded with ESLint 10.12.0 and @typescript-eslint/parser 8.71.1 by record.mjs in that directory.
    expect(found).toEqual(JSON.parse(readFileSync(join(oracle, "expected.json"), "utf8")));
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
    "events, graphs, traverseSegments and the objects' properties match ESLint in JavaScript files",
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
      // ESLint 10.12.0 prints the same message.
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

  // ESLint 9 removed `currentSegments`. The first test checks that it's gone with a flat config.
  test(
    "codePath.currentSegments follows the traversal with an ESLint 8 config",
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
      // Recorded from ESLint's analyzer with the listeners called while it runs, as ESLint 8 does.
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
    "an error thrown from a code path listener or a traverseSegments callback mentions the rule",
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
  // A file that's linted with types, and standard input, are parsed on a thread without a VM. A thread with a VM then
  // parses them again.
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
      const [fromFiles, fromStdin] = await Promise.all([
        run(["plain", "typed"], "ignore"),
        run(["--stdin", "--stdin-filename", "plain/b.js"], Buffer.from(code)),
      ]);
      expect(fromFiles).toEqual({ names: ["a.js lostInner", "a.js lost", "a.ts lostInner", "a.ts lost"], exitCode: 1 });
      expect(fromStdin).toEqual({ names: ["b.js lostInner", "b.js lost"], exitCode: 1 });
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
    "--threads 1 uses one VM, even if one of the files is 256 KB or more",
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

  // Same as ESLint 10.12.0, which lints one file at a time.
  test(
    "if a rule throws in several files, the error for the first path is reported, with any number of threads",
    async () => {
      const files: Record<string, string> = {
        "eslint.config.mjs": `
          import own from "./plugin.mjs";
          export default [{ plugins: { own }, rules: { "own/throws": "error" } }];`,
        "plugin.mjs": `export default { rules: { throws: { create: context => ({
          Program() { if (context.filename.endsWith("7.js")) throw new Error("thrown on purpose"); },
        }) } } };`,
      };
      // 6 MB, which is enough work for several VMs.
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
      let output = "";
      while (!output.includes("spinning")) {
        const { value, done } = await reader.read();
        if (done) break;
        output += new TextDecoder().decode(value);
      }
      expect(output).toContain("spinning");
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
      // Skips the methods that ESLint 10 removed.
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
    "the objects match oxlint with an oxlint config",
    async () => {
      const config = { ignorePatterns: ["dump.cjs"], jsPlugins: ["./dump.cjs"], rules: { "tokens/all": "error" } };
      const { raw, exitCode } = await lint({ "dump.cjs": dump, ".oxlintrc.json": oxlintrc(config), ...sources }, [
        "-f",
        "json",
      ]);
      const diagnostics: { filename: string; message: string }[] = JSON.parse(raw).diagnostics;
      // oxlint has different values or types for a few tokens in these two.
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
    "odd arguments, receivers and filters behave as in ESLint",
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
      // This is what ESLint 10.12.0 reports when Bun runs it.
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
