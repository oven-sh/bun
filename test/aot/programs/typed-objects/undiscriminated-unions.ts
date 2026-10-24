// Unions without a discriminant: common fields, `in`, `typeof`, `instanceof` and `Array.isArray` tests, primitive members, and a field whose kind differs between members.
type Round = { radius: number; label: string }
type Boxy = { side: number; label: string }
type Oblong = { width: number; height: number; label: string }
type Figure = Round | Boxy | Oblong
function show(o: object): string { return Object.keys(o).join() + " " + JSON.stringify(o) }
function labelOf(f: Figure): string { return f.label }
function area(f: Figure): number {
  if ("radius" in f) return f.radius * f.radius * 3
  if ("side" in f) return f.side ** 2
  return f.width * f.height
}
const bothArms = { radius: 1, side: 2, label: "both" }
const figures: Figure[] = [{ radius: 2, label: "r" }, { label: "b", side: 3 }, { height: 2, label: "o", width: 5 }, bothArms, JSON.parse('{"label":"j","side":1.5}')]
console.log(figures.map(labelOf).join(), figures.map(area).join(), figures.map(show).join(" ; "))
for (const f of figures) f.label += "!"
console.log(figures.map(labelOf).join(), bothArms.label)

// Arms that are not objects.
type NumLike = number | { value: number }
type TextLike = string | { text: string } | null | undefined
type Thunk = (() => number) | { call: () => number }
type Many = number[] | { items: number[] }
function num(n: NumLike): number { return typeof n === "number" ? n : n.value }
function text(t: TextLike): string { return t == null ? String(t) : typeof t === "string" ? t : t.text }
function force(t: Thunk): number { return typeof t === "function" ? t() : t.call() }
function sum(m: Many): number { return (Array.isArray(m) ? m : m.items).reduce((x, y) => x + y, 0) }
const nums: NumLike[] = [1, { value: 2 }, -0, { value: -0 }, NaN, { value: 1e21 }, 2.5]
const texts: TextLike[] = ["s", { text: "t" }, null, undefined, "", { text: "" }]
console.log(nums.map(num).map(n => Object.is(n, -0) ? "-0" : String(n)).join(), texts.map(text).join("|"), [() => 1, { call: () => 2 }].map(force).join(), [[1, 2], { items: [3] }, [], { items: [] }].map(sum).join())
const slot: { n: NumLike; t: TextLike } = { n: 1, t: "a" }
const trail: string[] = []
for (const n of nums) { slot.n = n; trail.push(typeof slot.n + num(slot.n)) }
for (const t of texts) { slot.t = t; trail.push(typeof slot.t + text(slot.t)) }
console.log(trail.join(), show(slot))

// Classes as branches. (An object under Object.create(C.prototype) cast to C: type-rules/undiscriminated-unions.)
class Feline { lives = 9; sound() { return "meow" } }
class Canine { tricks = ["sit"]; sound() { return "woof" } }
type Companion = Feline | Canine | { sound(): string; wild: boolean }
function tell(c: Companion): string { return c.sound() + (c instanceof Feline ? c.lives : c instanceof Canine ? c.tricks.length : c.wild) }
const companions: Companion[] = [new Feline(), new Canine(), { sound: () => "roar", wild: true }]
console.log(companions.map(tell).join())

// One name, another kind in each branch. Reading it through the union gives either; each branch keeps its own.
type NumArm = { v: number; which: 1 }
type StrArm = { v: string; which: 2 }
type ObjArm = { v: { inner: number } | null; which: 3 }
type Either = NumArm | StrArm | ObjArm
const numArm: NumArm = { v: 1.5, which: 1 }
const strArm: StrArm = { which: 2, v: "s" }
const objArm: ObjArm = { v: { inner: 7 }, which: 3 }
const eithers: Either[] = [numArm, strArm, objArm, { v: null, which: 3 }, { v: 0, which: 1 }, { v: "", which: 2 }]
function kindOfV(e: Either): string { const v = e.v; return typeof v === "number" ? "n" + (v + 1) : typeof v === "string" ? "s" + v.length : v === null ? "null" : "o" + v.inner }
console.log(eithers.map(kindOfV).join(), numArm.v * 2, strArm.v + strArm.v, objArm.v?.inner)
numArm.v = 2 ** 40; strArm.v = "longer"; objArm.v = null
console.log(eithers.map(kindOfV).join(), eithers.map(e => e.which).join(""))

// A field that only one branch declares, optional there.
type Bare = { a: number }
type Noted = { a: number; note?: string }
function noteOf(x: Bare | Noted): string { return "note" in x ? "has " + x.note : "none" }
const bare: Bare = { a: 1 }
const noted: Noted = { a: 2 }
const notedFull: Noted = { note: "n", a: 3 }
console.log([bare, noted, notedFull].map(noteOf).join())
noted.note = undefined
;(bare as Noted).note = "late"
delete notedFull.note
console.log([bare, noted, notedFull].map(noteOf).join(), [bare, noted, notedFull].map(show).join(" ; "))

// A union-typed field that takes every kind in turn.
const cell: { v: number | string | boolean | null | undefined | { n: number } | number[] } = { v: 0 }
const kinds: string[] = []
for (const v of [1, "two", true, null, undefined, { n: 6 }, [7], -0, 2.5, "", false, NaN]) { cell.v = v; kinds.push(typeof cell.v + ":" + JSON.stringify(cell)) }
console.log(kinds.join(" "))

let total = 0
for (let i = 0; i < 3000; i++) total += area(figures[i % 5]) + num(nums[i % 4]) + labelOf(figures[i % 5]).length + kindOfV(eithers[i % 6]).length
console.log(total)
