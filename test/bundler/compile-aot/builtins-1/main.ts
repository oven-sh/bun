// Every built-in function that the compiler knows the result type of, called with many kinds of arguments. Generated, and split into
// several programs to keep each one quick to compile. It matters most with validateAOTInferredTypes, which checks the result of each call.
process.on("unhandledRejection", () => {});
const out: string[] = [];
const describe = (x: any): string => { try { return x === null ? "null" : Array.isArray(x) ? "array(" + x.length + ")" : typeof x === "object" ? "object " + Object.prototype.toString.call(x) : typeof x === "function" ? "function" : typeof x + ":" + String(x); } catch (e: any) { return "indescribable " + e?.name; } };
let failures = 0;
const say = (name: string, f: () => unknown) => { let text: string; try { const r = f(); text = /^(Date|Math\.random|new Date)/.test(name) ? typeof r : describe(r); } catch (e: any) { text = "threw " + e?.name; failures++; } out.push(name + " = " + text); };
const own = (methods: any) => Object.assign(Object.create(null), methods);
class OtherArray { length = 0; }
// (The result of Function.prototype.toString() depends on whether the source text was kept.)
const withText = <T,>(f: T): T => Object.defineProperty(f, "toString", { value: () => "return 1" }) as T;
const A: any[] = [
  undefined, null, true, 0, -1, 1.5, NaN, 2 ** 40, "", "abc", "a,b", "12px", 10n, Symbol("s"), Symbol.iterator,
  [], [1, 2, 3], [["k", "v"]], {}, { a: 1, b: "x" }, Object.create(null), withText(() => 1), withText(function named() {}), withText(class K {}),
  new Map([[1, 2]]), new Set([1]), /b/g, new Date(0), new Error("e"), new Proxy({ p: 1 }, {}), new Proxy([1], {}), new Proxy(function () {}, {}),
  { [Symbol.replace]: () => 42, [Symbol.split]: () => "not an array", [Symbol.search]: () => "not a number", [Symbol.match]: () => null },
  { valueOf: () => 7, toString: () => "seven" }, { toString: () => { throw new RangeError("no"); } }, { [Symbol.toPrimitive]: () => "prim" },
  new String("boxed"), new Number(5), new Uint8Array(2), new ArrayBuffer(4), Promise.resolve(1), { length: 2, 0: "x", 1: "y" }, { toJSON: () => undefined },
];

for (const a of A) { say('parseInt(a)', () => parseInt(a)); say('parseInt(a, list)', () => parseInt(a, A[16])); say('parseInt(object, a)', () => parseInt(A[19], a)); }
say('parseInt()', () => parseInt());
for (const a of A) { say('parseFloat(a)', () => parseFloat(a)); say('parseFloat(a, list)', () => parseFloat(a, A[16])); say('parseFloat(object, a)', () => parseFloat(A[19], a)); }
say('parseFloat()', () => parseFloat());
for (const a of A) { say('isNaN(a)', () => isNaN(a)); say('isNaN(a, list)', () => isNaN(a, A[16])); say('isNaN(object, a)', () => isNaN(A[19], a)); }
say('isNaN()', () => isNaN());
for (const a of A) { say('isFinite(a)', () => isFinite(a)); say('isFinite(a, list)', () => isFinite(a, A[16])); say('isFinite(object, a)', () => isFinite(A[19], a)); }
say('isFinite()', () => isFinite());
for (const a of A) { say('encodeURIComponent(a)', () => encodeURIComponent(a)); say('encodeURIComponent(a, list)', () => encodeURIComponent(a, A[16])); say('encodeURIComponent(object, a)', () => encodeURIComponent(A[19], a)); }
say('encodeURIComponent()', () => encodeURIComponent());
for (const a of A) { say('encodeURI(a)', () => encodeURI(a)); say('encodeURI(a, list)', () => encodeURI(a, A[16])); say('encodeURI(object, a)', () => encodeURI(A[19], a)); }
say('encodeURI()', () => encodeURI());
for (const a of A) { say('decodeURIComponent(a)', () => decodeURIComponent(a)); say('decodeURIComponent(a, list)', () => decodeURIComponent(a, A[16])); say('decodeURIComponent(object, a)', () => decodeURIComponent(A[19], a)); }
say('decodeURIComponent()', () => decodeURIComponent());
for (const a of A) { say('decodeURI(a)', () => decodeURI(a)); say('decodeURI(a, list)', () => decodeURI(a, A[16])); say('decodeURI(object, a)', () => decodeURI(A[19], a)); }
say('decodeURI()', () => decodeURI());
for (const a of A) { say('escape(a)', () => escape(a)); say('escape(a, list)', () => escape(a, A[16])); say('escape(object, a)', () => escape(A[19], a)); }
say('escape()', () => escape());
for (const a of A) { say('unescape(a)', () => unescape(a)); say('unescape(a, list)', () => unescape(a, A[16])); say('unescape(object, a)', () => unescape(A[19], a)); }
say('unescape()', () => unescape());
for (const a of A) { say('String(a)', () => String(a)); say('String(a, list)', () => String(a, A[16])); say('String(object, a)', () => String(A[19], a)); }
say('String()', () => String());
for (const a of A) { say('Number(a)', () => Number(a)); say('Number(a, list)', () => Number(a, A[16])); say('Number(object, a)', () => Number(A[19], a)); }
say('Number()', () => Number());
for (const a of A) { say('Boolean(a)', () => Boolean(a)); say('Boolean(a, list)', () => Boolean(a, A[16])); say('Boolean(object, a)', () => Boolean(A[19], a)); }
say('Boolean()', () => Boolean());
for (const a of A) { say('BigInt(a)', () => BigInt(a)); say('BigInt(a, list)', () => BigInt(a, A[16])); say('BigInt(object, a)', () => BigInt(A[19], a)); }
say('BigInt()', () => BigInt());
for (const a of A) { say('Symbol(a)', () => Symbol(a)); say('Symbol(a, list)', () => Symbol(a, A[16])); say('Symbol(object, a)', () => Symbol(A[19], a)); }
say('Symbol()', () => Symbol());
for (const a of A) { say('Array(a)', () => Array(a)); say('Array(a, list)', () => Array(a, A[16])); say('Array(object, a)', () => Array(A[19], a)); }
say('Array()', () => Array());
for (const a of A) { say('Object(a)', () => Object(a)); say('Object(a, list)', () => Object(a, A[16])); say('Object(object, a)', () => Object(A[19], a)); }
say('Object()', () => Object());
for (const a of A) { say('Date(a)', () => Date(a)); say('Date(a, list)', () => Date(a, A[16])); say('Date(object, a)', () => Date(A[19], a)); }
say('Date()', () => Date());
for (const a of A) { say('Object.keys(a)', () => Object.keys(a)); say('Object.keys(a, list)', () => Object.keys(a, A[16])); say('Object.keys(object, a)', () => Object.keys(A[19], a)); }
say('Object.keys()', () => Object.keys());
for (const a of A) { say('Object.values(a)', () => Object.values(a)); say('Object.values(a, list)', () => Object.values(a, A[16])); say('Object.values(object, a)', () => Object.values(A[19], a)); }
say('Object.values()', () => Object.values());
for (const a of A) { say('Object.entries(a)', () => Object.entries(a)); say('Object.entries(a, list)', () => Object.entries(a, A[16])); say('Object.entries(object, a)', () => Object.entries(A[19], a)); }
say('Object.entries()', () => Object.entries());
for (const a of A) { say('Object.getOwnPropertyNames(a)', () => Object.getOwnPropertyNames(a)); say('Object.getOwnPropertyNames(a, list)', () => Object.getOwnPropertyNames(a, A[16])); say('Object.getOwnPropertyNames(object, a)', () => Object.getOwnPropertyNames(A[19], a)); }
say('Object.getOwnPropertyNames()', () => Object.getOwnPropertyNames());
for (const a of A) { say('Object.getOwnPropertySymbols(a)', () => Object.getOwnPropertySymbols(a)); say('Object.getOwnPropertySymbols(a, list)', () => Object.getOwnPropertySymbols(a, A[16])); say('Object.getOwnPropertySymbols(object, a)', () => Object.getOwnPropertySymbols(A[19], a)); }
say('Object.getOwnPropertySymbols()', () => Object.getOwnPropertySymbols());
for (const a of A) { say('Object.assign(a)', () => Object.assign(a)); say('Object.assign(a, list)', () => Object.assign(a, A[16])); say('Object.assign(object, a)', () => Object.assign(A[19], a)); }
say('Object.assign()', () => Object.assign());
for (const a of A) { say('Object.create(a)', () => Object.create(a)); say('Object.create(a, list)', () => Object.create(a, A[16])); say('Object.create(object, a)', () => Object.create(A[19], a)); }
say('Object.create()', () => Object.create());
for (const a of A) { say('Object.fromEntries(a)', () => Object.fromEntries(a)); say('Object.fromEntries(a, list)', () => Object.fromEntries(a, A[16])); say('Object.fromEntries(object, a)', () => Object.fromEntries(A[19], a)); }
say('Object.fromEntries()', () => Object.fromEntries());
for (const a of A) { say('Object.groupBy(a)', () => Object.groupBy(a)); say('Object.groupBy(a, list)', () => Object.groupBy(a, A[16])); say('Object.groupBy(object, a)', () => Object.groupBy(A[19], a)); }
say('Object.groupBy()', () => Object.groupBy());
for (const a of A) { say('Object.is(a)', () => Object.is(a)); say('Object.is(a, list)', () => Object.is(a, A[16])); say('Object.is(object, a)', () => Object.is(A[19], a)); }
say('Object.is()', () => Object.is());
for (const a of A) { say('Object.isFrozen(a)', () => Object.isFrozen(a)); say('Object.isFrozen(a, list)', () => Object.isFrozen(a, A[16])); say('Object.isFrozen(object, a)', () => Object.isFrozen(A[19], a)); }
say('Object.isFrozen()', () => Object.isFrozen());
for (const a of A) { say('Object.isSealed(a)', () => Object.isSealed(a)); say('Object.isSealed(a, list)', () => Object.isSealed(a, A[16])); say('Object.isSealed(object, a)', () => Object.isSealed(A[19], a)); }
say('Object.isSealed()', () => Object.isSealed());
for (const a of A) { say('Object.isExtensible(a)', () => Object.isExtensible(a)); say('Object.isExtensible(a, list)', () => Object.isExtensible(a, A[16])); say('Object.isExtensible(object, a)', () => Object.isExtensible(A[19], a)); }
say('Object.isExtensible()', () => Object.isExtensible());
for (const a of A) { say('Object.hasOwn(a)', () => Object.hasOwn(a)); say('Object.hasOwn(a, list)', () => Object.hasOwn(a, A[16])); say('Object.hasOwn(object, a)', () => Object.hasOwn(A[19], a)); }
say('Object.hasOwn()', () => Object.hasOwn());
for (const a of A) { say('Object.getPrototypeOf(a)', () => Object.getPrototypeOf(a)); say('Object.getPrototypeOf(a, list)', () => Object.getPrototypeOf(a, A[16])); say('Object.getPrototypeOf(object, a)', () => Object.getPrototypeOf(A[19], a)); }
say('Object.getPrototypeOf()', () => Object.getPrototypeOf());
for (const a of A) { say('Object.getOwnPropertyDescriptor(a)', () => Object.getOwnPropertyDescriptor(a)); say('Object.getOwnPropertyDescriptor(a, list)', () => Object.getOwnPropertyDescriptor(a, A[16])); say('Object.getOwnPropertyDescriptor(object, a)', () => Object.getOwnPropertyDescriptor(A[19], a)); }
say('Object.getOwnPropertyDescriptor()', () => Object.getOwnPropertyDescriptor());
for (const a of A) { say('Object.getOwnPropertyDescriptors(a)', () => Object.getOwnPropertyDescriptors(a)); say('Object.getOwnPropertyDescriptors(a, list)', () => Object.getOwnPropertyDescriptors(a, A[16])); say('Object.getOwnPropertyDescriptors(object, a)', () => Object.getOwnPropertyDescriptors(A[19], a)); }
say('Object.getOwnPropertyDescriptors()', () => Object.getOwnPropertyDescriptors());
for (const a of A) { say('Object.defineProperty(a)', () => Object.defineProperty(a)); say('Object.defineProperty(a, list)', () => Object.defineProperty(a, A[16])); say('Object.defineProperty(object, a)', () => Object.defineProperty(A[19], a)); }
say('Object.defineProperty()', () => Object.defineProperty());
for (const a of A) { say('Object.defineProperties(a)', () => Object.defineProperties(a)); say('Object.defineProperties(a, list)', () => Object.defineProperties(a, A[16])); say('Object.defineProperties(object, a)', () => Object.defineProperties(A[19], a)); }
say('Object.defineProperties()', () => Object.defineProperties());
for (const a of A) { say('Array.isArray(a)', () => Array.isArray(a)); say('Array.isArray(a, list)', () => Array.isArray(a, A[16])); say('Array.isArray(object, a)', () => Array.isArray(A[19], a)); }
say('Array.isArray()', () => Array.isArray());
for (const a of A) { say('Array.from(a)', () => Array.from(a)); say('Array.from(a, list)', () => Array.from(a, A[16])); say('Array.from(object, a)', () => Array.from(A[19], a)); }
say('Array.from()', () => Array.from());
for (const a of A) { say('Array.of(a)', () => Array.of(a)); say('Array.of(a, list)', () => Array.of(a, A[16])); say('Array.of(object, a)', () => Array.of(A[19], a)); }
say('Array.of()', () => Array.of());
for (const a of A) { say('Math.abs(a)', () => Math.abs(a)); say('Math.abs(a, list)', () => Math.abs(a, A[16])); say('Math.abs(object, a)', () => Math.abs(A[19], a)); }
say('Math.abs()', () => Math.abs());
for (const a of A) { say('Math.acos(a)', () => Math.acos(a)); say('Math.acos(a, list)', () => Math.acos(a, A[16])); say('Math.acos(object, a)', () => Math.acos(A[19], a)); }
say('Math.acos()', () => Math.acos());
for (const a of A) { say('Math.acosh(a)', () => Math.acosh(a)); say('Math.acosh(a, list)', () => Math.acosh(a, A[16])); say('Math.acosh(object, a)', () => Math.acosh(A[19], a)); }
say('Math.acosh()', () => Math.acosh());
for (const a of A) { say('Math.asin(a)', () => Math.asin(a)); say('Math.asin(a, list)', () => Math.asin(a, A[16])); say('Math.asin(object, a)', () => Math.asin(A[19], a)); }
say('Math.asin()', () => Math.asin());
for (const a of A) { say('Math.asinh(a)', () => Math.asinh(a)); say('Math.asinh(a, list)', () => Math.asinh(a, A[16])); say('Math.asinh(object, a)', () => Math.asinh(A[19], a)); }
say('Math.asinh()', () => Math.asinh());
console.log(out.length + " calls, " + failures + " threw");
let h = 0; for (const l of out) for (let i = 0; i < l.length; i++) h = (h * 31 + l.charCodeAt(i)) | 0;
console.log("hash " + h);
console.log(out.join("\n"));
