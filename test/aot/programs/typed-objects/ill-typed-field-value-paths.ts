// Every known way by which a field or an element comes to hold a value that its type does not allow: whether the store succeeds, and what later reads see.
// A store that enters no written type succeeds. The next read through a written type throws, whatever is done with the value. A read through an unannotated variable (5) or through a type that allows the value (17) does not throw, and neither does a missing field (6, 10, 11, 12) or undefined (13).
function attempt(label: string, f: () => unknown): void { try { console.log(label, String(f())) } catch (e) { console.log(label, (e as Error).constructor.name) } }
function plusOne(n: number): number { return n + 1 }
function hide<T>(value: unknown): T { return value as T }
function key(name: string): string { return name.split("").join("") }

// 1. A field is covariant: the object is looked at through a type whose field takes more.
interface Narrow { v: number }
interface Wide { v: number | string }
const n1: Narrow = { v: 1 }
const w1: Wide = n1
attempt("1 store", () => { w1.v = "text"; return "taken" })
attempt("1 looked at", () => n1.v)
attempt("1 held", () => plusOne(n1.v))

// 2. The same by a type argument.
interface Box<T> { value: T }
const n2: Box<number> = { value: 1 }
const w2: Box<number | string> = n2
attempt("2 store", () => { w2.value = "text"; return "taken" })
attempt("2 looked at", () => n2.value)
attempt("2 held", () => plusOne(n2.value))

// 3. The same by the constraint of a type parameter.
function put<T extends { v: unknown }>(o: T, v: unknown): void { o.v = v }
const n3: Narrow = { v: 1 }
attempt("3 store", () => { put(n3, "text"); return "taken" })
attempt("3 looked at", () => n3.v)
attempt("3 held", () => plusOne(n3.v))

// 4. An index signature: a type literal is assignable to a dictionary.
type Lit = { v: number }
const n4: Lit = { v: 1 }
const w4: { [k: string]: number | string } = n4
attempt("4 store", () => { w4["v"] = "text"; return "taken" })
attempt("4 looked at", () => n4.v)
attempt("4 held", () => plusOne(n4.v))

// 5. A subclass declares the field narrower.
class Loose { v: number | string = 1 }
class Strict extends Loose { declare v: number }
const n5 = new Strict()
const w5: Loose = n5
attempt("5 store", () => { w5.v = "text"; return "taken" })
attempt("5 looked at", () => n5.v)
attempt("5 held", () => plusOne(n5.v))

// 6. A forced cast somewhere: an object of another type is admitted to the view, and then stands in a field of that type.
interface A { a: number; shared?: string }
interface B { b: string; shared?: string }
interface Holder { item: A }
const makeB = (): B => ({ b: "b", shared: "s" })
const h6: Holder = { item: { a: 1 } }
attempt("6 the cast", () => (makeB() as unknown as A).shared)
attempt("6 store", () => { h6.item = makeB() as unknown as A; return "taken" })
attempt("6 looked at", () => h6.item.a)
attempt("6 held", () => plusOne(h6.item.a))

// 7. Untyped code stores to the field by name.
const n7: Narrow = { v: 1 }
attempt("7 store", () => { (n7 as any).v = "text"; return "taken" })
attempt("7 looked at", () => n7.v)
attempt("7 held", () => plusOne(n7.v))

// 8. Untyped code stores by a computed key, by Object.assign, by Reflect.set, by defineProperty with a value.
const n8a: Narrow = { v: 1 }, n8b: Narrow = { v: 1 }, n8c: Narrow = { v: 1 }, n8d: Narrow = { v: 1 }
attempt("8 by key", () => { (n8a as any)[key("v")] = "text"; return "taken" })
attempt("8 by key, looked at", () => n8a.v)
attempt("8 assign", () => { Object.assign(n8b, hide<Narrow>({ v: "text" })); return "taken" })
attempt("8 assign, looked at", () => n8b.v)
attempt("8 Reflect.set", () => Reflect.set(n8c, key("v"), "text"))
attempt("8 Reflect.set, looked at", () => n8c.v)
attempt("8 define", () => { Object.defineProperty(n8d, key("v"), { value: "text", writable: true, enumerable: true, configurable: true }); return "taken" })
attempt("8 define, looked at", () => n8d.v)

// 9. An accessor in the field's place.
const n9: Narrow = { v: 1 }
attempt("9 define", () => { Object.defineProperty(n9, key("v"), { get() { return "got" }, configurable: true }); return "taken" })
attempt("9 looked at", () => n9.v)
attempt("9 held", () => plusOne(n9.v))

// 10. The field is deleted.
const n10: Narrow = { v: 1 }
attempt("10 delete", () => delete (n10 as Partial<Narrow>).v)
attempt("10 looked at", () => n10.v)
attempt("10 held", () => plusOne(n10.v))

// 11. The object was made as less: a cast gives it a type that has more, and nothing has stored that yet.
interface More extends Narrow { late: number; ref: Narrow }
const n11 = { v: 1 } as Narrow as More
attempt("11 looked at", () => n11.late)
attempt("11 held", () => plusOne(n11.late))
attempt("11 a reference", () => n11.ref)
attempt("11 through it", () => n11.ref.v)

// 12. A class field that no constructor stores.
class Unset { n!: number; r!: Narrow }
const n12 = new Unset()
attempt("12 looked at", () => n12.n)
attempt("12 held", () => plusOne(n12.n))
attempt("12 a reference", () => n12.r)

// 13. null or undefined by `!` and by `as`.
interface Ref { r: Narrow; n: number }
const n13: Ref = { r: { v: 1 }, n: 1 }
const nothing: Narrow | undefined = hide<Narrow | undefined>(undefined)
attempt("13 store !", () => { n13.r = nothing!; return "taken" })
attempt("13 store as", () => { n13.r = nothing as Narrow; return "taken" })
attempt("13 looked at", () => n13.r)
attempt("13 a number as", () => { n13.n = hide<number | undefined>(undefined) as number; return "taken" })
attempt("13 a number looked at", () => n13.n)

// 14. A member of the view lacks the field, and untyped code has given it a property of that name.
interface Base14 { a: number }
interface With14 extends Base14 { extra?: number }
const n14: Base14 = { a: 1 }
attempt("14 store", () => { (n14 as any).extra = "text"; return "taken" })
attempt("14 looked at", () => (n14 as With14).extra)
attempt("14 held", () => plusOne((n14 as With14).extra ?? 0))

// 15. An optional field that is absent is read from the prototype chain.
interface Chain15 { a: number; zz15?: number }
const n15: Chain15 = { a: 1 }
attempt("15 a name of Object.prototype", () => typeof (n15 as { valueOf?: unknown }).valueOf)
attempt("15 given a prototype", () => { Object.setPrototypeOf(n15, { zz15: "inherited" }); return "taken" })
attempt("15 looked at", () => n15.zz15)

// 16. Data from outside under a written type, and under a cast.
attempt("16 written", () => { const o: Narrow = JSON.parse('{"v":"text"}'); return o.v })
attempt("16 cast", () => (JSON.parse('{"v":"text"}') as Narrow).v)
attempt("16 held", () => plusOne((JSON.parse('{"v":"text"}') as Narrow).v))
attempt("16 within", () => { const o: Holder = JSON.parse('{"item":{"a":"text"}}'); return o.item.a })

// 17. A type guard that lies, and an assertion function.
function isNarrow(o: Wide): o is Narrow { return true }
const w17: Wide = { v: "text" }
attempt("17 looked at", () => isNarrow(w17) ? w17.v : "no")
attempt("17 held", () => isNarrow(w17) ? plusOne(w17.v) : "no")

// 18. Elements: an array is covariant, a read past the end, a hole.
const n18: number[] = [1, 2]
const w18: (number | string)[] = n18
attempt("18 store", () => { w18.push("text"); return "taken" })
attempt("18 looked at", () => n18[2])
attempt("18 held", () => plusOne(n18[2]!))
attempt("18 past the end", () => n18[9])
attempt("18 past the end, held", () => plusOne(n18[9]!))

// 19. A literal type, an enum: the field promises the kind, so another number is taken.
interface Kind19 { kind: 1 | 2 }
const n19: Kind19 = { kind: 1 }
attempt("19 store", () => { n19.kind = 3 as 1; return "taken" })
attempt("19 looked at", () => n19.kind)

// 20. A method's parameter is bivariant: a place, not a field, and from there a field.
interface Sink { put(v: number | string): void }
class NumberSink { last = 0; put(v: number): void { this.last = v } }
const n20 = new NumberSink()
const w20: Sink = n20
attempt("20 store", () => { w20.put("text"); return "taken" })
attempt("20 looked at", () => n20.last)
