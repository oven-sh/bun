// local-object-alive-until-reference-compare with the local on the right of the comparison, and with !==: two references out of narrow slots may be compared as their 32-bit words, and the object that a local alone holds must stay alive up to the comparison, or its place is given to a new object and the two words are equal.
interface N { v: number; w: number }
interface R { a: N; b: N | null }
function n(i: number): N { return { v: i, w: i } }
function make(i: number): R { return { a: n(i), b: n(i) } }
function putA(y: R, i: number): void { y.a = n(i) }
function putB(y: R, i: number): void { y.b = n(i) }
function collect(): void { const g: any = globalThis; if (g.Bun) g.Bun.gc(true); else g.gc() }
function heldOnTheRight(x: R, y: R, turns: number): number { const p = x.a; x.a = y.a; let hits = 0; for (let i = 0; i < turns; i++) { if ((i & 255) === 0) F.collect(); F.putA(y, i); if (y.a === p) hits++ } return hits }
function heldOptionalOnTheRight(x: R, y: R, turns: number): number { const p = x.b; x.b = null; let hits = 0; for (let i = 0; i < turns; i++) { if ((i & 255) === 0) F.collect(); F.putB(y, i); if (y.b === p) hits++ } return hits }
function differs(x: R, y: R, turns: number): number { const p = x.a; x.a = y.a; let misses = 0; for (let i = 0; i < turns; i++) { if ((i & 255) === 0) F.collect(); F.putA(y, i); if (y.a !== p) misses++ } return misses }
const F = { putA, putB, collect, heldOnTheRight, heldOptionalOnTheRight, differs };
let a = 0, b = 0, c = 0;
for (let i = 0; i < 20; i++) { a += F.heldOnTheRight(make(i), make(i), 2048); b += F.heldOptionalOnTheRight(make(i), make(i), 2048); c += F.differs(make(i), make(i), 2048) }
console.log(a, b, c);
