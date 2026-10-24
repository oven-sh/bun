// An async function that waits keeps its frame in the heap, where the collector visits a list of places, not every word. A reference that was read from a field before an await and is used behind it must be on that list, whatever it is used for: read, stored into a new object, captured by a closure, copied by a spread, kept by a loop. The field is overwritten before the await, and every tick collects and fills the freed cells anew.
// The functions are called through a table, so that nothing is inlined and no object is dissolved.
type Leaf = { n: number; m: number };
type Holder = { leaf: Leaf; other: Leaf; maybe: Leaf | null; opt?: Leaf; text: string; mode: "on" | "off" | "auto" };
type Kept = { tag: number; leaf: Leaf };
function collect(): void { const g: any = globalThis; if (g.Bun) g.Bun.gc(true); else g.gc() }
function leaf(n: number): Leaf { return { n, m: n * 2 } }
function holder(n: number): Holder { return { leaf: F.leaf(n), other: F.leaf(n + 1), maybe: F.leaf(n + 2), opt: F.leaf(n + 3), text: "t" + n, mode: n & 1 ? "on" : "off" } }
function churn(): number { let s = 0; for (let i = 0; i < 200; i++) s += F.leaf(7000 + i).m; return s }
async function tick(): Promise<number> { await null; F.collect(); F.churn(); return 1 }
class Runner {
  leaf: Leaf; other: Leaf; list: Kept[] = [];
  constructor(n: number) { this.leaf = F.leaf(n); this.other = F.leaf(n + 1) }
  async swap(): Promise<number> { const a = this.leaf; this.leaf = this.other; await F.tick(); this.other = a; return this.other.n }
  async fill(k: number): Promise<number> { for (let i = 0; i < k; i++) { this.list.push({ tag: i, leaf: this.leaf }); await F.tick() } return this.list.length }
}
async function loopOverParameter(p: Leaf, k: number, out: Kept[]): Promise<number> { for (let i = 0; i < k; i++) { out.push({ tag: i, leaf: p }); await F.tick() } return out.length }
async function loopOverField(h: Holder, k: number, out: Kept[]): Promise<number> { for (let i = 0; i < k; i++) { out.push({ tag: i, leaf: h.leaf }); await F.tick() } return out.length }
async function closureBehind(h: Holder): Promise<() => number> { const a = h.leaf; h.leaf = h.other; await F.tick(); return () => a.n + a.m }
async function spreadBehind(h: Holder): Promise<Holder> { const copy = { ...h }; h.leaf = h.other; h.maybe = null; h.opt = undefined; h.text = ""; await F.tick(); return copy }
async function spreadLater(h: Holder): Promise<Holder> { await F.tick(); const copy = { ...h }; await F.tick(); return copy }
async function allKinds(h: Holder): Promise<Holder> { const a = h.leaf, b = h.other, c = h.maybe, d = h.opt, e = h.text, f = h.mode; h.leaf = b; h.other = a; h.maybe = null; h.opt = undefined; h.text = "x"; await F.tick(); await F.tick(); return { leaf: a, other: b, maybe: c, opt: d, text: e, mode: f } }
async function caught(h: Holder): Promise<Kept> { const a = h.leaf; h.leaf = h.other; try { await F.tick(); if (a.n < 0) throw new Error("no") } catch { return { tag: -1, leaf: a } } finally { await F.tick() } return { tag: 1, leaf: a } }
async function twoPaths(h: Holder, which: boolean): Promise<Kept> { const a = which ? h.leaf : h.other; h.leaf = F.leaf(1); h.other = F.leaf(2); await F.tick(); return { tag: 0, leaf: a } }
const F = { collect, leaf, holder, churn, tick, loopOverParameter, loopOverField, closureBehind, spreadBehind, spreadLater, allKinds, caught, twoPaths };
function show(h: Holder): string { return [h.leaf.n, h.other.m, h.maybe ? h.maybe.n : "null", h.opt ? h.opt.m : "none", h.text, h.mode].join() }
async function main(): Promise<void> {
  const lines: string[] = [];
  for (let i = 0; i < 6; i++) {
    const r = new Runner(i * 100);
    lines.push("swap " + await r.swap() + " fill " + await r.fill(3) + " " + r.list.map(k => k.leaf.n).join());
    const out: Kept[] = [];
    lines.push("parameter " + await F.loopOverParameter(F.leaf(i), 3, out) + " " + out.map(k => k.leaf.m).join());
    const out2: Kept[] = [];
    lines.push("field " + await F.loopOverField(F.holder(i), 3, out2) + " " + out2.map(k => k.leaf.m).join());
    lines.push("closure " + (await F.closureBehind(F.holder(i)))());
    lines.push("spread " + show(await F.spreadBehind(F.holder(i))) + " | " + show(await F.spreadLater(F.holder(i))));
    lines.push("kinds " + show(await F.allKinds(F.holder(i))));
    lines.push("caught " + (await F.caught(F.holder(i))).leaf.m + " paths " + (await F.twoPaths(F.holder(i), (i & 1) === 0)).leaf.n);
  }
  console.log(lines.join("\n"));
}
main();
