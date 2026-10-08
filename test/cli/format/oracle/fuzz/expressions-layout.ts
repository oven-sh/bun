// Expressions in parents, with names of any width: layout.
//   bun expressions-layout.ts --bin=<bun-lint> --prettier=<directory with node_modules/prettier> --dir=<directory for temporary files> --scale=12 [--options=json] --out=file [--only=regex]
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
const flags = new Map<string, string>();
for (const arg of process.argv.slice(2)) { const m = /^--([\w-]+)=(.*)$/s.exec(arg); if (m) flags.set(m[1], m[2]); }
const bin = flags.get("bin")!; const scale = Number(flags.get("scale") ?? 12);
const options = JSON.parse(flags.get("options") ?? "{}");
const dir = flags.get("dir")!; mkdirSync(dir, { recursive: true });
const prettier = await import(resolve(flags.get("prettier")!, "node_modules/prettier/index.mjs"));
const children = `
a + b + c|a + b * c - d|a * b + c * d|a && b && c|a && b || c && d|a || b && c|a ?? b ?? c|(a || b) ?? c|a == b && c != d|a < b == c > d|a + b < c + d|a & b | c|a << b + c|a % b + c|a ** b ** c|a instanceof b && c in d|a + b|a && b|a || b|a === b|a * b * c|a / b * c|a - b - c - d
a ? b : c|a ? b : c ? d : e|a ? b ? c : d : e|(a ? b : c) ? d : e|a && b ? c : d|a + b ? c : d|a ? b + c : d + e|a ? {b} : {c}|a ? [b] : [c]|a ? f(b) : f(c)|a ? () => b : () => c|a ? b : c ? d : e ? f : g|a ? (b, c) : d|a ? (b = c) : d|(a ? b : c).d|(a ? b : c).d()|(a ? b : c)()|(a ? b : c)[d]|(a ? b : c)!.d|new (a ? b : c)()|(a ? b : c) as T|a ? b as T : c|await (a ? b : c)|!(a ? b : c)|typeof (a ? b : c)|a ? b : (c, d)|a.b ? c.d : e.f|a() ? b() : c()|a ? b : c || d|a ? b && c : d|(a ? b : c).d.e.f()|(a ? b : c)?.d|a ? null : <div>b</div>|a ? <div>b</div> : <div>c</div>|a ? <div>b</div> : c ? <div>d</div> : null|a ? undefined : b
a || {}|a || {b}|a || {b: c, d: e}|a && [b, c]|a && b && {c}|a || b || []|a ?? {b}|a && <div>b</div>|a && b && <div>c</div>|a || f(b)|a && (() => b)|a && function(){}|a || (b ? c : d)|a && !b|a || await b|{a} || b|[a] && b|a && b || {c}|a + {b}
!a|!(a && b)|!(a + b)|!!(a && b && c)|-(a + b)|typeof (a + b)|!(a instanceof b)|!f(a, b)|void (a, b)|!(await a)|delete a[b]|!a.b.c|!(a as T)|-a ** b|(-a) ** b|+a + +b|- -a|!(() => a)|!{a}|![a]|typeof a === b
(a, b)|(a, b, c)|(a = b, c = d)|(f(a), f(b), f(c))
a as T|a as T as U|(a + b) as T|a as unknown as T|f(a) as T|{a} as T|[a] as T|<T>a|<T>f(a)|<T>{a}|<T>[a]|a satisfies T|(a as T).b|(a as T)(b)|(a as T)[b]|a! as T|(<T>a).b|a as T<U, V>|a as {b: c}|a as T | U|a as (b: T) => U|a.b.c as T|a.b(c) as T|(a as T) + b|a as const|[a, b] as const|{a: b} as const|(a ? b : c) satisfies T|a as any as T<U>|<T><U>a|<T>(a + b)|<T>(() => a)|new (a as T)(b)|(a as T)!|(a satisfies T).b
await a|await f(a)|await a.b(c)|(await a).b|(await a)()|(await a)[b]|(await f(a)).b.c|await (await a).b|await (a || b)|(await a) + b|await new a(b)|(await a)?.b|await (await a)()|await (await (await a).b).c|(await a.b(c)).d(e)|(await a) as T|await (a as T)|await a!|(await a)!|await (() => a)|await {a}|await [a, b]|await (a, b)
yield a|yield f(a)|yield a + b|yield a ? b : c|yield* a|yield (a, b)|yield {a}|(yield a).b|(yield a) + b|yield a && b|yield|yield await a|yield a as T
a = b|a = b = c|a = b = c = d|a += b|a.b = c|a.b.c = d|a[b] = c|[a, b] = c|a = b + c|a = b ? c : d|a = f(b)|a = {b}|a = () => b|a = b => c => d|a = b = c => d => e|a ||= b|a ??= b || c|{a} = b|{a, b: c, d = e} = f|a = (b, c)|a = await b|a = b as T|a = 'ssssssssssss'
'ssssssssssssssssssssssss'|\`ttt\${a}ttt\`|'s' + a + 's'|a + 'sssssssss' + b|\`tttttttttttttttttttttttttttttt\`|'sssssss' + 'sssssssss'
f(a)|f(a, b)|a.b(c)|a.b.c.d|a.b().c().d()|a.b(c).d(e).f(g)|this.a.b|a.b.c()|a()|a.b()|a[b][c]|a?.b?.c|a?.b()|a!.b!.c|f(a)!|new a(b)|new a.b(c)|require('a')|require('a').b|import('a')|f(a)(b)|a.b\`t\`|a.b.c.d.e.f|this.a.b.c()|a.b(1)|a.b('s')|a.b(c.d)|a.b(-1)|a.b(!c)|a.b<T>(c)|a.b<T, U>()|a.b<T | U>()|a.b(this)|a.b(/r/)|a.b(c())|a.b(...c)|a.b.c(d).e|a?.b.c.d|(a?.b).c|a?.[b]|a.b!()|a.b()!.c
class {}|class extends a {}|function(){}|() => a|() => {}|async () => a|a => b => c|(a, b) => c|function* () {}|() => ({a})|() => [a]|() => a ? b : c|() => (a, b)|() => a + b|() => a && b|() => (a = b)
{}|{a}|{a: b}|[]|[a]|[a, b]|1|-1|true|null|/r/|1n|a|this|undefined|<div/>|<div>a</div>|<></>|a<T>|a.b<T>|new.target|import.meta
`.trim().split(/[\n]/).flatMap(l => l.split(/(?<![|])\|(?![|=])/)).map(s => s.trim()).filter(Boolean);
const parents = `
x = $;;x.y = $;;x.y.z = $;;x[y] = $;;const x = $;;let x = $, y = $;;const {x} = $;;const {x, y: z, w = 1} = $;;const [x] = $;;const x: T = $;;const x: T<U<V>, W> = $;;x += $;;x ||= $;;x = y = $;;x = y = z = $;;const x = y = $;;var x = y = z = $;
o = {x: $};;o = {xy: $};;o = {abcdefgh: $};;o = {x: $, y: $};;o = {[x]: $};;o = {'x-y': $};;o = {1: $};;class A { x = $; };;class A { static x = $; };;class A { #x = $; };;class A { x: T = $; };;class A { accessor x = $; };;class A { readonly abcdefgh: T = $; }
f($);;f(x, $);;f($, x);;x.f($);;new F($);;f(x)($);;[$];;[x, $];;\`\${$}\`;;x[$];;f(x, y, $);;x.y.f($).z($);
() => $;;x = () => $;;f(() => $);;f(x => $);;x => y => $;;async () => $;;f(async () => $);;const f = () => $;;f(x, () => $);;f((x, y) => $);;x = y => z => $;;f(x => y => $);
function w() { return $; };;function w() { throw $; };;if ($) {};;while ($) {};;do {} while ($);;switch ($) {};;for (;$;) {};;for ($;;) {};;for (;;$) {};;for (x of $) {};;for (const x = $;;) {};;switch (x) { case $: };;$;;;export default $;;export const x = $;;z = <div x={$} />;;z = <div>{$}</div>;;z = <div {...$} />;;if (x) $; else $;
function w(x = $) {};;({x = $}) => {};;([x = $]) => {};;const {x = $} = y;;({x: y = $} = z);
x = $ || y;;x = y || $;;x = $ && y;;x = $ ?? y;;x = $ + y;;x = y + $;;x = $ * y;;x = $ === y;;x = $ ? y : z;;x = y ? $ : z;;x = y ? z : $;;x = !$;;x = $.y;;x = $();;x = $[y];;x = $ as T;;x = await $;;x = {...$};;x = [...$];;f(...$);;enum E { A = $ };;@dec($) class A {};;x = typeof $;;label: $;;x = $!;;x = <T>$;;x = $.y.z();;x = $?.y;;x = $ satisfies T;;x = new $();;x = $\`t\`;;x = (y, $);;x = -$;;function* w() { yield $; };;x = $ in y;;x = $ instanceof y;;x = void $;
`.trim().split(/\n/).flatMap(l => l.split(";;")).map(s => s.trim()).filter(Boolean);
const parents2 = `
function w() { return y ? $ : z; };;f(y ? $ : z);;new F(y ? $ : z);;function w() { throw y ? $ : z; };;x = f(y ? $ : z);;() => y ? $ : z;;[y ? $ : z];;o = {a: y ? $ : z};;x = (y ? $ : z).w;;function w() { return $.y; };;function w() { return $.y(); };;const x = $.y.z();;x = await $.y;;x = !$.y;;f($.y);;function w() { return $ as T; };;function w() { return new $(); };;x = $!.y;;function w() { throw $.y; };;x = y + $.z;;x = ($ || y) && z;;x = y && ($ || z);;if ($ && y) {};;if (!$) {};;if (x && !$) {};;function w() { return !$; };;function w() { return !!$; };;f(!$);;x = !$ && y;;function w() { return $ && y; };;function w() { return x || $; };;function w() { return (x, $); };;f(x, y ? $ : z);;\`\${y ? $ : z}\`;;x = {...(y ? $ : z)};;w = <div>{x ? $ : y}</div>;;w = <div>{x && $}</div>;;w = <div a={x ? $ : y} />;;w = <div a={x && $} />;;w = <div a={$ && x} />;;w = <div>{$ ? x : y}</div>
x = y ? z : w ? $ : o;;x = y ? (z ? $ : w) : o;;x = (y ? $ : z) ? w : o;;const x = y ? $ : z;;x = y ? $ : $;;f(x)(y ? $ : z);;x.y(z ? $ : w).o();;x = y || (z ? $ : w);;x = (y ? $ : z) || w;;x = (y ? $ : z) + w;;x = await (y ? $ : z);;x = (y ? $ : z) as T;;export default y ? $ : z;;x = y ?? ($ || z);;x = y + $ * z;;x = (y + $) * z;;x = y * ($ + z);;x = y === ($ || z);;x = y + ($ ? z : w);;f(x + $);;f(x && $);;f($ && x, y);;f(x, $ || y);;x = [y && $];;x = {a: y && $};;x = {a: y + $};;x = y.z($ && w);;x = Boolean($ && y);;x = Boolean($);;if (Boolean($ || y)) {};;x = String($ || y);;const {a = y || $} = x;;for (const x of y || $) {};;x = (y, z, $);;f((x, $));;x = (await $).y;;x = (await $)();;x = await $();;x = await $.y();;x = (await $.y).z;;x = (await $ || y).z;;x = y = await $;;x = ($ as T).y;;x = ($ as T)();;x = ($ as T) || y;;x = y || ($ as T);;x = ($ as T) ? y : z;;f($ as T, x);;x = <T>($ as U);;x = ($ as T)!;;x = {a: $ as T};;const x = $ as T;;const x = $ as unknown as T;;function w() { return $ as unknown as T; };;x = [$ as T];;x = ($ satisfies T).y
`.trim().split(/\n/).flatMap(l => l.split(";;")).map(s => s.trim()).filter(Boolean);
if (flags.get("set") === "2") parents.splice(0, parents.length, ...parents2);
const names = "abcdefgxyzwo".split("");
const nameOf = (n: string) => scale <= 1 ? n : (n.repeat(3) + "Name".repeat(20)).slice(0, Math.max(1, scale + (n.charCodeAt(0) % 5) - 2));
const typeOf = (n: string) => scale <= 1 ? n : (n + "Type".repeat(20)).slice(0, Math.max(1, Math.round(scale * 0.8)));
const widen = (s: string) => s.replace(/(?<![\w$#'"`<\/\\])\b([abcdefgxyzwo]|[TUVW])\b(?![\w'"`])/g, (_, n) => /[A-Z]/.test(n) ? typeOf(n) : nameOf(n));
type Case = { code: string; ext: string; parent: string; child: string };
const cases: Case[] = []; const only = flags.has("only") ? new RegExp(flags.get("only")!) : null;
for (const parent of parents) for (const child of children) {
  let code = widen(parent.replaceAll("$", () => `(${child})`));
  const gen = /\byield\b/.test(child), asy = /\bawait\b/.test(child + parent);
  const top = /^(export|enum|@dec|class A|function)/.test(parent);
  if (gen || asy) { if (top && !/^(class A|@dec|function\* w)/.test(parent)) { if (gen) continue; } else if (!/^function\* w/.test(parent) || asy) code = `async function* q() {\n${code}\n}`; }
  const jsx = /<div|<>/.test(parent + child);
  if (jsx && /<T>/.test(parent + child)) continue;
  if (only && !only.test(parent + "   " + child)) continue;
  cases.push({ code, ext: jsx ? "tsx" : "ts", parent, child });
}
const server = Bun.spawn({ cmd: [bin, "format", "serve", ...Object.entries(options).map(([n, v]) => `--${n}=${v}`)], stdin: "pipe", stdout: "pipe", stderr: "ignore" });
const reader = server.stdout.getReader(); let buffered = new Uint8Array(0);
async function fill() { const { value, done } = await reader.read(); if (done) throw new Error("exited"); const j = new Uint8Array(buffered.length + value.length); j.set(buffered); j.set(value, buffered.length); buffered = j; }
async function readLine() { let e: number; while ((e = buffered.indexOf(10)) < 0) await fill(); const l = new TextDecoder().decode(buffered.subarray(0, e)); buffered = buffered.subarray(e + 1); return l; }
async function readBytes(n: number) { while (buffered.length < n) await fill(); const b = buffered.subarray(0, n); buffered = buffered.subarray(n); return new TextDecoder().decode(b); }
let same = 0, diff = 0, rejected = 0, errors = 0; const out: string[] = [];
for (const c of cases) {
  let expected: string;
  try { expected = await prettier.format(c.code, { ...options, filepath: "x." + c.ext }); } catch { rejected++; continue; }
  const path = join(dir, "x." + c.ext); writeFileSync(path, c.code);
  server.stdin.write(path + "\n"); server.stdin.flush();
  const line = await readLine();
  if (!line.startsWith("ok ")) { errors++; out.push(`### ERR [${c.ext}] parent ${c.parent}   child ${c.child} ${line}`); continue; }
  const actual = await readBytes(Number(line.slice(3)));
  if (actual === expected) same++; else { diff++; out.push(`### [${c.ext}] parent ${c.parent}   child ${c.child}\n--- expected\n${expected}--- actual\n${actual}`); }
}
server.stdin.end();
console.log(`scale ${scale}: ${same} same, ${diff} differ, ${errors} errors, ${rejected} rejected by Prettier (${children.length} children, ${parents.length} parents)`);
writeFileSync(flags.get("out")!, out.join("\n"));
