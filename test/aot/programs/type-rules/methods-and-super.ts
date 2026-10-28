// Methods of a class that are replaced in ways the compiler cannot see.
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
}
function use(o: Base): string { return o.who() + " " + o.twice() + " " + o.size }
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ": no error", String(f())) } catch (e) { console.log(label + ":", e instanceof TypeError ? "TypeError" : "other " + e) }
}
const b = new Base(), d = new Derived()
function all(label: string) { console.log(label, "|", use(b), "|", use(d), "|", use(new Derived()), "|", d.only(), "|", Object.keys(b).join(), Object.keys(d).join()) }
function patch(target: any, key: string, value: unknown) { target[key] = value }
function drop(target: any, key: string) { return delete target[key] }
function define(target: any, key: string, descriptor: PropertyDescriptor) { Object.defineProperty(target, key, descriptor) }
const name = (...parts: string[]) => parts.join("")
try { all("start") } catch (e) { console.log("line 26:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { attempt("a method replaced", () => patch(Base.prototype, name("w", "ho"), function (this: Base) { return "patched" + this.n })) } catch (e) { console.log("line 27:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { attempt("a method replaced in the extending class", () => patch(Derived.prototype, name("w", "ho"), function (this: Derived) { return "patched" + this.n })) } catch (e) { console.log("line 28:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { attempt("a method deleted", () => drop(Derived.prototype, name("w", "ho"))) } catch (e) { console.log("line 29:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { attempt("a method redefined", () => define(Derived.prototype, name("on", "ly"), { value(this: Derived) { return "defined" + this.n }, writable: false, configurable: true })) } catch (e) { console.log("line 30:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { attempt("a getter redefined", () => define(Base.prototype, name("si", "ze"), { get(this: Base) { return -this.n }, configurable: true })) } catch (e) { console.log("line 31:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { attempt("an accessor made a value", () => define(Base.prototype, name("si", "ze"), { value: 7, writable: true, configurable: true })) } catch (e) { console.log("line 32:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { attempt("a property added", () => { (Base.prototype as any).more = 1 }) } catch (e) { console.log("line 33:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { attempt("a method of the base class given to the prototype of the extending class", () => patch(Derived.prototype, name("tw", "ice"), () => "added")) } catch (e) { console.log("line 34:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { attempt("another prototype for the prototype", () => { Object.setPrototypeOf(Derived.prototype, {}) }) } catch (e) { console.log("line 35:", e instanceof TypeError ? "TypeError" : "other " + e) }
const key = name("w", "ho")
try { console.log("by Reflect:", Reflect.set(Base.prototype, key, () => "r"), Reflect.deleteProperty(Base.prototype, key), Reflect.defineProperty(Base.prototype, key, { value: () => "r" }), Reflect.setPrototypeOf(Derived.prototype, {})) } catch (e) { console.log("line 37:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { all("the prototypes") } catch (e) { console.log("line 38:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { attempt("an own property by the name of a method", () => patch(b, name("w", "ho"), () => "own")) } catch (e) { console.log("line 39:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { attempt("the same for a method that is inherited", () => patch(d, name("tw", "ice"), () => "own")) } catch (e) { console.log("line 40:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { attempt("the same by defineProperty", () => define(b, name("w", "ho"), { value: () => "own", writable: true, enumerable: true, configurable: true })) } catch (e) { console.log("line 41:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { attempt("an own property by the name of an accessor", () => define(b, name("si", "ze"), { value: 8, writable: true, enumerable: true, configurable: true })) } catch (e) { console.log("line 42:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { all("the objects") } catch (e) { console.log("line 43:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { attempt("a static method replaced", () => patch(Base, name("ma", "ke"), () => new Derived())) } catch (e) { console.log("line 44:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(Base.make().who(), Derived.make().who(), Base.make() instanceof Derived) } catch (e) { console.log("line 45:", e instanceof TypeError ? "TypeError" : "other " + e) }
// The descriptors of the members, and whether the prototype object is extensible, are plain JavaScript's.
const who = Object.getOwnPropertyDescriptor(Base.prototype, "who")!, size = Object.getOwnPropertyDescriptor(Base.prototype, "size")!
try { console.log(who.writable, who.enumerable, who.configurable, size.enumerable, size.configurable, Object.isExtensible(Base.prototype)) } catch (e) { console.log("line 48:", e instanceof TypeError ? "TypeError" : "other " + e) }
// A member that typed code replaces, without `any`. The subclass, which does not declare it, gets its own, and
// once deleted the member can be stored again.
class Seen { m(): string { return "m" } }
class Below extends Seen {}
try { Seen.prototype.m = () => "replaced" } catch (e) { console.log("line 53:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { attempt("given to the prototype of the extending class", () => { Below.prototype.m = () => "below" }) } catch (e) { console.log("line 54:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(new Seen().m(), new Below().m(), delete (Seen.prototype as any).m, "m" in Seen.prototype) } catch (e) { console.log("line 55:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { attempt("stored again after it was deleted", () => { Seen.prototype.m = () => "again" }) } catch (e) { console.log("line 56:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log("m" in Seen.prototype, Object.isExtensible(Seen.prototype)) } catch (e) { console.log("line 57:", e instanceof TypeError ? "TypeError" : "other " + e) }
