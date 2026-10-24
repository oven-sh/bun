// As truthiness-of-field-via-cast.ts, with objects from outside among the nodes. `if ((node as Declaration).symbol)`: any object passes the cast, and the read behind it is a typed read, also under `if`, `!`, `&&`, `||` and `while`. A field that the object lacks reads undefined, a getter and an inherited field answer as in plain Bun, and every falsy value of the declared kind takes the same side as in plain Bun. A field that holds another kind than `Decl` or `Other` declares throws a TypeError.
interface Sym { name: string; flags: number }
interface Base { kind: number; parent: Base | undefined }
interface Decl extends Base { symbol: Sym | undefined; locals: Map<string, Sym> | undefined; count: number; label: string; done: boolean; big: bigint; maybe: Sym | null; mixed: string | number | undefined }
interface Other extends Base { text: string }
function hasSymbol(n: Base): number { if ((n as Decl).symbol) return 1; return 2; }
function hasLocals(n: Base): number { if ((n as Decl).locals) return 1; return 2; }
function lacksSymbol(n: Base): number { if (!(n as Decl).symbol) return 1; return 2; }
function hasCount(n: Base): number { return (n as Decl).count ? 1 : 2; }
function hasLabel(n: Base): number { return (n as Decl).label ? 1 : 2; }
function isDone(n: Base): number { return (n as Decl).done ? 1 : 2; }
function hasBig(n: Base): number { return (n as Decl).big ? 1 : 2; }
function hasMaybe(n: Base): number { return (n as Decl).maybe ? 1 : 2; }
function hasMixed(n: Base): number { return (n as Decl).mixed ? 1 : 2; }
function hasText(n: Base): number { return (n as Other).text ? 1 : 2; }
function both(n: Base): number { return (n as Decl).symbol && (n as Decl).locals ? 1 : 2; }
function either(n: Base): number { return (n as Decl).symbol || (n as Other).text ? 1 : 2; }
function climbs(n: Base): number { let steps = 0; let at: Base | undefined = n; while ((at as Decl).symbol) { steps++; at = at!.parent; if (!at) break; } return steps; }
function inLoop(list: Base[]): number { let n = 0; for (let i = 0; i < list.length; i++) if ((list[i] as Decl).symbol) n++; return n; }
const sym: Sym = { name: "s", flags: 1 };
function decl(parent: Base | undefined, symbol: Sym | undefined, count: number, label: string, done: boolean, big: bigint, maybe: Sym | null, mixed: string | number | undefined): Decl {
  return { kind: 1, parent, symbol, locals: symbol ? new Map() : undefined, count, label, done, big, maybe, mixed };
}
const a = decl(undefined, sym, 1, "x", true, 1n, sym, "m");
const b = decl(a, undefined, 0, "", false, 0n, null, undefined);
const c = decl(a, sym, NaN, " ", true, -1n, sym, 0);
const d = decl(c, sym, -0, "0", false, 2n, null, "");
const e = decl(d, sym, 0.5, "false", true, 0n, sym, NaN);
const other: Other = { kind: 2, parent: a, text: "t" };
const empty: Other = { kind: 2, parent: b, text: "" };
let reads = 0;
const outside = JSON.parse('[{"kind":3,"symbol":{"name":"o","flags":0},"count":"0","label":0,"done":"no","maybe":[],"mixed":{},"text":1},{"kind":3,"symbol":0,"locals":null,"count":null,"label":[],"done":0,"big":"","text":null},{"kind":3}]') as Base[];
const withGetter = { kind: 4, parent: undefined, get symbol() { reads++; return reads % 2 ? sym : undefined; } } as Base;
const inherits = Object.create({ symbol: sym, count: 7, label: "proto" }) as Base;
const extended = decl(undefined, undefined, 0, "", false, 0n, null, undefined) as Base;
(other as any).symbol = sym;
(empty as any).count = 3;
const nodes: Base[] = [a, b, c, d, e, other, empty, ...outside, withGetter, withGetter, inherits, extended];
function tried(f: (n: Base) => number, n: Base): number | string { try { return f(n); } catch (error) { return "<" + (error as Error).constructor.name + ">"; } }
for (const f of [hasSymbol, hasLocals, lacksSymbol, hasCount, hasLabel, isDone, hasBig, hasMaybe, hasMixed, hasText, both, either, climbs])
  console.log(f.name, nodes.map(n => tried(f, n)).join(""));
try { console.log(inLoop(nodes), reads); } catch (error) { console.log("inLoop:", (error as Error).constructor.name, reads); }
