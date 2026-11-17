import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

const env = { ...bunEnv, AGENT: "0", CLAUDECODE: undefined, GITHUB_ACTIONS: undefined };

const ast = "src/lint/ast";
const runner = "src/lint/runner.rs";
const references = "src/lint/semantic/references.rs";
const scopes = "src/lint/semantic/scopes.rs";
const attach = "src/format/js/attach";

type Message = { ruleId: string | null; line: number; column: number; message: string };

const tsconfig = JSON.stringify({ compilerOptions: { allowJs: true, checkJs: true, noEmit: true, types: [] } });
// Only a file that is linted from the type checker's tree gets the type checker's errors.
const typeError = '/** @type {number} */\nvar mistyped = "";\n';

async function lint(code: string, rule: string, types: "with types" | "without types"): Promise<string[]> {
  const hasTypes = types === "with types";
  using dir = tempDir("bun-lint-tree-kinds", {
    "a.js": hasTypes ? code + typeError : code,
    ".eslintrc.json": JSON.stringify({
      root: true,
      parserOptions: { ecmaVersion: 2022, sourceType: "script", ecmaFeatures: { jsx: true } },
      rules: { [rule]: "error" },
    }),
    ...(hasTypes ? { "tsconfig.json": tsconfig } : {}),
  });
  await using proc = spawn({
    cmd: [bunExe(), "lint", "-f", "json", ...(hasTypes ? ["--type-aware", "--type-check"] : []), "a.js"],
    env,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (!stdout.startsWith("[")) throw new Error(`exit code ${exitCode}\n${stdout}\n${stderr}`);
  const results: { messages: Message[] }[] = JSON.parse(stdout);
  if (results.length !== 1) throw new Error(`expected one result, for a.js\n${stdout}\n${stderr}`);
  const [{ messages }] = results;
  const failure = messages.find(it => it.ruleId === null);
  if (failure) throw new Error(failure.message);
  if (hasTypes && !messages.some(it => it.ruleId === "typescript/TS2322")) {
    throw new Error(`a.js was linted without types\n${stdout}\n${stderr}`);
  }
  return messages.filter(it => it.ruleId === rule).map(it => `${it.line}:${it.column}`);
}

async function fmt(name: string, code: string): Promise<string> {
  using dir = tempDir("bun-fmt-tree-kinds", { [name]: code });
  await using proc = spawn({ cmd: [bunExe(), "fmt", name], env, cwd: String(dir), stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(exitCode, `${stdout}\n${stderr}`).toBe(0);
  return await Bun.file(`${dir}/${name}`).text();
}

type LintCase = [source: string, title: string, code: string, rule: string, expected: string[]];
type FormatCase = [source: string, title: string, name: string, code: string, expected: string];

describe.concurrent("bun lint", () => {
  test.each<LintCase>([
    [ast, "a two-statement block is not a `with` statement", "with (a) { b(); }\n{ a; b(); }", "no-with", ["1:1"]],
    [
      ast,
      "the object of a `with` statement is not an expression statement",
      "with (a) b;",
      "no-unused-expressions",
      ["1:10"],
    ],
    [
      ast,
      "a string after the directive prologue is an expression statement",
      '"use strict";\n"b";\nc;\n"d";',
      "no-unused-expressions",
      ["3:1", "4:1"],
    ],
    [ast, "a parenthesized string is not a directive", '("use strict");', "no-unused-expressions", ["1:1"]],
    [
      ast,
      "a function body starts with a directive prologue",
      'function f() {\n"use strict";\nf;\n}',
      "no-unused-expressions",
      ["3:1"],
    ],
    [
      ast,
      "a template without substitutions is a template literal",
      'const a = <a>javascript:</a>;\nconst b = "javascript:";\nconst c = `javascript:`;',
      "no-script-url",
      ["2:11", "3:11"],
    ],
    [
      ast,
      "an escape sequence in JSX text is not one in a string literal",
      'const a = <a>\\8</a>;\nconst b = "\\8";',
      "no-nonoctal-decimal-escape",
      ["2:12"],
    ],
    [
      ast,
      "JSX text that starts with a backtick is not a template literal",
      "const a = <a>`javascript:`</a>;",
      "no-script-url",
      [],
    ],
    [
      `${ast}, ${runner}`,
      "a regular expression literal is not a string literal",
      'const a = /a  b/;\nconst b = "a  b";',
      "no-regex-spaces",
      ["1:11"],
    ],
    [
      references,
      "a declared `with` object resolves, and a free name in the body does not",
      "var o; with (o) { x; }",
      "no-undef",
      ["1:19"],
    ],
    [references, "an undeclared `with` object does not resolve", "with (p) {}", "no-undef", ["1:7"]],
    [
      scopes,
      "a `use strict` directive makes the function strict",
      'function f() {\n"use strict";\nthis.a;\n}',
      "no-invalid-this",
      ["3:1"],
    ],
    [
      scopes,
      "a `use strict` directive after another directive makes the function strict",
      'function f() {\n"a";\n"use strict";\nthis.a;\n}',
      "no-invalid-this",
      ["4:1"],
    ],
    [
      scopes,
      "a parenthesized `use strict` string leaves the function sloppy",
      'function f() {\n("use strict");\nthis.a;\n}',
      "no-invalid-this",
      [],
    ],
    [
      scopes,
      "a `use strict` template literal leaves the function sloppy",
      "function f() {\n`use strict`;\nthis.a;\n}",
      "no-invalid-this",
      [],
    ],
    [
      scopes,
      "a `use strict` string after a statement leaves the function sloppy",
      'function f() {\nf();\n"use strict";\nthis.a;\n}',
      "no-invalid-this",
      [],
    ],
    [
      scopes,
      "a `use strict` directive written with an escape sequence leaves the function sloppy",
      'function f() {\n"use\\x20strict";\nthis.a;\n}',
      "no-invalid-this",
      [],
    ],
  ])("%s: %s", async (_source, _title, code, rule, expected) => {
    expect(await lint(code + "\n", rule, "without types")).toEqual(expected);
  });

  test.each<LintCase>([
    [
      scopes,
      "a `use strict` directive below a JSDoc `@typedef` makes the function strict",
      'function f() {\n/** @typedef {number} N */\n"use strict";\nthis.a;\n}',
      "no-invalid-this",
      ["4:1"],
    ],
    [
      scopes,
      "a `use strict` string after a statement with a JSDoc `@typedef` leaves the function sloppy",
      'function f() {\n/** @typedef {number} N */\nf();\n"use strict";\nthis.a;\n}',
      "no-invalid-this",
      [],
    ],
  ])("%s, with and without types: %s", async (_source, _title, code, rule, expected) => {
    const text = code + "\n";
    const reports = await Promise.all([lint(text, rule, "with types"), lint(text, rule, "without types")]);
    expect(reports).toEqual([expected, expected]);
  });
});

describe.concurrent("bun fmt", () => {
  test.each<FormatCase>([
    [ast, "prints a `with` statement", "a.cjs", "with(a){b}", "with (a) {\n  b;\n}\n"],
    [
      ast,
      "parenthesizes a string statement only after the directive prologue",
      "a.cjs",
      "'use strict';\na;\n'b';",
      '"use strict";\na;\n("b");\n',
    ],
    [ast, "prints JSX text as written", "a.jsx", "const a = <b>x &amp; y</b>;", "const a = <b>x &amp; y</b>;\n"],
    [
      ast,
      "prints a template without substitutions with backticks",
      "a.js",
      "const a = `b`;\nconst c = 'd';",
      'const a = `b`;\nconst c = "d";\n',
    ],
  ])("%s: %s", async (_source, _title, name, code, expected) => {
    expect(await fmt(name, code + "\n")).toBe(expected);
  });

  test.each([
    "with (a /* 1 */) b;",
    "with (/* 1 */ a) b;",
    "with /* 1 */ (a) b;",
    "with (a) /* 1 */ b;",
    "for (a /* 1 */; ; ) b;",
  ])(`${attach}: prints the comment once, and formatting again changes nothing: %s`, async code => {
    const once = await fmt("a.cjs", code + "\n");
    const twice = await fmt("a.cjs", once);
    expect(once.split("/* 1 */").length - 1, once).toBe(1);
    expect(twice).toBe(once);
  });
});
