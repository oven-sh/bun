// A record with more optional fields than a cell has room for keeps the later ones out of line. The first store to such a field creates
// it: the key order is noted and the storage is made or grown. All of that is one call at the site.
// SIZE< setBoolean 250
// SIZE< fillForwards 1600
// SIZE< fillBackwards 1600
interface Wide {
    id: number
    a0?: number; a1?: string; a2?: Wide; a3?: boolean; a4?: number; a5?: string; a6?: Wide; a7?: boolean
    b0?: number; b1?: string; b2?: Wide; b3?: boolean; b4?: number; b5?: string; b6?: Wide; b7?: boolean
    c0?: number; c1?: string; c2?: Wide; c3?: boolean; c4?: number; c5?: string; c6?: Wide; c7?: boolean
    d0?: number; d1?: string; d2?: Wide; d3?: boolean; d4?: number; d5?: string; d6?: Wide; d7?: boolean
    e0?: number; e1?: string; e2?: Wide; e3?: boolean; e4?: number; e5?: string; e6?: Wide; e7?: boolean
}
function make(id: number): Wide { return { id } }
function setNumber(w: Wide, v: number): void { w.e4 = v }
function setString(w: Wide, v: string): void { w.e5 = v }
function setReference(w: Wide, v: Wide): void { w.e6 = v }
function setBoolean(w: Wide, v: boolean): void { w.e7 = v }
function setEarly(w: Wide, v: number): void { w.c0 = v }
function fillForwards(w: Wide): void { w.a0 = 1; w.b0 = 2; w.c0 = 3; w.d0 = 4; w.e0 = 5; w.e1 = "six"; w.e2 = w; w.e3 = true }
function fillBackwards(w: Wide): void { w.e3 = false; w.e2 = undefined; w.e1 = "five"; w.e0 = 4; w.d0 = 3; w.c0 = 2; w.b0 = 1; w.a0 = 0 }
function describe(w: Wide): string { return Object.keys(w).join() + "|" + JSON.stringify(w, (key, value) => key === "e2" || key === "e6" ? (value ? value.id : value) : value) }

const first = make(1)
setNumber(first, 1.5); setString(first, "s"); setReference(first, first); setBoolean(first, true); setEarly(first, 7)
console.log(describe(first))
setNumber(first, 2); setString(first, "t"); setBoolean(first, false)
console.log(describe(first))
const forwards = make(2), backwards = make(3)
fillForwards(forwards); fillBackwards(backwards); fillBackwards(forwards); fillForwards(backwards)
console.log(describe(forwards)); console.log(describe(backwards))

const frozen = Object.freeze(make(4)), sealed = Object.seal(make(5)), closed = Object.preventExtensions(make(6))
for (const w of [frozen, sealed, closed]) {
    try { setNumber(w, 1); console.log("stored", describe(w)) } catch (error) { console.log((error as Error).constructor.name, describe(w)) }
}
const removed = make(7)
setNumber(removed, 1); setString(removed, "x"); delete removed.e4; setBoolean(removed, true); setNumber(removed, 2)
console.log(describe(removed))

let sum = 0
const kept: Wide[] = []
for (let i = 0; i < 30000; i++) {
    const w = make(i)
    if (i & 1) setNumber(w, i)
    if (i & 2) setString(w, "n" + i)
    if (i & 4) setReference(w, kept.length ? kept[kept.length - 1] : w)
    if (i & 8) setEarly(w, i)
    if (i % 7 === 0) fillBackwards(w)
    if (i % 100 === 0) kept.push(w)
    sum += Object.keys(w).length + (w.e4 ?? 0) + (w.e5 ? w.e5.length : 0) + (w.e6 ? w.e6.id : 0)
}
console.log(sum, kept.length, kept.reduce((total, w) => total + (w.e6 ? w.e6.id : 0) + Object.keys(w).length, 0))
