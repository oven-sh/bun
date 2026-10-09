// What `--fix`, `--fix-suggestions` and `--fix-dangerously` make of a file, rule by rule: with a configuration of oxlint they change
// what oxlint changes. `oxlint --rules -f json` names the most dangerous kind of fix that a rule can have, which says nothing about a
// report, and for the rules that need types it is wrong: so each case was tried.

export interface Case {
  /** As it is written in `rules`. */
  rule: string;
  /** The name of the file, which says what language it is. */
  file: string;
  text: string;
  /** It is linted with `--type-aware`. */
  typed?: boolean;
}

export const flagSets = { fix: ["--fix"], suggestions: ["--fix-suggestions"], dangerously: ["--fix-dangerously"] };

const js = (rule: string, text: string): Case => ({ rule, file: "a.js", text: text + "\n" });
const ts = (rule: string, text: string): Case => ({ rule: `typescript/${rule}`, file: "a.ts", text: text + "\n" });
const typed = (rule: string, text: string): Case => ({ ...ts(rule, text), typed: true });

export const cases: Case[] = [
  // The rule of oxlint has no fix of any kind.
  js("no-lonely-if", "if (a) {} else { if (b) {} }"),
  js("no-extra-bind", "a = function () {}.bind(b);"),
  js("no-useless-return", "function a() { return; }"),
  js("logical-assignment-operators", "a = a || b;"),
  ts("method-signature-style", "interface A { b(): void }"),
  ts("no-empty-interface", "interface A extends B {}"),
  // It has suggestions only.
  ts("no-inferrable-types", "let a: number = 1;"),
  js("no-debugger", "debugger;"),
  js("no-console", "console.log(1);"),
  typed("non-nullable-type-assertion-style", "declare const a: string | null; export const b = a as string;"),
  // Its fix is dangerous.
  js("no-unneeded-ternary", "a = b ? true : false;"),
  js("no-unneeded-ternary", "a = b ? b : c;"),
  js("require-await", "async function a() { b(); }"),
  js("radix", "parseInt(a);"),
  js("no-eq-null", "a == null;"),
  ts("no-extraneous-class", "class A {}"),
  // It depends on the report.
  js("no-extra-boolean-cast", "if (!!a) {}"),
  js("no-extra-boolean-cast", "if (Boolean(a)) {}"),
  js("eqeqeq", "a == 'b'; typeof a == 'c'; a == b;"),
  js("operator-assignment", "a = a + b;"),
  ts("consistent-type-definitions", "type A = { b: 1 };"),
  js("no-unused-vars", "import a from 'a'; const b = 1; export {};"),
  js("no-compare-neg-zero", "a === -0;"),
  ts("explicit-member-accessibility", "class A { b = 1 }"),
  ts("prefer-as-const", "let a: 'b' = 'b'; let c = 'd' as 'd';"),
  // It has a fix.
  js("no-div-regex", "a = /=b/;"),
  js("no-var", "var a = 1; a;"),
  js("no-var", "var a = 1; a = 2;"),
  js("prefer-const", "let a = 1; a;"),
  js("curly", "if (a) b();"),
  js("no-useless-escape", "a = '\\d';"),
  js("valid-typeof", "typeof a == undefined;"),
  js("no-implicit-coercion", "a = !!b; a = +b;"),
  js("func-names", "a = function () {};"),
  js("sort-keys", "a = { c: 1, b: 2 };"),
  js("no-negated-condition", "if (!a) { b(); } else { c(); }"),
  // tsgolint fixes what the executable says has no fix.
  typed("dot-notation", `declare const a: { b: 1 }; a["b"];`),
  typed("prefer-readonly", "export class A { private b = 1; c() { return this.b; } }"),
  typed("prefer-string-starts-ends-with", `declare const a: string; a[0] === "b";`),
  typed("no-unnecessary-boolean-literal-compare", "declare const a: boolean; if (a === true) {}"),
  typed("prefer-regexp-exec", `"a".match(/b/);`),
  typed("consistent-type-exports", "type A = 1; export { A };"),
  typed("no-unnecessary-qualifier", "namespace A { export type B = 1; const c: A.B = 1; }"),
  typed("prefer-includes", `declare const a: string[]; a.indexOf("b") !== -1;`),
  // The text that its fix leaves.
  js("no-else-return", "export function f(a) {\n  if (a) {\n    return 1;\n  } else {\n    return 2;\n  }\n}"),
  js("no-else-return", "export function g(a) {\n  if (a) return 1; else return 2;\n}"),
  js("no-else-return", "export function h(a) {\n  if (a) return 1\n  else return 2\n}"),
  js("no-else-return", "export function i(a) {\n  if (a) { return 1 } else { b() } c();\n}"),
  js("no-else-return", "export function j(a) {\n  if (a) {\n    return 1;\n  } else if (b) {\n    return 2;\n  } else {\n    return 3;\n  }\n}"),
  js("no-else-return", "export function k(a) {\n  if (a) {\n    return 1;\n  } else {\n    if (b) {\n      return 2;\n    } else {\n      return 3;\n    }\n  }\n}"),
  js("no-else-return", "export function l(a) {\n  if (a) { return 1; } else { x(); }\n  if (a) { return 1; } else { y(); }\n}"),
  js("no-else-return", "export function m(a) {\n  let n = 1;\n  if (a) { return n; } else { let n = 2; return n; }\n}"),
  js("no-else-return", "export function o(a) {\n  if (a) { return 1; } else { let p = 2; return p; }\n  function q() { return p; }\n}"),
  js("no-else-return", "export function r(a) {\n  if (a) { return 1; } /* s */ else /* t */ { return 2; }\n}"),
  js("no-else-return", "export function w(a) {\n  if (a) return 1\n  else (b)\n}"),
  js("no-else-return", "export function x(a) {\n  if (a) { return 1; } else { b }\n  [c]\n}"),
  js("no-var", "var a = 1; a;"),
  js("no-var", "var [a, ...b] = c; b = 1; a;"),
  js("no-var", "var { a, ...b } = c; b = 1; a;"),
  js("no-var", "var { a, b = 1 } = c; a; b;"),
  js("no-var", "var a = 1, b; a; b;"),
  js("no-var", "if (x) { var a = 1; } a;"),
  js("no-var", "if (x) { var a = 1; a; }"),
  js("no-var", "for (var i = 0; i < 1; i++) {}"),
  js("no-var", "for (var i = 0; i < 1; ) {}"),
  js("no-var", "for (var i of x) { i; }"),
  js("no-var", "export var a = 1;\na;"),
  js("no-var", "export var a = 1;"),
  js("no-var", "a; var a = 1;"),
  js("no-var", "var a = 1; var a = 2;"),
  js("no-var", "switch (x) { case 1: var a = 1; a; break; case 2: a; }"),
  js("no-var", "switch (x) { case 1: var a = 1; a; }"),
  js("no-var", "var a = 1, /* c */ b = 2 // d\n;a; b;"),
  js("no-var", "var a = a;"),
  js("no-var", "var a = function () { a = 1; };"),
  js("no-var", "var a = 1; a++;"),
  { rule: "no-var", file: "a.ts", text: "declare var a: number;\nexport {};\n" },
  { rule: "no-var", file: "a.ts", text: "namespace N { var a = 1; a; }\n" },
  { rule: "no-var", file: "a.ts", text: "namespace N { export var a = 1; }\nN.a;\n" },
  { rule: "no-var", file: "a.ts", text: "var a: number = 1; type B = typeof a;\n" },
  { rule: "no-var", file: "a.ts", text: "class C { static { var a = 1; a; } }\n" },
];

/** The directory of a case, which has a configuration file of its own. */
export const directoryOf = (index: number) => `${index}-${cases[index].rule.replace(/^.*\//, "")}`;

export const filesOf = ({ rule, file, text, typed }: Case): Record<string, string> => ({
  ".oxlintrc.json": JSON.stringify({ plugins: ["typescript"], categories: { correctness: "off" }, rules: { [rule]: "error" } }),
  [file]: text,
  ...(typed && {
    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, target: "esnext", module: "esnext", lib: ["esnext", "dom"] } }),
  }),
});
