import { test, expect } from "bun:test";
import * as L from "./lib3";

// What one image has found out about an object of the other is kept, and has to go when the object, its class or anything above it changes.
function warm<T>(f: () => T): T { let r!: T; for (let i = 0; i < 60; i++) r = f(); return r; }
const readM = (o: any) => o.m;
const callM = (o: any) => o.m();
const readG = (o: any) => o.g;
const writeG = (o: any, v: any) => { o.g = v; };
const readAbsent = (o: any) => o.absentName;
const readToString = (o: any) => o.toString;
const readKeyed = (o: any, k: any) => o[k];
const hasM = (o: any) => "m" in o;
const other = () => "other";

test("c01 their method, they replace it", () => { const o = new L.A1(); expect(warm(() => callM(o))).toBe("m"); L.patch(L.A1, "m", other); expect(callM(o)).toBe("other"); expect(readM(o)).toBe(other); });
test("c02 their method, I replace it", () => { const o = new L.A2(); expect(warm(() => readM(o))).toBe(L.A2.prototype.m); (L.A2.prototype as any).m = other; expect(readM(o)).toBe(other); expect(callM(new L.A2())).toBe("other"); });
test("c03 their method is deleted", () => { const o = new L.A3(); expect(warm(() => callM(o))).toBe("m"); delete (L.A3.prototype as any).m; expect(readM(o)).toBeUndefined(); expect(hasM(o)).toBe(false); });
test("c04 their method becomes a getter", () => { const o = new L.A4(); expect(warm(() => callM(o))).toBe("m"); Object.defineProperty(L.A4.prototype, "m", { get() { return other; } }); expect(callM(o)).toBe("other"); });
test("c05 the parent of their class changes", () => { const o = new L.A5(); expect(warm(() => callM(o))).toBe("parent"); Object.setPrototypeOf(L.A5.prototype, { m: other }); expect(callM(o)).toBe("other"); });
test("c06 their instance gets the name itself", () => { const o: any = new L.A6(), p = new L.A6(); expect(warm(() => callM(o))).toBe("m"); o.m = other; expect(callM(o)).toBe("other"); expect(callM(p)).toBe("m"); delete o.m; expect(callM(o)).toBe("m"); });
test("c07 their instance gets another prototype", () => { const o = new L.A7(); expect(warm(() => callM(o))).toBe("m"); Object.setPrototypeOf(o, { m: other }); expect(callM(o)).toBe("other"); expect(callM(new L.A7())).toBe("m"); });
test("c08 my subclass, they replace the parent's method", () => { class S extends L.A8 { mine() { return 1; } } const o = new S(); expect(warm(() => callM(o))).toBe("m"); L.patch(L.A8, "m", other); expect(callM(o)).toBe("other"); });
test("c09 my subclass gets the method itself", () => { class S extends L.A9 { mine() { return 1; } } const o = new S(); expect(warm(() => callM(o))).toBe("m"); (S.prototype as any).m = other; expect(callM(o)).toBe("other"); expect(callM(new L.A9())).toBe("m"); });
test("c10 a name that nobody has, then their class has it, then Object.prototype", () => {
  const o = new L.A10(), p = new L.A11();
  expect(warm(() => readAbsent(o))).toBeUndefined(); expect(warm(() => readAbsent(p))).toBeUndefined();
  L.patch(L.A10, "absentName", 1); expect(readAbsent(o)).toBe(1); expect(readAbsent(p)).toBeUndefined();
  try { (Object.prototype as any).absentName = 2; expect(readAbsent(p)).toBe(2); expect(readAbsent(o)).toBe(1); } finally { delete (Object.prototype as any).absentName; }
  expect(readAbsent(p)).toBeUndefined();
});
test("c11 what Object.prototype has, then their class has it", () => { const o = new L.A15(); expect(warm(() => readToString(o))).toBe(Object.prototype.toString); L.patch(L.A15, "toString", other); expect(readToString(o)).toBe(other); expect(`${o}`).toBe("other"); });
test("c12 their getter becomes a value", () => { const o = new L.A12(); expect(warm(() => readG(o))).toBe("g"); Object.defineProperty(L.A12.prototype, "g", { value: 5, configurable: true }); expect(readG(o)).toBe(5); });
test("c13 their setter, then another", () => { const o = new L.A13(); warm(() => writeG(o, 3)); expect(o.v).toBe(3); expect(readG(o)).toBe(3); Object.defineProperty(L.A13.prototype, "g", { set(v: number) { this.v = -v; }, configurable: true }); writeG(o, 4); expect(o.v).toBe(-4); expect(readG(o)).toBe(-4); });
test("c14 their method under a symbol", () => { const o = new L.A14(); expect(warm(() => [...(o as any)])).toEqual([1]); L.patch(L.A14, Symbol.iterator, function* () { yield 2; }); expect([...(o as any)]).toEqual([2]); });
test("c15 their method by a key", () => { const o = new L.A16(); expect(warm(() => readKeyed(o, "m"))).toBe(L.A16.prototype.m); L.patch(L.A16, "m", other); expect(readKeyed(o, "m")).toBe(other); });
test("c16 in", () => { const o = new L.A17(); expect(warm(() => hasM(o))).toBe(true); delete (L.A17.prototype as any).m; expect(hasM(o)).toBe(false); expect(L.A17.s()).toBe("s"); });
test("c17 three of their classes, the middle one gets the method", () => { const o = new L.A18(); expect(warm(() => callM(o))).toBe("top"); L.patch(L.M18, "m", other); expect(callM(o)).toBe("other"); });

class B1 { m() { return "mine"; } } class B2 { m() { return "mine"; } } class B3 { m() { return "mine"; } } class B4 { get g() { return "mine"; } }
class B5 { v = 0; set g(v: number) { this.v = v; } } class B6 { m() { return "mine"; } } class B7 { m() { return "mine"; } } class B8 { m() { return "mine"; } }
test("c21 my method read by them, I replace it", () => { const o = new B1(); expect(warm(() => L.callM(o))).toBe("mine"); (B1.prototype as any).m = other; expect(L.callM(o)).toBe("other"); expect(L.readM(o)).toBe(other); });
test("c22 my method read by them, they replace it", () => { const o = new B2(); expect(warm(() => L.readM(o))).toBe(B2.prototype.m); L.patch(B2, "m", other); expect(L.callM(o)).toBe("other"); });
test("c23 my method read by them is deleted", () => { const o = new B3(); expect(warm(() => L.hasM(o))).toBe(true); expect(warm(() => L.callM(o))).toBe("mine"); delete (B3.prototype as any).m; expect(L.readM(o)).toBeUndefined(); expect(L.hasM(o)).toBe(false); });
test("c24 my getter read by them", () => { const o = new B4(); expect(warm(() => L.readG(o))).toBe("mine"); Object.defineProperty(B4.prototype, "g", { value: 6 }); expect(L.readG(o)).toBe(6); });
test("c25 my setter called by them", () => { const o = new B5(); warm(() => L.writeG(o, 3)); expect(o.v).toBe(3); Object.defineProperty(B5.prototype, "g", { set(v: number) { this.v = -v; } }); L.writeG(o, 4); expect(o.v).toBe(-4); });
test("c26 their class above mine", () => { const E = L.extend(B6); const o = new E(); expect(warm(() => L.callM(o))).toBe("mine"); expect(warm(() => callM(o))).toBe("mine"); (B6.prototype as any).m = other; expect(L.callM(o)).toBe("other"); expect(callM(o)).toBe("other"); expect(o.e()).toBe("e"); });
test("c27 a name that nobody has, read by them", () => { const o = new B7(); expect(warm(() => L.readAbsent(o))).toBeUndefined(); (B7.prototype as any).absentName = 7; expect(L.readAbsent(o)).toBe(7); });
test("c28 my method by a key, read by them", () => { const o = new B8(); expect(warm(() => L.readKeyed(o, "m"))).toBe(B8.prototype.m); (B8.prototype as any).m = other; expect(L.readKeyed(o, "m")).toBe(other); });

// Stores to fields of the other image's objects: at one site, with values that the field's slot takes and values that it does not.
const writeX = (o: any, v: any) => { o.x = v; };
const writeField = { i: (o: any, v: any) => { o.i = v; }, d: (o: any, v: any) => { o.d = v; }, s: (o: any, v: any) => { o.s = v; }, b: (o: any, v: any) => { o.b = v; }, n: (o: any, v: any) => { o.n = v; }, u: (o: any, v: any) => { o.u = v; }, o: (o: any, v: any) => { o.o = v; }, f: (o: any, v: any) => { o.f = v; } } as Record<string, (o: any, v: any) => void>;
const values: any[] = [0, 1, -1, 2 ** 31, -(2 ** 31), 2 ** 31 - 1, 1.5, -0, NaN, Infinity, "", "text", true, false, null, undefined, 10n, Symbol.iterator, {}, [], () => 2, new Date(0), L.point()];
test("c31 their field takes what I store", () => { const o = L.point(); warm(() => writeX(o, 5)); expect(o.x).toBe(5); expect(L.typedSum(o)).toBe(7); });
test("c32 every kind of value in every kind of field of theirs", () => {
  for (const name of Object.keys(writeField)) {
    const o: any = L.mixed();
    warm(() => writeField[name](o, o[name]));
    for (const v of values) { writeField[name](o, v); expect(Object.is(o[name], v)).toBe(true); expect(Object.is(L.readKeyed(o, name), v)).toBe(true); }
    expect(Object.keys(o)).toEqual(["i", "d", "s", "b", "n", "u", "o", "f"]);
  }
});
test("c33 every kind of value in the fields of their class", () => {
  const write = { x: (o: any, v: any) => { o.x = v; }, y: (o: any, v: any) => { o.y = v; }, z: (o: any, v: any) => { o.z = v; }, w: (o: any, v: any) => { o.w = v; }, b: (o: any, v: any) => { o.b = v; }, o: (o: any, v: any) => { o.o = v; } } as Record<string, (o: any, v: any) => void>;
  for (const name of Object.keys(write)) {
    const o: any = new L.F1();
    warm(() => write[name](o, o[name]));
    for (const v of values) { write[name](o, v); expect(Object.is(o[name], v)).toBe(true); expect(Object.is(L.readKeyed(o, name), v)).toBe(true); }
  }
});
test("c34 their typed code reads what I stored", () => { const o = new L.F1(); const writeY = (o: any, v: any) => { o.y = v; }, writeW = (o: any, v: any) => { o.w = v; }; warm(() => writeY(o, "four")); warm(() => writeW(o, 3)); expect(L.lengthOfY(o)).toBe(4); expect(L.halfOfW(o)).toBe(1.5); writeW(o, 5); expect(L.halfOfW(o)).toBe(2.5); });
test("c35 their object is frozen, sealed, closed", () => {
  "use strict";
  const frozen = L.point(), sealed = L.point(), closed = L.point();
  warm(() => writeX(frozen, 1)); Object.freeze(frozen); expect(() => writeX(frozen, 2)).toThrow(TypeError); expect(frozen.x).toBe(1);
  Object.seal(sealed); writeX(sealed, 3); expect(sealed.x).toBe(3);
  Object.preventExtensions(closed); writeX(closed, 4); expect(closed.x).toBe(4);
});
test("c36 their field is deleted, then stored again", () => { const o: any = L.point(); warm(() => writeX(o, 1)); delete o.x; expect("x" in o).toBe(false); writeX(o, 2); expect(o.x).toBe(2); expect(Object.keys(o)).toEqual(["y", "x"]); });
test("c37 their field becomes read-only, then an accessor", () => {
  const o: any = L.point(); warm(() => writeX(o, 1));
  Object.defineProperty(o, "x", { writable: false }); expect(() => writeX(o, 2)).toThrow(TypeError); expect(o.x).toBe(1);
  let seen: any; Object.defineProperty(o, "x", { set(v) { seen = v; }, get() { return "got"; } }); writeX(o, 3); expect(seen).toBe(3); expect(o.x).toBe("got");
});
test("c38 a setter appears above their object while the field is gone", () => { const o: any = L.point(); warm(() => writeX(o, 1)); delete o.x; let seen: any; Object.setPrototypeOf(o, { set x(v: any) { seen = v; } }); writeX(o, 9); expect(seen).toBe(9); expect(Object.hasOwn(o, "x")).toBe(false); });
test("c39 my fields stored by them", () => {
  class Mine { x = 1; y = "s"; z: any = null; }
  const o = new Mine(), lit = { x: 1, y: 2 };
  warm(() => L.writeX(o, 2)); warm(() => L.writeX(lit, 2));
  for (const v of values) { L.writeX(o, v); expect(Object.is(o.x, v)).toBe(true); L.writeX(lit, v); expect(Object.is(lit.x, v)).toBe(true); L.writeKeyed(o, "y", v); expect(Object.is(o.y, v)).toBe(true); }
  Object.freeze(lit); expect(() => L.writeX(lit, 0)).toThrow(TypeError);
});
test("c40 their field by a key", () => { const o: any = L.point(); const writeKeyed = (o: any, k: any, v: any) => { o[k] = v; }; warm(() => writeKeyed(o, "y", 1)); for (const v of values) { writeKeyed(o, "y", v); expect(Object.is(o.y, v)).toBe(true); } });

// A call into the other image with more arguments than are copied twice: the frame of the entry is moved. What runs behind the call is my image again.
function stillMine(tag: string) {
  class Fresh { v = tag; m() { return this.v; } }
  const o: any = new Fresh();
  o["added" + tag] = 1;
  const stack = new Error(tag).stack!;
  return [o.m(), Object.keys(o).join(), /stillMine/.test(stack), JSON.stringify({ tag }), `${tag}`.replace(/a/g, "b"), L.callM(o)].join(" ");
}
const longList = (n: number) => Array.from({ length: n }, (_, i) => i);
for (const n of [4, 4095, 4096, 4097, 5000, 40000]) {
  test(`c51 their function with ${n} arguments`, () => { expect(L.countArguments(...longList(n))).toBe(n); expect(stillMine("a" + n)).toBe(`a${n} v,addeda${n} true {"tag":"a${n}"} b${n} a${n}`); expect(L.sumArguments(...longList(n))).toBe((n * (n - 1)) / 2); expect(stillMine("c")).toBe('c v,addedc true {"tag":"c"} c c'); });
  test(`c52 they hand ${n} arguments on to me`, () => { const mine = (...all: number[]) => all.length + stillMine("d").length; expect(L.handOn(mine, ...longList(n))).toBe(n + 'd v,addedd true {"tag":"d"} d d'.length); expect(stillMine("e")).toBe('e v,addede true {"tag":"e"} e e'); });
  test(`c53 their function throws behind ${n} arguments`, () => { expect(() => L.throwBehind(...longList(n))).toThrow("behind " + n); expect(stillMine("f")).toBe('f v,addedf true {"tag":"f"} f f'); });
  test(`c54 new of their class with ${n} arguments`, () => { expect(new L.Many(...longList(n)).count).toBe(n); expect(stillMine("g")).toBe('g v,addedg true {"tag":"g"} g g'); });
}

// What lies outside a plain slot: a field that is not there yet, what is inherited behind it, extra properties, a field that has left its slot.
const readA = (o: any) => o.a;
const hasA = (o: any) => "a" in o;
const myMakers: typeof L.makers = {
  optional: (i: number): any => { const o: { a?: number; n: number } = { n: 1 }; if (i) o.a = i; return o; },
  klass: (): any => class { declare a?: number; n = 1; constructor(i?: number) { if (i) this.a = i; } },
  extras: (v: unknown): any => { const o: any = { x: 1 }; for (const k of ["z", "a", "b"]) o[k] = v; return o; },
  extrasInOtherOrder: (v: unknown): any => { const o: any = { x: 1 }; for (const k of ["b", "a"]) o[k] = v; return o; },
  leftItsSlot: (): any => { const o: any = { a: 1, y: 2 }; o.a = "text"; return o; },
};
for (const [who, M, read, keyed, has] of [["I read theirs", L.makers, readA, readKeyed, hasA], ["they read mine", myMakers, L.readA, L.readKeyed, L.hasA]] as const) {
  test(`c61 ${who}: a field that is not there, then is, then is not`, () => {
    const o = M.optional(0), p = M.optional(0), q = M.optional(7);
    expect(warm(() => read(o))).toBeUndefined(); expect(warm(() => keyed(o, "a"))).toBeUndefined(); expect(warm(() => has(o))).toBe(false); expect(read(q)).toBe(7);
    o.a = 5; expect(read(o)).toBe(5); expect(keyed(o, "a")).toBe(5); expect(has(o)).toBe(true); expect(read(p)).toBeUndefined(); expect(has(p)).toBe(false);
    delete o.a; expect(read(o)).toBeUndefined(); expect(keyed(o, "a")).toBeUndefined(); expect(has(o)).toBe(false); expect(read(q)).toBe(7);
  });
  test(`c62 ${who}: a field that is not there, then Object.prototype has the name`, () => {
    const o = M.optional(0);
    expect(warm(() => read(o))).toBeUndefined(); expect(warm(() => keyed(o, "a"))).toBeUndefined();
    try { (Object.prototype as any).a = "from above"; expect(read(o)).toBe("from above"); expect(keyed(o, "a")).toBe("from above"); expect(has(o)).toBe(true); o.a = 3; expect(read(o)).toBe(3); delete o.a; expect(read(o)).toBe("from above"); } finally { delete (Object.prototype as any).a; }
    expect(read(o)).toBeUndefined(); expect(has(o)).toBe(false);
  });
  test(`c63 ${who}: a field of an instance that is not there, then the class has the name`, () => {
    const C = M.klass(), o = new C(), p = new C();
    expect(warm(() => read(o))).toBeUndefined();
    C.prototype.a = 5; expect(read(o)).toBe(5); expect(read(p)).toBe(5);
    o.a = 6; expect(read(o)).toBe(6); expect(read(p)).toBe(5);
    delete o.a; expect(read(o)).toBe(5);
    delete C.prototype.a; expect(read(o)).toBeUndefined(); expect(keyed(p, "a")).toBeUndefined();
  });
  test(`c64 ${who}: what is inherited behind an empty slot changes`, () => {
    const C = M.klass(); C.prototype.a = 7; const o = new C(), p = new C();
    expect(warm(() => read(o))).toBe(7); expect(warm(() => keyed(o, "a"))).toBe(7);
    C.prototype.a = 8; expect(read(o)).toBe(8); expect(keyed(o, "a")).toBe(8);
    Object.defineProperty(C.prototype, "a", { get() { return "got"; }, configurable: true }); expect(read(o)).toBe("got"); expect(keyed(p, "a")).toBe("got");
    delete C.prototype.a; expect(read(o)).toBeUndefined();
    Object.setPrototypeOf(C.prototype, { a: "further up" }); expect(read(o)).toBe("further up");
    Object.setPrototypeOf(o, { a: "another prototype" }); expect(read(o)).toBe("another prototype"); expect(read(p)).toBe("further up");
  });
  test(`c65 ${who}: an extra property is replaced, deleted, added again, made a getter`, () => {
    const o = M.extras(2), p = M.extras("p");
    expect(warm(() => read(o))).toBe(2); expect(warm(() => keyed(o, "a"))).toBe(2); expect(read(p)).toBe("p");
    o.a = 3; expect(read(o)).toBe(3); expect(read(p)).toBe("p");
    delete o.a; expect(read(o)).toBeUndefined(); expect(has(o)).toBe(false); expect(read(p)).toBe("p"); expect(Object.keys(o).join()).toBe("x,z,b");
    o.a = 4; expect(read(o)).toBe(4); expect(Object.keys(o).join()).toBe("x,z,b,a");
    Object.defineProperty(o, "a", { get() { return "got"; }, configurable: true }); expect(read(o)).toBe("got"); expect(keyed(o, "a")).toBe("got"); expect(read(p)).toBe("p");
  });
  test(`c66 ${who}: extra properties in two orders, and more of them`, () => {
    const o = M.extras(1), p = M.extrasInOtherOrder(2);
    expect(warm(() => read(o) + read(p))).toBe(3);
    for (let i = 0; i < 40; i++) o["more" + i] = i;
    expect(read(o)).toBe(1); expect(keyed(o, "more39")).toBe(39); expect(read(p)).toBe(2); expect(read(M.extras(9))).toBe(9);
  });
  test(`c67 ${who}: a field that has left its slot`, () => {
    const o = M.leftItsSlot(), p = M.leftItsSlot();
    expect(warm(() => read(o))).toBe("text"); expect(warm(() => keyed(o, "a"))).toBe("text");
    o.a = 12; expect(read(o)).toBe(12); expect(read(p)).toBe("text");
    delete p.a; expect(read(p)).toBeUndefined(); expect(has(p)).toBe(false); expect(Object.keys(p).join()).toBe("y");
    o.a = { deep: 1 }; expect(read(o).deep).toBe(1); expect(Object.keys(o).join()).toBe("a,y");
  });
  test(`c68 ${who}: frozen, and behind a collection`, () => {
    const o = Object.freeze(M.extras(2)), p = Object.freeze(M.optional(0)), q = M.leftItsSlot();
    expect(warm(() => [read(o), read(p), read(q)].join())).toBe("2,,text");
    Bun.gc(true);
    expect([read(o), read(p), read(q), read(M.extras(5)), read(M.optional(6))].join()).toBe("2,,text,5,6");
  });
}

// A field that holds a function holds nothing until somebody reads it: whoever reads it first, the function is made as its own image makes it.
const withFunctions = (i: number): any => ({ n: i, plain: (x: number) => x + 1, capturing: () => i * 2, method() { return this.n; }, async later() { return i; }, *some() { yield i; } });
const readers = { plain: (o: any) => o.plain, capturing: (o: any) => o.capturing, method: (o: any) => o.method, later: (o: any) => o.later, some: (o: any) => o.some };
const callers = { plain: (o: any) => o.plain(1), capturing: (o: any) => o.capturing(), method: (o: any) => o.method(), later: (o: any) => o.later(), some: (o: any) => [...o.some()] };
for (const [who, make, R, C, keyed] of [["I read theirs", L.withFunctions, readers, callers, readKeyed], ["they read mine", withFunctions, L.readers, L.callers, L.readKeyed]] as const) {
  test(`c69 ${who}: functions that nobody has made yet, read`, async () => {
    for (let i = 1; i <= 80; i++) {
      const o = make(i);
      expect(R.plain(o)(1)).toBe(2); expect(R.capturing(o)()).toBe(i * 2); expect(R.method(o).call(o)).toBe(i); expect(await R.later(o)()).toBe(i); expect([...R.some(o)()]).toEqual([i]);
      expect(R.plain(o)).toBe(o.plain); expect(R.capturing(o)).toBe(R.capturing(o)); expect(keyed(o, "method")).toBe(o.method);
      expect([R.plain(o).name, R.capturing(o).name, R.method(o).name, R.later(o).name, R.some(o).name, R.plain(o).length].join()).toBe("plain,capturing,method,later,some,1");
      if (i === 40) Bun.gc(true);
    }
  });
  test(`c70 ${who}: functions that nobody has made yet, called and read by key`, async () => {
    for (let i = 1; i <= 80; i++) {
      const o = make(i), p = make(i + 100);
      expect(C.plain(o)).toBe(2); expect(C.capturing(o)).toBe(i * 2); expect(C.method(o)).toBe(i); expect(await C.later(o)).toBe(i); expect(C.some(o)).toEqual([i]);
      expect(keyed(p, "capturing")()).toBe((i + 100) * 2); expect(keyed(p, "method").call({ n: "other this" })).toBe("other this"); expect(keyed(p, "plain")).toBe(R.plain(p));
    }
  });
  test(`c71 ${who}: such a field is replaced, deleted, holds something else`, () => {
    const o = make(1), p = make(2), q = make(3);
    expect(warm(() => R.plain(o)(1))).toBe(2);
    p.plain = other; expect(R.plain(p)).toBe(other); expect(C.plain(p)).toBe("other"); expect(R.plain(q)(5)).toBe(6);
    delete o.plain; expect(R.plain(o)).toBeUndefined(); expect(() => C.plain(o)).toThrow(TypeError); expect(Object.keys(o).join()).toBe("n,capturing,method,later,some");
    q.capturing = 7; expect(R.capturing(q)).toBe(7); expect(R.capturing(make(4))()).toBe(8);
    expect(Object.keys(make(5)).join()).toBe("n,plain,capturing,method,later,some"); expect(JSON.stringify(make(6))).toBe('{"n":6}');
  });
}
