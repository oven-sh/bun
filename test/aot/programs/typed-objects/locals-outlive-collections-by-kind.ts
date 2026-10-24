// A typed object keeps most references in 32 bits, and the collector's scan of the stack knows 64-bit pointers alone. Here a reference of every kind is read from a field into a local, the field is overwritten, a collection runs and the freed cells are filled anew. What the local alone holds must be as it was, whether it is then read, or stored into another object and read from there behind one more collection.
// Everything is called through a table, so that nothing is inlined and no object is dissolved. The program asks for its collections itself.
interface Leaf { n: number; m: number }
class Node { constructor(public n: number, public next: Node | null) {} }
interface Holder {
  leaf: Leaf; maybe: Leaf | null; opt?: Leaf; text: string; word: "on" | "off" | string; fn: () => number; list: number[]; leaves: Leaf[]; node: Node; table: Map<string, number>; set: Set<string>; either: Leaf | Node; date: Date; big: bigint
}
interface Wide {
  id: number
  a0?: number; a1?: string; a2?: Wide; a3?: boolean; a4?: number; a5?: string; a6?: Wide; a7?: boolean
  b0?: number; b1?: string; b2?: Wide; b3?: boolean; b4?: number; b5?: string; b6?: Wide; b7?: boolean
  c0?: number; c1?: string; c2?: Wide; c3?: boolean; c4?: number; c5?: string; c6?: Wide; c7?: boolean
  d0?: number; d1?: string; d2?: Wide; d3?: boolean; d4?: number; d5?: string; d6?: Wide; d7?: boolean
  e0?: number; e1?: string; e2?: Wide; e3?: boolean; e4?: number; e5?: string; e6?: Wide; e7?: boolean
}
const junk: unknown[] = [];
function leaf(i: number): Leaf { return { n: i, m: i + 1 } }
function text(i: number): string { return "t" + i + "x" + (i * 7) }
function fn(i: number): () => number { return () => i * 3 }
function list(i: number): number[] { return [i, i + 1, i + 2] }
function leaves(i: number): Leaf[] { return [F.leaf(i), F.leaf(i + 5)] }
function node(i: number): Node { return new Node(i, null) }
function table(i: number): Map<string, number> { const t = new Map<string, number>(); t.set("k", i); return t }
function set(i: number): Set<string> { const s = new Set<string>(); s.add("s" + i); return s }
function big(i: number): bigint { return BigInt(i) * 10000000000000000000n }
function holder(i: number): Holder {
  return { leaf: leaf(i), maybe: leaf(i + 1), opt: leaf(i + 2), text: text(i), word: text(i + 1), fn: fn(i), list: list(i), leaves: leaves(i), node: node(i), table: table(i), set: set(i), either: i & 1 ? leaf(i + 3) : node(i + 3), date: new Date(i * 1000), big: big(i) };
}
function wide(i: number): Wide { const w: Wide = { id: i }; w.e5 = F.text(i); w.e6 = { id: i + 1 }; return w }
function collect(): void { const g: any = globalThis; if (g.Bun) g.Bun.gc(true); else g.gc() }
function churn(): void { junk.length = 0; for (let i = 1; i <= 200; i++) junk.push(F.holder(-i), F.wide(-i)) }
function again(): void { F.collect(); F.churn() }

function readLeaf(h: Holder, fresh: Holder): number { const kept = h.leaf; h.leaf = fresh.leaf; F.again(); return kept.n + kept.m }
function readMaybe(h: Holder): number { const kept = h.maybe; h.maybe = null; F.again(); return kept === null ? -1 : kept.n + kept.m }
function readOpt(h: Holder): number { const kept = h.opt; h.opt = undefined; F.again(); return kept === undefined ? -1 : kept.n + kept.m }
function readText(h: Holder, fresh: Holder): string { const kept = h.text; h.text = fresh.text; F.again(); return kept }
function readWord(h: Holder): string { const kept = h.word; h.word = "on"; F.again(); return kept }
function readFn(h: Holder, fresh: Holder): number { const kept = h.fn; h.fn = fresh.fn; F.again(); return kept() }
function readList(h: Holder, fresh: Holder): number { const kept = h.list; h.list = fresh.list; F.again(); return kept[0] + kept[2] + kept.length }
function readLeaves(h: Holder, fresh: Holder): number { const kept = h.leaves; h.leaves = fresh.leaves; F.again(); return kept[0].n + kept[1].m }
function readNode(h: Holder, fresh: Holder): number { const kept = h.node; h.node = fresh.node; F.again(); return kept.n }
function readTable(h: Holder, fresh: Holder): number { const kept = h.table; h.table = fresh.table; F.again(); return kept.get("k")! + kept.size }
function readSet(h: Holder, fresh: Holder): string { const kept = h.set; h.set = fresh.set; F.again(); return [...kept].join() }
function readEither(h: Holder, fresh: Holder): number { const kept = h.either; h.either = fresh.either; F.again(); return kept.n }
function readDate(h: Holder, fresh: Holder): number { const kept = h.date; h.date = fresh.date; F.again(); return kept.getTime() }
function readBig(h: Holder, fresh: Holder): string { const kept = h.big; h.big = fresh.big; F.again(); return String(kept) }
function readFar(w: Wide): number { const kept = w.e6; w.e6 = undefined; F.again(); return kept === undefined ? -1 : kept.id }
function readFarText(w: Wide): string { const kept = w.e5; w.e5 = undefined; F.again(); return kept === undefined ? "none" : kept }
function readOfDropped(i: number): number { const kept = F.holder(i).leaf; F.again(); return kept.n + kept.m }
function readFarOfDropped(i: number): number { const kept = F.wide(i).e6; F.again(); return kept === undefined ? -1 : kept.id }

function copy(h: Holder, to: Holder, fresh: Holder): void {
  const a = h.leaf, b = h.maybe, c = h.opt, d = h.text, e = h.word, f = h.fn, g = h.list, i = h.leaves, j = h.node, k = h.table, l = h.set, m = h.either, n = h.date, o = h.big;
  h.leaf = fresh.leaf; h.maybe = null; h.opt = undefined; h.text = fresh.text; h.word = "off"; h.fn = fresh.fn; h.list = fresh.list; h.leaves = fresh.leaves; h.node = fresh.node; h.table = fresh.table; h.set = fresh.set; h.either = fresh.either; h.date = fresh.date; h.big = fresh.big;
  F.again();
  to.leaf = a; to.maybe = b; to.opt = c; to.text = d; to.word = e; to.fn = f; to.list = g; to.leaves = i; to.node = j; to.table = k; to.set = l; to.either = m; to.date = n; to.big = o;
}
function copyFar(w: Wide, to: Wide): void { const a = w.e5, b = w.e6; w.e5 = undefined; w.e6 = undefined; F.again(); to.e5 = a; to.e6 = b }
function show(h: Holder): string {
  return [h.leaf.n, h.maybe === null ? "null" : h.maybe.m, h.opt === undefined ? "none" : h.opt.n, h.text, h.word, h.fn(), h.list.join("/"), h.leaves[1].n, h.node.n, h.table.get("k"), [...h.set].join(), h.either.n, h.date.getTime(), h.big].join(",");
}
const F = { leaf, text, fn, list, leaves, node, table, set, big, holder, wide, collect, churn, again, readLeaf, readMaybe, readOpt, readText, readWord, readFn, readList, readLeaves, readNode, readTable, readSet, readEither, readDate, readBig, readFar, readFarText, readOfDropped, readFarOfDropped, copy, copyFar };
function row(name: string, f: (i: number) => unknown): void { const seen: string[] = []; for (let i = 1; i <= 6; i++) seen.push(String(f(i * 1000 + i))); console.log(name + ": " + seen.join(" ")) }
row("a record", i => F.readLeaf(F.holder(i), F.holder(1)));
row("a record or null", i => F.readMaybe(F.holder(i)));
row("an optional record", i => F.readOpt(F.holder(i)));
row("a string", i => F.readText(F.holder(i), F.holder(1)));
row("a string where literals are expected", i => F.readWord(F.holder(i)));
row("a function", i => F.readFn(F.holder(i), F.holder(1)));
row("an array of numbers", i => F.readList(F.holder(i), F.holder(1)));
row("an array of records", i => F.readLeaves(F.holder(i), F.holder(1)));
row("an instance", i => F.readNode(F.holder(i), F.holder(1)));
row("a map", i => F.readTable(F.holder(i), F.holder(1)));
row("a set", i => F.readSet(F.holder(i), F.holder(1)));
row("one of two", i => F.readEither(F.holder(i), F.holder(1)));
row("a date", i => F.readDate(F.holder(i), F.holder(1)));
row("a bigint", i => F.readBig(F.holder(i), F.holder(1)));
row("a record out of line", i => F.readFar(F.wide(i)));
row("a string out of line", i => F.readFarText(F.wide(i)));
row("a record whose holder is dropped", i => F.readOfDropped(i));
row("a record out of line whose holder is dropped", i => F.readFarOfDropped(i));
row("all of them stored into another object", i => { const to = F.holder(5); F.copy(F.holder(i), to, F.holder(1)); F.again(); return show(to) });
row("those out of line stored into another object", i => { const to = F.wide(5); F.copyFar(F.wide(i), to); F.again(); return to.e5 + "," + (to.e6 === undefined ? "none" : to.e6.id) });
