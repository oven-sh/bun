// Every kind of expression in every kind of parent: parentheses.
//   bun expressions-in-parents.ts --bin=<bun-lint> --prettier=<directory with node_modules/prettier> --dir=<directory for temporary files> [--long=1] [--max=200] [--only=regex]
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
const flags = new Map<string, string>();
for (const arg of process.argv.slice(2)) { const m = /^--([\w-]+)=(.*)$/s.exec(arg); if (m) flags.set(m[1], m[2]); }
const bin = flags.get("bin")!;
const long = flags.has("long");
const dir = flags.get("dir")!;
mkdirSync(dir, { recursive: true });
const prettier = await import(resolve(flags.get("prettier")!, "node_modules/prettier/index.mjs"));

const binops = ["+", "-", "*", "/", "%", "**", "<<", ">>", ">>>", "&", "|", "^", "==", "===", "!=", "<", ">=", "in", "instanceof", "&&", "||", "??"];
const children: string[] = [
  "a", "1", "1.5", "'s'", "`t`", "`t${a}`", "/r/", "1n", "null", "true", "this", "import.meta", "{}", "{a:1}", "[]", "[a]",
  "function(){}", "function g(){}", "class{}", "class B{}", "()=>{}", "()=>a", "async()=>a", "a=>a", "async function(){}", "function*(){}",
  "!a", "-a", "+a", "~a", "typeof a", "void a", "delete a.b", "a++", "a--", "++a", "--a",
  ...binops.map(op => `a ${op} b`),
  "a?b:c", "a=b", "a+=b", "{a}=b", "[a]=b", "a,b",
  "a()", "a.b()", "a?.()", "a?.b", "a?.b()", "a?.[0]", "a?.b.c", "a.b", "a[0]", "a.b.c", "a().b", "a()()", "a.b().c", "a[0]()",
  "new a", "new a()", "new a.b()", "new (a())()", "new a().b", "import('a')", "import('a').b", "a`t`", "a.b`t`", "a()`t`",
  "await a", "yield a", "yield", "yield* a",
  "a!", "a?.b!", "a!.b", "a?.b!.c", "(a?.b)!", "(a?.b)!.c", "(a?.b).c", "(a?.b)()", "a()!", "a.b!",
  "a as T", "a satisfies T", "<T>a", "a as const", "a<T>", "a as T as U",
  "<a/>", "<></>", "<a>b</a>",
  "let", "async", "yield", "type", "let[0]", "let.a",
  "#p in a",
];
const parents: string[] = [
  "$;", "$.b;", "$[0];", "$();", "$?.b;", "$?.();", "$?.[0];", "new $();", "new $;", "$`t`;", "$!;", "$++;", "++$;", "$.b.c;", "$.b();", "$().b;", "$!.b;", "$!();", "$?.b.c;", "new $.b();", "new ($())();", "new ($!)();",
  "!$;", "-$;", "+$;", "~$;", "typeof $;", "void $;", "delete $;", "await $;", "yield $;", "yield* $;", "[...$];", "f(...$);", "x = {...$};",
  ...binops.flatMap(op => [`$ ${op} x;`, `x ${op} $;`]),
  "$ ? x : y;", "x ? $ : y;", "x ? y : $;", "x = $;", "$ = x;", "x += $;", "$ += x;", "x = y = $;", "x, $;", "$, x;", "f(($, x));",
  "f($);", "f(x, $);", "[$];", "x = {a: $};", "x = {[$]: 1};", "x[$];", "`${$}`;", "x`${$}`;",
  "() => $;", "async () => $;", "x = () => $;", "() => $.b;", "() => $();", "() => $ ? 1 : 2;", "() => $ + 1;", "() => ($, 1);", "() => ($ = 1);", "() => $`t`;", "() => $ as T;", "() => $!;", "() => () => $;",
  "$ as T;", "$ satisfies T;", "<T>$;", "$<T>;", "$ as const;", "x = $ as T;", "x = <T>$;", "($ as T).b;", "f($ as T);",
  "class A extends $ {}", "x = class extends $ {};", "class A extends $.b {}", "class A extends $() {}", "class A extends ($!) {}",
  "export default $;", "export default $.b;", "export default $();", "export default $ + 1;", "export default $`t`;", "export default $ ? 1 : 2;", "export default ($, 1);", "export default $ as T;", "export default $!;", "export default $?.b;", "export default $[0];", "export default ($ = 1);", "export default $++;", "export default $.b();", "export default new $();",
  "function g() { return $; }", "function g() { throw $; }", "function g() { return $.b; }",
  "if ($) ;", "while ($) ;", "do ; while ($);", "for ($;;) ;", "for (;$;) ;", "for (;;$) ;", "for ($ in x) ;", "for ($ of x) ;", "for (x of $) ;", "for (x in $) ;", "for (var x = $;;) ;", "for (var x = $ in y) ;", "for (var x = f($);;) ;", "for (var x = () => $;;) ;", "for (var x = () => { $; };;) ;", "for ($.b of x) ;", "for ($.b in x) ;", "for ($[0] of x) ;", "for await ($ of x) ;", "for (x = $;;) ;", "for ((x, $);;) ;", "for (x = 1, y = $;;) ;",
  "var x = $;", "var {a = $} = x;", "var [a = $] = x;", "function g(a = $) {}", "({a = $} = x);", "[a = $] = x;", "({a: $} = x);", "[$] = x;", "[$ = 1] = x;", "({a: $ = 1} = x);", "[...$] = x;",
  "switch ($) { case $: }", "with ($) ;", "x: $;",
  "@$ class A {}", "@$.b class A {}", "@$() class A {}", "class A { @$ m() {} }",
  "x = <a b={$} />;", "x = <a>{$}</a>;", "x = <a {...$} />;", "x = <a>{...$}</a>;",
  "class A { x = $; }", "class A { [$] = 1; }", "class A { static { $; } }", "class A { [$]() {} }", "class A { static x = $; }",
  "$.b = 1;", "$[0] = 1;", "$() + 1;", "$.b ? 1 : 2;", "$ + 1 + 2;", "$ ? 1 : 2, 3;", "$ as T as U;", "$.b as T;", "$++ + 1;", "$`t`.b;", "$.b`t`;",
  "interface A { [$]: 1 }", "type A = typeof $;", "enum A { B = $ }", "x = $ satisfies T;", "import x = require($);", "export = $;",
  "f(function() { $; });", "f(() => { $; });", "{ $; }", "x = (y = $);", "x = $ || {};", "x = $ && [1];", "f(a => $);", "f(a => b => $);",
];
const L: Record<string, string> = {
  a: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", b: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", c: "cccccccccccccccccccccccccccccccccccccccc",
  x: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", y: "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy", T: "TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT", f: "ffffffffffffffffffffff",
};
const lengthen = (s: string) => long ? s.replace(/(?<![\w$#'`<\/.])\b([abcxyTf])\b(?![\w'`:])/g, (_, n) => L[n]) : s;
type Case = { code: string; ext: string; parent: string; child: string };
const cases: Case[] = [];
const only = flags.has("only") ? new RegExp(flags.get("only")!) : null;
const forms = flags.has("noparen") ? ["$"] : ["($)"];
for (const parent of parents) for (const child of children) for (const form of forms) {
  let code = parent.replaceAll("$", () => form.replace("$", () => child));
  code = lengthen(code);
  const needsGen = /\b(await|yield)\b/.test(parent) || /^(await |yield)/.test(child) && child !== "yield" || child === "yield" && false;
  const isTop = /^(export|import|interface|type|enum|@|class A)/.test(parent);
  if (/^(await a|yield a|yield\* a)$/.test(child) || /^(await|yield\*?) \$/.test(parent) || parent.startsWith("for await")) {
    if (isTop && !/^(class A|@)/.test(parent)) { if (/yield/.test(child + parent)) continue; }
    else code = `async function* w() {\n${code}\n}`;
  }
  if (child === "#p in a") code = isTop ? "" : `class W { #p; m() {\n${code}\n} }`;
  if (!code) continue;
  const ts = /\bas\b|satisfies|<T>|[\w)\]]!|interface|^type |enum |import x =|export =|\$!/.test(parent + " " + child);
  const jsx = /<a|<>/.test(parent + child);
  if (jsx && /<T>/.test(parent + child)) continue;
  const exts = jsx ? (ts ? ["tsx"] : ["jsx", "tsx"]) : ts ? ["ts"] : ["js", "ts"];
  for (const ext of exts) { if (only && !only.test(code)) continue; cases.push({ code, ext, parent, child }); }
}
const server = Bun.spawn({ cmd: [bin, "format", "serve"], stdin: "pipe", stdout: "pipe", stderr: "ignore" });
const reader = server.stdout.getReader(); let buffered = new Uint8Array(0);
async function fill() { const { value, done } = await reader.read(); if (done) throw new Error("exited"); const j = new Uint8Array(buffered.length + value.length); j.set(buffered); j.set(value, buffered.length); buffered = j; }
async function readLine() { let e: number; while ((e = buffered.indexOf(10)) < 0) await fill(); const l = new TextDecoder().decode(buffered.subarray(0, e)); buffered = buffered.subarray(e + 1); return l; }
async function readBytes(n: number) { while (buffered.length < n) await fill(); const b = buffered.subarray(0, n); buffered = buffered.subarray(n); return new TextDecoder().decode(b); }
let same = 0, diff = 0, rejected = 0, errors = 0;
const out: string[] = [];
for (const c of cases) {
  let expected: string;
  try { expected = await prettier.format(c.code, { filepath: "x." + c.ext }); } catch { rejected++; continue; }
  const path = join(dir, "x." + c.ext);
  writeFileSync(path, c.code);
  server.stdin.write(path + "\n"); server.stdin.flush();
  const line = await readLine();
  if (!line.startsWith("ok ")) { errors++; out.push(`### ERR [${c.ext}] ${JSON.stringify(c.code)} ${line}`); continue; }
  const actual = await readBytes(Number(line.slice(3)));
  if (actual === expected) same++; else { diff++; out.push(`### [${c.ext}] parent ${c.parent}   child ${c.child}\n--- expected\n${expected}--- actual\n${actual}`); }
}
server.stdin.end();
console.log(`${same} same, ${diff} differ, ${errors} errors, ${rejected} rejected by Prettier`);
writeFileSync(flags.get("out") ?? join(dir, "out.txt"), out.join("\n"));
