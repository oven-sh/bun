// Method calls through a class and its subclass: `super.m()`, accessors with `super`, statics, and classes that are declared later.
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
const b = new Base(), d = new Derived(), asBase: Base = d
function all(label: string) { console.log(label, "|", attempt(() => use(b)), "|", attempt(() => use(d)), "|", attempt(() => use(asBase)), "|", attempt(() => use(new Derived())), "|", attempt(() => d.only()), "|", Object.keys(b).join(), Object.keys(d).join()) }
all("start")
const originalWho = Base.prototype.who, originalDerivedWho = Derived.prototype.who
console.log(originalWho.call(b), originalWho.call(d), originalDerivedWho.call(d), originalWho === b.who, originalDerivedWho === d.who, originalWho === d.who)
console.log(Object.hasOwn(b, "who"), JSON.stringify(b), delete (b as any).who, delete (d as any).who, Object.hasOwn(d, "who"), "who" in Derived.prototype, Object.hasOwn(Derived.prototype, "who"), Object.hasOwn(Derived.prototype, "twice"), "who" in d)
all("nothing to delete")

// Accessors.
const sizeOfBase = Object.getOwnPropertyDescriptor(Base.prototype, "size") as PropertyDescriptor
b.size = 50; d.size = 50
all("sizes stored")
console.log(typeof sizeOfBase.get, typeof sizeOfBase.set, sizeOfBase.enumerable, sizeOfBase.get!.call(d), b.n, d.n)

// Statics, and a class that is declared later.
const originalMake = Base.make
console.log(Base.make().who(), Derived.make().who(), Base.make() instanceof Derived, originalMake().who(), Derived.make === originalMake)
class Later extends Derived { override who(): string { return "later[" + super.who() + "]" } }
console.log(use(new Later()), Base.make().who())

// The change happens in the middle of a loop, inside a call the loop makes.
function patch(target: any, key: string, value: unknown) { target[key] = value }
function run(o: Base, change: (i: number) => void): string { const out: string[] = []; for (let i = 0; i < 6; i++) { out.push(o.who()); change(i); out.push(o.who() + o.size) } return out.join() }
console.log(run(b, i => { if (i === 2) patch(b, "n", -1); if (i === 4) patch(b, "size", 30) }))
console.log(run(d, i => { if (i === 4) patch(d, "n", 2.5) }))
console.log(run(new Later(), i => { if (i === 2) patch(d, "n", 7) }))

let chars = 0
for (let i = 0; i < 20000; i++) {
  if (i % 5000 === 2500) b.n = d.n = i
  chars += (i & 1 ? b : i & 2 ? d : asBase).twice().length
}
console.log(chars)
