const tag = Symbol("tag"), other = Symbol.for("other");
interface T { a?: number; b: number }
class Plain { v = 1; method() { return 1; } }
class WithSymbols { v = 1; [tag] = "field"; [Symbol.iterator]() { return [1][Symbol.iterator](); } get [Symbol.toStringTag]() { return "W"; } static [other] = 1; }
function hide(value: unknown): any { return value; }
let count = 0;
function show(name: string, make: () => unknown) {
  let out: string;
  try { out = JSON.stringify(make()); } catch (e) { out = "THROWN " + (e as Error).name; }
  console.log(String(++count).padStart(2, "0"), name + ":", out);
}
const names = (list: symbol[]) => list.map(s => String(s.description));
function typed(x: object) { return names(Object.getOwnPropertySymbols(x)); }
function untyped(x: any) { return names(Object.getOwnPropertySymbols(x)); }
function all(x: any) { return Reflect.ownKeys(x).map(k => (typeof k === "symbol" ? "@" + String(k.description) : k)); }
const every = (x: object) => [typed(x), untyped(x), all(x), Object.keys(x)];
const make: () => T = () => ({ b: 1 });
show("a record", () => every(make()));
show("instances", () => [every(new Plain()), every(new WithSymbols()), every(WithSymbols), every(WithSymbols.prototype)]);
show("a symbol extra comes, a second, one goes, both are gone", () => { const x = make(); const out = [every(x)]; hide(x)[tag] = 1; out.push(every(x)); hide(x)[other] = 2; out.push(every(x)); delete hide(x)[tag]; out.push(every(x)); delete hide(x)[other]; out.push(every(x)); return out; });
show("a string extra alone", () => { const x = make(); hide(x).zz = 1; return every(x); });
show("a hidden symbol, an accessor under a symbol", () => { const x = make(); Object.defineProperty(hide(x), tag, { value: 1, enumerable: false }); Object.defineProperty(hide(x), other, { get() { return 1; }, enumerable: true }); return every(x); });
show("another prototype that has symbols, a null prototype", () => { const proto = JSON.parse("{}"); proto[tag] = 1; return [every(Object.setPrototypeOf(hide(make()), proto)), every(Object.setPrototypeOf(hide(make()), null))]; });
show("frozen, sealed, closed", () => [Object.freeze(make()), Object.seal(make()), Object.preventExtensions(make())].map(every));
show("what comes back is fresh and can be changed", () => { const x = make(); const a = Object.getOwnPropertySymbols(x), b = Object.getOwnPropertySymbols(x); a.push(tag); return [a !== b, a.length, b.length, Array.isArray(a), Object.getOwnPropertySymbols(x).length, Object.isFrozen(b), Object.getPrototypeOf(b) === Array.prototype]; });
show("typed and plain in turn, one site", () => { const p = JSON.parse("{}"); p[tag] = 1; return [make(), p, make(), JSON.parse("{}"), new WithSymbols(), [1], make(), () => 1, "ab", 1].map(untyped); });
show("null and undefined", () => [null, undefined].map(x => { try { return untyped(x); } catch (e) { return (e as Error).name; } }));
show("many", () => { let n = 0; for (let i = 0; i < 3000; i++) { const x = make(); if (i % 3 === 0) hide(x)[tag] = i; n += untyped(x).length; } return n; });
