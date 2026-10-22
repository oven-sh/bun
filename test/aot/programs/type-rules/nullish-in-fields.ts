// A typed object can lose a required field and can get null or undefined in a `number` or `boolean` field, through a wider type, through untyped code or by reflection, as in plain Bun. undefined and null pass the typed read of such a field.
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ": no error", String(f())) } catch (e) { console.log(label + ":", e instanceof TypeError ? "TypeError" : "other " + e) }
}
interface Rec { n: number; s: string; b: boolean; tail: number }
function fresh(): Rec { return { n: 1, s: "s", b: true, tail: 9 } }
function show(o: object): string { return Object.keys(o).join() + " " + JSON.stringify(o) }
function drop(o: any, k: string) { return delete o[k] }
function poke(o: any, k: string, v: unknown) { o[k] = v }
const r = fresh()
attempt("delete, number", () => drop(r, "n"))
attempt("delete, string", () => drop(r, "s"))
attempt("delete, boolean", () => drop(r, "b"))
attempt("delete, by Reflect", () => Reflect.deleteProperty(r, "n"))
attempt("store, undefined for a number", () => poke(r, "n", undefined))
attempt("store, null for a number", () => poke(r, "n", null))
attempt("store, undefined for a boolean", () => poke(r, "b", undefined))
attempt("store, by Object.assign", () => { Object.assign(r, { tail: 10, n: undefined, s: null }) })
attempt("store, by Reflect.set", () => Reflect.set(r, "n", null))
attempt("getter that yields undefined", () => { Object.defineProperty(r, "n", { get: () => undefined, enumerable: true, configurable: true }) })
console.log(show(r))
// No any and no cast: a type in which the field is optional. The field is deleted and stored as in plain Bun,
// and undefined passes the read through the narrower type.
interface Tight { n: number; s: string; b: boolean }
interface Looser { n?: number; s?: string | null }
const t: Tight = { n: 1, s: "s", b: true }
const l: Looser = t
attempt("wider view, delete", () => delete l.n)
attempt("Partial, delete", () => delete (t as Partial<Tight>).b)
attempt("wider view, store of undefined", () => { l.n = undefined })
attempt("wider view, read of it", () => String(l.n))
attempt("the type itself, read of it", () => t.n + 1)
console.log("n" in t, show(t))
l.n = 4
console.log(t.n + 1, show(t))
// Stores from untyped code succeed.
attempt("store from untyped code, undefined for a number that is optional in a wider view", () => poke(t, "n", undefined))
attempt("the same, null", () => poke(t, "n", null))
attempt("the type itself, read of it", () => t.n + 1)
// Another prototype, so that something would show through.
attempt("another prototype", () => { Object.setPrototypeOf(fresh(), { n: 7 }) })
attempt("an heir of a Rec as a Rec", () => (Object.create(fresh()) as Rec).n)
class Acc { total = 0; label = "acc"; add(n: number) { this.total += n; return this.total } }
const a = new Acc()
attempt("instance, delete", () => drop(a, "total"))
attempt("instance, null for a number", () => poke(a, "total", null))
attempt("a property by the name of a field on the prototype of the class", () => { (Acc.prototype as any).total = 40 })
console.log(a.add(1), show(a))
// A function used as a constructor through any: `this` is an ordinary object, and any object passes the type Rec.
function Old(this: Rec) { this.n = 1; this.s = "s"; this.b = true; this.tail = 9 }
attempt("constructor function through any", () => { const o: Rec = new (Old as any)(); return o.n })
