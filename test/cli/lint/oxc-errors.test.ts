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

type Label = { label?: string; span: { offset: number; length: number } };
type Diagnostic = { filename: string; code?: string; message: string; help?: string; labels: Label[] };

/** What `bun lint -f json` prints for `files` beside an .oxlintrc.json, file by file, in the order in which it is printed. */
async function diagnosticsOf(files: Record<string, string>, config: object) {
  using dir = tempDir("bun-lint-oxc-errors", { ".oxlintrc.json": JSON.stringify(config), ...files });
  await using proc = spawn({
    cmd: [bunExe(), "lint", "-f", "json"],
    env,
    cwd: String(dir),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const found: Record<string, Diagnostic[]> = Object.fromEntries(Object.keys(files).map(name => [name, []]));
  for (const it of JSON.parse(stdout).diagnostics as Diagnostic[]) found[it.filename].push(it);
  return found;
}

/** "code | message | help | offset+length text of the label | .." */
const said = ({ code, message, help, labels }: Diagnostic) =>
  [
    code ?? "",
    message,
    help ?? "",
    ...labels.map(({ label, span }) => `${span.offset}+${span.length} ${label ?? ""}`.trim()),
  ].join(" | ");

type Row = [extensions: string, code: string, errors: string[]];

/** Every error of every row, in order. `[]`: the file is linted, and no rule is on. */
async function expectErrors(rows: Row[]) {
  const cases = rows.flatMap(([extensions, code, errors], i) =>
    extensions.split(" ").map(extension => ({ name: `a${i}.${extension}`, code, errors })),
  );
  const files = Object.fromEntries(cases.map(({ name, code }) => [name, code + "\n"]));
  const found = await diagnosticsOf(files, { categories: { correctness: "off" } });
  expect(cases.map(({ name, code }) => [name, code, found[name].map(said)])).toEqual(
    cases.map(({ name, code, errors }) => [name, code, errors]),
  );
}

// Each row is what oxlint 1.87 prints with `-f json`.
const rows: Row[] = [
  [
    "js",
    "let a; export { a, a };\nnew.foo;",
    [
      " | The only valid meta property for new is new.target |  | 24+7",
      " | Duplicated export 'a' |  | 16+1 Export has already been declared here | 19+1 It cannot be redeclared here",
    ],
  ],
  [
    "js",
    "export default 1; export default 2;\nnew.foo;",
    [
      " | The only valid meta property for new is new.target |  | 36+7",
      "TS(2528) | A module cannot have multiple default exports. |  | 7+7 | 25+7",
    ],
  ],
  [
    "js ts",
    "const { a };",
    [" | Missing initializer in destructuring declaration | Add an initializer (e.g. ` = undefined`) here | 6+5"],
  ],
  [
    "js ts",
    "const [a];",
    [" | Missing initializer in destructuring declaration | Add an initializer (e.g. ` = undefined`) here | 6+3"],
  ],
  [
    "js ts",
    "let [a];",
    [" | Missing initializer in destructuring declaration | Add an initializer (e.g. ` = undefined`) here | 4+3"],
  ],
  ["js ts", "try {} catch ([a]) {}", []],
  ["js ts", "for (const [a] of b) ;", []],
  ["js ts", "new a?.b();", [" | Invalid optional chain from new expression. |  | 5+2"]],
  [
    "js ts",
    "-1 ** 2;",
    [
      " | A unary expression with the '-' operator cannot be used as the left operand of an exponentiation expression | Wrap the unary expression in parentheses to make the precedence explicit | 0+2",
    ],
  ],
  [
    "js ts",
    "typeof a ** 2;",
    [
      " | A unary expression with the 'typeof' operator cannot be used as the left operand of an exponentiation expression | Wrap the unary expression in parentheses to make the precedence explicit | 0+8",
    ],
  ],
  [
    "js ts",
    "async () => await a ** 2;",
    [
      " | A unary expression with the 'await' operator cannot be used as the left operand of an exponentiation expression | Wrap the unary expression in parentheses to make the precedence explicit | 12+7",
    ],
  ],
  ["js ts", "var enum;", [" | Identifier expected. 'enum' is a reserved word that cannot be used here. |  | 4+4"]],
  [
    "js ts",
    "super;",
    [
      " | 'super' can only be used with function calls or in property accesses | Replace with `super()` or `super.prop` or `super[prop]` | 0+5",
    ],
  ],
  [
    "js ts",
    "class A { m(){ super; } }",
    [
      " | 'super' can only be used with function calls or in property accesses | Replace with `super()` or `super.prop` or `super[prop]` | 15+5",
    ],
  ],
  [
    "js",
    "if (1) let a;",
    [
      " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 10+0",
    ],
  ],
  [
    "js",
    "label: let a;",
    [
      " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 10+0",
    ],
  ],
  [
    "js ts",
    "class A extends (010, B) {}",
    [
      " | '0'-prefixed octal literals and octal escape sequences are deprecated | for octal literals use the '0o' prefix instead | 17+3",
    ],
  ],
  ["js ts", "function f(){ new.t\\u0061rget; }", [" | Keywords cannot contain escape characters |  | 18+11"]],
  [
    "js ts",
    'class A { async *"constructor"(){} }',
    [" | Constructor can't be an async method |  | 17+13", " | Constructor can't be a generator |  | 17+13"],
  ],
  [
    "js ts",
    "class A { async *constructor(){} }",
    [" | Constructor can't be an async method |  | 17+11", " | Constructor can't be a generator |  | 17+11"],
  ],
  [
    "js",
    "class A { static get #a(){ return 1 } set #a(v){} }",
    [
      " | Identifier `#a` has already been declared |  | 21+2 `#a` has already been declared here | 42+2 It can not be redeclared here",
    ],
  ],
  [
    "ts",
    "class A { static get #a(){ return 1 } set #a(v){} }",
    [
      "TS(2804) | Duplicate identifier `#a`. Static and instance elements cannot share the same private name. |  | 21+2 `#a` has already been declared here | 42+2 It can not be redeclared here",
    ],
  ],
  [
    "js",
    "class A { static #a; #a; }",
    [
      " | Identifier `#a` has already been declared |  | 17+2 `#a` has already been declared here | 21+2 It can not be redeclared here",
    ],
  ],
  [
    "ts",
    "class A { static #a; #a; }",
    [
      "TS(2804) | Duplicate identifier `#a`. Static and instance elements cannot share the same private name. |  | 17+2 `#a` has already been declared here | 21+2 It can not be redeclared here",
    ],
  ],
  [
    "ts",
    "with (a) function f(){}",
    [
      " | Invalid function declaration | In non-strict mode code, functions can only be declared at top level, inside a block, or as the body of an if statement | 9+14",
      " | 'with' statements are not allowed |  | 0+4",
    ],
  ],
  [
    "js",
    '"use strict"; with (a) function f(){}',
    [
      " | Invalid function declaration | In strict mode code, functions can only be declared at top level or inside a block | 23+14",
      " | 'with' statements are not allowed |  | 14+4",
    ],
  ],
  [
    "ts",
    "with (a) { with (b) {} }",
    [" | 'with' statements are not allowed |  | 11+4", " | 'with' statements are not allowed |  | 0+4"],
  ],
  [
    "ts",
    "with (a) { break; }",
    [
      " | Illegal break statement | A `break` statement can only be used within an enclosing iteration or switch statement. | 11+6",
      " | 'with' statements are not allowed |  | 0+4",
    ],
  ],
  [
    "ts",
    "if (1) declare const a: number;",
    [" | Declaration cannot appear in a single-statement context | Wrap this declaration in a block statement | 7+24"],
  ],
  [
    "js ts",
    "if (1) const a = 1;",
    [
      " | Lexical declaration cannot appear in a single-statement context | Wrap this declaration in a block statement | 7+12",
    ],
  ],
  [
    "js ts",
    "({ a = 1 }) = {};",
    [
      " | Cannot assign to this expression |  | 0+11",
      " | Invalid assignment in object literal | Did you mean to use a ':'? An '=' can only follow a property name when the containing object literal is part of a destructuring pattern. | 3+5",
    ],
  ],
  [
    "js ts",
    "(({ a = 1 }) = {});",
    [
      " | Cannot assign to this expression |  | 1+11",
      " | Invalid assignment in object literal | Did you mean to use a ':'? An '=' can only follow a property name when the containing object literal is part of a destructuring pattern. | 4+5",
    ],
  ],
  [
    "js ts",
    "[({ a = 1 })] = [];",
    [
      " | Cannot assign to this expression |  | 1+11",
      " | Invalid assignment in object literal | Did you mean to use a ':'? An '=' can only follow a property name when the containing object literal is part of a destructuring pattern. | 4+5",
    ],
  ],
  [
    "js ts",
    "({ a = 1 }); const b;",
    [
      " | Missing initializer in const declaration | Add an initializer (e.g. ` = undefined`) here | 19+1",
      " | Invalid assignment in object literal | Did you mean to use a ':'? An '=' can only follow a property name when the containing object literal is part of a destructuring pattern. | 3+5",
    ],
  ],
  [
    "js ts",
    "({ a = 1 }); ({ b = 1 });",
    [
      " | Invalid assignment in object literal | Did you mean to use a ':'? An '=' can only follow a property name when the containing object literal is part of a destructuring pattern. | 3+5",
      " | Invalid assignment in object literal | Did you mean to use a ':'? An '=' can only follow a property name when the containing object literal is part of a destructuring pattern. | 16+5",
    ],
  ],
  ["js ts", "#x in o;", [" | Private identifier '#x' is not allowed outside class bodies |  | 0+2"]],
  [
    "js ts",
    "function f() { return #x in o; }",
    [" | Private identifier '#x' is not allowed outside class bodies |  | 22+2"],
  ],
  [
    "js ts",
    "class A extends (#x in o) { #x }",
    [" | Private identifier '#x' is not allowed outside class bodies |  | 17+2"],
  ],
  [
    "js ts",
    "class A extends (o.#x) { #x }",
    [" | Private identifier '#x' is not allowed outside class bodies |  | 19+2"],
  ],
  ["js ts", "@(o.#x) class A { #x }", [" | Private identifier '#x' is not allowed outside class bodies |  | 4+2"]],
  ["js ts", "@(#x in o) class A { #x }", [" | Private identifier '#x' is not allowed outside class bodies |  | 2+2"]],
  ["js ts", "class A { @(o.#x) m() {} #x }", []],
  ["js ts", "class A { [#x in o]; #x }", []],
  [
    "js ts",
    "class B { m() { class A extends (o.#x) { #x } } }",
    [" | Private field '#x' must be declared in an enclosing class |  | 35+2"],
  ],
  [
    "js ts",
    "class B { m() { return class extends (#x in o) { #x } } }",
    [" | Private field '#x' must be declared in an enclosing class |  | 38+2"],
  ],
  [
    "js ts",
    "class A { m() { return #y in o; } }",
    [" | Private field '#y' must be declared in an enclosing class |  | 23+2"],
  ],
  [
    "js ts",
    "for (let a = 1 in b) ; let c; let c;",
    [" | for-in loop variable declaration may not have an initializer |  | 5+9"],
  ],
  [
    "js ts",
    "for (var a = 1 of b) ; const c;",
    [" | Missing initializer in const declaration | Add an initializer (e.g. ` = undefined`) here | 29+1"],
  ],
];

// oxc can't parse Flow, and oxlint says nothing about a file with `@flow` in its first comment that oxc's parser has an error
// for. Where the parser has none, it prints what the pass that builds the scopes finds.
const flow: Row[] = [
  [
    "js",
    "// @flow\nlet a; let a;",
    [
      " | Identifier `a` has already been declared |  | 13+1 `a` has already been declared here | 20+1 It can not be redeclared here",
    ],
  ],
  [
    "js",
    "// @flow\nclass A { constructor(){} constructor(){} }",
    [
      " | Multiple constructor implementations are not allowed. |  | 19+11 constructor has already been declared here | 35+11 it cannot be redeclared here",
    ],
  ],
  ["js", "// @flow\nexport {}; with (a) {}", [" | 'with' statements are not allowed |  | 20+4"]],
  [
    "js",
    "// @flow\nbreak;",
    [
      " | Illegal break statement | A `break` statement can only be used within an enclosing iteration or switch statement. | 9+6",
    ],
  ],
  [
    "js",
    "// @flow\nfunction f(){ super.x; }",
    [" | 'super' can only be referenced in members of derived classes or object literal expressions. |  | 23+5"],
  ],
  ["js", "// @flow\n#x in o;", [" | Private identifier '#x' is not allowed outside class bodies |  | 9+2"]],
  ["js", "// @flow\nexport { a };", [" | Export 'a' is not defined |  | 18+1"]],
  [
    "js",
    '// @flow\n"use strict"; 010;',
    [
      " | '0'-prefixed octal literals and octal escape sequences are deprecated | for octal literals use the '0o' prefix instead | 23+3",
    ],
  ],
  ["js", "// @flow\nconst a;", []],
  ["js", "// @flow\nnew.target;", []],
  ["js", "// @flow\nlet a; let a; const b;", []],
  ["js", "// @flow\nx = /(/;", []],
  ["js", "// @flow\nfor (let a = 1 in b) ;", []],
  ["js", "// @flow\nclass A { get a(b) {} }", []],
  [
    "js",
    "let a; let a;\n// @flow",
    [
      " | Identifier `a` has already been declared |  | 4+1 `a` has already been declared here | 11+1 It can not be redeclared here",
    ],
  ],
];

describe.concurrent("bun lint with .oxlintrc.json", () => {
  test("has every error of a file that oxc refuses, in oxlint's order and words", async () => {
    await expectErrors(rows);
  });

  test("prints the errors of oxc's scopes about a file with @flow, and none of its parser", async () => {
    await expectErrors(flow);
  });

  // The labels of oxlint 1.87.
  test("no-unused-vars labels a name as it is written, with its escapes", async () => {
    const files = {
      "a.js": "const X\\u0065 = 1;\n",
      "b.js": "function f\\u0065() {}\n",
      "c.js": 'import { a as b\\u0065 } from "m";\n',
      "d.js": "try {} catch (e\\u{65}) {}\n",
      "e.js": "const \u00e9 = 1;\n",
    };
    const found = await diagnosticsOf(files, {
      categories: { correctness: "off" },
      rules: { "no-unused-vars": "error" },
    });
    const labels = Object.entries(found).map(([name, all]) => [
      name,
      ...all.map(({ labels: [{ span }] }) => `${span.offset}+${span.length}`),
    ]);
    expect(labels).toEqual([
      ["a.js", "6+7"],
      ["b.js", "9+7"],
      ["c.js", "14+7"],
      ["d.js", "14+7"],
      ["e.js", "6+2"],
    ]);
  });

  // The labels of oxlint 1.87, for which a line separator ends no line.
  test("no-irregular-whitespace lets a line separator pass that ends a // comment", async () => {
    const files = {
      "a.js": "a; // c\u2028b;\n",
      "b.js": "a; // c\u2029b;\n",
      "c.js": "a; // c\u2028\u2028b;\n",
      "d.js": "a;\u2028b;\n",
      "e.js": "a; /* c\u2028d */ b;\n",
      "f.js": "// c\u2028",
      "g.js": "a;\u2028\u2028b;\n",
      "h.js": "a;\nb;\u2028c;\u2028d;\n",
    };
    const rules = { "no-irregular-whitespace": "error" };
    const found = await diagnosticsOf(files, { categories: { correctness: "off" }, rules });
    type Span = { offset: number; length: number; line: number; column: number };
    const places = Object.entries(found).map(([name, all]) => [
      name,
      ...all.map(({ labels: [{ span }] }) => {
        const { offset, length, line, column } = span as Span;
        return `${offset}+${length} ${line}:${column}`;
      }),
    ]);
    expect(places).toEqual([
      ["a.js"],
      ["b.js"],
      ["c.js", "10+3 1:11"],
      ["d.js", "2+3 1:3"],
      ["e.js", "7+3 1:8"],
      ["f.js"],
      ["g.js", "2+3 1:3", "5+3 1:6"],
      ["h.js", "5+3 2:3", "10+3 2:8"],
    ]);
  });
});
