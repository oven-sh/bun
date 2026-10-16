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
async function diagnosticsOf(files: Record<string, string>, config: object, flags: string[] = [], onStderr = "") {
  using dir = tempDir("bun-lint-oxc-errors", { ".oxlintrc.json": JSON.stringify(config), ...files });
  await using proc = spawn({
    cmd: [bunExe(), "lint", "-f", "json", ...flags],
    env,
    cwd: String(dir),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe(onStderr);
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

/** Everything that is printed about the file of every row, in order. Without a `config` no rule is on. */
async function expectErrors(rows: Row[], config: object = { categories: { correctness: "off" } }) {
  const cases = rows.flatMap(([extensions, code, errors], i) =>
    extensions.split(" ").map(extension => ({ name: `a${i}.${extension}`, code, errors })),
  );
  const files = Object.fromEntries(cases.map(({ name, code }) => [name, code + "\n"]));
  const found = await diagnosticsOf(files, config);
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
  ["js ts", "for (let a = 1 in b) ;", [" | for-in loop variable declaration may not have an initializer |  | 5+9"]],
  ["js ts", "for (var a = 1 of b) ;", [" | for-of loop variable declaration may not have an initializer |  | 5+9"]],
  ["js ts", "for (const a = 1 of b) ;", [" | for-of loop variable declaration may not have an initializer |  | 5+11"]],
  ["js ts", "for (using a = 1 of b) ;", [" | for-of loop variable declaration may not have an initializer |  | 5+11"]],
  ["js ts", "for (var [a] = 1 in b) ;", [" | for-in loop variable declaration may not have an initializer |  | 5+11"]],
  [
    "js ts",
    '"use strict"; for (var a = 1 in b) ;',
    [" | for-in loop variable declaration may not have an initializer |  | 19+9"],
  ],
  ["js ts", "for (var a = 1 in b) ;", []],
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

// Each row is what oxlint 1.87 prints with `-f json`, under the config of its table. No config: no rule is on.
const tables: [title: string, config: object | undefined, rows: Row[]][] = [
  [
    "errors that oxc's parser recovers from come before the one it stops at",
    undefined,
    [
      [
        "js ts",
        "const a;\nx y;",
        [
          " | Missing initializer in const declaration | Add an initializer (e.g. ` = undefined`) here | 6+1",
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 10+0",
        ],
      ],
      [
        "js ts",
        "x y;\nconst a;",
        [
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 1+0",
        ],
      ],
      [
        "js ts",
        "-1 ** 2; super; x y;",
        [
          " | A unary expression with the '-' operator cannot be used as the left operand of an exponentiation expression | Wrap the unary expression in parentheses to make the precedence explicit | 0+2",
          " | 'super' can only be used with function calls or in property accesses | Replace with `super()` or `super.prop` or `super[prop]` | 9+5",
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 17+0",
        ],
      ],
      [
        "js ts",
        "-1 ** 2; const a; -1 ** 2;",
        [
          " | A unary expression with the '-' operator cannot be used as the left operand of an exponentiation expression | Wrap the unary expression in parentheses to make the precedence explicit | 0+2",
          " | Missing initializer in const declaration | Add an initializer (e.g. ` = undefined`) here | 15+1",
          " | A unary expression with the '-' operator cannot be used as the left operand of an exponentiation expression | Wrap the unary expression in parentheses to make the precedence explicit | 18+2",
        ],
      ],
      [
        "js ts",
        "super; let a; let a;",
        [
          " | 'super' can only be used with function calls or in property accesses | Replace with `super()` or `super.prop` or `super[prop]` | 0+5",
        ],
      ],
      [
        "js ts",
        "function f() { await g(); }\nlet = ;",
        [
          " | `await` is only allowed within async functions and at the top levels of modules | Either remove this `await` or add the `async` keyword to the enclosing function | 15+5",
          " | Unexpected token |  | 34+1",
        ],
      ],
      [
        "js ts",
        "x = /(/;\nx y;",
        [
          " | Invalid regular expression: Unterminated capturing group | Add the missing closing delimiter | 5+1",
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 10+0",
        ],
      ],
      [
        "js ts",
        "class A { get a(b) {} }\nx y;",
        [
          " | A 'get' accessor must not have any formal parameters. | Remove these parameters here | 15+3",
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 25+0",
        ],
      ],
      [
        "js ts",
        "class A { async constructor() {} }\nx y;",
        [
          " | Constructor can't be an async method |  | 16+11",
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 36+0",
        ],
      ],
      [
        "js ts",
        "({ a = 1 });\nx y;",
        [
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 14+0",
          " | Invalid assignment in object literal | Did you mean to use a ':'? An '=' can only follow a property name when the containing object literal is part of a destructuring pattern. | 3+5",
        ],
      ],
      [
        "js ts",
        "x y;\n({ a = 1 });",
        [
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 1+0",
        ],
      ],
      ["js ts", "[a()] = b;\nx y;", [" | Cannot assign to this expression |  | 1+3"]],
      [
        "js ts",
        "if (1) const a = 1;\nx y;",
        [
          " | Lexical declaration cannot appear in a single-statement context | Wrap this declaration in a block statement | 7+12",
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 21+0",
        ],
      ],
      [
        "js ts",
        "new.target;\nx y;",
        [
          " | Unexpected new.target expression | new.target is only allowed in constructors, functions, and class field initializers | 0+10",
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 13+0",
        ],
      ],
      [
        "js ts",
        "let a; let a;\nx y;",
        [
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 15+0",
        ],
      ],
      [
        "js ts",
        "for (const a, b of c) ;\nx y;",
        [
          " | Only a single declaration is allowed in a `for...of` statement |  | 5+10",
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 25+0",
        ],
      ],
      [
        "js ts",
        'import defer a from "b";\nx y;',
        [
          "TS(18058) | Default imports are not allowed in a deferred import. |  | 7+5",
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 26+0",
        ],
      ],
      [
        "js ts",
        "for await (const a of b) ;\nfunction f() { for await (const a of b) ; }\nx y;",
        [
          " | `for await` loops are only allowed within async functions and at the top levels of modules | Either remove this `await` or add the `async` keyword to the enclosing function | 46+5",
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 72+0",
          " | `for await` loops are only allowed within async functions and at the top levels of modules | Either remove this `await` or add the `async` keyword to the enclosing function | 4+5",
        ],
      ],
      [
        "ts",
        "declare namespace A { declare const a: 1; }\nx y;",
        [
          "TS(1038) | A 'declare' modifier cannot be used in an already ambient context. |  | 22+7",
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 45+0",
        ],
      ],
      [
        "ts",
        "function f(a?, b) {}\nx y;",
        [
          "TS(1016) | A required parameter cannot follow an optional parameter. |  | 15+1",
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 22+0",
        ],
      ],
      [
        "ts",
        "class A { declare constructor: Function; }",
        [
          "TS(1031) | 'declare' modifier cannot appear on a constructor declaration. |  | 10+7",
          " | Expected `(` but found `:` |  | 29+1 `(` expected",
        ],
      ],
      [
        "js",
        "export { a, a }; let a;\nx y;",
        [
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 25+0",
          " | Duplicated export 'a' |  | 9+1 Export has already been declared here | 12+1 It cannot be redeclared here",
        ],
      ],
      [
        "js ts",
        "function* g() { function* yield() {} }\nx y;",
        [
          " | Cannot use `yield` as an identifier in a generator context |  | 26+5",
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 40+0",
        ],
      ],
      [
        "js ts",
        "async function f() { var await; }\nx y;",
        [
          " | Cannot use `await` as an identifier in an async context |  | 25+5",
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 35+0",
        ],
      ],
      [
        "js ts",
        'class A { constructor() {} "constructor"() {} }\nx y;',
        [
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 49+0",
        ],
      ],
      [
        "js ts",
        "a?.`b`;\nx y;",
        [
          " | Tagged template expressions are not permitted in an optional chain |  | 3+3",
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 9+0",
        ],
      ],
      [
        "js ts",
        "switch (a) { default: default: }\nx y;",
        [
          "TS(1113) | A 'default' clause cannot appear more than once in a 'switch' statement. |  | 13+8 First 'default' clause is here. | 22+8 Another 'default' clause cannot appear here.",
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 34+0",
        ],
      ],
      [
        "js ts",
        "try {}\nconst a;",
        [
          " | Missing catch or finally clause | Either unwrap this try block or add catch / finally clause | 6+0",
          " | Missing initializer in const declaration | Add an initializer (e.g. ` = undefined`) here | 13+1",
        ],
      ],
      [
        "js ts",
        "const a; try {}",
        [
          " | Missing initializer in const declaration | Add an initializer (e.g. ` = undefined`) here | 6+1",
          " | Missing catch or finally clause | Either unwrap this try block or add catch / finally clause | 15+0",
        ],
      ],
      [
        "cjs",
        'import a from "a"; const b;',
        [
          " | Cannot use import statement outside a module |  | 0+6",
          " | Missing initializer in const declaration | Add an initializer (e.g. ` = undefined`) here | 25+1",
        ],
      ],
      [
        "cjs",
        'const b; import a from "a";',
        [
          " | Missing initializer in const declaration | Add an initializer (e.g. ` = undefined`) here | 6+1",
          " | Cannot use import statement outside a module |  | 9+6",
        ],
      ],
      [
        "cjs",
        'import a from "a"; export {}; import.meta;',
        [
          " | Cannot use import statement outside a module |  | 0+6",
          " | Cannot use export statement outside a module |  | 19+6",
          " | Unexpected import.meta expression | import.meta is only allowed in module code | 30+11",
        ],
      ],
      [
        "cjs",
        "import.meta; await 1; let a; let a;",
        [
          " | Unexpected import.meta expression | import.meta is only allowed in module code | 0+11",
          " | `await` is only allowed within async functions and at the top levels of modules | Either remove this `await` or add the `async` keyword to the enclosing function | 13+5",
        ],
      ],
      [
        "cjs",
        "await 1; await 2;",
        [
          " | `await` is only allowed within async functions and at the top levels of modules | Either remove this `await` or add the `async` keyword to the enclosing function | 0+5",
          " | `await` is only allowed within async functions and at the top levels of modules | Either remove this `await` or add the `async` keyword to the enclosing function | 9+5",
        ],
      ],
      [
        "cjs",
        "for await (const a of b) ; import.meta;",
        [
          " | `for await` loops are only allowed within async functions and at the top levels of modules | Either remove this `await` or add the `async` keyword to the enclosing function | 4+5",
          " | Unexpected import.meta expression | import.meta is only allowed in module code | 27+11",
        ],
      ],
      [
        "cts",
        "import.meta; await 1;",
        [
          " | Unexpected import.meta expression | import.meta is only allowed in module code | 0+11",
          " | `await` is only allowed within async functions and at the top levels of modules | Either remove this `await` or add the `async` keyword to the enclosing function | 13+5",
        ],
      ],
      [
        "cts",
        'import a from "a"; await 1; const b;',
        [
          " | `await` is only allowed within async functions and at the top levels of modules | Either remove this `await` or add the `async` keyword to the enclosing function | 19+5",
          " | Missing initializer in const declaration | Add an initializer (e.g. ` = undefined`) here | 34+1",
        ],
      ],
      [
        "cjs",
        "export default 1; x y;",
        [
          " | Cannot use export statement outside a module |  | 0+6",
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 19+0",
        ],
      ],
      [
        "cjs",
        "await using a = b; import.meta;",
        [
          " | `await` is only allowed within async functions and at the top levels of modules | Either remove this `await` or add the `async` keyword to the enclosing function | 0+5",
          " | Unexpected import.meta expression | import.meta is only allowed in module code | 19+11",
        ],
      ],
    ],
  ],
  [
    "declaration lists, import phases and class bodies",
    undefined,
    [
      [
        "js ts",
        "for await (const a of b) ;\nconst c;",
        [
          " | Missing initializer in const declaration | Add an initializer (e.g. ` = undefined`) here | 33+1",
          " | `for await` loops are only allowed within async functions and at the top levels of modules | Either remove this `await` or add the `async` keyword to the enclosing function | 4+5",
        ],
      ],
      [
        "js ts",
        "for await (const a of b) ;\nfor await (const c of d) ;\nconst e;",
        [
          " | Missing initializer in const declaration | Add an initializer (e.g. ` = undefined`) here | 60+1",
          " | `for await` loops are only allowed within async functions and at the top levels of modules | Either remove this `await` or add the `async` keyword to the enclosing function | 4+5",
          " | `for await` loops are only allowed within async functions and at the top levels of modules | Either remove this `await` or add the `async` keyword to the enclosing function | 31+5",
        ],
      ],
      [
        "js ts",
        "for await (const a of b) ;\n({ a = 1 });",
        [
          " | Invalid assignment in object literal | Did you mean to use a ':'? An '=' can only follow a property name when the containing object literal is part of a destructuring pattern. | 30+5",
          " | `for await` loops are only allowed within async functions and at the top levels of modules | Either remove this `await` or add the `async` keyword to the enclosing function | 4+5",
        ],
      ],
      ["js ts", "let a,;", [" | Unexpected token |  | 6+1"]],
      ["js ts", "var a = 1,;", [" | Unexpected token |  | 10+1"]],
      ["js ts", "const a = 1,\nb = 2,;", [" | Unexpected token |  | 19+1"]],
      ["js ts", "let a,", [" | Unexpected token |  | 7+0"]],
      ["js ts", "for (let a, ; ;) ;", [" | Unexpected token |  | 12+1"]],
      ["js ts", "for (let a, of b) ;", [" | Expected `;` but found `Identifier` |  | 15+1 `;` expected"]],
      [
        "js ts",
        "let a,\nfoo();",
        [
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 10+0",
        ],
      ],
      ["js ts", "export let a,;", [" | Unexpected token |  | 13+1"]],
      ["js ts", "import.defer;", [" | Expected `(` but found `;` |  | 12+1 `(` expected"]],
      ["js ts", "import.source;", [" | Expected `(` but found `;` |  | 13+1 `(` expected"]],
      ["js ts", "import.defer.a;", [" | Expected `(` but found `.` |  | 12+1 `(` expected"]],
      ["js ts", "x = import.defer + 1;", [" | Expected `(` but found `+` |  | 17+1 `(` expected"]],
      ["js ts", 'import.defer\n("a");', []],
      ["js ts", "class A { a b }", [" | Expected `;` but found `Identifier` |  | 12+1 `;` expected"]],
      ["js ts", "class A { a b() {} }", [" | Expected `;` but found `Identifier` |  | 12+1 `;` expected"]],
      ["js ts", "class A { static static static; }", [" | Expected `;` but found `static` |  | 24+6 `;` expected"]],
      ["js ts", "class A { a = 1 b = 2 }", [" | Expected `;` but found `Identifier` |  | 16+1 `;` expected"]],
      ["js ts", "class A { a 1 }", [" | Expected `;` but found `decimal` |  | 12+1 `;` expected"]],
      ["js ts", 'class A { a "b" }', [" | Expected `;` but found `string` |  | 12+3 `;` expected"]],
      ["js ts", "class A { a #b }", [" | Expected `;` but found `#identifier` |  | 12+2 `;` expected"]],
      ["js ts", "class A { a [b] }", [" | Expected `;` but found `[` |  | 12+1 `;` expected"]],
      ["js ts", "class A { a * b() {} }", [" | Expected `;` but found `*` |  | 12+1 `;` expected"]],
      ["js ts", "class A { a + }", [" | Expected `;` but found `+` |  | 12+1 `;` expected"]],
      ["js ts", "class A { a `b` }", [" | Expected `;` but found `${}` |  | 12+3 `;` expected"]],
      ["js ts", "class A { a `b${c}` }", [" | Expected `;` but found `${` |  | 12+4 `;` expected"]],
      ["js ts", "class A { a 1n }", [" | Expected `;` but found `decimal bigint` |  | 12+2 `;` expected"]],
      ["js ts", "class A { a 0x1 }", [" | Expected `;` but found `hex` |  | 12+3 `;` expected"]],
      ["js ts", "class A { a 1.5 }", [" | Expected `;` but found `float` |  | 12+3 `;` expected"]],
      ["js ts", "class A { a get b() {} }", [" | Expected `;` but found `get` |  | 12+3 `;` expected"]],
      ["js ts", "class A { a if }", [" | Expected `;` but found `if` |  | 12+2 `;` expected"]],
      ["js ts", "class A { a\nb }", []],
      ["js ts", "class A { a = 1 +; }", [" | Unexpected token |  | 17+1"]],
      ["js ts", "class A { foo bar baz }", [" | Expected `;` but found `Identifier` |  | 14+3 `;` expected"]],
      ["js ts", "class A { get a }", [" | Expected `(` but found `}` |  | 16+1 `(` expected"]],
      ["js ts", "class A { async a }", [" | 'async' modifier cannot be used here. |  | 10+5"]],
      ["js ts", "class A { a.b }", [" | Expected `;` but found `.` |  | 11+1 `;` expected"]],
      ["js ts", "class A { a, b }", [" | Expected `;` but found `,` |  | 11+1 `;` expected"]],
      ["js", "class A { a: }", [" | Expected `;` but found `:` |  | 11+1 `;` expected"]],
      ["ts", "class A { a: }", [" | Unexpected token |  | 13+1"]],
      ["ts", "class A { a: number b }", [" | Expected `;` but found `Identifier` |  | 20+1 `;` expected"]],
      ["ts", "class A { a?: number b }", [" | Expected `;` but found `Identifier` |  | 21+1 `;` expected"]],
      ["ts", "class A { readonly a b }", [" | Expected `;` but found `Identifier` |  | 21+1 `;` expected"]],
      [
        "ts",
        "class A { a?!: number; }",
        [" | A property cannot be both optional and definite. | Remove either the `?` or the `!` | 11+2"],
      ],
      ["ts", "class A { a!?: number; }", [" | Expected `;` but found `?` |  | 12+1 `;` expected"]],
      [
        "ts",
        "class A { a?! }",
        [
          " | A property cannot be both optional and definite. | Remove either the `?` or the `!` | 11+2",
          "TS(1264) | Declarations with definite assignment assertions must also have type annotations. |  | 12+1",
        ],
      ],
      [
        "ts",
        "class A { a?!; b c }",
        [
          " | A property cannot be both optional and definite. | Remove either the `?` or the `!` | 11+2",
          "TS(1264) | Declarations with definite assignment assertions must also have type annotations. |  | 12+1",
          " | Expected `;` but found `Identifier` |  | 17+1 `;` expected",
        ],
      ],
      [
        "ts",
        'class A { "a"?!: number; }',
        [" | A property cannot be both optional and definite. | Remove either the `?` or the `!` | 13+2"],
      ],
      [
        "ts",
        "class A { a?!(): void }",
        [
          " | A property cannot be both optional and definite. | Remove either the `?` or the `!` | 11+2",
          " | Expected `;` but found `(` |  | 13+1 `;` expected",
        ],
      ],
      [
        "ts",
        "let a?!: number;",
        [
          " | Optional declaration is not allowed here | Remove the `?` | 5+1",
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 6+0",
        ],
      ],
      ["js ts", "class A { static constructor = 1 }", [" | Classes can't have a field named 'constructor' |  | 17+11"]],
      ["js ts", "class A { constructor = 1 }", [" | Expected `(` but found `=` |  | 22+1 `(` expected"]],
      ["js ts", "class A { constructor; }", [" | Expected `(` but found `;` |  | 21+1 `(` expected"]],
      ["js ts", "class A { static constructor; }", [" | Classes can't have a field named 'constructor' |  | 17+11"]],
      ["js ts", "class A { constructor }", [" | Expected `(` but found `}` |  | 22+1 `(` expected"]],
      ["js ts", 'class A { "constructor" = 1 }', [" | Classes can't have a field named 'constructor' |  | 10+13"]],
      ["js ts", 'class A { "constructor"; }', [" | Classes can't have a field named 'constructor' |  | 10+13"]],
      ["ts", "class A { constructor: Function; }", [" | Expected `(` but found `:` |  | 21+1 `(` expected"]],
      [
        "ts",
        "class A { static constructor: Function; }",
        [" | Classes can't have a field named 'constructor' |  | 17+11"],
      ],
      ["ts", "class A { constructor?: 1 }", [" | Expected `(` but found `?` |  | 21+1 `(` expected"]],
      ["js ts", "class A { constructor = 1; b c }", [" | Expected `(` but found `=` |  | 22+1 `(` expected"]],
      ["ts", "export let = 1;", [" | Unexpected token |  | 11+1"]],
      ["ts", "export let: for (;;) {}", [" | Unexpected token |  | 10+1"]],
      ["ts", "namespace W { export let(); }", [" | Unexpected token |  | 24+1"]],
      ["ts", "namespace W { export const = 1; }", [" | Unexpected token |  | 27+1"]],
      ["ts", "namespace W { export var: 1; }", [" | Unexpected token |  | 24+1"]],
      ["ts", "namespace W { export let }", [" | Unexpected token |  | 25+1"]],
      ["ts", "namespace W { export let; }", [" | Unexpected token |  | 24+1"]],
      ["ts", "namespace W { export let\n= 1; }", [" | Unexpected token |  | 25+1"]],
      ["ts", "namespace W { export declare let: 1; }", [" | Unexpected token |  | 32+1"]],
      ["ts", "declare let: 1;", [" | Unexpected token |  | 11+1"]],
      ["ts", "declare let = 1;", [" | Unexpected token |  | 12+1"]],
      ["js", "export let = 1;", [" | Unexpected token |  | 11+1"]],
      ["js", "export const;", [" | Unexpected token |  | 12+1"]],
      [
        "ts",
        "export let if = 1;",
        [" | Identifier expected. 'if' is a reserved word that cannot be used here. |  | 11+2"],
      ],
      ["ts", "let = 1;", []],
      ["ts", "const = 1;", [" | Unexpected token |  | 6+1"]],
    ],
  ],
  [
    "rest elements, index signatures, enum members and private names",
    undefined,
    [
      [
        "js ts",
        "let {...{a}} = {};",
        [" | Invalid rest element target in destructuring pattern | Expected an identifier, like `...rest`. | 8+3"],
      ],
      [
        "js ts",
        "let {...[a]} = {};",
        [" | Invalid rest element target in destructuring pattern | Expected an identifier, like `...rest`. | 8+3"],
      ],
      [
        "js ts",
        "let {...a.b} = {};",
        [" | Expected `,` or `}` but found `.` |  | 9+1 `,` or `}` expected | 4+1 Opened here"],
      ],
      ["js ts", "let {...1} = {};", [" | Unexpected token |  | 8+1"]],
      [
        "js ts",
        "function f({...{a}}) {}",
        [" | Invalid rest element target in destructuring pattern | Expected an identifier, like `...rest`. | 15+3"],
      ],
      ["js ts", "let [...{a}] = [];", []],
      [
        "js ts",
        "let {a, ...{b, c}} = {};",
        [" | Invalid rest element target in destructuring pattern | Expected an identifier, like `...rest`. | 11+6"],
      ],
      [
        "js ts",
        "({...{a}} = {});",
        [
          " | Invalid rest element target in destructuring assignment | Expected an identifier or member expression, like `...rest` or `...obj.prop`. | 5+3",
        ],
      ],
      [
        "js ts",
        "({...[a]} = {});",
        [
          " | Invalid rest element target in destructuring assignment | Expected an identifier or member expression, like `...rest` or `...obj.prop`. | 5+3",
        ],
      ],
      [
        "js ts",
        "for (const {...{a}} of b) ;",
        [" | Invalid rest element target in destructuring pattern | Expected an identifier, like `...rest`. | 15+3"],
      ],
      [
        "js ts",
        "let {...{a: {b}}} = {}; x y;",
        [" | Invalid rest element target in destructuring pattern | Expected an identifier, like `...rest`. | 8+8"],
      ],
      [
        "ts",
        "let x: { [k: string]?: number };",
        ["TS(1021) | An index signature must have a type annotation. |  | 9+11"],
      ],
      [
        "ts",
        "interface A { [k: string]?: number }",
        ["TS(1021) | An index signature must have a type annotation. |  | 14+11"],
      ],
      [
        "ts",
        "class A { [k: string]?: number }",
        ["TS(1021) | An index signature must have a type annotation. |  | 10+11"],
      ],
      ["ts", "let x: { [k: string] };", ["TS(1021) | An index signature must have a type annotation. |  | 9+11"]],
      ["ts", "let x: { [k: string]; a: 1 };", ["TS(1021) | An index signature must have a type annotation. |  | 9+11"]],
      [
        "ts",
        "let x: { [k: string]!: number };",
        ["TS(1021) | An index signature must have a type annotation. |  | 9+11"],
      ],
      [
        "ts",
        "let x: { [k: string](): number };",
        ["TS(1021) | An index signature must have a type annotation. |  | 9+11"],
      ],
      [
        "ts",
        "let x: { readonly [k: string]?: number };",
        ["TS(1021) | An index signature must have a type annotation. |  | 9+20"],
      ],
      ["ts", "enum E { `a` }", ["TS(1164) | Computed property names are not allowed in enums. |  | 9+3"]],
      ["ts", "enum E { `a${b}` }", ["TS(1164) | Computed property names are not allowed in enums. |  | 9+4"]],
      ["ts", "enum E { + }", [" | Unexpected token |  | 9+1"]],
      [
        "ts",
        "enum E { a b }",
        [" | Expected `,` or `}` but found `Identifier` |  | 11+1 `,` or `}` expected | 7+1 Opened here"],
      ],
      [
        "ts",
        "enum E { a = 1 b }",
        [" | Expected `,` or `}` but found `Identifier` |  | 15+1 `,` or `}` expected | 7+1 Opened here"],
      ],
      ["ts", "enum E { #a }", [" | Unexpected token |  | 9+2"]],
      ["ts", "enum E { [a] }", ["TS(1164) | Computed property names are not allowed in enums. |  | 10+1"]],
      ["ts", "enum E { a, , b }", [" | Unexpected token |  | 12+1"]],
      ["ts", "enum E { 1n }", ["TS(2452) | An enum member cannot have a numeric name. |  | 9+2"]],
      ["ts", "enum E { ...a }", [" | Unexpected token |  | 9+3"]],
      ["ts", "class A { #a = 1; m() { let x: typeof this.#a; return x; } }", [" | Unexpected token |  | 43+2"]],
      ["ts", "class A { #a = 1; m() { let x: typeof this.#a.b; } }", [" | Unexpected token |  | 43+2"]],
      ["ts", "let x: typeof a.#b;", [" | Unexpected token |  | 16+2"]],
      ["ts", "let x: A.#b;", [" | Unexpected token |  | 9+2"]],
      ["js ts", "class A { #x; m() { super.#x; } }", [" | Private fields cannot be accessed on super |  | 20+8"]],
      ["js ts", "class A { #x; m() { super.#x(); } }", [" | Private fields cannot be accessed on super |  | 20+8"]],
      [
        "js ts",
        "class A { #x; m() { super.#x = 1; let a; let a; } }",
        [" | Private fields cannot be accessed on super |  | 20+8"],
      ],
      [
        "js ts",
        "class A { #x; m() { super.#x; const a; } }",
        [
          " | Private fields cannot be accessed on super |  | 20+8",
          " | Missing initializer in const declaration | Add an initializer (e.g. ` = undefined`) here | 36+1",
        ],
      ],
      [
        "js ts",
        "class A { #x; m() { super.#x; x y } }",
        [
          " | Private fields cannot be accessed on super |  | 20+8",
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 31+0",
        ],
      ],
      ["js ts", "#x;", [" | Expected `in` but found `;` |  | 2+1 `in` expected"]],
      ["js ts", "class A { m() { #x; } #x }", [" | Expected `in` but found `;` |  | 18+1 `in` expected"]],
      ["js ts", "class A { m() { 1 + #x in o; } #x }", [" | Unexpected private identifier |  | 20+2"]],
      ["js ts", "class A { m() { #x + 1; } #x }", [" | Expected `in` but found `+` |  | 19+1 `in` expected"]],
      ["js ts", "class A { m() { (#x) in o; } #x }", [" | Expected `in` but found `)` |  | 19+1 `in` expected"]],
      ["js ts", "class A { m() { f(#x); } #x }", [" | Expected `in` but found `)` |  | 20+1 `in` expected"]],
      ["js ts", "class A { m() { #x in #y in o; } #x; #y }", [" | Unexpected private identifier |  | 22+2"]],
      ["js ts", "class A { m() { a = #x in o; } #x }", []],
      ["js ts", "class A { m() { a && #x in o; } #x }", []],
      ["js ts", "class A { m() { a < #x in o; } #x }", [" | Unexpected private identifier |  | 20+2"]],
      ["js ts", "class A { m() { !#x in o; } #x }", [" | Unexpected token |  | 17+2"]],
      ["js ts", "({ #x: 1 });", [" | Private identifier '#x' is not allowed in property names |  | 3+2"]],
      ["js ts", "({ #x() {} });", [" | Private identifier '#x' is not allowed in property names |  | 3+2"]],
      ["js ts", "({ get #x() {} });", [" | Private identifier '#x' is not allowed in property names |  | 7+2"]],
      [
        "js ts",
        "class A { #x; m() { const { #x: a } = this; } }",
        [" | Private identifier '#x' is not allowed in property names |  | 28+2"],
      ],
      [
        "js ts",
        "({ #x: 1 }); const a;",
        [
          " | Private identifier '#x' is not allowed in property names |  | 3+2",
          " | Missing initializer in const declaration | Add an initializer (e.g. ` = undefined`) here | 19+1",
        ],
      ],
      [
        "js ts",
        "({ #x: 1 }); x y;",
        [
          " | Private identifier '#x' is not allowed in property names |  | 3+2",
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 14+0",
        ],
      ],
      [
        "js ts",
        "({ #x });",
        [
          " | Private identifier '#x' is not allowed in property names |  | 3+2",
          " | Expected `:` but found `}` |  | 6+1 `:` expected",
        ],
      ],
      [
        "js ts",
        "class A { #x; m() { return #y in o; } }",
        [" | Private field '#y' must be declared in an enclosing class | Did you mean '#x'? | 27+2"],
      ],
      [
        "js ts",
        "class A { #abc; m() { o.#abd; } }",
        [" | Private field '#abd' must be declared in an enclosing class | Did you mean '#abc'? | 24+4"],
      ],
      [
        "js ts",
        "class A { #abc; m() { o.#xyz; } }",
        [" | Private field '#xyz' must be declared in an enclosing class |  | 24+4"],
      ],
      [
        "js ts",
        "class A { #abc; #abe; m() { o.#abd; } }",
        [" | Private field '#abd' must be declared in an enclosing class | Did you mean '#abc'? | 30+4"],
      ],
      [
        "js ts",
        "class A { #abe; #abc; m() { o.#abd; } }",
        [" | Private field '#abd' must be declared in an enclosing class | Did you mean '#abe'? | 30+4"],
      ],
      [
        "js ts",
        "class A { #abcdef; m() { o.#abcd; } }",
        [" | Private field '#abcd' must be declared in an enclosing class | Did you mean '#abcdef'? | 27+5"],
      ],
      [
        "js ts",
        "class A { #abcdef; m() { o.#abc; } }",
        [" | Private field '#abc' must be declared in an enclosing class |  | 27+4"],
      ],
      [
        "js ts",
        "class B { #abc; m() { class A { #zzz; m() { o.#abd; } } } }",
        [" | Private field '#abd' must be declared in an enclosing class | Did you mean '#abc'? | 46+4"],
      ],
      [
        "js ts",
        "class B { #abc; m() { class A { #abe; m() { o.#abd; } } } }",
        [" | Private field '#abd' must be declared in an enclosing class | Did you mean '#abe'? | 46+4"],
      ],
      [
        "js ts",
        "class A { #a; m() { o.#b; } }",
        [" | Private field '#b' must be declared in an enclosing class | Did you mean '#a'? | 22+2"],
      ],
      [
        "js ts",
        "class A { #ab; m() { o.#cd; } }",
        [" | Private field '#cd' must be declared in an enclosing class | Did you mean '#ab'? | 23+3"],
      ],
      [
        "js ts",
        "class A { #abc; m() { o.#ABC; } }",
        [" | Private field '#ABC' must be declared in an enclosing class |  | 24+4"],
      ],
      [
        "js ts",
        "class A { #abc() {} m() { o.#abd; } }",
        [" | Private field '#abd' must be declared in an enclosing class | Did you mean '#abc'? | 28+4"],
      ],
      [
        "js ts",
        "class A { static #abc; get #abf() {} m() { o.#abd; } }",
        [" | Private field '#abd' must be declared in an enclosing class | Did you mean '#abc'? | 45+4"],
      ],
    ],
  ],
  [
    "yield, await and the heads of arrow functions",
    undefined,
    [
      ["js ts", "class A { m() { 1 + #x in o; const a; } #x }", [" | Unexpected private identifier |  | 20+2"]],
      ["js ts", "class A { m() { 1 + #x in o; x y } #x }", [" | Unexpected private identifier |  | 20+2"]],
      [
        "js ts",
        "class A { static constructor = 1; m() { const a; } }",
        [
          " | Classes can't have a field named 'constructor' |  | 17+11",
          " | Missing initializer in const declaration | Add an initializer (e.g. ` = undefined`) here | 46+1",
        ],
      ],
      [
        "js ts",
        "class A { static constructor = 1; b c }",
        [
          " | Classes can't have a field named 'constructor' |  | 17+11",
          " | Expected `;` but found `Identifier` |  | 36+1 `;` expected",
        ],
      ],
      [
        "ts",
        "class A { a?!: number; b c }",
        [
          " | A property cannot be both optional and definite. | Remove either the `?` or the `!` | 11+2",
          " | Expected `;` but found `Identifier` |  | 25+1 `;` expected",
        ],
      ],
      [
        "ts",
        "class A { a?!: number; m() { const a; } }",
        [
          " | A property cannot be both optional and definite. | Remove either the `?` or the `!` | 11+2",
          " | Missing initializer in const declaration | Add an initializer (e.g. ` = undefined`) here | 35+1",
        ],
      ],
      ["js ts", "export {}; for (await of []) {}", [" | Unexpected token |  | 26+1"]],
      ["js ts", "function* g() { for (yield of []) {} }", [" | Unexpected token |  | 31+1"]],
      ["js ts", "a[];", [" | Unexpected token |  | 2+1"]],
      ["js ts", "a[]; const b;", [" | Unexpected token |  | 2+1"]],
      ["js ts", "export {}; await();", [" | Empty parenthesized expression |  | 16+2"]],
      ["js ts", "function* g() { yield(); }", [" | Empty parenthesized expression |  | 21+2"]],
      ["js ts", "();", [" | Empty parenthesized expression |  | 0+2"]],
      ["js ts", "x = ();", [" | Empty parenthesized expression |  | 4+2"]],
      ["js ts", "f(());", [" | Empty parenthesized expression |  | 2+2"]],
      ["js ts", "(); const a;", [" | Empty parenthesized expression |  | 0+2"]],
      ["js ts", "function* g() { yield = yield; }", [" | Unexpected token |  | 22+1"]],
      ["js ts", "function* g() { yield += 1; }", [" | Unexpected token |  | 22+2"]],
      ["js ts", "function* g() { yield ? 1 : 2; }", [" | Unexpected token |  | 22+1"]],
      ["js ts", "function* g() { yield.a; }", [" | Unexpected token |  | 21+1"]],
      ["js ts", "function* g() { yield => 1; }", [" | Unexpected token |  | 22+2"]],
      ["js ts", "function* g() { [yield.a] = []; }", [" | Unexpected token |  | 22+1"]],
      ["js ts", "function* g() { x = (yield = 1); }", [" | Unexpected token |  | 27+1"]],
      ["js ts", "function* g() { [yield = 1] = []; }", [" | Unexpected token |  | 23+1"]],
      ["js ts", "function* g() { for (yield in {}) {} }", [" | Unexpected token |  | 27+2"]],
      ["js ts", "function* g() { yield\n.a; }", [" | Unexpected token |  | 22+1"]],
      [
        "js ts",
        "function* g() { yield, 1; yield; yield) }",
        [
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 38+0",
        ],
      ],
      ["js ts", "function* g() { yield in a; }", [" | Unexpected token |  | 22+2"]],
      ["js ts", "function* g() { yield instanceof a; }", [" | Unexpected token |  | 22+10"]],
      ["js ts", "function* g() { yield || a; }", [" | Unexpected token |  | 22+2"]],
      ["js ts", "function* g() { f(yield.a); }", [" | Unexpected token |  | 23+1"]],
      [
        "ts",
        "(static satisfies any) = 1;",
        [
          "TS(1090) | 'static' modifier cannot appear on a parameter. | No modifiers are allowed here. | 1+6",
          " | Expected `,` or `)` but found `any` |  | 18+3 `,` or `)` expected | 0+1 Opened here",
        ],
      ],
      [
        "ts",
        "{ (yield as any)++; }",
        [
          " | A 'yield' expression is only allowed in a generator body. | Either remove this `yield` or change the enclosing function to a generator function (`function*`) | 3+5",
          " | Expected `,` or `)` but found `any` |  | 12+3 `,` or `)` expected | 2+1 Opened here",
        ],
      ],
      [
        "ts",
        "(a as any b);",
        [" | Expected `,` or `)` but found `Identifier` |  | 10+1 `,` or `)` expected | 0+1 Opened here"],
      ],
      [
        "ts",
        "f(a as any b);",
        [" | Expected `,` or `)` but found `Identifier` |  | 11+1 `,` or `)` expected | 1+1 Opened here"],
      ],
      [
        "ts",
        "declare module 'w' { await as any = 1; }",
        [
          " | `await` is only allowed within async functions and at the top levels of modules | Either remove this `await` or add the `async` keyword to the enclosing function | 21+5",
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 29+0",
        ],
      ],
      ["ts", "namespace W { export let: for (;;) {} }", [" | Unexpected token |  | 24+1"]],
      [
        "ts",
        "function* g() { type yield = 1; }",
        [" | Cannot use `yield` as an identifier in a generator context |  | 21+5"],
      ],
      [
        "ts",
        "function* g() { enum yield {} }",
        [" | Cannot use `yield` as an identifier in a generator context |  | 21+5"],
      ],
      [
        "ts",
        "function* g() { interface yield {} }",
        [" | Cannot use `yield` as an identifier in a generator context |  | 26+5"],
      ],
      [
        "ts",
        "function* g() { namespace yield {} }",
        [" | Cannot use `yield` as an identifier in a generator context |  | 26+5"],
      ],
      [
        "ts",
        "function* g() { class yield {} }",
        [" | Cannot use `yield` as an identifier in a generator context |  | 22+5"],
      ],
      ["ts", "async function f() { type await = 1; }", []],
      ["ts", "async function f() { enum await {} }", []],
      ["ts", "async function f() { interface await {} }", []],
      ["ts", "export {}; type await = 1;", [" | The keyword 'await' is reserved |  | 16+5"]],
      ["ts", "export {}; enum await {}", [" | The keyword 'await' is reserved |  | 16+5"]],
      ["ts", "export {}; interface await {}", [" | The keyword 'await' is reserved |  | 21+5"]],
      ["ts", "type yield = 1;", []],
      ["ts", "export {}; type yield = 1;", [" | The keyword 'yield' is reserved |  | 16+5"]],
      [
        "ts",
        "function* g() { type yield = 1; x y }",
        [
          " | Cannot use `yield` as an identifier in a generator context |  | 21+5",
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 33+0",
        ],
      ],
      [
        "ts",
        "function* g() { enum yield {} x y }",
        [
          " | Cannot use `yield` as an identifier in a generator context |  | 21+5",
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 31+0",
        ],
      ],
      [
        "js ts",
        "async (await) => 1;\nexport {};",
        [" | Cannot use `await` as an identifier in an async context |  | 7+5"],
      ],
      ["js ts", "async await => 1;\nexport {};", [" | Unexpected token |  | 12+2"]],
      [
        "js ts",
        "async (a, await) => 1;\nexport {};",
        [" | Cannot use `await` as an identifier in an async context |  | 10+5"],
      ],
      [
        "js ts",
        "async (await) => 1; const a;\nexport {};",
        [
          " | Cannot use `await` as an identifier in an async context |  | 7+5",
          " | Missing initializer in const declaration | Add an initializer (e.g. ` = undefined`) here | 26+1",
        ],
      ],
      [
        "js ts",
        "async function f() { async (await) => 1; }",
        [" | Cannot use `await` as an identifier in an async context |  | 28+5"],
      ],
      ["js ts", "async function f() { async await => 1; }", [" | Unexpected token |  | 33+2"]],
      [
        "js ts",
        "async function f() { (await) => 1; }",
        [" | Cannot use `await` as an identifier in an async context |  | 22+5"],
      ],
      ["js ts", "async function f() { await => 1; }", [" | Unexpected token |  | 27+2"]],
      ["js ts", "({a:1} = 1) => 1;", [" | Cannot assign to this expression |  | 4+1"]],
      [
        "js ts",
        "({a:1}) => 1;",
        [
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 7+0",
        ],
      ],
      [
        "js ts",
        "([1]) => 1;",
        [
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 5+0",
        ],
      ],
      [
        "js ts",
        "(a.b) => 1;",
        [
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 5+0",
        ],
      ],
      [
        "js ts",
        "(1) => 1;",
        [
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 3+0",
        ],
      ],
      [
        "js ts",
        "({a:b.c}) => 1;",
        [
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 9+0",
        ],
      ],
      [
        "js ts",
        "(a, 1) => 1;",
        [
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 6+0",
        ],
      ],
      [
        "js ts",
        "({a(){}}) => 1;",
        [
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 9+0",
        ],
      ],
      [
        "js ts",
        "(a = 1, {b: 2}) => 1;",
        [
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 15+0",
        ],
      ],
      ["js ts", "function* w() { ({ yield = 1 } = {}); }", [" | Expected `:` but found `=` |  | 25+1 `:` expected"]],
      ["js ts", "function* w() { x = { yield = 1 }; }", [" | Expected `:` but found `=` |  | 28+1 `:` expected"]],
      ["js ts", "function* w() { ({ a, yield = 1 } = {}); }", [" | Expected `:` but found `=` |  | 28+1 `:` expected"]],
      ["js ts", "function* w() { ({ yield }); }", [" | Expected `:` but found `}` |  | 25+1 `:` expected"]],
      [
        "ts",
        "(static satisfies any) = 1;",
        [
          "TS(1090) | 'static' modifier cannot appear on a parameter. | No modifiers are allowed here. | 1+6",
          " | Expected `,` or `)` but found `any` |  | 18+3 `,` or `)` expected | 0+1 Opened here",
        ],
      ],
      [
        "ts",
        "(static a) = 1;",
        [
          "TS(1090) | 'static' modifier cannot appear on a parameter. | No modifiers are allowed here. | 1+6",
          " | Expected `=>` but found `=` |  | 11+1 `=>` expected",
        ],
      ],
      [
        "ts",
        "(static a);",
        [
          "TS(1090) | 'static' modifier cannot appear on a parameter. | No modifiers are allowed here. | 1+6",
          " | Expected `=>` but found `;` |  | 10+1 `=>` expected",
        ],
      ],
      [
        "ts",
        "(public a b);",
        [
          "TS(1090) | 'public' modifier cannot appear on a parameter. | No modifiers are allowed here. | 1+6",
          " | Expected `,` or `)` but found `Identifier` |  | 10+1 `,` or `)` expected | 0+1 Opened here",
        ],
      ],
      [
        "ts",
        "(readonly a b);",
        [
          "TS(1090) | 'readonly' modifier cannot appear on a parameter. | No modifiers are allowed here. | 1+8",
          " | Expected `,` or `)` but found `Identifier` |  | 12+1 `,` or `)` expected | 0+1 Opened here",
        ],
      ],
      [
        "ts",
        "(declare a b);",
        [
          "TS(1090) | 'declare' modifier cannot appear on a parameter. | No modifiers are allowed here. | 1+7",
          " | Expected `,` or `)` but found `Identifier` |  | 11+1 `,` or `)` expected | 0+1 Opened here",
        ],
      ],
      [
        "ts",
        "(abstract a b);",
        [
          "TS(1090) | 'abstract' modifier cannot appear on a parameter. | No modifiers are allowed here. | 1+8",
          " | Expected `,` or `)` but found `Identifier` |  | 12+1 `,` or `)` expected | 0+1 Opened here",
        ],
      ],
      [
        "ts",
        "(async a b);",
        [" | Expected `,` or `)` but found `Identifier` |  | 7+1 `,` or `)` expected | 0+1 Opened here"],
      ],
      [
        "ts",
        "(override a b);",
        [
          "TS(1090) | 'override' modifier cannot appear on a parameter. | No modifiers are allowed here. | 1+8",
          " | Expected `,` or `)` but found `Identifier` |  | 12+1 `,` or `)` expected | 0+1 Opened here",
        ],
      ],
      [
        "ts",
        "(static a, b c);",
        [
          "TS(1090) | 'static' modifier cannot appear on a parameter. | No modifiers are allowed here. | 1+6",
          " | Expected `,` or `)` but found `Identifier` |  | 13+1 `,` or `)` expected | 0+1 Opened here",
        ],
      ],
      [
        "ts",
        "(a, static b c);",
        [" | Expected `,` or `)` but found `Identifier` |  | 11+1 `,` or `)` expected | 0+1 Opened here"],
      ],
      [
        "ts",
        "(static static a b);",
        [
          "TS(1090) | 'static' modifier cannot appear on a parameter. | No modifiers are allowed here. | 1+6",
          " | Expected `,` or `)` but found `Identifier` |  | 15+1 `,` or `)` expected | 0+1 Opened here",
        ],
      ],
      ["ts", "(static as any) = 1;", []],
      [
        "ts",
        "{ (yield as any)++; }",
        [
          " | A 'yield' expression is only allowed in a generator body. | Either remove this `yield` or change the enclosing function to a generator function (`function*`) | 3+5",
          " | Expected `,` or `)` but found `any` |  | 12+3 `,` or `)` expected | 2+1 Opened here",
        ],
      ],
      [
        "ts",
        "(yield as any)++;",
        [
          " | A 'yield' expression is only allowed in a generator body. | Either remove this `yield` or change the enclosing function to a generator function (`function*`) | 1+5",
          " | Expected `,` or `)` but found `any` |  | 10+3 `,` or `)` expected | 0+1 Opened here",
        ],
      ],
      [
        "ts",
        "(yield a b);",
        [
          " | A 'yield' expression is only allowed in a generator body. | Either remove this `yield` or change the enclosing function to a generator function (`function*`) | 1+5",
          " | Expected `,` or `)` but found `Identifier` |  | 9+1 `,` or `)` expected | 0+1 Opened here",
        ],
      ],
      [
        "ts",
        "(yield a);",
        [
          " | A 'yield' expression is only allowed in a generator body. | Either remove this `yield` or change the enclosing function to a generator function (`function*`) | 1+5",
        ],
      ],
      [
        "js",
        "(yield a b);",
        [
          " | A 'yield' expression is only allowed in a generator body. | Either remove this `yield` or change the enclosing function to a generator function (`function*`) | 1+5",
          " | Expected `,` or `)` but found `Identifier` |  | 9+1 `,` or `)` expected | 0+1 Opened here",
        ],
      ],
      [
        "ts",
        "f(yield a b);",
        [
          " | A 'yield' expression is only allowed in a generator body. | Either remove this `yield` or change the enclosing function to a generator function (`function*`) | 2+5",
          " | Expected `,` or `)` but found `Identifier` |  | 10+1 `,` or `)` expected | 1+1 Opened here",
        ],
      ],
      [
        "ts",
        "[yield a b];",
        [
          " | A 'yield' expression is only allowed in a generator body. | Either remove this `yield` or change the enclosing function to a generator function (`function*`) | 1+5",
          " | Expected `,` or `]` but found `Identifier` |  | 9+1 `,` or `]` expected | 0+1 Opened here",
        ],
      ],
      [
        "ts",
        "x = yield a b;",
        [
          " | A 'yield' expression is only allowed in a generator body. | Either remove this `yield` or change the enclosing function to a generator function (`function*`) | 4+5",
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 11+0",
        ],
      ],
      [
        "ts",
        "(await as any)++;",
        [" | Expected `,` or `)` but found `any` |  | 10+3 `,` or `)` expected | 0+1 Opened here"],
      ],
      [
        "ts",
        "function f() { (await a b); }",
        [
          " | `await` is only allowed within async functions and at the top levels of modules | Either remove this `await` or add the `async` keyword to the enclosing function | 16+5",
          " | Expected `,` or `)` but found `Identifier` |  | 24+1 `,` or `)` expected | 15+1 Opened here",
        ],
      ],
    ],
  ],
  [
    "__proto__, octal escapes, export assignments and nested declare",
    undefined,
    [
      ["js", "class A { __proto__ = 1; '__proto__' = 2; }", []],
      [
        "ts",
        "class A { __proto__ = 1; '__proto__' = 2; }",
        [
          " | Identifier `__proto__` has already been declared |  | 10+9 `__proto__` has already been declared here | 25+11 It can not be redeclared here",
        ],
      ],
      ["js", "class A { __proto__ = 1; __proto__ = 2; }", []],
      [
        "ts",
        "class A { __proto__ = 1; __proto__ = 2; }",
        [
          " | Identifier `__proto__` has already been declared |  | 10+9 `__proto__` has already been declared here | 25+9 It can not be redeclared here",
        ],
      ],
      ["js", "class A { __proto__; __proto__; }", []],
      [
        "ts",
        "class A { __proto__; __proto__; }",
        [
          " | Identifier `__proto__` has already been declared |  | 10+9 `__proto__` has already been declared here | 21+9 It can not be redeclared here",
        ],
      ],
      ["js", "class A { __proto__() {} __proto__() {} }", []],
      [
        "ts",
        "class A { __proto__() {} __proto__() {} }",
        [
          " | Identifier `__proto__` has already been declared |  | 10+9 `__proto__` has already been declared here | 25+9 It can not be redeclared here",
        ],
      ],
      ["js", "class A { __proto__ = 1; __proto__() {} }", []],
      [
        "ts",
        "class A { __proto__ = 1; __proto__() {} }",
        [
          " | Identifier `__proto__` has already been declared |  | 10+9 `__proto__` has already been declared here | 25+9 It can not be redeclared here",
        ],
      ],
      ["js ts", "class A { static __proto__ = 1; __proto__ = 2; }", []],
      ["js", "class A { __proto__ = 1; ['__proto__'] = 2; }", []],
      [
        "ts",
        "class A { __proto__ = 1; ['__proto__'] = 2; }",
        [
          " | Identifier `__proto__` has already been declared |  | 10+9 `__proto__` has already been declared here | 26+11 It can not be redeclared here",
        ],
      ],
      ["js", "class A { __proto__ = 1; __proto__ = 2; __proto__ = 3; }", []],
      [
        "ts",
        "class A { __proto__ = 1; __proto__ = 2; __proto__ = 3; }",
        [
          " | Identifier `__proto__` has already been declared |  | 10+9 `__proto__` has already been declared here | 25+9 It can not be redeclared here",
          " | Identifier `__proto__` has already been declared |  | 25+9 `__proto__` has already been declared here | 40+9 It can not be redeclared here",
        ],
      ],
      ["js", "class A { a = 1; a = 2; }", []],
      [
        "ts",
        "class A { a = 1; a = 2; }",
        [
          " | Identifier `a` has already been declared |  | 10+1 `a` has already been declared here | 17+1 It can not be redeclared here",
        ],
      ],
      ["js ts", "class A { get __proto__() {} set __proto__(v) {} }", []],
      [
        "js ts",
        "({ __proto__: 1, __proto__: 2, __proto__: 3 });",
        [
          " | Identifier `__proto__` has already been declared |  | 3+9 `__proto__` has already been declared here | 17+9 It can not be redeclared here",
          " | Identifier `__proto__` has already been declared |  | 17+9 `__proto__` has already been declared here | 31+9 It can not be redeclared here",
        ],
      ],
      [
        "js ts",
        "({ __proto__: 1, __proto__: 2 }); const a;",
        [" | Missing initializer in const declaration | Add an initializer (e.g. ` = undefined`) here | 40+1"],
      ],
      [
        "js ts",
        '({ __proto__: 1, "__proto__": 2 });',
        [
          " | Identifier `__proto__` has already been declared |  | 3+9 `__proto__` has already been declared here | 17+11 It can not be redeclared here",
        ],
      ],
      ["js ts", "({ __proto__: 1, __proto__ });", []],
      ["js ts", "({ __proto__: 1, __proto__() {} });", []],
      ["js ts", '({ __proto__: 1, ["__proto__"]: 2 });', []],
      ["js ts", "({ __proto__: 1, __proto__: 2 } = {});", [" | Cannot assign to this expression |  | 14+1"]],
      ["ts", "interface A { __proto__: 1; __proto__: 2 }", []],
      [
        "ts",
        "export {}; enum E { '\\01' }",
        [
          " | '0'-prefixed octal literals and octal escape sequences are deprecated | for octal literals use the '0o' prefix instead | 20+5",
        ],
      ],
      [
        "ts",
        "export {}; enum E { '\\01' = 1, b = '\\02' }",
        [
          " | '0'-prefixed octal literals and octal escape sequences are deprecated | for octal literals use the '0o' prefix instead | 20+5",
          " | '0'-prefixed octal literals and octal escape sequences are deprecated | for octal literals use the '0o' prefix instead | 35+5",
        ],
      ],
      [
        "js ts",
        "export {}; ({ '\\01': 1 });",
        [
          " | '0'-prefixed octal literals and octal escape sequences are deprecated | for octal literals use the '0o' prefix instead | 14+5",
        ],
      ],
      [
        "js ts",
        "export {}; class A { '\\01' = 1 }",
        [
          " | '0'-prefixed octal literals and octal escape sequences are deprecated | for octal literals use the '0o' prefix instead | 21+5",
        ],
      ],
      [
        "js ts",
        "export {}; ({ 010: 1 });",
        [
          " | '0'-prefixed octal literals and octal escape sequences are deprecated | for octal literals use the '0o' prefix instead | 14+3",
        ],
      ],
      [
        "js ts",
        "export {}; class A { 010 = 1 }",
        [
          " | '0'-prefixed octal literals and octal escape sequences are deprecated | for octal literals use the '0o' prefix instead | 21+3",
        ],
      ],
      [
        "js ts",
        "export {}; import a from '\\01';",
        [
          " | '0'-prefixed octal literals and octal escape sequences are deprecated | for octal literals use the '0o' prefix instead | 25+5",
        ],
      ],
      [
        "js ts",
        "export {}; const { '\\01': a } = b;",
        [
          " | '0'-prefixed octal literals and octal escape sequences are deprecated | for octal literals use the '0o' prefix instead | 19+5",
        ],
      ],
      [
        "js ts",
        "export {}; const { 010: a } = b;",
        [
          " | '0'-prefixed octal literals and octal escape sequences are deprecated | for octal literals use the '0o' prefix instead | 19+3",
        ],
      ],
      [
        "ts",
        "export {}; type T = '\\01';",
        [
          " | '0'-prefixed octal literals and octal escape sequences are deprecated | for octal literals use the '0o' prefix instead | 20+5",
        ],
      ],
      [
        "ts",
        "export {}; type T = 010;",
        [
          " | '0'-prefixed octal literals and octal escape sequences are deprecated | for octal literals use the '0o' prefix instead | 20+3",
        ],
      ],
      [
        "ts",
        "export {}; type T = { '\\01': 1 };",
        [
          " | '0'-prefixed octal literals and octal escape sequences are deprecated | for octal literals use the '0o' prefix instead | 22+5",
        ],
      ],
      [
        "ts",
        "export {}; declare module '\\01' {}",
        [
          " | '0'-prefixed octal literals and octal escape sequences are deprecated | for octal literals use the '0o' prefix instead | 26+5",
        ],
      ],
      [
        "js ts",
        "export {}; import { '\\01' as a } from 'b';",
        [
          " | '0'-prefixed octal literals and octal escape sequences are deprecated | for octal literals use the '0o' prefix instead | 20+5",
        ],
      ],
      ["js", "export {}; <a b='\\01' />;", []],
      ["ts", "export {}; <a b='\\01' />;", [" | Expected `>` but found `Identifier` |  | 14+1 `>` expected"]],
      [
        "js ts",
        "'use strict'; '\\01';",
        [
          " | '0'-prefixed octal literals and octal escape sequences are deprecated | for octal literals use the '0o' prefix instead | 14+5",
        ],
      ],
      [
        "js ts",
        "'\\01'; 'use strict';",
        [
          " | '0'-prefixed octal literals and octal escape sequences are deprecated | for octal literals use the '0o' prefix instead | 0+5",
        ],
      ],
      [
        "js ts",
        "function f() { '\\01'; 'use strict'; }",
        [
          " | '0'-prefixed octal literals and octal escape sequences are deprecated | for octal literals use the '0o' prefix instead | 15+5",
        ],
      ],
      ["js ts", "export {}; x = `\\01`;", [" | Bad escape sequence in untagged template literal |  | 16+3"]],
      ["js ts", "export {}; x = `a${1}\\01`;", [" | Bad escape sequence in untagged template literal |  | 21+3"]],
      ["js ts", "export {}; x = f`\\01`;", []],
      [
        "js ts",
        "x = `\\01`; const a;",
        [
          " | Bad escape sequence in untagged template literal |  | 5+3",
          " | Missing initializer in const declaration | Add an initializer (e.g. ` = undefined`) here | 17+1",
        ],
      ],
      ["js ts", "x = `\\8`;", [" | Bad escape sequence in untagged template literal |  | 5+2"]],
      ["js ts", "x = `\\u{`;", [" | Bad escape sequence in untagged template literal |  | 5+3"]],
      ["js ts", "x = `\\xg`;", [" | Bad escape sequence in untagged template literal |  | 5+3"]],
      ["ts", "type T = `\\01`;", [" | Bad escape sequence in untagged template literal |  | 10+3"]],
      [
        "ts",
        "export = a; export const b = 1; export = c;",
        [
          "TS(2309) | An export assignment cannot be used in a module with other exported elements | If you want to use `export =`, remove other `export`s and put all of them to the right hand value of `export =`. If you want to use `export`s, remove `export =` statement. | 0+11",
          "TS(2309) | An export assignment cannot be used in a module with other exported elements | If you want to use `export =`, remove other `export`s and put all of them to the right hand value of `export =`. If you want to use `export`s, remove `export =` statement. | 32+11",
        ],
      ],
      ["ts", "export = a; export = c;", []],
      ["ts", "export = a; export = c; export {};", []],
      [
        "ts",
        "export const b = 1; export = a;",
        [
          "TS(2309) | An export assignment cannot be used in a module with other exported elements | If you want to use `export =`, remove other `export`s and put all of them to the right hand value of `export =`. If you want to use `export`s, remove `export =` statement. | 20+11",
        ],
      ],
      [
        "d.ts",
        "function w() { declare var a: any; }",
        [
          "TS(1038) | A 'declare' modifier cannot be used in an already ambient context. |  | 15+7",
          "TS(1183) | An implementation cannot be declared in ambient contexts. |  | 13+0",
        ],
      ],
      [
        "d.ts",
        "(async () => { declare var a: any; });",
        [
          "TS(1038) | A 'declare' modifier cannot be used in an already ambient context. |  | 15+7",
          "TS(1036) | Statements are not allowed in ambient contexts. |  | 0+38",
        ],
      ],
      ["d.ts", "declare var a: any;", []],
      ["d.ts", "{ declare var a: any; }", ["TS(1036) | Statements are not allowed in ambient contexts. |  | 0+23"]],
      [
        "d.ts",
        "namespace A { function w() { declare var a: any; } }",
        [
          "TS(1038) | A 'declare' modifier cannot be used in an already ambient context. |  | 29+7",
          "TS(1183) | An implementation cannot be declared in ambient contexts. |  | 27+0",
        ],
      ],
      [
        "ts",
        "declare namespace A { function w() { declare var a: any; } }",
        [
          "TS(1038) | A 'declare' modifier cannot be used in an already ambient context. |  | 37+7",
          "TS(1183) | An implementation cannot be declared in ambient contexts. |  | 35+0",
        ],
      ],
      [
        "ts",
        "declare function w() { declare var a: any; }",
        [
          "TS(1038) | A 'declare' modifier cannot be used in an already ambient context. |  | 23+7",
          "TS(1183) | An implementation cannot be declared in ambient contexts. |  | 21+0",
        ],
      ],
      [
        "ts",
        "declare namespace A { { declare var a: any; } }",
        [
          "TS(1038) | A 'declare' modifier cannot be used in an already ambient context. |  | 24+7",
          "TS(1036) | Statements are not allowed in ambient contexts. |  | 22+23",
        ],
      ],
      ["ts", "declare namespace A { export declare var a: any; }", []],
      [
        "d.ts",
        "class A { m() { declare var a: any; } }",
        [
          "TS(1038) | A 'declare' modifier cannot be used in an already ambient context. |  | 16+7",
          "TS(1183) | An implementation cannot be declared in ambient contexts. |  | 14+0",
        ],
      ],
      [
        "d.ts",
        "if (1) { declare var a: any; }",
        ["TS(1036) | Statements are not allowed in ambient contexts. |  | 0+30"],
      ],
    ],
  ],
  [
    "regular expressions",
    undefined,
    [
      [
        "js ts",
        "x = /(/;",
        [" | Invalid regular expression: Unterminated capturing group | Add the missing closing delimiter | 5+1"],
      ],
      [
        "js ts",
        "x = /a/gg;",
        [
          " | Flag g is mentioned twice in regular expression literal | Remove the duplicated flag here | 8+1",
          " | Unexpected token |  | 4+5",
        ],
      ],
      [
        "js ts",
        "x = /a/gig;",
        [
          " | Flag g is mentioned twice in regular expression literal | Remove the duplicated flag here | 9+1",
          " | Unexpected token |  | 4+6",
        ],
      ],
      [
        "js ts",
        "x = /a/x;",
        [
          " | Unexpected flag x in regular expression literal | The allowed flags are `gimsuydv` | 7+1",
          " | Unexpected token |  | 4+4",
        ],
      ],
      [
        "js ts",
        "x = /a/xy;",
        [
          " | Unexpected flag x in regular expression literal | The allowed flags are `gimsuydv` | 7+1",
          " | Unexpected token |  | 4+5",
        ],
      ],
      [
        "js ts",
        "x = /a/uv;",
        [
          " | Invalid regular expression: Invalid unicode flags combination `u` and `v` | The `v` flag is a superset of `u`. Use only either of them | 8+1",
          "TS(1502) | The 'u' and 'v' regular expression flags cannot be enabled at the same time | v flag enables additional syntax over u flag | 4+5",
        ],
      ],
      [
        "js ts",
        "x = /a/gxg;",
        [
          " | Unexpected flag x in regular expression literal | The allowed flags are `gimsuydv` | 8+1",
          " | Flag g is mentioned twice in regular expression literal | Remove the duplicated flag here | 9+1",
          " | Unexpected token |  | 4+6",
        ],
      ],
      [
        "js ts",
        "x = /a/ggii;",
        [
          " | Flag g is mentioned twice in regular expression literal | Remove the duplicated flag here | 8+1",
          " | Flag i is mentioned twice in regular expression literal | Remove the duplicated flag here | 10+1",
          " | Unexpected token |  | 4+7",
        ],
      ],
      [
        "js ts",
        "x = /a/gg; const a;",
        [
          " | Flag g is mentioned twice in regular expression literal | Remove the duplicated flag here | 8+1",
          " | Unexpected token |  | 4+5",
        ],
      ],
      [
        "js ts",
        "x = /a/x; const a;",
        [
          " | Unexpected flag x in regular expression literal | The allowed flags are `gimsuydv` | 7+1",
          " | Unexpected token |  | 4+4",
        ],
      ],
      [
        "js ts",
        "x = /a/uv; const a;",
        [
          " | Invalid regular expression: Invalid unicode flags combination `u` and `v` | The `v` flag is a superset of `u`. Use only either of them | 8+1",
          "TS(1502) | The 'u' and 'v' regular expression flags cannot be enabled at the same time | v flag enables additional syntax over u flag | 4+5",
          " | Missing initializer in const declaration | Add an initializer (e.g. ` = undefined`) here | 17+1",
        ],
      ],
      [
        "js ts",
        "x = /(/gg;",
        [
          " | Flag g is mentioned twice in regular expression literal | Remove the duplicated flag here | 8+1",
          " | Unexpected token |  | 4+5",
        ],
      ],
      [
        "js ts",
        "x = /)/;",
        [
          " | Invalid regular expression: Could not parse the entire pattern | Check for unbalanced brackets or invalid escape sequences | 5+0",
        ],
      ],
      ["js ts", "x = /[/;", [" | Unterminated regular expression |  | 4+5", " | Unexpected token |  | 4+5"]],
      ["js ts", "x = /*/;", [" | Unterminated multiline comment |  | 4+5"]],
      [
        "js ts",
        "x = /a**/;",
        [
          " | Invalid regular expression: Invalid braced quantifier | Quantifiers must follow an expression. To match literally, escape it with `\\` | 7+1",
        ],
      ],
      [
        "js ts",
        "x = /+/;",
        [
          " | Invalid regular expression: Invalid braced quantifier | Quantifiers must follow an expression. To match literally, escape it with `\\` | 5+1",
        ],
      ],
      [
        "js ts",
        "x = /a{2,1}/;",
        [
          " | Invalid regular expression: Numbers out of order in braced quantifier | In `{n,m}`, the minimum `n` must be less than or equal to the maximum `m` | 6+5",
        ],
      ],
      [
        "js ts",
        "x = /[b-a]/;",
        [
          " | Invalid regular expression: Character class atom range out of order | In a character range `[a-z]`, the first character must have a smaller code point than the second | 7+2",
        ],
      ],
      ["js ts", "x = /\\/;", [" | Unterminated regular expression |  | 4+5", " | Unexpected token |  | 4+5"]],
      [
        "js ts",
        "x = /(?<a>)(?<a>)/;",
        [
          " | Invalid regular expression: Duplicated capturing group names | Duplicate names must be in different alternatives | 8+1 | 14+1",
        ],
      ],
      [
        "js ts",
        "x = /\\k<a>/u;",
        [
          " | Invalid regular expression: Invalid named reference | There are no named capturing groups defined in this pattern | 5+5",
        ],
      ],
      [
        "js ts",
        "x = /(?<a>)\\k<b>/;",
        [" | Invalid regular expression: Invalid named reference | Valid group names are: a | 11+5"],
      ],
      [
        "js ts",
        "x = /\\2(a)/u;",
        [" | Invalid regular expression: Invalid indexed reference | This pattern only has 1 capturing group | 5+2"],
      ],
      [
        "js ts",
        "x = /\\u{110000}/u;",
        [
          " | Invalid regular expression: Invalid unicode escape sequence | Use `\\uXXXX` or `\\u{XXXXX}` format for unicode escapes | 6+1",
        ],
      ],
      [
        "js ts",
        "x = /\\p{Foo}/u;",
        [
          " | Invalid regular expression: Invalid unicode property name and/or value | Check the property name spelling or use a valid Unicode property | 8+3",
        ],
      ],
      [
        "js ts",
        "x = /{/u;",
        [
          " | Invalid regular expression: Could not parse the entire pattern | Check for unbalanced brackets or invalid escape sequences | 5+0",
        ],
      ],
      [
        "js ts",
        "x = /}/u;",
        [
          " | Invalid regular expression: Could not parse the entire pattern | Check for unbalanced brackets or invalid escape sequences | 5+0",
        ],
      ],
      [
        "js ts",
        "x = /]/u;",
        [
          " | Invalid regular expression: Could not parse the entire pattern | Check for unbalanced brackets or invalid escape sequences | 5+0",
        ],
      ],
      [
        "js ts",
        "x = /\\c/u;",
        [
          " | Invalid regular expression: Could not parse the entire pattern | Check for unbalanced brackets or invalid escape sequences | 6+0",
        ],
      ],
      [
        "js ts",
        "x = /(?<=a)+/;",
        [
          " | Invalid regular expression: Invalid braced quantifier | Quantifiers must follow an expression. To match literally, escape it with `\\` | 11+1",
        ],
      ],
      [
        "js ts",
        "x = /(?=a)+/u;",
        [
          " | Invalid regular expression: Lone quantifier found, expected with `Atom` | Quantifiers must follow an expression. To match literally, escape it with `\\` | 10+1",
        ],
      ],
      [
        "js ts",
        "x = /[\\d-a]/u;",
        [
          " | Invalid regular expression: Character class range with invalid atom | Character class ranges must use single characters, not character classes or escape sequences like `\\d` | 6+4",
        ],
      ],
      [
        "js ts",
        "x = /(?i-i:a)/;",
        [" | Invalid regular expression: Invalid modifiers | A modifier cannot be both enabled and disabled | 7+3"],
      ],
      [
        "js ts",
        "x = /(?ii:a)/;",
        [" | Invalid regular expression: Duplicated modifier | Each modifier can only appear once | 7+2"],
      ],
      [
        "js ts",
        "x = /(?-:a)/;",
        [
          " | Invalid regular expression: Empty modifiers | Use `(?:...)` for non-capturing groups or add modifiers | 7+1",
        ],
      ],
      [
        "js ts",
        "x = /(?x:a)/;",
        [" | Invalid regular expression: Unknown modifiers | Valid modifiers are: i, m, s | 7+0"],
      ],
      [
        "js ts",
        "x = /[a&&&b]/v;",
        [
          " | Invalid regular expression: Unexpected `&` inside of class intersection | A third `&` is not allowed after `&&`. Did you mean `[a&&[b]]`? | 9+1",
        ],
      ],
      [
        "js ts",
        "x = /[(]/v;",
        [
          " | Invalid regular expression: Expected nonempty class set expression | Add characters or properties to the class set expression | 6+0",
        ],
      ],
      [
        "js ts",
        "x = /(?<>a)/;",
        [" | Invalid regular expression: Unterminated capturing group name | Add the missing closing delimiter | 7+1"],
      ],
      [
        "js ts",
        "x = /(?<a/;",
        [" | Invalid regular expression: Unterminated capturing group name | Add the missing closing delimiter | 7+2"],
      ],
      [
        "js ts",
        "x = /(?:/;",
        [" | Invalid regular expression: Unterminated ignore group | Add the missing closing delimiter | 5+3"],
      ],
      [
        "js ts",
        "x = /(?=/;",
        [" | Invalid regular expression: Unterminated lookaround assertion | Add the missing closing delimiter | 5+3"],
      ],
      [
        "js ts",
        "x = /a|*/;",
        [
          " | Invalid regular expression: Invalid braced quantifier | Quantifiers must follow an expression. To match literally, escape it with `\\` | 7+1",
        ],
      ],
      [
        "js ts",
        "x = /(/; y = /)/;",
        [
          " | Invalid regular expression: Unterminated capturing group | Add the missing closing delimiter | 5+1",
          " | Invalid regular expression: Could not parse the entire pattern | Check for unbalanced brackets or invalid escape sequences | 14+0",
        ],
      ],
      [
        "js ts",
        "x = /(/; y = /a/gg;",
        [
          " | Flag g is mentioned twice in regular expression literal | Remove the duplicated flag here | 17+1",
          " | Invalid regular expression: Unterminated capturing group | Add the missing closing delimiter | 5+1",
          " | Unexpected token |  | 13+5",
        ],
      ],
      [
        "js ts",
        "x = /\u00e9(/;",
        [" | Invalid regular expression: Unterminated capturing group | Add the missing closing delimiter | 7+1"],
      ],
      [
        "js ts",
        "x = /(/ ; x y",
        [
          " | Invalid regular expression: Unterminated capturing group | Add the missing closing delimiter | 5+1",
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 11+0",
        ],
      ],
    ],
  ],
  [
    "what the lexer reports",
    undefined,
    [
      [
        "js",
        "x = /a/vu;",
        [
          " | Invalid regular expression: Invalid unicode flags combination `u` and `v` | The `v` flag is a superset of `u`. Use only either of them | 8+1",
          "TS(1502) | The 'u' and 'v' regular expression flags cannot be enabled at the same time | v flag enables additional syntax over u flag | 4+5",
        ],
      ],
      [
        "js",
        "x = /a/ugv;",
        [
          " | Invalid regular expression: Invalid unicode flags combination `u` and `v` | The `v` flag is a superset of `u`. Use only either of them | 9+1",
          "TS(1502) | The 'u' and 'v' regular expression flags cannot be enabled at the same time | v flag enables additional syntax over u flag | 4+6",
        ],
      ],
      [
        "js",
        "x = /a/uvx;",
        [
          " | Unexpected flag x in regular expression literal | The allowed flags are `gimsuydv` | 9+1",
          " | Unexpected token |  | 4+6",
        ],
      ],
      [
        "js",
        "x = /(/uv;",
        [
          " | Invalid regular expression: Invalid unicode flags combination `u` and `v` | The `v` flag is a superset of `u`. Use only either of them | 8+1",
          "TS(1502) | The 'u' and 'v' regular expression flags cannot be enabled at the same time | v flag enables additional syntax over u flag | 4+5",
        ],
      ],
      ["js", "x = /[/;\nconst a;", [" | Unterminated regular expression |  | 4+5", " | Unexpected token |  | 4+14"]],
      [
        "js",
        "const a; x = /[/;",
        [
          " | Unterminated regular expression |  | 13+5",
          " | Missing initializer in const declaration | Add an initializer (e.g. ` = undefined`) here | 6+1",
          " | Unexpected token |  | 13+5",
        ],
      ],
      ["js", "x = /a", [" | Unterminated regular expression |  | 4+3", " | Unexpected token |  | 4+3"]],
      [
        "js",
        "x = /a/\\u0067;",
        [
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 7+0",
        ],
      ],
      [
        "js",
        "x = /a/g1;",
        [
          " | Unexpected flag 1 in regular expression literal | The allowed flags are `gimsuydv` | 8+1",
          " | Unexpected token |  | 4+5",
        ],
      ],
      [
        "js",
        "x = /a/G;",
        [
          " | Unexpected flag G in regular expression literal | The allowed flags are `gimsuydv` | 7+1",
          " | Unexpected token |  | 4+4",
        ],
      ],
      [
        "js",
        "x = /a/\u00e9;",
        [
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 7+0",
        ],
      ],
      ["js", "/* a", [" | Unterminated multiline comment |  | 0+5"]],
      [
        "js",
        "const a; /* a",
        [
          " | Unterminated multiline comment |  | 9+5",
          " | Missing initializer in const declaration | Add an initializer (e.g. ` = undefined`) here | 6+1",
        ],
      ],
      ["js", 'x = "a', [" | Unterminated string |  | 4+3"]],
      ["js", 'x = "a\nconst b;', [" | Unterminated string |  | 4+3"]],
      [
        "js",
        "const a; x = 'a",
        [
          " | Missing initializer in const declaration | Add an initializer (e.g. ` = undefined`) here | 6+1",
          " | Unterminated string |  | 13+3",
        ],
      ],
      ["js", "x = `a", [" | Unterminated string |  | 4+3"]],
      ["js", "x = `a${", [" | Unexpected token |  | 9+0"]],
      ["js", "x = `a${b", [" | Expected `}` but found `EOF` |  | 10+0 `}` expected"]],
      ["js", "x = 1a;", [" | Invalid characters after number |  | 5+1"]],
      ["js", "x = 1_;", [" | Invalid Character `;` |  | 6+0"]],
      ["js", "x = 1__0;", [" | Invalid Character `_` |  | 6+0"]],
      ["js", "x = 0x;", [" | Invalid Character `;` |  | 6+0"]],
      ["js", "x = 0b2;", [" | Invalid Character `2` |  | 6+0"]],
      ["js", "x = 1e;", [" | Invalid Character `;` |  | 6+0"]],
      ["js", "x = 09.5;", []],
      ["js", "x = 1n.a; y = 1.5n;", [" | Invalid characters after number |  | 17+1"]],
      ["js", "x = @;", [" | Unexpected token |  | 5+1"]],
      ["js", "x = \\;", [" | Invalid Unicode escape sequence |  | 5+1"]],
      ["js", "x = a\\u{110000};", [" | Invalid Unicode escape sequence |  | 6+8", " | Unexpected token |  | 14+1"]],
      ["js", 'x = "\\u{110000}";', [" | Invalid escape sequence |  | 5+9"]],
      ["js", 'x = "\\xg";', [" | Invalid escape sequence |  | 5+2"]],
      ["js", 'x = "\\u12";', [" | Invalid escape sequence |  | 5+4"]],
      ["js", "x = #;", [" | Invalid Character `;` |  | 5+1"]],
      ["js", "x = 0_1;", [" | Invalid characters after number |  | 5+1"]],
      ["js", "x = 1._0;", [" | Invalid characters after number |  | 6+1"]],
      [
        "js",
        "const a; x = 1a;",
        [
          " | Missing initializer in const declaration | Add an initializer (e.g. ` = undefined`) here | 6+1",
          " | Invalid characters after number |  | 14+1",
        ],
      ],
      ["js", "x = 1a; const a;", [" | Invalid characters after number |  | 5+1"]],
      [
        "js",
        'x = "\\xg"; const a;',
        [
          " | Invalid escape sequence |  | 5+2",
          " | Missing initializer in const declaration | Add an initializer (e.g. ` = undefined`) here | 17+1",
        ],
      ],
      [
        "js",
        'const a; x = "\\xg";',
        [
          " | Invalid escape sequence |  | 14+2",
          " | Missing initializer in const declaration | Add an initializer (e.g. ` = undefined`) here | 6+1",
        ],
      ],
      ["js ts", "00k0;", [" | Invalid characters after number |  | 2+1"]],
      ["js ts", "000000k000;", [" | Invalid characters after number |  | 6+1"]],
      ["js ts", "x = 000k0;", [" | Invalid characters after number |  | 7+1"]],
      ["js ts", '"use strict"; 000k;', [" | Invalid characters after number |  | 17+1"]],
      ["js ts", "09k;", [" | Invalid characters after number |  | 2+1"]],
      ["js ts", "08.5k;", [" | Invalid characters after number |  | 4+1"]],
      ["js ts", "0x1k;", [" | Invalid characters after number |  | 3+1"]],
      ["js ts", "0b1k;", [" | Invalid characters after number |  | 3+1"]],
      ["js ts", "0o1k;", [" | Invalid characters after number |  | 3+1"]],
      ["js ts", "007n;", [" | Invalid characters after number |  | 3+1"]],
      ["js ts", "007e1;", [" | Invalid characters after number |  | 3+1"]],
      ["js ts", "007_1;", [" | Invalid characters after number |  | 3+1"]],
      ["js ts", "0k0;", [" | Invalid characters after number |  | 1+1"]],
      ["js ts", "1k;", [" | Invalid characters after number |  | 1+1"]],
      ["js ts", "0.5k;", [" | Invalid characters after number |  | 3+1"]],
      ["js ts", "1e3k;", [" | Invalid characters after number |  | 3+1"]],
      ["js ts", "1nk;", [" | Invalid characters after number |  | 2+1"]],
      ["js ts", "1_0k;", [" | Invalid characters after number |  | 3+1"]],
      [
        "js ts",
        "00 k;",
        [
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 2+0",
        ],
      ],
      [
        "js ts",
        "007.5;",
        [
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 3+0",
        ],
      ],
      ["js ts", "007;", []],
      ["js ts", "0x1n2;", [" | Invalid characters after number |  | 4+1"]],
      ["js ts", "0b12;", [" | Invalid characters after number |  | 3+1"]],
      ["js ts", "0o18;", [" | Invalid characters after number |  | 3+1"]],
      ["js ts", "0x1_;", [" | Invalid Character `;` |  | 4+0"]],
      ["js ts", "1.k;", [" | Invalid characters after number |  | 2+1"]],
      ["js ts", "1..k;", []],
      ["js", "x = \\;", [" | Invalid Unicode escape sequence |  | 5+1"]],
      ["js", "x = a\\u{110000};", [" | Invalid Unicode escape sequence |  | 6+8", " | Unexpected token |  | 14+1"]],
      ["js", "x = \\u;", [" | Invalid Unicode escape sequence |  | 5+1"]],
      ["js", "x = \\u12;", [" | Invalid Unicode escape sequence |  | 5+3"]],
      ["js", "x = \\u{;", [" | Invalid Unicode escape sequence |  | 5+2"]],
      ["js", "x = \\u{};", [" | Invalid Unicode escape sequence |  | 5+2", " | Unexpected token |  | 7+1"]],
      ["js", "x = \\x41;", [" | Invalid Unicode escape sequence |  | 5+1"]],
      ["js", "x = a\\;", [" | Invalid Unicode escape sequence |  | 6+1"]],
      ["js", "x = a\\ b;", [" | Invalid Unicode escape sequence |  | 6+1"]],
      ["js", "x = \\u0030;", [" | Invalid Character `0` |  | 10+0"]],
      ["js", "x = a\\u0020;", [" | Invalid Character ` ` |  | 11+0"]],
      ["js", "x = a\\u0020b;", [" | Invalid Character ` ` |  | 11+0"]],
      ["js", "x = \\u{61;", [" | Invalid Unicode escape sequence |  | 5+4"]],
      ["js", "x = \\u{61}b\\;", [" | Invalid Unicode escape sequence |  | 12+1"]],
      [
        "js",
        "x = \\u12; const c;",
        [
          " | Invalid Unicode escape sequence |  | 5+3",
          " | Missing initializer in const declaration | Add an initializer (e.g. ` = undefined`) here | 16+1",
        ],
      ],
      [
        "js",
        "const c; x = \\u12;",
        [
          " | Invalid Unicode escape sequence |  | 14+3",
          " | Missing initializer in const declaration | Add an initializer (e.g. ` = undefined`) here | 6+1",
        ],
      ],
      [
        "js",
        "x = a\\u{110000}; const c;",
        [" | Invalid Unicode escape sequence |  | 6+8", " | Unexpected token |  | 14+1"],
      ],
      ["js", "x = \\a;", [" | Invalid Unicode escape sequence |  | 5+1"]],
      ["js", "\\", [" | Invalid Unicode escape sequence |  | 1+1"]],
      ["js", "x.\\u12;", [" | Invalid Unicode escape sequence |  | 3+3"]],
      ["js", "x = { \\u12: 1 };", [" | Invalid Unicode escape sequence |  | 7+3"]],
      ["js", "let \\u12 = 1;", [" | Invalid Unicode escape sequence |  | 5+3"]],
      ["js", "x = \\u{zz};", [" | Invalid Unicode escape sequence |  | 5+2", " | Unexpected token |  | 9+1"]],
      ["js", "x = \\uD800;", [" | Invalid Unicode escape sequence |  | 5+5"]],
      ["js", "x = #\\u12;", [" | Expected `in` but found `;` |  | 9+1 `in` expected"]],
      ["js", "x = #\\;", [" | Expected `in` but found `EOF` |  | 8+0 `in` expected"]],
      ["js", "x = #\\u{};", [" | Expected `in` but found `}` |  | 8+1 `in` expected"]],
      ["js", "x = #\\u{110000};", [" | Expected `in` but found `}` |  | 14+1 `in` expected"]],
      ["js", "x = #\\u0061;", [" | Expected `in` but found `;` |  | 11+1 `in` expected"]],
      ["js", "x = #\\u0030;", [" | Expected `in` but found `;` |  | 11+1 `in` expected"]],
      ["js", "x = #a\\u12;", [" | Expected `in` but found `;` |  | 10+1 `in` expected"]],
      ["js", "x = #a\\;", [" | Expected `in` but found `EOF` |  | 9+0 `in` expected"]],
      ["js", "class A { #\\u12 = 1 }", [" | Invalid Unicode escape sequence |  | 12+3"]],
      [
        "js",
        "class A { #\\u12; m() { this.#\\u12; } }",
        [" | Invalid Unicode escape sequence |  | 12+3", " | Invalid Unicode escape sequence |  | 30+3"],
      ],
      ["js", "class A { #a\\u12 = 1 }", [" | Invalid Unicode escape sequence |  | 13+3"]],
      ["js", "x.#\\u12;", [" | Invalid Unicode escape sequence |  | 4+3"]],
      ["js", "x = #\\u12 in y;", [" | Invalid Unicode escape sequence |  | 6+3"]],
      ["js", "x = #a;", [" | Expected `in` but found `;` |  | 6+1 `in` expected"]],
      ["js", "x = # a;", [" | Invalid Character ` ` |  | 5+1"]],
    ],
  ],
  [
    "a regular expression without an end, by what is around it",
    undefined,
    [
      ["js ts", "/ {}", [" | Unterminated regular expression |  | 0+5", " | Unexpected token |  | 0+5"]],
      ["js ts", "x = / {}", [" | Unterminated regular expression |  | 4+5", " | Unexpected token |  | 4+5"]],
      ["js ts", "x = / {}\nfoo();", [" | Unterminated regular expression |  | 4+5", " | Unexpected token |  | 4+12"]],
      ["js ts", "x = (/ {}", [" | Unterminated regular expression |  | 5+5"]],
      ["js ts", "x = [/ {}", [" | Unterminated regular expression |  | 5+5"]],
      ["js ts", "f(/ {}", [" | Unterminated regular expression |  | 2+5"]],
      ["js ts", "f(/ {}\n);", [" | Unterminated regular expression |  | 2+5"]],
      ["js ts", "f(/ {}\n)", [" | Unterminated regular expression |  | 2+5"]],
      ["js ts", "x = f(/ {}", [" | Unterminated regular expression |  | 6+5"]],
      ["js ts", "let x = / {}", [" | Unterminated regular expression |  | 8+5", " | Unexpected token |  | 8+5"]],
      [
        "js ts",
        "let x = / {}\nfoo();",
        [" | Unterminated regular expression |  | 8+5", " | Unexpected token |  | 8+12"],
      ],
      ["js ts", "x + / {}", [" | Unterminated regular expression |  | 4+5", " | Unexpected token |  | 4+5"]],
      ["js ts", "!/ {}", [" | Unterminated regular expression |  | 1+5", " | Unexpected token |  | 1+5"]],
      ["js ts", "x = {a: / {}", [" | Unterminated regular expression |  | 8+5"]],
      ["js ts", "x = {a: / {}\n};", [" | Unterminated regular expression |  | 8+5"]],
      ["js ts", "function f() { return / {}", [" | Unterminated regular expression |  | 22+5"]],
      ["js ts", "function f() { return / {}\n}", [" | Unterminated regular expression |  | 22+5"]],
      ["js ts", "if (/ {}", [" | Unexpected token |  | 4+5"]],
      ["js ts", "if (/ {}\n) {}", [" | Unexpected token |  | 4+10"]],
      ["js ts", "class A extends / {}", [" | Unterminated regular expression |  | 16+5"]],
      ["js ts", "class A extends / {}\n{}", [" | Unterminated regular expression |  | 16+5"]],
      ["js ts", "x = / {}\n;", [" | Unterminated regular expression |  | 4+5", " | Unexpected token |  | 4+7"]],
      ["js ts", "x = /a", [" | Unterminated regular expression |  | 4+3", " | Unexpected token |  | 4+3"]],
      ["js ts", "x = /a\n.b", [" | Unterminated regular expression |  | 4+3", " | Unexpected token |  | 4+6"]],
      ["js ts", "x = /a\n+ 1;", [" | Unterminated regular expression |  | 4+3", " | Unexpected token |  | 4+8"]],
      ["js ts", "x = [/a\n];", [" | Unterminated regular expression |  | 5+3"]],
      ["js ts", "x = `${/a\n}`;", [" | Unterminated regular expression |  | 7+3", " | Unexpected token |  | 7+7"]],
      ["js", "while (/a", [" | Unexpected token |  | 7+3"]],
      ["js", "for (/a", [" | Unexpected token |  | 5+3"]],
      ["js", "for (;/a", [" | Unexpected token |  | 6+3"]],
      ["js", "for (;;/a", [" | Unexpected token |  | 7+3"]],
      ["js", "for (x of /a", [" | Unexpected token |  | 10+3"]],
      ["js", "for (x in /a", [" | Unexpected token |  | 10+3"]],
      ["js", "switch (/a", [" | Unterminated regular expression |  | 8+3"]],
      ["js", "with (/a", [" | Unexpected token |  | 6+3"]],
      ["js", "do {} while (/a", [" | Unterminated regular expression |  | 13+3"]],
      ["js", "{ x = /a", [" | Unterminated regular expression |  | 6+3"]],
      ["js", "{ /a", [" | Unterminated regular expression |  | 2+3"]],
      ["js", "x = () => /a", [" | Unterminated regular expression |  | 10+3", " | Unexpected token |  | 10+3"]],
      ["js", "x = () => { /a", [" | Unterminated regular expression |  | 12+3"]],
      ["js", "x = (a) => /a", [" | Unterminated regular expression |  | 11+3", " | Unexpected token |  | 11+3"]],
      ["js", "x = y ? /a", [" | Unexpected token |  | 8+3"]],
      ["js", "x = y ? z : /a", [" | Unterminated regular expression |  | 12+3", " | Unexpected token |  | 12+3"]],
      ["js", "export default /a", [" | Unterminated regular expression |  | 15+3", " | Unexpected token |  | 15+3"]],
      ["js", "throw /a", [" | Unterminated regular expression |  | 6+3", " | Unexpected token |  | 6+3"]],
      ["js", "a: /a", [" | Unterminated regular expression |  | 3+3", " | Unexpected token |  | 3+3"]],
      ["js", "class A { x = /a", [" | Unterminated regular expression |  | 14+3"]],
      ["js", "class A { [/a", [" | Unterminated regular expression |  | 11+3"]],
      ["js", "class A { static { /a", [" | Unterminated regular expression |  | 19+3"]],
      ["js", "new X(/a", [" | Unterminated regular expression |  | 6+3"]],
      ["js", "x[/a", [" | Unterminated regular expression |  | 2+3"]],
      ["js", "import(/a", [" | Unterminated regular expression |  | 7+3", " | Unexpected token |  | 7+3"]],
      ["js", "switch (x) { case /a", [" | Unterminated regular expression |  | 18+3"]],
      ["js", "switch (x) { case 1: /a", [" | Unterminated regular expression |  | 21+3"]],
      ["js", "if (x) /a", [" | Unterminated regular expression |  | 7+3", " | Unexpected token |  | 7+3"]],
      ["js", "if (x) {} else /a", [" | Unterminated regular expression |  | 15+3", " | Unexpected token |  | 15+3"]],
      ["js", "while (x) /a", [" | Unterminated regular expression |  | 10+3", " | Unexpected token |  | 10+3"]],
      ["js", "x = function() { /a", [" | Unterminated regular expression |  | 17+3"]],
      ["js", "try { /a", [" | Unterminated regular expression |  | 6+3"]],
      ["js", "x, /a", [" | Unterminated regular expression |  | 3+3", " | Unexpected token |  | 3+3"]],
      ["js", "var x = 1, y = /a", [" | Unterminated regular expression |  | 15+3", " | Unexpected token |  | 15+3"]],
      ["js", "const [a = /a", [" | Unterminated regular expression |  | 11+3"]],
      ["js", "function f(a = /a", [" | Unterminated regular expression |  | 15+3"]],
      ["js", "x = {[/a", [" | Unexpected token |  | 6+3"]],
      ["js", "x = {...(/a", [" | Unterminated regular expression |  | 9+3"]],
      ["js", "yield /a", []],
      ["js", "typeof /a", [" | Unterminated regular expression |  | 7+3", " | Unexpected token |  | 7+3"]],
      ["js", "x = a || /a", [" | Unterminated regular expression |  | 9+3", " | Unexpected token |  | 9+3"]],
      ["js", "f`${/a", [" | Unterminated regular expression |  | 4+3", " | Unexpected token |  | 4+3"]],
      ["js", "export const x = /a", [" | Unterminated regular expression |  | 17+3", " | Unexpected token |  | 17+3"]],
      ["js", "if (a) { if (/a", [" | Unexpected token |  | 13+3"]],
      ["js", "f(() => /a", [" | Unterminated regular expression |  | 8+3"]],
      ["js", "if (f(/a", [" | Unexpected token |  | 6+3"]],
      ["js", "f(a, if (/a", [" | Unexpected token |  | 5+2"]],
    ],
  ],
  [
    "await in CommonJS files and in the parameters of a type",
    undefined,
    [
      [
        "ts",
        "async function f() { let g: (a: { [await (k)]: number }) => void; }",
        [
          " | await expression not allowed in formal parameter |  | 35+9 await expression not allowed in formal parameter",
        ],
      ],
      [
        "ts",
        "async function f() { let g: new (a: { [await (k)]: number }) => void; }",
        [
          " | await expression not allowed in formal parameter |  | 39+9 await expression not allowed in formal parameter",
        ],
      ],
      [
        "ts",
        "async function f() { let g: { m(a: { [await (k)]: number }): void }; }",
        [
          " | await expression not allowed in formal parameter |  | 38+9 await expression not allowed in formal parameter",
        ],
      ],
      [
        "ts",
        "async function f() { let g: { (a: { [await (k)]: number }): void }; }",
        [
          " | await expression not allowed in formal parameter |  | 37+9 await expression not allowed in formal parameter",
        ],
      ],
      [
        "ts",
        "async function f() { let g: { new (a: { [await (k)]: number }): void }; }",
        [
          " | await expression not allowed in formal parameter |  | 41+9 await expression not allowed in formal parameter",
        ],
      ],
      // `this` and the key of an index signature are no formal parameters.
      ["ts", "function g(this: { [await 1]: 2 }) {}", []],
      ["ts", "let g: (this: { [await 1]: 2 }) => void;", []],
      ["ts", "type T = { [i: { [await 1]: 2 }]: 1 };", []],
      ["ts", "class C { [i: { [await 1]: 2 }]: 1 }", []],
      ["ts", "async function f() { let g: { [i: { [await (k)]: 2 }]: 1 }; }", []],
      ["ts", "async function f() { let g: (this: { [await (k)]: 2 }) => void; }", []],
      ["ts", "function* f() { let g: (this: { [yield k]: 2 }) => void; }", []],
      // The parameter around them is one, and a signature in its type does not end it.
      [
        "ts",
        "function g(a: (this: { [await 1]: 2 }) => void) {}",
        [
          " | await expression not allowed in formal parameter |  | 24+7 await expression not allowed in formal parameter",
        ],
      ],
      [
        "ts",
        "function g(a: { [i: { [await 1]: 2 }]: 1 }) {}",
        [
          " | await expression not allowed in formal parameter |  | 23+7 await expression not allowed in formal parameter",
        ],
      ],
      [
        "ts",
        "function g(a: (b: X) => { [await 1]: 2 }) {}",
        [
          " | await expression not allowed in formal parameter |  | 27+7 await expression not allowed in formal parameter",
        ],
      ],
      [
        "ts",
        "function g(a: <T extends { [await 1]: 2 }>() => void) {}",
        [
          " | await expression not allowed in formal parameter |  | 28+7 await expression not allowed in formal parameter",
        ],
      ],
      [
        "ts",
        "function g(a: { [i: string]: { [await 1]: 2 } }) {}",
        [
          " | await expression not allowed in formal parameter |  | 32+7 await expression not allowed in formal parameter",
        ],
      ],
      // In a file that nothing makes a module it is a call of `await`, as beside the type.
      ["ts", "let g: (a: { [await (k)]: 2 }) => void;", []],
      ["ts", "let g: { m(a: { [await (k)]: 2 }): void };", []],
      [
        "ts",
        "let g: (a: { [await (k)]: 2 }) => void; export {};",
        [
          " | await expression not allowed in formal parameter |  | 14+9 await expression not allowed in formal parameter",
        ],
      ],
      ["ts", "async function f() { let g: (a: typeof await) => void; }", []],
      ["ts", "async function f() { let g: (a: number) => { [await (k)]: number }; }", []],
      [
        "ts",
        "function* f() { let g: (a: { [yield]: number }) => void; }",
        [
          " | yield expression not allowed in formal parameter |  | 30+5 yield expression not allowed in formal parameter",
        ],
      ],
      [
        "ts",
        "function* f() { let g: (a: { [yield k]: number }) => void; }",
        [
          " | yield expression not allowed in formal parameter |  | 30+7 yield expression not allowed in formal parameter",
        ],
      ],
      [
        "ts",
        "async function f() { let g: (a = await k) => void; }",
        [
          " | await expression not allowed in formal parameter |  | 33+7 await expression not allowed in formal parameter",
        ],
      ],
      ["ts", "async function f() { interface A { m(a: { [await (k)]: number }): void } }", []],
      ["ts", "async function f() { type A = (a: { [await (k)]: number }) => void; }", []],
      ["ts", "function f() { let g: (a: { [await (k)]: number }) => void; }", []],
      [
        "ts",
        "async function f() { let g: (await: number) => void; }",
        [" | Cannot use `await` as an identifier in an async context |  | 29+5"],
      ],
      ["ts", "async function f() { function h(a: { [await (k)]: number }) {} }", []],
      [
        "ts",
        "async function f() { const h = (a: { [await (k)]: number }) => 1; }",
        [
          " | await expression not allowed in formal parameter |  | 38+9 await expression not allowed in formal parameter",
        ],
      ],
      [
        "cjs cts",
        "await (k); await k;",
        [
          " | `await` is only allowed within async functions and at the top levels of modules | Either remove this `await` or add the `async` keyword to the enclosing function | 11+5",
        ],
      ],
      ["cjs cts", "await [k]; await +k; await -k; await /k/; await `k`;", [" | Unexpected token |  | 40+1"]],
      ["cjs cts", "await (k);", []],
      [
        "cjs cts",
        "x = await (k) + await k;",
        [
          " | `await` is only allowed within async functions and at the top levels of modules | Either remove this `await` or add the `async` keyword to the enclosing function | 16+5",
        ],
      ],
      [
        "cjs cts",
        "function f() { await (k); await k; }",
        [
          " | `await` is only allowed within async functions and at the top levels of modules | Either remove this `await` or add the `async` keyword to the enclosing function | 26+5",
        ],
      ],
      ["cjs cts", "await\nk;", []],
      [
        "cjs cts",
        'await k.l; await new k; await function () {}; await class {}; await "a"; await 1; await this; await null;',
        [
          " | `await` is only allowed within async functions and at the top levels of modules | Either remove this `await` or add the `async` keyword to the enclosing function | 0+5",
          " | `await` is only allowed within async functions and at the top levels of modules | Either remove this `await` or add the `async` keyword to the enclosing function | 11+5",
          " | `await` is only allowed within async functions and at the top levels of modules | Either remove this `await` or add the `async` keyword to the enclosing function | 24+5",
          " | `await` is only allowed within async functions and at the top levels of modules | Either remove this `await` or add the `async` keyword to the enclosing function | 46+5",
          " | `await` is only allowed within async functions and at the top levels of modules | Either remove this `await` or add the `async` keyword to the enclosing function | 62+5",
          " | `await` is only allowed within async functions and at the top levels of modules | Either remove this `await` or add the `async` keyword to the enclosing function | 73+5",
          " | `await` is only allowed within async functions and at the top levels of modules | Either remove this `await` or add the `async` keyword to the enclosing function | 82+5",
          " | `await` is only allowed within async functions and at the top levels of modules | Either remove this `await` or add the `async` keyword to the enclosing function | 94+5",
        ],
      ],
      [
        "cjs",
        "await !k; await ~k; await typeof k; await ++k; await <k></k>;",
        [
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 5+0",
        ],
      ],
      [
        "cts",
        "await !k; await ~k; await typeof k; await ++k; await <k></k>;",
        [
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 7+0",
        ],
      ],
      [
        "cjs cts",
        'await async () => 1; await await k; await { a: 1 }; await import("a"); await super.a;',
        [
          " | `await` is only allowed within async functions and at the top levels of modules | Either remove this `await` or add the `async` keyword to the enclosing function | 0+5",
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 14+0",
        ],
      ],
      [
        "cjs",
        "await await k;",
        [
          " | `await` is only allowed within async functions and at the top levels of modules | Either remove this `await` or add the `async` keyword to the enclosing function | 0+5",
        ],
      ],
      [
        "cjs",
        "await await await k;",
        [
          " | `await` is only allowed within async functions and at the top levels of modules | Either remove this `await` or add the `async` keyword to the enclosing function | 0+5",
        ],
      ],
      [
        "cjs",
        "await (await k);",
        [
          " | `await` is only allowed within async functions and at the top levels of modules | Either remove this `await` or add the `async` keyword to the enclosing function | 7+5",
        ],
      ],
      [
        "cjs",
        "await k + await j;",
        [
          " | `await` is only allowed within async functions and at the top levels of modules | Either remove this `await` or add the `async` keyword to the enclosing function | 0+5",
          " | `await` is only allowed within async functions and at the top levels of modules | Either remove this `await` or add the `async` keyword to the enclosing function | 10+5",
        ],
      ],
      [
        "js",
        "function f() { await await k; }",
        [
          " | `await` is only allowed within async functions and at the top levels of modules | Either remove this `await` or add the `async` keyword to the enclosing function | 15+5",
        ],
      ],
    ],
  ],
  [
    "JSX",
    undefined,
    [
      [
        "jsx tsx",
        "<a></b>;",
        [" | Expected corresponding JSX closing tag for 'a'. |  | 5+1 Expected `</a>` | 1+1 Opened here"],
      ],
      [
        "jsx tsx",
        "<a><b></a></b>;",
        [
          " | Expected corresponding JSX closing tag for 'b'. |  | 8+1 Expected `</b>` | 4+1 Opened here",
          " | Expected corresponding JSX closing tag for 'a'. |  | 12+1 Expected `</a>` | 1+1 Opened here",
        ],
      ],
      [
        "jsx tsx",
        "<a.b></a.c>;",
        [" | Expected corresponding JSX closing tag for 'a.b'. |  | 7+3 Expected `</a.b>` | 1+3 Opened here"],
      ],
      [
        "jsx tsx",
        "<a:b></a:c>;",
        [" | Expected corresponding JSX closing tag for 'a:b'. |  | 7+3 Expected `</a:b>` | 1+3 Opened here"],
      ],
      [
        "jsx tsx",
        "<></a>;",
        [" | Expected corresponding closing tag for JSX fragment. |  | 4+1 Expected `</>` | 0+2 Opened here"],
      ],
      [
        "jsx tsx",
        "<a></>;",
        [" | Expected corresponding JSX closing tag for 'a'. |  | 3+3 Expected `</a>` | 1+1 Opened here"],
      ],
      ["jsx tsx", "<a>", [" | Unexpected token |  | 3+1"]],
      ["jsx tsx", "<a><b></b>", [" | Unexpected token |  | 10+1"]],
      [
        "jsx tsx",
        "<a></b>; const c;",
        [
          " | Expected corresponding JSX closing tag for 'a'. |  | 5+1 Expected `</a>` | 1+1 Opened here",
          " | Missing initializer in const declaration | Add an initializer (e.g. ` = undefined`) here | 15+1",
        ],
      ],
      [
        "jsx tsx",
        "const c; <a></b>;",
        [
          " | Missing initializer in const declaration | Add an initializer (e.g. ` = undefined`) here | 6+1",
          " | Expected corresponding JSX closing tag for 'a'. |  | 14+1 Expected `</a>` | 10+1 Opened here",
        ],
      ],
      ["jsx tsx", "<a b= />;", [" | Unexpected token |  | 6+1"]],
      [
        "jsx tsx",
        "<a b={} />;",
        ["TS(17000) | JSX attributes must only be assigned a non-empty 'expression'. |  | 5+2"],
      ],
      ["jsx tsx", "<a {...} />;", [" | Unexpected token |  | 7+1"]],
      ["jsx tsx", "<a>{</a>;", [" | Unexpected token |  | 5+1"]],
      ["jsx tsx", "<a>}</a>;", [" | Unexpected token. Did you mean `{'}'}` or `&rbrace;`? |  | 3+0"]],
      ["jsx tsx", "<a>></a>;", [" | Unexpected token. Did you mean `{'>'}` or `&gt;`? |  | 3+0"]],
      [
        "jsx tsx",
        "<a /><b />;",
        [
          " | Adjacent JSX elements must be wrapped in an enclosing tag. | Did you want a JSX fragment `<>...</>`? | 5+1",
        ],
      ],
      [
        "jsx tsx",
        "x = <a /><b />;",
        [
          " | Adjacent JSX elements must be wrapped in an enclosing tag. | Did you want a JSX fragment `<>...</>`? | 9+1",
        ],
      ],
      ["jsx tsx", '<a b="c />;', [" | Unterminated string |  | 5+7"]],
      ["jsx tsx", "<a b=c />;", [" | Unexpected token |  | 5+1"]],
      ["jsx tsx", "<a b b />;", []],
      ["jsx tsx", "<a.b:c />;", [" | Unexpected token |  | 4+1"]],
      ["jsx tsx", "<a:b.c />;", [" | Unexpected token |  | 4+1"]],
      ["jsx tsx", "<a-b.c />;", []],
      ["jsx tsx", "<1 />;", [" | Unexpected token |  | 1+1"]],
      ["jsx tsx", "< a />;", []],
      ["jsx tsx", "<a / >;", []],
      ["jsx tsx", "<a></ a>;", []],
      ["jsx tsx", "<this></this>;", []],
      ["jsx tsx", "<a>{...b}</a>;", []],
      ["jsx tsx", "<a>{b c}</a>;", [" | Expected `}` but found `Identifier` |  | 6+1 `}` expected"]],
      ["jsx tsx", "<a b={c d} />;", [" | Expected `}` but found `Identifier` |  | 8+1 `}` expected"]],
      ["jsx tsx", "<a>&foo;</a>;", []],
      ["jsx tsx", "<1 />;", [" | Unexpected token |  | 1+1"]],
      ["jsx tsx", '<"a" />;', [" | Unexpected token |  | 1+3"]],
      ["jsx tsx", "x = <1>;", [" | Unexpected token |  | 5+1"]],
      ["jsx tsx", "<{} />;", [" | Unexpected token |  | 1+1"]],
      ["jsx tsx", "<(a) />;", [" | Unexpected token |  | 1+1"]],
      ["jsx tsx", "<[a] />;", [" | Unexpected token |  | 1+1"]],
      ["jsx tsx", "<+ />;", [" | Unexpected token |  | 1+1"]],
      ["jsx tsx", "<. />;", [" | Unexpected token |  | 1+1"]],
      ["jsx tsx", "< />;", [" | Unexpected token |  | 2+1"]],
      ["jsx tsx", "<a><1 /></a>;", [" | Unexpected token |  | 4+1"]],
      ["js", "<1 />;", [" | Unexpected token |  | 1+1"]],
    ],
  ],
  [
    "brackets that are not closed",
    undefined,
    [
      ["ts", "interface A extends B {", [" | Expected `}` but found `EOF` |  | 24+0 `}` expected | 22+1 Opened here"]],
      [
        "ts",
        "interface A extends B, {",
        [
          "TS(1009) | Trailing comma not allowed. |  | 21+1",
          " | Expected `}` but found `EOF` |  | 25+0 `}` expected | 23+1 Opened here",
        ],
      ],
      ["ts", "interface A {", [" | Expected `}` but found `EOF` |  | 14+0 `}` expected | 12+1 Opened here"]],
      ["js ts", "class A {", [" | Expected `}` but found `EOF` |  | 10+0 `}` expected | 8+1 Opened here"]],
      ["js ts", "function f() {", [" | Expected `}` but found `EOF` |  | 15+0 `}` expected | 13+1 Opened here"]],
      ["js ts", "{", [" | Expected `}` but found `EOF` |  | 2+0 `}` expected | 0+1 Opened here"]],
      ["js ts", "if (a) {", [" | Expected `}` but found `EOF` |  | 9+0 `}` expected | 7+1 Opened here"]],
      ["js ts", "x = {", [" | Expected `}` but found `EOF` |  | 6+0 `}` expected"]],
      ["js ts", "x = [", [" | Expected `]` but found `EOF` |  | 6+0 `]` expected"]],
      ["js ts", "f(", [" | Expected `)` but found `EOF` |  | 3+0 `)` expected"]],
      ["js ts", "try {} catch (e?) {}", [" | Expected `)` but found `?` |  | 15+1 `)` expected"]],
      ["js ts", "try {} catch (e f) {}", [" | Expected `)` but found `Identifier` |  | 16+1 `)` expected"]],
      ["js ts", "try {} catch (e", [" | Expected `)` but found `EOF` |  | 16+0 `)` expected"]],
      ["js ts", "if (a b) {}", [" | Expected `)` but found `Identifier` |  | 6+1 `)` expected | 3+1 Opened here"]],
      ["js ts", "while (a b) {}", [" | Expected `)` but found `Identifier` |  | 9+1 `)` expected | 6+1 Opened here"]],
      ["js ts", "for (a b) {}", [" | Expected `;` but found `Identifier` |  | 7+1 `;` expected"]],
      ["js ts", "switch (a b) {}", [" | Expected `)` but found `Identifier` |  | 10+1 `)` expected | 7+1 Opened here"]],
      [
        "js ts",
        "f(a b);",
        [" | Expected `,` or `)` but found `Identifier` |  | 4+1 `,` or `)` expected | 1+1 Opened here"],
      ],
      [
        "js ts",
        "function f(a b) {}",
        [" | Expected `,` or `)` but found `Identifier` |  | 13+1 `,` or `)` expected | 10+1 Opened here"],
      ],
      [
        "js ts",
        "x = (a b);",
        [" | Expected `,` or `)` but found `Identifier` |  | 7+1 `,` or `)` expected | 4+1 Opened here"],
      ],
      [
        "js ts",
        "x = [a b];",
        [" | Expected `,` or `]` but found `Identifier` |  | 7+1 `,` or `]` expected | 4+1 Opened here"],
      ],
      [
        "js ts",
        "x = {a b};",
        [" | Expected `,` or `}` but found `Identifier` |  | 7+1 `,` or `}` expected | 4+1 Opened here"],
      ],
      ["js ts", "with (a b) {}", [" | Expected `)` but found `Identifier` |  | 8+1 `)` expected | 5+1 Opened here"]],
      [
        "js ts",
        "do {} while (a b);",
        [" | Expected `)` but found `Identifier` |  | 15+1 `)` expected | 12+1 Opened here"],
      ],
      [
        "js ts",
        "new A(a b);",
        [" | Expected `,` or `)` but found `Identifier` |  | 8+1 `,` or `)` expected | 5+1 Opened here"],
      ],
      [
        "js ts",
        "import(a b);",
        [
          " | Dynamic imports can only accept a module specifier and an optional set of attributes as arguments |  | 0+8",
        ],
      ],
      ["js ts", "x = a[b c];", [" | Expected `]` but found `Identifier` |  | 8+1 `]` expected"]],
      ["js ts", "switch (a) {", [" | Expected `}` but found `EOF` |  | 13+0 `}` expected | 11+1 Opened here"]],
      ["ts", "enum A {", [" | Expected `}` but found `EOF` |  | 9+0 `}` expected"]],
      ["ts", "namespace A {", [" | Expected `}` but found `EOF` |  | 14+0 `}` expected"]],
      ["ts", "type A = {", [" | Expected `}` but found `EOF` |  | 11+0 `}` expected | 9+1 Opened here"]],
      ["ts", "type A = [", [" | Expected `]` but found `EOF` |  | 11+0 `]` expected"]],
      ["ts", "type A = (", [" | Unexpected token |  | 11+0"]],
      ["js ts", "const {", [" | Expected `}` but found `EOF` |  | 8+0 `}` expected"]],
      ["js ts", "function f({", [" | Expected `}` but found `EOF` |  | 13+0 `}` expected"]],
      ["js ts", "import {", [" | Expected `}` but found `EOF` |  | 9+0 `}` expected"]],
      ["js ts", "export {", [" | Expected `}` but found `EOF` |  | 9+0 `}` expected"]],
      ["js ts", "x = () => {", [" | Expected `}` but found `EOF` |  | 12+0 `}` expected | 10+1 Opened here"]],
      ["js ts", "class A { m() {", [" | Expected `}` but found `EOF` |  | 16+0 `}` expected | 14+1 Opened here"]],
      ["js ts", "class A { static {", [" | Expected `}` but found `EOF` |  | 19+0 `}` expected | 17+1 Opened here"]],
      ["js ts", "x = class {", [" | Expected `}` but found `EOF` |  | 12+0 `}` expected | 10+1 Opened here"]],
      ["js ts", "x = function() {", [" | Expected `}` but found `EOF` |  | 17+0 `}` expected | 15+1 Opened here"]],
      ["js ts", "a: {", [" | Expected `}` but found `EOF` |  | 5+0 `}` expected | 3+1 Opened here"]],
      ["js ts", "try {", [" | Expected `}` but found `EOF` |  | 6+0 `}` expected | 4+1 Opened here"]],
      ["js ts", "try {} catch {", [" | Expected `}` but found `EOF` |  | 15+0 `}` expected | 13+1 Opened here"]],
      ["js ts", "try {} finally {", [" | Expected `}` but found `EOF` |  | 17+0 `}` expected | 15+1 Opened here"]],
      [
        "js ts",
        "switch (a) { case 1: {",
        [" | Expected `}` but found `EOF` |  | 23+0 `}` expected | 21+1 Opened here"],
      ],
      ["js ts", "x = { a: {", [" | Expected `}` but found `EOF` |  | 11+0 `}` expected"]],
      ["js ts", "x = { m() {", [" | Expected `}` but found `EOF` |  | 12+0 `}` expected | 10+1 Opened here"]],
      ["js ts", "f({", [" | Expected `}` but found `EOF` |  | 4+0 `}` expected"]],
      ["js ts", "x = `${", [" | Unexpected token |  | 8+0"]],
      ["js ts", "for (;;) {", [" | Expected `}` but found `EOF` |  | 11+0 `}` expected | 9+1 Opened here"]],
      ["js ts", "do {", [" | Expected `}` but found `EOF` |  | 5+0 `}` expected | 3+1 Opened here"]],
      ["js ts", "else {", [" | Unexpected token |  | 0+4"]],
      ["js ts", "({", [" | Expected `}` but found `EOF` |  | 3+0 `}` expected"]],
      ["ts", 'declare module "a" {', [" | Expected `}` but found `EOF` |  | 21+0 `}` expected"]],
      ["ts", "declare global {", [" | Expected `}` but found `EOF` |  | 17+0 `}` expected"]],
      ["ts", "module A.B {", [" | Expected `}` but found `EOF` |  | 13+0 `}` expected"]],
      ["ts", "type A = { b: {", [" | Expected `}` but found `EOF` |  | 16+0 `}` expected | 14+1 Opened here"]],
      ["ts", "interface A { b: {", [" | Expected `}` but found `EOF` |  | 19+0 `}` expected | 17+1 Opened here"]],
      ["ts", "let a: {", [" | Expected `}` but found `EOF` |  | 9+0 `}` expected | 7+1 Opened here"]],
      ["ts", "const enum A {", [" | Expected `}` but found `EOF` |  | 15+0 `}` expected"]],
      ["ts", "abstract class A {", [" | Expected `}` but found `EOF` |  | 19+0 `}` expected | 17+1 Opened here"]],
      [
        "ts",
        "namespace A { function f() {",
        [" | Expected `}` but found `EOF` |  | 29+0 `}` expected | 27+1 Opened here"],
      ],
      ["ts", "type A = { [K in B]: {", [" | Expected `}` but found `EOF` |  | 23+0 `}` expected | 21+1 Opened here"]],
      ["jsx tsx", "<a b={", [" | Unexpected token |  | 7+0"]],
      ["jsx tsx", "<a>{", [" | Unexpected token |  | 5+0"]],
      [
        "ts",
        "function f(public a b) {}",
        [
          "TS(1090) | 'public' modifier cannot appear on a parameter. | No modifiers are allowed here. | 11+6",
          " | Expected `,` or `)` but found `Identifier` |  | 20+1 `,` or `)` expected | 10+1 Opened here",
        ],
      ],
      [
        "ts",
        "class A { m(public a b) {} }",
        [
          "TS(1090) | 'public' modifier cannot appear on a parameter. | No modifiers are allowed here. | 12+6",
          " | Expected `,` or `)` but found `Identifier` |  | 21+1 `,` or `)` expected | 11+1 Opened here",
        ],
      ],
      [
        "ts",
        "function f(a?, b c) {}",
        [
          "TS(1016) | A required parameter cannot follow an optional parameter. |  | 15+1",
          " | Expected `,` or `)` but found `Identifier` |  | 17+1 `,` or `)` expected | 10+1 Opened here",
        ],
      ],
      [
        "ts",
        "function f(y: readonly number, a b) { }",
        [
          "TS(1354) | 'readonly' type modifier is only permitted on array and tuple literal types. |  | 14+8",
          " | Expected `,` or `)` but found `Identifier` |  | 33+1 `,` or `)` expected | 10+1 Opened here",
        ],
      ],
      [
        "ts",
        "function f(public a, b = ) {}",
        [
          "TS(1090) | 'public' modifier cannot appear on a parameter. | No modifiers are allowed here. | 11+6",
          " | Unexpected token |  | 25+1",
        ],
      ],
      [
        "ts",
        "let y: readonly number; function f(a b) { }",
        [
          "TS(1354) | 'readonly' type modifier is only permitted on array and tuple literal types. |  | 7+8",
          " | Expected `,` or `)` but found `Identifier` |  | 37+1 `,` or `)` expected | 34+1 Opened here",
        ],
      ],
      ["js", "x = [const c, a b];", [" | Unexpected token |  | 5+5"]],
      [
        "js",
        "f(a ? b c);",
        [" | Expected `:` but found `Identifier` |  | 8+1 `:` expected | 4+1 Conditional starts here"],
      ],
      [
        "ts",
        "x = a ? (public b c) : d;",
        [
          "TS(1090) | 'public' modifier cannot appear on a parameter. | No modifiers are allowed here. | 9+6",
          " | Expected `,` or `)` but found `Identifier` |  | 18+1 `,` or `)` expected | 8+1 Opened here",
        ],
      ],
      [
        "js",
        "x = { a: 08, b c };",
        [" | Expected `,` or `}` but found `Identifier` |  | 15+1 `,` or `}` expected | 4+1 Opened here"],
      ],
      [
        "js",
        "f(08, a b);",
        [" | Expected `,` or `)` but found `Identifier` |  | 8+1 `,` or `)` expected | 1+1 Opened here"],
      ],
    ],
  ],
  [
    "import attributes",
    undefined,
    [
      [
        "js ts",
        'import a from "m" with { type: 1 };',
        [" | Only string literals are allowed as module attribute values. | Wrap this with quotes | 31+1"],
      ],
      [
        "js ts",
        'import a from "m" with { type: 1 }; const c;',
        [" | Only string literals are allowed as module attribute values. | Wrap this with quotes | 31+1"],
      ],
      [
        "js ts",
        'import a from "m" with { type: 1 }; let d; let d;',
        [" | Only string literals are allowed as module attribute values. | Wrap this with quotes | 31+1"],
      ],
      [
        "js ts",
        'import a from "m" with { type: 1, b: 2 };',
        [" | Only string literals are allowed as module attribute values. | Wrap this with quotes | 31+1"],
      ],
      [
        "js ts",
        'import a from "m" with { type: x };',
        [" | Only string literals are allowed as module attribute values. | Wrap this with quotes | 31+1"],
      ],
      [
        "js ts",
        'import a from "m" with { type: `json` };',
        [" | Only string literals are allowed as module attribute values. | Wrap this with quotes | 31+6"],
      ],
      [
        "js ts",
        'import a from "m" with { type: "json", type: "json" };',
        [
          " | Identifier `type` has already been declared |  | 25+4 `type` has already been declared here | 39+4 It can not be redeclared here",
        ],
      ],
      ["js ts", 'import a from "m" with { 1: "json" };', [" | Unexpected token |  | 25+1"]],
      ["js ts", 'import a from "m" with { "type": "json" };', []],
      ["js ts", 'import a from "m" with { [type]: "json" };', [" | Unexpected token |  | 25+1"]],
      ["js ts", 'import a from "m" with { type };', [" | Expected `:` but found `}` |  | 30+1 `:` expected"]],
      ["js ts", 'import a from "m" with { ...type };', [" | Unexpected token |  | 25+3"]],
      ["js ts", 'import a from "m" with { type: "json", };', []],
      ["js ts", 'import a from "m" with { type() {} };', [" | Expected `:` but found `(` |  | 29+1 `:` expected"]],
      [
        "js ts",
        'import a from "m" with { type: 1 + 2 };',
        [" | Only string literals are allowed as module attribute values. | Wrap this with quotes | 31+1"],
      ],
      [
        "js ts",
        'import a from "m" with { type: ("json") };',
        [" | Only string literals are allowed as module attribute values. | Wrap this with quotes | 31+1"],
      ],
      [
        "js ts",
        'export * from "m" with { type: 1 };',
        [" | Only string literals are allowed as module attribute values. | Wrap this with quotes | 31+1"],
      ],
      [
        "js ts",
        'export { a } from "m" with { type: 1 };',
        [" | Only string literals are allowed as module attribute values. | Wrap this with quotes | 35+1"],
      ],
      [
        "js ts",
        'import "m" with { type: 1 };',
        [" | Only string literals are allowed as module attribute values. | Wrap this with quotes | 24+1"],
      ],
      [
        "js ts",
        'import a from "m" assert { type: 1 };',
        [" | Only string literals are allowed as module attribute values. | Wrap this with quotes | 33+1"],
      ],
      ["ts", 'type A = import("m", { with: { type: 1 } });', []],
      ["ts", 'type A = import("m", { with: { type: "json" } });', []],
      [
        "js ts",
        'import a from "m" with { type: null };',
        [" | Only string literals are allowed as module attribute values. | Wrap this with quotes | 31+4"],
      ],
      [
        "js ts",
        'import a from "m" with { type: -1 };',
        [" | Only string literals are allowed as module attribute values. | Wrap this with quotes | 31+1"],
      ],
      [
        "js ts",
        'import a from "m" with { type: "json", type: "json" }; const c;',
        [
          " | Identifier `type` has already been declared |  | 25+4 `type` has already been declared here | 39+4 It can not be redeclared here",
          " | Missing initializer in const declaration | Add an initializer (e.g. ` = undefined`) here | 61+1",
        ],
      ],
      [
        "js ts",
        'import a from "m" with { type: "json", type: "json" }; let d; let d;',
        [
          " | Identifier `type` has already been declared |  | 25+4 `type` has already been declared here | 39+4 It can not be redeclared here",
        ],
      ],
      [
        "js ts",
        'import a from "m" with { type: "json", "type": "json" };',
        [
          " | Identifier `type` has already been declared |  | 25+4 `type` has already been declared here | 39+6 It can not be redeclared here",
        ],
      ],
      [
        "js ts",
        'import a from "m" with { "type": "json", type: "json" };',
        [
          " | Identifier `type` has already been declared |  | 25+6 `type` has already been declared here | 41+4 It can not be redeclared here",
        ],
      ],
      [
        "js ts",
        'import a from "m" with { a: "1", a: "2", a: "3" };',
        [
          " | Identifier `a` has already been declared |  | 25+1 `a` has already been declared here | 33+1 It can not be redeclared here",
          " | Identifier `a` has already been declared |  | 33+1 `a` has already been declared here | 41+1 It can not be redeclared here",
        ],
      ],
      [
        "js ts",
        'import a from "m" with { a: "1", a: 2 };',
        [" | Only string literals are allowed as module attribute values. | Wrap this with quotes | 36+1"],
      ],
      [
        "js ts",
        'import a from "m" with { a: 1, a: "2" };',
        [" | Only string literals are allowed as module attribute values. | Wrap this with quotes | 28+1"],
      ],
      [
        "js ts",
        'export * from "m" with { a: "1", a: "2" };',
        [
          " | Identifier `a` has already been declared |  | 25+1 `a` has already been declared here | 33+1 It can not be redeclared here",
        ],
      ],
      [
        "js ts",
        'import a from "m" with { a: "1" + "2" };',
        [" | Expected `,` or `}` but found `+` |  | 32+1 `,` or `}` expected | 23+1 Opened here"],
      ],
      [
        "js ts",
        'import a from "m" with { a: "1" } with { b: "2" };',
        [
          " | Expected a semicolon or an implicit semicolon after a statement, but found none | Try inserting a semicolon here | 33+0",
        ],
      ],
      ["js ts", "import a from \"m\" with { a: 'x' };", []],
    ],
  ],
  [
    "class members called constructor and prototype",
    undefined,
    [
      ["js ts", "class A { static accessor constructor = 1 }", []],
      [
        "js ts",
        "class A { accessor constructor = 1 }",
        [
          "TS(1275) | 'accessor' modifier can only appear on a property declaration. |  | 10+8",
          " | Expected `(` but found `=` |  | 31+1 `(` expected",
        ],
      ],
      [
        "js ts",
        "class A { accessor constructor }",
        [
          "TS(1275) | 'accessor' modifier can only appear on a property declaration. |  | 10+8",
          " | Expected `(` but found `}` |  | 31+1 `(` expected",
        ],
      ],
      [
        "ts",
        "class A { static declare constructor: Function }",
        [" | Classes can't have a field named 'constructor' |  | 25+11"],
      ],
      [
        "ts",
        "class A { declare constructor: Function }",
        [
          "TS(1031) | 'declare' modifier cannot appear on a constructor declaration. |  | 10+7",
          " | Expected `(` but found `:` |  | 29+1 `(` expected",
        ],
      ],
      [
        "ts",
        "class A { declare static constructor: Function }",
        [" | Classes can't have a field named 'constructor' |  | 25+11"],
      ],
      [
        "ts",
        "class A { declare 'constructor': Function }",
        [" | Classes can't have a field named 'constructor' |  | 18+13"],
      ],
      ["ts", "declare class A { constructor: Function }", [" | Expected `(` but found `:` |  | 29+1 `(` expected"]],
      [
        "ts",
        "declare class A { static constructor: Function }",
        [" | Classes can't have a field named 'constructor' |  | 25+11"],
      ],
      ["ts", "class A { declare static prototype: Function }", []],
      [
        "ts",
        "class A { declare #constructor: Function }",
        [" | Classes can't have an element named '#constructor' |  | 18+12"],
      ],
      ["js ts", "class A { static accessor prototype = 1 }", []],
      [
        "js ts",
        "class A { accessor #constructor = 1 }",
        [" | Classes can't have an element named '#constructor' |  | 19+12"],
      ],
      [
        "ts",
        "abstract class A { abstract constructor: Function }",
        [" | Expected `(` but found `:` |  | 39+1 `(` expected"],
      ],
    ],
  ],
  [
    "a reserved word where a name is wanted",
    undefined,
    [
      ["js ts", "var enum;", [" | Identifier expected. 'enum' is a reserved word that cannot be used here. |  | 4+4"]],
      [
        "js ts",
        "let\nfunction f() {}",
        [" | Identifier expected. 'function' is a reserved word that cannot be used here. |  | 4+8"],
      ],
      [
        "js ts",
        "let\nif (x) y;",
        [" | Identifier expected. 'if' is a reserved word that cannot be used here. |  | 4+2"],
      ],
      [
        "js ts",
        "let\nclass A {}",
        [" | Identifier expected. 'class' is a reserved word that cannot be used here. |  | 4+5"],
      ],
      ["js ts", "let\nvar x;", [" | Identifier expected. 'var' is a reserved word that cannot be used here. |  | 4+3"]],
      [
        "js ts",
        "let\nthis.x;",
        [" | Identifier expected. 'this' is a reserved word that cannot be used here. |  | 4+4"],
      ],
      ["js ts", "let\nnull;", [" | Identifier expected. 'null' is a reserved word that cannot be used here. |  | 4+4"]],
      [
        "js ts",
        "const class = 1;",
        [" | Identifier expected. 'class' is a reserved word that cannot be used here. |  | 6+5"],
      ],
      ["js ts", "var if = 1;", [" | Identifier expected. 'if' is a reserved word that cannot be used here. |  | 4+2"]],
      [
        "js ts",
        "let a, enum;",
        [" | Identifier expected. 'enum' is a reserved word that cannot be used here. |  | 7+4"],
      ],
      ["js ts", "let a, if;", [" | Identifier expected. 'if' is a reserved word that cannot be used here. |  | 7+2"]],
      [
        "js ts",
        "function f() { let\nreturn; }",
        [" | Identifier expected. 'return' is a reserved word that cannot be used here. |  | 19+6"],
      ],
      [
        "js ts",
        "var function;",
        [" | Identifier expected. 'function' is a reserved word that cannot be used here. |  | 4+8"],
      ],
      ["js ts", "using\nnew X;", []],
      [
        "js ts",
        "let\nimport('a');",
        [" | Identifier expected. 'import' is a reserved word that cannot be used here. |  | 4+6"],
      ],
      [
        "js ts",
        "let [enum] = a;",
        [" | Identifier expected. 'enum' is a reserved word that cannot be used here. |  | 5+4"],
      ],
      ["js ts", "let {enum} = a;", [" | Expected `:` but found `}` |  | 9+1 `:` expected"]],
      ["js ts", "function enum() {}", [" | Expected `Identifier` but found `enum` |  | 9+4 `Identifier` expected"]],
      [
        "js ts",
        "function f(enum) {}",
        [" | Identifier expected. 'enum' is a reserved word that cannot be used here. |  | 11+4"],
      ],
      ["js ts", "class enum {}", [" | Expected `{` but found `enum` |  | 6+4 `{` expected"]],
      [
        "js ts",
        "let a,\nfunction f() {}",
        [" | Identifier expected. 'function' is a reserved word that cannot be used here. |  | 7+8"],
      ],
      [
        "js ts",
        "let a,\nif (x) y;",
        [" | Identifier expected. 'if' is a reserved word that cannot be used here. |  | 7+2"],
      ],
      [
        "js ts",
        "const a = 1,\nclass B {}",
        [" | Identifier expected. 'class' is a reserved word that cannot be used here. |  | 13+5"],
      ],
      [
        "js ts",
        "const\nclass A {}",
        [" | Identifier expected. 'class' is a reserved word that cannot be used here. |  | 6+5"],
      ],
      [
        "js ts",
        "var\nfunction f() {}",
        [" | Identifier expected. 'function' is a reserved word that cannot be used here. |  | 4+8"],
      ],
      ["js ts", "let a, ;", [" | Unexpected token |  | 7+1"]],
      ["js ts", "let a,\n1;", [" | Unexpected token |  | 7+1"]],
      ["js ts", "const\n1;", [" | Unexpected token |  | 6+1"]],
      ["js ts", "var\n;", [" | Unexpected token |  | 4+1"]],
      ["js ts", "using\nfunction f() {}", []],
      ["js ts", "function* enum() {}", [" | Expected `Identifier` but found `enum` |  | 10+4 `Identifier` expected"]],
      [
        "js ts",
        "async function enum() {}",
        [" | Expected `Identifier` but found `enum` |  | 15+4 `Identifier` expected"],
      ],
      [
        "js ts",
        "export function enum() {}",
        [" | Expected `Identifier` but found `enum` |  | 16+4 `Identifier` expected"],
      ],
      ["js ts", "function if() {}", [" | Expected `Identifier` but found `if` |  | 9+2 `Identifier` expected"]],
      ["js ts", "x = function enum() {};", [" | Expected `(` but found `enum` |  | 13+4 `(` expected"]],
      ["js ts", "export default function enum() {}", [" | Expected `(` but found `enum` |  | 24+4 `(` expected"]],
      ["js ts", "x = a * enum;", [" | Unexpected token |  | 8+4"]],
    ],
  ],
  [
    "a class without a name",
    undefined,
    [
      ["js ts", "class {}", [" | A class name is required. |  | 0+5"]],
      ["js ts", "class extends A {}", [" | A class name is required. |  | 0+5"]],
      ["js ts", "{ class {} }", [" | A class name is required. |  | 2+5"]],
      ["js ts", "export class {}", [" | A class name is required. |  | 7+5"]],
      ["js ts", "export default class {}", []],
      [
        "js ts",
        "let zz; let zz; class {}",
        [
          " | Identifier `zz` has already been declared |  | 4+2 `zz` has already been declared here | 12+2 It can not be redeclared here",
          " | A class name is required. |  | 16+5",
        ],
      ],
      ["js ts", "class {} let a = ;", [" | Unexpected token |  | 17+1"]],
      [
        "js ts",
        "if (a) class {}",
        [" | Invalid class declaration | Classes can only be declared at top level or inside a block | 7+6"],
      ],
      ["ts", "namespace N { export class {} }", [" | A class name is required. |  | 21+5"]],
      ["ts", "abstract class {}", [" | A class name is required. |  | 0+5"]],
      ["ts", "declare class {}", [" | A class name is required. |  | 0+5"]],
    ],
  ],
  [
    "findings are printed in the order in which oxlint runs its rules",
    {
      "categories": { "correctness": "off" },
      "plugins": ["jest"],
      "rules": {
        "no-undef": "error",
        "no-unused-vars": "error",
        "no-debugger": "error",
        "no-redeclare": "error",
        "no-var": "error",
        "no-unused-labels": "error",
        "jest/no-disabled-tests": "error",
      },
    },
    [
      [
        "js ts",
        "debugger; x;",
        [
          "eslint(no-undef) | 'x' is not defined. | Either define 'x' or remove the reference to it. If 'x' is a global variable, add it to the 'globals' configuration. | 10+1",
          "eslint(no-debugger) | `debugger` statement is not allowed | Remove the debugger statement | 0+9",
        ],
      ],
      [
        "js ts",
        "const u = 1; debugger; x; debugger; y;",
        [
          "eslint(no-undef) | 'x' is not defined. | Either define 'x' or remove the reference to it. If 'x' is a global variable, add it to the 'globals' configuration. | 23+1",
          "eslint(no-undef) | 'y' is not defined. | Either define 'y' or remove the reference to it. If 'y' is a global variable, add it to the 'globals' configuration. | 36+1",
          "eslint(no-unused-vars) | Variable 'u' is declared but never used. Unused variables should start with a '_'. | Consider removing this declaration. | 6+1 'u' is declared here",
          "eslint(no-debugger) | `debugger` statement is not allowed | Remove the debugger statement | 13+9",
          "eslint(no-debugger) | `debugger` statement is not allowed | Remove the debugger statement | 26+9",
        ],
      ],
      [
        "js",
        "debugger; x0;\ndebugger; x1;\ndebugger; x2;\ndebugger; x3;\ndebugger; x4;\ndebugger; x5;",
        [
          "eslint(no-undef) | 'x2' is not defined. | Either define 'x2' or remove the reference to it. If 'x2' is a global variable, add it to the 'globals' configuration. | 38+2",
          "eslint(no-undef) | 'x5' is not defined. | Either define 'x5' or remove the reference to it. If 'x5' is a global variable, add it to the 'globals' configuration. | 80+2",
          "eslint(no-undef) | 'x4' is not defined. | Either define 'x4' or remove the reference to it. If 'x4' is a global variable, add it to the 'globals' configuration. | 66+2",
          "eslint(no-undef) | 'x3' is not defined. | Either define 'x3' or remove the reference to it. If 'x3' is a global variable, add it to the 'globals' configuration. | 52+2",
          "eslint(no-undef) | 'x1' is not defined. | Either define 'x1' or remove the reference to it. If 'x1' is a global variable, add it to the 'globals' configuration. | 24+2",
          "eslint(no-undef) | 'x0' is not defined. | Either define 'x0' or remove the reference to it. If 'x0' is a global variable, add it to the 'globals' configuration. | 10+2",
          "eslint(no-debugger) | `debugger` statement is not allowed | Remove the debugger statement | 0+9",
          "eslint(no-debugger) | `debugger` statement is not allowed | Remove the debugger statement | 14+9",
          "eslint(no-debugger) | `debugger` statement is not allowed | Remove the debugger statement | 28+9",
          "eslint(no-debugger) | `debugger` statement is not allowed | Remove the debugger statement | 42+9",
          "eslint(no-debugger) | `debugger` statement is not allowed | Remove the debugger statement | 56+9",
          "eslint(no-debugger) | `debugger` statement is not allowed | Remove the debugger statement | 70+9",
        ],
      ],
      [
        "js",
        "var a; var a; debugger; z;",
        [
          "eslint(no-redeclare) | 'a' is already defined. | Use a different variable name or remove the duplicate declaration. | 4+1 'a' is already defined. | 11+1 It can not be redeclared here.",
          "eslint(no-undef) | 'z' is not defined. | Either define 'z' or remove the reference to it. If 'z' is a global variable, add it to the 'globals' configuration. | 24+1",
          "eslint(no-unused-vars) | Variable 'a' is declared but never used. Unused variables should start with a '_'. | Consider removing this declaration. | 4+1 'a' is declared here",
          "eslint(no-var) | Unexpected var, use let or const instead. | Replace var with let or const | 0+3",
          "eslint(no-var) | Unexpected var, use let or const instead. | Replace var with let or const | 7+3",
          "eslint(no-debugger) | `debugger` statement is not allowed | Remove the debugger statement | 14+9",
        ],
      ],
      [
        "js",
        "console.log(q1); debugger; Object(q2); q3;",
        [
          "eslint(no-undef) | 'q2' is not defined. | Either define 'q2' or remove the reference to it. If 'q2' is a global variable, add it to the 'globals' configuration. | 34+2",
          "eslint(no-undef) | 'console' is not defined. | Either define 'console' or remove the reference to it. If 'console' is a global variable, add it to the 'globals' configuration. | 0+7",
          "eslint(no-undef) | 'q3' is not defined. | Either define 'q3' or remove the reference to it. If 'q3' is a global variable, add it to the 'globals' configuration. | 39+2",
          "eslint(no-undef) | 'q1' is not defined. | Either define 'q1' or remove the reference to it. If 'q1' is a global variable, add it to the 'globals' configuration. | 12+2",
          "eslint(no-debugger) | `debugger` statement is not allowed | Remove the debugger statement | 17+9",
        ],
      ],
      [
        "js",
        "function f() { return arguments[0] + w1; }\nf(); w2; debugger;",
        [
          "eslint(no-undef) | 'w2' is not defined. | Either define 'w2' or remove the reference to it. If 'w2' is a global variable, add it to the 'globals' configuration. | 48+2",
          "eslint(no-undef) | 'w1' is not defined. | Either define 'w1' or remove the reference to it. If 'w1' is a global variable, add it to the 'globals' configuration. | 37+2",
          "eslint(no-debugger) | `debugger` statement is not allowed | Remove the debugger statement | 52+9",
        ],
      ],
      [
        "js",
        "k1; k2; k1; debugger; k2;",
        [
          "eslint(no-undef) | 'k2' is not defined. | Either define 'k2' or remove the reference to it. If 'k2' is a global variable, add it to the 'globals' configuration. | 4+2",
          "eslint(no-undef) | 'k2' is not defined. | Either define 'k2' or remove the reference to it. If 'k2' is a global variable, add it to the 'globals' configuration. | 22+2",
          "eslint(no-undef) | 'k1' is not defined. | Either define 'k1' or remove the reference to it. If 'k1' is a global variable, add it to the 'globals' configuration. | 0+2",
          "eslint(no-undef) | 'k1' is not defined. | Either define 'k1' or remove the reference to it. If 'k1' is a global variable, add it to the 'globals' configuration. | 8+2",
          "eslint(no-debugger) | `debugger` statement is not allowed | Remove the debugger statement | 12+9",
        ],
      ],
      [
        "js",
        "alpha; beta; gamma; delta; epsilon; zeta; eta; theta; iota; kappa;",
        [
          "eslint(no-undef) | 'alpha' is not defined. | Either define 'alpha' or remove the reference to it. If 'alpha' is a global variable, add it to the 'globals' configuration. | 0+5",
          "eslint(no-undef) | 'epsilon' is not defined. | Either define 'epsilon' or remove the reference to it. If 'epsilon' is a global variable, add it to the 'globals' configuration. | 27+7",
          "eslint(no-undef) | 'gamma' is not defined. | Either define 'gamma' or remove the reference to it. If 'gamma' is a global variable, add it to the 'globals' configuration. | 13+5",
          "eslint(no-undef) | 'theta' is not defined. | Either define 'theta' or remove the reference to it. If 'theta' is a global variable, add it to the 'globals' configuration. | 47+5",
          "eslint(no-undef) | 'iota' is not defined. | Either define 'iota' or remove the reference to it. If 'iota' is a global variable, add it to the 'globals' configuration. | 54+4",
          "eslint(no-undef) | 'kappa' is not defined. | Either define 'kappa' or remove the reference to it. If 'kappa' is a global variable, add it to the 'globals' configuration. | 60+5",
          "eslint(no-undef) | 'delta' is not defined. | Either define 'delta' or remove the reference to it. If 'delta' is a global variable, add it to the 'globals' configuration. | 20+5",
          "eslint(no-undef) | 'beta' is not defined. | Either define 'beta' or remove the reference to it. If 'beta' is a global variable, add it to the 'globals' configuration. | 7+4",
          "eslint(no-undef) | 'eta' is not defined. | Either define 'eta' or remove the reference to it. If 'eta' is a global variable, add it to the 'globals' configuration. | 42+3",
          "eslint(no-undef) | 'zeta' is not defined. | Either define 'zeta' or remove the reference to it. If 'zeta' is a global variable, add it to the 'globals' configuration. | 36+4",
        ],
      ],
      [
        "test.js",
        'test.skip("a", () => {}); debugger; x;',
        [
          "eslint(no-undef) | 'test' is not defined. | Either define 'test' or remove the reference to it. If 'test' is a global variable, add it to the 'globals' configuration. | 0+4",
          "eslint(no-undef) | 'x' is not defined. | Either define 'x' or remove the reference to it. If 'x' is a global variable, add it to the 'globals' configuration. | 36+1",
          "eslint(no-debugger) | `debugger` statement is not allowed | Remove the debugger statement | 26+9",
          "jest(no-disabled-tests) | Disabled test | Remove the appending `.skip` | 0+9",
        ],
      ],
      [
        "test.js",
        'debugger; test.skip("a", () => { debugger; }); describe.skip("b", () => {}); y;',
        [
          "eslint(no-undef) | 'test' is not defined. | Either define 'test' or remove the reference to it. If 'test' is a global variable, add it to the 'globals' configuration. | 10+4",
          "eslint(no-undef) | 'describe' is not defined. | Either define 'describe' or remove the reference to it. If 'describe' is a global variable, add it to the 'globals' configuration. | 47+8",
          "eslint(no-undef) | 'y' is not defined. | Either define 'y' or remove the reference to it. If 'y' is a global variable, add it to the 'globals' configuration. | 77+1",
          "eslint(no-debugger) | `debugger` statement is not allowed | Remove the debugger statement | 0+9",
          "eslint(no-debugger) | `debugger` statement is not allowed | Remove the debugger statement | 33+9",
          "jest(no-disabled-tests) | Disabled test | Remove the appending `.skip` | 10+9",
          "jest(no-disabled-tests) | Disabled test suite | Remove the appending `.skip` | 47+13",
        ],
      ],
      [
        "js",
        "label: for (;;) { debugger; }\nconst v = 1;\nx;",
        [
          "eslint(no-undef) | 'x' is not defined. | Either define 'x' or remove the reference to it. If 'x' is a global variable, add it to the 'globals' configuration. | 43+1",
          "eslint(no-unused-labels) | 'label:' is defined but never used. | Replace `label: for (;;) { debugger; }` with `for (;;) { debugger; }`. | 0+5",
          "eslint(no-unused-vars) | Variable 'v' is declared but never used. Unused variables should start with a '_'. | Consider removing this declaration. | 36+1 'v' is declared here",
          "eslint(no-debugger) | `debugger` statement is not allowed | Remove the debugger statement | 18+9",
        ],
      ],
      [
        "ts",
        "let a: Foo; debugger; x; let b: Bar = y;",
        [
          "eslint(no-undef) | 'y' is not defined. | Either define 'y' or remove the reference to it. If 'y' is a global variable, add it to the 'globals' configuration. | 38+1",
          "eslint(no-undef) | 'x' is not defined. | Either define 'x' or remove the reference to it. If 'x' is a global variable, add it to the 'globals' configuration. | 22+1",
          "eslint(no-unused-vars) | Variable 'a' is declared but never used. Unused variables should start with a '_'. | Consider removing this declaration. | 4+1 'a' is declared here",
          "eslint(no-unused-vars) | Variable 'b' is declared but never used. Unused variables should start with a '_'. | Consider removing this declaration. | 29+1 'b' is declared here",
          "eslint(no-debugger) | `debugger` statement is not allowed | Remove the debugger statement | 12+9",
        ],
      ],
      [
        "jsx",
        "debugger; <Foo bar={baz} />;",
        [
          "eslint(no-undef) | 'Foo' is not defined. | Either define 'Foo' or remove the reference to it. If 'Foo' is a global variable, add it to the 'globals' configuration. | 11+3",
          "eslint(no-undef) | 'baz' is not defined. | Either define 'baz' or remove the reference to it. If 'baz' is a global variable, add it to the 'globals' configuration. | 20+3",
          "eslint(no-debugger) | `debugger` statement is not allowed | Remove the debugger statement | 0+9",
        ],
      ],
      [
        "js",
        'typeof t1; t2; debugger; typeof t3 === "a" && t3;',
        [
          "eslint(no-undef) | 't2' is not defined. | Either define 't2' or remove the reference to it. If 't2' is a global variable, add it to the 'globals' configuration. | 11+2",
          "eslint(no-undef) | 't3' is not defined. | Either define 't3' or remove the reference to it. If 't3' is a global variable, add it to the 'globals' configuration. | 46+2",
          "eslint(no-debugger) | `debugger` statement is not allowed | Remove the debugger statement | 15+9",
        ],
      ],
    ],
  ],
  [
    "a rule that is called with a node reports when oxlint comes to the node",
    {
      "categories": { "correctness": "off" },
      "plugins": ["typescript", "unicorn", "jest", "react"],
      "rules": {
        "eqeqeq": "error",
        "curly": "error",
        "no-magic-numbers": "error",
        "no-param-reassign": "error",
        "func-style": "error",
        "max-params": ["error", { "max": 0 }],
        "id-length": "error",
        "block-scoped-var": "error",
        "no-var": "error",
        "vars-on-top": "error",
        "no-multi-assign": "error",
        "no-ternary": "error",
        "no-plusplus": "error",
        "init-declarations": "error",
        "no-undefined": "error",
        "typescript/explicit-function-return-type": "error",
        "typescript/explicit-member-accessibility": "error",
        "typescript/explicit-module-boundary-types": "error",
        "unicorn/no-useless-undefined": "error",
        "unicorn/catch-error-name": "error",
        "unicorn/no-null": "error",
        "jest/require-hook": "error",
        "no-implicit-coercion": "error",
        "prefer-template": "error",
        "no-else-return": "error",
        "class-methods-use-this": "error",
      },
    },
    [
      [
        "js",
        "function f(a, b) {\n  if (a == 0) return 1;\n  a = b;\n  return -2;\n}\nf();",
        [
          "jest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 67+3",
          "eslint(func-style) | Expected a function expression. | Enforce the consistent use of either `function` declarations or expressions assigned to variables | 0+66",
          "eslint(max-params) | Function 'f' has too many parameters (2). Maximum allowed is 0. | This rule enforces a maximum number of parameters allowed in function definitions. | 10+6",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 9+1",
          "eslint(no-param-reassign) | Assignment to function parameter 'a'. | Consider using a different variable to avoid unintended side effects on the parameter. | 45+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 11+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 14+1",
          "eslint(curly) | Expected { after 'if' condition. | Replace `return 1;` with `{return 1;}`. | 33+9",
          "eslint(eqeqeq) | Expected === and instead saw == | Prefer === operator | 27+2",
          "eslint(no-magic-numbers) | No magic number: 0 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 30+1",
          "eslint(no-magic-numbers) | No magic number: 1 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 40+1",
          "eslint(no-magic-numbers) | No magic number: -2 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 61+2",
        ],
      ],
      [
        "js",
        "if (x === 1) y(); else if (x === 2) z(); else w(3);",
        [
          "eslint(curly) | Expected { after 'if' condition. | Replace `y();` with `{y();}`. | 13+4",
          "eslint(curly) | Expected { after 'if' condition. | Replace `z();` with `{z();}`. | 36+4",
          "eslint(curly) | Expected { after 'else'. | Replace `w(3);` with `{w(3);}`. | 46+5",
          "eslint(no-magic-numbers) | No magic number: 1 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 10+1",
          "eslint(no-magic-numbers) | No magic number: 2 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 33+1",
          "eslint(no-magic-numbers) | No magic number: 3 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 48+1",
        ],
      ],
      [
        "js",
        "class A {\n  get b() { return 1; }\n  c(d) { d = 2; }\n}\nnew A();",
        [
          "eslint(id-length) | Identifier name is too short (< 2). |  | 6+1",
          "eslint(class-methods-use-this) | Expected method `b` to have this. | Consider converting method `b` to a static method. | 16+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 16+1",
          "eslint(no-magic-numbers) | No magic number: 1 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 29+1",
          "eslint(class-methods-use-this) | Expected method `c` to have this. | Consider converting method `c` to a static method. | 36+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 36+1",
          "eslint(max-params) | Function has too many parameters (1). Maximum allowed is 0. | This rule enforces a maximum number of parameters allowed in function definitions. | 37+3",
          "eslint(no-param-reassign) | Assignment to function parameter 'd'. | Consider using a different variable to avoid unintended side effects on the parameter. | 43+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 38+1",
          "eslint(no-magic-numbers) | No magic number: 2 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 47+1",
        ],
      ],
      [
        "ts",
        "class A {\n  get b() { return 1; }\n  c(d: number) { d = 2; }\n}\nnew A();",
        [
          "eslint(id-length) | Identifier name is too short (< 2). |  | 6+1",
          "eslint(class-methods-use-this) | Expected method `b` to have this. | Consider converting method `b` to a static method. | 16+1",
          "typescript(explicit-member-accessibility) | Missing accessibility modifier on get property accessor b. | Add an explicit 'public', 'private', or 'protected' modifier. Members without a modifier are implicitly public, which may not be intentional. | 16+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 16+1",
          "typescript(explicit-function-return-type) | Missing return type on function. | Require explicit return types on functions and class methods. | 12+5",
          "eslint(no-magic-numbers) | No magic number: 1 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 29+1",
          "eslint(class-methods-use-this) | Expected method `c` to have this. | Consider converting method `c` to a static method. | 36+1",
          "typescript(explicit-member-accessibility) | Missing accessibility modifier on method definition c. | Add an explicit 'public', 'private', or 'protected' modifier. Members without a modifier are implicitly public, which may not be intentional. | 36+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 36+1",
          "eslint(max-params) | Function has too many parameters (1). Maximum allowed is 0. | This rule enforces a maximum number of parameters allowed in function definitions. | 37+11",
          "typescript(explicit-function-return-type) | Missing return type on function. | Require explicit return types on functions and class methods. | 36+1",
          "eslint(no-param-reassign) | Assignment to function parameter 'd'. | Consider using a different variable to avoid unintended side effects on the parameter. | 51+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 38+1",
          "eslint(no-magic-numbers) | No magic number: 2 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 55+1",
        ],
      ],
      [
        "ts",
        "class A { m(a) { return a; } }\nfunction g(b) { return b; }\nexport default { g, A };",
        [
          "eslint(id-length) | Identifier name is too short (< 2). |  | 6+1",
          "eslint(class-methods-use-this) | Expected method `m` to have this. | Consider converting method `m` to a static method. | 10+1",
          "typescript(explicit-member-accessibility) | Missing accessibility modifier on method definition m. | Add an explicit 'public', 'private', or 'protected' modifier. Members without a modifier are implicitly public, which may not be intentional. | 10+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 10+1",
          "eslint(max-params) | Function has too many parameters (1). Maximum allowed is 0. | This rule enforces a maximum number of parameters allowed in function definitions. | 11+3",
          "typescript(explicit-function-return-type) | Missing return type on function. | Require explicit return types on functions and class methods. | 10+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 12+1",
          "eslint(func-style) | Expected a function expression. | Enforce the consistent use of either `function` declarations or expressions assigned to variables | 31+27",
          "eslint(max-params) | Function 'g' has too many parameters (1). Maximum allowed is 0. | This rule enforces a maximum number of parameters allowed in function definitions. | 41+3",
          "typescript(explicit-function-return-type) | Missing return type on function. | Require explicit return types on functions and class methods. | 31+10",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 40+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 42+1",
          "typescript(explicit-module-boundary-types) | Missing argument type on function | Define an explicit argument type for each argument. | 42+1",
          "typescript(explicit-module-boundary-types) | Missing return type on function | Define an explicit return type for the function. | 40+1",
          "typescript(explicit-module-boundary-types) | Missing argument type on function | Define an explicit argument type for each argument. | 12+1",
          "typescript(explicit-module-boundary-types) | Missing return type on function | Define an explicit return type for the function. | 10+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 76+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 79+1",
        ],
      ],
      [
        "ts",
        "export function f(a) { return a; }\nexport const g = (b) => b;",
        [
          "typescript(explicit-module-boundary-types) | Missing argument type on function | Define an explicit argument type for each argument. | 18+1",
          "typescript(explicit-module-boundary-types) | Missing return type on function | Define an explicit return type for the function. | 16+1",
          "eslint(func-style) | Expected a function expression. | Enforce the consistent use of either `function` declarations or expressions assigned to variables | 7+27",
          "eslint(max-params) | Function 'f' has too many parameters (1). Maximum allowed is 0. | This rule enforces a maximum number of parameters allowed in function definitions. | 17+3",
          "typescript(explicit-function-return-type) | Missing return type on function. | Require explicit return types on functions and class methods. | 7+10",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 16+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 18+1",
          "typescript(explicit-module-boundary-types) | Missing argument type on function | Define an explicit argument type for each argument. | 53+1",
          "typescript(explicit-module-boundary-types) | Missing return type on function | Define an explicit return type for the function. | 56+2",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 48+1",
          "eslint(max-params) | Arrow function has too many parameters (1). Maximum allowed is 0. | This rule enforces a maximum number of parameters allowed in function definitions. | 52+3",
          "typescript(explicit-function-return-type) | Missing return type on function. | Require explicit return types on functions and class methods. | 56+2",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 53+1",
        ],
      ],
      [
        "js",
        "function f() {\n  if (a) { var x = 1; }\n  const y = x + 2;\n  return x + y;\n}\nf();",
        [
          "jest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 76+3",
          "eslint(func-style) | Expected a function expression. | Enforce the consistent use of either `function` declarations or expressions assigned to variables | 0+75",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 9+1",
          "eslint(block-scoped-var) | 'x' is used outside of binding context. | Variable 'x' is used outside its declaration block. Declare it outside the block or use 'let'/'const'. | 51+1 'x' is used here | 30+1 It is declared in a different scope here",
          "eslint(block-scoped-var) | 'x' is used outside of binding context. | Variable 'x' is used outside its declaration block. Declare it outside the block or use 'let'/'const'. | 67+1 'x' is used here | 30+1 It is declared in a different scope here",
          "eslint(no-var) | Unexpected var, use let or const instead. | Replace var with let or const | 26+3",
          "eslint(vars-on-top) | All 'var' declarations must be at the top of the function scope. | Consider moving this to the top of the functions scope or using let or const to declare this variable. | 26+10",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 30+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 47+1",
          "eslint(no-magic-numbers) | No magic number: 2 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 55+1",
        ],
      ],
      [
        "js",
        "a = b = 1;\nconst c = d = 2;",
        [
          "eslint(no-multi-assign) | Do not use chained assignment | Separate each assignment into its own statement | 4+5",
          "eslint(no-magic-numbers) | No magic number: 1 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 8+1",
          "eslint(no-multi-assign) | Do not use chained assignment | Separate each assignment into its own statement | 21+5",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 17+1",
          "eslint(no-magic-numbers) | No magic number: 2 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 25+1",
        ],
      ],
      [
        "js",
        "foo(undefined);\nbar(1, undefined, undefined);",
        [
          "jest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 0+14",
          "jest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 16+28",
          "unicorn(no-useless-undefined) | Do not use useless `undefined`. | Consider removing `undefined` or using `null` instead. | 4+9",
          "eslint(no-undefined) | Unexpected use of `undefined` |  | 4+9",
          "unicorn(no-useless-undefined) | Do not use useless `undefined`. | Consider removing `undefined` or using `null` instead. | 23+9 | 34+9",
          "eslint(no-magic-numbers) | No magic number: 1 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 20+1",
          "eslint(no-undefined) | Unexpected use of `undefined` |  | 23+9",
          "eslint(no-undefined) | Unexpected use of `undefined` |  | 34+9",
        ],
      ],
      [
        "js",
        "try { f(); } catch (e) { g(e == 1); }",
        [
          'unicorn(catch-error-name) | The catch parameter "e" should be named "error" | Rename `e` to `error` | 20+1',
          "eslint(id-length) | Identifier name is too short (< 2). |  | 20+1",
          "eslint(eqeqeq) | Expected === and instead saw == | Prefer === operator | 29+2",
          "eslint(no-magic-numbers) | No magic number: 1 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 32+1",
        ],
      ],
      [
        "js",
        "const o = {\n  m(a) { return a == 1; },\n  n: function (b) { return b == 2; },\n  p: (c) => c == 3,\n};\no.m();",
        [
          "jest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 100+5",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 6+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 14+1",
          "eslint(max-params) | Function has too many parameters (1). Maximum allowed is 0. | This rule enforces a maximum number of parameters allowed in function definitions. | 15+3",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 16+1",
          "eslint(eqeqeq) | Expected === and instead saw == | Prefer === operator | 30+2",
          "eslint(no-magic-numbers) | No magic number: 1 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 33+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 41+1",
          "eslint(max-params) | Function has too many parameters (1). Maximum allowed is 0. | This rule enforces a maximum number of parameters allowed in function definitions. | 53+3",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 54+1",
          "eslint(eqeqeq) | Expected === and instead saw == | Prefer === operator | 68+2",
          "eslint(no-magic-numbers) | No magic number: 2 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 71+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 79+1",
          "eslint(max-params) | Arrow function has too many parameters (1). Maximum allowed is 0. | This rule enforces a maximum number of parameters allowed in function definitions. | 82+3",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 83+1",
          "eslint(eqeqeq) | Expected === and instead saw == | Prefer === operator | 91+2",
          "eslint(no-magic-numbers) | No magic number: 3 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 94+1",
        ],
      ],
      [
        "js",
        "x = `${a == 1}${b == 2}`;",
        [
          "eslint(eqeqeq) | Expected === and instead saw == | Prefer === operator | 9+2",
          "eslint(no-magic-numbers) | No magic number: 1 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 12+1",
          "eslint(eqeqeq) | Expected === and instead saw == | Prefer === operator | 18+2",
          "eslint(no-magic-numbers) | No magic number: 2 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 21+1",
        ],
      ],
      [
        "jsx",
        "const a = <b c={d == 1}>{e == 2}</b>;",
        [
          "eslint(id-length) | Identifier name is too short (< 2). |  | 6+1",
          "eslint(eqeqeq) | Expected === and instead saw == | Prefer === operator | 18+2",
          "eslint(no-magic-numbers) | No magic number: 1 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 21+1",
          "eslint(eqeqeq) | Expected === and instead saw == | Prefer === operator | 27+2",
          "eslint(no-magic-numbers) | No magic number: 2 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 30+1",
        ],
      ],
      [
        "js",
        "for (let i = 0; i < 10; i++) f(i == 5);",
        [
          "eslint(curly) | Expected { after 'for' condition. | Replace `f(i == 5);` with `{f(i == 5);}`. | 29+10",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 9+1",
          "eslint(no-magic-numbers) | No magic number: 10 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 20+2",
          "eslint(no-plusplus) | Unary operator '++' used. | Use the assignment operator `+=` instead. | 24+3",
          "eslint(eqeqeq) | Expected === and instead saw == | Prefer === operator | 33+2",
          "eslint(no-magic-numbers) | No magic number: 5 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 36+1",
        ],
      ],
      [
        "js",
        "export default function () { return a == 1 ? 2 : 3; }",
        [
          "eslint(no-ternary) | Unexpected use of ternary expression | Do not use the ternary expression. | 36+14",
          "eslint(eqeqeq) | Expected === and instead saw == | Prefer === operator | 38+2",
          "eslint(no-magic-numbers) | No magic number: 1 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 41+1",
          "eslint(no-magic-numbers) | No magic number: 2 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 45+1",
          "eslint(no-magic-numbers) | No magic number: 3 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 49+1",
        ],
      ],
      [
        "test.js",
        'foo();\ndescribe("a", () => {\n  bar(1);\n  it("b", () => { baz(2); });\n});\nlet q = 3;',
        [
          "jest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 0+5",
          "jest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 73+10",
          "jest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 31+6",
          "eslint(no-magic-numbers) | No magic number: 1 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 35+1",
          "eslint(no-magic-numbers) | No magic number: 2 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 61+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 77+1",
        ],
      ],
    ],
  ],
  [
    "several rules about one number report by their numbers, whatever part of it they mark",
    {
      "categories": { "correctness": "off" },
      "plugins": ["unicorn"],
      "rules": {
        "unicorn/numeric-separators-style": "error",
        "unicorn/number-literal-case": "error",
        "no-magic-numbers": "error",
        "unicorn/prefer-number-properties": "error",
      },
    },
    [
      [
        "js",
        "a = 0xabcdef12;",
        [
          "eslint(no-magic-numbers) | No magic number: 0xabcdef12 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 4+10",
          "unicorn(number-literal-case) | Unexpected hexadecimal digits in lowercase. | Use uppercase for hexadecimal digits. | 6+8",
          "unicorn(numeric-separators-style) | Invalid group length in numeric value. | Group digits with numeric separators (_) so longer numbers are easier to read. | 4+10",
        ],
      ],
      [
        "js",
        "a = 0Xabcdef12;",
        [
          "eslint(no-magic-numbers) | No magic number: 0Xabcdef12 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 4+10",
          "unicorn(number-literal-case) | Unexpected number literal prefix in uppercase and hexadecimal digits in lowercase. | Use lowercase for the number literal prefix `0x` and uppercase for hexadecimal digits. | 4+10",
          "unicorn(numeric-separators-style) | Invalid group length in numeric value. | Group digits with numeric separators (_) so longer numbers are easier to read. | 4+10",
        ],
      ],
      [
        "js",
        "a = 1E10 + 0xabcdef12;",
        [
          "eslint(no-magic-numbers) | No magic number: 1E10 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 4+4",
          "unicorn(number-literal-case) | Unexpected exponential notation in uppercase. | Use lowercase for `e` in exponential notations. | 5+1",
          "eslint(no-magic-numbers) | No magic number: 0xabcdef12 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 11+10",
          "unicorn(number-literal-case) | Unexpected hexadecimal digits in lowercase. | Use uppercase for hexadecimal digits. | 13+8",
          "unicorn(numeric-separators-style) | Invalid group length in numeric value. | Group digits with numeric separators (_) so longer numbers are easier to read. | 11+10",
        ],
      ],
      [
        "js",
        "a = 0xabcdef12n;",
        [
          "eslint(no-magic-numbers) | No magic number: 0xabcdef12n | Use a named constant instead of a magic number to make the code more readable and maintainable. | 4+11",
          "unicorn(number-literal-case) | Unexpected hexadecimal digits in lowercase. | Use uppercase for hexadecimal digits. | 6+9",
          "unicorn(numeric-separators-style) | Invalid group length in numeric value. | Group digits with numeric separators (_) so longer numbers are easier to read. | 4+11",
        ],
      ],
      [
        "js",
        "f(0xabcdef12, 0B1010101010);",
        [
          "eslint(no-magic-numbers) | No magic number: 0xabcdef12 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 2+10",
          "unicorn(number-literal-case) | Unexpected hexadecimal digits in lowercase. | Use uppercase for hexadecimal digits. | 4+8",
          "unicorn(numeric-separators-style) | Invalid group length in numeric value. | Group digits with numeric separators (_) so longer numbers are easier to read. | 2+10",
          "eslint(no-magic-numbers) | No magic number: 0B1010101010 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 14+12",
          "unicorn(number-literal-case) | Unexpected number literal prefix in uppercase. | Use lowercase for the number literal prefix `0b`. | 15+1",
          "unicorn(numeric-separators-style) | Invalid group length in numeric value. | Group digits with numeric separators (_) so longer numbers are easier to read. | 14+12",
        ],
      ],
    ],
  ],
  [
    "a rule that is called with a body or an opening tag reports after those that are called with the function or the element",
    {
      "categories": { "correctness": "off" },
      "plugins": ["oxc", "react", "jsx-a11y", "typescript", "unicorn"],
      "rules": {
        "require-await": "error",
        "oxc/no-async-await": "error",
        "no-empty-function": "error",
        "func-style": "error",
        "max-params": ["error", { "max": 0 }],
        "jsx-a11y/alt-text": "error",
        "jsx-a11y/html-has-lang": "error",
        "react/jsx-no-target-blank": "error",
        "react/react-in-jsx-scope": "error",
        "react/jsx-no-literals": "error",
        "react/forbid-elements": ["error", { "forbid": ["img", "h1"] }],
        "typescript/no-duplicate-enum-values": "error",
        "typescript/prefer-enum-initializers": "error",
        "grouped-accessor-pairs": "error",
        "class-methods-use-this": "error",
        "id-length": "error",
        "unicorn/empty-brace-spaces": "error",
      },
    },
    [
      [
        "js",
        "async function f() { g(); }\nf();",
        [
          "eslint(func-style) | Expected a function expression. | Enforce the consistent use of either `function` declarations or expressions assigned to variables | 0+27",
          "oxc(no-async-await) | async is not allowed | Remove the `async` keyword | 0+5",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 15+1",
          "eslint(require-await) | Async function has no `await` expression. | Consider removing the `async` keyword. | 15+1",
        ],
      ],
      [
        "js",
        "const f = async () => { g(); };\nf();",
        [
          "eslint(id-length) | Identifier name is too short (< 2). |  | 6+1",
          "oxc(no-async-await) | async is not allowed | Remove the `async` keyword | 10+5",
          "eslint(require-await) | Async function has no `await` expression. | Consider removing the `async` keyword. | 10+20",
        ],
      ],
      [
        "js",
        "class A { async m() { g(); } }\nnew A();",
        [
          "eslint(id-length) | Identifier name is too short (< 2). |  | 6+1",
          "eslint(class-methods-use-this) | Expected method `m` to have this. | Consider converting method `m` to a static method. | 16+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 16+1",
          "oxc(no-async-await) | async is not allowed | Remove the `async` keyword | 10+5",
          "eslint(require-await) | Async function has no `await` expression. | Consider removing the `async` keyword. | 16+1",
        ],
      ],
      [
        "js",
        "function f() {}\nf();",
        [
          "eslint(func-style) | Expected a function expression. | Enforce the consistent use of either `function` declarations or expressions assigned to variables | 0+15",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 9+1",
          "eslint(no-empty-function) | Unexpected empty function `f` | Consider removing this function or adding logic to it. | 13+2",
        ],
      ],
      [
        "jsx",
        'const a = <img src="b" />;',
        [
          "eslint(id-length) | Identifier name is too short (< 2). |  | 6+1",
          "react(forbid-elements) | <img> is forbidden. |  | 11+3",
          'react(react-in-jsx-scope) | `React` must be in scope when using JSX. | When using JSX, `<a />` expands to `React.createElement("a")`. Therefore the `React` variable must be in scope. | 11+3',
          "jsx-a11y(alt-text) | Missing `alt` attribute. | Must have `alt` prop, either with meaningful text, or an empty string for decorative images. | 10+15",
        ],
      ],
      [
        "jsx",
        'const a = <div><img src="b" /><a href="c" target="_blank">d</a></div>;',
        [
          "eslint(id-length) | Identifier name is too short (< 2). |  | 6+1",
          "react(jsx-no-literals) | Disallow literal text as JSX children | Wrap this text in a JSX expression container, such as a call to a translation function. | 58+1",
          'react(react-in-jsx-scope) | `React` must be in scope when using JSX. | When using JSX, `<a />` expands to `React.createElement("a")`. Therefore the `React` variable must be in scope. | 11+3',
          "react(forbid-elements) | <img> is forbidden. |  | 16+3",
          'react(react-in-jsx-scope) | `React` must be in scope when using JSX. | When using JSX, `<a />` expands to `React.createElement("a")`. Therefore the `React` variable must be in scope. | 16+3',
          "jsx-a11y(alt-text) | Missing `alt` attribute. | Must have `alt` prop, either with meaningful text, or an empty string for decorative images. | 15+15",
          'react(react-in-jsx-scope) | `React` must be in scope when using JSX. | When using JSX, `<a />` expands to `React.createElement("a")`. Therefore the `React` variable must be in scope. | 31+1',
        ],
      ],
      [
        "jsx",
        "const a = <html><body><h1>e</h1></body></html>;",
        [
          "eslint(id-length) | Identifier name is too short (< 2). |  | 6+1",
          "react(jsx-no-literals) | Disallow literal text as JSX children | Wrap this text in a JSX expression container, such as a call to a translation function. | 26+1",
          'react(react-in-jsx-scope) | `React` must be in scope when using JSX. | When using JSX, `<a />` expands to `React.createElement("a")`. Therefore the `React` variable must be in scope. | 11+4',
          "jsx-a11y(html-has-lang) | Missing lang attribute. | Add a `lang` attribute to the `html` element whose value represents the primary language of document. | 11+4",
          'react(react-in-jsx-scope) | `React` must be in scope when using JSX. | When using JSX, `<a />` expands to `React.createElement("a")`. Therefore the `React` variable must be in scope. | 17+4',
          "react(forbid-elements) | <h1> is forbidden. |  | 23+2",
          'react(react-in-jsx-scope) | `React` must be in scope when using JSX. | When using JSX, `<a />` expands to `React.createElement("a")`. Therefore the `React` variable must be in scope. | 23+2',
        ],
      ],
      [
        "ts",
        "enum E { A = 1, B = 1 }\nexport { E };",
        [
          "eslint(id-length) | Identifier name is too short (< 2). |  | 5+1",
          "typescript(no-duplicate-enum-values) | Duplicate enum value `1` | Give B a unique value | 13+1 1 is first used as an initializer here | 20+1 and is re-used here",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 9+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 16+1",
        ],
      ],
      [
        "js",
        "class A { get b() { return 1; } c() {} set b(d) {} }\nnew A();",
        [
          "eslint(id-length) | Identifier name is too short (< 2). |  | 6+1",
          "eslint(grouped-accessor-pairs) | Accessor pair getter 'b' and setter 'b' should be grouped. | Require grouped accessor pairs in object literals and classes | 10+5 getter 'b' is here | 39+5 setter 'b' is here",
          "eslint(class-methods-use-this) | Expected method `b` to have this. | Consider converting method `b` to a static method. | 14+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 14+1",
          "eslint(class-methods-use-this) | Expected method `c` to have this. | Consider converting method `c` to a static method. | 32+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 32+1",
          "eslint(no-empty-function) | Unexpected empty method `c` | Consider removing this method or adding logic to it. | 36+2",
          "eslint(class-methods-use-this) | Expected method `b` to have this. | Consider converting method `b` to a static method. | 43+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 43+1",
          "eslint(max-params) | Function has too many parameters (1). Maximum allowed is 0. | This rule enforces a maximum number of parameters allowed in function definitions. | 44+3",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 45+1",
          "eslint(no-empty-function) | Unexpected empty setter `b` | Consider removing this setter or adding logic to it. | 48+2",
        ],
      ],
    ],
  ],
  [
    "a rule reports when oxlint comes to the node that it calls the rule with, which is not always the one that is marked",
    {
      "categories": { "correctness": "off" },
      "plugins": ["oxc", "promise", "unicorn", "import", "node"],
      "rules": {
        "no-else-return": "error",
        "curly": "error",
        "new-cap": "error",
        "no-magic-numbers": "error",
        "promise/prefer-await-to-callbacks": "error",
        "promise/prefer-await-to-then": "error",
        "promise/catch-or-return": "error",
        "unicorn/catch-error-name": "error",
        "func-names": "error",
        "no-undefined": "error",
        "unicorn/consistent-assert": "error",
        "import/no-nodejs-modules": "error",
        "func-style": "error",
        "unicorn/prefer-number-properties": "error",
        "no-undef": "error",
        "block-scoped-var": "error",
        "no-var": "error",
        "vars-on-top": "error",
        "no-plusplus": "error",
        "require-await": "error",
        "oxc/no-async-await": "error",
        "grouped-accessor-pairs": "error",
        "id-length": "error",
        "class-methods-use-this": "error",
      },
    },
    [
      [
        "js",
        "function f(a) {\n  if (a === 1) return [g(1)];\n  else if (a === 2) return [g(2)];\n  else return [g(3)];\n}\nf(1);",
        [
          "eslint(no-undef) | 'g' is not defined. | Either define 'g' or remove the reference to it. If 'g' is a global variable, add it to the 'globals' configuration. | 39+1",
          "eslint(no-undef) | 'g' is not defined. | Either define 'g' or remove the reference to it. If 'g' is a global variable, add it to the 'globals' configuration. | 74+1",
          "eslint(no-undef) | 'g' is not defined. | Either define 'g' or remove the reference to it. If 'g' is a global variable, add it to the 'globals' configuration. | 96+1",
          "eslint(func-style) | Expected a function expression. | Enforce the consistent use of either `function` declarations or expressions assigned to variables | 0+104",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 9+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 11+1",
          "eslint(curly) | Expected { after 'if' condition. | Replace `return [g(1)];` with `{return [g(1)];}`. | 31+14",
          "eslint(curly) | Expected { after 'if' condition. | Replace `return [g(2)];` with `{return [g(2)];}`. | 66+14",
          "eslint(curly) | Expected { after 'else'. | Replace `return [g(3)];` with `{return [g(3)];}`. | 88+14",
          "eslint(no-else-return) | Unnecessary `else` after `return`. | Remove the `else` block, moving its contents outside of the `if` statement. | 66+14 This consequent block always returns, | 80+8 Making this `else` block unnecessary.",
          "eslint(no-magic-numbers) | No magic number: 1 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 28+1",
          "eslint(no-magic-numbers) | No magic number: 1 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 41+1",
          "eslint(no-magic-numbers) | No magic number: 2 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 63+1",
          "eslint(no-magic-numbers) | No magic number: 2 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 76+1",
          "eslint(no-magic-numbers) | No magic number: 3 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 98+1",
          "eslint(no-magic-numbers) | No magic number: 1 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 107+1",
        ],
      ],
      [
        "js",
        "function f(p) {\n  p.then(undefined, function (err) {\n    g(err);\n  });\n}\nf();",
        [
          "eslint(no-undef) | 'g' is not defined. | Either define 'g' or remove the reference to it. If 'g' is a global variable, add it to the 'globals' configuration. | 57+1",
          "eslint(func-style) | Expected a function expression. | Enforce the consistent use of either `function` declarations or expressions assigned to variables | 0+72",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 9+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 11+1",
          "promise(catch-or-return) | Expected `catch` or `return`. | Return the promise or chain a `catch()`. | 18+51",
          'unicorn(catch-error-name) | The catch parameter "err" should be named "error" | Rename `err` to `error` | 46+3',
          "promise(prefer-await-to-callbacks) | Prefer `async`/`await` to the callback pattern | Refactor to use an `async` function with `await` instead of passing callbacks for cleaner error handling and control flow. | 36+32",
          "promise(prefer-await-to-then) | Prefer await to then()/catch()/finally() | Use `await` with `try`/`catch` instead of promise chaining for more readable and maintainable async code. | 20+4",
          "eslint(no-undefined) | Unexpected use of `undefined` |  | 25+9",
          "eslint(func-names) | Unexpected unnamed function. | Consider giving this function expression a name. | 36+9",
        ],
      ],
      [
        "js",
        'import assert from "node:assert";\nimport path from "node:path";\nfunction f(a) {\n  assert(a);\n  return path.join(a);\n}\nf(1);',
        [
          "import(no-nodejs-modules) | Do not import Node.js builtin module `node:assert` | Use a browser-compatible alternative or add this module to the `allow` list if Node.js usage is intentional. | 0+33",
          "unicorn(consistent-assert) | Inconsistent assert usage. | Prefer `assert.ok(...)` over `assert(...)`. | 82+6",
          "import(no-nodejs-modules) | Do not import Node.js builtin module `node:path` | Use a browser-compatible alternative or add this module to the `allow` list if Node.js usage is intentional. | 34+29",
          "eslint(func-style) | Expected a function expression. | Enforce the consistent use of either `function` declarations or expressions assigned to variables | 64+53",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 73+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 75+1",
          "eslint(no-magic-numbers) | No magic number: 1 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 120+1",
        ],
      ],
      [
        "js",
        "function f(a) {\n  g(NaN);\n  g(parseInt(a));\n  g(window.NaN);\n  g(Infinity);\n  return isNaN(a);\n}\nf(1);",
        [
          "eslint(no-undef) | 'window' is not defined. | Either define 'window' or remove the reference to it. If 'window' is a global variable, add it to the 'globals' configuration. | 48+6",
          "eslint(no-undef) | 'g' is not defined. | Either define 'g' or remove the reference to it. If 'g' is a global variable, add it to the 'globals' configuration. | 18+1",
          "eslint(no-undef) | 'g' is not defined. | Either define 'g' or remove the reference to it. If 'g' is a global variable, add it to the 'globals' configuration. | 28+1",
          "eslint(no-undef) | 'g' is not defined. | Either define 'g' or remove the reference to it. If 'g' is a global variable, add it to the 'globals' configuration. | 46+1",
          "eslint(no-undef) | 'g' is not defined. | Either define 'g' or remove the reference to it. If 'g' is a global variable, add it to the 'globals' configuration. | 63+1",
          "unicorn(prefer-number-properties) | Use `Number.NaN` instead of the global `NaN` | Replace it with `Number.NaN` | 20+3",
          "eslint(func-style) | Expected a function expression. | Enforce the consistent use of either `function` declarations or expressions assigned to variables | 0+96",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 9+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 11+1",
          "unicorn(prefer-number-properties) | Use `Number.parseInt` instead of the global `parseInt` | Replace it with `Number.parseInt` | 30+8",
          "unicorn(prefer-number-properties) | Use `Number.NaN` instead of the global `NaN` | Replace it with `Number.NaN` | 48+10",
          "unicorn(prefer-number-properties) | Use `Number.isNaN` instead of the global `isNaN` | Replace it with `Number.isNaN` | 85+5",
          "eslint(no-magic-numbers) | No magic number: 1 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 99+1",
        ],
      ],
      [
        "js",
        "function f(a) {\n  for (var i = 0; i < a; i++) g(i);\n  for (var i = 0, n = a; i < n; i++) g(i, n);\n  return i + n;\n}\nf(1);",
        [
          "eslint(no-undef) | 'g' is not defined. | Either define 'g' or remove the reference to it. If 'g' is a global variable, add it to the 'globals' configuration. | 46+1",
          "eslint(no-undef) | 'g' is not defined. | Either define 'g' or remove the reference to it. If 'g' is a global variable, add it to the 'globals' configuration. | 89+1",
          "eslint(func-style) | Expected a function expression. | Enforce the consistent use of either `function` declarations or expressions assigned to variables | 0+115",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 9+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 11+1",
          "eslint(curly) | Expected { after 'for' condition. | Replace `g(i);` with `{g(i);}`. | 46+5",
          "eslint(block-scoped-var) | 'i' is used outside of binding context. | Variable 'i' is used outside its declaration block. Declare it outside the block or use 'let'/'const'. | 63+1 it is redeclared here | 27+1 'i' is first declared here",
          "eslint(block-scoped-var) | 'i' is used outside of binding context. | Variable 'i' is used outside its declaration block. Declare it outside the block or use 'let'/'const'. | 77+1 'i' is used here | 27+1 It is declared in a different scope here",
          "eslint(block-scoped-var) | 'i' is used outside of binding context. | Variable 'i' is used outside its declaration block. Declare it outside the block or use 'let'/'const'. | 84+1 'i' is used here | 27+1 It is declared in a different scope here",
          "eslint(block-scoped-var) | 'i' is used outside of binding context. | Variable 'i' is used outside its declaration block. Declare it outside the block or use 'let'/'const'. | 91+1 'i' is used here | 27+1 It is declared in a different scope here",
          "eslint(block-scoped-var) | 'i' is used outside of binding context. | Variable 'i' is used outside its declaration block. Declare it outside the block or use 'let'/'const'. | 107+1 'i' is used here | 27+1 It is declared in a different scope here",
          "eslint(no-var) | Unexpected var, use let or const instead. | Replace var with let or const | 23+3",
          "eslint(vars-on-top) | All 'var' declarations must be at the top of the function scope. | Consider moving this to the top of the functions scope or using let or const to declare this variable. | 23+9",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 27+1",
          "eslint(no-plusplus) | Unary operator '++' used. | Use the assignment operator `+=` instead. | 41+3",
          "eslint(curly) | Expected { after 'for' condition. | Replace `g(i, n);` with `{g(i, n);}`. | 89+8",
          "eslint(block-scoped-var) | 'i' is used outside of binding context. | Variable 'i' is used outside its declaration block. Declare it outside the block or use 'let'/'const'. | 27+1 it is redeclared here | 63+1 'i' is first declared here",
          "eslint(block-scoped-var) | 'i' is used outside of binding context. | Variable 'i' is used outside its declaration block. Declare it outside the block or use 'let'/'const'. | 34+1 'i' is used here | 63+1 It is declared in a different scope here",
          "eslint(block-scoped-var) | 'i' is used outside of binding context. | Variable 'i' is used outside its declaration block. Declare it outside the block or use 'let'/'const'. | 41+1 'i' is used here | 63+1 It is declared in a different scope here",
          "eslint(block-scoped-var) | 'i' is used outside of binding context. | Variable 'i' is used outside its declaration block. Declare it outside the block or use 'let'/'const'. | 48+1 'i' is used here | 63+1 It is declared in a different scope here",
          "eslint(block-scoped-var) | 'i' is used outside of binding context. | Variable 'i' is used outside its declaration block. Declare it outside the block or use 'let'/'const'. | 107+1 'i' is used here | 63+1 It is declared in a different scope here",
          "eslint(block-scoped-var) | 'n' is used outside of binding context. | Variable 'n' is used outside its declaration block. Declare it outside the block or use 'let'/'const'. | 111+1 'n' is used here | 70+1 It is declared in a different scope here",
          "eslint(no-var) | Unexpected var, use let or const instead. | Replace var with let or const | 59+3",
          "eslint(vars-on-top) | All 'var' declarations must be at the top of the function scope. | Consider moving this to the top of the functions scope or using let or const to declare this variable. | 59+16",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 63+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 70+1",
          "eslint(no-plusplus) | Unary operator '++' used. | Use the assignment operator `+=` instead. | 84+3",
          "eslint(no-magic-numbers) | No magic number: 1 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 118+1",
        ],
      ],
      [
        "js",
        "function f(a) {\n  if (a) { var b = 1; }\n  if (!a) { var b = 2, c = 3; }\n  return b + c;\n}\nf(1);",
        [
          "eslint(func-style) | Expected a function expression. | Enforce the consistent use of either `function` declarations or expressions assigned to variables | 0+89",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 9+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 11+1",
          "eslint(block-scoped-var) | 'b' is used outside of binding context. | Variable 'b' is used outside its declaration block. Declare it outside the block or use 'let'/'const'. | 56+1 it is redeclared here | 31+1 'b' is first declared here",
          "eslint(block-scoped-var) | 'b' is used outside of binding context. | Variable 'b' is used outside its declaration block. Declare it outside the block or use 'let'/'const'. | 81+1 'b' is used here | 31+1 It is declared in a different scope here",
          "eslint(no-var) | Unexpected var, use let or const instead. | Replace var with let or const | 27+3",
          "eslint(vars-on-top) | All 'var' declarations must be at the top of the function scope. | Consider moving this to the top of the functions scope or using let or const to declare this variable. | 27+10",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 31+1",
          "eslint(block-scoped-var) | 'b' is used outside of binding context. | Variable 'b' is used outside its declaration block. Declare it outside the block or use 'let'/'const'. | 31+1 it is redeclared here | 56+1 'b' is first declared here",
          "eslint(block-scoped-var) | 'b' is used outside of binding context. | Variable 'b' is used outside its declaration block. Declare it outside the block or use 'let'/'const'. | 81+1 'b' is used here | 56+1 It is declared in a different scope here",
          "eslint(block-scoped-var) | 'c' is used outside of binding context. | Variable 'c' is used outside its declaration block. Declare it outside the block or use 'let'/'const'. | 85+1 'c' is used here | 63+1 It is declared in a different scope here",
          "eslint(no-var) | Unexpected var, use let or const instead. | Replace var with let or const | 52+3",
          "eslint(vars-on-top) | All 'var' declarations must be at the top of the function scope. | Consider moving this to the top of the functions scope or using let or const to declare this variable. | 52+17",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 56+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 63+1",
          "eslint(no-magic-numbers) | No magic number: 1 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 92+1",
        ],
      ],
      [
        "js",
        "const f = async () => { g(); };\nconst h = async () => g();\nf(h);",
        [
          "eslint(no-undef) | 'g' is not defined. | Either define 'g' or remove the reference to it. If 'g' is a global variable, add it to the 'globals' configuration. | 24+1",
          "eslint(no-undef) | 'g' is not defined. | Either define 'g' or remove the reference to it. If 'g' is a global variable, add it to the 'globals' configuration. | 54+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 6+1",
          "oxc(no-async-await) | async is not allowed | Remove the `async` keyword | 10+5",
          "eslint(require-await) | Async function has no `await` expression. | Consider removing the `async` keyword. | 10+20",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 38+1",
          "eslint(require-await) | Async function has no `await` expression. | Consider removing the `async` keyword. | 42+15",
          "oxc(no-async-await) | async is not allowed | Remove the `async` keyword | 42+5",
        ],
      ],
      [
        "js",
        "class A {\n  get a() { return 1; }\n  get b() { return 2; }\n  set a(v) {}\n  set b(v) {}\n}\nnew A();",
        [
          "eslint(id-length) | Identifier name is too short (< 2). |  | 6+1",
          "eslint(grouped-accessor-pairs) | Accessor pair getter 'a' and setter 'a' should be grouped. | Require grouped accessor pairs in object literals and classes | 12+5 getter 'a' is here | 60+5 setter 'a' is here",
          "eslint(grouped-accessor-pairs) | Accessor pair getter 'b' and setter 'b' should be grouped. | Require grouped accessor pairs in object literals and classes | 36+5 getter 'b' is here | 74+5 setter 'b' is here",
          "eslint(class-methods-use-this) | Expected method `a` to have this. | Consider converting method `a` to a static method. | 16+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 16+1",
          "eslint(no-magic-numbers) | No magic number: 1 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 29+1",
          "eslint(class-methods-use-this) | Expected method `b` to have this. | Consider converting method `b` to a static method. | 40+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 40+1",
          "eslint(no-magic-numbers) | No magic number: 2 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 53+1",
          "eslint(class-methods-use-this) | Expected method `a` to have this. | Consider converting method `a` to a static method. | 64+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 64+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 66+1",
          "eslint(class-methods-use-this) | Expected method `b` to have this. | Consider converting method `b` to a static method. | 78+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 78+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 80+1",
        ],
      ],
    ],
  ],
  [
    "import/group-exports reports one sort of export after the other, and those with a source in the order of oxlint's hash table",
    {
      "categories": { "correctness": "off" },
      "plugins": ["import"],
      "rules": { "import/group-exports": "error", "import/exports-last": "error", "id-length": "error" },
    },
    [
      [
        "ts",
        "export type A = 1;\nexport const a = 1;\nexport type B = 2;\nexport const b = 2;\nexport interface C {}\nexport function c() {}",
        [
          "import(group-exports) | Multiple named export declarations; consolidate all named exports into a single export declaration | Use a single export declaration with multiple specifiers: `export { spec1, spec2 }` | 19+19",
          "import(group-exports) | Multiple named export declarations; consolidate all named exports into a single export declaration | Use a single export declaration with multiple specifiers: `export { spec1, spec2 }` | 58+19",
          "import(group-exports) | Multiple named export declarations; consolidate all named exports into a single export declaration | Use a single export declaration with multiple specifiers: `export { spec1, spec2 }` | 100+22",
          "import(group-exports) | Multiple named export declarations; consolidate all named exports into a single export declaration | Use a single export declaration with multiple specifiers: `export { spec1, spec2 }` | 0+18",
          "import(group-exports) | Multiple named export declarations; consolidate all named exports into a single export declaration | Use a single export declaration with multiple specifiers: `export { spec1, spec2 }` | 39+18",
          "import(group-exports) | Multiple named export declarations; consolidate all named exports into a single export declaration | Use a single export declaration with multiple specifiers: `export { spec1, spec2 }` | 78+21",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 12+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 32+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 51+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 71+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 95+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 116+1",
        ],
      ],
      [
        "ts",
        'export { a } from "./x";\nexport const b = 1;\nexport { c } from "./y";\nexport { d } from "./x";\nexport const e = 2;\nexport { f } from "./y";\nexport type { G } from "./x";\nexport type { H } from "./x";',
        [
          "import(group-exports) | Multiple named export declarations; consolidate all named exports into a single export declaration | Use a single export declaration with multiple specifiers: `export { spec1, spec2 }` | 25+19",
          "import(group-exports) | Multiple named export declarations; consolidate all named exports into a single export declaration | Use a single export declaration with multiple specifiers: `export { spec1, spec2 }` | 95+19",
          "import(group-exports) | Multiple named export declarations; consolidate all named exports into a single export declaration | Use a single export declaration with multiple specifiers: `export { spec1, spec2 }` | 0+24",
          "import(group-exports) | Multiple named export declarations; consolidate all named exports into a single export declaration | Use a single export declaration with multiple specifiers: `export { spec1, spec2 }` | 70+24",
          "import(group-exports) | Multiple named export declarations; consolidate all named exports into a single export declaration | Use a single export declaration with multiple specifiers: `export { spec1, spec2 }` | 45+24",
          "import(group-exports) | Multiple named export declarations; consolidate all named exports into a single export declaration | Use a single export declaration with multiple specifiers: `export { spec1, spec2 }` | 115+24",
          "import(group-exports) | Multiple named export declarations; consolidate all named exports into a single export declaration | Use a single export declaration with multiple specifiers: `export { spec1, spec2 }` | 140+29",
          "import(group-exports) | Multiple named export declarations; consolidate all named exports into a single export declaration | Use a single export declaration with multiple specifiers: `export { spec1, spec2 }` | 170+29",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 38+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 108+1",
        ],
      ],
      [
        "js",
        "exports.a = 1;\nexport const b = 1;\nmodule.exports.c = 2;\nexport const d = 2;\nexports.e = exports.f = 3;",
        [
          "import(exports-last) | Export statements should appear at the end of the file | Move this export to the end of the file, after all other statements. | 15+19",
          "import(exports-last) | Export statements should appear at the end of the file | Move this export to the end of the file, after all other statements. | 57+19",
          "import(group-exports) | Multiple named export declarations; consolidate all named exports into a single export declaration | Use a single export declaration with multiple specifiers: `export { spec1, spec2 }` | 15+19",
          "import(group-exports) | Multiple named export declarations; consolidate all named exports into a single export declaration | Use a single export declaration with multiple specifiers: `export { spec1, spec2 }` | 57+19",
          "import(group-exports) | Multiple CommonJS exports; consolidate all exports into a single assignment to `module.exports` | Combine multiple assignments into a single `module.exports = { ... }` statement | 0+13",
          "import(group-exports) | Multiple CommonJS exports; consolidate all exports into a single assignment to `module.exports` | Combine multiple assignments into a single `module.exports = { ... }` statement | 35+20",
          "import(group-exports) | Multiple CommonJS exports; consolidate all exports into a single assignment to `module.exports` | Combine multiple assignments into a single `module.exports = { ... }` statement | 77+25",
          "import(group-exports) | Multiple CommonJS exports; consolidate all exports into a single assignment to `module.exports` | Combine multiple assignments into a single `module.exports = { ... }` statement | 89+13",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 8+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 28+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 50+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 70+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 85+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 97+1",
        ],
      ],
      [
        "js",
        'export { a } from "./m1";\nexport { b } from "./m2";\nexport { c } from "./m3";\nexport { d } from "./m4";\nexport { e } from "./m5";\nexport { f } from "./m5";\nexport { g } from "./m4";\nexport { h } from "./m3";\nexport { i } from "./m2";\nexport { j } from "./m1";',
        [
          "import(group-exports) | Multiple named export declarations; consolidate all named exports into a single export declaration | Use a single export declaration with multiple specifiers: `export { spec1, spec2 }` | 78+25",
          "import(group-exports) | Multiple named export declarations; consolidate all named exports into a single export declaration | Use a single export declaration with multiple specifiers: `export { spec1, spec2 }` | 156+25",
          "import(group-exports) | Multiple named export declarations; consolidate all named exports into a single export declaration | Use a single export declaration with multiple specifiers: `export { spec1, spec2 }` | 104+25",
          "import(group-exports) | Multiple named export declarations; consolidate all named exports into a single export declaration | Use a single export declaration with multiple specifiers: `export { spec1, spec2 }` | 130+25",
          "import(group-exports) | Multiple named export declarations; consolidate all named exports into a single export declaration | Use a single export declaration with multiple specifiers: `export { spec1, spec2 }` | 52+25",
          "import(group-exports) | Multiple named export declarations; consolidate all named exports into a single export declaration | Use a single export declaration with multiple specifiers: `export { spec1, spec2 }` | 182+25",
          "import(group-exports) | Multiple named export declarations; consolidate all named exports into a single export declaration | Use a single export declaration with multiple specifiers: `export { spec1, spec2 }` | 0+25",
          "import(group-exports) | Multiple named export declarations; consolidate all named exports into a single export declaration | Use a single export declaration with multiple specifiers: `export { spec1, spec2 }` | 234+25",
          "import(group-exports) | Multiple named export declarations; consolidate all named exports into a single export declaration | Use a single export declaration with multiple specifiers: `export { spec1, spec2 }` | 26+25",
          "import(group-exports) | Multiple named export declarations; consolidate all named exports into a single export declaration | Use a single export declaration with multiple specifiers: `export { spec1, spec2 }` | 208+25",
        ],
      ],
    ],
  ],
  [
    "jest/no-export goes through oxlint's hash table of what is exported, and comes to the default export last",
    { "categories": { "correctness": "off" }, "plugins": ["jest"], "rules": { "jest/no-export": "error" } },
    [
      [
        "test.js",
        'export const alpha = 1;\nexport const beta = 2;\nexport function gamma() {}\nexport default 3;\nexport const delta = 4;\nexport { epsilon };\nconst epsilon = 5;\ntest("a", () => {});',
        [
          "jest(no-export) | Do not export from a test file. | If you want to share code between tests, move it into a separate file and import it from there. | 37+4",
          "jest(no-export) | Do not export from a test file. | If you want to share code between tests, move it into a separate file and import it from there. | 105+5",
          "jest(no-export) | Do not export from a test file. | If you want to share code between tests, move it into a separate file and import it from there. | 13+5",
          "jest(no-export) | Do not export from a test file. | If you want to share code between tests, move it into a separate file and import it from there. | 125+7",
          "jest(no-export) | Do not export from a test file. | If you want to share code between tests, move it into a separate file and import it from there. | 63+5",
          "jest(no-export) | Do not export from a test file. | If you want to share code between tests, move it into a separate file and import it from there. | 81+7",
        ],
      ],
      [
        "test.js",
        'export const a = 1, b = 2, c = 3, d = 4, e = 5, f = 6, g = 7, h = 8, i = 9;\ntest("a", () => {});',
        [
          "jest(no-export) | Do not export from a test file. | If you want to share code between tests, move it into a separate file and import it from there. | 69+1",
          "jest(no-export) | Do not export from a test file. | If you want to share code between tests, move it into a separate file and import it from there. | 13+1",
          "jest(no-export) | Do not export from a test file. | If you want to share code between tests, move it into a separate file and import it from there. | 48+1",
          "jest(no-export) | Do not export from a test file. | If you want to share code between tests, move it into a separate file and import it from there. | 27+1",
          "jest(no-export) | Do not export from a test file. | If you want to share code between tests, move it into a separate file and import it from there. | 62+1",
          "jest(no-export) | Do not export from a test file. | If you want to share code between tests, move it into a separate file and import it from there. | 41+1",
          "jest(no-export) | Do not export from a test file. | If you want to share code between tests, move it into a separate file and import it from there. | 34+1",
          "jest(no-export) | Do not export from a test file. | If you want to share code between tests, move it into a separate file and import it from there. | 55+1",
          "jest(no-export) | Do not export from a test file. | If you want to share code between tests, move it into a separate file and import it from there. | 20+1",
        ],
      ],
    ],
  ],
  [
    "a rule that is called with a type annotation reports at its colon",
    {
      "categories": { "correctness": "off" },
      "plugins": ["typescript"],
      "rules": {
        "typescript/prefer-function-type": "error",
        "typescript/method-signature-style": "error",
        "typescript/no-explicit-any": "error",
        "id-length": "error",
        "func-style": "error",
      },
    },
    [
      [
        "ts",
        "export interface I {\n  m(c: ((...a: any[]) => any) | { new (...a: any[]): any }): void;\n}",
        [
          "eslint(id-length) | Identifier name is too short (< 2). |  | 17+1",
          "typescript(method-signature-style) | Use a property signature instead of a method signature. | Replace the method signature with a property whose type is a function type. | 23+64",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 23+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 25+1",
          "typescript(prefer-function-type) | Enforce using function types instead of interfaces with call signatures. | The function type form `new (...a: any[]) => any` is generally preferred when possible for being more succinct. | 55+22",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 33+1",
          "typescript(no-explicit-any) | Unexpected `any`. Specify a different type. | Use `unknown` instead, this will force you to explicitly, and safely, assert the type is correct. | 36+3",
          "typescript(no-explicit-any) | Unexpected `any`. Specify a different type. | Use `unknown` instead, this will force you to explicitly, and safely, assert the type is correct. | 46+3",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 63+1",
          "typescript(no-explicit-any) | Unexpected `any`. Specify a different type. | Use `unknown` instead, this will force you to explicitly, and safely, assert the type is correct. | 66+3",
          "typescript(no-explicit-any) | Unexpected `any`. Specify a different type. | Use `unknown` instead, this will force you to explicitly, and safely, assert the type is correct. | 74+3",
        ],
      ],
      [
        "ts",
        "export const a: { (b: any): any } = (b: any) => b;",
        [
          "eslint(id-length) | Identifier name is too short (< 2). |  | 13+1",
          "typescript(prefer-function-type) | Enforce using function types instead of interfaces with call signatures. | The function type form `(b: any) => any` is generally preferred when possible for being more succinct. | 18+13",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 19+1",
          "typescript(no-explicit-any) | Unexpected `any`. Specify a different type. | Use `unknown` instead, this will force you to explicitly, and safely, assert the type is correct. | 22+3",
          "typescript(no-explicit-any) | Unexpected `any`. Specify a different type. | Use `unknown` instead, this will force you to explicitly, and safely, assert the type is correct. | 28+3",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 37+1",
          "typescript(no-explicit-any) | Unexpected `any`. Specify a different type. | Use `unknown` instead, this will force you to explicitly, and safely, assert the type is correct. | 40+3",
        ],
      ],
      [
        "ts",
        "export function f(a: { (b: any): void }): { (c: any): void } {\n  return a;\n}",
        [
          "eslint(func-style) | Expected a function expression. | Enforce the consistent use of either `function` declarations or expressions assigned to variables | 7+69",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 16+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 18+1",
          "typescript(prefer-function-type) | Enforce using function types instead of interfaces with call signatures. | The function type form `(b: any) => void` is generally preferred when possible for being more succinct. | 23+14",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 24+1",
          "typescript(no-explicit-any) | Unexpected `any`. Specify a different type. | Use `unknown` instead, this will force you to explicitly, and safely, assert the type is correct. | 27+3",
          "typescript(prefer-function-type) | Enforce using function types instead of interfaces with call signatures. | The function type form `(c: any) => void` is generally preferred when possible for being more succinct. | 44+14",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 45+1",
          "typescript(no-explicit-any) | Unexpected `any`. Specify a different type. | Use `unknown` instead, this will force you to explicitly, and safely, assert the type is correct. | 48+3",
        ],
      ],
    ],
  ],
  [
    "import/newline-after-import reports a statement that requires when oxlint comes to the last call in it",
    {
      "categories": { "correctness": "off" },
      "plugins": ["import", "typescript", "unicorn"],
      "rules": {
        "import/newline-after-import": "error",
        "import/first": "error",
        "typescript/no-require-imports": "error",
        "typescript/no-var-requires": "error",
        "unicorn/prefer-module": "error",
        "id-length": "error",
        "func-style": "error",
        "no-undef": "error",
      },
    },
    [
      [
        "js",
        'const a = require("a");\nconst b = require("b");\nfoo(a, b);\nconst c = require("c");\nbar(c);',
        [
          "eslint(no-undef) | 'require' is not defined. | Either define 'require' or remove the reference to it. If 'require' is a global variable, add it to the 'globals' configuration. | 10+7",
          "eslint(no-undef) | 'require' is not defined. | Either define 'require' or remove the reference to it. If 'require' is a global variable, add it to the 'globals' configuration. | 34+7",
          "eslint(no-undef) | 'require' is not defined. | Either define 'require' or remove the reference to it. If 'require' is a global variable, add it to the 'globals' configuration. | 69+7",
          "eslint(no-undef) | 'bar' is not defined. | Either define 'bar' or remove the reference to it. If 'bar' is a global variable, add it to the 'globals' configuration. | 83+3",
          "eslint(no-undef) | 'foo' is not defined. | Either define 'foo' or remove the reference to it. If 'foo' is a global variable, add it to the 'globals' configuration. | 48+3",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 6+1",
          'typescript(no-require-imports) | Expected "import" statement instead of "require" call | Do not use CommonJS `require` calls | 10+12',
          "typescript(no-var-requires) | Require statement not part of import statement. | Use ES module imports or `import = require` instead. | 10+12",
          'unicorn(prefer-module) | Do not use "require". | Prefer ES modules over CommonJS globals. | 10+7',
          "eslint(id-length) | Identifier name is too short (< 2). |  | 30+1",
          "import(newline-after-import) | Expected 1 empty line after require statement not followed by another require. | Add empty line(s) after require | 24+23",
          'typescript(no-require-imports) | Expected "import" statement instead of "require" call | Do not use CommonJS `require` calls | 34+12',
          "typescript(no-var-requires) | Require statement not part of import statement. | Use ES module imports or `import = require` instead. | 34+12",
          'unicorn(prefer-module) | Do not use "require". | Prefer ES modules over CommonJS globals. | 34+7',
          "eslint(id-length) | Identifier name is too short (< 2). |  | 65+1",
          "import(newline-after-import) | Expected 1 empty line after require statement not followed by another require. | Add empty line(s) after require | 59+23",
          'typescript(no-require-imports) | Expected "import" statement instead of "require" call | Do not use CommonJS `require` calls | 69+12',
          "typescript(no-var-requires) | Require statement not part of import statement. | Use ES module imports or `import = require` instead. | 69+12",
          'unicorn(prefer-module) | Do not use "require". | Prefer ES modules over CommonJS globals. | 69+7',
        ],
      ],
      [
        "js",
        'import x from "x";\nconst a = require("a");\nfoo(a, x);\nfunction f() {\n  const d = require("d");\n  return d;\n}\nf();',
        [
          "eslint(no-undef) | 'require' is not defined. | Either define 'require' or remove the reference to it. If 'require' is a global variable, add it to the 'globals' configuration. | 29+7",
          "eslint(no-undef) | 'require' is not defined. | Either define 'require' or remove the reference to it. If 'require' is a global variable, add it to the 'globals' configuration. | 81+7",
          "eslint(no-undef) | 'foo' is not defined. | Either define 'foo' or remove the reference to it. If 'foo' is a global variable, add it to the 'globals' configuration. | 43+3",
          "import(newline-after-import) | Expected 1 empty line after import statement not followed by another import. | Add empty line(s) after import | 0+18",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 7+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 25+1",
          "import(newline-after-import) | Expected 1 empty line after require statement not followed by another require. | Add empty line(s) after require | 19+23",
          'typescript(no-require-imports) | Expected "import" statement instead of "require" call | Do not use CommonJS `require` calls | 29+12',
          "typescript(no-var-requires) | Require statement not part of import statement. | Use ES module imports or `import = require` instead. | 29+12",
          'unicorn(prefer-module) | Do not use "require". | Prefer ES modules over CommonJS globals. | 29+7',
          "eslint(func-style) | Expected a function expression. | Enforce the consistent use of either `function` declarations or expressions assigned to variables | 54+54",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 63+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 77+1",
          'typescript(no-require-imports) | Expected "import" statement instead of "require" call | Do not use CommonJS `require` calls | 81+12',
          "typescript(no-var-requires) | Require statement not part of import statement. | Use ES module imports or `import = require` instead. | 81+12",
          'unicorn(prefer-module) | Do not use "require". | Prefer ES modules over CommonJS globals. | 81+7',
        ],
      ],
      [
        "js",
        'const a = require("a"), b = require("b");\nfoo(a, b);\nif (a) {\n  const c = require("c");\n  bar(c);\n}',
        [
          "eslint(no-undef) | 'require' is not defined. | Either define 'require' or remove the reference to it. If 'require' is a global variable, add it to the 'globals' configuration. | 10+7",
          "eslint(no-undef) | 'require' is not defined. | Either define 'require' or remove the reference to it. If 'require' is a global variable, add it to the 'globals' configuration. | 28+7",
          "eslint(no-undef) | 'require' is not defined. | Either define 'require' or remove the reference to it. If 'require' is a global variable, add it to the 'globals' configuration. | 74+7",
          "eslint(no-undef) | 'bar' is not defined. | Either define 'bar' or remove the reference to it. If 'bar' is a global variable, add it to the 'globals' configuration. | 90+3",
          "eslint(no-undef) | 'foo' is not defined. | Either define 'foo' or remove the reference to it. If 'foo' is a global variable, add it to the 'globals' configuration. | 42+3",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 6+1",
          'typescript(no-require-imports) | Expected "import" statement instead of "require" call | Do not use CommonJS `require` calls | 10+12',
          "typescript(no-var-requires) | Require statement not part of import statement. | Use ES module imports or `import = require` instead. | 10+12",
          'unicorn(prefer-module) | Do not use "require". | Prefer ES modules over CommonJS globals. | 10+7',
          "eslint(id-length) | Identifier name is too short (< 2). |  | 24+1",
          "import(newline-after-import) | Expected 1 empty line after require statement not followed by another require. | Add empty line(s) after require | 0+41",
          'typescript(no-require-imports) | Expected "import" statement instead of "require" call | Do not use CommonJS `require` calls | 28+12',
          "typescript(no-var-requires) | Require statement not part of import statement. | Use ES module imports or `import = require` instead. | 28+12",
          'unicorn(prefer-module) | Do not use "require". | Prefer ES modules over CommonJS globals. | 28+7',
          "eslint(id-length) | Identifier name is too short (< 2). |  | 70+1",
          'typescript(no-require-imports) | Expected "import" statement instead of "require" call | Do not use CommonJS `require` calls | 74+12',
          "typescript(no-var-requires) | Require statement not part of import statement. | Use ES module imports or `import = require` instead. | 74+12",
          'unicorn(prefer-module) | Do not use "require". | Prefer ES modules over CommonJS globals. | 74+7',
        ],
      ],
      [
        "js",
        'import x from "x";\nfoo(x);\nimport y from "y";\nbar(y);\nconst z = require("z");\nbaz(z);',
        [
          "import(first) | Import statements must come first | Move import statement to the top of the file | 27+18",
          "eslint(no-undef) | 'require' is not defined. | Either define 'require' or remove the reference to it. If 'require' is a global variable, add it to the 'globals' configuration. | 64+7",
          "eslint(no-undef) | 'foo' is not defined. | Either define 'foo' or remove the reference to it. If 'foo' is a global variable, add it to the 'globals' configuration. | 19+3",
          "eslint(no-undef) | 'bar' is not defined. | Either define 'bar' or remove the reference to it. If 'bar' is a global variable, add it to the 'globals' configuration. | 46+3",
          "eslint(no-undef) | 'baz' is not defined. | Either define 'baz' or remove the reference to it. If 'baz' is a global variable, add it to the 'globals' configuration. | 78+3",
          "import(newline-after-import) | Expected 1 empty line after import statement not followed by another import. | Add empty line(s) after import | 0+18",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 7+1",
          "import(newline-after-import) | Expected 1 empty line after import statement not followed by another import. | Add empty line(s) after import | 27+18",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 34+1",
          "eslint(id-length) | Identifier name is too short (< 2). |  | 60+1",
          "import(newline-after-import) | Expected 1 empty line after require statement not followed by another require. | Add empty line(s) after require | 54+23",
          'typescript(no-require-imports) | Expected "import" statement instead of "require" call | Do not use CommonJS `require` calls | 64+12',
          "typescript(no-var-requires) | Require statement not part of import statement. | Use ES module imports or `import = require` instead. | 64+12",
          'unicorn(prefer-module) | Do not use "require". | Prefer ES modules over CommonJS globals. | 64+7',
        ],
      ],
    ],
  ],
  [
    "react/exhaustive-deps goes through the dependencies that are declared in the order of oxlint's hash table",
    { "categories": { "correctness": "off" }, "plugins": ["react"], "rules": { "react/exhaustive-deps": ["error"] } },
    [
      [
        "tsx",
        "import MutableStore from 'store';\n        let z = {};\n\n        function MyComponent(props) {\n          let x = props.foo;\n          {\n            let y = props.bar;\n            const fn = useCallback(() => {\n              // nothing\n            }, [MutableStore.hello.world, props.foo, x, y, z, global.stuff]);\n          }\n        }",
        [
          "react-hooks(exhaustive-deps) | React Hook useCallback has an unnecessary dependency: MutableStore. | Consider removing it from the dependency array. Outer scope values aren't valid dependencies because mutating them doesn't re-render the component. | 249+24",
          "react-hooks(exhaustive-deps) | React Hook useCallback has an unnecessary dependency: z. | Consider removing it from the dependency array. Outer scope values aren't valid dependencies because mutating them doesn't re-render the component. | 292+1",
          "react-hooks(exhaustive-deps) | React Hook useCallback has an unnecessary dependency: global. | Consider removing it from the dependency array. Outer scope values aren't valid dependencies because mutating them doesn't re-render the component. | 295+12",
          "react-hooks(exhaustive-deps) | React Hook useCallback has unnecessary dependency: MutableStore.hello.world | Either include it or remove the dependency array. | 248+60",
          "react-hooks(exhaustive-deps) | React Hook useCallback has unnecessary dependency: z | Either include it or remove the dependency array. | 248+60",
          "react-hooks(exhaustive-deps) | React Hook useCallback has unnecessary dependency: global.stuff | Either include it or remove the dependency array. | 248+60",
          "react-hooks(exhaustive-deps) | React Hook useCallback has unnecessary dependency: y | Either include it or remove the dependency array. | 248+60",
          "react-hooks(exhaustive-deps) | React Hook useCallback has unnecessary dependency: x | Either include it or remove the dependency array. | 248+60",
          "react-hooks(exhaustive-deps) | React Hook useCallback has unnecessary dependency: props.foo | Either include it or remove the dependency array. | 248+60",
          "react-hooks(exhaustive-deps) | React hook useCallback depends on `z`, which changes every render | Try memoizing this variable with `useRef` or `useCallback`. | 292+1 it will always cause this hook to re-evaluate | 46+1 `z` is declared here",
        ],
      ],
      [
        "tsx",
        "import MutableStore from 'store';\n        let z = {};\n\n        function MyComponent(props) {\n          let x = props.foo;\n          {\n            let y = props.bar;\n            const fn = useCallback(() => {\n              // nothing\n            }, [MutableStore?.hello?.world, props.foo, x, y, z, global?.stuff]);\n          }\n        }",
        [
          "react-hooks(exhaustive-deps) | React Hook useCallback has an unnecessary dependency: MutableStore. | Consider removing it from the dependency array. Outer scope values aren't valid dependencies because mutating them doesn't re-render the component. | 249+26",
          "react-hooks(exhaustive-deps) | React Hook useCallback has an unnecessary dependency: z. | Consider removing it from the dependency array. Outer scope values aren't valid dependencies because mutating them doesn't re-render the component. | 294+1",
          "react-hooks(exhaustive-deps) | React Hook useCallback has an unnecessary dependency: global. | Consider removing it from the dependency array. Outer scope values aren't valid dependencies because mutating them doesn't re-render the component. | 297+13",
          "react-hooks(exhaustive-deps) | React Hook useCallback has unnecessary dependency: MutableStore.hello.world | Either include it or remove the dependency array. | 248+63",
          "react-hooks(exhaustive-deps) | React Hook useCallback has unnecessary dependency: z | Either include it or remove the dependency array. | 248+63",
          "react-hooks(exhaustive-deps) | React Hook useCallback has unnecessary dependency: global.stuff | Either include it or remove the dependency array. | 248+63",
          "react-hooks(exhaustive-deps) | React Hook useCallback has unnecessary dependency: y | Either include it or remove the dependency array. | 248+63",
          "react-hooks(exhaustive-deps) | React Hook useCallback has unnecessary dependency: x | Either include it or remove the dependency array. | 248+63",
          "react-hooks(exhaustive-deps) | React Hook useCallback has unnecessary dependency: props.foo | Either include it or remove the dependency array. | 248+63",
          "react-hooks(exhaustive-deps) | React hook useCallback depends on `z`, which changes every render | Try memoizing this variable with `useRef` or `useCallback`. | 294+1 it will always cause this hook to re-evaluate | 46+1 `z` is declared here",
        ],
      ],
    ],
  ],
  [
    "cases of oxlint's own tests that it does not report in the order of the text",
    {
      "categories": { "correctness": "off" },
      "plugins": ["jest", "promise", "react", "unicorn", "vitest"],
      "rules": {
        "jest/padding-around-test-blocks": "error",
        "jest/prefer-mock-promise-shorthand": "error",
        "jest/prefer-mock-return-shorthand": "error",
        "jest/require-hook": "error",
        "promise/no-return-wrap": "error",
        "promise/prefer-await-to-then": "error",
        "react/exhaustive-deps": "error",
        "react/only-export-components": "error",
        "unicorn/catch-error-name": "error",
        "unicorn/custom-error-definition": "error",
        "unicorn/escape-case": "error",
        "unicorn/no-useless-length-check": "error",
        "unicorn/no-useless-switch-case": "error",
        "unicorn/prefer-array-find": "error",
        "unicorn/prefer-dom-node-append": "error",
        "unicorn/prefer-query-selector": "error",
        "vitest/padding-around-test-blocks": "error",
        "vitest/prefer-mock-promise-shorthand": "error",
        "vitest/prefer-mock-return-shorthand": "error",
        "vitest/require-hook": "error",
        "vitest/warn-todo": "error",
      },
    },
    [
      [
        "test.tsx",
        "it('foo', () => {});\nfit('bar', () => {});\ntest('baz', () => {});",
        [
          "jest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 21+20",
          "vitest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 21+20",
          "jest(padding-around-test-blocks) | Missing padding before test block | Make sure there is an empty new line before the test block | 43+0",
          "vitest(padding-around-test-blocks) | Missing padding before test block | Make sure there is an empty new line before the test block | 43+0",
          "jest(padding-around-test-blocks) | Missing padding before fit block | Make sure there is an empty new line before the fit block | 21+0",
          "vitest(padding-around-test-blocks) | Missing padding before fit block | Make sure there is an empty new line before the fit block | 21+0",
        ],
      ],
      [
        "test.tsx",
        "\nconst foo = 'bar';\nconst bar = 'baz';\nit('foo', () => {\n  // stuff\n});\nfit('bar', () => {\n  // stuff\n});\ntest('foo foo', () => {});\ntest('bar bar', () => {});\n\n// Nesting\n describe('other bar', () => {\n     const thing = 123;\n     test('is another bar w/ test', () => {\n     });\n     // With a comment\n     it('is another bar w/ it', () => {\n     });\n     test.skip('skipping', () => {}); // Another comment\n     it.skip('skipping too', () => {});\n });xtest('weird', () => {});\n test\n   .skip('skippy skip', () => {});\n xit('bar foo', () => {});\n            ",
        [
          "jest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 72+32",
          "jest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 453+24",
          "jest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 521+24",
          "vitest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 72+32",
          "vitest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 453+24",
          "vitest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 521+24",
          "jest(padding-around-test-blocks) | Missing padding before it block | Make sure there is an empty new line before the it block | 39+0",
          "vitest(padding-around-test-blocks) | Missing padding before it block | Make sure there is an empty new line before the it block | 39+0",
          "jest(padding-around-test-blocks) | Missing padding before it block | Make sure there is an empty new line before the it block | 308+0",
          "vitest(padding-around-test-blocks) | Missing padding before it block | Make sure there is an empty new line before the it block | 308+0",
          "jest(padding-around-test-blocks) | Missing padding before it block | Make sure there is an empty new line before the it block | 414+0",
          "vitest(padding-around-test-blocks) | Missing padding before it block | Make sure there is an empty new line before the it block | 414+0",
          "jest(padding-around-test-blocks) | Missing padding before fit block | Make sure there is an empty new line before the fit block | 72+0",
          "vitest(padding-around-test-blocks) | Missing padding before fit block | Make sure there is an empty new line before the fit block | 72+0",
          "jest(padding-around-test-blocks) | Missing padding before test block | Make sure there is an empty new line before the test block | 106+0",
          "vitest(padding-around-test-blocks) | Missing padding before test block | Make sure there is an empty new line before the test block | 106+0",
          "jest(padding-around-test-blocks) | Missing padding before test block | Make sure there is an empty new line before the test block | 133+0",
          "vitest(padding-around-test-blocks) | Missing padding before test block | Make sure there is an empty new line before the test block | 133+0",
          "jest(padding-around-test-blocks) | Missing padding before test block | Make sure there is an empty new line before the test block | 232+0",
          "vitest(padding-around-test-blocks) | Missing padding before test block | Make sure there is an empty new line before the test block | 232+0",
          "jest(padding-around-test-blocks) | Missing padding before test block | Make sure there is an empty new line before the test block | 357+0",
          "vitest(padding-around-test-blocks) | Missing padding before test block | Make sure there is an empty new line before the test block | 357+0",
          "jest(padding-around-test-blocks) | Missing padding before test block | Make sure there is an empty new line before the test block | 480+0",
          "vitest(padding-around-test-blocks) | Missing padding before test block | Make sure there is an empty new line before the test block | 480+0",
          "jest(padding-around-test-blocks) | Missing padding before xtest block | Make sure there is an empty new line before the xtest block | 453+0",
          "vitest(padding-around-test-blocks) | Missing padding before xtest block | Make sure there is an empty new line before the xtest block | 453+0",
          "jest(padding-around-test-blocks) | Missing padding before xit block | Make sure there is an empty new line before the xit block | 521+0",
          "vitest(padding-around-test-blocks) | Missing padding before xit block | Make sure there is an empty new line before the xit block | 521+0",
        ],
      ],
      [
        "test.tsx",
        "\nconst foo = 'bar';\nconst bar = 'baz';\nit('foo', () => {\n  // stuff\n});\nfit('bar', () => {\n  // stuff\n});\ntest('foo foo', () => {});\ntest('bar bar', () => {});\n\n// Nesting\ndescribe('other bar', () => {\n    const thing = 123;\n    test('is another bar w/ test', () => {\n    });\n    // With a comment\n    it('is another bar w/ it', () => {\n    });\n    test.skip('skipping', () => {}); // Another comment\n    it.skip('skipping too', () => {});\n});xtest('weird', () => {});\ntest\n  .skip('skippy skip', () => {});\nxit('bar foo', () => {});\n        ",
        [
          "jest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 72+32",
          "jest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 443+24",
          "jest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 508+24",
          "vitest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 72+32",
          "vitest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 443+24",
          "vitest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 508+24",
          "jest(padding-around-test-blocks) | Missing padding before it block | Make sure there is an empty new line before the it block | 39+0",
          "vitest(padding-around-test-blocks) | Missing padding before it block | Make sure there is an empty new line before the it block | 39+0",
          "jest(padding-around-test-blocks) | Missing padding before it block | Make sure there is an empty new line before the it block | 302+0",
          "vitest(padding-around-test-blocks) | Missing padding before it block | Make sure there is an empty new line before the it block | 302+0",
          "jest(padding-around-test-blocks) | Missing padding before it block | Make sure there is an empty new line before the it block | 405+0",
          "vitest(padding-around-test-blocks) | Missing padding before it block | Make sure there is an empty new line before the it block | 405+0",
          "jest(padding-around-test-blocks) | Missing padding before fit block | Make sure there is an empty new line before the fit block | 72+0",
          "vitest(padding-around-test-blocks) | Missing padding before fit block | Make sure there is an empty new line before the fit block | 72+0",
          "jest(padding-around-test-blocks) | Missing padding before test block | Make sure there is an empty new line before the test block | 106+0",
          "vitest(padding-around-test-blocks) | Missing padding before test block | Make sure there is an empty new line before the test block | 106+0",
          "jest(padding-around-test-blocks) | Missing padding before test block | Make sure there is an empty new line before the test block | 133+0",
          "vitest(padding-around-test-blocks) | Missing padding before test block | Make sure there is an empty new line before the test block | 133+0",
          "jest(padding-around-test-blocks) | Missing padding before test block | Make sure there is an empty new line before the test block | 229+0",
          "vitest(padding-around-test-blocks) | Missing padding before test block | Make sure there is an empty new line before the test block | 229+0",
          "jest(padding-around-test-blocks) | Missing padding before test block | Make sure there is an empty new line before the test block | 349+0",
          "vitest(padding-around-test-blocks) | Missing padding before test block | Make sure there is an empty new line before the test block | 349+0",
          "jest(padding-around-test-blocks) | Missing padding before test block | Make sure there is an empty new line before the test block | 469+0",
          "vitest(padding-around-test-blocks) | Missing padding before test block | Make sure there is an empty new line before the test block | 469+0",
          "jest(padding-around-test-blocks) | Missing padding before xtest block | Make sure there is an empty new line before the xtest block | 443+0",
          "vitest(padding-around-test-blocks) | Missing padding before xtest block | Make sure there is an empty new line before the xtest block | 443+0",
          "jest(padding-around-test-blocks) | Missing padding before xit block | Make sure there is an empty new line before the xit block | 508+0",
          "vitest(padding-around-test-blocks) | Missing padding before xit block | Make sure there is an empty new line before the xit block | 508+0",
        ],
      ],
      [
        "test.tsx",
        "\n                aVariable\n                    .mockImplementation(() => Promise.reject(42))\n                    .mockImplementation(() => Promise.resolve(42))\n                    .mockReturnValue(Promise.reject(42))\n            ",
        [
          "jest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 17+199",
          "vitest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 17+199",
          'jest(prefer-mock-promise-shorthand) | Prefer mock resolved/rejected shorthands for promises. | Prefer "mockRejectedValue" | 181+15',
          'vitest(prefer-mock-promise-shorthand) | Prefer mock resolved/rejected shorthands for promises. | Prefer "mockRejectedValue" | 181+15',
          'jest(prefer-mock-promise-shorthand) | Prefer mock resolved/rejected shorthands for promises. | Prefer "mockResolvedValue" | 114+18',
          "jest(prefer-mock-return-shorthand) | Mock functions that return simple values should use `mockReturnValue/mockReturnValueOnce`. | Replace `mockImplementation` with `mockReturnValue`. | 114+18",
          'vitest(prefer-mock-promise-shorthand) | Prefer mock resolved/rejected shorthands for promises. | Prefer "mockResolvedValue" | 114+18',
          "vitest(prefer-mock-return-shorthand) | Mock functions that return simple values should use `mockReturnValue/mockReturnValueOnce`. | Replace `mockImplementation` with `mockReturnValue`. | 114+18",
          'jest(prefer-mock-promise-shorthand) | Prefer mock resolved/rejected shorthands for promises. | Prefer "mockRejectedValue" | 48+18',
          "jest(prefer-mock-return-shorthand) | Mock functions that return simple values should use `mockReturnValue/mockReturnValueOnce`. | Replace `mockImplementation` with `mockReturnValue`. | 48+18",
          'vitest(prefer-mock-promise-shorthand) | Prefer mock resolved/rejected shorthands for promises. | Prefer "mockRejectedValue" | 48+18',
          "vitest(prefer-mock-return-shorthand) | Mock functions that return simple values should use `mockReturnValue/mockReturnValueOnce`. | Replace `mockImplementation` with `mockReturnValue`. | 48+18",
        ],
      ],
      [
        "test.tsx",
        "\n                aVariable\n                    .mockReturnValueOnce(Promise.reject(42))\n                    .mockImplementation(() => Promise.resolve(42))\n                    .mockReturnValueOnce(Promise.reject(42))\n            ",
        [
          "jest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 17+198",
          "vitest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 17+198",
          'jest(prefer-mock-promise-shorthand) | Prefer mock resolved/rejected shorthands for promises. | Prefer "mockRejectedValueOnce" | 176+19',
          'vitest(prefer-mock-promise-shorthand) | Prefer mock resolved/rejected shorthands for promises. | Prefer "mockRejectedValueOnce" | 176+19',
          'jest(prefer-mock-promise-shorthand) | Prefer mock resolved/rejected shorthands for promises. | Prefer "mockResolvedValue" | 109+18',
          "jest(prefer-mock-return-shorthand) | Mock functions that return simple values should use `mockReturnValue/mockReturnValueOnce`. | Replace `mockImplementation` with `mockReturnValue`. | 109+18",
          'vitest(prefer-mock-promise-shorthand) | Prefer mock resolved/rejected shorthands for promises. | Prefer "mockResolvedValue" | 109+18',
          "vitest(prefer-mock-return-shorthand) | Mock functions that return simple values should use `mockReturnValue/mockReturnValueOnce`. | Replace `mockImplementation` with `mockReturnValue`. | 109+18",
          'jest(prefer-mock-promise-shorthand) | Prefer mock resolved/rejected shorthands for promises. | Prefer "mockRejectedValueOnce" | 48+19',
          'vitest(prefer-mock-promise-shorthand) | Prefer mock resolved/rejected shorthands for promises. | Prefer "mockRejectedValueOnce" | 48+19',
        ],
      ],
      [
        "test.tsx",
        'aVariable\n              .mockImplementation(() => 42)\n              .mockImplementation(async () => 42)\n              .mockImplementation(() => Promise.resolve(42))\n              .mockReturnValue("hello world")',
        [
          "jest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 0+210",
          "vitest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 0+210",
          'jest(prefer-mock-promise-shorthand) | Prefer mock resolved/rejected shorthands for promises. | Prefer "mockResolvedValue" | 119+18',
          "jest(prefer-mock-return-shorthand) | Mock functions that return simple values should use `mockReturnValue/mockReturnValueOnce`. | Replace `mockImplementation` with `mockReturnValue`. | 119+18",
          'vitest(prefer-mock-promise-shorthand) | Prefer mock resolved/rejected shorthands for promises. | Prefer "mockResolvedValue" | 119+18',
          "vitest(prefer-mock-return-shorthand) | Mock functions that return simple values should use `mockReturnValue/mockReturnValueOnce`. | Replace `mockImplementation` with `mockReturnValue`. | 119+18",
          "jest(prefer-mock-return-shorthand) | Mock functions that return simple values should use `mockReturnValue/mockReturnValueOnce`. | Replace `mockImplementation` with `mockReturnValue`. | 25+18",
          "vitest(prefer-mock-return-shorthand) | Mock functions that return simple values should use `mockReturnValue/mockReturnValueOnce`. | Replace `mockImplementation` with `mockReturnValue`. | 25+18",
        ],
      ],
      [
        "test.tsx",
        'aVariable\n              .mockImplementationOnce(() => Promise.reject(42))\n              .mockImplementation(() => "hello sunshine")\n              .mockReturnValueOnce(Promise.reject(42))',
        [
          "jest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 0+186",
          "vitest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 0+186",
          'jest(prefer-mock-promise-shorthand) | Prefer mock resolved/rejected shorthands for promises. | Prefer "mockRejectedValueOnce" | 147+19',
          'vitest(prefer-mock-promise-shorthand) | Prefer mock resolved/rejected shorthands for promises. | Prefer "mockRejectedValueOnce" | 147+19',
          "jest(prefer-mock-return-shorthand) | Mock functions that return simple values should use `mockReturnValue/mockReturnValueOnce`. | Replace `mockImplementation` with `mockReturnValue`. | 89+18",
          "vitest(prefer-mock-return-shorthand) | Mock functions that return simple values should use `mockReturnValue/mockReturnValueOnce`. | Replace `mockImplementation` with `mockReturnValue`. | 89+18",
          'jest(prefer-mock-promise-shorthand) | Prefer mock resolved/rejected shorthands for promises. | Prefer "mockRejectedValueOnce" | 25+22',
          "jest(prefer-mock-return-shorthand) | Mock functions that return simple values should use `mockReturnValue/mockReturnValueOnce`. | Replace `mockImplementationOnce` with `mockReturnValueOnce`. | 25+22",
          'vitest(prefer-mock-promise-shorthand) | Prefer mock resolved/rejected shorthands for promises. | Prefer "mockRejectedValueOnce" | 25+22',
          "vitest(prefer-mock-return-shorthand) | Mock functions that return simple values should use `mockReturnValue/mockReturnValueOnce`. | Replace `mockImplementationOnce` with `mockReturnValueOnce`. | 25+22",
        ],
      ],
      [
        "test.tsx",
        "\n                import { database, isCity } from '../database';\n                import { loadCities } from '../api';\n\n                jest.mock('../api');\n\n                const initializeCityDatabase = () => {\n                    database.addCity('Vienna');\n                    database.addCity('San Juan');\n                    database.addCity('Wellington');\n                };\n\n                const clearCityDatabase = () => {\n                    database.clear();\n                };\n\n                initializeCityDatabase();\n\n                test('that persists cities', () => {\n                    expect(database.cities.length).toHaveLength(3);\n                });\n\n                test('city database has Vienna', () => {\n                    expect(isCity('Vienna')).toBeTruthy();\n                });\n\n                test('city database has San Juan', () => {\n                    expect(isCity('San Juan')).toBeTruthy();\n                });\n\n                describe('when loading cities from the api', () => {\n                    let consoleWarnSpy = jest.spyOn(console, 'warn');\n\n                    loadCities.mockResolvedValue(['Wellington', 'London']);\n\n                    it('does not duplicate cities', async () => {\n                        await database.loadCities();\n\n                        expect(database.cities).toHaveLength(4);\n                    });\n\n                    it('logs any duplicates', async () => {\n                        await database.loadCities();\n\n                        expect(consoleWarnSpy).toHaveBeenCalledWith(\n                            'Ignored duplicate cities: Wellington',\n                        );\n                    });\n                });\n\n                clearCityDatabase();\n            ",
        [
          "jest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 506+24",
          "jest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 1719+19",
          "vitest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 506+24",
          "vitest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 1719+19",
          "jest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 1042+49",
          "jest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 1113+54",
          "vitest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 1042+49",
          "vitest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 1113+54",
        ],
      ],
      [
        "tsx",
        "fn(function() {\n\t\t\t   fn2(function() {\n\t\t\t     doThing().then(function() {\n\t\t\t       fn3(function() {\n\t\t\t         return Promise.resolve(4)\n\t\t\t       })\n\t\t\t       return Promise.resolve(4)\n\t\t\t     })\n\t\t\t   })\n\t\t\t })",
        [
          "jest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 0+215",
          "vitest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 0+215",
          "promise(no-return-wrap) | Avoid wrapping return values in Promise.resolve | Return the value being passed into Promise.resolve instead | 170+18",
          "promise(prefer-await-to-then) | Prefer await to then()/catch()/finally() | Use `await` with `try`/`catch` instead of promise chaining for more readable and maintainable async code. | 57+4",
          "promise(no-return-wrap) | Avoid wrapping return values in Promise.resolve | Return the value being passed into Promise.resolve instead | 121+18",
        ],
      ],
      [
        "tsx",
        "fn((() => {\n\t\t\t   fn2(function() {\n\t\t\t     doThing().then(function() {\n\t\t\t       fn3(function() {\n\t\t\t         return Promise.resolve(4)\n\t\t\t       })\n\t\t\t       return Promise.resolve(4)\n\t\t\t     })\n\t\t\t   }).bind(this)\n\t\t\t }))",
        [
          "jest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 0+223",
          "vitest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 0+223",
          "promise(no-return-wrap) | Avoid wrapping return values in Promise.resolve | Return the value being passed into Promise.resolve instead | 166+18",
          "promise(prefer-await-to-then) | Prefer await to then()/catch()/finally() | Use `await` with `try`/`catch` instead of promise chaining for more readable and maintainable async code. | 53+4",
          "promise(no-return-wrap) | Avoid wrapping return values in Promise.resolve | Return the value being passed into Promise.resolve instead | 117+18",
        ],
      ],
      [
        "tsx",
        "function foo() { hey.then(function() { }).then() }",
        [
          "promise(prefer-await-to-then) | Prefer await to then()/catch()/finally() | Use `await` with `try`/`catch` instead of promise chaining for more readable and maintainable async code. | 42+4",
          "promise(prefer-await-to-then) | Prefer await to then()/catch()/finally() | Use `await` with `try`/`catch` instead of promise chaining for more readable and maintainable async code. | 21+4",
        ],
      ],
      [
        "tsx",
        "function foo() { hey.then(function() { }).then(x).catch() }",
        [
          "promise(prefer-await-to-then) | Prefer await to then()/catch()/finally() | Use `await` with `try`/`catch` instead of promise chaining for more readable and maintainable async code. | 50+5",
          "promise(prefer-await-to-then) | Prefer await to then()/catch()/finally() | Use `await` with `try`/`catch` instead of promise chaining for more readable and maintainable async code. | 42+4",
          "promise(prefer-await-to-then) | Prefer await to then()/catch()/finally() | Use `await` with `try`/`catch` instead of promise chaining for more readable and maintainable async code. | 21+4",
        ],
      ],
      [
        "tsx",
        "async function a() { hey.then(function() { }).then(function() { }) }",
        [
          "promise(prefer-await-to-then) | Prefer await to then()/catch()/finally() | Use `await` with `try`/`catch` instead of promise chaining for more readable and maintainable async code. | 46+4",
          "promise(prefer-await-to-then) | Prefer await to then()/catch()/finally() | Use `await` with `try`/`catch` instead of promise chaining for more readable and maintainable async code. | 25+4",
        ],
      ],
      [
        "tsx",
        "function MyComponent() {\n          const local1 = someFunc();\n          function MyNestedComponent() {\n            const local2 = {};\n            useCallback(() => {\n              console.log(local1);\n              console.log(local2);\n            }, [local1]);\n          }\n        }",
        [
          "react(only-export-components) | Fast refresh only works when a file has exports. Move your component(s) to a separate file. |  | 9+11",
          "react(only-export-components) | Fast refresh only works when a file has exports. Move your component(s) to a separate file. |  | 81+17",
          "react-hooks(exhaustive-deps) | React Hook useCallback has an unnecessary dependency: local1. | Consider removing it from the dependency array. Outer scope values aren't valid dependencies because mutating them doesn't re-render the component. | 252+6",
          "react-hooks(exhaustive-deps) | React Hook useCallback has a missing dependency: 'local2' | Either include it or remove the dependency array. | 227+6 useCallback uses `local2` here | 251+8",
        ],
      ],
      [
        "tsx",
        "function MyComponent() {\n          const local = {};\n          useEffect(() => {\n            console.log(local);\n            console.log(local);\n          }, [local, local]);\n        }",
        [
          "react(only-export-components) | Fast refresh only works when a file has exports. Move your component(s) to a separate file. |  | 9+11",
          "react-hooks(exhaustive-deps) | This dependency is specified more than once in the dependency array. | Remove the duplicate dependency from the array. | 166+5",
          "react-hooks(exhaustive-deps) | React hook useEffect depends on `local`, which changes every render | Try memoizing this variable with `useRef` or `useCallback`. | 159+5 it will always cause this hook to re-evaluate | 41+5 `local` is declared here",
        ],
      ],
      [
        "tsx",
        "function MyComponent() {\n          useCallback(() => {}, [window]);\n        }",
        [
          "react(only-export-components) | Fast refresh only works when a file has exports. Move your component(s) to a separate file. |  | 9+11",
          "react-hooks(exhaustive-deps) | React Hook useCallback has an unnecessary dependency: window. | Consider removing it from the dependency array. Outer scope values aren't valid dependencies because mutating them doesn't re-render the component. | 58+6",
          "react-hooks(exhaustive-deps) | React Hook useCallback has unnecessary dependency: window | Either include it or remove the dependency array. | 57+8",
        ],
      ],
      [
        "tsx",
        "const MainView = () => {}; export default compose()(MainView);",
        [
          "react(only-export-components) | Fast refresh can't handle anonymous components. Add a name to your export. |  | 27+35",
          "react(only-export-components) | Fast refresh only works when a file only exports components. Move your component(s) to a separate file. |  | 6+8",
        ],
      ],
      [
        "tsx",
        "const MyComponent = () => {}; export default observer(MyComponent);",
        [
          "react(only-export-components) | Fast refresh can't handle anonymous components. Add a name to your export. |  | 30+37",
          "react(only-export-components) | Fast refresh only works when a file only exports components. Move your component(s) to a separate file. |  | 6+11",
        ],
      ],
      [
        "tsx",
        "const Root = () => <div />; export default { Root };",
        [
          "react(only-export-components) | Fast refresh can't handle anonymous components. Add a name to your export. |  | 28+24",
          "react(only-export-components) | Fast refresh only works when a file only exports components. Move your component(s) to a separate file. |  | 6+4",
        ],
      ],
      [
        "tsx",
        "foo.then(() => {\n                try {} catch (e) {}\n            }).catch(err => err);",
        [
          "jest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 0+85",
          "vitest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 0+85",
          'unicorn(catch-error-name) | The catch parameter "err" should be named "error" | Rename `err` to `error` | 74+3',
          "promise(prefer-await-to-then) | Prefer await to then()/catch()/finally() | Use `await` with `try`/`catch` instead of promise chaining for more readable and maintainable async code. | 68+5",
          "promise(prefer-await-to-then) | Prefer await to then()/catch()/finally() | Use `await` with `try`/`catch` instead of promise chaining for more readable and maintainable async code. | 4+4",
          'unicorn(catch-error-name) | The catch parameter "e" should be named "error" | Replace `e` with `error`. | 47+1',
        ],
      ],
      [
        "tsx",
        "class \u00barror extends Error {}",
        [
          "unicorn(custom-error-definition) | Invalid class name, use `\u00barrorError`. |  | 6+6",
          "unicorn(custom-error-definition) | The `name` property should be set to `\u00barror`. |  | 0+29",
        ],
      ],
      [
        "tsx",
        "class FooError extends Error {\n            constructor() {\n                super();\n                this.message = 'My custom message';\n            }\n        }",
        [
          "unicorn(custom-error-definition) | Pass the error message to `super()` instead of setting `this.message`. |  | 75+8",
          "unicorn(custom-error-definition) | The `name` property should be set to `FooError`. |  | 57+92",
        ],
      ],
      [
        "tsx",
        "class FooError extends Error {\n            constructor(message) {\n                super();\n                this.message = message;\n            }\n        }",
        [
          "unicorn(custom-error-definition) | Pass the error message to `super()` instead of setting `this.message`. |  | 82+8",
          "unicorn(custom-error-definition) | The `name` property should be set to `FooError`. |  | 64+80",
        ],
      ],
      [
        "tsx",
        'const foo = `${"\\ud834 foo"} \\ud834`;',
        [
          "unicorn(escape-case) | Use uppercase characters for the value of the escape sequence. | Replace ` \\ud834` with ` \\uD834`. | 28+7",
          'unicorn(escape-case) | Use uppercase characters for the value of the escape sequence. | Replace `"\\ud834 foo"` with `"\\uD834 foo"`. | 15+12',
        ],
      ],
      [
        "tsx",
        "array.length === 0 || array.every(Boolean) || array.length === 0",
        [
          "unicorn(no-useless-length-check) | Found a useless array length check | The empty check is useless as `Array#every()` returns `true` for an empty array. | 0+18",
          "unicorn(no-useless-length-check) | Found a useless array length check | The empty check is useless as `Array#every()` returns `true` for an empty array. | 46+18",
          "unicorn(no-useless-length-check) | Found a useless array length check | The empty check is useless as `Array#every()` returns `true` for an empty array. | 0+18",
        ],
      ],
      [
        "tsx",
        "array1.every(Boolean)\n            || (( array1.length === 0 || array2.length === 0 )) // Both useless\n            || array2.every(Boolean)",
        [
          "unicorn(no-useless-length-check) | Found a useless array length check | The empty check is useless as `Array#every()` returns `true` for an empty array. | 40+19",
          "unicorn(no-useless-length-check) | Found a useless array length check | The empty check is useless as `Array#every()` returns `true` for an empty array. | 63+19",
          "unicorn(no-useless-length-check) | Found a useless array length check | The empty check is useless as `Array#every()` returns `true` for an empty array. | 40+19",
        ],
      ],
      [
        "tsx",
        "\n        switch (foo) {\n            case a:\n            case (( b ))         :\n            default:\n                handleDefaultCase();\n                break;\n        }\n        ",
        [
          "unicorn(no-useless-switch-case) | Useless case in switch statement. | Consider removing this case or removing the `default` case. | 56+22",
          "unicorn(no-useless-switch-case) | Useless case in switch statement. | Consider removing this case or removing the `default` case. | 36+7",
        ],
      ],
      [
        "tsx",
        "\n        switch (foo) {\n            case a:\n            case b:\n                handleCaseAB();\n                break;\n            case d:\n            case d:\n            default:\n                handleDefaultCase();\n                break;\n        }\n        ",
        [
          "unicorn(no-useless-switch-case) | Useless case in switch statement. | Consider removing this case or removing the `default` case. | 151+7",
          "unicorn(no-useless-switch-case) | Useless case in switch statement. | Consider removing this case or removing the `default` case. | 131+7",
        ],
      ],
      [
        "tsx",
        "\n        switch (foo) {\n            case a:\n            case b:\n            default:\n                handleDefaultCase();\n                break;\n        }\n        ",
        [
          "unicorn(no-useless-switch-case) | Useless case in switch statement. | Consider removing this case or removing the `default` case. | 56+7",
          "unicorn(no-useless-switch-case) | Useless case in switch statement. | Consider removing this case or removing the `default` case. | 36+7",
        ],
      ],
      [
        "tsx",
        "const quz = array.filter(fn);\n            const [foo] = array.filter(quz[0]);\n            [{bar: baz}] = foo[\n                array.filter(fn)[0]\n            ].filter(\n                array.filter(fn).shift()\n            );",
        [
          "unicorn(prefer-array-find) | Prefer `find` over filtering and accessing the first result. | Use `find(predicate)` instead of `filter(predicate)[0]` or similar patterns. | 18+6",
          "unicorn(prefer-array-find) | Prefer `find` over filtering and accessing the first result. | Use `find(predicate)` instead of `filter(predicate)[0]` or similar patterns. | 62+6",
          "unicorn(prefer-array-find) | Prefer `find` over filtering and accessing the first result. | Use `find(predicate)` instead of `filter(predicate)[0]` or similar patterns. | 160+6",
          "unicorn(prefer-array-find) | Prefer `find` over filtering and accessing the first result. | Use `find(predicate)` instead of `filter(predicate)[0]` or similar patterns. | 132+6",
          "unicorn(prefer-array-find) | Prefer `find` over filtering and accessing the first result. | Use `find(predicate)` instead of `filter(predicate)[0]` or similar patterns. | 190+6",
        ],
      ],
      [
        "tsx",
        "node.appendChild(child).appendChild(grandchild);",
        [
          "jest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 0+47",
          "vitest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 0+47",
          "unicorn(prefer-dom-node-append) | Prefer `Node#append()` over `Node#appendChild()` for DOM nodes. | Replace `Node#appendChild()` with `Node#append()`. | 24+11",
          "unicorn(prefer-dom-node-append) | Prefer `Node#append()` over `Node#appendChild()` for DOM nodes. | Replace `Node#appendChild()` with `Node#append()`. | 5+11",
        ],
      ],
      [
        "tsx",
        'for (const div of document.body.getElementById("id").getElementsByClassName("class")) {\n                console.log(div.getElementsByTagName("div"));\n            }',
        [
          "unicorn(prefer-query-selector) | Prefer `.querySelectorAll()` over `.getElementsByClassName()`. | It's better to use the same method to query DOM elements. This helps keep consistency and it lends itself to future improvements (e.g. more specific selectors). | 53+22",
          "unicorn(prefer-query-selector) | Prefer `.querySelector()` over `.getElementById()`. | It's better to use the same method to query DOM elements. This helps keep consistency and it lends itself to future improvements (e.g. more specific selectors). | 32+14",
          "unicorn(prefer-query-selector) | Prefer `.querySelectorAll()` over `.getElementsByTagName()`. | It's better to use the same method to query DOM elements. This helps keep consistency and it lends itself to future improvements (e.g. more specific selectors). | 120+20",
        ],
      ],
      [
        "test.tsx",
        "\nconst foo = 'bar';\nconst bar = 'baz';\nit('foo', () => {\n  // stuff\n});\ntest('foo foo', () => {});\ntest('bar bar', () => {});\n\n// Nesting\n describe('other bar', () => {\n     const thing = 123;\n     test('is another bar w/ test', () => {\n     });\n     // With a comment\n     it('is another bar w/ it', () => {\n     });\n     test.skip('skipping', () => {}); // Another comment\n     it.skip('skipping too', () => {});\n });\n test\n   .skip('skippy skip', () => {});\n            ",
        [
          "jest(padding-around-test-blocks) | Missing padding before it block | Make sure there is an empty new line before the it block | 39+0",
          "vitest(padding-around-test-blocks) | Missing padding before it block | Make sure there is an empty new line before the it block | 39+0",
          "jest(padding-around-test-blocks) | Missing padding before it block | Make sure there is an empty new line before the it block | 274+0",
          "vitest(padding-around-test-blocks) | Missing padding before it block | Make sure there is an empty new line before the it block | 274+0",
          "jest(padding-around-test-blocks) | Missing padding before it block | Make sure there is an empty new line before the it block | 380+0",
          "vitest(padding-around-test-blocks) | Missing padding before it block | Make sure there is an empty new line before the it block | 380+0",
          "jest(padding-around-test-blocks) | Missing padding before test block | Make sure there is an empty new line before the test block | 72+0",
          "vitest(padding-around-test-blocks) | Missing padding before test block | Make sure there is an empty new line before the test block | 72+0",
          "jest(padding-around-test-blocks) | Missing padding before test block | Make sure there is an empty new line before the test block | 99+0",
          "vitest(padding-around-test-blocks) | Missing padding before test block | Make sure there is an empty new line before the test block | 99+0",
          "jest(padding-around-test-blocks) | Missing padding before test block | Make sure there is an empty new line before the test block | 198+0",
          "vitest(padding-around-test-blocks) | Missing padding before test block | Make sure there is an empty new line before the test block | 198+0",
          "jest(padding-around-test-blocks) | Missing padding before test block | Make sure there is an empty new line before the test block | 323+0",
          "vitest(padding-around-test-blocks) | Missing padding before test block | Make sure there is an empty new line before the test block | 323+0",
          "jest(padding-around-test-blocks) | Missing padding before test block | Make sure there is an empty new line before the test block | 421+0",
          "vitest(padding-around-test-blocks) | Missing padding before test block | Make sure there is an empty new line before the test block | 421+0",
        ],
      ],
      [
        "test.tsx",
        "\nconst foo = 'bar';\nconst bar = 'baz';\nit('foo', () => {\n  // stuff\n});\ntest('foo foo', () => {});\ntest('bar bar', () => {});\n\n// Nesting\ndescribe('other bar', () => {\n    const thing = 123;\n    test('is another bar w/ test', () => {\n    });\n    // With a comment\n    it('is another bar w/ it', () => {\n    });\n    test.skip('skipping', () => {}); // Another comment\n    it.skip('skipping too', () => {});\n});\ntest\n  .skip('skippy skip', () => {});\n        ",
        [
          "jest(padding-around-test-blocks) | Missing padding before it block | Make sure there is an empty new line before the it block | 39+0",
          "vitest(padding-around-test-blocks) | Missing padding before it block | Make sure there is an empty new line before the it block | 39+0",
          "jest(padding-around-test-blocks) | Missing padding before it block | Make sure there is an empty new line before the it block | 268+0",
          "vitest(padding-around-test-blocks) | Missing padding before it block | Make sure there is an empty new line before the it block | 268+0",
          "jest(padding-around-test-blocks) | Missing padding before it block | Make sure there is an empty new line before the it block | 371+0",
          "vitest(padding-around-test-blocks) | Missing padding before it block | Make sure there is an empty new line before the it block | 371+0",
          "jest(padding-around-test-blocks) | Missing padding before test block | Make sure there is an empty new line before the test block | 72+0",
          "vitest(padding-around-test-blocks) | Missing padding before test block | Make sure there is an empty new line before the test block | 72+0",
          "jest(padding-around-test-blocks) | Missing padding before test block | Make sure there is an empty new line before the test block | 99+0",
          "vitest(padding-around-test-blocks) | Missing padding before test block | Make sure there is an empty new line before the test block | 99+0",
          "jest(padding-around-test-blocks) | Missing padding before test block | Make sure there is an empty new line before the test block | 195+0",
          "vitest(padding-around-test-blocks) | Missing padding before test block | Make sure there is an empty new line before the test block | 195+0",
          "jest(padding-around-test-blocks) | Missing padding before test block | Make sure there is an empty new line before the test block | 315+0",
          "vitest(padding-around-test-blocks) | Missing padding before test block | Make sure there is an empty new line before the test block | 315+0",
          "jest(padding-around-test-blocks) | Missing padding before test block | Make sure there is an empty new line before the test block | 410+0",
          "vitest(padding-around-test-blocks) | Missing padding before test block | Make sure there is an empty new line before the test block | 410+0",
        ],
      ],
      [
        "test.tsx",
        "\n                aVariable\n                    .mockImplementation(() => Promise.reject(42))\n                    .mockImplementation(() => Promise.resolve(42))\n                    .mockReturnValue(Promise.reject(42))\n            ",
        [
          "jest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 17+199",
          "vitest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 17+199",
          'jest(prefer-mock-promise-shorthand) | Prefer mock resolved/rejected shorthands for promises. | Prefer "mockRejectedValue" | 181+15',
          'vitest(prefer-mock-promise-shorthand) | Prefer mock resolved/rejected shorthands for promises. | Prefer "mockRejectedValue" | 181+15',
          'jest(prefer-mock-promise-shorthand) | Prefer mock resolved/rejected shorthands for promises. | Prefer "mockResolvedValue" | 114+18',
          "jest(prefer-mock-return-shorthand) | Mock functions that return simple values should use `mockReturnValue/mockReturnValueOnce`. | Replace `mockImplementation` with `mockReturnValue`. | 114+18",
          'vitest(prefer-mock-promise-shorthand) | Prefer mock resolved/rejected shorthands for promises. | Prefer "mockResolvedValue" | 114+18',
          "vitest(prefer-mock-return-shorthand) | Mock functions that return simple values should use `mockReturnValue/mockReturnValueOnce`. | Replace `mockImplementation` with `mockReturnValue`. | 114+18",
          'jest(prefer-mock-promise-shorthand) | Prefer mock resolved/rejected shorthands for promises. | Prefer "mockRejectedValue" | 48+18',
          "jest(prefer-mock-return-shorthand) | Mock functions that return simple values should use `mockReturnValue/mockReturnValueOnce`. | Replace `mockImplementation` with `mockReturnValue`. | 48+18",
          'vitest(prefer-mock-promise-shorthand) | Prefer mock resolved/rejected shorthands for promises. | Prefer "mockRejectedValue" | 48+18',
          "vitest(prefer-mock-return-shorthand) | Mock functions that return simple values should use `mockReturnValue/mockReturnValueOnce`. | Replace `mockImplementation` with `mockReturnValue`. | 48+18",
        ],
      ],
      [
        "test.tsx",
        "\n                aVariable\n                    .mockReturnValueOnce(Promise.reject(42))\n                    .mockImplementation(() => Promise.resolve(42))\n                    .mockReturnValueOnce(Promise.reject(42))\n            ",
        [
          "jest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 17+198",
          "vitest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 17+198",
          'jest(prefer-mock-promise-shorthand) | Prefer mock resolved/rejected shorthands for promises. | Prefer "mockRejectedValueOnce" | 176+19',
          'vitest(prefer-mock-promise-shorthand) | Prefer mock resolved/rejected shorthands for promises. | Prefer "mockRejectedValueOnce" | 176+19',
          'jest(prefer-mock-promise-shorthand) | Prefer mock resolved/rejected shorthands for promises. | Prefer "mockResolvedValue" | 109+18',
          "jest(prefer-mock-return-shorthand) | Mock functions that return simple values should use `mockReturnValue/mockReturnValueOnce`. | Replace `mockImplementation` with `mockReturnValue`. | 109+18",
          'vitest(prefer-mock-promise-shorthand) | Prefer mock resolved/rejected shorthands for promises. | Prefer "mockResolvedValue" | 109+18',
          "vitest(prefer-mock-return-shorthand) | Mock functions that return simple values should use `mockReturnValue/mockReturnValueOnce`. | Replace `mockImplementation` with `mockReturnValue`. | 109+18",
          'jest(prefer-mock-promise-shorthand) | Prefer mock resolved/rejected shorthands for promises. | Prefer "mockRejectedValueOnce" | 48+19',
          'vitest(prefer-mock-promise-shorthand) | Prefer mock resolved/rejected shorthands for promises. | Prefer "mockRejectedValueOnce" | 48+19',
        ],
      ],
      [
        "test.tsx",
        "aVariable.mockImplementation(() => Promise.reject(42)).mockImplementation(() => Promise.resolve(42)).mockReturnValue(Promise.reject(42))",
        [
          "jest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 0+136",
          "vitest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 0+136",
          'jest(prefer-mock-promise-shorthand) | Prefer mock resolved/rejected shorthands for promises. | Prefer "mockRejectedValue" | 101+15',
          'vitest(prefer-mock-promise-shorthand) | Prefer mock resolved/rejected shorthands for promises. | Prefer "mockRejectedValue" | 101+15',
          'jest(prefer-mock-promise-shorthand) | Prefer mock resolved/rejected shorthands for promises. | Prefer "mockResolvedValue" | 55+18',
          "jest(prefer-mock-return-shorthand) | Mock functions that return simple values should use `mockReturnValue/mockReturnValueOnce`. | Replace `mockImplementation` with `mockReturnValue`. | 55+18",
          'vitest(prefer-mock-promise-shorthand) | Prefer mock resolved/rejected shorthands for promises. | Prefer "mockResolvedValue" | 55+18',
          "vitest(prefer-mock-return-shorthand) | Mock functions that return simple values should use `mockReturnValue/mockReturnValueOnce`. | Replace `mockImplementation` with `mockReturnValue`. | 55+18",
          'jest(prefer-mock-promise-shorthand) | Prefer mock resolved/rejected shorthands for promises. | Prefer "mockRejectedValue" | 10+18',
          "jest(prefer-mock-return-shorthand) | Mock functions that return simple values should use `mockReturnValue/mockReturnValueOnce`. | Replace `mockImplementation` with `mockReturnValue`. | 10+18",
          'vitest(prefer-mock-promise-shorthand) | Prefer mock resolved/rejected shorthands for promises. | Prefer "mockRejectedValue" | 10+18',
          "vitest(prefer-mock-return-shorthand) | Mock functions that return simple values should use `mockReturnValue/mockReturnValueOnce`. | Replace `mockImplementation` with `mockReturnValue`. | 10+18",
        ],
      ],
      [
        "test.tsx",
        'aVariable\n              .mockImplementation(() => 42)\n              .mockImplementation(async () => 42)\n              .mockImplementation(() => Promise.resolve(42))\n              .mockReturnValue("hello world")',
        [
          "jest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 0+210",
          "vitest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 0+210",
          'jest(prefer-mock-promise-shorthand) | Prefer mock resolved/rejected shorthands for promises. | Prefer "mockResolvedValue" | 119+18',
          "jest(prefer-mock-return-shorthand) | Mock functions that return simple values should use `mockReturnValue/mockReturnValueOnce`. | Replace `mockImplementation` with `mockReturnValue`. | 119+18",
          'vitest(prefer-mock-promise-shorthand) | Prefer mock resolved/rejected shorthands for promises. | Prefer "mockResolvedValue" | 119+18',
          "vitest(prefer-mock-return-shorthand) | Mock functions that return simple values should use `mockReturnValue/mockReturnValueOnce`. | Replace `mockImplementation` with `mockReturnValue`. | 119+18",
          "jest(prefer-mock-return-shorthand) | Mock functions that return simple values should use `mockReturnValue/mockReturnValueOnce`. | Replace `mockImplementation` with `mockReturnValue`. | 25+18",
          "vitest(prefer-mock-return-shorthand) | Mock functions that return simple values should use `mockReturnValue/mockReturnValueOnce`. | Replace `mockImplementation` with `mockReturnValue`. | 25+18",
        ],
      ],
      [
        "test.tsx",
        'aVariable\n              .mockImplementationOnce(() => Promise.reject(42))\n              .mockImplementation(() => "hello sunshine")\n              .mockReturnValueOnce(Promise.reject(42))',
        [
          "jest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 0+186",
          "vitest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 0+186",
          'jest(prefer-mock-promise-shorthand) | Prefer mock resolved/rejected shorthands for promises. | Prefer "mockRejectedValueOnce" | 147+19',
          'vitest(prefer-mock-promise-shorthand) | Prefer mock resolved/rejected shorthands for promises. | Prefer "mockRejectedValueOnce" | 147+19',
          "jest(prefer-mock-return-shorthand) | Mock functions that return simple values should use `mockReturnValue/mockReturnValueOnce`. | Replace `mockImplementation` with `mockReturnValue`. | 89+18",
          "vitest(prefer-mock-return-shorthand) | Mock functions that return simple values should use `mockReturnValue/mockReturnValueOnce`. | Replace `mockImplementation` with `mockReturnValue`. | 89+18",
          'jest(prefer-mock-promise-shorthand) | Prefer mock resolved/rejected shorthands for promises. | Prefer "mockRejectedValueOnce" | 25+22',
          "jest(prefer-mock-return-shorthand) | Mock functions that return simple values should use `mockReturnValue/mockReturnValueOnce`. | Replace `mockImplementationOnce` with `mockReturnValueOnce`. | 25+22",
          'vitest(prefer-mock-promise-shorthand) | Prefer mock resolved/rejected shorthands for promises. | Prefer "mockRejectedValueOnce" | 25+22',
          "vitest(prefer-mock-return-shorthand) | Mock functions that return simple values should use `mockReturnValue/mockReturnValueOnce`. | Replace `mockImplementationOnce` with `mockReturnValueOnce`. | 25+22",
        ],
      ],
      [
        "test.tsx",
        "\n                import { database, isCity } from '../database';\n                import { loadCities } from '../api';\n\n                jest.mock('../api');\n\n                const initializeCityDatabase = () => {\n                    database.addCity('Vienna');\n                    database.addCity('San Juan');\n                    database.addCity('Wellington');\n                };\n\n                const clearCityDatabase = () => {\n                    database.clear();\n                };\n\n                initializeCityDatabase();\n\n                test('that persists cities', () => {\n                    expect(database.cities.length).toHaveLength(3);\n                });\n\n                test('city database has Vienna', () => {\n                    expect(isCity('Vienna')).toBeTruthy();\n                });\n\n                test('city database has San Juan', () => {\n                    expect(isCity('San Juan')).toBeTruthy();\n                });\n\n                describe('when loading cities from the api', () => {\n                    let consoleWarnSpy = jest.spyOn(console, 'warn');\n\n                    loadCities.mockResolvedValue(['Wellington', 'London']);\n\n                    it('does not duplicate cities', async () => {\n                        await database.loadCities();\n\n                        expect(database.cities).toHaveLength(4);\n                    });\n\n                    it('logs any duplicates', async () => {\n                        await database.loadCities();\n\n                        expect(consoleWarnSpy).toHaveBeenCalledWith(\n                            'Ignored duplicate cities: Wellington',\n                        );\n                    });\n                });\n\n                clearCityDatabase();\n            ",
        [
          "jest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 506+24",
          "jest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 1719+19",
          "vitest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 506+24",
          "vitest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 1719+19",
          "jest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 1042+49",
          "jest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 1113+54",
          "vitest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 1042+49",
          "vitest(require-hook) | Require setup and teardown code to be within a hook. | This should be done within a hook | 1113+54",
        ],
      ],
      [
        "test.tsx",
        "import { describe, it, test } from 'vitest';\ndescribe.todo.each([])('a', () => {}); it.todo.each([])('b', () => {}); test.only.todo('c'); it.only.todo('d'); describe.only.todo('e');",
        [
          "vitest(warn-todo) | The use of `.todo` is not recommended. | Write an actual test and remove the `.todo` modifier before pushing/merging your changes. | 54+4",
          "vitest(warn-todo) | The use of `.todo` is not recommended. | Write an actual test and remove the `.todo` modifier before pushing/merging your changes. | 171+4",
          "jest(padding-around-test-blocks) | Missing padding before it block | Make sure there is an empty new line before the it block | 84+0",
          "vitest(padding-around-test-blocks) | Missing padding before it block | Make sure there is an empty new line before the it block | 84+0",
          "vitest(warn-todo) | The use of `.todo` is not recommended. | Write an actual test and remove the `.todo` modifier before pushing/merging your changes. | 87+4",
          "jest(padding-around-test-blocks) | Missing padding before it block | Make sure there is an empty new line before the it block | 138+0",
          "vitest(padding-around-test-blocks) | Missing padding before it block | Make sure there is an empty new line before the it block | 138+0",
          "vitest(warn-todo) | The use of `.todo` is not recommended. | Write an actual test and remove the `.todo` modifier before pushing/merging your changes. | 146+4",
          "jest(padding-around-test-blocks) | Missing padding before test block | Make sure there is an empty new line before the test block | 117+0",
          "vitest(padding-around-test-blocks) | Missing padding before test block | Make sure there is an empty new line before the test block | 117+0",
          "vitest(warn-todo) | The use of `.todo` is not recommended. | Write an actual test and remove the `.todo` modifier before pushing/merging your changes. | 127+4",
        ],
      ],
    ],
  ],
  [
    "no-magic-numbers reports the keys of patterns, not those of object literals",
    { "categories": { "correctness": "off" }, "rules": { "no-magic-numbers": "error" } },
    [
      [
        "js ts",
        "const { 5: k } = v; k;",
        [
          "eslint(no-magic-numbers) | No magic number: 5 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 8+1",
        ],
      ],
      [
        "js ts",
        "let k; ({ 5: k } = v);",
        [
          "eslint(no-magic-numbers) | No magic number: 5 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 10+1",
        ],
      ],
      [
        "js ts",
        "for (const { 5: k, 6: w } of v) k, w;",
        [
          "eslint(no-magic-numbers) | No magic number: 5 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 13+1",
          "eslint(no-magic-numbers) | No magic number: 6 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 19+1",
        ],
      ],
      [
        "js ts",
        "function f({ 5: k }) { return k; }",
        [
          "eslint(no-magic-numbers) | No magic number: 5 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 13+1",
        ],
      ],
      [
        "js ts",
        "const { [5]: k } = v; k;",
        [
          "eslint(no-magic-numbers) | No magic number: 5 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 9+1",
        ],
      ],
      [
        "js ts",
        "let k; ({ [5]: k } = v);",
        [
          "eslint(no-magic-numbers) | No magic number: 5 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 11+1",
        ],
      ],
      [
        "js ts",
        "const { a: { 5: k } } = v; k;",
        [
          "eslint(no-magic-numbers) | No magic number: 5 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 13+1",
        ],
      ],
      [
        "js ts",
        "let k; ({ a: { 5: k } } = v);",
        [
          "eslint(no-magic-numbers) | No magic number: 5 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 15+1",
        ],
      ],
      [
        "js ts",
        "let k; [{ 5: k }] = v;",
        [
          "eslint(no-magic-numbers) | No magic number: 5 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 10+1",
        ],
      ],
      ["js ts", "const o = { 5: v }; o;", []],
      ["js ts", "const o = { [5]: v }; o;", []],
      [
        "js ts",
        "const { 5n: k } = v; k;",
        [
          "eslint(no-magic-numbers) | No magic number: 5n | Use a named constant instead of a magic number to make the code more readable and maintainable. | 8+2",
        ],
      ],
      [
        "js ts",
        "const { 5: k = 7 } = v; k;",
        [
          "eslint(no-magic-numbers) | No magic number: 5 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 8+1",
          "eslint(no-magic-numbers) | No magic number: 7 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 15+1",
        ],
      ],
      [
        "js ts",
        "let k; ({ 5: k = 7 } = v);",
        [
          "eslint(no-magic-numbers) | No magic number: 5 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 10+1",
          "eslint(no-magic-numbers) | No magic number: 7 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 17+1",
        ],
      ],
      [
        "js ts",
        "let k; ({ 5: k.a } = v);",
        [
          "eslint(no-magic-numbers) | No magic number: 5 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 10+1",
        ],
      ],
      [
        "js ts",
        "const { 0: k, 1: w } = v; k, w;",
        [
          "eslint(no-magic-numbers) | No magic number: 0 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 8+1",
          "eslint(no-magic-numbers) | No magic number: 1 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 14+1",
        ],
      ],
      [
        "js ts",
        "for ({ 5: k } of v);",
        [
          "eslint(no-magic-numbers) | No magic number: 5 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 7+1",
        ],
      ],
      [
        "js ts",
        "let k; ({ 5: k, ...r } = v);",
        [
          "eslint(no-magic-numbers) | No magic number: 5 | Use a named constant instead of a magic number to make the code more readable and maintainable. | 10+1",
        ],
      ],
    ],
  ],
  [
    "no-unused-vars does not count JSX as a use of React",
    { "categories": { "correctness": "off" }, "rules": { "no-unused-vars": "error" } },
    [
      [
        "jsx tsx",
        "var React;\nconst C = () => <D />;\nexport { C };",
        [
          "eslint(no-unused-vars) | Variable 'React' is declared but never used. Unused variables should start with a '_'. | Consider removing this declaration. | 4+5 'React' is declared here",
        ],
      ],
      ["jsx tsx", 'import React from "react";\n<A />;', []],
      ["jsx tsx", 'import * as React from "react";\n<A />;', []],
      ["jsx tsx", 'import { React } from "react";\n<A />;', []],
      [
        "jsx tsx",
        'import React from "react";\nfunction g() { var React; return <B />; }\ng();',
        [
          "eslint(no-unused-vars) | Variable 'React' is declared but never used. Unused variables should start with a '_'. | Consider removing this declaration. | 46+5 'React' is declared here",
        ],
      ],
      [
        "jsx tsx",
        'const React = require("react");\n<A />;',
        [
          "eslint(no-unused-vars) | Variable 'React' is declared but never used. Unused variables should start with a '_'. | Consider removing this declaration. | 6+5 'React' is declared here",
        ],
      ],
      [
        "jsx tsx",
        "function React() {}\n<A />;",
        [
          "eslint(no-unused-vars) | Function 'React' is declared but never used. | Consider removing this declaration. | 9+5 'React' is declared here",
        ],
      ],
      [
        "jsx tsx",
        "class React {}\n<A />;",
        [
          "eslint(no-unused-vars) | Class 'React' is declared but never used. | Consider removing this declaration. | 6+5 'React' is declared here",
        ],
      ],
      ["jsx tsx", 'import React from "react";\nfoo();', []],
      [
        "jsx tsx",
        "function f(React) { return <A />; }\nf();",
        [
          "eslint(no-unused-vars) | Parameter 'React' is declared but never used. Unused parameters should start with a '_'. | Consider removing this parameter. | 11+5 'React' is declared here",
        ],
      ],
      [
        "jsx tsx",
        "let React = 1;\n<></>;",
        [
          "eslint(no-unused-vars) | Variable 'React' is declared but never used. Unused variables should start with a '_'. | Consider removing this declaration. | 4+5 'React' is declared here",
        ],
      ],
      [
        "tsx",
        'import type React from "react";\n<A />;',
        [
          "eslint(no-unused-vars) | Type 'React' is imported but never used. | Consider removing this import. | 12+5 'React' is imported here",
        ],
      ],
      ["tsx", 'import React = require("react");\n<A />;', []],
    ],
  ],
  [
    "no-shadow passes over what is in a declare of a definition file",
    { "categories": { "correctness": "off" }, "rules": { "no-shadow": "error" } },
    [
      ["d.ts", 'declare module "m" { export function f(): void; export namespace n { function f(): void; } }', []],
      ["d.ts", 'declare module "m" { type T = 1; namespace n { type T = 2; } }', []],
      ["d.ts", 'declare module "m" { const c: 1; namespace n { const c: 2; } }', []],
      ["d.ts", "declare namespace a { interface I {} namespace b { interface I {} } }", []],
      ["d.ts", "declare const x: 1; declare function g(x: number): void;", []],
      ["d.ts", "declare const x: 1; declare namespace n { function g(x: number): void; }", []],
      [
        "d.ts",
        "namespace a { const y = 1; namespace b { const y = 2; } }",
        [
          "eslint(no-shadow) | 'y' is already declared in the upper scope. | Consider renaming 'y' to avoid shadowing the variable from the outer scope. | 47+1 'y' is declared here | 20+1 shadowed declaration is here",
        ],
      ],
      [
        "d.ts",
        "export const z: 1; export namespace n { const z: 2; }",
        [
          "eslint(no-shadow) | 'z' is already declared in the upper scope. | Consider renaming 'z' to avoid shadowing the variable from the outer scope. | 46+1 'z' is declared here | 13+1 shadowed declaration is here",
        ],
      ],
      ["d.ts", "declare class C { m(C: number): void }", []],
      [
        "ts",
        'declare module "m" { export function f(): void; export namespace n { function f(): void; } }',
        [
          "eslint(no-shadow) | 'f' is already declared in the upper scope. | Consider renaming 'f' to avoid shadowing the variable from the outer scope. | 78+1 'f' is declared here | 37+1 shadowed declaration is here",
        ],
      ],
      [
        "ts",
        "declare namespace a { const y: 1; namespace b { const y: 2; } }",
        [
          "eslint(no-shadow) | 'y' is already declared in the upper scope. | Consider renaming 'y' to avoid shadowing the variable from the outer scope. | 54+1 'y' is declared here | 28+1 shadowed declaration is here",
        ],
      ],
      [
        "ts",
        "namespace a { const y = 1; namespace b { const y = 2; } }",
        [
          "eslint(no-shadow) | 'y' is already declared in the upper scope. | Consider renaming 'y' to avoid shadowing the variable from the outer scope. | 47+1 'y' is declared here | 20+1 shadowed declaration is here",
        ],
      ],
    ],
  ],
  [
    "a byte order mark is part of the first line and of the program",
    {
      "categories": { "correctness": "off" },
      "plugins": ["unicorn"],
      "rules": { "unicorn/no-empty-file": "error", "no-inline-comments": "error" },
    },
    [
      [
        "js",
        "\ufeff",
        ["unicorn(no-empty-file) | Empty files are not allowed. | Delete this file or add some code to it. | 0+4"],
      ],
      [
        "js",
        "\ufeff// c",
        [
          "eslint(no-inline-comments) | Unexpected comment inline with code | Move the comment to a separate line | 3+4",
          "unicorn(no-empty-file) | Empty files are not allowed. | Delete this file or add some code to it. | 0+8",
        ],
      ],
      [
        "js",
        "\ufeff  \n",
        ["unicorn(no-empty-file) | Empty files are not allowed. | Delete this file or add some code to it. | 0+7"],
      ],
      [
        "js",
        "\ufeff;",
        ["unicorn(no-empty-file) | Empty files are not allowed. | Delete this file or add some code to it. | 0+5"],
      ],
      [
        "js",
        "\ufeff{}",
        ["unicorn(no-empty-file) | Empty files are not allowed. | Delete this file or add some code to it. | 0+6"],
      ],
      [
        "js",
        '\ufeff"use strict";',
        ["unicorn(no-empty-file) | Empty files are not allowed. | Delete this file or add some code to it. | 0+17"],
      ],
      [
        "js",
        "",
        ["unicorn(no-empty-file) | Empty files are not allowed. | Delete this file or add some code to it. | 0+1"],
      ],
      [
        "js",
        "// c",
        ["unicorn(no-empty-file) | Empty files are not allowed. | Delete this file or add some code to it. | 0+5"],
      ],
      [
        "js",
        "\ufeff// c\nfoo();",
        [
          "eslint(no-inline-comments) | Unexpected comment inline with code | Move the comment to a separate line | 3+4",
        ],
      ],
      [
        "js",
        "\ufeff  // c\nfoo();",
        [
          "eslint(no-inline-comments) | Unexpected comment inline with code | Move the comment to a separate line | 5+4",
        ],
      ],
      [
        "js",
        "\ufeff/* c */ foo();",
        [
          "eslint(no-inline-comments) | Unexpected comment inline with code | Move the comment to a separate line | 3+7",
        ],
      ],
      [
        "js",
        "\ufefffoo(); // c",
        [
          "eslint(no-inline-comments) | Unexpected comment inline with code | Move the comment to a separate line | 10+4",
        ],
      ],
      ["js", "\ufeff\n// c\nfoo();", []],
      ["js", "// c\nfoo();", []],
      [
        "js",
        "\ufeff// xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        [
          "eslint(no-inline-comments) | Unexpected comment inline with code | Move the comment to a separate line | 3+123",
          "unicorn(no-empty-file) | Empty files are not allowed. | Delete this file or add some code to it. | 0+100",
        ],
      ],
    ],
  ],
  [
    "vitest/prefer-importing-vitest-globals lists the names in the order of oxlint's hash table",
    {
      "categories": { "correctness": "off" },
      "plugins": ["vitest"],
      "rules": { "vitest/prefer-importing-vitest-globals": "error" },
    },
    [
      [
        "test.js",
        'describe("a", () => { test("b", () => { expect(1).toBe(1); }); });',
        [
          "vitest(prefer-importing-vitest-globals) | Do not use Vitest global functions | Import global functions `expect, test, describe` from `vitest` package instead of using globals. | 22+4 Add this global vitest import | 40+6 Add this global vitest import | 0+8 Add this global vitest import",
        ],
      ],
      [
        "test.js",
        'test("b", () => { expect(1).toBe(1); });',
        [
          "vitest(prefer-importing-vitest-globals) | Do not use Vitest global functions | Import global functions `expect, test` from `vitest` package instead of using globals. | 0+4 Add this global vitest import | 18+6 Add this global vitest import",
        ],
      ],
      [
        "test.js",
        'expect(1).toBe(1); test("b", () => {}); describe("a", () => {});',
        [
          "vitest(prefer-importing-vitest-globals) | Do not use Vitest global functions | Import global functions `expect, test, describe` from `vitest` package instead of using globals. | 19+4 Add this global vitest import | 0+6 Add this global vitest import | 40+8 Add this global vitest import",
        ],
      ],
      [
        "test.js",
        'describe("a", () => {}); test("b", () => {});',
        [
          "vitest(prefer-importing-vitest-globals) | Do not use Vitest global functions | Import global functions `describe, test` from `vitest` package instead of using globals. | 25+4 Add this global vitest import | 0+8 Add this global vitest import",
        ],
      ],
      [
        "test.js",
        'describe("a", () => {}); expect(1);',
        [
          "vitest(prefer-importing-vitest-globals) | Do not use Vitest global functions | Import global functions `expect, describe` from `vitest` package instead of using globals. | 25+6 Add this global vitest import | 0+8 Add this global vitest import",
        ],
      ],
      [
        "test.js",
        'it("a", () => {}); expect(1); vi.fn(); beforeEach(() => {});',
        [
          "vitest(prefer-importing-vitest-globals) | Do not use Vitest global functions | Import global functions `beforeEach, vi, expect, it` from `vitest` package instead of using globals. | 0+2 Add this global vitest import | 19+6 Add this global vitest import | 39+10 Add this global vitest import",
        ],
      ],
      [
        "test.js",
        'const path = require("node:path"); describe("a", () => { test("b", () => { expect(1).toBe(1); }); });',
        [
          "vitest(prefer-importing-vitest-globals) | Do not use Vitest global functions | Import global functions `describe, test, expect` from `vitest` package instead of using globals. | 35+8 Add this global vitest import | 57+4 Add this global vitest import | 75+6 Add this global vitest import",
        ],
      ],
      [
        "test.js",
        'const path = require("node:path"); const o = process.x; describe("a", () => { test("b", () => { expect(1).toBe(1); }); });',
        [
          "vitest(prefer-importing-vitest-globals) | Do not use Vitest global functions | Import global functions `describe, test, expect` from `vitest` package instead of using globals. | 56+8 Add this global vitest import | 78+4 Add this global vitest import | 96+6 Add this global vitest import",
        ],
      ],
      [
        "test.js",
        'import { describe, test, expect } from "bun:test";\ndescribe("a", () => { test("b", () => { expect(1).toBe(1); }); });',
        [
          "vitest(prefer-importing-vitest-globals) | Do not use Vitest global functions | Import global functions `describe, expect, test` from `vitest` package instead of using globals. | 51+65 Add this global vitest import | 91+9 Add this global vitest import | 73+39 Add this global vitest import",
        ],
      ],
      [
        "test.js",
        'import { test, describe, expect } from "bun:test";\ndescribe("a", () => { test("b", () => { expect(1).toBe(1); }); });',
        [
          "vitest(prefer-importing-vitest-globals) | Do not use Vitest global functions | Import global functions `describe, expect, test` from `vitest` package instead of using globals. | 51+65 Add this global vitest import | 91+9 Add this global vitest import | 73+39 Add this global vitest import",
        ],
      ],
      [
        "test.js",
        'import { expect, test, describe } from "bun:test";\ndescribe("a", () => { test("b", () => { expect(1).toBe(1); }); });',
        [
          "vitest(prefer-importing-vitest-globals) | Do not use Vitest global functions | Import global functions `describe, expect, test` from `vitest` package instead of using globals. | 51+65 Add this global vitest import | 91+9 Add this global vitest import | 73+39 Add this global vitest import",
        ],
      ],
      [
        "test.js",
        'import { describe, expect } from "bun:test";\ndescribe("a", () => { expect(1).toBe(1); });',
        [
          "vitest(prefer-importing-vitest-globals) | Do not use Vitest global functions | Import global functions `describe, expect` from `vitest` package instead of using globals. | 45+43 Add this global vitest import | 67+9 Add this global vitest import",
        ],
      ],
      [
        "test.js",
        'import { test, expect } from "bun:test";\ntest("b", () => { expect(1).toBe(1); });',
        [
          "vitest(prefer-importing-vitest-globals) | Do not use Vitest global functions | Import global functions `expect, test` from `vitest` package instead of using globals. | 59+9 Add this global vitest import | 41+39 Add this global vitest import",
        ],
      ],
      [
        "test.js",
        'import { describe, test } from "bun:test";\ndescribe("a", () => { test("b", () => {}); });',
        [
          "vitest(prefer-importing-vitest-globals) | Do not use Vitest global functions | Import global functions `describe, test` from `vitest` package instead of using globals. | 43+45 Add this global vitest import | 65+19 Add this global vitest import",
        ],
      ],
      [
        "test.js",
        'import { it, vi, expect, beforeEach } from "bun:test";\nit("a", () => {}); expect(1); vi(); beforeEach(() => {});',
        [
          "vitest(prefer-importing-vitest-globals) | Do not use Vitest global functions | Import global functions `beforeEach, vi, expect, it` from `vitest` package instead of using globals. | 91+20 Add this global vitest import | 74+9 Add this global vitest import | 55+17 Add this global vitest import | 85+4 Add this global vitest import",
        ],
      ],
      [
        "test.js",
        'import { describe, test } from "bun:test";\ndescribe("a", () => { test("b", () => { expect(1); }); });',
        [
          "vitest(prefer-importing-vitest-globals) | Do not use Vitest global functions | Import global functions `expect, describe, test` from `vitest` package instead of using globals. | 83+6 Add this global vitest import | 43+57 Add this global vitest import | 65+31 Add this global vitest import",
        ],
      ],
      [
        "test.js",
        'import { describe, test, expect } from "bun:test";\ndescribe("a", () => { test("b", () => { expect(1).toBe(1); }); test("c", () => {}); });',
        [
          "vitest(prefer-importing-vitest-globals) | Do not use Vitest global functions | Import global functions `test, describe, expect` from `vitest` package instead of using globals. | 51+86 Add this global vitest import | 91+9 Add this global vitest import | 73+39 Add this global vitest import | 114+19 Add this global vitest import",
        ],
      ],
      [
        "test.js",
        'import { describe, test, expect } from "bun:test";\ndescribe("a", () => { test("b", () => { expect(1).toBe(1); expect(2).toBe(2); }); });',
        [
          "vitest(prefer-importing-vitest-globals) | Do not use Vitest global functions | Import global functions `describe, expect, test` from `vitest` package instead of using globals. | 51+84 Add this global vitest import | 91+9 Add this global vitest import | 110+9 Add this global vitest import | 73+58 Add this global vitest import",
        ],
      ],
      [
        "test.js",
        'import { describe, test, expect } from "bun:test";\ndescribe("a", () => { test("b", () => { expect(1).toBe(1); }); }); describe("d", () => {});',
        [
          "vitest(prefer-importing-vitest-globals) | Do not use Vitest global functions | Import global functions `describe, expect, test` from `vitest` package instead of using globals. | 51+65 Add this global vitest import | 118+23 Add this global vitest import | 91+9 Add this global vitest import | 73+39 Add this global vitest import",
        ],
      ],
      [
        "test.js",
        'import { test, expect } from "bun:test";\ntest("b", () => { expect(1).toBe(1); }); test("c", () => {});',
        [
          "vitest(prefer-importing-vitest-globals) | Do not use Vitest global functions | Import global functions `expect, test` from `vitest` package instead of using globals. | 59+9 Add this global vitest import | 41+39 Add this global vitest import | 82+19 Add this global vitest import",
        ],
      ],
    ],
  ],
  [
    "react/refs says where a helper gets at the ref",
    { "categories": { "correctness": "off" }, "plugins": ["react"], "rules": { "react/refs": "error" } },
    [
      [
        "jsx",
        'import { useRef, useCallback } from "react";\nexport function C() { const ref = useRef(0); const g1 = () => ref.current; const g2 = () => g1(); return <div>{g2()}</div>; }',
        [
          "react(refs) | Cannot access refs during render | React refs are values that are not needed for rendering. Refs should only be accessed outside of render, such as in event handlers or effects. Accessing a ref value (the `current` property) during render can cause your component not to update as expected | 156+2 This function accesses a ref value | 137+2 The ref is accessed here",
          "react(refs) | Cannot access refs during render | React refs are values that are not needed for rendering. Refs should only be accessed outside of render, such as in event handlers or effects. Accessing a ref value (the `current` property) during render can cause your component not to update as expected | 156+4 Cannot access ref value during render",
        ],
      ],
      [
        "jsx",
        'import { useRef, useCallback } from "react";\nexport function C() { const ref = useRef(0); const g1 = () => ref.current; const g2 = () => g1(); const g3 = () => g2(); return <div>{g3()}</div>; }',
        [
          "react(refs) | Cannot access refs during render | React refs are values that are not needed for rendering. Refs should only be accessed outside of render, such as in event handlers or effects. Accessing a ref value (the `current` property) during render can cause your component not to update as expected | 179+2 This function accesses a ref value | 160+2 The ref is accessed here",
          "react(refs) | Cannot access refs during render | React refs are values that are not needed for rendering. Refs should only be accessed outside of render, such as in event handlers or effects. Accessing a ref value (the `current` property) during render can cause your component not to update as expected | 179+4 Cannot access ref value during render",
        ],
      ],
      [
        "jsx",
        'import { useRef, useCallback } from "react";\nexport function C() { const ref = useRef(0); const g1 = () => ref.current; const g2 = () => { g1(); return ref.current; }; return <div>{g2()}</div>; }',
        [
          "react(refs) | Cannot access refs during render | React refs are values that are not needed for rendering. Refs should only be accessed outside of render, such as in event handlers or effects. Accessing a ref value (the `current` property) during render can cause your component not to update as expected | 181+2 This function accesses a ref value | 139+2 The ref is accessed here",
          "react(refs) | Cannot access refs during render | React refs are values that are not needed for rendering. Refs should only be accessed outside of render, such as in event handlers or effects. Accessing a ref value (the `current` property) during render can cause your component not to update as expected | 181+4 Cannot access ref value during render",
        ],
      ],
      [
        "jsx",
        'import { useRef, useCallback } from "react";\nexport function C() { const ref = useRef(0); const g1 = () => ref.current; const g2 = () => { const a = ref.current; return g1() + a; }; return <div>{g2()}</div>; }',
        [
          "react(refs) | Cannot access refs during render | React refs are values that are not needed for rendering. Refs should only be accessed outside of render, such as in event handlers or effects. Accessing a ref value (the `current` property) during render can cause your component not to update as expected | 195+2 This function accesses a ref value | 169+2 The ref is accessed here",
        ],
      ],
      [
        "jsx",
        'import { useRef, useCallback } from "react";\nexport function C() { const ref = useRef(0); function g1() { return ref.current; } function g2() { return g1(); } return <div>{g2()}</div>; }',
        [
          "react(refs) | Cannot access refs during render | React refs are values that are not needed for rendering. Refs should only be accessed outside of render, such as in event handlers or effects. Accessing a ref value (the `current` property) during render can cause your component not to update as expected | 172+2 This function accesses a ref value | 151+2 The ref is accessed here",
          "react(refs) | Cannot access refs during render | React refs are values that are not needed for rendering. Refs should only be accessed outside of render, such as in event handlers or effects. Accessing a ref value (the `current` property) during render can cause your component not to update as expected | 172+4 Cannot access ref value during render",
        ],
      ],
      [
        "jsx",
        'import { useRef, useCallback } from "react";\nexport function C() { const ref = useRef(0); const g1 = () => ref.current; const g2 = () => h(g1()); return <div>{g2()}</div>; }',
        [
          "react(refs) | Cannot access refs during render | React refs are values that are not needed for rendering. Refs should only be accessed outside of render, such as in event handlers or effects. Accessing a ref value (the `current` property) during render can cause your component not to update as expected | 159+2 This function accesses a ref value | 139+2 The ref is accessed here",
        ],
      ],
      [
        "jsx",
        'import { useRef, useCallback } from "react";\nexport function C() { const ref = useRef(0); const g1 = () => ref.current; const g2 = () => h(g1); return <div>{g2()}</div>; }',
        [
          "react(refs) | Cannot access refs during render | React refs are values that are not needed for rendering. Refs should only be accessed outside of render, such as in event handlers or effects. Accessing a ref value (the `current` property) during render can cause your component not to update as expected | 157+2 This function accesses a ref value | 139+2 The ref is accessed here",
        ],
      ],
      [
        "jsx",
        'import { useRef, useCallback } from "react";\nexport function C() { const ref = useRef(0); const g1 = useCallback(() => ref.current, []); const g2 = () => g1(); return <div>{g2()}</div>; }',
        [
          "react(refs) | Cannot access refs during render | React refs are values that are not needed for rendering. Refs should only be accessed outside of render, such as in event handlers or effects. Accessing a ref value (the `current` property) during render can cause your component not to update as expected | 173+2 This function accesses a ref value | 154+2 The ref is accessed here",
          "react(refs) | Cannot access refs during render | React refs are values that are not needed for rendering. Refs should only be accessed outside of render, such as in event handlers or effects. Accessing a ref value (the `current` property) during render can cause your component not to update as expected | 173+4 Cannot access ref value during render",
        ],
      ],
      [
        "jsx",
        'import { useRef, useCallback } from "react";\nexport function C() { const ref = useRef(0); const g0 = () => 1; const g1 = () => ref.current; const g2 = () => g0() + g1(); return <div>{g2()}</div>; }',
        [
          "react(refs) | Cannot access refs during render | React refs are values that are not needed for rendering. Refs should only be accessed outside of render, such as in event handlers or effects. Accessing a ref value (the `current` property) during render can cause your component not to update as expected | 183+2 This function accesses a ref value | 164+2 The ref is accessed here",
        ],
      ],
      [
        "jsx",
        'import { useRef, useCallback } from "react";\nexport function C() { const ref = useRef(0); const o = { g1: () => ref.current }; const g2 = () => o.g1(); return <div>{g2()}</div>; }',
        [
          "react(refs) | Cannot access refs during render | React refs are values that are not needed for rendering. Refs should only be accessed outside of render, such as in event handlers or effects. Accessing a ref value (the `current` property) during render can cause your component not to update as expected | 165+2 This function accesses a ref value | 144+4 The ref is accessed here",
        ],
      ],
      [
        "jsx",
        'import { useRef, useCallback } from "react";\nexport function C() { const ref = useRef(0); const g2 = () => { const a = ref.current; return a; }; return <div>{g2()}</div>; }',
        [
          "react(refs) | Cannot access refs during render | React refs are values that are not needed for rendering. Refs should only be accessed outside of render, such as in event handlers or effects. Accessing a ref value (the `current` property) during render can cause your component not to update as expected | 158+2 This function accesses a ref value | 119+11 The ref is accessed here",
          "react(refs) | Cannot access refs during render | React refs are values that are not needed for rendering. Refs should only be accessed outside of render, such as in event handlers or effects. Accessing a ref value (the `current` property) during render can cause your component not to update as expected | 158+4 Cannot access ref value during render",
        ],
      ],
      [
        "jsx",
        'import { useRef, useCallback } from "react";\nexport function C() { const ref = useRef(0); const g2 = () => { const a = ref.current; return a + 1; }; return <div>{g2()}</div>; }',
        [
          "react(refs) | Cannot access refs during render | React refs are values that are not needed for rendering. Refs should only be accessed outside of render, such as in event handlers or effects. Accessing a ref value (the `current` property) during render can cause your component not to update as expected | 162+2 This function accesses a ref value | 119+11 The ref is accessed here",
        ],
      ],
      [
        "jsx",
        'import { useRef, useCallback } from "react";\nexport function C() { const ref = useRef(0); const g2 = () => { const a = ref.current; h(a); }; return <div>{g2()}</div>; }',
        [
          "react(refs) | Cannot access refs during render | React refs are values that are not needed for rendering. Refs should only be accessed outside of render, such as in event handlers or effects. Accessing a ref value (the `current` property) during render can cause your component not to update as expected | 154+2 This function accesses a ref value | 119+11 The ref is accessed here",
        ],
      ],
      [
        "jsx",
        'import { useRef, useCallback } from "react";\nexport function C() { const ref = useRef(0); const g2 = () => { const a = ref.current; const b = ref.current.x; return h(b, a); }; return <div>{g2()}</div>; }',
        [
          "react(refs) | Cannot access refs during render | React refs are values that are not needed for rendering. Refs should only be accessed outside of render, such as in event handlers or effects. Accessing a ref value (the `current` property) during render can cause your component not to update as expected | 189+2 This function accesses a ref value | 166+1 The ref is accessed here",
        ],
      ],
      [
        "jsx",
        'import { useRef, useCallback } from "react";\nexport function C() { const ref = useRef(0); const g2 = () => { let a; a = ref.current; return a; }; return <div>{g2()}</div>; }',
        [
          "react(refs) | Cannot access refs during render | React refs are values that are not needed for rendering. Refs should only be accessed outside of render, such as in event handlers or effects. Accessing a ref value (the `current` property) during render can cause your component not to update as expected | 159+2 This function accesses a ref value | 120+11 The ref is accessed here",
          "react(refs) | Cannot access refs during render | React refs are values that are not needed for rendering. Refs should only be accessed outside of render, such as in event handlers or effects. Accessing a ref value (the `current` property) during render can cause your component not to update as expected | 159+4 Cannot access ref value during render",
        ],
      ],
      [
        "jsx",
        'import { useRef, useCallback } from "react";\nexport function C() { const ref = useRef(0); const g2 = () => { const a = ref.current; }; return <div>{g2()}</div>; }',
        [],
      ],
      [
        "jsx",
        'import { useRef, useCallback } from "react";\nexport function C() { const ref = useRef(0); const g2 = () => { h(ref.current); return ref.current.x; }; return <div>{g2()}</div>; }',
        [
          "react(refs) | Cannot access refs during render | React refs are values that are not needed for rendering. Refs should only be accessed outside of render, such as in event handlers or effects. Accessing a ref value (the `current` property) during render can cause your component not to update as expected | 163+2 This function accesses a ref value | 111+11 The ref is accessed here",
          "react(refs) | Cannot access refs during render | React refs are values that are not needed for rendering. Refs should only be accessed outside of render, such as in event handlers or effects. Accessing a ref value (the `current` property) during render can cause your component not to update as expected | 163+4 Cannot access ref value during render",
        ],
      ],
      [
        "jsx",
        'import { useRef, useCallback } from "react";\nexport function C() { const ref = useRef(0); const g2 = () => { const { x } = ref.current; return x; }; return <div>{g2()}</div>; }',
        [
          "react(refs) | Cannot access refs during render | React refs are values that are not needed for rendering. Refs should only be accessed outside of render, such as in event handlers or effects. Accessing a ref value (the `current` property) during render can cause your component not to update as expected | 162+2 This function accesses a ref value | 143+1 The ref is accessed here",
          "react(refs) | Cannot access refs during render | React refs are values that are not needed for rendering. Refs should only be accessed outside of render, such as in event handlers or effects. Accessing a ref value (the `current` property) during render can cause your component not to update as expected | 162+4 Cannot access ref value during render",
        ],
      ],
    ],
  ],
  [
    "no-unnecessary-parameter-property-assignment asks what the name itself refers to, and for writes before",
    {
      "categories": { "correctness": "off" },
      "plugins": ["typescript"],
      "rules": { "typescript/no-unnecessary-parameter-property-assignment": "error" },
    },
    [
      [
        "ts",
        "type size = number;\ndeclare function g<T>(x?: unknown): T;\nexport class Box {\n  constructor(public size: number) {\n    const w: size = size;\n    this.size = size;\n  }\n}",
        [
          "typescript(no-unnecessary-parameter-property-assignment) | Assignment of parameter property is unnecessary | Remove the unnecessary assignment | 145+16",
        ],
      ],
      [
        "ts",
        "type size = number;\ndeclare function g<T>(x?: unknown): T;\nexport class Box {\n  constructor(public size: number) {\n    let w: size;\n    this.size = size;\n  }\n}",
        [
          "typescript(no-unnecessary-parameter-property-assignment) | Assignment of parameter property is unnecessary | Remove the unnecessary assignment | 136+16",
        ],
      ],
      [
        "ts",
        "type size = number;\ndeclare function g<T>(x?: unknown): T;\nexport class Box {\n  constructor(public size: number) {\n    g<size>(size);\n    this.size = size;\n  }\n}",
        [
          "typescript(no-unnecessary-parameter-property-assignment) | Assignment of parameter property is unnecessary | Remove the unnecessary assignment | 138+16",
        ],
      ],
      [
        "ts",
        "type size = number;\ndeclare function g<T>(x?: unknown): T;\nexport class Box {\n  constructor(public size: number) {\n    g?.<size>(size);\n    this.size = size;\n  }\n}",
        [
          "typescript(no-unnecessary-parameter-property-assignment) | Assignment of parameter property is unnecessary | Remove the unnecessary assignment | 140+16",
        ],
      ],
      [
        "ts",
        "type size = number;\ndeclare function g<T>(x?: unknown): T;\nexport class Box {\n  constructor(public size: number) {\n    new Set<size>([size]);\n    this.size = size;\n  }\n}",
        [
          "typescript(no-unnecessary-parameter-property-assignment) | Assignment of parameter property is unnecessary | Remove the unnecessary assignment | 146+16",
        ],
      ],
      [
        "ts",
        "type size = number;\ndeclare function g<T>(x?: unknown): T;\nexport class Box {\n  constructor(public size: number) {\n    g<size>`${size}`;\n    this.size = size;\n  }\n}",
        [
          "typescript(no-unnecessary-parameter-property-assignment) | Assignment of parameter property is unnecessary | Remove the unnecessary assignment | 141+16",
        ],
      ],
      [
        "ts",
        "type size = number;\ndeclare function g<T>(x?: unknown): T;\nexport class Box {\n  constructor(public size: number) {\n    <size>size;\n    this.size = size;\n  }\n}",
        [
          "typescript(no-unnecessary-parameter-property-assignment) | Assignment of parameter property is unnecessary | Remove the unnecessary assignment | 135+16",
        ],
      ],
      [
        "ts",
        "type size = number;\ndeclare function g<T>(x?: unknown): T;\nexport class Box {\n  constructor(public size: number) {\n    (<size>size)++;\n    this.size = size;\n  }\n}",
        [
          "typescript(no-unnecessary-parameter-property-assignment) | Assignment of parameter property is unnecessary | Remove the unnecessary assignment | 139+16",
        ],
      ],
      [
        "ts",
        "type size = number;\ndeclare function g<T>(x?: unknown): T;\nexport class Box {\n  constructor(public size: number) {\n    (this.size as size) = size;\n    this.size = size;\n  }\n}",
        [
          "typescript(no-unnecessary-parameter-property-assignment) | Assignment of parameter property is unnecessary | Remove the unnecessary assignment | 151+16",
        ],
      ],
      [
        "ts",
        "type size = number;\ndeclare function g<T>(x?: unknown): T;\nexport class Box {\n  constructor(public size: number) {\n    let n = { m: 0 }; (n.m as size)++; size;\n    this.size = size;\n  }\n}",
        [
          "typescript(no-unnecessary-parameter-property-assignment) | Assignment of parameter property is unnecessary | Remove the unnecessary assignment | 164+16",
        ],
      ],
      [
        "ts",
        "type size = number;\ndeclare function g<T>(x?: unknown): T;\nexport class Box {\n  constructor(public size: number) {\n    const w: size = g<number>(size);\n    this.size = size;\n  }\n}",
        [
          "typescript(no-unnecessary-parameter-property-assignment) | Assignment of parameter property is unnecessary | Remove the unnecessary assignment | 156+16",
        ],
      ],
      [
        "ts",
        "type size = number;\ndeclare function g<T>(x?: unknown): T;\nexport class Box {\n  constructor(public size: number) {\n    const w: number = g<size>(size);\n    this.size = size;\n  }\n}",
        [
          "typescript(no-unnecessary-parameter-property-assignment) | Assignment of parameter property is unnecessary | Remove the unnecessary assignment | 156+16",
        ],
      ],
      [
        "ts",
        "type size = number;\ndeclare function g<T>(x?: unknown): T;\nexport class Box {\n  constructor(public size: number) {\n    g<Array<size>>(g<number>(size));\n    this.size = size;\n  }\n}",
        [
          "typescript(no-unnecessary-parameter-property-assignment) | Assignment of parameter property is unnecessary | Remove the unnecessary assignment | 156+16",
        ],
      ],
      [
        "ts",
        "type size = number;\ndeclare function g<T>(x?: unknown): T;\nexport class Box {\n  constructor(public size: number) {\n    (size as size) = 0;\n    this.size = size;\n  }\n}",
        [],
      ],
      [
        "ts",
        "type size = number;\ndeclare function g<T>(x?: unknown): T;\nexport class Box {\n  constructor(public size: number) {\n    (size as size) += 0;\n    this.size = size;\n  }\n}",
        [],
      ],
      [
        "ts",
        "type size = number;\ndeclare function g<T>(x?: unknown): T;\nexport class Box {\n  constructor(public size: number) {\n    (size as size)++;\n    this.size = size;\n  }\n}",
        [],
      ],
      [
        "ts",
        "type size = number;\ndeclare function g<T>(x?: unknown): T;\nexport class Box {\n  constructor(public size: number) {\n    ((size as size)!) = 0;\n    this.size = size;\n  }\n}",
        [],
      ],
      [
        "ts",
        "type size = number;\ndeclare function g<T>(x?: unknown): T;\nexport class Box {\n  constructor(public size: number) {\n    (size satisfies size) = 0;\n    this.size = size;\n  }\n}",
        [],
      ],
      [
        "ts",
        "type size = number;\ndeclare function g<T>(x?: unknown): T;\nexport class Box {\n  constructor(public size: number) {\n    (<size>size) = 0;\n    this.size = size;\n  }\n}",
        [
          "typescript(no-unnecessary-parameter-property-assignment) | Assignment of parameter property is unnecessary | Remove the unnecessary assignment | 141+16",
        ],
      ],
      [
        "ts",
        "type size = number;\ndeclare function g<T>(x?: unknown): T;\nexport class Box {\n  constructor(public size: number) {\n    size = 0;\n    this.size = size;\n  }\n}",
        [],
      ],
      [
        "ts",
        "type size = number;\ndeclare function g<T>(x?: unknown): T;\nexport class Box {\n  constructor(public size: number) {\n    size++;\n    this.size = size;\n  }\n}",
        [],
      ],
      [
        "ts",
        "type size = number;\ndeclare function g<T>(x?: unknown): T;\nexport class Box {\n  constructor(public size: number) {\n    [size] = [0];\n    this.size = size;\n  }\n}",
        [],
      ],
      [
        "ts",
        "type size = number;\ndeclare function g<T>(x?: unknown): T;\nexport class Box {\n  constructor(public size: number) {\n    ({ size } = { size: 0 });\n    this.size = size;\n  }\n}",
        [],
      ],
      [
        "ts",
        "type size = number;\ndeclare function g<T>(x?: unknown): T;\nexport class Box {\n  constructor(public size: number) {\n    (() => { size = 0; })();\n    this.size = size;\n  }\n}",
        [],
      ],
      [
        "ts",
        "type size = number;\ndeclare function g<T>(x?: unknown): T;\nexport class Box {\n  constructor(public size: number) {\n    (() => { size = 0; });\n    this.size = size;\n  }\n}",
        [
          "typescript(no-unnecessary-parameter-property-assignment) | Assignment of parameter property is unnecessary | Remove the unnecessary assignment | 146+16",
        ],
      ],
      [
        "ts",
        "type size = number;\ndeclare function g<T>(x?: unknown): T;\nexport class Box {\n  constructor(public size: number) {\n    function h() { size = 0; }\n    this.size = size;\n  }\n}",
        [
          "typescript(no-unnecessary-parameter-property-assignment) | Assignment of parameter property is unnecessary | Remove the unnecessary assignment | 150+16",
        ],
      ],
      [
        "ts",
        "type size = number;\ndeclare function g<T>(x?: unknown): T;\nexport class Box {\n  constructor(public size: number) {\n    g(size);\n    this.size = size;\n  }\n}",
        [
          "typescript(no-unnecessary-parameter-property-assignment) | Assignment of parameter property is unnecessary | Remove the unnecessary assignment | 132+16",
        ],
      ],
      [
        "ts",
        "type size = number;\ndeclare function g<T>(x?: unknown): T;\nexport class Box {\n  constructor(public size: number) {\n    \n    this.size = size;\n  }\n}",
        [
          "typescript(no-unnecessary-parameter-property-assignment) | Assignment of parameter property is unnecessary | Remove the unnecessary assignment | 124+16",
        ],
      ],
      [
        "ts",
        "type size = number;\nexport class Box {\n  constructor(public size: number, w: size = size) {\n    this.size = size;\n  }\n}",
        [
          "typescript(no-unnecessary-parameter-property-assignment) | Assignment of parameter property is unnecessary | Remove the unnecessary assignment | 96+16",
        ],
      ],
      [
        "ts",
        "export class Box {\n  constructor(public size: number) {\n    this.size = <number>size;\n  }\n}",
        [
          "typescript(no-unnecessary-parameter-property-assignment) | Assignment of parameter property is unnecessary | Remove the unnecessary assignment | 60+24",
        ],
      ],
      [
        "ts",
        "export class Box {\n  constructor(public size: number) {\n    this.size = size satisfies number;\n  }\n}",
        [
          "typescript(no-unnecessary-parameter-property-assignment) | Assignment of parameter property is unnecessary | Remove the unnecessary assignment | 60+33",
        ],
      ],
      [
        "ts",
        "export class Box {\n  constructor(public size: number) {\n    this.size = size as number;\n  }\n}",
        [
          "typescript(no-unnecessary-parameter-property-assignment) | Assignment of parameter property is unnecessary | Remove the unnecessary assignment | 60+26",
        ],
      ],
      [
        "ts",
        "export class Box {\n  constructor(public size: number) {\n    this.size = size!;\n  }\n}",
        [
          "typescript(no-unnecessary-parameter-property-assignment) | Assignment of parameter property is unnecessary | Remove the unnecessary assignment | 60+17",
        ],
      ],
      [
        "ts",
        "export class Box {\n  constructor(public size: number) {\n    this.size = (size);\n  }\n}",
        [
          "typescript(no-unnecessary-parameter-property-assignment) | Assignment of parameter property is unnecessary | Remove the unnecessary assignment | 60+18",
        ],
      ],
    ],
  ],
  [
    "an escape in a name of JSX",
    {
      "categories": { "correctness": "off" },
      "rules": {
        "no-undef": "error",
        "no-unused-vars": "error",
        "react/jsx-no-undef": "error",
        "react/no-unknown-property": "error",
      },
      "plugins": ["react"],
    },
    [
      ["jsx tsx", "<a-\\u0062 />;", []],
      ["jsx tsx", "<a-\\u0062></a-\\u0062>;", [" | Expected `>` but found `Identifier` |  | 14+6 `>` expected"]],
      ["jsx tsx", "<a-b\\u0063 />;", []],
      ["jsx tsx", "<a\\u0062-c />;", []],
      [
        "jsx tsx",
        '<a b-\\u0063="1" />;',
        [
          "react(no-unknown-property) | Unknown property found | Remove unknown property | 3+2",
          "react(no-unknown-property) | Unknown property found | Remove unknown property | 5+6",
        ],
      ],
      [
        "jsx tsx",
        '<a b\\u0063="1" />;',
        ["react(no-unknown-property) | Unknown property found | Remove unknown property | 3+7"],
      ],
      ["jsx tsx", "<a:b\\u0063 />;", []],
      ["jsx tsx", "<a:\\u0062 />;", []],
      [
        "jsx tsx",
        "<a.b\\u0063 />;",
        [
          "eslint(no-undef) | 'a' is not defined. | Either define 'a' or remove the reference to it. If 'a' is a global variable, add it to the 'globals' configuration. | 1+1",
          "react(jsx-no-undef) | 'a' is not defined. |  | 1+1",
        ],
      ],
      [
        "jsx tsx",
        "<X\\u0065 />;",
        [
          "eslint(no-undef) | 'X\\u0065' is not defined. | Either define 'X\\u0065' or remove the reference to it. If 'X\\u0065' is a global variable, add it to the 'globals' configuration. | 1+7",
          "react(jsx-no-undef) | 'X\\u0065' is not defined. |  | 1+7",
        ],
      ],
      [
        "jsx tsx",
        "<X\\u0065></Xe>;",
        [
          " | Expected corresponding JSX closing tag for 'X\\u0065'. |  | 11+2 Expected `</X\\u0065>` | 1+7 Opened here",
        ],
      ],
      [
        "jsx tsx",
        "<X\\u0065></X\\u0065>;",
        [
          "eslint(no-undef) | 'X\\u0065' is not defined. | Either define 'X\\u0065' or remove the reference to it. If 'X\\u0065' is a global variable, add it to the 'globals' configuration. | 1+7",
          "eslint(no-undef) | 'X\\u0065' is not defined. | Either define 'X\\u0065' or remove the reference to it. If 'X\\u0065' is a global variable, add it to the 'globals' configuration. | 11+7",
          "react(jsx-no-undef) | 'X\\u0065' is not defined. |  | 1+7",
        ],
      ],
      [
        "jsx tsx",
        "const X\\u0065 = 1; <X\\u0065 />;",
        [
          "eslint(no-undef) | 'X\\u0065' is not defined. | Either define 'X\\u0065' or remove the reference to it. If 'X\\u0065' is a global variable, add it to the 'globals' configuration. | 20+7",
          "eslint(no-unused-vars) | Variable 'Xe' is declared but never used. Unused variables should start with a '_'. | Consider removing this declaration. | 6+7 'Xe' is declared here",
          "react(jsx-no-undef) | 'X\\u0065' is not defined. |  | 20+7",
        ],
      ],
      [
        "jsx tsx",
        "const Xe = 1; <X\\u0065 />;",
        [
          "eslint(no-undef) | 'X\\u0065' is not defined. | Either define 'X\\u0065' or remove the reference to it. If 'X\\u0065' is a global variable, add it to the 'globals' configuration. | 15+7",
          "eslint(no-unused-vars) | Variable 'Xe' is declared but never used. Unused variables should start with a '_'. | Consider removing this declaration. | 6+2 'Xe' is declared here",
          "react(jsx-no-undef) | 'X\\u0065' is not defined. |  | 15+7",
        ],
      ],
      ["jsx tsx", "<a-\\u{62} />;", []],
      ["jsx tsx", "<a- />;", []],
      ["jsx tsx", "<a-- />;", []],
      ["jsx tsx", "<a-1 />;", []],
      [
        "jsx tsx",
        "<\\u0061 />;",
        [
          "eslint(no-undef) | '\\u0061' is not defined. | Either define '\\u0061' or remove the reference to it. If '\\u0061' is a global variable, add it to the 'globals' configuration. | 1+6",
          "react(jsx-no-undef) | '\\u0061' is not defined. |  | 1+6",
        ],
      ],
      ["jsx tsx", "<\\u0061-b />;", []],
    ],
  ],
];

describe.concurrent("bun lint with .oxlintrc.json", () => {
  test("has every error of a file that oxc refuses, in oxlint's order and words", async () => {
    await expectErrors(rows);
  });

  test.each(tables)("%s", async (_, config, table) => {
    await expectErrors(table, config);
  });

  // As oxlint 1.87 prints them: it makes an offset of the line and the column, and a line and a column of that.
  test("-f unix has what a plugin reports past the end of a line in the line where that is", async () => {
    const plugin = `
      const places = { "a.js": [[2, 6]], "b.js": [[2, 20], [3, 11], [5, 3]] };
      export default { meta: { name: "pl" }, rules: { r: { create(context) { return { Program() {
        for (const [line, column] of places[context.filename.slice(-4)]) {
          context.report({ loc: { line, column }, message: "at " + line + ":" + column });
        }
      } }; } } } };`;
    using dir = tempDir("bun-lint-oxc-errors", {
      ".oxlintrc.json": JSON.stringify({
        categories: { correctness: "off" },
        jsPlugins: ["./plugin.js"],
        rules: { "pl/r": "warn" },
        ignorePatterns: ["plugin.js"],
      }),
      "plugin.js": plugin,
      "a.js": "a;\nbb;\ncccccc;\n",
      // The lines end in `\n`, `\r\n`, `\r` and `\n`, and one is empty.
      "b.js": "let a = 1;\n/*😀*/ let b;\r\nlet é = 2;\rx\n\nlast",
    });
    await using proc = spawn({
      cmd: [bunExe(), "lint", "-f", "unix", "a.js", "b.js"],
      env,
      cwd: String(dir),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.split("\n").filter(Boolean).sort()).toEqual([
      "4 problems",
      "a.js:3:3: at 2:6 [Warning/pl(r)]",
      "b.js:3:7: at 2:20 [Warning/pl(r)]",
      "b.js:4:1: at 3:11 [Warning/pl(r)]",
      "b.js:6:3: at 5:3 [Warning/pl(r)]",
    ]);
  });

  // oxlint sorts all the messages of a file by the range of their fix before it applies the fixes, and prints what is left in that
  // order. Those without a fix compare equal, so they stay in the order of the run.
  describe("--fix leaves what has no fix in the order of the run", () => {
    const config = {
      categories: { correctness: "off" },
      rules: { "no-magic-numbers": "error", "eqeqeq": "error", "id-length": "error" },
    };
    /** `others` lines with a message that has no fix, and before the line `at` one with a message that has one. */
    const left = async (others: number, at: number) => {
      const lines = Array.from({ length: others }, (_, i) => `f(${100 + i});`);
      lines.splice(at, 0, "g(typeof a == 'string');");
      const found = await diagnosticsOf(
        { "a.js": lines.join("\n") + "\n" },
        config,
        ["--fix"],
        "Fixed 1 problem in 1 file\n",
      );
      return found["a.js"].map(it => `${it.code} ${it.message}`);
    };
    const inOrder = (others: number) =>
      Array.from({ length: others }, (_, i) => `eslint(no-magic-numbers) No magic number: ${100 + i}`);

    // As oxlint 1.87 prints them.
    test.each([0, 15, 31])("32 messages, the one with the fix before line %i", async at => {
      expect(await left(31, at)).toEqual(inOrder(31));
    });

    // oxlint's sort is not stable, which shows from 33 messages on: it prints the lines 1, 3 to 16, 2, 19 to 34, 18. That is an
    // accident of the sort of its standard library. Here they keep their order.
    test("34 messages", async () => {
      expect(await left(33, 16)).toEqual(inOrder(33));
    });
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
