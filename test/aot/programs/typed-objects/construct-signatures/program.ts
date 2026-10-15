interface Gauge { level: number; unit: string; read(): string; reset?(): void }
interface GaugeCtor { new (level: number): Gauge; readonly kindName: string }
class ClassGauge implements Gauge {
  static kindName = "class"
  unit = "c"
  level: number
  constructor(level: number) { this.level = level }
  read() { return this.level + this.unit }
}
class ResettableGauge extends ClassGauge {
  static override kindName = "resettable"
  initial: number
  constructor(level: number) { super(level); this.initial = level; this.unit = "r" }
  reset() { this.level = this.initial }
  override read() { return "[" + super.read() + "]" }
}
function FnGauge(this: Gauge, level: number) { this.level = level; this.unit = "f"; this.read = readFnGauge }
function readFnGauge(this: Gauge) { return this.unit + ":" + this.level }
FnGauge.kindName = "function"
function LiteralGauge(level: number): Gauge { return { unit: "l", level, read() { return "lit " + this.level } } }
LiteralGauge.kindName = "literal"
const BoundGauge: GaugeCtor = Object.assign(ClassGauge.bind(null), { kindName: "bound" })
function makeGauge(unit: string): GaugeCtor {
  return class implements Gauge { static kindName = "made " + unit; level: number; unit = unit; constructor(level: number) { this.level = level } read() { return this.unit + this.level } }
}
function describe(g: Gauge): string { return Object.keys(g).join() + "|" + g.level + g.unit + "|" + g.read() + "|" + (g.reset ? "resettable" : "fixed") + ("reset" in g) }
const ctors: GaugeCtor[] = [ClassGauge, ResettableGauge, FnGauge as unknown as GaugeCtor, BoundGauge, LiteralGauge as unknown as GaugeCtor, makeGauge("m"), makeGauge("n")]
for (const C of ctors) {
  const g = new C(4)
  console.log(C.kindName, describe(g), g instanceof C, g instanceof ClassGauge, Object.getPrototypeOf(g) === C.prototype, Object.getPrototypeOf(g) === Object.prototype, (g as any).constructor.name)
  g.level += 0.5; g.unit += "'"
  g.reset?.()
  console.log(describe(g), JSON.stringify(g))
}
console.log(ctors[5] === ctors[6], new ctors[5](1) instanceof ctors[6])

// Generic functions that construct.
function create<T>(C: new (level: number) => T, level: number): T { return new C(level) }
function pairOf<T extends Gauge>(C: new (level: number) => T, level: number): [T, T] { const a = new C(level), b = new C(level + 1); a.unit += "a"; b.unit += "b"; return [a, b] }
console.log(create(ClassGauge, 1).read(), create(ResettableGauge, 2).initial, create(ctors[2], 3).read(), create(BoundGauge, 4).level, pairOf(ResettableGauge, 5).map(g => g.read() + g.initial).join(), pairOf(ctors[4], 6).map(describe).join(" "))
class Unrelated { constructor(public level: number) {} }
console.log(Object.keys(create(Unrelated, 7)).join(), create(Unrelated, 8).level, create(Array as new (n: number) => number[], 3).length, create(Number as unknown as new (n: number) => Number, 9).valueOf() + 1)

// The constructor is held in a field of a typed object, which is stored to.
const config: { Gauge: GaugeCtor; fallback?: GaugeCtor } = { Gauge: ClassGauge }
function fromConfig(level: number): Gauge { return new config.Gauge(level) }
function fromFallback(level: number): Gauge { return new (config.fallback ?? config.Gauge)(level) }
const seen: string[] = [fromConfig(1).read(), fromFallback(1).read()]
config.Gauge = FnGauge as unknown as GaugeCtor
seen.push(fromConfig(2).read(), fromFallback(2).read())
config.fallback = ResettableGauge
seen.push(fromConfig(3).read(), fromFallback(3).read())
;(config as any).Gauge = makeGauge("z")
delete config.fallback
seen.push(fromConfig(4).read(), fromFallback(4).read(), Object.keys(config).join())
console.log(seen.join(" "))

// One of two constructors, and a value with a construct signature that is not a constructor.
function either(flag: boolean, level: number) { const C: typeof ClassGauge | typeof ResettableGauge = flag ? ClassGauge : ResettableGauge; return new C(level) }
console.log(describe(either(true, 1)), describe(either(false, 2)))
for (const bad of [() => 1, { kindName: "object" }, Math.max, undefined, null, async function () {}, function* () {}] as unknown[]) {
  try { console.log(describe(new (bad as GaugeCtor)(1))) } catch (e) { console.log((e as Error).constructor.name) }
}

// An optional method is stored through the interface: an own property, beside or over the method of the class.
const plainGauge: Gauge = new ClassGauge(10), resettable: Gauge = new ResettableGauge(20), byFunction: Gauge = new ctors[2](30)
function resetIfItCan(g: Gauge) { g.reset?.() }
for (const g of [plainGauge, resettable, byFunction]) {
  g.level++
  g.reset = function (this: Gauge) { this.level = -1 }
  g.reset()
  console.log(describe(g), Object.hasOwn(g, "reset"))
  delete g.reset
  resetIfItCan(g)
  console.log(describe(g))
}
let total = 0
for (let i = 0; i < 27000; i++) { const g = new ctors[i % ctors.length](i & 15); if (i & 1) g.reset?.(); total += g.level + g.unit.length + g.read().length }
console.log(total)
