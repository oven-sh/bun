// `JSON.stringify` of typed objects (order, absent and undefined fields, edge-case numbers, `toJSON`, replacers, indentation, cycles) and parsing back into the type.
interface Leaf { v: number; note?: string }
interface Doc { title: string; count: number; ok: boolean; leaf: Leaf; leaves: Leaf[]; maybe?: Leaf | null; fn?: () => void; big?: bigint }
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
const doc: Doc = { count: 1, title: "t", leaf: { v: 1 }, ok: true, leaves: [{ note: "n", v: 2 }, { v: 3 }] }
console.log(JSON.stringify(doc))

// Absent, undefined, null, functions and symbols.
doc.maybe = undefined
console.log(JSON.stringify(doc), "maybe" in doc)
doc.maybe = null; doc.fn = () => {}
console.log(JSON.stringify(doc))
doc.maybe = { v: 0, note: undefined }
;(doc as any)[Symbol("s")] = 1; (doc as any).sym = Symbol("v")
console.log(JSON.stringify(doc), JSON.stringify([undefined, () => 1, Symbol("x"), doc.fn]), JSON.stringify(undefined), JSON.stringify(doc.fn), JSON.stringify(null))
delete doc.maybe; delete doc.fn; delete (doc as any).sym

// Numbers and strings at the edges, from typed fields.
const edge: Leaf[] = [{ v: NaN }, { v: Infinity }, { v: -Infinity }, { v: -0 }, { v: 1e21 }, { v: 1e-7 }, { v: 0.1 + 0.2 }, { v: 2 ** 53 }, { v: -2147483648 }, { v: 5e-324 }]
console.log(JSON.stringify(edge))
const texts: Leaf[] = [{ v: 0, note: "" }, { v: 0, note: "\"\\\n\t\u0001" }, { v: 0, note: "é \ud800" }, { v: 0, note: "😀" }]
console.log(JSON.stringify(texts))
doc.big = 1n
console.log(attempt(() => JSON.stringify(doc)))
delete doc.big

// toJSON: on a class, on a literal of the type, added through `any`, inherited; it receives the key.
class Stamp { constructor(public at: number, private zone = "utc") {} toJSON(key: string) { return key + "@" + this.at + this.zone } }
interface Entry { when: Stamp; list: Stamp[]; id: number }
const entry: Entry = { id: 1, when: new Stamp(5), list: [new Stamp(6), new Stamp(7, "cet")] }
console.log(JSON.stringify(entry), JSON.stringify(new Stamp(8)), JSON.stringify({ ...new Stamp(9) }))
const custom: Leaf & { toJSON(): unknown } = { v: 1, toJSON() { return { wrapped: this.v } } }
const later: Leaf = { v: 2 }
;(later as any).toJSON = function (this: Leaf) { return [this.v, Object.keys(this).join()] }
console.log(JSON.stringify([custom, later, { inner: later }]), later.v)
;(later as any).toJSON = 5
console.log(JSON.stringify(later))
// An object over a prototype with toJSON, as a Leaf: see type-rules/json-stringify.
const heir: object = Object.create({ toJSON() { return "inherited" } })
console.log(JSON.stringify(heir), JSON.stringify({ heir }))

// Replacer functions see holder, key and value, in order; replacer arrays pick and order.
const calls: string[] = []
const replaced = JSON.stringify(doc, function (this: object, key: string, value: unknown) { calls.push(key + ":" + typeof value + ":" + Object.keys(this).length); return typeof value === "number" ? value * 10 : key === "ok" ? undefined : value })
console.log(replaced, calls.join())
console.log(JSON.stringify(doc, ["leaf", "v", "title", "nope", "title"]), JSON.stringify(doc, ["leaves", "note"]), JSON.stringify(doc, []), JSON.stringify(entry, ["id"]))
console.log(JSON.stringify(doc.leaf, null, 2), JSON.stringify(doc.leaves, null, "--"), JSON.stringify({} as Partial<Leaf>, null, 2), JSON.stringify([] as Leaf[], null, 2), JSON.stringify(doc.leaf, null, 20).length)

// A replacer that changes the typed object while it is being written.
const shifting: Doc = { title: "s", count: 1, ok: false, leaf: { v: 1 }, leaves: [] }
console.log(JSON.stringify(shifting, (key, value) => { if (key === "title") { shifting.count = 50; shifting.maybe = { v: 9 } } return value }), Object.keys(shifting).join())

// Frozen objects and cycles. Getters, non-enumerable fields, a required field deleted by the replacer: see type-rules/json-stringify.
const variant: Leaf = { v: 1, note: "n" }
console.log(JSON.stringify(variant), JSON.stringify(Object.freeze({ v: 1 } as Leaf)), variant.v, variant.note)
interface Ring { id: number; next?: Ring }
const ring: Ring = { id: 1 }
ring.next = { id: 2, next: ring }
console.log(attempt(() => JSON.stringify(ring)), JSON.stringify(ring, (k, v) => k === "next" && v.id === 1 ? "cycle" : v))
const shared: Leaf = { v: 7 }
console.log(JSON.stringify({ a: shared, b: shared, c: [shared, shared] }))

// Round trip: the parsed object used as the type gives the same answers as the object it came from.
const back: Doc = JSON.parse(JSON.stringify(doc))
console.log(back.title + back.count + back.ok, back.leaf.v + back.leaves[0].v + back.leaves[1].v, back.leaves[0].note, back.leaves[1].note, back.maybe, Object.keys(back).join() === Object.keys(doc).join(), JSON.stringify(back) === JSON.stringify(doc))
const revived: Doc = JSON.parse(JSON.stringify(doc), (key, value) => typeof value === "number" ? value + 1 : value)
console.log(revived.count, revived.leaf.v, revived.leaves.map(l => l.v).join(), JSON.stringify(revived))

// Many objects in several creation orders.
const rows: Leaf[] = []
for (let i = 0; i < 6; i++) rows.push(i % 3 === 0 ? { v: i } : i % 3 === 1 ? { v: i, note: "n" + i } : { note: "n" + i, v: i })
rows[0].note = "late"
console.log(JSON.stringify(rows))
