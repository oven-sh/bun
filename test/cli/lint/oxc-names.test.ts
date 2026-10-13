// Errors about names that oxlint has and ESLint's parsers word differently or don't have: a name that is declared twice, what a
// JavaScript module exports, `await` in a static block. Every expectation is what oxlint 1.87 prints with `-f json`.
// The large tables (every pair of declarations, assignment targets) are in lint.test.ts.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
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

type Diagnostic = {
  filename: string;
  severity: string;
  message: string;
  help?: string;
  labels: { span: { offset: number; length: number; line: number } }[];
};

async function lint(files: Record<string, string>, flags: string[]) {
  const dir = tempDir("bun-lint-oxc-names", files);
  await using proc = spawn({
    cmd: [bunExe(), "lint", ...flags],
    env,
    cwd: String(dir),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { dir, stdout, stderr, exitCode };
}

// Which names are declared twice is found in two ways. With no-unused-vars on, as in `{}`, the variables of every file are there to
// be asked. Without it the parser looks out for a file that may have such a name.
const configs: [string, string][] = [
  ["no rule needs the variables", JSON.stringify({ categories: { correctness: "off" }, rules: {} })],
  ["no-unused-vars is on", JSON.stringify({ categories: { correctness: "off" }, rules: { "no-unused-vars": "warn" } })],
];

type Row = [extension: string, code: string, errors: string];

/** The rows with what is printed: "message (help) offset+length,offset+length | ..", in order. "": the file is linted. */
async function found(rows: Row[], config: string) {
  const files = Object.fromEntries(rows.map(([extension, code], i) => [`a${i}.${extension}`, code + "\n"]));
  const result = await lint({ ".oxlintrc.json": config, ...files }, ["-f", "json"]);
  using _ = result.dir;
  expect(result.stderr).toBe("");
  const errors = (JSON.parse(result.stdout).diagnostics as Diagnostic[]).filter(it => it.severity === "error");
  const print = ({ message, help, labels }: Diagnostic) =>
    `${message}${help ? ` (${help})` : ""} ${labels.map(({ span }) => `${span.offset}+${span.length}`).join(",")}`;
  return rows.map(([extension, code], i): Row => {
    const ofFile = errors.filter(it => it.filename === `a${i}.${extension}`);
    return [extension, code, ofFile.map(print).join(" | ")];
  });
}

const declared = (name: string, labels: string) => `Identifier \`${name}\` has already been declared ${labels}`;

describe.each(configs)("beside an .oxlintrc.json, when %s", (_, config) => {
  // oxc looks for these when it is through with the file, and goes through the hash table of the file's names.
  test.concurrent("imports that are declared again come in oxlint's order", async () => {
    const rows: Row[] = [
      [
        "mjs",
        'import alpha from "m"; import beta from "m"; import gamma from "m"; var alpha, beta, gamma;',
        [declared("gamma", "52+5,85+5"), declared("alpha", "7+5,72+5"), declared("beta", "30+4,79+4")].join(" | "),
      ],
      [
        "mjs",
        'import a from "a"; import b from "b"; import c from "c"; let a, b, c;',
        [declared("c", "45+1,67+1"), declared("b", "26+1,64+1"), declared("a", "7+1,61+1")].join(" | "),
      ],
      [
        "mjs",
        'import first from "m"; const other = 1; import second from "m"; function third() {} import fourth from "m"; let fourth, second, first;',
        [declared("first", "7+5,128+5"), declared("second", "47+6,120+6"), declared("fourth", "91+6,112+6")].join(
          " | ",
        ),
      ],
      [
        "mjs",
        'import { a, b } from "a"; class a {} function b() {}',
        [declared("b", "12+1,46+1"), declared("b", "12+1,46+1"), declared("a", "9+1,32+1")].join(" | "),
      ],
    ];
    expect(await found(rows, config)).toEqual(rows);
  });

  test.concurrent('a member of an enum that is written as ["A"] has the name A', async () => {
    const rows: Row[] = [
      ["ts", "enum E { ['A'], A }", declared("A", "10+3,16+1")],
      ["ts", "enum E { A, ['A'] }", declared("A", "9+1,13+3")],
      ["ts", "enum E { [`A`], 'A' }", declared("A", "10+3,16+3")],
      ["ts", "enum E { ['A'], B }", ""],
      ["ts", "enum E { ['A'] } enum E { A }", ""],
    ];
    expect(await found(rows, config)).toEqual(rows);
  });

  test.concurrent("what a JavaScript module exports has to be declared at the top", async () => {
    const rows: Row[] = [
      // A module is strict, so the function stays in its block.
      ["js", "{ function f() {} }\nexport { f };", "Export 'f' is not defined 29+1"],
      ["js", "if (x) { let f; }\nexport { f };", "Export 'f' is not defined 27+1"],
      ["js", 'import { i as j } from "m";\nexport { i };', "Export 'i' is not defined (Did you mean 'j'?) 37+1"],
      ["js", "{ var f; }\nexport { f };", ""],
      ["js", "const [f] = [];\nexport { f };", ""],
      ["js", "function f() {}\nexport { f };", ""],
      ["js", 'import f, * as g from "m"; import { h, i as j } from "m";\nexport { f, g, h, j };', ""],
      // Of names that are as close, the one that oxc's hash table has first.
      ["js", "const ab = 1, ac = 1, ad = 1;\nexport { aa };", "Export 'aa' is not defined (Did you mean 'ad'?) 39+2"],
      [
        "js",
        "const value1 = 1, value2 = 1, value3 = 1, value4 = 1;\nexport { value };",
        "Export 'value' is not defined (Did you mean 'value1'?) 63+5",
      ],
    ];
    expect(await found(rows, config)).toEqual(rows);
  });

  test.concurrent("`await` in a static block is refused only where oxc's scope is that of the block", async () => {
    const inBlock = "Cannot use await in class static initialization block";
    const rows: Row[] = [
      ["ts", "class W { static { enum E { A = await } } }", ""],
      ["ts", "class W { static { type A<T> = T extends infer await ? 1 : 2; } }", ""],
      ["ts", "class W { static { type A = { [await in 'a']: 1 }; } }", ""],
      ["ts", "class W { static { interface A extends await {} } }", ""],
      ["ts", "class W { static { type A<await> = 1; } }", ""],
      ["ts", "class W { static { interface A<await> {} } }", ""],
      ["ts", "class W { static { type await = 1; } }", `${inBlock} 24+5`],
      ["ts", "class W { static { enum await {} } }", `${inBlock} 24+5`],
    ];
    expect(await found(rows, config)).toEqual(rows);
  });
});

// The check of the exports used to index a list that has holes after the parser gives up: "index out of bounds".
test.each([
  ["export const b = 1;\nx y;", 2],
  ['import { a } from "b";\nwidget W() {\n  a();\n}', 7],
  ["export { nope };\nf() {}", 4],
])("a JavaScript module that doesn't parse gets the parser's error alone: %j", async (code, column) => {
  const result = await lint({ ".oxlintrc.json": "{}", "a.js": code + "\n" }, ["-f", "unix"]);
  using _ = result.dir;
  expect(result.stdout.split("\n").filter(line => line.startsWith("a.js:"))).toEqual([
    `a.js:2:${column}: Expected a semicolon or an implicit semicolon after a statement, but found none [Error]`,
  ]);
  expect(result.exitCode).toBe(1);
});
