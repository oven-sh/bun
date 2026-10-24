// A field of a literal type holds a small number for a text that the program spells in code, and a reference to an ordinary string for a text that stands in the type alone ("auto" and "manual" here) and comes from outside. Such a string, held by a local alone once the field is overwritten, must outlive a collection: to be measured, joined, stored into another object, compared.
// The functions are called through a table, so that nothing is inlined and no object is dissolved. The program asks for its collections itself and fills the freed cells anew.
type Mode = "on" | "off" | "auto" | "manual";
interface H { mode: Mode; maybe: Mode | null; n: number }
function collect(): void { const g: any = globalThis; if (g.Bun) g.Bun.gc(true); else g.gc() }
function fresh(text: string): string { return text.split("").join("") }
function churn(): number { let s = 0; for (let i = 0; i < 400; i++) s += F.fresh("junk" + i).length; return s }
function again(): void { F.collect(); F.churn() }
function made(i: number): H { return { mode: i & 1 ? "on" : "off", maybe: null, n: i } }
function grow(mode: unknown, maybe: unknown, n: number): any { const o: any = { mode }; o.maybe = maybe; o.n = n; return o }
function cast(o: any): H { return o as H }
function given(i: number): H { return F.cast(F.grow(F.fresh(i & 1 ? "auto" : "manual"), F.fresh("auto"), i)) }
function lengthLater(x: H): number { const a = x.mode; x.mode = "on"; F.again(); return a.length }
function textLater(x: H): string { const a = x.mode, b = x.maybe; x.mode = "on"; x.maybe = null; F.again(); return a + "," + b }
function copyLater(x: H, to: H): void { const a = x.mode, b = x.maybe; x.mode = "off"; x.maybe = null; F.again(); to.mode = a; to.maybe = b }
function sameLater(x: H, y: H): boolean { const a = x.mode; x.mode = "on"; F.again(); return a === y.mode }
function dropped(i: number): number { const a = F.given(i).mode; F.again(); return a.length }
const F = { collect, fresh, churn, again, made, grow, cast, given, lengthLater, textLater, copyLater, sameLater, dropped };
const lines: string[] = [];
for (let i = 0; i < 10; i++) {
  const to = F.made(i);
  F.copyLater(F.given(i), to); F.again();
  lines.push([F.lengthLater(F.given(i)), F.textLater(F.given(i)), to.mode, to.maybe, F.sameLater(F.given(i), F.given(i)), F.sameLater(F.given(i), F.given(i + 1)), F.dropped(i), F.lengthLater(F.made(i))].join());
}
console.log(lines.join("\n"));
