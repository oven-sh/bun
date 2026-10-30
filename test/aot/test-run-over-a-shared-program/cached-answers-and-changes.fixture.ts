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
