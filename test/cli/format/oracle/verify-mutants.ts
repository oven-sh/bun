// Damages formatted code and asks the check that `bun format` makes before it writes a file
// (`bun_format::verify`) whether it notices.
//
//   bun verify-mutants.ts --bin=<bun-lint> [--seed=1] [--per-class=2] [--limit=n] [--max-size=30000] \
//     [--show-missed] <files and directories..>
//
// Each file is formatted. The formatted text is damaged in one place, in one of the ways below, and
// compared with the file. A mutant that no longer parses is noticed by that alone. Of those that
// parse, some are the same program (a comma after the last element, parentheses that mean nothing),
// so "not noticed" is not a defect by itself: `--show-missed` prints them, to be looked at.
// Without paths, only the cases that are written out in here are run. The exit code is 1 if one of
// them is not noticed, or if something that the formatter does is taken for a difference.
//
// Nothing is written anywhere.

import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, extname } from "node:path";

const flags = new Map<string, string>();
const roots: string[] = [];
for (const arg of process.argv.slice(2)) {
  const match = /^--([\w-]+)(?:=(.*))?$/s.exec(arg);
  if (match) flags.set(match[1], match[2] ?? "");
  else roots.push(arg);
}
const bin = flags.get("bin");
if (!bin) {
  console.error("usage: bun verify-mutants.ts --bin=<bun-lint> [--seed=n] [--per-class=n] [--limit=n] [--show-missed] <paths..>");
  process.exit(1);
}
let seed = Number(flags.get("seed") ?? 1);
const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const below = (n: number) => Math.floor(random() * n);
const pick = <T>(all: T[]): T | undefined => all[below(all.length)];
const perClass = Number(flags.get("per-class") ?? 2);
const limit = Number(flags.get("limit") ?? Infinity);
const maxSize = Number(flags.get("max-size") ?? 30000);
const showsMissed = flags.has("show-missed");

// ───────────────────────────── the ways to damage a text ─────────────────────────────

const token =
  /\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/|#?[A-Za-z_$][\w$]*|\d[\w.]*|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|=>|\?\.|\?\?=?|\*\*=?|\.\.\.|[<>=!]=+|&&=?|\|\|=?|[-+*/%&|^]=|\+\+|--|<<|>>>?|./gsu;
const isSpace = (it: string) => /^\s/.test(it);
const isComment = (it: string) => it.startsWith("//") || it.startsWith("/*");
const isCode = (it: string) => !isSpace(it) && !isComment(it);
const isString = (it: string) => /^["']/.test(it) && it.length > 1;
const isTemplate = (it: string) => it.startsWith("`") && it.length > 1;
const isNumber = (it: string) => /^\d/.test(it);
const isWord = (it: string) => /^[#\w$]/.test(it);

/// The indexes of the tokens that `test` accepts.
const where = (tokens: string[], test: (it: string, at: number) => boolean) =>
  tokens.flatMap((it, at) => (test(it, at) ? [at] : []));
const replaced = (tokens: string[], at: number | undefined, count: number, ...by: string[]) =>
  at === undefined ? undefined : tokens.toSpliced(at, count, ...by).join("");
/// The index of the `)` that closes the `(` at `open`.
function closing(tokens: string[], open: number) {
  let depth = 0;
  for (let at = open; at < tokens.length; at++) {
    if (tokens[at] === "(") depth++;
    if (tokens[at] === ")" && --depth === 0) return at;
  }
}
const otherOperator: Record<string, string[]> = {
  "+": ["-", "*"], "-": ["+"], "*": ["/", "+"], "/": ["*"], "%": ["*"], "**": ["*"],
  "===": ["!==", "=="], "!==": ["===", "!="], "==": ["!=", "==="], "!=": ["=="],
  "<": ["<=", ">"], ">": [">=", "<"], "<=": ["<"], ">=": [">"],
  "&&": ["||", "??"], "||": ["&&", "??"], "??": ["||"], "&": ["|"], "|": ["&"], "^": ["&"],
  "=": ["+="], "+=": ["-=", "="], "-=": ["+="], "||=": ["&&="], "??=": ["||="],
  "++": ["--"], "--": ["++"], "<<": [">>"], ">>": [">>>"], "!": ["~", "-"], "?.": ["."], ".": ["?."],
  in: ["instanceof"], instanceof: ["in"], typeof: ["void"], let: ["const", "var"], const: ["let"],
};

type Mutation = (tokens: string[]) => string | undefined;
const mutations: Record<string, Mutation> = {
  "a token is dropped": tokens => replaced(tokens, pick(where(tokens, isCode)), 1),
  "a token is doubled": tokens => {
    const at = pick(where(tokens, isCode));
    return at === undefined ? undefined : replaced(tokens, at, 0, tokens[at], " ");
  },
  "a token is added": tokens => {
    const more = [
      "(", ")", "{", "}", "[", "]", ",", ";", "!", "?", ":", ".", "?.", "...", "=", "-", "+", "*", "<", ">", "|", "&", "0", "''", "a",
      "await", "async", "new", "typeof", "void", "in", "of", "static", "get", "declare", "export", "default", "readonly", "abstract",
    ];
    return replaced(tokens, pick(where(tokens, isCode)), 0, " ", pick(more)!, " ");
  },
  "two tokens are swapped": tokens => {
    const code = where(tokens, isCode);
    const first = below(code.length - 1);
    const [a, b] = [code[first], code[first + 1]];
    if (b === undefined || tokens[a] === tokens[b]) return;
    const swapped = [...tokens];
    [swapped[a], swapped[b]] = [swapped[b], swapped[a]];
    return swapped.join("");
  },
  "parentheses are dropped": tokens => {
    const open = pick(where(tokens, it => it === "("));
    const close = open === undefined ? undefined : closing(tokens, open);
    if (open === undefined || close === undefined) return;
    return tokens.toSpliced(close, 1, " ").toSpliced(open, 1, " ").join("");
  },
  "parentheses are added": tokens => {
    const code = where(tokens, isCode);
    const first = below(code.length);
    const last = Math.min(code.length - 1, first + below(8));
    return tokens.toSpliced(code[last] + 1, 0, ")").toSpliced(code[first], 0, "(").join("");
  },
  "a comment is dropped": tokens => replaced(tokens, pick(where(tokens, isComment)), 1, "\n"),
  "a comment is changed": tokens => {
    const at = pick(where(tokens, it => isComment(it) && it.length > 5));
    return at === undefined ? undefined : replaced(tokens, at, 1, tokens[at].slice(0, 3) + "x" + tokens[at].slice(3));
  },
  "an operator is changed": tokens => {
    const at = pick(where(tokens, it => Object.hasOwn(otherOperator, it)));
    return at === undefined ? undefined : replaced(tokens, at, 1, pick(otherOperator[tokens[at]])!);
  },
  "a name is changed": tokens => {
    const at = pick(where(tokens, it => /^[A-Za-z_$]/.test(it)));
    return at === undefined ? undefined : replaced(tokens, at, 1, tokens[at] + "_");
  },
  "a quote in a string": tokens => {
    const at = pick(where(tokens, it => isString(it) || isTemplate(it)));
    if (at === undefined) return;
    const text = tokens[at];
    const escaped = text.indexOf("\\" + text[0]);
    // One less, or one more.
    if (escaped > 0) return replaced(tokens, at, 1, text.slice(0, escaped) + text.slice(escaped + 2));
    const middle = 1 + below(text.length - 1);
    if (text[middle - 1] === "\\") return;
    return replaced(tokens, at, 1, text.slice(0, middle) + pick(["\\'", '\\"', text[0] === '"' ? "'" : '"'])! + text.slice(middle));
  },
  "an escape for a character": tokens => {
    const at = pick(where(tokens, it => isString(it) && /^.[\w ]/.test(it)));
    if (at === undefined) return;
    return replaced(tokens, at, 1, tokens[at][0] + "\\x" + tokens[at].charCodeAt(1).toString(16).padStart(2, "0") + tokens[at].slice(2));
  },
  "a number is written in another way": tokens => {
    const at = pick(where(tokens, it => /^[1-9]\d*$/.test(it)));
    return at === undefined ? undefined : replaced(tokens, at, 1, pick(["0x" + Number(tokens[at]).toString(16), tokens[at] + "e0"])!);
  },
  "a statement is doubled": tokens => {
    const text = tokens.join("");
    const line = pick([...text.matchAll(/^[ \t]*[^\s/*].*;\n/gm)]);
    return line === undefined ? undefined : text.slice(0, line.index) + line[0] + text.slice(line.index);
  },
  "a decorator is dropped": tokens => {
    const at = pick(where(tokens, (it, at) => it === "@" && isWord(tokens[at + 1] ?? "")));
    if (at === undefined) return;
    const close = tokens[at + 2] === "(" ? closing(tokens, at + 2) : at + 1;
    return close === undefined ? undefined : replaced(tokens, at, close - at + 1);
  },
  "a digit is changed": tokens => {
    const at = pick(where(tokens, isNumber));
    if (at === undefined) return;
    const digit = tokens[at].search(/\d(?!.*\d)/);
    return replaced(tokens, at, 1, tokens[at].slice(0, digit) + ((Number(tokens[at][digit]) + 1) % 8) + tokens[at].slice(digit + 1));
  },
  "white space in a string": tokens => {
    const at = pick(where(tokens, it => (isString(it) || isTemplate(it)) && it.includes(" ")));
    if (at === undefined) return;
    const space = tokens[at].indexOf(" ");
    return replaced(tokens, at, 1, tokens[at].slice(0, space) + pick(["", "  ", "\t"])! + tokens[at].slice(space + 1));
  },
  "a template is indented": tokens => {
    const at = pick(where(tokens, it => isTemplate(it) && it.includes("\n")));
    return at === undefined ? undefined : replaced(tokens, at, 1, tokens[at].replaceAll("\n", "\n  "));
  },
  "white space between tokens is dropped": tokens => {
    const glues = (a: string, b: string) =>
      (isWord(a) && isWord(b)) || (/[-+<>=!&|*/?.]$/.test(a) && /^[-+<>=!&|*/?.]/.test(b)) || (isNumber(a) && b === ".");
    const at = pick(where(tokens, (it, at) => isSpace(it) && at > 0 && at + 1 < tokens.length && glues(tokens[at - 1], tokens[at + 1])));
    return replaced(tokens, at, 1);
  },
  "a line break is dropped": tokens => replaced(tokens, pick(where(tokens, it => isSpace(it) && it.includes("\n"))), 1, " "),
  "a line break is added": tokens => replaced(tokens, pick(where(tokens, it => it === " ")), 1, "\n"),
  "a comma is dropped": tokens => replaced(tokens, pick(where(tokens, it => it === ",")), 1),
  "a comma is doubled": tokens => replaced(tokens, pick(where(tokens, it => it === ",")), 1, ",", ","),
  "a comma for a semicolon": tokens => {
    const at = pick(where(tokens, it => it === "," || it === ";"));
    return at === undefined ? undefined : replaced(tokens, at, 1, tokens[at] === "," ? ";" : ",");
  },
  "a semicolon is dropped": tokens => replaced(tokens, pick(where(tokens, it => it === ";")), 1),
  "braces are dropped": tokens => {
    const open = pick(where(tokens, it => it === "{"));
    if (open === undefined) return;
    let depth = 0;
    for (let at = open; at < tokens.length; at++) {
      if (tokens[at] === "{") depth++;
      if (tokens[at] === "}" && --depth === 0) return tokens.toSpliced(at, 1, " ").toSpliced(open, 1, " ").join("");
    }
  },
};

// What is before, and what must not be made of it.
const cases: [name: string, extension: string, before: string, after: string][] = [
  ["parentheses that mean something", ".js", "f((a, b));", "f(a, b);"],
  ["parentheses that mean something", ".js", "x = (a + b) * c;", "x = a + b * c;"],
  ["parentheses that mean something", ".js", "x = a - (b - c);", "x = a - b - c;"],
  ["parentheses that mean something", ".js", "x = a * (b % c);", "x = a * b % c;"],
  ["parentheses that mean something", ".js", "x = (a, b);", "x = a, b;"],
  ["parentheses that mean something", ".js", "f = x => ({});", "f = x => {};"],
  ["parentheses that mean something", ".js", "f = x => ({ a });", "f = x => { a };"],
  ["parentheses that mean something", ".js", "f = x => ({ a: 1 });", "f = x => { a: 1 };"],
  ["parentheses that mean something", ".js", "(let)[a] = 1;", "let[a] = 1;"],
  ["parentheses that mean something", ".cjs", "(l\\u0065t)[a] = 1;", "let [a] = 1;"],
  ["parentheses that mean something", ".cjs", "(let)\n[a] = 1;", "let\n[a] = 1;"],
  ["parentheses that mean something", ".cjs", "for ((let) of a);", "for (let of a);"],
  ["parentheses that mean something", ".cjs", "for ((let).a in b);", "for (let a in b);"],
  ["parentheses that mean something", ".js", "for ((async) of a);", "for (async of a);"],
  ["parentheses that mean something", ".js", "async () => (await a).b;", "async () => await a.b;"],
  ["parentheses that mean something", ".js", "new (a())();", "new a()();"],
  ["parentheses that mean something", ".js", "new (a.b())();", "new a.b()();"],
  ["parentheses that mean something", ".js", "(a?.b).c;", "a?.b.c;"],
  ["parentheses that mean something", ".js", "(a?.b)();", "a?.b();"],
  ["parentheses that mean something", ".js", "(a && b) || c;", "a && (b || c);"],
  ["parentheses that mean something", ".js", "a || (b && c) || d;", "(a || b) && (c || d);"],
  ["parentheses that mean something", ".js", "(a ? b : c) ? d : e;", "a ? b : c ? d : e;"],
  ["parentheses that mean something", ".js", "(-a) ** b;", "-(a ** b);"],
  ["parentheses that mean something", ".js", "(a ** b) ** c;", "a ** b ** c;"],
  ["parentheses that mean something", ".js", "typeof (a + b);", "typeof a + b;"],
  ["parentheses that mean something", ".js", "!(a in b);", "!a in b;"],
  ["parentheses that mean something", ".js", "(a = b).c;", "a = b.c;"],
  ["parentheses that mean something", ".js", "(() => {})();", "() => {};"],
  ["parentheses that mean something", ".js", "(yield_ => a)(b);", "yield_ => a(b);"],
  ["parentheses that mean something", ".js", "function* f() { (yield a) + b; }", "function* f() { yield a + b; }"],
  ["parentheses that mean something", ".js", "({}).x;", "{}"],
  ["parentheses that mean something", ".js", "({} = x);", "{} x;"],
  ["parentheses that mean something", ".js", "({ a } = x);", "{ a } x;"],
  ["parentheses that mean something", ".js", '("use strict");', '"use strict";'],
  ["parentheses that mean something", ".js", 'function f() { ("use strict"); }', 'function f() { "use strict"; }'],
  ["parentheses that mean something", ".js", "(let)[a] = 1;", "let [a] = 1;"],
  ["parentheses that mean something", ".js", "for ((a in b); ; );", "for (a in b);"],
  ["parentheses that mean something", ".js", "a = (b, c) => d;", "a = b, c => d;"],
  ["parentheses that mean something", ".js", "`${(a, b)}`;", "`${a}${b}`;"],
  ["parentheses that mean something", ".ts", "type A = (B | C)[];", "type A = B | C[];"],
  ["parentheses that mean something", ".ts", "type A = (B & C) | D;", "type A = B & (C | D);"],
  ["parentheses that mean something", ".ts", "type A = (() => B) | C;", "type A = () => B | C;"],
  ["parentheses that mean something", ".ts", "type A = (keyof B)[];", "type A = keyof B[];"],
  ["parentheses that mean something", ".ts", "type A = (typeof b)[number];", "type A = typeof b.number;"],
  ["parentheses that mean something", ".ts", "type A = (B extends C ? D : E) extends F ? G : H;", "type A = B extends C ? D : E extends F ? G : H;"],
  ["parentheses that mean something", ".ts", "(a as B).c;", "a as B.c;"],
  ["parentheses that mean something", ".ts", "(a as B)<C>(d);", "a as B<C>;"],
  ["parentheses that mean something", ".ts", "(a!)?.b;", "a?.b;"],
  ["parentheses that mean something", ".ts", "(<A>b).c;", "<A>b.c;"],
  ["parentheses that mean something", ".ts", "new (a as B)();", "new a() as B;"],
  ["parentheses that mean something", ".tsx", "x = (a, <b />);", "x = a, <b />;"],

  ["tokens that run together", ".js", "x = - -y;", "x = --y;"],
  ["tokens that run together", ".js", "x = + +y;", "x = ++y;"],
  ["tokens that run together", ".js", "x = a + +b;", "x = a++\nb;"],
  ["tokens that run together", ".js", "x = a - -b;", "x = a--\nb;"],
  ["tokens that run together", ".js", "a in b;", "ainb;"],
  ["tokens that run together", ".js", "function f() { return x; }", "function f() { returnx; }"],
  ["tokens that run together", ".js", "typeof a;", "typeofa;"],
  ["tokens that run together", ".js", "x = a / /re/.b;", "x = a //re/.b;\n"],
  ["tokens that run together", ".cjs", "x = a < !--b;", "x = a <!--b;\n"],
  ["tokens that run together", ".js", "x = 1 .a;", "x = 1.0;"],
  ["tokens that run together", ".js", "async function f() {}", "asyncfunction\nf()\n{}"],
  ["tokens that run together", ".js", "x = a ? .5 : b;", "x = a?.b;"],

  ["a line break that means something", ".js", "function f() { return a; }", "function f() { return\na; }"],
  ["a line break that means something", ".js", "a\n++b;", "a++\nb;"],
  ["a line break that means something", ".js", "a;\n(b);", "a\n(b);"],
  ["a line break that means something", ".js", "a;\n[b];", "a\n[b];"],
  ["a line break that means something", ".js", "a;\n`b`;", "a\n`b`;"],
  ["a line break that means something", ".js", "a;\n+b;", "a\n+b;"],
  ["a line break that means something", ".js", "a;\n/b/g;", "a\n/b/g;"],
  ["a line break that means something", ".js", "class A { a = 1; [b] = 2 }", "class A { a = 1\n[b] = 2 }"],
  ["a line break that means something", ".js", "class A { get; a() {} }", "class A { get\na() {} }"],
  ["a line break that means something", ".js", "class A { static; a() {} }", "class A { static\na() {} }"],
  ["a line break that means something", ".js", "l: for (;;) { continue l; }", "l: for (;;) { continue\nl; }"],
  ["a line break that means something", ".js", "x = async (a) => b;", "x = async\n(a);"],
  ["a line break that means something", ".ts", "type A = B;\n[c];", "type A = B[c];"],
  ["a line break that means something", ".ts", "interface A { a; (b): c }", "interface A { a(b): c }"],
  ["a line break that means something", ".ts", "declare module\nA\n{}", "declare module A {}"],
  ["a line break that means something", ".ts", "abstract\nclass A {}", "abstract class A {}"],

  ["commas", ".js", "x = [a, , b];", "x = [a, b];"],
  ["commas", ".js", "x = [a, b, ,];", "x = [a, b];"],
  ["commas", ".js", "x = [, a];", "x = [a];"],
  ["commas", ".js", "[a, , b] = x;", "[a, b] = x;"],
  ["commas", ".js", "f(a, b);", "f(a);\nb;"],
  ["commas", ".js", "let a, b;", "let a;\nb;"],
  ["commas", ".js", "a, b;", "a;\nb;"],
  ["commas", ".js", "let a;\nif (b);", "let a,\nif (b);"],
  ["commas", ".js", "let a;", "let a,;"],
  ["commas", ".js", "class A extends B {}", "class A extends B, {}"],
  ["commas", ".ts", "let a;\nif (b);", "let a,\nif (b);"],
  ["commas", ".ts", "let a;", "let a,;"],
  ["commas", ".ts", "class A extends B {}", "class A extends B, {}"],
  ["commas", ".ts", "class A extends B<C> {}", "class A extends B<C>, {}"],
  ["commas", ".ts", "class A implements B {}", "class A implements B, {}"],
  ["commas", ".ts", "interface A extends B {}", "interface A extends B, {}"],
  ["commas", ".ts", "class A { [a: string]: B; c }", "class A { [a: string]: B, c }"],
  ["commas", ".ts", "type A = [a: B, c: D];", "type A = [a: B];"],
  ["commas", ".ts", "x = <T,>(a) => b;", "x = <T, U>(a) => b;"],

  ["strings", ".js", 'x = "a  b";', 'x = "a b";'],
  ["strings", ".js", 'x = "a b";', 'x = "a\\tb";'],
  ["strings", ".js", "x = 'it\\'s';", 'x = "its";'],
  ["strings", ".js", "x = '\"';", "x = \"'\";"],
  ["strings", ".js", 'x = "\\\\";', 'x = "\\\\\\\\";'],
  ["strings", ".js", 'x = "a";', "x = `a`;"],
  ["strings", ".js", 'x = "\\x61";', 'x = "a";'],
  ["strings", ".js", 'x = "\\u0061";', 'x = "\\x61";'],
  ["strings", ".js", 'x = "\\a";', 'x = "a";'],
  ["strings", ".js", 'import a from "\\x61";', 'import a from "a";'],
  ["strings", ".ts", 'type A = "\\x61";', 'type A = "a";'],
  ["strings", ".ts", 'declare module "\\x61" {}', 'declare module "a" {}'],
  ["strings", ".js", 'import { "\\x61" as b } from "c";', 'import { "a" as b } from "c";'],
  ["strings", ".js", 'export { a as "\\x62" };', 'export { a as "b" };'],
  ["strings", ".js", 'export * as "\\x61" from "b";', 'export * as "a" from "b";'],
  ["strings", ".jsx", 'x = <a>b{"\\x20"}</a>;', "x = <a>b</a>;"],
  ["strings", ".js", 'x = "a"; // b', 'x = "a // b";'],
  ["strings", ".js", "x = `a`; /* b */", "x = `a /* b */`;"],
  ["strings", ".js", "x = `a\n  b`;", "x = `a\nb`;"],
  ["strings", ".js", "x = `a${b} c`;", "x = `a${b}c`;"],
  ["strings", ".js", "x = `a${b}c${d}`;", "x = `a${d}c${b}`;"],
  ["strings", ".js", "x = f`\\n`;", "x = f`\n`;"],
  ["strings", ".js", "x = /a b/g;", "x = /ab/g;"],
  ["strings", ".js", "x = /a/gi;", "x = /a/g;"],
  ["strings", ".jsx", 'x = <a b="c d" />;', 'x = <a b="cd" />;'],
  ["strings", ".jsx", 'x = <a b="c" />;', 'x = <a b={c} />;'],
  ["strings", ".jsx", "x = <a>b c</a>;", "x = <a>bc</a>;"],
  ["strings", ".jsx", "x = <a>b</a>;", "x = <a>{b}</a>;"],
  ["strings", ".jsx", "x = <a>{/* b */}</a>;", "x = <a></a>;"],
  ["strings", ".jsx", "x = <a>\u00a0\n</a>;", "x = <a></a>;"],
  ["strings", ".ts", 'type A = "a b";', 'type A = "ab";'],
  ["strings", ".ts", "type A = `a ${B}`;", "type A = `a${B}`;"],

  ["numbers", ".js", "x = 10;", "x = 1;"],
  ["numbers", ".js", "x = 1.5;", "x = 15;"],
  ["numbers", ".js", "x = 0x10;", "x = 10;"],
  ["numbers", ".js", "x = 1e3;", "x = 1e-3;"],
  ["numbers", ".js", "x = 10n;", "x = 11n;"],
  ["numbers", ".js", "x = 10n;", "x = 10;"],
  ["numbers", ".js", "x = { 1: a };", "x = { 2: a };"],
  ["numbers", ".js", "x = 0x10;", "x = 16;"],
  ["numbers", ".js", "x = 1e3;", "x = 1000;"],
  ["numbers", ".js", "x = 1_000;", "x = 1000;"],
  ["numbers", ".js", "x = { 0x10: a };", "x = { 16: a };"],
  ["numbers", ".js", "x = { 1e3: a };", "x = { 1000: a };"],
  ["numbers", ".js", 'x = { "1": a };', "x = { 0x1: a };"],
  ["numbers", ".js", 'x = { 1e3: a };', 'x = { "1000": a };'],
  ["numbers", ".ts", "type A = 0x10;", "type A = 16;"],
  ["numbers", ".js", "x = { 1n: a };", "x = { 2n: a };"],
  ["numbers", ".ts", "type A = -1;", "type A = 1;"],

  ["keys", ".js", "x = { a: 1 };", "x = { [a]: 1 };"],
  ["keys", ".js", 'x = { "a": 1 };', 'x = { ["a"]: 1 };'],
  ["keys", ".js", "x = { a };", "x = { a: a };"],
  ["keys", ".js", "({ a } = x);", "({ a: a } = x);"],
  ["keys", ".js", "let { a } = x;", "let { a: a } = x;"],
  ["keys", ".js", 'x = { "a-b": 1 };', 'x = { "a_b": 1 };'],
  ["keys", ".js", "class A { #a; }", "class A { a; }"],
  ["keys", ".js", 'class A { "\\x63onstructor"() {} }', "class A { constructor() {} }"],
  ["keys", ".js", 'class A { "\\x63onstructor"() {} }', "class A { \\x63onstructor() {} }"],
  ["keys", ".js", 'class A { "\\x61"() {} }', "class A { a() {} }"],
  ["keys", ".js", 'class A { "\\x61" = 1 }', "class A { a = 1 }"],
  ["keys", ".js", 'x = { "\\x63onstructor": 1 };', "x = { constructor: 1 };"],
  ["keys", ".js", 'x = { "\\x61": 1 };', 'x = { "a": 1 };'],
  ["keys", ".js", 'x = { ["\\x61"]: 1 };', 'x = { ["a"]: 1 };'],
  ["keys", ".js", 'let { "\\x61": b } = c;', "let { a: b } = c;"],
  ["keys", ".ts", 'interface A { "\\x61": B }', "interface A { a: B }"],
  ["keys", ".ts", 'enum A { "\\x61" = 1 }', "enum A { a = 1 }"],
  ["keys", ".js", "class A { static constructor() {} }", "class A { constructor() {} }"],

  ["members of types", ".ts", "interface A { a: B; c: D }", "interface A { a: B }"],
  ["members of types", ".ts", "interface A { a: B, c: D }", "interface A { a: B | c }"],
  ["members of types", ".ts", "type A = { a?: B };", "type A = { a: B };"],
  ["members of types", ".ts", "type A = { readonly a: B };", "type A = { a: B };"],
  ["members of types", ".ts", "type A = { -readonly [K in B]: C };", "type A = { readonly [K in B]: C };"],
  ["members of types", ".ts", "type A = { [K in B]+?: C };", "type A = { [K in B]-?: C };"],
  ["members of types", ".ts", "type A = | B | C;", "type A = B & C;"],
  ["members of types", ".ts", "type A = [a?: B];", "type A = [a: B];"],
  ["members of types", ".ts", "type A = [...B];", "type A = [B];"],

  ["keywords", ".js", "async function f() {}", "function f() {}"],
  ["keywords", ".js", "function* f() {}", "function f() {}"],
  ["keywords", ".js", "class A { static a() {} }", "class A { a() {} }"],
  ["keywords", ".js", "class A { get a() {} }", "class A { a() {} }"],
  ["keywords", ".js", "class A { static {} }", "class A { static() {} }"],
  ["keywords", ".js", "async () => { for await (a of b); }", "async () => { for (a of b); }"],
  ["keywords", ".js", "for (a of b);", "for (a in b);"],
  ["keywords", ".js", "let a;", "var a;"],
  ["keywords", ".js", "export default a;", "export { a };"],
  ["keywords", ".js", 'export * from "a";', 'export * as b from "a";'],
  ["keywords", ".js", 'import a from "a";', 'import * as a from "a";'],
  ["keywords", ".js", 'import a from "a";', 'import { a } from "a";'],
  ["keywords", ".js", 'import {} from "a";', 'import "a";'],
  ["keywords", ".js", 'import a from "a" with { type: "json" };', 'import a from "a";'],
  ["keywords", ".js", 'import a from "a" with { type: "json" };', 'import a from "a" with { type: "css" };'],
  ["keywords", ".js", "if (a) b; else c;", "if (a) b;\nc;"],
  ["keywords", ".js", "if (a) { b; }", "if (a) b;"],
  ["keywords", ".js", "if (a) { if (b) c; } else d;", "if (a) if (b) c; else d;"],
  ["keywords", ".js", "if (a);", "if (a) {}"],
  ["keywords", ".js", "do a; while (b);", "while (b) a;"],
  ["keywords", ".js", "a: b;", "b;"],
  ["keywords", ".js", "with (a) b;", "{ a; b; }"],
  ["keywords", ".js", "new a;", "a();"],
  ["keywords", ".js", "function f() { new.target; }", "function f() { target; }"],
  ["keywords", ".ts", 'import type a from "a";', 'import a from "a";'],
  ["keywords", ".ts", 'import { type a } from "a";', 'import { a } from "a";'],
  ["keywords", ".ts", "declare const a: B;", "const a: B = c;"],
  ["keywords", ".ts", "declare function f(): void;", "function f(): void;"],
  ["keywords", ".ts", "declare namespace A { const a: B; }", "declare namespace A { declare const a: B; }"],
  ["keywords", ".ts", "namespace A {}", "module A {}"],
  ["keywords", ".ts", "const enum A {}", "enum A {}"],
  ["keywords", ".ts", "abstract class A {}", "class A {}"],
  ["keywords", ".ts", "class A { private a; }", "class A { public a; }"],
  ["keywords", ".ts", "class A { a!: B; }", "class A { a: B; }"],
  ["keywords", ".ts", "class A { a?: B; }", "class A { a: B; }"],
  ["keywords", ".ts", "class A { constructor(private a) {} }", "class A { constructor(a) {} }"],
  ["keywords", ".ts", "class A { @a b; }", "class A { b; }"],
  ["keywords", ".ts", "class A { @a @b c; }", "class A { @b @a c; }"],
  ["keywords", ".ts", "@a class B {}", "class B {}"],
  ["keywords", ".ts", "@a export class B {}", "export class B {}"],
  ["keywords", ".ts", "@a export class B {}", "export @a class B {}"],
  ["keywords", ".ts", "export default @a class {}", "export default class {}"],
  ["keywords", ".ts", "x = @a class {};", "x = class {};"],
  ["keywords", ".ts", "class A { @a() b() {} }", "class A { b() {} }"],
  ["keywords", ".ts", "class A { @a() b() {} }", "class A { @a b() {} }"],
  ["keywords", ".ts", "class A { b(@c d) {} }", "class A { b(d) {} }"],
  ["keywords", ".ts", "class A { constructor(@b private c) {} }", "class A { constructor(private c) {} }"],
  ["keywords", ".js", "a();", "a();\na();"],
  ["keywords", ".js", "a();\nb();", "a();\nb();\nb();"],
  ["keywords", ".js", "function f() { a(); }", "function f() { a(); a(); }"],
  ["keywords", ".js", "class A { a() {} }", "class A { a() {} a() {} }"],
  ["keywords", ".js", "#!a\u2028b();", "#!a\u2028b();\nb();"],
  ["keywords", ".ts", "a as B;", "a satisfies B;"],
  ["keywords", ".ts", "a as const;", "a as Const;"],
  ["keywords", ".ts", "a!;", "a;"],
  ["keywords", ".ts", "a!!;", "a!;"],
  ["keywords", ".ts", "function f(a?: B) {}", "function f(a: B) {}"],
  ["keywords", ".ts", "function f(this: A) {}", "function f(that: A) {}"],
  ["keywords", ".ts", "function f(a): a is B {}", "function f(a): asserts a is B {}"],
  ["keywords", ".ts", "type A = new () => B;", "type A = () => B;"],
  ["keywords", ".ts", "type A = abstract new () => B;", "type A = new () => B;"],
  ["keywords", ".ts", "type A = typeof b;", "type A = b;"],
  ["keywords", ".ts", "type A = keyof B;", "type A = readonly B[];"],
  ["keywords", ".ts", "type A = unique symbol;", "type A = symbol;"],
  ["keywords", ".ts", "type A<in T> = B;", "type A<out T> = B;"],
  ["keywords", ".ts", "type A<T extends B> = C;", "type A<T = B> = C;"],
  ["keywords", ".ts", 'type A = import("a");', 'type A = typeof import("a");'],
  ["keywords", ".ts", "f<A>(b);", "f(b);"],
  ["keywords", ".ts", "export = a;", "export default a;"],
  ["keywords", ".ts", 'import a = require("a");', "import a = b.c;"],
  ["keywords", ".ts", "export import a = b;", "import a = b;"],
  ["keywords", ".tsx", "x = <a {...b} />;", "x = <a b />;"],
  ["keywords", ".tsx", "x = <a></a>;", "x = <a />;"],
  ["keywords", ".tsx", "x = <></>;", "x = <a></a>;"],
  ["keywords", ".tsx", "x = <a.b />;", "x = <a:b />;"],

  ["comments", ".js", "a; // b", "a;"],
  ["comments", ".ts", "type A = {\n  /** doc */ a: 1; // prettier-ignore\n};", "type A = {\n  a: 1; // prettier-ignore\n};"],
  ["comments", ".ts", "type A = {\n  /** doc */ a: 1; // prettier-ignore\n};", "type A = {\n  /** doc */ a: 1;\n};"],
  ["comments", ".ts", "class A {\n  /** doc */ a = 1; // prettier-ignore\n}", "class A {\n  a = 1; // prettier-ignore\n}"],
  ["comments", ".js", "x = {\n  /** doc */ a: 1, // prettier-ignore\n};", "x = {\n  a: 1, // prettier-ignore\n};"],
  ["comments", ".js", "a; // b", "a; // b\n// b"],
  ["comments", ".js", "#!a\u2028b;", "#!c\u2028b;"],
  ["comments", ".js", "a; /* b */", "a; // b"],
  ["comments", ".js", "a; // b", "a; // c"],
  ["comments", ".js", "a; // b\n// c", "a; // b // c"],
  ["comments", ".js", "/* a\n b */", "/* a b */"],
  ["comments", ".js", "/* a\n\n b */", "/* a\n b */"],
  ["comments", ".js", "/* a */ /* a */ b;", "/* a */ b;"],
  ["comments", ".js", "#!/usr/bin/env a\nb;", "b;"],
  ["comments", ".js", "#!/usr/bin/env a\nb;", "#!/usr/bin/env c\nb;"],
  ["comments", ".cjs", "a;\n<!-- b\n", "a;\n"],
  ["comments", ".cjs", "a;\n--> b\n", "a;\n"],
  ["comments", ".cjs", "a;\n<!-- b\n", "a;\n<!-- bc\n"],
];

// What the formatter does. It must not be taken for a difference.
const allowed: [extension: string, before: string, after: string][] = [
  [".js", "a && (b && c);", "a && b && c;"],
  [".js", "(a || b) || (c || (d || e));", "a || b || c || d || e;"],
  [".js", "a ?? (b ?? c);", "a ?? b ?? c;"],
  [".js", "((a));;", "a;"],
  [".js", "x = (a * b) + c;", "x = a * b + c;"],
  [".js", "x = a => a;", "x = (a) => a;"],
  [".js", "new A;", "new A();"],
  [".js", "x = 'a';", 'x = "a";'],
  [".js", "x = 'it\\'s';", 'x = "it\'s";'],
  [".js", "x = '\\d';", 'x = "\\d";'],
  [".js", "'use strict';", '"use strict";'],
  [".js", "a;\n'b';", 'a;\n("b");'],
  [".js", "{ 'a'; }", '{\n  ("a");\n}'],
  [".js", "x = 0XAB + 1.0 + .5 + 1E5 + 1_0 + 0.0e10 + 5.;", "x = 0xab + 1.0 + 0.5 + 1e5 + 1_0 + 0.0e10 + 5;"],
  [".js", "x = 10n;y = 0XABn;", "x = 10n;\ny = 0xabn;"],
  [".js", 'x = { "a": 1, b: 2 };', "x = { a: 1, b: 2 };"],
  [".js", "x = { a: 1, 'b-c': 2 };", 'x = { a: 1, "b-c": 2 };'],
  [".js", "x = { 1: 1, 'b': 2 };", "x = { 1: 1, b: 2 };"],
  [".js", "x = { a: 1, 999: 2 };", 'x = { a: 1, 999: 2 };'],
  [".js", "x = { 0x1: 1, 1e3: 2 };", "x = { 0x1: 1, 1e3: 2 };"],
  [".js", "x = { .5: 1, 1.50: 2, 'a-b': 3 };", 'x = { "0.5": 1, "1.5": 2, "a-b": 3 };'],
  [".js", 'class A { "constructor"() {} }', "class A {\n  constructor() {}\n}"],
  [".js", 'class A { "a"() {} }', "class A {\n  a() {}\n}"],
  [".js", "x = /a/gimsuy;", "x = /a/gimsuy;"],
  [".js", "x = /a/yg;", "x = /a/gy;"],
  [".js", "x = [a, b,];f(a,);", "x = [a, b];\nf(a);"],
  [".js", 'import a, {} from "a";', 'import a from "a";'],
  [".js", 'import {a,} from "a";', 'import { a } from "a";'],
  [".js", "\\u0061b;", "ab;"],
  [".js", "x = css`a{color:red}`;", "x = css`\n  a {\n    color: red;\n  }\n`;"],
  [".js", "x = gql`query{a}`;", "x = gql`\n  query {\n    a\n  }\n`;"],
  [".js", "x = /* GraphQL */ `query{a}`;", "x = /* GraphQL */ `\n  query {\n    a\n  }\n`;"],
  [".js", "x = markdown`\n  # a\n  b\n`;", "x = markdown`\n  # a\n\n  b\n`;"],
  [".js", "describe.each`\na|b\n${1}|${2}\n`(c);", "describe.each`\n  a    | b\n  ${1} | ${2}\n`(c);"],
  [".js", "x = `a\r\nb${c}\r\n`;\r\n", "x = `a\nb${c}\n`;\n"],
  [".js", "x = `a\nb`;\n/* c\n d */", "x = `a\r\nb`;\r\n/* c\r\n d */\r\n"],
  [".jsx", 'x = <a b="c\r\nd" />;', 'x = <a b="c\nd" />;'],
  [".js", "/**\n* a\n   */\nb;", "/**\n * a\n */\nb;"],
  [".js", "/* a\r b\r\r c */\rd;", "/* a\n b\n\n c */\nd;\n"],
  [".js", "x = 'a\\\rb';", 'x = "a\\\nb";'],
  [".jsx", "x = <a : b c : d={1}></a : b>;", "x = <a:b c:d={1}></a:b>;"],
  [".js", "#!a\u2028b;", "#!a\nb;\n"],
  [".js", "#!a\u2029b;", "#!a\nb;\n"],
  [".js", "#!a\rb;", "#!a\nb;\n"],
  [".js", "#!a  \r\nb;", "#!a\nb;\n"],
  [".js", "x = 'a\\\r\nb';", 'x = "a\\\nb";'],
  [".js", "x = '\\x61\\'\"';", "x = '\\x61\\'\"';"],
  [".js", "x = '\\x61\\'';", 'x = "\\x61\'";'],
  [".js", "f(/* a */ b /* c */);", "f(/* c */ /* a */ b);"],
  [".js", "if (a) {;}", "if (a) {\n}"],
  [".js", "class A { a;; b }", "class A {\n  a;\n  b;\n}"],
  [".js", "for (;;);", "for (;;);"],
  [".jsx", "x = <a>b   c\n  d</a>;", "x = (\n  <a>\n    b c d\n  </a>\n);"],
  [".jsx", 'x = <a>b{" "}c</a>;', "x = <a>b c</a>;"],
  [".jsx", 'x = <a>b{" "}\n<c /></a>;', "x = (\n  <a>\n    b <c />\n  </a>\n);"],
  [".jsx", "x = <a>\u00a0 \u00a0</a>;", "x = (\n  <a>\n    \u00a0 \u00a0\n  </a>\n);"],
  [".jsx", "x = <a>   </a>;", 'x = (\n  <a>\n    {" "}\n  </a>\n);'],
  [".jsx", "x = <a b='c' />;", 'x = <a b="c" />;'],
  [".jsx", "x = <a b='&quot;' />;", "x = <a b='\"' />;"],
  [".jsx", 'x = <a b="&apos;" />;', 'x = <a b="\'" />;'],
  [".ts", "type A = | B;", "type A = B;"],
  [".ts", "type A = | B | C;", "type A = B | C;"],
  [".ts", "type A = & B;", "type A = B;"],
  [".ts", "type A = (B);", "type A = B;"],
  [".ts", "type A = ((B | C))[];", "type A = (B | C)[];"],
  [".ts", "interface A { a: B, c: D, }", "interface A {\n  a: B;\n  c: D;\n}"],
  [".ts", "type A = { a: B, c(): D };", "type A = { a: B; c(): D };"],
  [".ts", 'interface A { "a": B; "b"(): C }', "interface A {\n  a: B;\n  b(): C;\n}"],
  [".ts", 'enum A { "a" = 1 }', "enum A {\n  a = 1,\n}"],
  [".ts", "class A { readonly abstract a; static public b; }", "class A {\n  abstract readonly a;\n  public static b;\n}"],
  [".ts", "x = <T,>(a) => b;", "x = <T,>(a) => b;"],
  [".ts", "function f<T,>(a,) {}", "function f<T>(a) {}"],
];

// ───────────────────────────── the two servers ─────────────────────────────

class Server {
  #process;
  #reader;
  #buffered = new Uint8Array(0);
  constructor(command: string) {
    this.#process = Bun.spawn({ cmd: [bin!, "format", command], stdin: "pipe", stdout: "pipe", stderr: "inherit" });
    this.#reader = this.#process.stdout.getReader();
  }
  write(...parts: (string | Uint8Array)[]) {
    for (const part of parts) this.#process.stdin.write(part);
    this.#process.stdin.flush();
  }
  async #fill() {
    const { value, done } = await this.#reader.read();
    if (done) throw new Error("bun-lint has exited");
    const joined = new Uint8Array(this.#buffered.length + value.length);
    joined.set(this.#buffered);
    joined.set(value, this.#buffered.length);
    this.#buffered = joined;
  }
  async bytes(length: number) {
    while (this.#buffered.length < length) await this.#fill();
    const bytes = this.#buffered.subarray(0, length);
    this.#buffered = this.#buffered.subarray(length);
    return new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
  }
  async line() {
    let end: number;
    while ((end = this.#buffered.indexOf(10)) < 0) await this.#fill();
    const line = await this.bytes(end);
    await this.bytes(1);
    return line;
  }
  end() {
    this.#process.stdin.end();
  }
}

const formatter = new Server("serve");
async function format(path: string) {
  formatter.write(path + "\n");
  const line = await formatter.line();
  return line.startsWith("ok ") ? await formatter.bytes(Number(line.slice(3))) : undefined;
}

const verifier = new Server("verify-pairs");
/// `same`, `different (..)`, or `not compared` if `before` does not parse.
async function verify(name: string, before: string, after: string) {
  const [a, b] = [new TextEncoder().encode(before), new TextEncoder().encode(after)];
  verifier.write(`${a.length} ${b.length} ${name}\n`, a, b);
  return await verifier.line();
}

// ───────────────────────────── the table ─────────────────────────────

class Row {
  mutants = 0;
  unparsable = 0;
  noticed = 0;
  missed = 0;
}
const rows = new Map<string, Row>();
function excerpt(before: string, after: string) {
  let start = 0;
  while (start < after.length && before[start] === after[start]) start++;
  const from = Math.max(0, start - 50);
  return `    ${JSON.stringify(before.slice(from, start + 50))}\n    ${JSON.stringify(after.slice(from, start + 50))}`;
}
/// `formatted`: what `after` is a damaged copy of.
async function count(kind: string, name: string, before: string, formatted: string, after: string) {
  const verdict = await verify(name, before, after);
  if (verdict === "not compared") return verdict;
  let row = rows.get(kind);
  if (!row) rows.set(kind, (row = new Row()));
  row.mutants++;
  if (verdict.startsWith("different (a syntax error")) row.unparsable++;
  else if (verdict !== "same") row.noticed++;
  else {
    row.missed++;
    if (showsMissed) console.log(`${kind}: ${name}\n${excerpt(formatted, after)}`);
  }
  return verdict;
}

let failures = 0;
for (const [kind, extension, before, after] of cases) {
  const verdict = await count(kind, "case" + extension, before, before, after);
  if (!verdict.startsWith("different")) {
    failures++;
    console.log(`NOT NOTICED (${verdict}): ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
  }
}
for (const [extension, before, after] of allowed) {
  const verdict = await verify("case" + extension, before, after);
  if (verdict !== "same") {
    failures++;
    console.log(`A FALSE ALARM: ${JSON.stringify(before)} -> ${JSON.stringify(after)}: ${verdict}`);
  }
}

const extensions = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"]);
function* walk(path: string): Generator<string> {
  const stats = statSync(path, { throwIfNoEntry: false });
  if (!stats) return;
  if (stats.isDirectory()) {
    for (const name of readdirSync(path).sort()) {
      if (name !== "node_modules" && name !== ".git") yield* walk(join(path, name));
    }
  } else if (extensions.has(extname(path)) && stats.size <= maxSize) {
    yield path;
  }
}
let files = [...new Set(roots.flatMap(root => [...walk(root)]))];
// An even sample.
if (files.length > limit) files = files.filter((_, at) => Math.floor((at * limit) / files.length) !== Math.floor(((at - 1) * limit) / files.length));
for (const path of files) {
  const formatted = await format(path);
  if (formatted === undefined) continue;
  const before = readFileSync(path, "utf8");
  if ((await verify(path, before, formatted)) !== "same") continue;
  const tokens = formatted.match(token) ?? [];
  for (const [kind, mutate] of Object.entries(mutations)) {
    for (let n = 0; n < perClass; n++) {
      const after = mutate(tokens);
      if (after !== undefined && after !== formatted) await count(kind, path, before, formatted, after);
    }
  }
}
formatter.end();
verifier.end();

const header = ["", "mutants", "do not parse", "parse", "noticed", "not noticed"];
console.log(`| ${header.join(" | ")} |\n|${header.map(() => " --- ").join("|")}|`);
const total = new Row();
const print = (kind: string, row: Row) =>
  console.log(`| ${[kind, row.mutants, row.unparsable, row.mutants - row.unparsable, row.noticed, row.missed].join(" | ")} |`);
for (const [kind, row] of rows) {
  print(kind, row);
  for (const key of ["mutants", "unparsable", "noticed", "missed"] as const) total[key] += row[key];
}
print("all", total);
process.exit(failures > 0 ? 1 : 0);
