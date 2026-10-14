// A type with two dozen optional fields is used for tiny objects created as other types, for medium ones, and for objects created as the wide type itself.
interface Tiny { id: number }
interface Wide extends Tiny {
  n1?: number; n2?: number; n3?: number; n4?: number; n5?: number; n6?: number; n7?: number; n8?: number
  s1?: string; s2?: string; s3?: string; s4?: string; s5?: string; s6?: string
  b1?: boolean; b2?: boolean; b3?: boolean; b4?: boolean
  c1?: Tiny; c2?: Tiny; c3?: Tiny; c4?: Tiny
  f1?: () => number; f2?: () => number
}
type Middling = { id: number; m1: number; m2: string; m3: boolean; m4: number; m5: string; n1: number; s1: string; b1: boolean; c1: Tiny }
class Small { id = 3; n8 = 8 }
function mark(v: unknown): string { return v === undefined ? "-" : typeof v === "object" ? "o" : typeof v === "function" ? "f" : String(v) }
function digest(w: Wide): string {
  return [w.n1, w.n2, w.n3, w.n4, w.n5, w.n6, w.n7, w.n8, w.s1, w.s2, w.s3, w.s4, w.s5, w.s6, w.b1, w.b2, w.b3, w.b4, w.c1, w.c2, w.c3, w.c4, w.f1, w.f2].map(mark).join("")
}
function present(w: Wide): string {
  return [("n1" in w), ("n8" in w), ("s1" in w), ("s6" in w), ("b1" in w), ("b4" in w), ("c1" in w), ("c4" in w), ("f1" in w), ("f2" in w)].map(p => p ? "1" : "0").join("")
}
function keys(o: object): string { return Object.keys(o).join() }
const tiny: Tiny = { id: 1 }
const middling: Middling = { id: 2, m1: 1, m2: "m", m3: true, m4: 4, m5: "5", n1: 11, s1: "S", b1: false, c1: tiny }
const small = new Small()
const asWide: Wide = { id: 4 }
const halfWide: Wide = { s3: "x", id: 5, n4: 4, b2: true, c3: tiny, f1: () => 1 }
const foreign: Wide = JSON.parse('{"id":6,"n2":2,"s6":"six","b4":false,"c4":{"id":60}}')
const wides: Wide[] = [tiny, middling, small, asWide, halfWide, foreign]
console.log(wides.map(digest).join(" "))
console.log(wides.map(present).join(" "), wides.map(keys).join(" "))

function sprinkle(w: Wide, k: number): void {
  if (k & 1) { w.n1 = k; w.s2 = "s" + k; w.b3 = true }
  if (k & 2) { w.n7 = -k; w.c2 = w; w.f2 = () => k }
  if (k & 4) { w.s5 = ""; w.b4 = false; w.n3 = 0 }
  w.n8 = (w.n8 ?? 0) + k
}
wides.forEach((w, i) => sprinkle(w, i + 1))
console.log(wides.map(digest).join(" "))
console.log(wides.map(present).join(" "), wides.map(keys).join(" "))
console.log(wides.map(w => (w.f2?.() ?? "none") + "/" + (w.c2 === w) + "/" + (w.c2?.id ?? "none")).join())
console.log(small.n8, small.id, middling.n1, middling.s1, middling.m5, middling.c1 === tiny, keys(tiny))

// All of them at once, in the order of the alphabet backwards, then every second one away again.
function fillAll(w: Wide): void {
  w.s6 = "6"; w.s5 = "5"; w.s4 = "4"; w.s3 = "3"; w.s2 = "2"; w.s1 = "1"
  w.n8 = 8; w.n7 = 7; w.n6 = 6; w.n5 = 5; w.n4 = 4; w.n3 = 3; w.n2 = 2; w.n1 = 1
  w.f2 = () => 2; w.f1 = () => 1
  w.c4 = tiny; w.c3 = tiny; w.c2 = tiny; w.c1 = tiny
  w.b4 = true; w.b3 = false; w.b2 = true; w.b1 = false
}
function thin(w: Wide): void { delete w.s6; delete w.s4; delete w.s2; delete w.n7; delete w.n5; delete w.n3; delete w.f2; delete w.c4; delete w.c2; delete w.b4; delete w.b2 }
const fresh: Tiny[] = [{ id: 10 }, new Small(), { id: 12 } as Wide, JSON.parse('{"id":13}')]
for (const t of fresh) fillAll(t)
console.log(fresh.map(digest).join(" "), fresh.map(keys).join(" "))
for (const t of fresh) thin(t)
console.log(fresh.map(digest).join(" "), fresh.map(keys).join(" "))
for (const t of fresh) { const w: Wide = t; w.n5 = 55; w.b2 = false; w.s2 = "again" }
console.log(fresh.map(digest).join(" "), fresh.map(keys).join(" "))
console.log(fresh.map(t => JSON.stringify({ ...t }).length + ":" + Object.entries(t).length).join())

// Many tiny objects, a few of which get one wide field each.
const crowd: Tiny[] = []
for (let i = 0; i < 2000; i++) crowd.push(i % 3 === 0 ? { id: i } : i % 3 === 1 ? new Small() : ({ id: i, n6: i } as Wide))
for (let i = 0; i < crowd.length; i += 7) (crowd[i] as Wide).n6 = 1000
let total = 0
for (const t of crowd) { const w: Wide = t; total += w.id + (w.n6 ?? 0) + (w.n8 ?? 0) + (w.s1 ?? "").length }
console.log(total, crowd.filter(t => "n6" in t).length, keys(crowd[0]), keys(crowd[7]), keys(crowd[14]), keys(crowd[1]))
