// Methods that their own classes assign to (this.m = this.m.bind(this); this.next = given ?? super.next): every way to read, call, list, delete, override and copy them.
declare const console: any; declare function structuredClone<T>(v: T): T;
const out = (label: string, f: () => unknown) => { let t: unknown; try { t = f(); } catch (e: any) { t = "THROWS " + e.constructor.name + " " + String(e.message).slice(0, 130); } console.log(label, typeof t === "function" ? "fn " + (t as Function).name : Array.isArray(t) ? t.map(String).join() : String(t)); };
class Bound { n = 1; tag: string; constructor(tag: string) { this.tag = tag; this.who = this.who.bind(this); } who(): string { return "Bound.who " + this.tag + this.n; } other(): string { return "other " + this.who(); } }
class Heir extends Bound { who(): string { return "Heir.who " + this.tag + "/" + super.who(); } }
class Deep extends Heir { extra = 2; who(): string { return "Deep.who " + this.extra + "/" + super.who(); } }
class Late { v = 0; step(): number { return ++this.v; } fast(): number { return this.v += 10; } speedUp(): void { this.step = this.fast; } slowDown(): void { delete (this as any).step; } }
class Chooser { constructor(given?: () => string) { this.next = given ? function (this: Chooser) { return "given " + given(); } : this.next; } next(): string { return "Chooser.next"; } }
class SubChooser extends Chooser { constructor(given?: () => string, own?: boolean) { super(given); if (own) this.next = () => "own arrow " + super.next(); } next(): string { return "SubChooser.next"; } }
class Order { a: number; b: number; constructor() { this.a = 1; this.m = this.m.bind(this); this.b = 2; this.k = this.k.bind(this); } k(): number { return 3; } m(): number { return this.a + this.b; } }
class OnlySome { constructor(assign: boolean) { if (assign) this.m = () => "assigned"; } m(): string { return "method"; } }
class Base2 { m(): string { return "Base2.m"; } call(): string { return this.m(); } }
class Assigns extends Base2 { constructor() { super(); this.m = () => "Assigns arrow"; } }
class Sibling extends Base2 { m(): string { return "Sibling.m"; } }
class Async1 { constructor() { this.load = this.load.bind(this); this.items = this.items.bind(this); } x = 5; async load(): Promise<number> { return this.x; } *items(): Generator<number> { yield this.x; yield this.x + 1; } }
class Static1 { static make(): string { return "static make"; } static swap(): void { Static1.make = () => "swapped"; } }
interface Who { who(): string }
const b = new Bound("b"), h = new Heir("h"), d = new Deep("d");
for (const [name, o] of [["Bound", b], ["Heir", h], ["Deep", d]] as [string, Bound][]) {
  out(name + " call", () => o.who()); out(name + " through another method", () => o.other()); out(name + " taken off", () => { const f = o.who; return f(); }); out(name + " destructured", () => { const { who } = o; return who(); });
  out(name + " by key", () => (o as any)["who"]()); out(name + " by a computed key", () => { const k = "wh" + "o"; return (o as any)[k](); }); out(name + " by an interface", () => { const w: Who = o; return w.who(); });
  out(name + " call on another", () => o.who.call(new Bound("x"))); out(name + " the prototype's on it", () => Bound.prototype.who.call(o)); out(name + " its class's on it", () => (Object.getPrototypeOf(o).who as () => string).call(o));
  out(name + " name", () => o.who.name); out(name + " is the prototype's", () => o.who === Object.getPrototypeOf(o).who); out(name + " own", () => [Object.hasOwn(o, "who"), "who" in o, o.hasOwnProperty("who"), Object.hasOwn(o, "other"), "other" in o]);
  out(name + " keys", () => Object.keys(o)); out(name + " names", () => Object.getOwnPropertyNames(o)); out(name + " for in", () => { const k: string[] = []; for (const n in o) k.push(n); return k; }); out(name + " entries", () => Object.entries(o).map(([k, v]) => k + ":" + typeof v));
  out(name + " descriptor", () => JSON.stringify(Object.getOwnPropertyDescriptor(o, "who"), (k, v) => typeof v === "function" ? "fn" : v)); out(name + " json", () => JSON.stringify(o)); out(name + " spread", () => { const c: any = { ...o }; return Object.keys(c).join() + " " + c.who(); });
  out(name + " assign", () => { const c: any = Object.assign({}, o); return c.who(); }); out(name + " clone", () => structuredClone(o)); out(name + " proxy", () => new Proxy(o, {}).who()); out(name + " heir of it", () => (Object.create(o) as Bound).who());
}
out("deleted", () => { const o = new Heir("del"); const r = [delete (o as any).who, Object.hasOwn(o, "who"), o.who(), o.other(), Object.keys(o).join("+")]; return r; });
out("deleted and assigned again", () => { const o = new Bound("again"); delete (o as any).who; o.who = () => "new"; return [o.who(), Object.keys(o).join("+")]; });
out("undefined stored", () => { const o = new Bound("u"); (o as any).who = undefined; return [Object.hasOwn(o, "who"), typeof o.who, Object.keys(o).join("+")]; }); out("undefined stored, called", () => { const o = new Bound("u"); (o as any).who = undefined; return o.who(); }); out("undefined stored, called inside", () => { const o = new Bound("u"); (o as any).who = undefined; return o.other(); });
out("frozen", () => { const o = Object.freeze(new Bound("f")); return [o.who(), Object.isFrozen(o)]; }); out("frozen, stored", () => { const o = Object.freeze(new Bound("f")); (o as any).who = () => "no"; return o.who(); });
out("bare heir of the prototype", () => (Object.create(Bound.prototype) as Bound).who()); out("bare heir, stored", () => { const o = Object.create(Bound.prototype) as Bound; o.who = () => "stored on bare"; return [o.who(), Object.keys(o)]; });
out("late", () => { const l = new Late(); const r: unknown[] = [l.step(), l.step(), Object.keys(l).join("+")]; l.speedUp(); r.push(l.step(), Object.keys(l).join("+"), l.step === l.fast, l.step === Late.prototype.fast); l.slowDown(); r.push(l.step(), Object.keys(l).join("+")); return r; });
out("two of them", () => { const x = new Late(), y = new Late(); x.speedUp(); return [x.step(), y.step(), x.step(), y.step()]; });
out("chooser", () => [new Chooser().next(), new Chooser(() => "g").next(), Object.keys(new Chooser()).join("+"), Object.hasOwn(new Chooser(), "next"), new Chooser().next === Chooser.prototype.next]);
out("sub chooser", () => [new SubChooser().next(), new SubChooser(() => "g").next(), new SubChooser(undefined, true).next(), new SubChooser(() => "g", true).next(), new SubChooser().next === SubChooser.prototype.next]);
out("order of keys", () => Object.keys(new Order())); out("order, called", () => { const o = new Order(); return [o.m(), o.k(), JSON.stringify(o)]; });
out("only some", () => [new OnlySome(true).m(), new OnlySome(false).m(), Object.keys(new OnlySome(true)), Object.keys(new OnlySome(false)).length]); out("only some, in a list", () => [true, false, true, false].map(a => new OnlySome(a)).map(o => o.m()));
out("assigned below", () => [new Base2().call(), new Assigns().call(), new Sibling().call(), new Assigns().m(), Object.keys(new Base2()).length, Object.keys(new Assigns())]); out("assigned below, as the base", () => ([new Base2(), new Assigns(), new Sibling()] as Base2[]).map(o => o.m() + "|" + o.call()));
out("reflect", () => [Reflect.get(b, "who")(), Reflect.has(b, "who"), Reflect.ownKeys(b), Reflect.set(new Bound("r"), "who", () => "set"), Reflect.deleteProperty(new Bound("r"), "who")]);
out("define", () => { const o = new Bound("def"); Object.defineProperty(o, "who", { get() { return () => "from a getter"; }, configurable: true }); return [o.who(), o.other(), Object.keys(o)]; });
out("hidden", () => { const o = new Bound("hid"); Object.defineProperty(o, "who", { enumerable: false }); return [o.who(), Object.keys(o)]; });
out("another prototype", () => { const o = new Late(); Object.setPrototypeOf(o, { step() { return "foreign"; } }); return (o as any).step(); });
out("static", () => { const r = [Static1.make()]; Static1.swap(); r.push(Static1.make(), String(Object.hasOwn(Static1, "make"))); return r; });
const a1 = new Async1(); const { load, items } = a1; load().then(v => { console.log("async taken off", v, [...items()].join(), Object.keys(a1).join()); });
let total = 0; for (let i = 0; i < 2000; i++) { const o = i % 3 ? new Bound("l" + (i % 7)) : new Heir("m"); total += o.who().length + o.other().length; if (i % 5 === 0) { delete (o as any).who; total += o.who().length; } } console.log("many", total);
