// Untyped code gives a typed object a value of another kind, an accessor or another prototype. Every change succeeds as in plain Bun, and the next typed read of a field that holds another kind throws a TypeError.
function attempt(label: string, f: () => unknown) {
  try { console.log(label, String(f())) } catch (e) { console.log(label, (e as Error).constructor.name) }
}
function outcome(f: () => unknown): string { try { f(); return "stored" } catch (e) { return (e as Error).constructor.name } }
interface Rec { n: number; s: string; b: boolean; o?: number }
function fresh(): Rec { return { n: 1, s: "s", b: true } }
function poke(target: any, key: string, value: unknown) { target[key] = value }
attempt("a1", () => { const r: Rec = fresh(); return outcome(() => poke(r, "n", "text")) + " " + r.n })
attempt("a2", () => { const r: Rec = fresh(); return outcome(() => poke(r, "n", "text")) + " " + JSON.stringify(r) })
attempt("a3", () => { const r: Rec = fresh(); return outcome(() => poke(r, "n", 5)) + " " + (r.n + 1) })
attempt("a4", () => { const r: Rec = fresh(); return outcome(() => poke(r, "s", 5)) + " " + r.s })
attempt("a5", () => { const r: Rec = fresh(); return outcome(() => poke(r, "b", 0)) + " " + r.b })
attempt("a6", () => { const r: Rec = fresh(); return outcome(() => poke(r, "o", "opt")) + " " + r.o + " " + ("o" in r) })
attempt("a7", () => { const r: Rec = fresh(); return outcome(() => poke(r, "o", 3)) + " " + r.o + " " + Object.keys(r).join() })
attempt("a8", () => { const r: Rec = fresh(); return outcome(() => poke(r, "n", 2.5)) + " " + r.n })
// `undefined` and `null` pass every written type. An optional field that is stored `undefined` is there.
attempt("a9", () => { const r: Rec = fresh(); return outcome(() => poke(r, "n", undefined)) + " " + r.n })
attempt("a10", () => { const r: Rec = fresh(); return outcome(() => poke(r, "n", null)) + " " + r.n })
attempt("a11", () => { const r: Rec = fresh(); return outcome(() => poke(r, "s", undefined)) + " " + r.s + " " + Object.keys(r).join() })
attempt("a12", () => { const r: Rec = fresh(); return outcome(() => poke(r, "s", null)) + " " + r.s })
attempt("a13", () => { const r: Rec = fresh(); return outcome(() => poke(r, "o", undefined)) + " " + r.o + " " + ("o" in r) })
attempt("a14", () => { const r: Rec = fresh(); return outcome(() => poke(r, "extra", "anything")) + " " + Object.keys(r).join() })
// The other ways to write a field.
attempt("b1", () => { const r: Rec = fresh(); return outcome(() => Reflect.set(r, "n", {})) + " " + r.n })
attempt("b2", () => { const r: Rec = fresh(); return outcome(() => (Object.assign as any)(r, { n: "assigned" })) + " " + r.n })
attempt("b3", () => { const r: Rec = fresh(); return outcome(() => Object.defineProperty(r, "n", { value: "defined" })) + " " + r.n })
attempt("b4", () => { const r: Rec = fresh(); return outcome(() => Object.defineProperty(r, "n", { get: () => "got", configurable: true })) + " " + r.n })
attempt("b5", () => { const r: Rec = fresh(); return outcome(() => Object.defineProperty(r, "n", { get: () => 9, configurable: true })) + " " + r.n })
attempt("b6", () => { const r: Rec = fresh(); Object.defineProperty(r, "n", { value: 9 }); return r.n + 1 })
attempt("b7", () => { const r: Rec = fresh(); return Reflect.set(r, "n", 5) + " " + r.n })
attempt("b8", () => { const r: Rec = fresh(); (Object.assign as any)(r, { n: 5 }); return r.n + 1 })
// An update of the field begins with a typed read.
attempt("c1", () => { const r: Rec = fresh(); const tried = outcome(() => poke(r, "n", "5")); r.n++; return tried + " " + r.n })
attempt("c2", () => { const r: Rec = fresh(); const tried = outcome(() => poke(r, "n", "5")); r.n += 1; return tried + " " + (r as any).n })
class Acc { total = 0; add(n: number) { this.total += n; return this.total } get half() { return this.total / 2 } }
attempt("d1", () => { const a = new Acc(); return outcome(() => poke(a, "total", "0")) + " " + a.add(1) })
attempt("d2", () => { const a = new Acc(); return outcome(() => poke(a, "total", 10)) + " " + a.add(1) })
attempt("d3", () => { const a = new Acc(); return outcome(() => poke(a, "total", "8")) + " " + a.half })
// Another prototype: an absent optional field is inherited from it, and what the typed read finds there is tested like an own field.
attempt("e1", () => { const r: Rec = fresh(); return outcome(() => Object.setPrototypeOf(r, { o: "inherited" })) + " " + r.o })
attempt("e2", () => { const r: Rec = fresh(); return outcome(() => Object.setPrototypeOf(r, { o: 4 })) + " " + r.o })
attempt("e3", () => { const r: Rec = fresh(); return Reflect.setPrototypeOf(r, { o: 4 }) + " " + r.o })
attempt("e4", () => { const r: Rec = fresh(); return Object.setPrototypeOf(r, Object.prototype) === r })
attempt("e5", () => fresh().o)
// The prototype object of a class takes a property like any other object.
class Made { n = 1; s = "s"; b = true }
attempt("e6", () => { const r: Rec = new Made(); return outcome(() => { (Made.prototype as any).o = "polluted" }) + " " + r.o })
attempt("e7", () => { const r: Rec = new Made(); return outcome(() => { (Made.prototype as any).o = 12 }) + " " + (r as any).o })
attempt("e8", () => { const r: Rec = new Made(); return r.o })
function Old(this: Rec) { this.n = 1; this.s = "s"; this.b = true }
attempt("e9", () => { const r: Rec = new (Old as any)(); return r.o })
// One of three objects at one access site.
attempt("f1", () => {
  const all = [fresh(), fresh(), fresh()]
  all[2].n = 3
  return outcome(() => poke(all[1], "n", "two")) + " " + all.map(r => r.n).join()
})
