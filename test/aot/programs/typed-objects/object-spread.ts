// Object spread of and into typed objects: what is copied, in which order, which code runs, and what the copy is.
interface State { count: number; label: string; done?: boolean; nested: { deep: number } }
function show(o: object): string { return Object.keys(o).join() + " " + JSON.stringify(o) }
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
const s0: State = { count: 1, label: "a", nested: { deep: 1 } }

// The update idiom: same type in, same type out.
function update(prev: State, count: number): State { return { ...prev, count } }
const s1 = update(s0, 2), s2: State = { ...s1, done: true }, s3: State = { ...s2, done: undefined, label: "c" }
console.log(show(s0), show(s1), show(s2), show(s3), s1 !== s0, s1.nested === s0.nested, "done" in s1, "done" in s3)
let chain = s0
for (let i = 0; i < 50; i++) chain = i % 10 === 0 ? { ...chain, count: chain.count + 1, done: i > 20 } : { ...chain, count: chain.count + 1 }
console.log(show(chain), s0.count)

// Order: the place of a key is where it first appears, its value the last one.
const sourceOrder: State = { nested: { deep: 2 }, label: "z", count: 9 }
console.log(show({ ...sourceOrder }), show({ count: 0, ...(sourceOrder as Partial<State>) }), show({ ...sourceOrder, count: 0 }), show({ ...s0, ...sourceOrder }), show({ ...sourceOrder, ...s0 }), show({ extra: 1, ...s0, more: 2 }))

// Absent fields are not copied; explicit undefined is, and overwrites.
const partial: Partial<State> = { label: undefined, count: 5 }
const merged = { ...s0, ...partial }
console.log(show(merged), "label" in merged, (merged as Partial<State>).label, merged.count, show({ ...partial, ...s0 }), show({ ...{} as Partial<State>, ...s0 }))

// Extra properties, symbols and indices added through `any` are copied; non-enumerable ones and the prototype are not.
const sym = Symbol("sym")
const dressed: State = { count: 1, label: "d", nested: { deep: 0 } }
const anyDressed: any = dressed
anyDressed.extra = "x"; anyDressed[sym] = "s"; anyDressed[3] = "three"
Object.defineProperty(dressed, "hidden", { value: 1, enumerable: false })
const undressed: State = { ...dressed }
console.log(show(undressed), (undressed as any)[sym], undressed.count, "label" in undressed, "hidden" in undressed, Reflect.ownKeys(undressed).length)

// Getters run, once each and in order, and the copy holds plain values.
const order: string[] = []
const live = { get first() { order.push("first"); return 1 }, plain: 2, get second() { order.push("second"); return this.plain * 10 } }
const dead = { before: order.push("before"), ...live, after: order.push("after") }
console.log(order.join(), show(dead), JSON.stringify(Object.getOwnPropertyDescriptor(dead, "first")), typeof Object.getOwnPropertyDescriptor(live, "first")!.get)
const explosive = { ok: 1, get bad(): number { throw new RangeError("bad") }, never: 2 }
console.log(attempt(() => ({ ...explosive })))

// Class instances: own fields only; the copy is a plain object with no methods, no accessors, no private names.
class Model { id = 1; #secret = 2; title = "t"; get upper() { return this.title.toUpperCase() } reveal() { return this.#secret } }
const model = new Model()
const flat = { ...model }
console.log(show(flat), flat instanceof Model, "reveal" in flat, "upper" in flat, Object.getPrototypeOf(flat) === Object.prototype, attempt(() => Model.prototype.reveal.call(flat as Model)), model.reveal())
class SubModel extends Model { extra = true }
console.log(show({ ...new SubModel(), id: 7 }))

// A non-object spreads to nothing, strings and arrays to their indices.
const nothing: State | undefined = undefined as State | undefined, nil: State | null = null as State | null, off: boolean = s0.count > 100
console.log(show({ ...nothing }), show({ ...nil, a: 1 }), show({ ...(5 as any) }), show({ ...(true as any) }), show({ ..."hi" as any }), show({ ...[7, 8] }), show({ ...(off && s0) }))

// Plain data used as the type.
const parsed: State = JSON.parse('{"label":"p","count":3,"nested":{"deep":4},"unknown":true}')
console.log(show({ ...parsed }), show({ ...parsed, count: parsed.count + 1 }))

// Spread in calls and arrays of typed objects' values, nested spreads, and a spread that changes a field's kind in the new type.
const retyped = { ...s0, count: "many" }
console.log(show(retyped), retyped.count.length, s0.count + 1, show({ ...s0, nested: { ...s0.nested, more: 1 } }), [...Object.values({ ...s0, nested: 0 })].join())
