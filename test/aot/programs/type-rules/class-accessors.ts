// Classes with accessors that the program redefines or deletes, on instances and on the prototype.
interface Sized { size: number }
const seen: string[] = []
function flush(): string { return seen.splice(0).join(",") }
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
class Bag implements Sized {
  items: number[] = []
  get size(): number { seen.push("get"); return this.items.length }
  set size(n: number) { seen.push("set" + n); this.items.length = n }
}
class Half extends Bag { override get size(): number { return super.size + 100 } }
class Both extends Bag {
  override get size(): number { return super.size * 2 }
  override set size(n: number) { super.size = n + 1 }
}
function grow(s: Sized): number { s.size += 2; return s.size }
const shadowed = new Bag()
try { Object.defineProperty(shadowed, "size", { value: 7, writable: true, enumerable: true, configurable: true }); console.log("own data property in front of the accessor: no error") } catch (e) { console.log("own data property in front of the accessor:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(grow(shadowed), flush(), Object.keys(shadowed).join(), shadowed.items.length)
// A getter that turns itself into a data property.
class LazyBox {
  get value(): number { seen.push("compute"); Object.defineProperty(this, "value", { value: 5, enumerable: true }); return 5 }
}
const lazy = new LazyBox()
try { lazy.value; console.log("getter that turns itself into a data property: no error") } catch (e) { console.log("getter that turns itself into a data property:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(flush(), Object.keys(lazy).length, Object.hasOwn(lazy, "value"))
// The accessor of the class is replaced, made a data property, deleted.
const before = new Bag()
try { Object.defineProperty(Bag.prototype, "size", { get() { seen.push("patched"); return -1 }, configurable: true }); console.log("accessor replaced on the prototype: no error") } catch (e) { console.log("accessor replaced on the prototype:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(before.size, new Bag().size, attempt(() => grow(before)), new Half().size, new Both().size, flush())
try { Object.defineProperty(Bag.prototype, "size", { value: 12, writable: true, configurable: true }); console.log("accessor made a data property on the prototype: no error") } catch (e) { console.log("accessor made a data property on the prototype:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(before.size, grow(before), Object.keys(before).join(), new Bag().size, new Half().size, flush())
try { delete (Half.prototype as any).size; console.log("accessor deleted from the prototype: no error") } catch (e) { console.log("accessor deleted from the prototype:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(new Half().size, attempt(() => grow(new Half())), attempt(() => grow(new Both())), flush())
// A subclass overrides only the setter: the property it defines has no getter, so a read gives `undefined`, which passes every written type. TypeScript gives the read the type `number`.
class Cup { n = 1; get size(): number { return this.n } set size(v: number) { this.n = v } }
class SetterOnly extends Cup { override set size(v: number) { super.size = v + 1 } }
function sizeOf(c: Cup): number { return c.size }
try { console.log(sizeOf(new SetterOnly())); console.log("read of an accessor whose getter was overridden away: no error") } catch (e) { console.log("read of an accessor whose getter was overridden away:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(sizeOf(new Cup()))
