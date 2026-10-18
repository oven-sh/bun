// The rules that need types read the tree of the type checker, which TypeScript's parser makes. Whether a file is refused is
// for the parser of its configuration to say, as it is without types: oxc's parser has errors that leave no trace in that tree.
// Under an .oxlintrc.json every expectation is what oxlint 1.88.0 prints with oxlint-tsgolint 7.0.2004.
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

// Each run reads TypeScript's library, which takes a debug build seconds.
const timeout = isDebug || isASAN ? 60_000 : undefined;

type Options = { stdin?: string; /** Files to read when the command has run. */ reads?: string[] };

async function lint(files: Record<string, string>, args: string[], options: Options = {}) {
  using dir = tempDir("bun-lint-type-aware", files);
  await using proc = spawn({
    cmd: [bunExe(), "lint", ...args],
    env,
    cwd: String(dir),
    stdin: options.stdin === undefined ? "ignore" : Buffer.from(options.stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return {
    stdout: normalizeBunSnapshot(stdout, String(dir)),
    stderr,
    exitCode,
    files: Object.fromEntries((options.reads ?? []).map(name => [name, readFileSync(join(String(dir), name), "utf8")])),
  };
}

/** What `-f unix` prints about each file, in its order. */
function reported(stdout: string) {
  const found: Record<string, string[]> = {};
  for (const line of stdout.split("\n")) {
    const [, name, said] = /(?:^|[\\/])([\w.]+):(\d+:\d+: .*\])$/.exec(line) ?? [];
    if (name) (found[name] ??= []).push(said);
  }
  return found;
}

// The smallest library that has `Promise.resolve`: a debug build takes long to read a larger one.
const compilerOptions = { strict: true, noEmit: true, lib: ["es2015"], types: [], allowJs: true };
const tsconfig = JSON.stringify({
  compilerOptions: { ...compilerOptions, module: "esnext", moduleResolution: "bundler" },
});
const oxlintrc = (config: object = {}) =>
  JSON.stringify({
    plugins: ["typescript"],
    categories: { correctness: "off" },
    rules: { "no-var": "error", "typescript/no-floating-promises": "error" },
    ...config,
  });
const floating = "Promises must be awaited, add void operator to ignore. [Error/typescript(no-floating-promises)]";
const noSpecifier = "import() requires a specifier. [Error]";

describe.concurrent("bun lint --type-aware refuses a file as the parser of its configuration refuses it", () => {
  test(
    "the errors that only oxc's parser has",
    async () => {
      // What is printed without types, and what the rules that need types add to it.
      const cases: Record<string, [code: string, refusal: string[], withTypes?: string[]]> = {
        "a00.ts": ["export const p = import();", [`1:18: ${noSpecifier}`]],
        "a01.js": ["export const p = import();", [`1:18: ${noSpecifier}`]],
        "a02.ts": [
          "export function f(a?: number, b: number) { return [a, b]; }",
          ["1:31: A required parameter cannot follow an optional parameter. [Error/TS(1016)]"],
        ],
        "a03.ts": [
          "export declare let a = 1;",
          ["1:24: Initializers are not allowed in ambient contexts. [Error/TS(1039)]"],
        ],
        "a04.ts": [
          "export class A { abstract m() {} }",
          ["1:27: Method 'm' cannot have an implementation because it is marked abstract. [Error/TS(1245)]"],
        ],
        "a05.ts": [
          "export const a = [1];\nexport const p = import(...a);",
          ["2:25: Argument of dynamic import cannot be a spread element. [Error/TS(1325)]"],
        ],
        "a06.ts": [
          'export const p = import("a", {}, 1);',
          [
            "1:18: Dynamic imports can only accept a module specifier and an optional set of attributes as arguments [Error]",
          ],
        ],
        "a07.ts": ["export let a?: number;", ["1:13: Optional declaration is not allowed here [Error]"]],
        "a08.ts": [
          "export interface A implements B {}",
          ["1:20: Interface declaration cannot have 'implements' clause. [Error/TS(1176)]"],
        ],
        "a09.ts": [
          "export type T = readonly number;",
          ["1:17: 'readonly' type modifier is only permitted on array and tuple literal types. [Error/TS(1354)]"],
        ],
        "a10.ts": [
          "export type T = [a?: number, b: number];",
          ["1:30: A required element cannot follow an optional element. [Error/TS(1257)]"],
        ],
        "a11.ts": [
          "export class B { m?!: number }",
          ["1:19: A property cannot be both optional and definite. [Error]"],
        ],
        "a12.ts": [
          "export class A { static { return; } }",
          ["1:27: A 'return' statement cannot be used inside a class static block. [Error/TS(18041)]"],
        ],
        "a13.ts": [
          "export type A = infer T;",
          [
            "1:17: 'infer' declarations are only permitted in the 'extends' clause of a conditional type. [Error/TS(1338)]",
          ],
        ],
        "a14.ts": ["export class C { declare static {} }", ["1:18: Modifiers cannot appear here. [Error/TS(1184)]"]],
        "a15.ts": [
          'import type A, { B } from "./a00";\nexport type { A, B };',
          ["1:13: A type-only import can specify a default import or named bindings, but not both. [Error/TS(1363)]"],
        ],
        "a16.ts": [
          "export class A extends B, C {}",
          ["1:27: Classes can only extend a single class. [Error/TS(1174)]"],
        ],
        // In the order of oxc, which is not that of the text.
        "b0.ts": [
          "let b = 1; let a = 1;\nlet a = 2; let b = 2;\nexport { a, b };",
          [
            "1:16: Identifier `a` has already been declared [Error]",
            "1:5: Identifier `b` has already been declared [Error]",
          ],
        ],
        // tsgolint reads the file on its own. No other rule runs, and no comment counts.
        "c0.ts": [
          "declare const p: Promise<number>;\nexport const q = import();\n" +
            "// oxlint-disable-next-line typescript/no-floating-promises\np;\nvar y = 1;\nexport { y };",
          [`2:18: ${noSpecifier}`],
          [`4:1: ${floating}`],
        ],
        // oxlint says nothing about a file with `@flow` that oxc cannot parse.
        "c1.js": [
          "// @flow\nconst p = Promise.resolve(1);\np;\nexport const q = import();\nvar z = 1;",
          [],
          [`3:1: ${floating}`],
        ],
        // TypeScript's parser has an error for each of these too, which leaves its tree whole and does not count for oxlint.
        "c2.ts": [
          "declare const p: Promise<number>;\nvar n = 010;\nconst q = import();\np;",
          [`3:11: ${noSpecifier}`],
          [`4:1: ${floating}`],
        ],
        "c3.ts": [
          'import a from "./e.json" assert { type: "json" };\ndeclare const p: Promise<number>;\n' +
            "export const q = import();\np;\nvar v = a;\nexport { v };",
          [`3:18: ${noSpecifier}`],
          [`4:1: ${floating}`],
        ],
        // oxc's parser reads this one, and TypeScript's does not. It is linted as oxc reads it, without types.
        "d0.ts": [
          'import source x from "x";\nvar v = x;\nexport { v };',
          ["2:1: Unexpected var, use let or const instead. [Error/eslint(no-var)]"],
        ],
      };
      const files = {
        "tsconfig.json": tsconfig,
        ".oxlintrc.json": oxlintrc(),
        "e.json": "{}\n",
        ...Object.fromEntries(Object.entries(cases).map(([name, [code]]) => [name, code + "\n"])),
      };
      const expected = (withTypes: boolean) =>
        Object.fromEntries(
          Object.entries(cases)
            .map(([name, [, refusal, added = []]]) => [name, withTypes ? [...refusal, ...added] : refusal] as const)
            .filter(([, lines]) => lines.length > 0),
        );
      const [plain, typed] = await Promise.all([
        lint(files, ["-f", "unix"]),
        lint(files, ["--type-aware", "-f", "unix"]),
      ]);
      expect({ plain: reported(plain.stdout), typed: reported(typed.stdout) }).toEqual({
        plain: expected(false),
        typed: expected(true),
      });
      expect({ plain: plain.exitCode, typed: typed.exitCode }).toEqual({ plain: 1, typed: 1 });
    },
    timeout,
  );

  test(
    "however the types are asked for",
    async () => {
      const code = "export function f(a?: number, b: number) { return [a, b]; }\n";
      const refusal = "1:31: A required parameter cannot follow an optional parameter. [Error/TS(1016)]";
      // No tsconfig.json has the files.
      const inNoProject = {
        ".oxlintrc.json": oxlintrc({ options: { typeAware: true, typeCheck: true } }),
        "a.ts": code,
        "b.ts": 'import source x from "x";\nvar v = x;\nexport { v };\n',
      };
      const [byOptions, fromStdin] = await Promise.all([
        lint(inNoProject, ["-f", "unix"]),
        lint(
          { "tsconfig.json": tsconfig, ".oxlintrc.json": oxlintrc() },
          ["--type-aware", "-f", "unix", "--stdin", "--stdin-filename", "a.ts"],
          { stdin: code },
        ),
      ]);
      expect(reported(byOptions.stdout)).toEqual({
        // The type checker has the error too.
        "a.ts": [refusal, refusal.replace("TS(1016)", "typescript(TS1016)")],
        // What TypeScript's parser has against a file that oxc reads is for the type checker to say.
        "b.ts": [
          "1:15: '=' expected. [Error/typescript(TS1005)]",
          "1:15: Cannot find namespace 'x'. [Error/typescript(TS2503)]",
          "1:17: ';' expected. [Error/typescript(TS1005)]",
          "1:17: Cannot find name 'from'. [Error/typescript(TS2304)]",
          "2:1: Unexpected var, use let or const instead. [Error/eslint(no-var)]",
          "2:9: Cannot find name 'x'. [Error/typescript(TS2304)]",
        ],
      });
      expect(reported(fromStdin.stdout)).toEqual({ "a.ts": [refusal] });
      expect({ byOptions: byOptions.exitCode, fromStdin: fromStdin.exitCode }).toEqual({ byOptions: 1, fromStdin: 1 });
    },
    timeout,
  );

  test(
    "--fix writes what a rule that needs types fixes, and the error stays",
    async () => {
      const files = {
        "tsconfig.json": tsconfig,
        ".oxlintrc.json": oxlintrc({ rules: { "typescript/no-unnecessary-type-assertion": "error" } }),
        "a.ts": "export const q = import();\nexport function f(a: number) { return a as number; }\n",
      };
      const fixed = await lint(files, ["--type-aware", "--fix", "-f", "unix", "a.ts"], { reads: ["a.ts"] });
      expect(fixed.files["a.ts"]).toBe(files["a.ts"].replace("a as number", "a"));
      expect(reported(fixed.stdout)).toEqual({ "a.ts": [`1:18: ${noSpecifier}`] });
      expect(fixed.exitCode).toBe(1);
    },
    timeout,
  );

  test(
    "a file that oxc refuses is in no cycle of imports",
    async () => {
      const files = {
        "tsconfig.json": tsconfig,
        ".oxlintrc.json": oxlintrc({
          plugins: ["import", "typescript"],
          rules: { "import/no-cycle": "error", "typescript/no-floating-promises": "error" },
        }),
        "a.ts":
          'import { b } from "./b";\ndeclare const p: Promise<number>;\np;\nexport const a = b;\nexport const q = import();\n',
        "b.ts": 'import { a } from "./a";\nexport const b = a;\n',
        "c.ts": 'import { d } from "./d";\nexport const c = d;\n',
        "d.ts": 'import { c } from "./c";\nexport const d = c;\n',
      };
      const cycle = "1:19: Dependency cycle detected [Error/import(no-cycle)]";
      const { stdout, exitCode } = await lint(files, ["--type-aware", "-f", "unix"]);
      expect(reported(stdout)).toEqual({
        "a.ts": [`5:18: ${noSpecifier}`, `3:1: ${floating}`],
        "c.ts": [cycle],
        "d.ts": [cycle],
      });
      expect(exitCode).toBe(1);
    },
    timeout,
  );

  // For `Array<?>` the parser that typescript-estree runs on has no error, and the one of the type checker has.
  test(
    "without a configuration of oxlint, a file that only TypeScript's parser refuses is linted without types",
    async () => {
      const files = { "tsconfig.json": tsconfig, "a.ts": "export let a: Array<?>;\n" };
      const [plain, typed] = await Promise.all([
        lint(files, ["-f", "unix"]),
        lint(files, ["--type-aware", "-f", "unix"]),
      ]);
      const any = ["1:21: Unexpected any. Specify a different type. [Warning/@typescript-eslint/no-explicit-any]"];
      expect({ plain: reported(plain.stdout), typed: reported(typed.stdout) }).toEqual({
        plain: { "a.ts": any },
        typed: { "a.ts": any },
      });
    },
    timeout,
  );

  test(
    "without a configuration of oxlint, a file that TypeScript's parser has no error for is parsed once",
    async () => {
      const clean = "declare const p: Promise<number>;\nvoid p;\nexport {};\n";
      /** How many times the parser runs. */
      const parsed = async (files: Record<string, string>) => {
        const { stderr } = await lint({ "tsconfig.json": tsconfig, ...files }, [
          "--type-aware",
          "--timing",
          "--threads",
          "1",
        ]);
        return Number(/fast parser: (\d+) files/.exec(stderr)?.[1]);
      };
      const [one, two] = await Promise.all([parsed({ "a.ts": clean }), parsed({ "a.ts": clean, "b.ts": clean })]);
      expect(two - one).toBe(1);
    },
    timeout,
  );
});
