// Constructor functions with a typed `this`: `F.prototype` and members that are added to it later.
function show(o: object): string { return Object.keys(o).join() + " " + JSON.stringify(o) }
function attempt(label: string, f: () => unknown) { try { console.log(label, String(f())) } catch (e) { console.log(label, (e as Error).constructor.name) } }
function send(o: any, name: string, ...args: unknown[]): any { return o[name](...args) }

interface Pt { x: number; y: number; label?: string }
function Pt(this: Pt, x: number, y: number) { this.x = x; this.y = y }
Pt.prototype.norm = function (this: Pt) { return Math.abs(this.x) + Math.abs(this.y) }
const PtCtor = Pt as unknown as new (x: number, y: number) => Pt
const p = new PtCtor(3, -4)
console.log(show(p), p.x, p.y, send(p, "norm"), p instanceof PtCtor, (p as any).constructor === Pt, "norm" in p, Object.hasOwn(p, "norm"), "scale" in p, p.label, Pt.name, Pt.length)
Pt.prototype.scale = function (this: Pt, k: number) { return new PtCtor(this.x * k, this.y * k) }
const scaled: Pt = send(p, "scale", 2.5)
console.log(show(scaled) + send(scaled, "norm"), "scale" in p, Object.hasOwn(p, "scale"))
p.label = "own"
console.log(show(p), p.label, new PtCtor(0, 0).label, delete p.label, p.label)

// What the function returns: an object replaces the new one, anything else does not.
interface Wrapped { inner: number; via: string }
type WrappedCtor = new (inner: number) => Wrapped
const kept: Wrapped[] = []
function ReturnsObject(this: Wrapped, inner: number) { this.inner = inner; this.via = "this"; kept.push(this); return { via: "returned", inner: inner * 2 } }
function ReturnsNumber(this: Wrapped, inner: number) { this.inner = inner; this.via = "this"; return 5 }
function ReturnsNull(this: Wrapped, inner: number) { this.inner = inner; this.via = "this"; return null }
function ReturnsFunction(this: Wrapped, inner: number) { this.inner = inner; this.via = "this"; return Object.assign(() => inner, { inner: -inner, via: "function" }) }
function ReturnsSometimes(this: Wrapped, inner: number) { this.via = "this"; this.inner = inner; if (inner < 0) return kept[0]; return undefined }
for (const F of [ReturnsObject, ReturnsNumber, ReturnsNull, ReturnsFunction, ReturnsSometimes]) {
  const C = F as unknown as WrappedCtor, made = new C(21), other = new C(-1)
  console.log(F.name, Object.keys(made).join(), made.inner, made.via, made instanceof C, typeof made, other.inner, other.via, other === kept[0], Object.getPrototypeOf(made) === F.prototype)
}
console.log(kept.length, show(kept[0]), kept[0] instanceof (ReturnsObject as any))

// The prototype object is replaced: objects keep the one they were created with.
interface Beast { sound: string }
function Beast(this: Beast, sound: string) { this.sound = sound }
const BeastCtor = Beast as unknown as new (sound: string) => Beast
Beast.prototype.speak = function (this: Beast) { return this.sound + "." }
const early = new BeastCtor("moo")
const firstPrototype: any = Beast.prototype
Beast.prototype = { speak(this: Beast) { return this.sound + "!" } }
const late = new BeastCtor("baa")
console.log(send(early, "speak"), send(late, "speak"), early instanceof BeastCtor, late instanceof BeastCtor, (early as any).constructor === Beast, (late as any).constructor === Object, Object.getPrototypeOf(early) === firstPrototype)
for (const notAnObject of [null, 5, "s", undefined]) {
  Beast.prototype = notAnObject
  const orphan = new BeastCtor("hiss")
  console.log(show(orphan), orphan.sound, Object.getPrototypeOf(orphan) === Object.prototype, "speak" in orphan)
  attempt("speak", () => send(orphan, "speak"))
  attempt("instanceof", () => orphan instanceof BeastCtor)
}
Beast.prototype = firstPrototype
console.log(send(new BeastCtor("moo"), "speak"), early instanceof BeastCtor, late instanceof BeastCtor)

// Another new.target, no `new` at all, another `this`.
function Other() {}
Other.prototype.norm = function () { return -1 }
class Modern { norm() { return 99 } extra = 1 }
const viaOther = Reflect.construct(Pt, [1, 2], Other) as Pt, viaClass = Reflect.construct(Pt, [3, 4], Modern) as Pt, viaItself = Reflect.construct(Pt, [5, 6]) as Pt
console.log(show(viaOther), send(viaOther, "norm"), viaOther instanceof PtCtor, viaOther instanceof (Other as any), show(viaClass), send(viaClass, "norm"), viaClass instanceof Modern, show(viaItself), send(viaItself, "norm"))
attempt("no new", () => (Pt as any)(1, 2))
attempt("not a constructor", () => Reflect.construct(Pt, [1, 2], (() => 0) as any))
attempt("arrow", () => new ((() => 0) as any)())
attempt("method", () => new (({ m() {} }).m as any)())
const target = { y: 0, x: 0, norm() { return 1000 } }
Pt.call(target, 5, 6)
console.log(show(target), target.norm())

// Inheritance by hand.
interface Pt3 extends Pt { z: number }
function Pt3(this: Pt3, x: number, y: number, z: number) { Pt.call(this, x, y); this.z = z }
Pt3.prototype = Object.create(Pt.prototype)
Pt3.prototype.constructor = Pt3
Pt3.prototype.norm = function (this: Pt3) { return Pt.prototype.norm.call(this) + Math.abs(this.z) }
const Pt3Ctor = Pt3 as unknown as new (x: number, y: number, z: number) => Pt3
const deep = new Pt3Ctor(1, -2, 3), flat: Pt = deep
console.log(show(deep), send(deep, "norm"), send(flat, "norm"), deep instanceof PtCtor, deep instanceof Pt3Ctor, p instanceof Pt3Ctor, (deep as any).constructor.name, show(send(flat, "scale", 2)), deep.label)

const From10 = PtCtor.bind(null, 10), bound = new From10(20)
console.log(show(bound), send(bound, "norm"), bound instanceof PtCtor, bound instanceof From10, From10.name, "prototype" in From10)

// Fields that depend on the arguments: the order of the keys is the order of the stores.
interface Opt { a: number; b?: string; c?: number; d: boolean }
function Opt(this: Opt, mode: number) { if (mode & 1) this.b = "b"; this.a = mode; if (mode & 2) this.c = mode / 2; this.d = mode > 1; if (!(mode & 1) && mode & 4) this.b = "late" }
const OptCtor = Opt as unknown as new (mode: number) => Opt
const modes: string[] = []
for (let mode = 0; mode < 8; mode++) { const o = new OptCtor(mode); modes.push(Object.keys(o).join("") + ":" + o.a + o.b + o.c + o.d + ("b" in o) + ("c" in o)) }
console.log(modes.join(" "))
let sum = 0
for (let i = 0; i < 30000; i++) {
  const q: Pt = i % 3 === 0 ? new PtCtor(i, -1) : i % 3 === 1 ? new Pt3Ctor(1, i, 0.5) : new From10(i & 7)
  const o = new OptCtor(i & 7)
  sum += send(q, "norm") + q.x + o.a + (o.c ?? 0) + (o.b ? o.b.length : 0)
}
console.log(sum)
