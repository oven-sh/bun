// Two references out of narrow slots may be compared as their 32-bit words. The collector finds pointers, not words: an object that a local alone holds must stay alive up to the comparison, or its place is given to a new object and the two words are equal.
// Each turn has a new object stored by a function that is called through a table (so that the slot is really read again) and compares: ANY reuse of the held object's place is seen. The program asks for collections itself, so that it does not hang on how the collector is set.
interface N { v: number; w: number }
interface R { a: N; b: N | null }
function n(i: number): N { return { v: i, w: i } }
function make(i: number): R { return { a: n(i), b: n(i) } }
function putA(y: R, i: number): void { y.a = n(i) }
function putB(y: R, i: number): void { y.b = n(i) }
function collect(): void { const g: any = globalThis; if (g.Bun) g.Bun.gc(true); else g.gc() }
function held(x: R, y: R, turns: number): number { const p = x.a; x.a = y.a; let hits = 0; for (let i = 0; i < turns; i++) { if ((i & 255) === 0) F.collect(); F.putA(y, i); if (p === y.a) hits++ } return hits }
function heldOptional(x: R, y: R, turns: number): number { const p = x.b; x.b = null; let hits = 0; for (let i = 0; i < turns; i++) { if ((i & 255) === 0) F.collect(); F.putB(y, i); if (p === y.b) hits++ } return hits }
function heldThenRead(x: R, y: R, turns: number): number { const p = x.a; x.a = y.a; let hits = 0; for (let i = 0; i < turns; i++) { if ((i & 255) === 0) F.collect(); F.putA(y, i); if (p === y.a) hits++ } return hits * 1000 + p.v }
const F: { putA: typeof putA; putB: typeof putB; collect: typeof collect; held: typeof held; heldOptional: typeof heldOptional; heldThenRead: typeof heldThenRead } = { putA, putB, collect, held, heldOptional, heldThenRead };
function row(name: string, f: () => unknown): void { console.log(name + ": " + String(f())) }
row("held by a local alone, compared on every turn", () => { let hits = 0; for (let i = 0; i < 20; i++) hits += F.held(make(i), make(i), 2048); return hits });
row("the same with a slot that may be null", () => { let hits = 0; for (let i = 0; i < 20; i++) hits += F.heldOptional(make(i), make(i), 2048); return hits });
row("the same where the local is read afterwards", () => { let sum = 0; for (let i = 0; i < 20; i++) sum += F.heldThenRead(make(i), make(i), 2048); return sum });
