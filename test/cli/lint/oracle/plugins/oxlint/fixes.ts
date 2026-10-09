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
  /** The options of the rule. */
  options?: object;
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
  // What ESLint suggests, oxlint does.
  js("preserve-caught-error", "try {} catch (e) { throw new Error(\"a\"); }"),
  js("preserve-caught-error", "try {} catch (e) { throw new Error(); }"),
  js("preserve-caught-error", "try {} catch (e) { throw new Error; }"),
  js("preserve-caught-error", "try {} catch (e) { throw new Error(\"a\", {}); }"),
  js("preserve-caught-error", "try {} catch (e) { throw new Error(\"a\", { }); }"),
  js("preserve-caught-error", "try {} catch (e) { throw new Error(\"a\", { b: 1 }); }"),
  js("preserve-caught-error", "try {} catch (e) { throw new Error(\"a\", { b: 1, }); }"),
  js("preserve-caught-error", "try {} catch (e) { throw new Error(\"a\", { cause: f }); }"),
  js("preserve-caught-error", "try {} catch (e) { throw new Error(\"a\", { cause }); }"),
  js("preserve-caught-error", "try {} catch (e) { throw new Error((\"a\")); }"),
  js("preserve-caught-error", "try {} catch (e) { throw new Error(\"a\",); }"),
  js("preserve-caught-error", "try {} catch (e) { throw new TypeError(`a${b}`); }"),
  js("preserve-caught-error", "try {} catch (e) { throw new AggregateError(); }"),
  js("preserve-caught-error", "try {} catch (e) { throw new AggregateError([]); }"),
  js("preserve-caught-error", "try {} catch (e) { throw new AggregateError([], \"a\"); }"),
  js("preserve-caught-error", "try {} catch (e) { throw new AggregateError([], \"a\", {}); }"),
  js("preserve-caught-error", "try {} catch (e) { throw Error(\"a\"); }"),
  js("preserve-caught-error", "try {} catch (e) { throw new Error(\"a\", o); }"),
  js("preserve-caught-error", "try {} catch (e) { throw new RangeError(\"a\"); }"),
  js("preserve-caught-error", "try {} catch ({ e }) { throw new Error(\"a\"); }"),
  js("preserve-caught-error", "try {} catch (e) { if (a) { throw new Error(\"a\"); } else { throw new Error(\"b\"); } }"),
  js("preserve-caught-error", "try {} catch (e) { throw new Error(\"a\", ({})); }"),
  ts("no-import-type-side-effects", 'import {} from "a";'),
  js("preserve-caught-error", "try {} catch (e) { throw new Error(\"a\", { cause: f, cause: g }); }"),
  js("preserve-caught-error", "try {} catch (e) { throw new Error(\"a\", { \"cause\": e }); }"),
  js("preserve-caught-error", "try {} catch (e) { const g = () => { throw new Error(\"a\"); }; }"),
  js("preserve-caught-error", "try {} catch (e) { throw new Error(\"a\", 1, 2); }"),
  js("preserve-caught-error", "try {} catch (e) { throw (new Error(\"a\")); }"),
  js("preserve-caught-error", "try {} catch (e) { throw new Error(\"a\", { cause: f, ...c }); }"),
  js("preserve-caught-error", "try {} catch (e) { throw new Error(\"a\", { b, ...c }); }"),
  js("preserve-caught-error", "try {} catch (e) { class A { static { throw new Error(\"a\"); } b = () => { throw new Error(\"b\"); }; c() { throw new Error(\"c\"); } } }"),
  // The text and the range of oxlint's fix, where the original has another or none.
  js("arrow-body-style", "a = () => { return b; };\nc = () => {\n  return { d: 1 };\n};\nfor (e = () => { return f in g; };;) {}"),
  js("arrow-body-style", "a = () => { return () => { return b; }; };"),
  js("no-negated-condition", "if (!a) { b(); } else { c(); }\nd = e !== f ? g : h;"),
  js("yoda", "a = ['b' === c,d]; if (1<e) {}"),
  js("eqeqeq", "typeof a=='b'; c /* d */ == 'e';"),
  js("prefer-object-has-own", "if (!Object.prototype.hasOwnProperty.call(a, b)) {} c = {}.hasOwnProperty.call(d, e);"),
  js("no-new-wrappers", "a = new String('b'); c = new Number(d); e = new Boolean;"),
  js("prefer-exponentiation-operator", "a = Math.pow(b, c); d = Math.pow(e + f, -g) * 2; h = -Math.pow(i, j);"),
  js("no-empty", "try { a(); } catch {}\nif (b) {}\ntry { c(); } catch (e) { f(); } finally {}\nswitch (d) {}"),
  js("no-implicit-coercion", "a = '' + b; c += ''; d = +(e, f); g = typeof+h; i = ~j.indexOf(k);"),
  js("no-console", "if (a) console.log(1); b = () => console.log(2); c = d ? console.log(3) : 4; console.log(5)\ne(console.log);"),
  js("prefer-arrow-callback", "a(function () { b(function () {}); }); c(function () { return this; }.bind(this)); d(e || async function f(g) {});"),
  js("use-isnan", "a === NaN; b != Number.NaN; c < NaN; d.indexOf(NaN);"),
  js("no-useless-rename", "import { a as a } from 'b'; const { c /* d */: c, e: e = 1 } = f; export { c as c };"),
  { rule: "no-useless-rename", file: "a.ts", text: "import { type a as a } from 'b'; export { type a as a };\n" },
  js("no-compare-neg-zero", "a < -0; -0 == b; c !== -0;"),
  js("no-unused-labels", "A: /* b */ for (;;) {}\nC: D: e();"),
  js("no-unsafe-negation", "!a in b; !(c) instanceof  d;"),
  js("no-iterator", "a.__iterator__ = b; c['__iterator__'];"),
  js("no-empty-static-block", "class A { static {} }"),
  js("no-debugger", "if (a) debugger; else debugger\nfor (;;) debugger;"),
  js("for-direction", "for (let i = 0; i < 1; i--) {} for (let j = 0; j < 1; j -= 1) {} for (let k = 1; k > 0; ++k) {}"),
  js("no-useless-escape", "a = /[\\*\\?]/; b = '\\d\\e';"),
  js("prefer-destructuring", "const a = (b || c).a; const d = e['d']; const f /* g */ = (h.i).f;"),
  js("no-unneeded-ternary", "a = (b !== c) ? true : false; d = e & f ? true : false; g = h == i ? false : true; j = k[l] ? false : true;"),
  js("sort-vars", "var b, a; var d = e(), c, g = 1, f; var i, /* j */ h;"),
  js("one-var", "const a = 1; const b = 2; export const c = 3;"),
  { rule: "one-var", file: "a.ts", text: "declare const a: number; const b = 2; const c = 3;\n" },
  js("prefer-template", "a = `${b}` + c; d = e +\n  (f ? 'g' : 'h') + 'i';\n'j' + k"),
  ts("no-explicit-any", "let a: any; type B = keyof any; function c(...d: any) {}"),
  ts("ban-ts-comment", "// @ts-ignore\nlet a: number = 'b';\n/* @ts-ignore: @ts-ignore */\nlet c: number = 'd';"),
  ts("consistent-type-assertions", "a = <B>c; d(<E>f); g = <H>i ? 1 : 2; j = <K>(l, m); n = () => <O>{};"),
  ts("prefer-function-type", "interface A { (): void }\nexport interface B<C> { (d: C): void; }\ntype E = { (): void };"),
  ts("no-empty-object-type", "interface A<B> extends C<B> {}\ninterface A<B> { d: B }\ninterface E extends F {}"),
  ts("consistent-indexed-object-style", "type A = {\n  /** b */\n  [C in D]: E;\n};\ninterface F { [g: string]: H /* i */ }"),
  // oxlint has a fix, ESLint and typescript-eslint have none.
  js("sort-keys", "a = { c: 1, b: { e: 1, d: 2 }, a: 3 };\nf = {\n  /** h */\n  h: 1, // i\n  g: 2,\n};\nj = { ...k, m: 1, l: 2, ...n };\no = { q: 1, /* r */ p: 2 };"),
  js("func-names", "var a = function () {}; b.c = function* () {}; d = { e: function () { e; }, 'f': async function () {}, g: h(function () {}) }; (function () {})();"),
  js("no-plusplus", "a++; --b.c; d['e']++; f[g]--; for (;; h++) {}"),
  js("no-void", "a = void 0; void b(); c(void (d));"),
  js("no-eq-null", "a == null; null != (b); c /* d */ == /* e */ null;"),
  js("no-throw-literal", "function a() { throw 'b'; } function c() { throw (`d`); } function e() { throw 1; }"),
  js("no-unexpected-multiline", "a\n(b || c).d();\ne\n[f].g();\nh\n`i`;"),
  ts("no-extraneous-class", "export class A {}\nclass B {}\n@c class D {}\ne = class {};"),
  ts("no-unnecessary-parameter-property-assignment", "class A { constructor(public b: number, private c: string) { this.b = b; d(this.c = c); } }"),
  // The bytes that the fixes of tsgolint leave: what it puts in begins where the token before ends, what it takes out ends there.
  typed("no-unnecessary-boolean-literal-compare", "declare const b: boolean, n: boolean | null, x: unknown, f: (a?: boolean) => boolean, o: { p?: boolean }; let r;\nif (b === true) {}\nif (b !== true) {}\nif (b === false) {}\nif (b !== false) {}\nif (true === b) {}\nif (false !== b) {}\nif (true !== b) {}\nif (false === (x instanceof Error)) {}\nr = b === true;\nr = b === false;\nr = !(b === true);\nr = !(b !== true);\nr = !(b === false);\nr = !((b === false));\nr = (x instanceof Error) === false;\nr = x instanceof Error === false;\nr = f() === false;\nif (n === true) {}\nif (n !== true) {}\nif (n === false) {}\nif (n !== false) {}\nr = n === true;\nr = n !== true;\nr = n === false;\nr = n !== false;\nr = !(n === true);\nr = !(n !== true);\nr = !(n === false);\nr = (n ?? b) === true;\nr = (n ?? b) === false;\nr = n === true && b;\nr = n === true ? 1 : 2;\nwhile (n === true) {}\nr = b /* c */ === /* d */ true;\nr = true /* c */ === /* d */ b;\nr = b\n  === true;\nr = true ===\n  b;\nr = !!(n === true);\nfor (; n === true; ) {}\ndo {} while (n === true);\nr = [n === true];\nr = f(n === true);\nexport {};"),
  {
    ...typed("no-unnecessary-boolean-literal-compare", "declare const b: boolean, n: boolean | null, x: unknown, f: (a?: boolean) => boolean, o: { p?: boolean }; let r;\nif (n === true) {}\nif (n !== true) {}\nif (n === false) {}\nif (n !== false) {}\nr = n === true;\nr = n !== true;\nr = n === false;\nr = n !== false;\nr = !(n === true);\nr = !(n !== true);\nr = !(n === false);\nr = (n ?? b) === true;\nr = (n ?? b) === false;\nr = n === true && b;\nr = n === true ? 1 : 2;\nwhile (n === true) {}\nr = !!(n === true);\nfor (; n === true; ) {}\ndo {} while (n === true);\nr = [n === true];\nr = f(n === true);\nr = true === n;\nr = false === n;\nr = false !== n;\nr = o.p === true;\nr = o.p === false;\nr = (b ? n : null) === true;\nr = (b ? n : null) === false;\nr = !(b ? n : null) === false;\nif (!(n === false)) {}\nif ((n === true)) {}\nr = n === true || b;\nif (n === true || b) {}\nr = !(n !== false);\nr = n! === true;\nr = (n as boolean | null) === false;\nr = (n as boolean | null) === true;\nexport {};"),
    options: { allowComparingNullableBooleansToTrue: false, allowComparingNullableBooleansToFalse: false },
  },
  typed("no-meaningless-void-operator", "let r;\nvoid (() => {})();\nfunction g() {}\nvoid g();\nvoid  g2();\nfunction g2() {}\nvoid/* c */g3();\nfunction g3() {}\nvoid\ng4();\nfunction g4() {}\nfunction g5(): never { throw 1; }\nvoid g5();\nr = void g6();\nfunction g6() {}\nvoid void g7();\nfunction g7() {}\nvoid (g8());\nfunction g8() {}\ndeclare const u: undefined;\nvoid u;\nexport {};"),
];

/** The directory of a case, which has a configuration file of its own. */
export const directoryOf = (index: number) => `${index}-${cases[index].rule.replace(/^.*\//, "")}`;

export const filesOf = ({ rule, file, text, typed, options }: Case): Record<string, string> => ({
  ".oxlintrc.json": JSON.stringify({ plugins: ["typescript"], categories: { correctness: "off" }, rules: { [rule]: options ? ["error", options] : "error" } }),
  [file]: text,
  ...(typed && {
    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, target: "esnext", module: "esnext", lib: ["esnext", "dom"] } }),
  }),
});
