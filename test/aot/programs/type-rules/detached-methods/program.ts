class Counter {
  count = 0
  step = 1
  bump(): number { this.count += this.step; return this.count }
  describe(prefix: string): string { return prefix + this.count + "/" + this.step }
  get double(): number { return this.count * 2 }
  set double(v: number) { this.count = v / 2 }
  static tally = 0
  static note(): number { return ++this.tally }
}
class FastCounter extends Counter {
  override step = 10
  override describe(prefix: string): string { return "fast " + super.describe(prefix) }
}
class Meter { step = 3; label = "m"; count = 100; bump(): number { return -1 } }
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ": no error", String(f())) } catch (e) { console.log(label + ":", e instanceof TypeError ? "TypeError" : "other " + e) }
}
function show(o: object): string { return Object.keys(o).join() + JSON.stringify(o) }
const c = new Counter(), fast = new FastCounter(), meter = new Meter()
const bump = c.bump, describe = c.describe
attempt("another class", () => bump.call(meter))
attempt("another class, with an argument", () => describe.call(meter, "m"))
const plain = { count: 10, step: 5 }, swapped = { step: 0.5, extra: "e", count: -1 }
const parsed = JSON.parse('{"count":1,"step":2}'), bare = Object.assign(Object.create(null), { step: 7, count: 7 })
attempt("a literal", () => bump.call(plain))
attempt("a literal with more", () => bump.call(swapped))
attempt("plain data", () => bump.call(parsed))
attempt("plain data over null", () => bump.call(bare))
const heir = Object.create(c), heirOfPlain = Object.create(plain)
attempt("an heir of an object of the class", () => bump.call(heir))
attempt("the same, by name", () => heir.bump())
attempt("an heir of a literal", () => bump.call(heirOfPlain))
const seen: string[] = []
const watched = { get count() { seen.push("get count"); return 40 }, set count(v: number) { seen.push("set count " + v) }, get step() { seen.push("get step"); return 2 } }
attempt("accessors", () => bump.call(watched))
attempt("a proxy", () => bump.call(new Proxy({ count: 3, step: 4 }, { get(t, k, r) { seen.push("get " + String(k)); return Reflect.get(t, k, r) }, set(t, k, v, r) { seen.push("set " + String(k)); return Reflect.set(t, k, v, r) } })))
console.log(seen.length, show(plain), show(swapped), show(parsed), show(bare), show(heir), show(heirOfPlain), c.count, meter.count)
const double = Object.getOwnPropertyDescriptor(Counter.prototype, "double") as { get(this: unknown): number; set(this: unknown, v: number): void }
attempt("setter", () => double.set.call(plain, 9))
attempt("getter", () => double.get.call(meter))
attempt("getter, by Reflect.get with a receiver", () => Reflect.get(c, "double", plain))
attempt("setter, by Reflect.set with a receiver", () => Reflect.set(c, "double", 50, swapped))
attempt("apply", () => bump.apply(plain))
attempt("Reflect.apply", () => Reflect.apply(bump, swapped, []))
attempt("bind", () => c.bump.bind(plain)())
attempt("the `this` argument of map", () => ["a", "b"].map(c.describe, plain).join())
const borrower = { count: 1000, step: 1, bump: c.bump, describe: fast.describe }
attempt("borrowed by assignment", () => borrower.bump())
attempt("borrowed by assignment, with an argument", () => borrower.describe("b"))
console.log(show(plain), show(swapped), show(borrower), c.count)
// A static method takes any `this` too.
const note = Counter.note
attempt("static, a literal", () => note.call({ tally: 41 }))
// A cast lets any object through as it is: this one inherits.
function area(this: { w: number; h: number }): number { return this.w * this.h }
attempt("cast of an heir", () => (Object.assign(Object.create({ area, w: 7 }), { h: 8 }) as { w: number; h: number; area: typeof area }).area())
