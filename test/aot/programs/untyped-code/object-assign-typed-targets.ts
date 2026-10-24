interface T { n: number; s: string; b: boolean; o?: number; u: number | string; inner: { v: number } }
interface Patch { n?: number; s?: string; b?: boolean; o?: number; u?: number | string }
type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number };
class Box { count = 0; label = "l"; set viaSetter(v: number) { this.count = v * 2; } get viaSetter() { return this.count; } }
function hide(value: unknown): any { return value; }
let count = 0;
function show(name: string, make: () => unknown) {
  let out: string;
  try { out = JSON.stringify(make(), (_k, v) => (v === undefined ? "undefined" : typeof v === "symbol" ? "symbol" : v)); } catch (e) { out = "THROWN " + (e as Error).name; }
  console.log(String(++count).padStart(2, "0"), name + ":", out);
}
const make = (): T => ({ n: 1.5, s: "s", b: true, u: 1, inner: { v: 1 } });
const plain = (text: string): any => JSON.parse(text);
const look = (x: object) => [x, Object.keys(x).join(), Object.getOwnPropertySymbols(x).length];
function untyped(t: any, ...sources: any[]) { return Object.assign(t, ...sources); }
function untypedOne(t: any, s: any) { return Object.assign(t, s); }
show("a plain patch of fields", () => { const x = make(); const r = Object.assign(x, plain('{"n":2.5,"s":"t","b":false}')); return [r === x, look(x), x.n + 1, x.s.length]; });
show("a typed patch of fields", () => { const x = make(); const p: Patch = { n: 2.5, s: "t" }; return [Object.assign(x, p) === x, look(x)]; });
show("a typed patch with an undefined and an absent field", () => { const x = make(); const p: Patch = { n: 3.5, o: undefined }; Object.assign(x, p); return look(x); });
show("another object of the same type", () => { const x = make(), y = make(); y.n = 9.5; y.s = "y"; y.inner = { v: 9 }; Object.assign(x, y); return [look(x), x.inner === y.inner]; });
show("itself", () => { const x = make(); return [Object.assign(x, x) === x, look(x)]; });
show("through untyped code", () => { const x = make(); untypedOne(x, plain('{"n":4.5,"u":"four"}')); return [look(x), typeof x.u]; });
show("several sources", () => { const x = make(); untyped(x, plain('{"n":1}'), { s: "two" } as Patch, plain('{"n":3,"b":false}'), null, undefined, 5, "ab"); return look(x); });
show("the last of the patch is no field", () => { const x = make(); untypedOne(x, plain('{"n":5.5,"s":"five","extra":1}')); return look(x); });
show("the first of the patch is no field", () => { const x = make(); untypedOne(x, plain('{"extra":1,"n":5.5}')); return look(x); });
show("an object in the middle", () => { const x = make(); const inner = plain('{"v":7}'); const p = plain('{"n":6.5}'); p.inner = inner; p.s = "six"; untypedOne(x, p); return [look(x), x.inner.v]; });
show("an optional field that is absent, in the middle", () => { const x = make(); untypedOne(x, plain('{"n":7.5,"o":7,"s":"seven"}')); return look(x); });
show("a symbol in the patch", () => { const x = make(); const p = plain('{"n":8.5}'); p[Symbol.for("s")] = 1; p.s = "eight"; untypedOne(x, p); return look(x); });
show("hidden and inherited properties of the patch do not count", () => { const x = make(); const p = Object.create(plain('{"s":"inherited"}')); p.n = 9.5; Object.defineProperty(p, "b", { value: false, enumerable: false }); untypedOne(x, p); return look(x); });
show("a getter in the patch runs in its turn and sees what was stored", () => { const x = make(); const seen: unknown[] = []; const p = plain('{"n":10.5}'); Object.defineProperty(p, "s", { get() { seen.push(x.n); return "got"; }, enumerable: true }); p.b = false; untypedOne(x, p); return [look(x), seen]; });
show("a getter in the patch changes a later property of the patch", () => { const x = make(); const p = plain('{"n":1}'); Object.defineProperty(p, "s", { get() { p.u = "changed"; return "got"; }, enumerable: true }); p.u = "first"; untypedOne(x, p); return look(x); });
show("indices and an array as the patch", () => { const x = make(); untypedOne(x, [1, 2]); untypedOne(x, plain('{"0":"zero","n":11.5}')); return look(x); });
show("frozen, sealed, closed targets", () => [Object.freeze, Object.seal, Object.preventExtensions].map(f => { const x = f(make()) as T; let said = "ok"; try { untypedOne(x, plain('{"n":12.5,"s":"t"}')); } catch (e) { said = (e as Error).name; } return [said, look(x)]; }));
show("a target with extras", () => { const x = make(); hide(x).zz = 1; untypedOne(x, plain('{"n":13.5,"zz":2}')); return look(x); });
show("a target with another prototype that has a setter", () => { const log: unknown[] = []; const proto = Object.defineProperty(plain("{}"), "o", { set(v) { log.push(v); }, configurable: true }); const x = Object.setPrototypeOf(hide(make()), proto); untypedOne(x, plain('{"n":14.5,"o":1,"s":"t"}')); return [look(x), log]; });
show("an instance with a setter", () => { const x = new Box(); untypedOne(x, plain('{"count":1,"viaSetter":4,"label":"m"}')); return [look(x), x.count]; });
show("a discriminant that stays", () => { const x: Shape = { kind: "circle", r: 1 }; untypedOne(x, plain('{"kind":"circle","r":2.5}')); return look(x); });
show("a frozen patch, a typed frozen patch", () => { const x = make(); untypedOne(x, Object.freeze(plain('{"n":15.5}'))); untypedOne(x, Object.freeze({ s: "frozen" } as Patch)); return look(x); });
show("many times at one site", () => { const x = make(); for (let i = 0; i < 300; i++) untypedOne(x, i & 1 ? plain('{"n":' + i + '}') : ({ s: "s" + i, u: i } as Patch)); return look(x); });
