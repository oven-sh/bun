// Frozen, sealed and non-extensible objects are used through their types: stores throw as in strict code, also stores to an absent optional field.
interface Rec { a: number; b: string; opt?: number; flag?: boolean; inner: { n: number } }
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
function make(): Rec { return { a: 1, b: "b", inner: { n: 1 } } }
function state(o: object): string { return (Object.isFrozen(o) ? "F" : "") + (Object.isSealed(o) ? "S" : "") + (Object.isExtensible(o) ? "X" : "") }
function show(r: Rec): string { return [r.a, r.b, String(r.opt), String(r.flag), r.inner.n, Object.keys(r).join(""), state(r)].join("/") }
function stores(r: Rec): string {
  return [attempt(() => { r.a = 2 }), attempt(() => { r.b += "!" }), attempt(() => { r.opt = 3 }), attempt(() => { r.flag = true }), attempt(() => { r.inner.n++ }),
    attempt(() => r.a++), attempt(() => (r.opt ??= 9)), attempt(() => delete r.opt), attempt(() => delete r.flag), attempt(() => { r.inner = { n: 0 } })].join()
}
const free = make(), frozen = make(), sealed = make(), fixed = make()
Object.freeze(frozen); Object.seal(sealed); Object.preventExtensions(fixed)
console.log(stores(free), show(free))
console.log(stores(frozen), show(frozen))
console.log(stores(sealed), show(sealed))
console.log(stores(fixed), show(fixed))
const sealedWith: Rec = Object.seal<Rec>({ a: 1, b: "b", opt: 0, inner: { n: 1 } })
const fixedWith: Rec = Object.preventExtensions<Rec>({ flag: false, a: 1, b: "b", opt: 0, inner: { n: 1 } })
console.log(stores(sealedWith), show(sealedWith))
console.log(stores(fixedWith), show(fixedWith), attempt(() => { fixedWith.opt = 1 }), attempt(() => { fixedWith.flag = true }))
console.log(show(make()), stores(make()) === stores(make()))
// Reflection answers false where a store throws.
console.log(Reflect.set(frozen, "a", 5), Reflect.set(fixed, "opt", 5), Reflect.deleteProperty(sealed, "a"), Reflect.defineProperty(frozen, "a", { value: 9 }), Reflect.defineProperty(frozen, "a", { value: 1 }), frozen.a)
console.log(JSON.stringify(Object.getOwnPropertyDescriptor(frozen, "a")), JSON.stringify(Object.getOwnPropertyDescriptor(sealed, "b")), JSON.stringify(Object.getOwnPropertyDescriptor(fixed, "a")))
// With no property left, an object that cannot grow counts as frozen: room for absent fields is not a property.
interface AllOptional { p?: number; q?: string }
const hollow: AllOptional = {}
Object.preventExtensions(hollow)
console.log(state(hollow), attempt(() => { hollow.p = 1 }), String(hollow.p), Object.keys(hollow).length)
const drained: AllOptional = { p: 1, q: "q" }
Object.preventExtensions(drained)
console.log(state(drained) === "", delete drained.p, delete drained.q, state(drained), attempt(() => { drained.p = 2 }), "p" in drained)
// Classes: frozen in the constructor, before the fields of a subclass; methods and setters that store.
class Immutable { x = 1; y: number; late?: string; constructor(y: number) { this.y = y; Object.freeze(this) } move(): this { this.x++; return this } name(s: string) { this.late = s } }
class Extended extends Immutable { z = 3 }
const still = new Immutable(2)
console.log(attempt(() => still.move()), attempt(() => still.name("n")), still.x, still.y, String(still.late), attempt(() => new Extended(2).z), state(still))
class Wrapped { #v = 0; raw = 0; get v() { return this.#v } set v(x: number) { this.#v = x } set r(x: number) { this.raw = x } }
const wrapped = new Wrapped()
Object.freeze(wrapped)
console.log(attempt(() => (wrapped.v = 5)), wrapped.v, attempt(() => (wrapped.r = 5)), wrapped.raw)
// The right-hand side freezes the receiver; a loop freezes it half way; a helper that takes `any` or a type parameter does it.
const late = make()
console.log(attempt(() => { late.a = (Object.freeze(late), 5) }), late.a, attempt(() => { late.inner.n += (Object.freeze(late.inner), 5) }), late.inner.n)
function fill(r: Rec, upTo: number, freezeAt: number): string {
  let i = 0
  try { for (; i < upTo; i++) { if (i === freezeAt) Object.freeze(r); r.a = i; r.inner.n = i } } catch (e) { return (e as Error).constructor.name + "@" + i + ":" + r.a + ":" + r.inner.n }
  return "done:" + r.a
}
console.log(fill(make(), 100, 50), fill(make(), 100, 100), fill(make(), 100, 0), fill(frozen, 1, 5))
function freezeAny(o: any): void { Object.freeze(o) }
function deepFreeze<T extends object>(o: T): T {
  for (const k of Object.keys(o)) { const x = (o as Record<string, unknown>)[k]; if (typeof x === "object" && x !== null) deepFreeze(x) }
  Object.freeze(o)
  return o
}
const viaAny = make(), deep = deepFreeze(make())
freezeAny(viaAny)
console.log(stores(viaAny), show(viaAny))
console.log(stores(deep), show(deep), state(deep.inner))
// A copy of a frozen object is free; its neighbours of the same layout never were frozen.
const thawed: Rec = { ...frozen, opt: 1 }
console.log(stores(thawed), show(thawed), show(frozen))
const row: Rec[] = []
for (let i = 0; i < 12; i++) { const r = make(); if (i % 3 === 0) Object.freeze(r); else if (i % 3 === 1) Object.seal(r); row.push(r) }
console.log(row.map(r => attempt(() => { r.a += 10; r.opt = r.a; return r.opt })).join(), row.map(r => r.a).join())
