// A class stores to one of its own methods, `this.name = ..`: the object has the property as its own from then on, and any other object of the class finds the method.
function said(f: () => unknown): string { try { return String(f()); } catch (e) { return "threw " + (e as Error).name; } }
function row(label: string, f: () => unknown) { console.log(label + ": " + said(f)); }
const keys = (o: object) => Object.keys(o).join();

class Base<T> {
  total = 0;
  next(value: T): void { this._next(value); }
  protected _next(value: T): void { this.total++; }
  seen(): string { return keys(this) + "|" + Object.prototype.hasOwnProperty.call(this, "_next") + "|" + ("_next" in this); }
}
class Derived<T> extends Base<T> {
  last = "none";
  constructor(onNext?: (value: T) => void) {
    super();
    this._next = onNext ? function (this: Derived<T>, value: T) { onNext(value); this.total += 2; } : super._next;
  }
}
class Plain<T> extends Base<T> {
  more = 1;
}
class Overriding<T> extends Base<T> {
  protected _next(value: T): void { this.total += 10; }
}
class Late<T> extends Base<T> {
  swap(): void { this._next = () => { this.total += 100; }; }
}

let sink = 0;
const derived = new Derived<number>(value => { sink += value; });
const inherits = new Derived<number>();
const plain = new Plain<number>();
const base = new Base<number>();
const overriding = new Overriding<number>();
const late = new Late<number>();
for (const one of [derived, inherits, plain, base, overriding, late] as Base<number>[]) { one.next(5); one.next(6); }
row("totals", () => [derived.total, inherits.total, plain.total, base.total, overriding.total, late.total, sink].join());
row("an object that stored a function", () => derived.seen());
row("an object that stored the method it inherits", () => inherits.seen());
row("an object of a class that stores nothing", () => plain.seen());
row("an object of the class that declares the method", () => base.seen());
row("an object of a class that overrides it", () => overriding.seen());
row("before the store", () => late.seen());
late.swap();
late.next(1);
row("after the store", () => late.seen() + "|" + late.total);
row("JSON", () => JSON.stringify([derived, inherits, plain, late]));
row("entries", () => Object.entries(derived).map(([key, value]) => key + ":" + typeof value).join());
row("spread", () => keys({ ...derived }) + "|" + keys({ ...plain }));
row("for in", () => { const found: string[] = []; for (const key in late) found.push(key); return found.join(); });
row("own names", () => Object.getOwnPropertyNames(inherits).join() + "|" + Object.getOwnPropertyNames(base).join());
row("the descriptor", () => JSON.stringify(Object.getOwnPropertyDescriptor(derived, "_next")) + "|" + Object.getOwnPropertyDescriptor(plain, "_next"));
row("the prototype keeps the method", () => Object.getOwnPropertyNames(Base.prototype).join() + "|" + ((inherits as any)._next === (Base.prototype as any)._next) + "|" + ((derived as any)._next === (Base.prototype as any)._next));
row("the method of the class, read from an object that has none of its own", () => ((plain as any)._next === (Base.prototype as any)._next) + "|" + ((overriding as any)._next === (Overriding.prototype as any)._next));
row("deleted", () => { delete (late as any)._next; late.next(1); return late.seen() + "|" + late.total; });
row("stored again", () => { late.swap(); late.next(1); return late.seen() + "|" + late.total; });
row("stored by untyped code", () => { (plain as any)._next = function (this: any) { this.total += 1000; }; plain.next(1); return plain.seen() + "|" + plain.total; });
row("stored by a computed key", () => { const key: string = ["_", "next"].join(""); (base as any)[key] = function (this: any) { this.total += 7; }; base.next(1); return base.seen() + "|" + base.total; });
row("frozen", () => { const frozen = Object.freeze(new Late<number>()); return said(() => frozen.swap()) + "|" + frozen.seen(); });

class Counter {
  total = 0;
  constructor() {
    this.add = this.add.bind(this);
  }
  add(value: number): void { this.total += value; }
}
class Unbound {
  total = 0;
  add(value: number): void { this.total += value; }
}
const counter = new Counter();
const add = counter.add;
add(2);
counter.add(3);
row("bound to its object", () => counter.total + "|" + keys(counter) + "|" + (counter.add === Counter.prototype.add) + "|" + counter.add.name + "|" + counter.add.length);
row("taken off an object that binds nothing", () => { const unbound = new Unbound(); const taken = unbound.add; return said(() => taken(1)) + "|" + (taken === Unbound.prototype.add) + "|" + keys(unbound); });

interface Sink { push(value: number): void; }
class Collector implements Sink {
  held: number[] = [];
  constructor(doubles: boolean) {
    if (doubles) this.push = value => { this.held.push(value * 2); };
  }
  push(value: number): void { this.held.push(value); }
}
const literal = { held: [] as number[], push(value: number) { this.held.push(-value); } };
const sinks: Sink[] = [new Collector(false), new Collector(true), literal];
for (const one of sinks) one.push(4);
row("through an interface", () => sinks.map(one => (one as Collector).held.join() + ":" + keys(one)).join("|"));
row("an optional call", () => { const maybe: Collector | undefined = sinks[1] as Collector; maybe?.push?.(1); return maybe.held.join(); });
row("read as a value and called", () => { const first = sinks[0] as Collector; const push = first.push; push.call(first, 9); return first.held.join(); });

class Patched {
  value(): number { return 1; }
  own(): void { this.value = () => 2; }
}
const patched = new Patched();
const other = new Patched();
other.value = () => 3;
row("a store through a variable besides", () => [patched.value(), other.value()].join());
patched.own();
row("and through this", () => [patched.value(), other.value(), new Patched().value(), keys(patched), keys(other)].join());

class Shared {
  static make(): string { return "static"; }
  make(): string { return "method"; }
  remake(): void { this.make = () => "own"; }
}
const shared = new Shared();
shared.remake();
row("a static method of the same name", () => [Shared.make(), shared.make(), new Shared().make()].join());
