// `for..in` over typed objects: own then inherited keys, shadowing, non-enumerable keys, deletion during the loop, absent fields, frozen objects and parsed JSON.
interface Rec { a: number; b?: string; c?: boolean; d: number }
function keysOf(o: object): string { const out: string[] = []; for (const k in o) out.push(k); return out.join("") }
function keysOfAny(o: any): string { const out: string[] = []; for (const k in o) out.push(k); return out.join("") }
function at(o: Rec, k: string): string { return String((o as unknown as Record<string, unknown>)[k]) }
function pairs(o: Rec): string { const out: string[] = []; for (const k in o) out.push(k + "=" + at(o, k)); return out.join("&") }

const full: Rec = { a: 1, b: "b", c: true, d: 4 }
const sparse: Rec = { d: 4, a: 1 }
console.log(keysOf(full), keysOf(sparse), pairs(full), pairs(sparse), keysOf({}), keysOf([5, 6]), keysOfAny("ab"), keysOfAny(5), keysOfAny(full))

// Absent fields are not visited; explicit undefined is; late fields come last.
const explicit: Rec = { a: 1, b: undefined, d: 2 }
sparse.c = false
console.log(keysOf(explicit), pairs(explicit), keysOf(sparse), pairs(sparse))

// A key deleted before it is reached is not visited.
function deleting(o: Rec, victim: "b" | "c"): string { const out: string[] = []; for (const k in o) { out.push(k); delete o[victim] } return out.join("") + "/" + Object.keys(o).join("") }
console.log(deleting({ a: 1, b: "x", c: true, d: 2 }, "c"), deleting({ a: 1, b: "x", c: true, d: 2 }, "b"), deleting({ b: "x", a: 1, d: 2 }, "b"), deleting({ a: 1, d: 2 }, "c"))

// Values stored during the loop are seen when their key is reached.
function storing(o: Rec): string { const out: string[] = []; for (const k in o) { out.push(k + at(o, k)); o.d = 99; o.a = -1 } return out.join() }
console.log(storing({ a: 1, b: "x", d: 2 }), storing({ d: 2, a: 1 }))

// Inherited keys follow the own ones; an own key hides an inherited one, even when the own one is not enumerable.
const proto: Rec = { a: 10, b: "proto", d: 40 }
const child: any = Object.create(proto)
child.own = 1; child.b = "child"
console.log(keysOf(child), child.a, child.b, child.d, Object.keys(child).join(""))
Object.defineProperty(child, "d", { value: 5, enumerable: false, configurable: true, writable: true })
console.log(keysOf(child), child.d)
const grand: any = Object.create(child)
console.log(keysOf(grand), grand.a + grand.d)

// Class instances: fields of base and derived, no methods, no accessors.
class Base2 { p = 1; method() { return 0 } get acc() { return 0 } }
class Derived2 extends Base2 { q = 2; r?: number }
const inst = new Derived2()
console.log(keysOf(inst).replace("r", ""))

// Something enumerable on the last prototype the program owns shows up at the end of every loop below it, and goes away again.
const root: Record<string, unknown> = {}
function RootedOld(this: { k: number }) { this.k = 1 }
RootedOld.prototype = Object.create(root)
const rootedBare: object = Object.create(root)
const rootedAll: object[] = [new (RootedOld as any)(), rootedBare, Object.create(rootedBare)]
console.log(rootedAll.map(keysOf).join())
root.polluted = 1
console.log(rootedAll.map(keysOf).join(), keysOf(Object.create(root)), keysOf(full), keysOf({}))
;(rootedBare as any).polluted = "own"
console.log(rootedAll.map(keysOf).join())
delete root.polluted
console.log(rootedAll.map(keysOf).join())

// Indices first, symbols never.
const dressed: Rec = { a: 1, d: 2 }
const anyDressed: any = dressed
anyDressed[5] = 1; dressed.b = "late"; anyDressed[Symbol("s")] = 1; anyDressed[0] = 1; anyDressed.x = 1
console.log(keysOf(dressed))

// Frozen.
const frozen: Rec = Object.freeze({ a: 1, b: "f", d: 2 })
console.log(keysOf(frozen), pairs(frozen))

// Parsed JSON used as the type.
const parsed: Rec = JSON.parse('{"d":1,"a":2,"1":3,"z":0}')
console.log(keysOf(parsed), pairs(parsed), keysOf(Object.assign(Object.create(null), full)))

// null and undefined are looped over zero times; break, continue and a loop variable that is a field.
console.log(keysOfAny(null), keysOfAny(undefined))
const cursor: { key: string } = { key: "" }
let visited = ""
for (cursor.key in full) { if (cursor.key === "b") continue; if (cursor.key === "d") break; visited += cursor.key }
console.log(visited, cursor.key)

// Nested loops over the same object, and over many objects of several creation orders.
let nested = ""
for (const i in sparse) for (const j in sparse) nested += i + j + " "
const many: Rec[] = [full, sparse, explicit, { d: 0, c: true, a: 0 }, { a: 0, d: 0, b: "" }]
console.log(nested, many.map(keysOf).join())
