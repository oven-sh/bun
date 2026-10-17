// The prototypes of records, instances and classes are changed, and methods are replaced, added and shadowed.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0] : String(e))) } }
function hide(v: unknown): any { return v }
function parse(t: string): any { return JSON.parse(t) }
type Item = { id: number; n: number };
class Animal { name = "a"; speak(): string { return this.name + "!" } }
class Dog extends Animal { speak(): string { return super.speak() + "?" } }
row("setPrototypeOf on a record", () => { const t: Item = { id: 1, n: 1 }; Object.setPrototypeOf(t, { extra: 7 }); return hide(t).extra + " " + t.n + " " + Object.keys(t).join() });
row("__proto__ stored through any", () => { const t: Item = { id: 1, n: 1 }; hide(t).__proto__ = { extra: 7 }; return hide(t).extra + " " + t.n });
row("setPrototypeOf(record, null)", () => { const t: Item = { id: 1, n: 1 }; Object.setPrototypeOf(t, null); return t.n + " " + (Object.getPrototypeOf(t) === null) + " " + ("toString" in t) });
row("setPrototypeOf on an instance", () => { const d = new Dog(); Object.setPrototypeOf(d, Animal.prototype); return d.speak() + " " + (d instanceof Dog) });
row("a method replaced on the prototype", () => { const d = new Dog(); hide(Dog.prototype).speak = function () { return "replaced" }; return d.speak() + " " + new Dog().speak() });
row("a method added to the prototype", () => { hide(Animal.prototype).run = function (this: Animal) { return this.name + " runs" }; return hide(new Dog()).run() });
row("a method shadowed on the instance", () => { const a = new Animal(); hide(a).speak = () => "own"; return a.speak() });
row("the prototype of the class's prototype changed", () => { class Base { hi(): string { return "base" } } class Other { hi(): string { return "other" } } class Kid extends Base { } Object.setPrototypeOf(Kid.prototype, Other.prototype); return new Kid().hi() + " " + (new Kid() instanceof Base) });
