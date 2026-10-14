// A wrong object type at a binding, parameter, result, field, element or `this` throws; `as` lets it through as it is, and what it lacks reads as undefined.
/* expected
w1 undefined
r1 2
w2 TypeError
r2 2
w3 TypeError
r3 2
w4 TypeError
r4 2
w5 TypeError
r5 2
w6 stored
r6 2
w7 TypeError
r7 2
w8 TypeError
r8 2
w9 TypeError
r9 K
w10 false
w11 TypeError
w12 undefined
w13 undefined
w14 undefined
w15 object
r15 1 false
w16 undefined
r16 1 null
w17 TypeError
w18 1
w19 TypeError
s1 3
s2 number string boolean
s3 2
s4 1 undefined
s5 5 a,z
*/
function attempt(label: string, f: () => unknown) {
  try { console.log(label, String(f())) } catch (e) { console.log(label, (e as Error).constructor.name) }
}
const hide = (v: unknown): any => v
interface A { a: number; shared?: string }
interface B { b: string; shared?: string }
interface Wide { a: number; shared?: string; more: boolean }
class K { k = 1; who() { return "K" } }
class L { l = "l"; read() { return this.l } }
const makeA = (): A => ({ a: 1 })
const makeB = (): B => ({ b: "b" })
const makeWide = (): Wide => ({ a: 2, more: true })
// Cast.
attempt("w1", () => (makeB() as unknown as A).a)
attempt("r1", () => (makeWide() as unknown as A).a)
// Binding whose type is written down.
attempt("w2", () => { const x: A = hide(makeB()); return x.a })
attempt("r2", () => { const x: A = hide(makeWide()); return x.a })
// Parameter, entered by a caller that knows nothing of it.
function readA(x: A): number { return x.a }
attempt("w3", () => (readA as any)(makeB()))
attempt("r3", () => (readA as any)(makeWide()))
// Result.
function result(v: unknown): A { return hide(v) }
attempt("w4", () => result(makeB()).a)
attempt("r4", () => result(makeWide()).a)
// Field, stored to by typed code and by untyped code.
interface Holder { item: A }
attempt("w5", () => { const h: Holder = { item: makeA() }; h.item = hide(makeB()); return h.item.a })
attempt("r5", () => { const h: Holder = { item: makeA() }; h.item = hide(makeWide()); return h.item.a })
attempt("w6", () => { const h: Holder = { item: makeA() }; try { (h as any).item = makeB(); return "stored" } catch (e) { return (e as Error).constructor.name + " " + h.item.a } })
attempt("r6", () => { const h: Holder = { item: makeA() }; (h as any).item = makeWide(); return h.item.a })
// Element: of an array that is cast, and of one that got it behind the type.
attempt("w7", () => ([makeB()] as unknown as A[])[0].a)
attempt("r7", () => ([makeWide()] as unknown as A[])[0].a)
attempt("w8", () => { const list: A[] = []; (list as unknown[]).push(makeB()); return list[0].a })
attempt("r8", () => { const list: A[] = []; (list as unknown[]).push(makeWide()); return list[0].a })
// `this`.
attempt("w9", () => K.prototype.who.call(hide(makeB())))
attempt("r9", () => K.prototype.who.call(hide(new K())))
// A class is no interface: only its own objects and those of its subclasses are of it. (w11: `this` is a declared place.)
attempt("w10", () => (makeB() as unknown as K) instanceof K)
attempt("w11", () => L.prototype.read.call({ l: "plain" } as L))
attempt("w12", () => (new K() as unknown as A).shared)
// Objects of JavaScriptCore.
attempt("w13", () => (new Map() as unknown as A).shared)
attempt("w14", () => (JSON.parse("[]") as A).shared)
// Plain data: copied into the type if it has what the type requires, else let through. (w17: the parameter of `call` is a declared place, though nobody wrote `A` there but the cast.)
attempt("w15", () => typeof (JSON.parse("{}") as A))
attempt("r15", () => { const source = JSON.parse('{"a":1}'); const x = source as A; return x.a + " " + (x === source) })
attempt("w16", () => (Object.create(null) as A).shared)
attempt("r16", () => { const x = Object.assign(Object.create(null), { a: 1 }) as A; return x.a + " " + Object.getPrototypeOf(x) })
attempt("w17", () => Object.prototype.toString.call(hide(new Map()) as A))
attempt("w18", () => Object.entries(makeA() as unknown as B).length)
// `{ a?: number }` has nothing in common with B and K, which so are not assignable to it.
attempt("w19", () => ([makeB(), makeA(), new K()] as unknown as { a?: number }[]).map(o => String(o.a)).join())
// The right kind through any, and sound narrowing of unknown.
attempt("s1", () => { const n: number = hide(1); const s: string = hide("2"); const b: boolean = hide(true); return b ? n + Number(s) : 0 })
attempt("s2", () => [1, "s", true].map((v: unknown) => typeof v === "number" ? typeof (v + 1) : typeof v === "string" ? typeof v.length === "number" ? "string" : "" : typeof v).join(" "))
attempt("s3", () => { const u: A | number = hide(2); return typeof u === "number" ? u : u.a })
// An optional field that the object's own layout lacks: read as undefined, stored as an extra property.
interface Both { a: number; z?: number }
attempt("s4", () => { const x = makeA() as unknown as Both; return x.a + " " + x.z })
attempt("s5", () => { const x = makeA() as unknown as Both; x.z = 4; return (x.a + x.z) + " " + Object.keys(x).join() })
