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
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
function show(o: object): string { return Object.keys(o).join() + JSON.stringify(o) }
const c = new Counter(), other = new Counter(), fast = new FastCounter(), meter = new Meter()
const bump = c.bump, describe = c.describe, fastDescribe = fast.describe

console.log(attempt(() => bump()), attempt(() => describe("x")), attempt(() => (0, c.bump)()), attempt(() => (c.bump)()), c.count)
console.log(bump.call(other), bump.call(other), other.count, c.count, bump.call(fast), fast.count, meter.bump(), meter.count, describe.call(fast, "f"), fastDescribe.call(fast, "f"), fastDescribe.call(new FastCounter(), "n"))
// `this` of a method is not tested: a Counter runs the method of FastCounter.
console.log(fastDescribe.call(new Counter(), "c"))

console.log(attempt(() => bump.call(Object.freeze(new Counter()))), attempt(() => bump.call(Object.seal(new Counter()))), attempt(() => bump.call(Object.preventExtensions(new Counter()))))

// Accessors taken from the prototype.
const double = Object.getOwnPropertyDescriptor(Counter.prototype, "double") as { get(this: unknown): number; set(this: unknown, v: number): void }
double.set.call(other, 9); double.set.call(fast, 5)
console.log(double.get.call(other), other.double, double.get.call(fast), fast.count, attempt(() => double.get.call(undefined)), Reflect.get(c, "double", other), Reflect.set(c, "double", 50, fast), fast.count, c.count)

// bind, apply, Reflect.apply, callbacks with and without a `this` argument.
const boundToOther = c.bump.bind(other), boundTwice = boundToOther.bind(fast)
console.log(boundToOther(), boundToOther.call(fast), boundTwice(), other.count, fast.count, bump.apply(fast), bump.apply(fast, []), Reflect.apply(bump, other, []), Reflect.apply(describe, fast, ["r"]))
console.log(attempt(() => ["a", "b"].map(c.describe).join()), ["a", "b"].map(c.describe, c).join(), ["a", "b"].map(c.describe, fast).join(), ["a", "b"].map(fast.describe, fast).join(), ["a"].map(p => c.describe(p)).join())
const handlers: (() => number)[] = [c.bump, c.bump.bind(c), () => c.bump(), other.bump.bind(fast)]
console.log(handlers.map(h => attempt(h)).join(), c.count, fast.count)

// Functions with a declared `this` shared by several shapes.
function area(this: { w: number; h: number }): number { return this.w * this.h }
class Sheet { w = 2; h = 3; area = area }
const boxes = [{ w: 4, h: 5, area }, { h: 0.5, area, w: 6 }, new Sheet()]
console.log(boxes.map(b => b.area()).join(), area.call({ w: 1, h: 1 }), attempt(() => (area as any)()), attempt(() => { const f = boxes[0].area as () => number; return f() }))

// Statics, private names and arrow fields.
const note = Counter.note
console.log(Counter.note(), FastCounter.note(), Object.hasOwn(FastCounter, "tally"), Counter.tally, FastCounter.tally, attempt(() => note()), note.call(Counter))
class Vault {
  #secret = 7
  level = 1
  reveal(): number { return this.#secret + this.level }
  static holds(o: object): boolean { return #secret in o }
  held = (): number => this.#secret * this.level
}
const vault = new Vault(), reveal = vault.reveal, held = vault.held
console.log(reveal.call(vault), reveal.call(new Vault()), attempt(() => reveal.call({ level: 1 })), attempt(() => reveal.call(Object.create(vault))), attempt(() => reveal()), held(), held.call({ level: 5 }), Vault.holds(vault), Vault.holds(Object.create(vault)), Vault.holds({ level: 1 }))

const receivers: { count: number; step: number }[] = [c, other, fast]
let total = 0
for (let i = 0; i < 30000; i++) { const r = receivers[i % receivers.length]; total += bump.call(r) + describe.call(r, "").length; if (r.count > 1e6) r.count = 0 }
console.log(total, receivers.map(r => r.count).join())
