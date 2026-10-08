// A comment of every style in every gap of every template of a statement.
//   bun comments-in-statements.ts <bun-lint> <directory with node_modules/prettier> <directory for temporary files> [--semi=false] [-ext=ts] [-t=<part of a template>] [-skip=<regex>] [-two=<n>]
import { resolve } from "node:path";
const [bin, prettierRoot, temporary, ...rest] = process.argv.slice(2);
const prettier = await import(resolve(prettierRoot, "node_modules/prettier/index.mjs"));
const options: Record<string, unknown> = {};
const opts = rest.filter(o => /^--\w+=/.test(o));
for (const o of opts) { const m = /^--([\w]+)=(.*)$/.exec(o)!; options[m[1]] = m[2] === "true" ? true : m[2] === "false" ? false : m[2]; }
const only = rest.find(o => o.startsWith("-t="))?.slice(3);
const templates = `
if ( a ) b ;
if ( a ) b ; else c ;
if ( a ) { b ; } else { c ; }
if ( a ) { } else { }
if ( a ) b ; else if ( c ) d ; else e ;
if ( a ) { b ; } else if ( c ) { d ; }
if ( a ) ; else ;
while ( a ) b ;
while ( a ) { b ; }
while ( a ) ;
do a ; while ( b ) ;
do { a ; } while ( b ) ;
do ; while ( b ) ;
for ( a ; b ; c ) d ;
for ( a ; b ; c ) { d ; }
for ( ; ; ) a ;
for ( ; ; ) { }
for ( ; ; ) ;
for ( var a = 1 ; b ; c ) ;
for ( a in b ) c ;
for ( a in b ) { c ; }
for ( a of b ) ;
for ( var a of b ) c ;
for ( const a in b ) { }
for await ( a of b ) c ;
with ( a ) b ;
with ( a ) { b ; }
a : b ;
a : { b ; }
a : ;
a : for ( ; ; ) break a ;
a : for ( ; ; ) { continue a ; }
switch ( a ) { }
switch ( a ) { case 1 : b ; }
switch ( a ) { case 1 : { b ; } }
switch ( a ) { default : b ; }
switch ( a ) { default : { b ; } }
switch ( a ) { case 1 : case 2 : b ; break ; default : }
try { a ; } catch { b ; }
try { a ; } catch ( e ) { b ; }
try { a ; } finally { b ; }
try { } catch ( e ) { } finally { }
function f ( ) { return a ; }
function f ( ) { return ; }
function f ( ) { return a , b ; }
function f ( ) { return ( a , b ) ; }
function f ( ) { return a + b ; }
function f ( ) { return ( a ) ; }
function f ( ) { return a . b ; }
function f ( ) { return a ( ) ; }
function f ( ) { return ( a = b ) ; }
function f ( ) { throw a ; }
function f ( ) { throw ( a , b ) ; }
var a ;
var a = 1 ;
var a , b ;
var a = 1 , b = 2 ;
let a ; let b ;
a ; b ;
a ; ; b ;
( a ) ;
( a , b ) ;
{ a ; }
{ }
{ a ; b ; }
debugger ;
"use strict" ; a ;
function f ( ) { "use strict" ; a ; }
import a from "a" ;
import "a" ;
import { a } from "a" ;
import { a , b } from "a" ;
import { a as b } from "a" ;
import * as a from "a" ;
import a , { b } from "a" ;
import a , * as b from "a" ;
import { } from "a" ;
import a from "a" with { type : "json" } ;
import a from "a" with { } ;
import a from "a" with { b : "c" , d : "e" } ;
export { a } ;
export { a , b } ;
export { a as b } ;
export { } ;
export { a } from "a" ;
export { } from "a" ;
export * from "a" ;
export * as a from "a" ;
export * from "a" with { type : "json" } ;
export default a ;
export default ( a ) ;
export default function ( ) { }
export default class { }
export const a = 1 ;
export function f ( ) { }
export class A { }
`.trim().split("\n");
const templateFile = rest.find(o => o.startsWith("-f="))?.slice(3);
if (templateFile) templates.splice(0, templates.length, ...(await Bun.file(templateFile).text()).trim().split("\n"));
const styles = [" /* c */ ", " // c\n", "\n// c\n", "\n/* c */\n", " /* c\n */ ", "\n\n// c\n\n", "\n/* c */ ", " /* c */\n"];
let total = 0, bad = 0, rejected = 0;
const perTemplate = new Map<string, number>();
const ext = rest.find(o => o.startsWith("-ext="))?.slice(5) ?? "js";
const tmp = `${temporary}/tmp-fuzz-${process.pid}.${ext}`;
const two = Number(rest.find(o => o.startsWith("-two="))?.slice(5) ?? 0);
let seed = 12345;
const random = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >>> 12) % n; };
async function check(template: string, code: string) {
  let expected: string;
  try { expected = await prettier.format(code, { parser: ext === "js" ? "babel" : "typescript", ...options }); } catch { rejected++; return; }
  total++; if (process.env.DEBUG) console.log("CASE\n" + code);
  await Bun.write(tmp, code);
  const p = Bun.spawnSync({ cmd: [bin, "format", "file", tmp, ...opts] });
  const actual = p.stdout.toString();
  if (actual !== expected) {
    bad++;
    perTemplate.set(template, (perTemplate.get(template) ?? 0) + 1);
    console.log("=== input\n" + code + "--- expected\n" + expected + "--- actual\n" + actual + p.stderr.toString());
  }
}
const skip = rest.find(o => o.startsWith("-skip="))?.slice(6);
for (const template of templates) {
  if (only && !template.includes(only)) continue;
  if (skip && new RegExp(skip).test(template)) continue;
  const tokens = template.split(" ");
  if (two) {
    for (let i = 0; i < two; i++) {
      const g1 = random(tokens.length + 1), g2 = random(tokens.length + 1);
      const [a, b] = g1 <= g2 ? [g1, g2] : [g2, g1];
      const s1 = styles[random(styles.length)].replace("c", "c1"), s2 = styles[random(styles.length)].replace("c", "c2");
      await check(template, "x;\n" + tokens.slice(0, a).join(" ") + s1 + tokens.slice(a, b).join(" ") + s2 + tokens.slice(b).join(" ") + "\ny;\n");
    }
    continue;
  }
  for (let gap = 0; gap <= tokens.length; gap++) {
    for (const style of styles) {
      await check(template, "x;\n" + tokens.slice(0, gap).join(" ") + style + tokens.slice(gap).join(" ") + "\ny;\n");
    }
  }
}
console.log([...perTemplate].map(([t, n]) => `${n}\t${t}`).join("\n"));
console.log(`${total - bad}/${total} the same, ${rejected} rejected by Prettier`);
