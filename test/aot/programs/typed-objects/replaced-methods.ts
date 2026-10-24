// Methods, accessors and statics that the program replaces, redefines or deletes, on the prototype, on an instance, by `Reflect`, or from inside the method itself.
class Base {
  n = 1
  who(): string { return "base" + this.n }
  twice(): string { return this.who() + this.who() }
  get size(): number { return this.n * 10 }
  set size(v: number) { this.n = v / 10 }
  static make(): Base { return new Base() }
}
class Derived extends Base {
  override who(): string { return "derived(" + super.who() + ")" }
  only(): string { return "only" + this.n }
  override get size(): number { return super.size + 1 }
  override set size(v: number) { super.size = v * 2 }
}
function use(o: Base): string { return o.who() + " " + o.twice() + " " + o.size }
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
const b = new Base(), d = new Derived()
function all(label: string) { console.log(label, "|", attempt(() => use(b)), "|", attempt(() => use(d)), "|", attempt(() => use(new Derived())), "|", attempt(() => d.only()), "|", Object.keys(b).join(), Object.keys(d).join()) }
function patch(target: any, key: string, value: unknown) { target[key] = value }
all("start")
Base.prototype.who = function (this: Base) { return "patched" + this.n }
all("a method replaced")
Derived.prototype.who = function (this: Derived) { return "again" + this.n }
all("in the extending class")
patch(Base.prototype, ["t", "wice"].join(""), function (this: Base) { return "<" + this.who() + ">" })
all("by a name that is computed")
console.log(delete (Derived.prototype as any).who, Object.hasOwn(Derived.prototype, "who"), "who" in d)
all("deleted in the extending class")
console.log(Reflect.set(Base.prototype, "who", function (this: Base) { return "r" + this.n }), Reflect.defineProperty(Base.prototype, "who", { value(this: Base) { return "rd" + this.n }, writable: true, configurable: true }))
all("by Reflect")
console.log(attempt(() => { Object.defineProperty(Derived.prototype, "only", { value(this: Derived) { return "defined" + this.n }, writable: false, configurable: true }) }))
all("a method redefined")
console.log(attempt(() => { Object.defineProperty(Base.prototype, "size", { get(this: Base) { return -this.n }, configurable: true }) }), attempt(() => { b.size = 3 }))
all("a getter redefined")
console.log(attempt(() => { Object.defineProperty(Base.prototype, "size", { value: 7, writable: true, configurable: true }) }))
all("an accessor made a value")
b.who = () => "own"
d.who = function (this: Derived) { return "own" + this.n }
d.twice = () => "own twice"
all("own properties")
patch(d, "who", () => "mine")
console.log(attempt(() => { Object.defineProperty(b, "who", { value: () => "own defined", writable: true, enumerable: false, configurable: true }) }), attempt(() => { Object.defineProperty(b, "size", { value: 8, writable: true, enumerable: true, configurable: true }) }))
all("own properties, computed and defined")
console.log(delete (b as any).who, delete (d as any).who, delete (d as any).twice, delete (b as any).size)
all("own properties deleted")
Base.make = () => new Derived()
console.log(Base.make().who(), Derived.make().who(), Base.make() instanceof Derived)
const who = Object.getOwnPropertyDescriptor(Base.prototype, "who")!
console.log(who.writable, who.enumerable, who.configurable)
// A method that replaces itself: on the object, and on the prototype.
class Lazy {
  computed = 0
  value(): number { const v = ++this.computed * 100; this.value = () => v; return v }
  shared(): string { Lazy.prototype.shared = function (this: Lazy) { return "fast" + this.computed }; return "slow" + this.computed }
}
const lazy = new Lazy()
console.log(lazy.value(), lazy.value(), new Lazy().value(), lazy.shared(), lazy.shared(), new Lazy().shared(), lazy.computed, Object.keys(lazy).join())
