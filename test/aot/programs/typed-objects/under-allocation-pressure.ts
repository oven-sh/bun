// Typed objects under allocation pressure: references next to unboxed numbers, absent fields, extra properties, cycles and weak references survive garbage collections.
interface Cell { id: number; weight: number; label: string; next?: Cell; data?: number[]; flag?: boolean; owner: Holder | null }
interface Holder { title: string; cells: Cell[]; count: number }
interface HasId { id: number }
function churn(n: number): number { let s = 0; for (let i = 0; i < n; i++) { const junk: Cell = { id: i, weight: i + 0.5, label: "junk" + (i & 7), owner: null, data: [i, i + 1] }; s += junk.data!.length + junk.id % 3 } return s }

// A long list whose cells mix numbers, strings and references, built while garbage is made.
function buildList(n: number, owner: Holder): Cell {
  let head: Cell = { id: 0, weight: 0.25, label: "c0", owner }
  for (let i = 1; i < n; i++) {
    const c: Cell = i % 3 === 0 ? { id: i, weight: i / 4, label: "c" + i, owner, next: head } : i % 3 === 1 ? { next: head, owner: null, label: "c" + i, weight: i / 4, id: i, data: [i] } : { label: "c" + i, id: i, owner, weight: i / 4, flag: i % 2 === 0, next: head }
    head = c
    if (i % 1000 === 0) churn(2000)
  }
  return head
}
function sumList(head: Cell | undefined): string {
  let ids = 0, weights = 0, chars = 0, datas = 0, flags = 0, owned = 0, n = 0
  for (let c = head; c; c = c.next) { ids += c.id; weights += c.weight; chars += c.label.length; datas += c.data ? c.data[0] : 0; flags += c.flag === undefined ? 0 : c.flag ? 2 : 1; owned += c.owner ? c.owner.count : 0; n++ }
  return [n, ids, weights, chars, datas, flags, owned].join()
}
const holder: Holder = { title: "h", cells: [], count: 1 }
const list = buildList(30000, holder)
console.log(sumList(list), churn(100000))
console.log(sumList(list))

// Extra properties on every seventh cell, late fields, frozen cells, deleted fields, then more garbage. (Accessors and new prototypes: type-rules/under-allocation-pressure.)
let index = 0
for (let c: Cell | undefined = list; c; c = c.next, index++) {
  if (index % 7 === 0) { (c as any).extra = { tag: "x" + index, back: c }; (c as any)[index] = [index]; (c as any)[Symbol.for("gc")] = "s" + index }
  if (index % 11 === 0) c.data = [index, index]
  if (index % 19 === 0) Object.freeze(c)
  if (index % 23 === 0 && !Object.isFrozen(c)) delete c.flag
}
churn(200000)
let extras = 0, backs = 0, indexed = 0, symbols = 0, frozen = 0
index = 0
for (let c: Cell | undefined = list; c; c = c.next, index++) {
  const a: any = c
  if (a.extra) { extras += a.extra.tag.length; if (a.extra.back === c) backs++ }
  if (a[index]) indexed += a[index][0]
  if (a[Symbol.for("gc")]) symbols += a[Symbol.for("gc")].length
  if (Object.isFrozen(c)) frozen++
}
console.log(sumList(list), extras, backs, indexed, symbols, frozen)

// The only reference to an object is a typed field, an array in a typed field, a closure in a typed field, or a narrower view.
interface Keeper { only: Cell; many: Cell[]; make: () => Cell; view: HasId; opt?: Cell }
function keeper(i: number): Keeper {
  const captured: Cell = { id: i + 3, weight: 0.5, label: "captured", owner: null }
  return { only: { id: i, weight: 1.5, label: "only", owner: null }, many: [{ id: i + 1, weight: 2.5, label: "many", owner: null }], make: () => captured, view: { id: i + 2, weight: 3.5, label: "view", owner: null } as Cell }
}
const keepers: Keeper[] = []
for (let i = 0; i < 2000; i++) { keepers.push(keeper(i * 10)); if (i % 500 === 0) churn(20000) }
for (let i = 0; i < keepers.length; i += 2) keepers[i].opt = { id: -i, weight: -0.5, label: "opt", owner: holder }
churn(200000)
let total = 0, text = 0
for (const k of keepers) { total += k.only.id + k.many[0].id + k.make().id + k.view.id + k.only.weight + k.many[0].weight + (k.view as Cell).weight + (k.opt ? k.opt.id + k.opt.weight : 0); text += k.only.label.length + k.many[0].label.length + k.make().label.length + (k.view as Cell).label.length + (k.opt?.owner?.title.length ?? 0) }
console.log(total, text)

// Cycles between typed objects, dropped and kept.
function ringOf(n: number): Cell { const first: Cell = { id: 0, weight: 0, label: "r", owner: null }; let last = first; for (let i = 1; i < n; i++) { last.next = { id: i, weight: i, label: "r", owner: null }; last = last.next } last.next = first; return first }
let keptRing = ringOf(1000)
for (let i = 0; i < 200; i++) { const dropped = ringOf(500); if (i === 100) keptRing = dropped }
let around = 0, c0: Cell = keptRing
do { around += c0.id; c0 = c0.next as Cell } while (c0 !== keptRing)
console.log(around)

// Weak holders keyed by typed objects that stay alive.
const weak = new WeakMap<Cell, Holder>(), weakSet = new WeakSet<HasId>()
const alive: Cell[] = []
for (let i = 0; i < 3000; i++) { const c: Cell = { id: i, weight: i, label: "w", owner: null }; weak.set(c, { title: "t" + i, cells: [c], count: i }); weakSet.add(c); if (i % 3 === 0) alive.push(c) }
churn(200000)
console.log(alive.length, alive.reduce((s, c) => s + (weak.get(c)?.count ?? -1e9) + (weak.get(c)?.cells[0] === c ? 1 : 0) + (weakSet.has(c) ? 1 : 0), 0))

// Class instances with fields of every kind, replaced in place many times.
class Rec0 { n = 0.5; i = 1; s = "s"; o: Rec0 | null = null; a: number[] = []; b = false; u?: string }
const slots: Rec0[] = []
for (let i = 0; i < 64; i++) slots.push(new Rec0())
for (let round = 0; round < 20000; round++) { const r = new Rec0(); r.n = round / 2; r.i = round; r.s = "s" + (round & 15); r.o = slots[(round + 1) & 63]; r.o.o = null; r.a = [round]; r.b = (round & 1) === 1; if (round % 5 === 0) r.u = "u"; slots[round & 63] = r }
console.log(slots.map(r => r.n + r.i + r.s.length + r.a[0] + (r.b ? 1 : 0) + (r.u ? 1 : 0) + (r.o ? r.o.i : 0)).reduce((x, y) => x + y, 0))
