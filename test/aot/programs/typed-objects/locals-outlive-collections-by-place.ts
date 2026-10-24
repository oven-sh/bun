// A typed object keeps most references in 32 bits, and the collector's scan of the stack knows 64-bit pointers alone. What a local alone holds, read from a field that is then overwritten, must outlive collections in every place where a local can wait: a loop, an await, a generator, a closure, a handler, an inlined callee, a store that a loop repeats, a comparison.
// Everything but the two functions that are meant to be inlined is called through a table. The program asks for its collections itself and fills the freed cells anew.
interface Leaf { n: number; m: number }
class Node { constructor(public n: number, public next: Node | null) {} }
interface Holder { leaf: Leaf; maybe: Leaf | null; text: string; node: Node | null }
interface Callers { call: () => number }
function known(): number { return 1 }
function callers(i: number): Callers { return { call: () => i } }
const junk: unknown[] = [];
function leaf(i: number): Leaf { return { n: i, m: i + 1 } }
function text(i: number): string { return "t" + i + "x" + (i * 7) }
function chain(i: number, length: number): Node | null { let head: Node | null = null; for (let k = length; k > 0; k--) head = new Node(i + k, head); return head }
function holder(i: number): Holder { return { leaf: leaf(i), maybe: leaf(i + 1), text: text(i), node: chain(i, 5) } }
function collect(): void { const g: any = globalThis; if (g.Bun) g.Bun.gc(true); else g.gc() }
function churn(): void { junk.length = 0; for (let i = 0; i < 300; i++) junk.push(F.leaf(-i), F.text(-i), F.chain(-i, 1)) }
function again(): void { F.collect(); F.churn() }
function fail(): void { F.again(); throw new Error("thrown") }
function tick(): Promise<number> { return Promise.resolve(1) }
async function slow(): Promise<number> { await F.tick(); F.again(); return 1 }

function copy(h: Holder, to: Holder, fresh: Holder): void { const a = h.leaf, b = h.maybe, c = h.text; h.leaf = fresh.leaf; h.maybe = null; h.text = fresh.text; F.again(); to.leaf = a; to.maybe = b; to.text = c }
function inLoop(h: Holder, fresh: Holder): number { const a = h.leaf; h.leaf = fresh.leaf; let sum = 0; for (let i = 0; i < 3; i++) { F.again(); sum += a.n } return sum }
function walk(h: Holder): number { let sum = 0; let at = h.node; h.node = null; while (at !== null) { const next = at.next; at.next = null; sum += at.n; at = next; F.again() } return sum }
function walkThenRead(h: Holder): number { let sum = 0; let at = h.node; h.node = null; while (at !== null) { const next = at.next; at.next = null; F.again(); sum += at.n; at = next } return sum }
function caught(h: Holder, fresh: Holder): number { const a = h.leaf, b = h.maybe; h.leaf = fresh.leaf; h.maybe = null; try { F.fail(); return 0 } catch { return a.n + (b === null ? -1 : b.m) } }
function atLast(h: Holder, to: Holder, fresh: Holder): number { const a = h.leaf; h.leaf = fresh.leaf; try { F.again(); return 1 } finally { to.leaf = a } }
function take(h: Holder, fresh: Holder): Leaf { const a = h.leaf; h.leaf = fresh.leaf; return a }
function takeMaybe(h: Holder): Leaf | null { const a = h.maybe; h.maybe = null; return a }
function inlined(h: Holder, fresh: Holder): number { const a = take(h, fresh), b = takeMaybe(h); F.again(); return a.n + (b === null ? -1 : b.m) }
function later(h: Holder, fresh: Holder): () => number { const a = h.leaf, c = h.text; h.leaf = fresh.leaf; h.text = fresh.text; return () => a.n + c.length }
function callAfter(f: () => number): number { F.again(); return f() }
function passed(h: Holder, fresh: Holder): number { const a = h.leaf, c = h.text; h.leaf = fresh.leaf; h.text = fresh.text; return F.callAfter(() => a.n + c.length) }
function storeInLoop(all: Holder[], a: Leaf, c: string): void { for (let i = 0; i < all.length; i++) { F.again(); all[i].leaf = a; all[i].maybe = a; all[i].text = c } }
function storeReadInLoop(all: Holder[], h: Holder, fresh: Holder): void { const a = h.leaf, b = h.maybe, c = h.text; h.leaf = fresh.leaf; h.maybe = null; h.text = fresh.text; for (let i = 0; i < all.length; i++) { F.again(); all[i].leaf = a; all[i].maybe = b; all[i].text = c } }
function sameFunction(h: Callers, fresh: Callers): string { const a = h.call; h.call = fresh.call; F.again(); return (a === known) + "," + (a === h.call) + "," + (a === fresh.call) }
function rarely(h: Holder, fresh: Holder, i: number): number { const a = h.leaf, b = h.maybe; h.leaf = fresh.leaf; h.maybe = null; F.again(); if (i % 3000 === 0) return a.n + (b === null ? -1 : b.m); return i }
function twoWays(h: Holder, other: Holder, fresh: Holder, i: number): number { let a: Leaf, b: Leaf | null; if (i & 1024) { a = h.leaf; b = h.maybe; h.leaf = fresh.leaf; h.maybe = null } else { a = other.leaf; b = other.maybe; other.leaf = fresh.leaf; other.maybe = null } F.again(); fresh.maybe = b; return a.n + (b === null ? -1 : b.m) }
function* steps(h: Holder, fresh: Holder): Generator<number> { const a = h.leaf, b = h.maybe; h.leaf = fresh.leaf; h.maybe = null; yield 1; F.again(); yield a.n; F.again(); yield b === null ? -1 : b.m }
async function awaited(h: Holder, to: Holder, fresh: Holder): Promise<number> { const a = h.leaf, b = h.maybe, c = h.text; h.leaf = fresh.leaf; h.maybe = null; h.text = fresh.text; await F.tick(); F.again(); to.maybe = b; return a.n + c.length }
async function awaitedCall(h: Holder, to: Holder, fresh: Holder): Promise<number> { const a = h.leaf, b = h.maybe; h.leaf = fresh.leaf; h.maybe = null; const one = await slow(); to.leaf = a; to.maybe = b; return a.n + one }
async function awaitedInLoop(h: Holder): Promise<number> { let sum = 0; let at = h.node; h.node = null; while (at !== null) { const next = at.next; at.next = null; await F.slow(); sum += at.n; at = next } return sum }
const F = { leaf, text, chain, holder, collect, churn, again, fail, tick, slow, copy, inLoop, walk, walkThenRead, caught, atLast, inlined, later, callAfter, passed, storeInLoop, storeReadInLoop, sameFunction, callers, rarely, twoWays, steps, awaited, awaitedCall, awaitedInLoop };
function show(h: Holder): string { return h.leaf.n + "," + (h.maybe === null ? "null" : String(h.maybe.m)) + "," + h.text }
function row(name: string, f: (i: number) => unknown): void { const seen: string[] = []; for (let i = 1; i <= 8; i++) seen.push(String(f(i * 1000))); console.log(name + ": " + seen.join(" ")) }
async function rowLater(name: string, f: (i: number) => Promise<unknown>): Promise<void> { const seen: string[] = []; for (let i = 1; i <= 8; i++) seen.push(String(await f(i * 1000))); console.log(name + ": " + seen.join(" ")) }
row("copied into another object", i => { const to = F.holder(5); F.copy(F.holder(i), to, F.holder(1)); F.again(); return show(to) });
row("read in a loop", i => F.inLoop(F.holder(i), F.holder(1)));
row("a list taken apart", i => F.walk(F.holder(i)));
row("a list taken apart, read behind the collection", i => F.walkThenRead(F.holder(i)));
row("read in a handler", i => F.caught(F.holder(i), F.holder(1)));
row("stored in a finally block", i => { const to = F.holder(5); F.atLast(F.holder(i), to, F.holder(1)); F.again(); return show(to) });
row("read by an inlined function", i => F.inlined(F.holder(i), F.holder(1)));
row("captured", i => { const f = F.later(F.holder(i), F.holder(1)); F.again(); return f() });
row("captured by a function that is only passed down", i => F.passed(F.holder(i), F.holder(1)));
row("an argument stored by every turn of a loop", i => { const all = [F.holder(5), F.holder(6)]; F.storeInLoop(all, F.leaf(i), F.text(i)); F.again(); return all.map(show).join(";") });
row("what was read stored by every turn of a loop", i => { const all = [F.holder(5), F.holder(6)]; F.storeReadInLoop(all, F.holder(i), F.holder(1)); F.again(); return all.map(show).join(";") });
row("a function compared", i => F.sameFunction(F.callers(i), F.callers(1)));
row("read on a rare path", i => F.rarely(F.holder(i), F.holder(1), i));
row("read on one of two paths", i => F.twoWays(F.holder(i), F.holder(i + 1), F.holder(1), i));
row("across yields", i => [...F.steps(F.holder(i), F.holder(1))].join("+"));
await rowLater("across an await", async i => { const to = F.holder(5); const n = await F.awaited(F.holder(i), to, F.holder(1)); F.again(); return n + ":" + show(to) });
await rowLater("across the await of a call", async i => { const to = F.holder(5); const n = await F.awaitedCall(F.holder(i), to, F.holder(1)); F.again(); return n + ":" + show(to) });
await rowLater("a list taken apart across awaits", i => F.awaitedInLoop(F.holder(i)));
