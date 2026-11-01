import { test, expect, spyOn, mock } from "bun:test";
import * as lib from "./lib";
import def, { Animal, Base, Shape, MyError, Emitter, mixin, sym, counter } from "./lib";

class Dog extends Animal { speak() { return super.speak() + " (woof)"; } get tag() { return "dog:" + this.name; } }
class Sq extends Shape { constructor(public s: number) { super(); } area() { return this.s * this.s; } }
class Own { a = 1; b = "two"; #p = 3; m() { return this.a + this.#p; } static s = 9; get g() { return this.b; } }
const lit = () => ({ x: 1, y: 2, z: 3 });

test("01 keys of mine", () => expect(lib.keysOf(lit())).toEqual(["x", "y", "z"]));
test("02 entries of mine", () => expect(lib.entriesOf(lit())).toEqual([["x", 1], ["y", 2], ["z", 3]]));
test("03 values of mine", () => expect(lib.valuesOf(lit())).toEqual([1, 2, 3]));
test("04 spread of mine", () => expect(lib.spread(lit())).toEqual({ x: 1, y: 2, z: 3, extra: 1 }));
test("05 assign mine to theirs", () => expect(lib.assign(lib.makePoint(0, 0), lit())).toEqual({ x: 1, y: 2, z: 3 }));
test("06 assign theirs to mine", () => expect(Object.assign(lit(), lib.makePoint(8, 9))).toEqual({ x: 8, y: 9, z: 3 }));
test("07 json of mine", () => expect(lib.json({ a: [1, { b: 2 }], c: "s", d: null, e: undefined })).toBe('{"a":[1,{"b":2}],"c":"s","d":null}'));
test("08 json of theirs", () => expect(JSON.stringify(lib.makeNested())).toBe('{"a":{"b":{"c":[1,2,{"d":"deep"}]}},"list":["x","y"]}'));
test("09 clone of mine", () => expect(lib.clone({ a: 1, n: { m: [1, 2] } })).toEqual({ a: 1, n: { m: [1, 2] } }));
test("10 clone of theirs", () => expect(structuredClone(lib.makePoint(1, 2))).toEqual({ x: 1, y: 2 }));
test("11 for in", () => { expect(lib.forIn(lit())).toEqual(["x", "y", "z"]); const r = []; for (const k in lib.makePoint(1, 2)) r.push(k); expect(r).toEqual(["x", "y"]); });
test("12 destructure", () => { expect(lib.destructure({ x: 1, y: 2, p: 3, q: 4 })).toEqual([1, 2, { p: 3, q: 4 }]); const { x, ...rest } = lib.makeNested() as any; expect(x).toBeUndefined(); expect(Object.keys(rest)).toEqual(["a", "list"]); });
test("13 read write", () => { expect(lib.readX(lit())).toBe(1); expect(lib.writeX(lit(), "s").x).toBe("s"); const p = lib.makePoint(1, 2); (p as any).x = "str"; expect(p.x as any).toBe("str"); expect(lib.readX(p)).toBe("str"); });
test("14 add delete", () => { const o: any = lib.addProp(lit(), "w", 4); expect(o.w).toBe(4); expect(Object.keys(lib.del(o, "y"))).toEqual(["x", "z", "w"]); const p: any = lib.makePoint(1, 2); p.k = 5; delete p.x; expect(lib.keysOf(p)).toEqual(["y", "k"]); });
test("15 has", () => { expect(lib.has(lit(), "x")).toBe(true); expect(lib.hasOwn(lit(), "q")).toBe(false); expect("y" in lib.makePoint(1, 2)).toBe(true); });
test("16 call back", () => expect(lib.call((a: number, b: number) => a * b, 6, 7)).toBe(42));
test("17 call method of mine", () => expect(lib.callMethod(new Own(), "m")).toBe(4));
test("18 construct mine", () => { const o = lib.construct(Own); expect(o).toBeInstanceOf(Own); expect(o.g).toBe("two"); });
test("19 construct theirs", () => { const a = new Animal("cat"); expect(a.speak()).toBe("cat makes a sound"); expect(a.secret()).toBe(7); expect(a.upper).toBe("CAT"); a.upper = "LION"; expect(a.name).toBe("lion"); });
test("20 subclass", () => { const d = new Dog("rex"); expect(d.speak()).toBe("rex makes a sound (woof)"); expect(d.secret()).toBe(7); expect(d.tag).toBe("dog:rex"); expect(d instanceof Animal).toBe(true); expect(lib.isInstance(d, Animal)).toBe(true); expect(lib.isInstance(d, Dog)).toBe(true); });
test("21 static this", () => { const d = Dog.create("s"); expect(d).toBeInstanceOf(Dog); expect(Animal.count).toBeGreaterThan(0); });
test("22 abstract", () => expect(new Sq(3).describe()).toBe("area 9"));
test("23 base override", () => { class K extends Base { kind() { return "kid"; } } expect(new K().who()).toBe("I am kid"); expect(K.make()).toBeInstanceOf(K); });
test("24 mixin", () => { const M = mixin(Own); const m = new M(); expect(m.mixed()).toBe("mixed"); expect(m.m()).toBe(4); const N = mixin(Animal); expect(new N("n").speak()).toBe("n makes a sound"); });
test("25 array callbacks", () => { expect(lib.mapArray([1, 2, 3], (v, i) => v * i)).toEqual([0, 2, 6]); expect(lib.reduceArray([1, 2, 3], (a: number, b: number) => a + b, 0)).toBe(6); expect(lib.sortArray([3, 1, 2], (a: number, b: number) => b - a)).toEqual([3, 2, 1]); expect(lib.big.filter(v => v.tag === "t1").length).toBe(17); });
test("26 throw theirs catch mine", () => { expect(() => lib.thrower("boom")).toThrow("boom"); try { lib.thrower("x"); } catch (e: any) { expect(e.message).toBe("x"); expect(e).toBeInstanceOf(Error); } });
test("27 throw mine catch theirs", () => { const before = counter.finallyRan; expect(lib.tryCall(() => { throw new Error("mine"); })).toBe("caught:mine"); expect(counter.finallyRan).toBe(before + 1); });
test("28 throw through both", () => { expect(() => lib.call(() => lib.call(() => lib.thrower("deep")))).toThrow("deep"); expect(lib.tryCall(() => lib.call(() => { throw new MyError("m"); }))).toBe("caught:m"); });
test("29 throw values", () => { for (const v of [1, "s", null, undefined, { o: 1 }]) { try { lib.throwValue(v); } catch (e) { expect(e).toBe(v); } } });
test("30 generators", () => { expect([...lib.gen(3)]).toEqual([0, 2, 4]); expect(lib.iterate((function* () { yield 1; yield* lib.gen(2); yield 9; })())).toEqual([1, 0, 2, 9]); expect(lib.iterate(new Set([1, 2]))).toEqual([1, 2]); });
test("31 async", async () => { expect(await lib.asyncDouble(4)).toBe(8); expect(await lib.asyncCall(async () => { await null; return "v"; })).toEqual(["got", "v"]); });
test("32 async throw", async () => { await expect(lib.asyncThrow("bad")).rejects.toThrow("bad"); try { await lib.asyncThrow("again"); } catch (e: any) { expect(e).toBeInstanceOf(TypeError); } await expect(lib.asyncCall(async () => { throw new Error("mine"); })).rejects.toThrow("mine"); });
test("33 async generators", async () => { expect(await lib.collect(lib.asyncGen(3))).toEqual([0, 1, 2]); expect(await lib.collect((async function* () { yield "a"; yield* lib.asyncGen(2); })())).toEqual(["a", 0, 1]); const r = []; for await (const v of lib.asyncGen(2)) r.push(v); expect(r).toEqual([0, 1]); });
test("34 timers", async () => expect(await lib.later(() => "late")).toBe("late"));
test("35 bind", () => { const f = lib.bindTo(function (this: any, a: number, b: number) { return this.k + a + b; }, { k: 1 }, 2); expect(f(3)).toBe(6); const g = lib.arrow.bind(null, 5); expect(g()).toBe(7); const a = new Animal("b"); const s = a.speak.bind(a); expect(lib.call(s)).toBe("b makes a sound"); });
test("36 closures", () => { const c = lib.counterInAClosure(); c.inc(); c.inc(); expect(c.get()).toBe(2); let n = 0; lib.call(() => n++); expect(n).toBe(1); });
test("37 prototypes", () => { expect(lib.proto(new Own())).toBe(Own.prototype); expect(Object.getPrototypeOf(new Animal("p"))).toBe(Animal.prototype); const o = lib.setProto({ own: 1 }, { inherited: 2 }); expect(o.inherited).toBe(2); expect(lib.forIn(o)).toEqual(["own", "inherited"]); });
test("38 define", () => { const o: any = lib.define(lit(), "h", { value: 5, enumerable: false }); expect(o.h).toBe(5); expect(Object.keys(o)).toEqual(["x", "y", "z"]); expect(lib.describe_(lit(), "x")).toEqual({ value: 1, writable: true, enumerable: true, configurable: true }); expect(Object.getOwnPropertyDescriptor(lib.makePoint(1, 2), "y")).toEqual({ value: 2, writable: true, enumerable: true, configurable: true }); });
test("39 getters on literals", () => { expect(lib.getter({ get value() { return "got"; } })).toBe("got"); const o = lib.define({}, "value", { get() { return 3; } }); expect(o.value).toBe(3); });
test("40 freeze", () => { const o = lib.freeze(lit()); expect(Object.isFrozen(o)).toBe(true); expect(() => { "use strict"; (o as any).x = 2; }).toThrow(); const p = Object.freeze(lib.makePoint(1, 2)); expect(lib.isFrozen(p)).toBe(true); });
test("41 own keys", () => { expect(lib.ownNames({ a: 1, [sym]: 2 })).toEqual(["a", sym]); expect(Reflect.ownKeys(lib.makeNested())).toEqual(["a", "list", sym]); expect((lib.makeNested() as any)[sym]).toBe("symbol"); });
test("42 proxy", () => { const log: string[] = []; const p = lib.proxy(lit(), log); expect(p.x + p.y).toBe(3); expect(log).toEqual(["x", "y"]); const q = new Proxy(lib.makePoint(1, 2), {}); expect(lib.readX(q)).toBe(1); });
test("43 maps", () => { expect(lib.mapOf(lit()).get("y")).toBe(2); const k = lit(); expect(lib.setKey(new Map(), k, "v")).toBe("v"); expect(lib.weak(lit())).toBe(1); const w = new WeakMap(); const p = lib.makePoint(1, 1); w.set(p, 2); expect(w.get(p)).toBe(2); });
test("44 conversions", () => { const a = new Animal("c"); expect(lib.str(a)).toBe("Animal(c)"); expect(`${a}`).toBe("Animal(c)"); expect(+a).toBe(42); expect(lib.tmpl({ toString() { return "mine"; } })).toBe("mine"); expect(lib.num({ valueOf() { return 5; } })).toBe(5); expect(lib.typeOf(() => 1)).toBe("function"); expect(typeof lib.arrow).toBe("function"); expect(lib.typeOf(Own)).toBe("function"); });
test("45 identity", () => { const o = lit(); expect(lib.eq(o, o)).toBe(true); expect(lib.call((v: any) => v, o)).toBe(o); expect(lib.eq(lib.arrow, lib.arrow)).toBe(true); });
test("46 stacks", () => { const s = lib.stackOf(function mine() { lib.thrower("st"); }); expect(s).toContain("thrower"); expect(s).toContain("mine"); expect(s).toContain("stackOf"); expect(s).toContain("lib.ts"); expect(s).toContain("objects-and-calls.test.ts"); });
test("47 function properties", () => { function three(a: any, b: any, c: any) {} expect(lib.nameOf(three)).toBe("three"); expect(lib.lengthOf(three)).toBe(3); expect(lib.thrower.name).toBe("thrower"); expect(lib.makePoint.length).toBe(2); expect(Animal.name).toBe("Animal"); expect(lib.nameOf(Own)).toBe("Own"); expect(lib.sourceOf(three)).toBe(true); });
test("48 live bindings", () => { const before = lib.mutable; expect(lib.bump()).toBe(before + 1); expect(lib.mutable).toBe(before + 1); expect(def()).toBe("default"); });
test("49 group", () => { const g = lib.groupBy(lib.big, v => v.tag); expect(Object.keys(g)).toEqual(["t0", "t1", "t2"]); expect(lib.groupBy([{ k: "a" }, { k: "b" }, { k: "a" }], v => v.k).a.length).toBe(2); });
test("50 emitter", () => { const e = new Emitter(); const seen: any[] = []; e.on("x", (v: any) => { seen.push(v); return v * 2; }).on("x", (v: any) => v + 1); expect(e.emit("x", 5)).toEqual([10, 6]); expect(seen).toEqual([5]); });
test("51 optional", () => { expect(lib.optional({ a: { b: { c: 1 } } })).toBe(1); expect(lib.optional({})).toBe("none"); expect(lib.optional(null)).toBe("none"); });
test("52 arguments", () => { expect((lib.argsLen as any)(1, 2, 3)).toBe(3); expect(lib.restArgs(1, lit(), "s").length).toBe(3); expect(lib.applyFn(function (this: any, ...a: number[]) { return this.b + a.length; }, { b: 1 }, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(11); expect(lib.restArgs(...Array(40).fill(1)).length).toBe(40); expect(lib.call((...a: any[]) => a.length, ...Array(30).fill(0))).toBe(30); });
test("53 tagged regex", () => { expect(lib.tagged`a${1}b${2}c`).toBe("a|b|c1,2"); expect(lib.regex("ab 12 cd", m => m.toUpperCase())).toBe("AB 12 CD"); });
test("54 dates errors", () => { expect(lib.dateOf({ when: new Date(5) })).toBe(5); expect(lib.errorIs(new RangeError("r"))).toEqual([true, "RangeError", "r"]); const e = new MyError("q"); expect(e.code).toBe("E_MY"); expect(e).toBeInstanceOf(Error); expect(lib.errorIs(e)).toEqual([true, "MyError", "q"]); class E2 extends MyError {} expect(new E2("z").name).toBe("MyError"); });
test("55 toEqual both ways", () => { expect(lib.makePoint(1, 2)).toEqual({ x: 1, y: 2 }); expect({ x: 1, y: 2 }).toEqual(lib.makePoint(1, 2)); expect(lib.makeNested()).toMatchObject({ a: { b: { c: [1, 2, { d: "deep" }] } } }); expect(new Animal("e")).toEqual(new Animal("e")); expect(lib.makePoint(1, 2)).not.toEqual({ x: 1, y: 3 }); expect(lib.makePoint(1, 2)).toStrictEqual({ x: 1, y: 2 }); expect([lib.makePoint(1, 2)]).toContainEqual({ x: 1, y: 2 }); expect(lib.makePoint(1, 2)).toHaveProperty("y", 2); });
test("56 inspect", () => { expect(Bun.inspect(lib.makePoint(1, 2))).toBe("{\n  x: 1,\n  y: 2,\n}"); expect(Bun.inspect(new Animal("i"))).toContain("Animal"); expect(Bun.inspect(lib.arrow)).toContain("arrow"); expect(Bun.inspect(new Own())).toContain("Own"); });
test("57 snapshot", () => { expect(lib.makeNested()).toMatchInlineSnapshot(`
{
  "a": {
    "b": {
      "c": [
        1,
        2,
        {
          "d": "deep",
        },
      ],
    },
  },
  [Symbol(lib)]: "symbol",
  "list": [
    "x",
    "y",
  ],
}
`); });
test("58 spy on export", () => { const s = spyOn(lib, "makePoint").mockReturnValue({ x: 9, y: 9 }); expect(lib.makePoint(1, 2)).toEqual({ x: 9, y: 9 }); expect(s).toHaveBeenCalledWith(1, 2); s.mockRestore(); expect(lib.makePoint(1, 2)).toEqual({ x: 1, y: 2 }); });
test("59 spy on method", () => { const a = new Animal("s"); const s = spyOn(a, "speak"); expect(lib.callMethod(a, "speak")).toBe("s makes a sound"); expect(s).toHaveBeenCalledTimes(1); const p = spyOn(Animal.prototype, "speak").mockImplementation(function (this: Animal) { return "mocked " + this.name; }); expect(new Animal("t").speak()).toBe("mocked t"); p.mockRestore(); });
test("60 mock fn", () => { const f = mock((a: number) => a + 1); expect(lib.mapArray([1, 2], f)).toEqual([2, 3]); expect(f).toHaveBeenCalledTimes(2); expect(lib.call(f, 5)).toBe(6); });
test("61 many shapes", () => { const all: any[] = []; for (let i = 0; i < 200; i++) all.push(i % 2 ? lib.makePoint(i, i) : { x: i, y: i }); expect(all.reduce((s, p) => s + lib.readX(p) + p.y, 0)).toBe(2 * (199 * 200) / 2); });
test("62 class fields of theirs from mine", () => { const d = new Dog("f"); expect(Object.keys(d)).toEqual(["name"]); expect(lib.keysOf(d)).toEqual(["name"]); expect(lib.json(d)).toBe('{"name":"f"}'); expect(lib.spread(d)).toEqual({ name: "f", extra: 1 }); });
test("63 dynamic import", async () => { const m = await import("./lib"); expect(m.makePoint).toBe(lib.makePoint); expect(m.default()).toBe("default"); const r = require("./lib"); expect(r.arrow(1)).toBe(3); });
test("64 gc", () => { const keep: any[] = []; for (let i = 0; i < 2000; i++) { keep.push(lib.spread({ i, s: "x" + i }), new Dog("g" + i), lib.counterInAClosure()); } Bun.gc(true); expect(keep[3].i).toBe(1); expect(keep[4].speak()).toBe("g1 makes a sound (woof)"); Bun.gc(true); expect(keep.length).toBe(6000); });
