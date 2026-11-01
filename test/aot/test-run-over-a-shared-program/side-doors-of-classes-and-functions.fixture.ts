import { expect } from "bun:test";
import { test } from "../harness/declare";
import { inspect } from "node:util";
import * as t from "./theirs";

// Mine: the same kinds of things, in the program of this test file.
class Mine { static count = 0; static label = "mine"; n: number; constructor(n = 1) { this.n = n; Mine.count++; } m() { return this.n + 2; } get value() { return this.n * 100; } toString() { return `Mine(${this.n})`; } static make(n: number) { return new this(n); } }
class Mine2 { a = 1; static s = "s"; m2() { return "mine2"; } }
class Mine3 { b = 2; m3() { return "mine3"; } get g3() { return "g3"; } }
class Mine4 { c = 3; static f4 = 4; m4() { return "m4"; } }
function MyCtor(this: any, a: number) { this.a = a; }
MyCtor.prototype.triple = function () { return this.a * 3; };
function MyCtor2(this: any) { this.q = 1; }
function mine(a: number, b: number, c: number) { return a + b + c; }
function mine2() { return "mine2"; }
function mine3() { return "mine3"; }
const myArrow = (a: number) => a * 3;
function* myCount(n: number): Generator<number, string, any> { let sent; for (let i = 0; i < n; i++) sent = yield i + (sent ?? 0); return "mine done"; }

test("a01 names of their class that nothing has touched", () => { expect(Object.getOwnPropertyNames(t.Lazy2.prototype)).toEqual(["constructor", "m2"]); expect(Reflect.ownKeys(t.Lazy2)).toEqual(["length", "name", "prototype", "sm", "s"]); });
test("a02 names of my class, listed by them", () => { expect(t.names(Mine2.prototype)).toEqual(["constructor", "m2"]); expect(t.keys(Mine2)).toEqual(["length", "name", "prototype", "s"]); });
test("a03 descriptors of their prototype", () => { const d = Object.getOwnPropertyDescriptors(t.Lazy3.prototype); expect(Object.keys(d)).toEqual(["constructor", "m3", "g3"]); expect(d.g3.get!.call(null)).toBe("g3"); expect(d.m3.value()).toBe("m3"); expect(d.constructor.value).toBe(t.Lazy3); });
test("a04 descriptors of my prototype, by them", () => { expect(t.descriptor(Mine3.prototype, "g3").get.call(null)).toBe("g3"); expect(t.descriptor(Mine3.prototype, "m3").value()).toBe("mine3"); expect(t.descriptor(Mine3, "prototype").writable).toBe(false); });
test("a05 captureStackTrace on a class object", () => { expect(typeof (Error.captureStackTrace(t.Lazy4), (t.Lazy4 as any).stack)).toBe("string"); expect(t.Lazy4.f4).toBe(4); expect(new t.Lazy4().m4()).toBe("m4"); expect(t.capture(Mine4)).toBe("string"); expect(Mine4.f4).toBe(4); });
test("a06 an object created from their prototype", () => { const o = Object.create(t.Lazy5.prototype); expect(o.m5()).toBe("m5"); expect(o instanceof t.Lazy5).toBe(true); expect(inspect(o)).toBe("Lazy5 {}"); const p = t.create(Mine.prototype); expect(p.m()).toBeNaN(); expect(t.isInstance(p, Mine)).toBe(true); });
test("a07 their prototype becomes the prototype of mine", () => { const o: any = { own: 1 }; Object.setPrototypeOf(o, t.Lazy6.prototype); expect(o.m6()).toBe("m6"); const q: any = t.setProto({ own: 2 }, Mine2.prototype); expect(q.m2()).toBe("mine2"); });
test("a08 the parent of a class object changes", () => { class A { static up() { return "A.up"; } } Object.setPrototypeOf(t.Lazy7, A); expect((t.Lazy7 as any).up()).toBe("A.up"); expect(t.Lazy7.t).toBe(7); Object.setPrototypeOf(t.Lazy7, Function.prototype); expect((t.Lazy7 as any).up).toBeUndefined(); });
test("a09 name, length, text", () => { expect([t.Lazy8.name, t.Lazy8.length, t.plain2.length, t.plain2.name, t.arrow2.name, t.holder.method.name, t.holder.fn.name, (t.holder as any).computed.name]).toEqual(["Lazy8", 0, 1, "plain2", "arrow2", "method", "named", "computed"]); expect(t.source(mine2)).toContain("mine2"); expect(Function.prototype.toString.call(t.plain3)).toContain("p3"); expect(String(t.Lazy8)).toContain("class Lazy8"); });
test("a10 construct theirs with mine as new.target and the other way", () => {
  const a = Reflect.construct(t.Lazy, [5], Mine); expect(Object.getPrototypeOf(a)).toBe(Mine.prototype); expect(a.n).toBe(5); expect(a.m()).toBe(7);
  const b = Reflect.construct(Mine, [6], t.Lazy); expect(Object.getPrototypeOf(b)).toBe(t.Lazy.prototype); expect(b.m()).toBe(7);
  const c = t.reflectConstruct(Mine, [7], t.Lazy); expect(c.value).toBe(70); const d = t.reflectConstruct(t.Lazy, [8], Mine); expect(d.value).toBe(800);
  expect(Reflect.construct(t.Target, [], Mine).seen).toBe(Mine); expect(t.reflectConstruct(t.Target, [], MyCtor).seen).toBe(MyCtor);
});
test("a11 constructor functions, first built from the other side", () => {
  const a = new (t.Ctor as any)(4); expect(a.double()).toBe(8); expect(a instanceof t.Ctor).toBe(true); const b = t.construct(MyCtor, 4); expect(b.triple()).toBe(12); expect(t.isInstance(b, MyCtor)).toBe(true);
  const c = Reflect.construct(t.Ctor2, [1], MyCtor); expect([c.a, c.b, c.triple()]).toEqual([1, 2, 3]); const d = Reflect.construct(MyCtor, [2], t.Ctor); expect([d.a, d.double()]).toEqual([2, 4]);
  expect(new (t.Ctor5 as any)().x).toBe("Ctor5"); expect(Reflect.construct(t.Ctor5, [], MyCtor2).x).toBe("MyCtor2"); expect(Reflect.construct(t.Ctor5, [], Mine).x).toBe("Mine");
});
test("a12 the prototype property of their constructor function is replaced", () => {
  const before = new (t.Ctor3 as any)(); (t.Ctor3 as any).prototype = { fresh() { return "fresh"; } }; const after = new (t.Ctor3 as any)(); expect(after.fresh()).toBe("fresh"); expect(before.fresh).toBeUndefined(); expect(before instanceof t.Ctor3).toBe(false); expect(t.isInstance(after, t.Ctor3)).toBe(true);
  t.set(MyCtor2, "prototype", { fresh2() { return "f2"; } }); expect(new (MyCtor2 as any)().fresh2()).toBe("f2"); expect(t.construct(MyCtor2).fresh2()).toBe("f2");
  Object.defineProperty(t.Ctor4, "prototype", { value: { d() { return "d"; } } }); expect(new (t.Ctor4 as any)().d()).toBe("d");
});
test("a13 members are added to, replaced on and deleted from their prototype", () => {
  const o = new t.Lazy(1); (t.Lazy.prototype as any).extra = function () { return this.n + 50; }; expect((o as any).extra()).toBe(51); const m = t.Lazy.prototype.m; t.Lazy.prototype.m = function () { return -1; }; expect(o.m()).toBe(-1); expect(t.callMethod(o, "m")).toBe(-1); expect(new t.Child(1).m()).toBe(-2);
  t.Lazy.prototype.m = m; expect(o.m()).toBe(2); delete (t.Lazy.prototype as any).extra; expect((o as any).extra).toBeUndefined();
  const mineM = Mine.prototype.m; t.set(Mine.prototype, "m", function () { return -5; }); expect(new Mine(1).m()).toBe(-5); t.remove(Mine.prototype, "m"); expect((new Mine(1) as any).m).toBeUndefined(); t.define(Mine.prototype, "m", { value: mineM, writable: true, configurable: true }); expect(new Mine(1).m()).toBe(3);
});
test("a14 static fields", () => {
  const was = t.Lazy.count; t.Lazy.count++; expect(t.Lazy.count).toBe(was + 1); new t.Lazy(); expect(t.Lazy.count).toBe(was + 2); expect(t.Lazy.twice).toBe((was + 2) * 2); expect(Object.keys(t.Lazy)).toEqual(["count", "label"]);
  Object.defineProperty(t.Lazy, "label", { get() { return "got"; }, configurable: true }); expect(t.Lazy.label).toBe("got"); expect(t.get(t.Lazy, "label")).toBe("got"); expect(delete (t.Lazy as any).label).toBe(true); expect(t.Lazy.label).toBeUndefined();
  expect(t.set(Mine, "count", 41)).toBe(41); new Mine(); expect(Mine.count).toBe(42); t.define(Mine, "label", { value: "defined" }); expect(Mine.label).toBe("defined"); expect(t.keys(Mine)).toContain("count");
});
test("a15 functions get properties from the other side", () => {
  (t.plain4 as any).extra = 1; expect(Object.keys(t.plain4)).toEqual(["extra"]); expect(t.plain4()).toBe("p4"); Object.defineProperty(t.plain5, "name", { value: "renamed" }); expect(t.plain5.name).toBe("renamed"); expect(delete (t.arrow3 as any).name).toBe(true); expect(t.arrow3.name).toBe(""); expect(t.arrow3()).toBe("a3");
  t.set(mine3, "extra", 2); expect((mine3 as any).extra).toBe(2); t.define(mine3, "name", { value: "theirName" }); expect(mine3.name).toBe("theirName"); expect(t.names(myArrow)).toEqual(["length", "name"]); expect(t.names(mine)).toEqual(["length", "name", "prototype"]); expect(t.get(mine, "prototype").constructor).toBe(mine);
  (t.plain3 as any).displayName = "shown"; expect((t.plain3 as any).displayName).toBe("shown");
});
test("a16 bound functions", () => {
  const b = t.plain.bind(null, 1); expect(b(2)).toBe(3); expect(b.name).toBe("bound plain"); expect(b.length).toBe(1); const B = (t.Lazy as any).bind(null, 9); const o = new B(); expect(o.n).toBe(9); expect(o instanceof B).toBe(true); expect(t.isInstance(o, B)).toBe(true); expect(o instanceof t.Lazy).toBe(true);
  const c = t.apply(Function.prototype.bind, mine, [null, 1, 2]); expect(c(3)).toBe(6); const C = t.apply(Function.prototype.bind, Mine, [null, 3]); expect(t.construct(C).n).toBe(3); expect(new C() instanceof Mine).toBe(true); expect(Reflect.construct(B, [], Mine).m()).toBe(11);
  expect(t.plain6.call(7 as any)).toBe(7); expect(t.apply(function (this: any) { return this; }, "s", [])).toBe("s");
});
test("a17 three classes, mine over theirs over mine", () => {
  const M = t.mixin(Mine); class Top extends M { m() { return super.m() + 1000; } } const o = new Top(1); expect(o.m()).toBe(1103); expect(o.mixed()).toBe("mixed"); expect(o.value).toBe(100); expect(`${o}`).toBe("Mine(1)"); expect(Top.make(2)).toBeInstanceOf(Top); expect(Object.getPrototypeOf(Top)).toBe(M);
  const S = t.subclass(t.mixin(t.Child)); const s = new S(1); expect([s.m(), s.sub(), s.mixed(), s.value]).toEqual([104, "sub", "mixed", 11]); expect(S.make(1).n).toBe(2);
  class Kid extends t.Child { m() { return super.m() + 1; } static make(n: number) { return super.make(n * 10); } get value() { return super.value + 1; } } expect([new Kid(1).m(), Kid.make(1).n, new Kid(1).value, Kid.make(1) instanceof Kid]).toEqual([5, 11, 12, true]);
});
test("a18 the class above changes under a super call", () => { class A { m() { return "A"; } } class K extends t.Lazy6 { m6() { return "K" + super.m6(); } } expect(new K().m6()).toBe("Km6"); Object.setPrototypeOf(K.prototype, { m6() { return "other"; } }); expect(new K().m6()).toBe("Kother"); const S = t.subclass(A); Object.setPrototypeOf(S.prototype, t.Lazy8.prototype); expect((new S() as any).m8()).toBe("m8"); });
test("a19 generators go on from either side", () => { const g = t.count(4); expect(g.next().value).toBe(0); expect(t.resume(g, 10).value).toBe(11); expect(g.next(20).value).toBe(22); expect(t.spreadAll(g)).toEqual([3]); expect(g.next()).toEqual({ value: undefined, done: true });
  const h = myCount(4); expect(t.resume(h).value).toBe(0); expect(h.next(10).value).toBe(11); expect(t.resume(h, 20).value).toBe(22); expect(h.return("r")).toEqual({ value: "r", done: true }); expect(t.first(myCount(2))).toBe(0); expect(() => t.callMethod(myCount(1), "throw", new Error("in"))).toThrow("in"); expect(() => t.count(1).throw(new t.Err("out"))).toThrow("out"); });
test("a20 thenables and async", async () => { class Then { then(ok: any) { ok("mine then"); } } expect(await t.awaitIt(new Then())).toBe("mine then"); expect(await t.later({ then(ok: any) { ok(t.later(5)); } })).toBe(5); expect(await t.forAwait((async function* () { yield 1; yield* t.countLater(2); })())).toEqual([1, 0, 1]); const all = []; for await (const v of t.countLater(3)) all.push(v); expect(all).toEqual([0, 1, 2]); expect(await Promise.all([t.later(1), (async () => 2)(), t.awaitIt(t.later(3))])).toEqual([1, 2, 3]); await expect(t.awaitIt({ then(_: any, no: any) { no(new t.Err("no")); } })).rejects.toThrow("no"); });
test("a21 conversions call methods of the other side", () => { expect(t.text(new Mine(2))).toBe("Mine(2)"); expect(`${new t.Lazy(3)}`).toBe("Lazy(3)"); expect(t.number({ valueOf: () => 4 })).toBe(4); expect(t.number({ [Symbol.toPrimitive]: (h: string) => (h === "number" ? 5 : 0) })).toBe(5); expect(t.json({ toJSON: () => ({ j: 1 }) })).toBe('{"j":1}'); expect(t.json(new (class { x = 1; toJSON() { return [this.x]; } })())).toBe("[1]"); expect(JSON.stringify(new t.Lazy(1))).toBe('{"n":1}'); expect(t.json([new Mine(1)])).toBe('[{"n":1}]'); });
test("a22 iteration protocols", () => { class It { *[Symbol.iterator]() { yield 1; yield 2; } } expect(t.spreadAll(new It())).toEqual([1, 2]); expect(t.first(new It())).toBe(1); expect(Array.from(new It(), t.arrow)).toEqual([2, 4]); expect(t.sortBy([3, 1, 2], (a: number, b: number) => a - b)).toEqual([1, 2, 3]); expect([3, 1, 2].sort((a, b) => t.plain(a, -b))).toEqual([1, 2, 3]); let closed = 0; t.first({ [Symbol.iterator]: () => ({ next: () => ({ value: 1, done: false }), return: () => (closed++, {}) }) }); expect(closed).toBe(1); });
test("a23 errors", () => { const e = new t.Err("m"); expect([e instanceof t.Err, e instanceof Error, e.describe(), e.name, Object.prototype.toString.call(e)]).toEqual([true, true, "Err:m:7", "Err", "[object Error]"]); class MyErr extends t.Err { extra = 1; } const f = new MyErr("n"); expect([t.isInstance(f, t.Err), f.describe(), f.extra, f.stack!.split("\n")[0]]).toEqual([true, "Err:n:7", 1, "Err: n"]); expect(t.stackThrough(function thrower() { throw new MyErr("s"); })).toContain("thrower"); });
test("a24 call sites of both sides", () => { class Maker { constructor() { t.callMethod({ deep() { throw new Error("x"); } }, "deep"); } } const list = t.sites(function outer() { new Maker(); }); expect(list.map((s: any[]) => s[0])).toEqual(["deep", "Maker", "outer", "sites"]); expect(list.map((s: any[]) => s[3])).toEqual([false, true, false, false]); });
test("a25 arrays of their class", () => { const l = t.List.from([1, 2, 3]) as t.List; expect(l.sum()).toBe(6); const m = l.map(v => v * 2); expect(m).toBeInstanceOf(t.List); expect((m as t.List).sum()).toBe(12); class L2 extends t.List { twice() { return this.sum() * 2; } } expect((L2.of(1, 2).filter(() => true) as L2).twice()).toBe(6); });
test("a26 private names of every kind", () => {
  class Own { #f = "f2"; #m() { return "m2"; } get #a() { return "a2"; } static #sf = "sf2"; static #sm() { return "sm2"; } static has(o: any) { return [#f in o, #m in o, #a in o]; } static read(o: any) { return [o.#f, o.#m(), o.#a]; } static statics(o: any) { return [o.#sf, o.#sm()]; } }
  expect(t.Priv.has(new t.Priv())).toEqual([true, true, true]); expect(t.Priv.has(new Own())).toEqual([false, false, false]); expect(Own.has(new t.Priv())).toEqual([false, false, false]); expect(Own.read(new Own())).toEqual(["f2", "m2", "a2"]); expect(t.Priv.read(new t.Priv())).toEqual(["field", "method", "accessor"]);
  expect(() => t.Priv.read(new Own())).toThrow(TypeError); expect(() => Own.read(new t.Priv())).toThrow(TypeError); expect(() => t.Priv.write(new Own(), "w")).toThrow(TypeError); expect(t.Priv.write(new t.Priv(), "w")).toBe("w"); expect(() => t.Priv.statics(Own)).toThrow(TypeError); expect(() => Own.statics(t.Priv)).toThrow(TypeError); expect(t.Priv.statics(t.Priv)).toEqual(["static field", "static method"]);
  class Below extends t.Priv { #f = "below"; mine() { return this.#f; } } const b = new Below(); expect([b.mine(), ...t.Priv.read(b)]).toEqual(["below", "field", "method", "accessor"]);
});
test("a27 proxies over classes and functions", () => { const P = new Proxy(t.Lazy, {}); expect(new P(2).m()).toBe(3); expect(t.construct(new Proxy(Mine, {}), 2).n).toBe(2); const f = new Proxy(t.plain, { apply: (target, self, args) => target(...(args as [number, number])) * 2 }); expect(f(1, 2)).toBe(6); expect(t.apply(new Proxy(mine, {}), null, [1, 2, 3])).toBe(6); class Over extends (new Proxy(t.Lazy, {}) as typeof t.Lazy) {} expect(new Over(4).m()).toBe(5); });
test("a28 what is printed", () => { expect(inspect(new t.Lazy(1))).toBe("Lazy { n: 1 }"); expect(inspect(t.Lazy2)).toContain("class Lazy2"); expect(inspect(t.plain)).toBe("[Function: plain]"); expect(Bun.inspect(new t.Child(2))).toContain("Child"); expect(Bun.inspect(t.arrow)).toBe("[Function: arrow]"); expect(inspect(t.create(Mine.prototype))).toBe("Mine {}"); expect(Bun.inspect(Object.create(t.Lazy3.prototype))).toContain("Lazy3"); });
test("a29 matchers", () => { expect(new t.Lazy(1)).toEqual(new t.Lazy(1)); expect(new t.Lazy(1)).toStrictEqual(new t.Lazy(1)); expect(new t.Lazy(1)).not.toStrictEqual({ n: 1 }); expect(new t.Lazy(1)).not.toStrictEqual(new Mine(1)); expect(new t.Child(1)).toMatchObject({ n: 1 }); expect(t.Lazy.make(1)).toBeInstanceOf(t.Lazy); expect(t.Child.make(1)).toBeInstanceOf(t.Child); expect(() => { throw new t.Err("e"); }).toThrow(t.Err); });
test("a30 frozen and sealed from the other side", () => { Object.freeze(t.Lazy5); expect(Object.isFrozen(t.Lazy5)).toBe(true); expect(t.Lazy5.s5()).toBe("s5"); expect(() => { (t.Lazy5 as any).q = 1; }).toThrow(TypeError); Object.preventExtensions(t.Lazy5.prototype); expect(new t.Lazy5().m5()).toBe("m5"); expect(Object.isExtensible(t.Lazy5.prototype)).toBe(false); Object.seal(t.plain6); expect(Object.isSealed(t.plain6)).toBe(true); });
test("a31 many objects and a collection", () => { const keep: any[] = []; for (let i = 0; i < 3000; i++) keep.push(new t.Lazy(i), new Mine(i), t.construct(Mine, i), t.plain.bind(null, i), t.mixin(Mine2), t.count(1)); Bun.gc(true); expect(keep[6 * 2999].m()).toBe(3000); expect(keep[6 * 2999 + 3](1)).toBe(3000); expect(new keep[6 * 2999 + 4]().mixed()).toBe("mixed"); expect(keep[6 * 2999 + 5].next().value).toBe(0); });
test("a32 their subclass of a built-in class is constructed for my subclass of one, and the other way", () => {
  class E1 extends Error { one = 1; } class E2 extends TypeError { two = 2; } class MyErr extends Error { mine = 1; what() { return "mine"; } } class MyBag extends Map<string, number> { own = "my bag"; size2() { return this.size * 2; } } class MyPile extends Set<number> { own = "my pile"; } class MyList extends Array<number> { last() { return this[this.length - 1]; } } class P1 extends Promise<number> { tag = "p"; }
  expect([new E1().one, new E2().two, new P1(() => {}).tag]).toEqual([1, 2, "p"]);
  const e = Reflect.construct(t.Err, ["m"], MyErr); expect([Object.getPrototypeOf(e) === MyErr.prototype, e.what(), e.code, e.mine, e.message, e.name, e instanceof t.Err]).toEqual([true, "mine", 7, undefined, "m", "Err", false]);
  const f = t.reflectConstruct(MyErr, ["n"], t.Err); expect([Object.getPrototypeOf(f) === t.Err.prototype, f.describe(), f.mine, f instanceof MyErr]).toEqual([true, "Error:n:undefined", 1, false]);
  const b = Reflect.construct(t.Bag, [[["a", 1], ["b", 2]]], MyBag); expect([b.size2(), b.label, b.own, b.get("b"), b instanceof Map]).toEqual([4, "bag", undefined, 2, true]);
  const c = t.reflectConstruct(MyBag, [[["a", 5]]], t.Bag); expect([c.total(), c.own, c.label]).toEqual([5, "my bag", undefined]);
  const p = Reflect.construct(t.Pile, [[1, 9, 3]], MyPile); expect([p.label, p.own, p.has(9), Object.getPrototypeOf(p) === MyPile.prototype]).toEqual(["pile", undefined, true, true]); expect(t.reflectConstruct(MyPile, [[4]], t.Pile).top()).toBe(4);
  const l = Reflect.construct(t.List, [], MyList); l.push(1, 2); expect([l.last(), l.length, Array.isArray(l)]).toEqual([2, 2, true]); const k = t.reflectConstruct(MyList, [], t.List); k.push(3, 4); expect(k.sum()).toBe(7);
  expect([new t.Err("x").code, new MyErr("y").mine, new t.Bag().label, new MyBag().own, new t.Pile().label, new MyPile().own]).toEqual([7, 1, "bag", "my bag", "pile", "my pile"]);
  class Over extends t.Bag { over = 1; } class Over2 extends t.mixin(MyBag) { over2 = 2; } expect([new Over().over, new Over().label, new Over2().own, new Over2().over2, new Over2().mixed()]).toEqual([1, "bag", "my bag", 2, "mixed"]);
});
test("a33 fields that are still empty are created from the other side", () => {
  type Mine = { a: number; b?: string; c?: number; d?: { x: number }; e?: boolean };
  const make = (i: number): Mine => ({ a: i });
  const fill = (o: Mine) => { o.b = "s"; o.c = 1.5; o.d = { x: 1 }; o.e = true; return o; };
  const setB = (o: any, v: any) => { o.b = v; return o; }; const setKey = (o: any, k: string, v: any) => { o[k] = v; return o; };
  expect(fill(make(0))).toEqual({ a: 0, b: "s", c: 1.5, d: { x: 1 }, e: true }); expect(t.fillPart(t.makePart(0))).toEqual({ a: 0, b: "s", c: 1.5, d: { x: 1 }, e: true });
  for (let i = 0; i < 200; i++) {
    const b = i % 3 ? "text" + i : i, c = i % 4 ? i / 2 : "no number", d = i % 5 ? { x: i } : null, e = i % 7 ? i % 2 === 0 : "no boolean";
    const o: any = make(i); t.setB(o, b); t.setC(o, c); t.setKey(o, "d", d); t.setKey(o, "e", e);
    expect(Object.keys(o)).toEqual(["a", "b", "c", "d", "e"]); expect([o.a, o.b, o.c, o.d, o.e]).toEqual([i, b, c, d, e]);
    const p: any = t.makePart(i); setB(p, b); setKey(p, "c", c); setKey(p, "d", d); setKey(p, "e", e);
    expect(Object.keys(p)).toEqual(["a", "b", "c", "d", "e"]); expect([p.a, p.b, p.c, p.d, p.e]).toEqual([i, b, c, d, e]);
    const q: any = t.mergeInto(make(i), { e, d, c, b, z: i }); expect(Object.keys(q)).toEqual(["a", "e", "d", "c", "b", "z"]); expect(JSON.stringify(q)).toBe(JSON.stringify({ a: i, e, d, c, b, z: i }));
    const r: any = t.mergeInto(t.makePart(i), fill(make(i))); expect(r).toEqual({ a: i, b: "s", c: 1.5, d: { x: 1 }, e: true });
  }
});
