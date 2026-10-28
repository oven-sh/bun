// Typed objects reach untyped code indirectly (`arguments`, `apply`, `bind`, `catch`, JSON replacers ..): what that code does to them succeeds or fails as in plain Bun, and typed code sees the result. (The store of a text fails because `id` is an accessor without a setter by then.)
interface Acct { id: number; owner: string; limit?: number; peer?: Acct }
function show(o: object): string { return Object.keys(o).join() + " " + JSON.stringify(o, (k, v) => k === "peer" ? "peer" : v) }
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
function acct(id: number): Acct { return { id, owner: "o" + id } }
let tampered = 0
const outcomes = new Map<unknown, string>()
function refused(f: () => void): string { try { f(); return "no error" } catch (e) { return e instanceof TypeError ? "TypeError" : "other " + e } }
function tamper(x: any) {
  tampered++
  outcomes.set(x, "getter: " + refused(() => { Object.defineProperty(x, "id", { get() { return 1000 }, enumerable: true, configurable: true }) })
    + ", prototype: " + refused(() => { Object.setPrototypeOf(x, { inherited: "yes" }) })
    + ", kind: " + refused(() => { x.id = "text" }))
}
function check(label: string, a: Acct) { console.log(label + ":", (outcomes.get(a) ?? "left alone") + ";", a.id, a.id + 1, a.owner, show(a), "inherited" in a) }

// 1. `arguments`.
function viaArguments(a: Acct) { tamper(arguments[0]); return a }
check("arguments", viaArguments(acct(1)))

// 2. The receiver of a call made by Reflect.apply, Function.prototype.call and bind.
function tamperThis(this: unknown) { tamper(this) }
const a2 = acct(2), a3 = acct(3), a4 = acct(4)
Reflect.apply(tamperThis, a2, []); tamperThis.call(a3); tamperThis.bind(a4)()
check("apply", a2); check("call", a3); check("bind", a4)

// 3. throw and catch.
const a5 = acct(5)
try { throw a5 } catch (e) { tamper(e) }
check("catch", a5)

// 4. The holder and the values a JSON replacer sees, and `this` of toJSON.
const a6 = acct(6), a7 = acct(7)
JSON.stringify({ wrapped: a6 }, function (key, value) { if (key === "wrapped") tamper(value); return value })
JSON.stringify(a7, function (this: unknown, key, value) { if (key === "owner") tamper(this); return value })
check("replacer value", a6); check("replacer holder", a7)

// 5. The third argument of array callbacks, Object.values and entries of a container, iteration of a Map and a Set.
const a8 = acct(8), a9 = acct(9), a10 = acct(10), a11 = acct(11)
;[a8].forEach((_, i, whole: unknown[]) => tamper(whole[i]))
for (const v of Object.values({ held: a9 }) as unknown[]) tamper(v)
new Map<string, Acct>([["k", a10]]).forEach(function () { tamper(arguments[0]) })
for (const v of new Set<unknown>([a11])) tamper(v)
check("callback array", a8); check("values", a9); check("map", a10); check("set", a11)

// 6. A field of another typed object, found by reflection.
const a12 = acct(12), a13 = acct(13)
a12.peer = a13
tamper(Reflect.get(a12, "peer"))
check("reflect get", a13)
console.log(a12.peer.id, a12.peer.limit, a12.id)
const a14 = acct(14), a15 = acct(15)
a14.peer = a15
tamper(Object.getOwnPropertyDescriptor(a14, "peer")?.value)
check("descriptor", a15)

const a16 = acct(16)
const p16: any = new Proxy<object>(a16, { get(target, key, receiver) { if (key === "owner") tamper(target); return Reflect.get(target, key, receiver) } })
console.log(p16.owner, p16.id)
check("proxy target", a16)
try { const typed: Acct = new Proxy(a16, {}); console.log("a proxy as an Acct: no error", typed.id) } catch (e) { console.log("a proxy as an Acct:", e instanceof TypeError ? "TypeError" : "other " + e) }

// 8. Promise resolution, generators, tagged templates, WeakRef, sort comparators, Symbol.toPrimitive.
const a17 = acct(17), a18 = acct(18), a19 = acct(19), a20 = acct(20), a21 = acct(21)
function* passes(): Generator<unknown, void, unknown> { tamper(yield) }
const g = passes(); g.next(); g.next(a17)
function tag(strings: TemplateStringsArray, ...values: unknown[]) { values.forEach(tamper); return strings.length }
tag`x${a18}y`
tamper(new WeakRef<object>(a19).deref())
;[a20, acct(0)].sort(function () { tamper(arguments[0]); tamper(arguments[1]); return 0 })
check("generator", a17); check("template", a18); check("weakref", a19); check("sort", a20)
Promise.resolve<unknown>(a21).then(v => { tamper(v); check("promise", a21); console.log(tampered) })

// 9. The constructor's `this` leaks before the fields are stored, and a class instance leaks through a static registry typed `object`.
const registry: object[] = []
class Tracked { a: number; b = "b"; c?: number; constructor(n: number) { registry.push(this); this.a = n } sum() { return this.a + this.b + this.c } }
const t1 = new Tracked(1), t2 = new Tracked(2)
for (const r of registry) console.log("instance, getter:", refused(() => { Object.defineProperty(r, "a", { get() { return 7 }, configurable: true, enumerable: false }) }), "kind:", refused(() => { Object.assign(r, { c: "3" }) }))
console.log(t1.sum(), t2.a, (t2 as any).c, Object.keys(t1).join(), JSON.stringify(t2))

// 10. Objects that never leaked stay as they were made, at the same sites.
check("untouched", acct(99))
