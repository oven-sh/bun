// The rules that need types read the tree of the type checker, which TypeScript's parser makes. What oxlint prints about a file
// that oxc refuses does not depend on that tree: oxc's errors come first, in oxc's order, and tsgolint, which reads the file on
// its own, adds its reports. Each expectation is what oxlint 1.88.0 prints with oxlint-tsgolint 7.0.2004, file by file, but for
// the files where a comment says otherwise. lint.test.ts has the comments and the fixes of a file that oxc refuses for an early
// error ("in a file that oxc refuses for an early error, the rules that need types go on").
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
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

// One thread lints the files one after the other. A debug build takes a second to start a thread for each core.
async function lint(files: Record<string, string>, args: string[], read: string[] = []) {
  using dir = tempDir("bun-lint-type-aware", files);
  await using proc = spawn({
    cmd: [bunExe(), "lint", "--threads", "1", ...args],
    env,
    cwd: String(dir),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const texts = Object.fromEntries(read.map(name => [name, readFileSync(join(String(dir), name), "utf8")]));
  return { stdout: normalizeBunSnapshot(stdout, String(dir)), stderr, exitCode, texts };
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
const compilerOptions = {
  strict: true,
  noEmit: true,
  lib: ["es2015"],
  types: [],
  allowJs: true,
  resolveJsonModule: true,
};
const tsconfig = JSON.stringify({
  compilerOptions: { ...compilerOptions, module: "esnext", moduleResolution: "bundler" },
});
// With no-unused-vars on, the names that are declared twice are found in the variables of the file. With no rule that needs
// the variables, a run with types does not find them.
const oxlintrc = (config: object = {}) =>
  JSON.stringify({
    plugins: ["typescript"],
    categories: { correctness: "off" },
    rules: { "no-unused-vars": "warn", "no-var": "error", "typescript/no-floating-promises": "error" },
    ...config,
  });
const floating = "Promises must be awaited, add void operator to ignore. [Error/typescript(no-floating-promises)]";
const redeclared = (name: string) => `Identifier \`${name}\` has already been declared [Error]`;
const octal = "'0'-prefixed octal literals and octal escape sequences are deprecated [Error]";

describe.concurrent("bun lint with an .oxlintrc.json, and a file that oxc refuses", () => {
  test("--type-aware prints oxc's errors in oxc's order, and what the rules that need types report", async () => {
    const files = {
      "tsconfig.json": tsconfig,
      ".oxlintrc.json": oxlintrc(),
      "e.json": "{}\n",
      // Not in the order of the text.
      "a.ts": "let b = 1; let a = 1;\nlet a = 2; let b = 2;\nexport { a, b };\n",
      // TypeScript's parser has an error of its own for each of these two, which leaves its tree whole.
      "b.ts": "declare const p: Promise<number>;\nvar n = 010;\nlet a = 1; let a = 2;\np;\nexport { a, n };\n",
      "c.ts":
        'import a from "./e.json" assert { type: "json" };\ndeclare const p: Promise<number>;\n' +
        "function f(b: number, b: number) { return b; }\np;\nexport { a, f };\n",
      // oxlint says nothing about a file with `@flow` that oxc cannot parse.
      "d.js":
        "// @flow\nconst p = Promise.resolve(1);\np;\nfunction f(a: number) { return a; }\nvar z = f(1);\nString(z);\n",
      // Not what oxlint prints: TypeScript's parser has an error that counts for these two, so its tree has holes and no rule
      // runs on it. oxlint also has `2:1` no-floating-promises in e.ts and `4:1` in g.js.
      "e.ts": "declare const p: Promise<number>;\np;\nexport const y = ;\n",
      "g.js": "// @flow\nopaque type C = number;\nconst q = Promise.resolve(1);\nq;\n",
    };
    const { stdout, exitCode } = await lint(files, ["--type-aware", "-f", "unix"]);
    expect(reported(stdout)).toEqual({
      "a.ts": [`1:16: ${redeclared("a")}`, `1:5: ${redeclared("b")}`],
      "b.ts": [`2:9: ${octal}`, `3:5: ${redeclared("a")}`, `4:1: ${floating}`],
      "c.ts": [`3:12: ${redeclared("b")}`, `4:1: ${floating}`],
      "d.js": [`3:1: ${floating}`],
      "e.ts": ["3:18: Unexpected token [Error]"],
    });
    expect(exitCode).toBe(1);
  });

  test("--type-aware --fix applies the fixes of the rules that need types beside an error that oxc tolerates", async () => {
    const rules = { "typescript/no-unnecessary-type-assertion": "error", "typescript/dot-notation": "error" };
    const files = {
      "tsconfig.json": tsconfig,
      ".oxlintrc.json": oxlintrc({ rules }),
      "b.ts": "declare const b: number;\nvar n = 010;\nexport const x = b as number;\nexport { n };\n",
      "d.js": '// @flow\nconst o = { b: 1 };\nfunction f(a: number) { return a; }\nexport const x = o["b"] + f(1);\n',
      // Not what oxlint does, which takes the assertion out: no rule runs on a tree with holes.
      "e.ts": "declare const b: number;\nexport const x = b as number;\nexport const y = ;\n",
    };
    const read = ["b.ts", "d.js", "e.ts"];
    const { stdout, texts, exitCode } = await lint(files, ["--type-aware", "--fix", "-f", "unix"], read);
    expect({ reported: reported(stdout), texts }).toEqual({
      reported: { "b.ts": [`2:9: ${octal}`], "e.ts": ["3:18: Unexpected token [Error]"] },
      texts: {
        "b.ts": "declare const b: number;\nvar n = 010;\nexport const x = b;\nexport { n };\n",
        "d.js": "// @flow\nconst o = { b: 1 };\nfunction f(a: number) { return a; }\nexport const x = o.b + f(1);\n",
        "e.ts": files["e.ts"],
      },
    });
    expect(exitCode).toBe(1);
  });

  test("--type-aware parses a file that oxc does not refuse once", async () => {
    const clean = "declare const p: Promise<number>;\nvoid p;\nexport {};\n";
    /** How many times the parser runs. */
    const parsed = async (files: Record<string, string>) => {
      const all = { "tsconfig.json": tsconfig, ".oxlintrc.json": oxlintrc(), ...files };
      const { stderr } = await lint(all, ["--type-aware", "--timing"]);
      return Number(/fast parser: (\d+) files/.exec(stderr)?.[1]);
    };
    const [one, two] = await Promise.all([parsed({ "a.ts": clean }), parsed({ "a.ts": clean, "b.ts": clean })]);
    expect(two - one).toBe(1);
  });
});
