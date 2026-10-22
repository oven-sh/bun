// A required field is deleted, and undefined or null is stored into a `number` or `boolean` field, through `any`, `Partial<T>` or reflection: every change succeeds, and a typed read afterwards gets undefined or null, which pass every written type.
function refused(label: string, f: () => unknown) { try { f(); console.log(label + ": no error") } catch (e) { console.log(label + ":", e instanceof TypeError ? "TypeError" : "other " + e) } }
interface Rec { n: number; s: string; b: boolean; tail: number }
interface Looser { n?: number; s?: string | null }
function fresh(): Rec { return { n: 1, s: "s", b: true, tail: 9 } }
function show(o: object): string { return Object.keys(o).join() + " " + JSON.stringify(o) }
function drop(o: any, k: string) { return delete o[k] }
function poke(o: any, k: string, v: unknown) { o[k] = v }

const a = fresh()
refused("required number deleted through any", () => drop(a, "n"))
refused("required string deleted through any", () => drop(a, "s"))
refused("required boolean deleted through any", () => drop(a, "b"))
refused("by Reflect.deleteProperty", () => Reflect.deleteProperty(a, "n"))
refused("through Partial<Rec>", () => delete (a as Partial<Rec>).n)
// No any and no cast.
function dropN(l: Looser) { return delete l.n }
refused("through a view where it is optional", () => dropN(a))
console.log(show(a), a.n + 1, a.s + "!", a.b ? 1 : 0)

interface Tight { n: number; s: string; b: boolean }
const t: Tight = { n: 1, s: "s", b: true }
refused("undefined stored to a number field", () => poke(t, "n", undefined))
refused("null stored to a number field", () => poke(t, "n", null))
refused("undefined stored to a boolean field", () => poke(t, "b", undefined))
refused("undefined for a number by Object.assign", () => { const source: any = { n: undefined }; Object.assign(t, source) })
refused("null stored to a string field", () => poke(t, "s", null))
console.log(show(t), t.s, t.s + "!")

const w = fresh()
function clearN(l: Looser) { l.n = undefined }
refused("undefined stored through a view where the number is optional", () => clearN(w))
refused("the same through any", () => poke(w, "n", undefined))
refused("null, which no view allows", () => poke(w, "n", null))
refused("read through the type that says number", () => w.n + 1)
console.log(Object.hasOwn(w, "n"), show(w))
w.n = 4
console.log(w.n + 1, show(w))

const r = fresh()
refused("field made an accessor", () => Object.defineProperty(r, "n", { get: () => undefined, enumerable: true, configurable: true }))
refused("another prototype", () => Object.setPrototypeOf(r, { n: 7 }))
console.log(r.n + 1, Object.hasOwn(r, "n"), show(r))

// The same for the fields of a class.
class Acc { total = 0; label = "acc"; add(n: number) { this.total += n; return this.total } }
const acc = new Acc()
refused("field of a class deleted", () => drop(acc, "total"))
refused("null stored to a number field of a class", () => poke(acc, "total", null))
console.log(acc.total, acc.add(1), show(acc))
