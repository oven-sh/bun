// A comment of six forms in every gap of small statements.
//   bun comments-in-expressions.ts --bin=<bun-lint> --prettier=<directory with node_modules/prettier> --dir=<directory for temporary files> [--long=1] --out=file
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
const flags = new Map<string, string>();
for (const arg of process.argv.slice(2)) { const m = /^--([\w-]+)=(.*)$/s.exec(arg); if (m) flags.set(m[1], m[2]); }
const bin = flags.get("bin")!; const long = flags.has("long");
const options = JSON.parse(flags.get("options") ?? "{}");
const dir = flags.get("dir")!; mkdirSync(dir, { recursive: true });
const prettier = await import(resolve(flags.get("prettier")!, "node_modules/prettier/index.mjs"));
const bases2 = [
  "x = a ? b : c ? d : e ? a : b ;", "const x = a && b && c ;", "const x = a || b || c ;", "f ( a , b ? c : d ) ;", "x = a ? { b } : { c } ;", "x = a ? f ( b ) : f ( c ) ;", "x = a ? ( b , c ) : d ;",
  "@F return a ? b : c ? d : e ;", "x = ( a && b ) || c ;", "x = a && ( b || c ) ;", "x = a + ( b * c ) ;", "x = ! ( a || b ) && c ;", "@F x = await f ( a ) ;", "x = ( a as T ) + b ;", "x = a as unknown as T ;",
  "const { a , b } = c ;", "const [ a ] = b ;", "x . y = a ;", "x [ y ] = a ;", "o = { a : b , c : d } ;", "x = y = a ;", "x = a ? <b/> : <c/> ;", "x = a && <b/> ;", "x = a && b && <c/> ;", "x = a ? <b/> : null ;",
  "x = a ? b : ( c ) => d ;", "x = a ? [ b ] : [ c ] ;", "x = a . b ? c . d : e . a ;", "x = a ( ) ? b ( ) : c ( ) ;", "x = a === b ? c : d ;", "x = a && b ? c : d ;", "x = ( a || b ) ?? c ;", "x = a + b + c + d ;", "x = a * b + c * d ;",
  "f ( ! a ) ;", "f ( ! ( a && b ) ) ;", "if ( ! a ) { }", "if ( ! ( a && b ) ) { }", "if ( a && ! b ) { }", "@F return ! ( a && b ) ;", "@F return ( a && b ) ;", "@F return ( a ? b : c ) ;", "x = ( a ) ;", "x = ( ( a + b ) ) ;", "const x = ( a && b ) ;", "const x = ( a ? b : c ) ;",
  "x = { a : ( b ) } ;", "x = { a : ( b + c ) } ;", "class A { x = ( a ) ; }", "x = ( a = b ) ;", "const x = ( a , b ) ;", "x = ( ) => ( { a } ) ;", "x = a ?. b ;", "x = ( a ?. b ) . c ;", "x = new a ( ) ;", "x = new ( a ( ) ) ( ) ;", "x = ( function ( ) { } ) ( ) ;", "( function ( ) { } ) ( ) ;", "( ( ) => { } ) ( ) ;", "( { } ) . a ;", "( a , b ) ;", "( a = b ) ;", "x = typeof ( a + b ) ;", "x = - ( a + b ) ;", "x = ( - a ) ** b ;", "x = ( a , b ) . c ;", "x = ( yield_ ) ;",
];
const bases1 = [
  "x = a + b ;", "x = a + b * c ;", "x = a && b || c ;", "x = a && b && c ;", "x = a ?? b ;", "x = a ? b : c ;", "x = a ? b : c ? d : e ;", "x = a ? b ? c : d : e ;", "x = ( a ? b : c ) ? d : e ;",
  "const x = a ;", "const x = a + b ;", "const x = a ? b : c ;", "let x = a , y = b ;", "x = ! a ;", "x = ! ( a && b ) ;", "x = - a ;", "x = typeof a ;", "x = ( a , b ) ;", "a , b ;", "x = a as T ;", "x = a satisfies T ;", "x = < T > a ;", "x = a ! ;",
  "f ( a + b , c ) ;", "f ( a ? b : c ) ;", "f ( a && b ) ;", "if ( a && b ) { }", "if ( a + b ) { }", "while ( a || b ) { }", "x = { a : b + c } ;", "x = { a : b ? c : d } ;", "x = { a : b } ;", "a = b = c ;", "a = b = c = d ;", "x += a ;",
  "x = ( a ? b : c ) . d ;", "x = ( a + b ) . c ;", "x = ( a as T ) . c ;", "x = a . b ;", "x = [ a + b ] ;", "x = ( ) => a + b ;", "x = ( ) => a ? b : c ;", "x = ( ) => ( a , b ) ;", "x = ( ) => ( a = b ) ;", "x = a ++ ;", "x = ++ a ;", "x = a in b ;", "x = a instanceof b ;",
  "class A { x = a + b ; }", "class A { x = a ; }", "x = a || { } ;", "x = a || { b } ;", "x = a && [ b ] ;", "x = ` ${ a + b } ` ;", "x = a ** b ;", "x = a == b ;", "( { a } = b ) ;", "[ a ] = b ;", "x = f ( ) ;", "x = require ( a ) ;", "x = 'ssssssss' ;", "x = a . b . c ;", "x = a . b ( ) ;",
  "@F return a + b ;", "@F return a ? b : c ;", "@F return a && b ;", "@F return ( a , b ) ;", "@F return ! a ;", "@F throw a + b ;", "@F return a as T ;", "@F x = await a ;", "@F x = ( await a ) . b ;", "@F x = yield a ;", "@F yield a + b ;", "@F return a = b ;", "@F await ( a || b ) ;",
];
const bases = flags.get("set") === "2" ? bases2 : bases1;
const L: Record<string, string> = { a: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", b: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", c: "cccccccccccccccccccccccccccccccc", d: "dddddddddddddddddddddddddddd", e: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeee", x: "xxxxxxxxxxxxxxxxxxxx", T: "TTTTTTTTTTTTTTTTTTTTTTTTTT" };
const forms: [string, string][] = [["blk", " /* c */ "], ["eol", " // c\n"], ["own", "\n// c\n"], ["ownblk", "\n/* c */\n"], ["doc", " /**\n * c\n */ "], ["blkeol", " /* c */\n"]];
type Case = { code: string; ext: string; name: string };
const cases: Case[] = [];
for (let base of bases) {
  const inFn = base.startsWith("@F "); if (inFn) base = base.slice(3);
  let tokens = base.split(" "); if (long) tokens = tokens.map(t => L[t] ?? t);
  const ts = /\b(as|satisfies)\b|< T|!/.test(base) && !/! [a(]/.test(base) || /< T/.test(base);
  for (let i = 1; i < tokens.length; i++) for (const [fname, form] of forms) {
    if (tokens.includes("`") && (i <= tokens.indexOf("${") || i > tokens.indexOf("}", tokens.indexOf("${")))) { if (i > tokens.indexOf("`") && i <= tokens.lastIndexOf("`")) continue; }
    let code = tokens.slice(0, i).join(" ") + form + tokens.slice(i).join(" ");
    if (inFn) code = `async function* w() {\n${code}\n}`;
    for (const ext of /<[bc]\/>/.test(base) ? ["jsx", "tsx"] : ts ? ["ts"] : ["js", "ts"]) cases.push({ code, ext, name: `${base} @${i} ${fname}` });
  }
}
const server = Bun.spawn({ cmd: [bin, "format", "serve", ...Object.entries(options).map(([n, v]) => `--${n}=${v}`)], stdin: "pipe", stdout: "pipe", stderr: "ignore" });
const reader = server.stdout.getReader(); let buffered = new Uint8Array(0);
async function fill() { const { value, done } = await reader.read(); if (done) throw new Error("exited"); const j = new Uint8Array(buffered.length + value.length); j.set(buffered); j.set(value, buffered.length); buffered = j; }
async function readLine() { let e: number; while ((e = buffered.indexOf(10)) < 0) await fill(); const l = new TextDecoder().decode(buffered.subarray(0, e)); buffered = buffered.subarray(e + 1); return l; }
async function readBytes(n: number) { while (buffered.length < n) await fill(); const b = buffered.subarray(0, n); buffered = buffered.subarray(n); return new TextDecoder().decode(b); }
let same = 0, diff = 0, rejected = 0, errors = 0; const out: string[] = []; const seen = new Set<string>();
for (const c of cases) {
  let expected: string;
  try { expected = await prettier.format(c.code, { ...options, filepath: "x." + c.ext }); } catch { rejected++; continue; }
  const path = join(dir, "c." + c.ext); writeFileSync(path, c.code);
  server.stdin.write(path + "\n"); server.stdin.flush();
  const line = await readLine();
  if (!line.startsWith("ok ")) { errors++; out.push(`### ERR [${c.ext}] ${c.name} ${line}`); continue; }
  const actual = await readBytes(Number(line.slice(3)));
  if (actual === expected) same++; else { diff++; const k = expected + "\0" + actual; if (!seen.has(k)) { seen.add(k); out.push(`### [${c.ext}] ${c.name}\n--- input\n${c.code}\n--- expected\n${expected}--- actual\n${actual}`); } }
}
server.stdin.end();
console.log(`${same} same, ${diff} differ, ${errors} errors, ${rejected} rejected`);
writeFileSync(flags.get("out")!, out.join("\n"));
