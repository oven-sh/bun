// `if ((node as Declaration).symbol)`: any object passes a written cast, and the read behind it finds what the object holds. Where the object has the field, the test looks at the field as it is kept; where its layout lacks the field, the answer is known. Objects of other layouts, properties added through `any` and every kind of falsy value must take the same side as in plain Bun. Every value here is of the kind its field declares, and no object from outside is among them: see truthiness-of-external-object-field.ts.
// SIZE< hasSymbol 90
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
const reads = 0;
const extended = decl(undefined, undefined, 0, "", false, 0n, null, undefined) as Base;
(other as any).symbol = sym;
(empty as any).count = 3;
const nodes: Base[] = [a, b, c, d, e, other, empty, extended];
for (const f of [hasSymbol, hasLocals, lacksSymbol, hasCount, hasLabel, isDone, hasBig, hasMaybe, hasMixed, hasText, both, either, climbs])
  console.log(f.name, nodes.map(f).join(""));
console.log(inLoop(nodes), reads);
