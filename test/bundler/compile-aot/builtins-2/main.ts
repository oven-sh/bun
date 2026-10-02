process.on("unhandledRejection", () => {});
const out: string[] = [];
const describe = (x: any): string => { try { return x === null ? "null" : Array.isArray(x) ? "array(" + x.length + ")" : typeof x === "object" ? "object " + Object.prototype.toString.call(x) : typeof x === "function" ? "function" : typeof x + ":" + String(x); } catch (e: any) { return "indescribable " + e?.name; } };
let failures = 0;
const say = (name: string, f: () => unknown) => { let text: string; try { const r = f(); text = /^(Date|Math\.random|new Date)/.test(name) ? typeof r : describe(r); } catch (e: any) { text = "threw " + e?.name; failures++; } out.push(name + " = " + text); };
const own = (methods: any) => Object.assign(Object.create(null), methods);
class OtherArray { length = 0; }
const withText = <T,>(f: T): T => Object.defineProperty(f, "toString", { value: () => "return 1" }) as T;
const A: any[] = [
  undefined, null, true, 0, -1, 1.5, NaN, 2 ** 40, "", "abc", "a,b", "12px", 10n, Symbol("s"), Symbol.iterator,
  [], [1, 2, 3], [["k", "v"]], {}, { a: 1, b: "x" }, Object.create(null), withText(() => 1), withText(function named() {}), withText(class K {}),
  new Map([[1, 2]]), new Set([1]), /b/g, new Date(0), new Error("e"), new Proxy({ p: 1 }, {}), new Proxy([1], {}), new Proxy(function () {}, {}),
  { [Symbol.replace]: () => 42, [Symbol.split]: () => "not an array", [Symbol.search]: () => "not a number", [Symbol.match]: () => null },
  { valueOf: () => 7, toString: () => "seven" }, { toString: () => { throw new RangeError("no"); } }, { [Symbol.toPrimitive]: () => "prim" },
  new String("boxed"), new Number(5), new Uint8Array(2), new ArrayBuffer(4), Promise.resolve(1), { length: 2, 0: "x", 1: "y" }, { toJSON: () => undefined },
];

for (const a of A) { say('Math.atan(a)', () => Math.atan(a)); say('Math.atan(a, list)', () => Math.atan(a, A[16])); say('Math.atan(object, a)', () => Math.atan(A[19], a)); }
say('Math.atan()', () => Math.atan());
for (const a of A) { say('Math.atan2(a)', () => Math.atan2(a)); say('Math.atan2(a, list)', () => Math.atan2(a, A[16])); say('Math.atan2(object, a)', () => Math.atan2(A[19], a)); }
say('Math.atan2()', () => Math.atan2());
for (const a of A) { say('Math.atanh(a)', () => Math.atanh(a)); say('Math.atanh(a, list)', () => Math.atanh(a, A[16])); say('Math.atanh(object, a)', () => Math.atanh(A[19], a)); }
say('Math.atanh()', () => Math.atanh());
for (const a of A) { say('Math.cbrt(a)', () => Math.cbrt(a)); say('Math.cbrt(a, list)', () => Math.cbrt(a, A[16])); say('Math.cbrt(object, a)', () => Math.cbrt(A[19], a)); }
say('Math.cbrt()', () => Math.cbrt());
for (const a of A) { say('Math.ceil(a)', () => Math.ceil(a)); say('Math.ceil(a, list)', () => Math.ceil(a, A[16])); say('Math.ceil(object, a)', () => Math.ceil(A[19], a)); }
say('Math.ceil()', () => Math.ceil());
for (const a of A) { say('Math.clz32(a)', () => Math.clz32(a)); say('Math.clz32(a, list)', () => Math.clz32(a, A[16])); say('Math.clz32(object, a)', () => Math.clz32(A[19], a)); }
say('Math.clz32()', () => Math.clz32());
for (const a of A) { say('Math.cos(a)', () => Math.cos(a)); say('Math.cos(a, list)', () => Math.cos(a, A[16])); say('Math.cos(object, a)', () => Math.cos(A[19], a)); }
say('Math.cos()', () => Math.cos());
for (const a of A) { say('Math.cosh(a)', () => Math.cosh(a)); say('Math.cosh(a, list)', () => Math.cosh(a, A[16])); say('Math.cosh(object, a)', () => Math.cosh(A[19], a)); }
say('Math.cosh()', () => Math.cosh());
for (const a of A) { say('Math.exp(a)', () => Math.exp(a)); say('Math.exp(a, list)', () => Math.exp(a, A[16])); say('Math.exp(object, a)', () => Math.exp(A[19], a)); }
say('Math.exp()', () => Math.exp());
for (const a of A) { say('Math.expm1(a)', () => Math.expm1(a)); say('Math.expm1(a, list)', () => Math.expm1(a, A[16])); say('Math.expm1(object, a)', () => Math.expm1(A[19], a)); }
say('Math.expm1()', () => Math.expm1());
for (const a of A) { say('Math.floor(a)', () => Math.floor(a)); say('Math.floor(a, list)', () => Math.floor(a, A[16])); say('Math.floor(object, a)', () => Math.floor(A[19], a)); }
say('Math.floor()', () => Math.floor());
for (const a of A) { say('Math.fround(a)', () => Math.fround(a)); say('Math.fround(a, list)', () => Math.fround(a, A[16])); say('Math.fround(object, a)', () => Math.fround(A[19], a)); }
say('Math.fround()', () => Math.fround());
for (const a of A) { say('Math.hypot(a)', () => Math.hypot(a)); say('Math.hypot(a, list)', () => Math.hypot(a, A[16])); say('Math.hypot(object, a)', () => Math.hypot(A[19], a)); }
say('Math.hypot()', () => Math.hypot());
for (const a of A) { say('Math.imul(a)', () => Math.imul(a)); say('Math.imul(a, list)', () => Math.imul(a, A[16])); say('Math.imul(object, a)', () => Math.imul(A[19], a)); }
say('Math.imul()', () => Math.imul());
for (const a of A) { say('Math.log(a)', () => Math.log(a)); say('Math.log(a, list)', () => Math.log(a, A[16])); say('Math.log(object, a)', () => Math.log(A[19], a)); }
say('Math.log()', () => Math.log());
for (const a of A) { say('Math.log10(a)', () => Math.log10(a)); say('Math.log10(a, list)', () => Math.log10(a, A[16])); say('Math.log10(object, a)', () => Math.log10(A[19], a)); }
say('Math.log10()', () => Math.log10());
for (const a of A) { say('Math.log1p(a)', () => Math.log1p(a)); say('Math.log1p(a, list)', () => Math.log1p(a, A[16])); say('Math.log1p(object, a)', () => Math.log1p(A[19], a)); }
say('Math.log1p()', () => Math.log1p());
for (const a of A) { say('Math.log2(a)', () => Math.log2(a)); say('Math.log2(a, list)', () => Math.log2(a, A[16])); say('Math.log2(object, a)', () => Math.log2(A[19], a)); }
say('Math.log2()', () => Math.log2());
for (const a of A) { say('Math.max(a)', () => Math.max(a)); say('Math.max(a, list)', () => Math.max(a, A[16])); say('Math.max(object, a)', () => Math.max(A[19], a)); }
say('Math.max()', () => Math.max());
for (const a of A) { say('Math.min(a)', () => Math.min(a)); say('Math.min(a, list)', () => Math.min(a, A[16])); say('Math.min(object, a)', () => Math.min(A[19], a)); }
say('Math.min()', () => Math.min());
for (const a of A) { say('Math.pow(a)', () => Math.pow(a)); say('Math.pow(a, list)', () => Math.pow(a, A[16])); say('Math.pow(object, a)', () => Math.pow(A[19], a)); }
say('Math.pow()', () => Math.pow());
for (const a of A) { say('Math.random(a)', () => Math.random(a)); say('Math.random(a, list)', () => Math.random(a, A[16])); say('Math.random(object, a)', () => Math.random(A[19], a)); }
say('Math.random()', () => Math.random());
for (const a of A) { say('Math.round(a)', () => Math.round(a)); say('Math.round(a, list)', () => Math.round(a, A[16])); say('Math.round(object, a)', () => Math.round(A[19], a)); }
say('Math.round()', () => Math.round());
for (const a of A) { say('Math.sign(a)', () => Math.sign(a)); say('Math.sign(a, list)', () => Math.sign(a, A[16])); say('Math.sign(object, a)', () => Math.sign(A[19], a)); }
say('Math.sign()', () => Math.sign());
for (const a of A) { say('Math.sin(a)', () => Math.sin(a)); say('Math.sin(a, list)', () => Math.sin(a, A[16])); say('Math.sin(object, a)', () => Math.sin(A[19], a)); }
say('Math.sin()', () => Math.sin());
for (const a of A) { say('Math.sinh(a)', () => Math.sinh(a)); say('Math.sinh(a, list)', () => Math.sinh(a, A[16])); say('Math.sinh(object, a)', () => Math.sinh(A[19], a)); }
say('Math.sinh()', () => Math.sinh());
for (const a of A) { say('Math.sqrt(a)', () => Math.sqrt(a)); say('Math.sqrt(a, list)', () => Math.sqrt(a, A[16])); say('Math.sqrt(object, a)', () => Math.sqrt(A[19], a)); }
say('Math.sqrt()', () => Math.sqrt());
for (const a of A) { say('Math.tan(a)', () => Math.tan(a)); say('Math.tan(a, list)', () => Math.tan(a, A[16])); say('Math.tan(object, a)', () => Math.tan(A[19], a)); }
say('Math.tan()', () => Math.tan());
for (const a of A) { say('Math.tanh(a)', () => Math.tanh(a)); say('Math.tanh(a, list)', () => Math.tanh(a, A[16])); say('Math.tanh(object, a)', () => Math.tanh(A[19], a)); }
say('Math.tanh()', () => Math.tanh());
for (const a of A) { say('Math.trunc(a)', () => Math.trunc(a)); say('Math.trunc(a, list)', () => Math.trunc(a, A[16])); say('Math.trunc(object, a)', () => Math.trunc(A[19], a)); }
say('Math.trunc()', () => Math.trunc());
for (const a of A) { say('Number.isInteger(a)', () => Number.isInteger(a)); say('Number.isInteger(a, list)', () => Number.isInteger(a, A[16])); say('Number.isInteger(object, a)', () => Number.isInteger(A[19], a)); }
say('Number.isInteger()', () => Number.isInteger());
for (const a of A) { say('Number.isFinite(a)', () => Number.isFinite(a)); say('Number.isFinite(a, list)', () => Number.isFinite(a, A[16])); say('Number.isFinite(object, a)', () => Number.isFinite(A[19], a)); }
say('Number.isFinite()', () => Number.isFinite());
for (const a of A) { say('Number.isNaN(a)', () => Number.isNaN(a)); say('Number.isNaN(a, list)', () => Number.isNaN(a, A[16])); say('Number.isNaN(object, a)', () => Number.isNaN(A[19], a)); }
say('Number.isNaN()', () => Number.isNaN());
for (const a of A) { say('Number.isSafeInteger(a)', () => Number.isSafeInteger(a)); say('Number.isSafeInteger(a, list)', () => Number.isSafeInteger(a, A[16])); say('Number.isSafeInteger(object, a)', () => Number.isSafeInteger(A[19], a)); }
say('Number.isSafeInteger()', () => Number.isSafeInteger());
for (const a of A) { say('Number.parseFloat(a)', () => Number.parseFloat(a)); say('Number.parseFloat(a, list)', () => Number.parseFloat(a, A[16])); say('Number.parseFloat(object, a)', () => Number.parseFloat(A[19], a)); }
say('Number.parseFloat()', () => Number.parseFloat());
for (const a of A) { say('Number.parseInt(a)', () => Number.parseInt(a)); say('Number.parseInt(a, list)', () => Number.parseInt(a, A[16])); say('Number.parseInt(object, a)', () => Number.parseInt(A[19], a)); }
say('Number.parseInt()', () => Number.parseInt());
for (const a of A) { say('JSON.stringify(a)', () => JSON.stringify(a)); say('JSON.stringify(a, list)', () => JSON.stringify(a, A[16])); say('JSON.stringify(object, a)', () => JSON.stringify(A[19], a)); }
say('JSON.stringify()', () => JSON.stringify());
for (const a of A) { say('Date.now(a)', () => Date.now(a)); say('Date.now(a, list)', () => Date.now(a, A[16])); say('Date.now(object, a)', () => Date.now(A[19], a)); }
say('Date.now()', () => Date.now());
for (const a of A) { say('Date.parse(a)', () => Date.parse(a)); say('Date.parse(a, list)', () => Date.parse(a, A[16])); say('Date.parse(object, a)', () => Date.parse(A[19], a)); }
say('Date.parse()', () => Date.parse());
for (const a of A) { say('Date.UTC(a)', () => Date.UTC(a)); say('Date.UTC(a, list)', () => Date.UTC(a, A[16])); say('Date.UTC(object, a)', () => Date.UTC(A[19], a)); }
say('Date.UTC()', () => Date.UTC());
for (const a of A) { say('String.fromCharCode(a)', () => String.fromCharCode(a)); say('String.fromCharCode(a, list)', () => String.fromCharCode(a, A[16])); say('String.fromCharCode(object, a)', () => String.fromCharCode(A[19], a)); }
say('String.fromCharCode()', () => String.fromCharCode());
for (const a of A) { say('String.fromCodePoint(a)', () => String.fromCodePoint(a)); say('String.fromCodePoint(a, list)', () => String.fromCodePoint(a, A[16])); say('String.fromCodePoint(object, a)', () => String.fromCodePoint(A[19], a)); }
say('String.fromCodePoint()', () => String.fromCodePoint());
for (const a of A) { say('String.raw(a)', () => String.raw(a)); say('String.raw(a, list)', () => String.raw(a, A[16])); say('String.raw(object, a)', () => String.raw(A[19], a)); }
say('String.raw()', () => String.raw());
for (const a of A) { say('Symbol.for(a)', () => Symbol.for(a)); say('Symbol.for(a, list)', () => Symbol.for(a, A[16])); say('Symbol.for(object, a)', () => Symbol.for(A[19], a)); }
say('Symbol.for()', () => Symbol.for());
for (const a of A) { say('Symbol.keyFor(a)', () => Symbol.keyFor(a)); say('Symbol.keyFor(a, list)', () => Symbol.keyFor(a, A[16])); say('Symbol.keyFor(object, a)', () => Symbol.keyFor(A[19], a)); }
say('Symbol.keyFor()', () => Symbol.keyFor());
for (const a of A) { say('Reflect.has(a)', () => Reflect.has(a)); say('Reflect.has(a, list)', () => Reflect.has(a, A[16])); say('Reflect.has(object, a)', () => Reflect.has(A[19], a)); }
say('Reflect.has()', () => Reflect.has());
for (const a of A) { say('Reflect.set(a)', () => Reflect.set(a)); say('Reflect.set(a, list)', () => Reflect.set(a, A[16])); say('Reflect.set(object, a)', () => Reflect.set(A[19], a)); }
say('Reflect.set()', () => Reflect.set());
for (const a of A) { say('Reflect.defineProperty(a)', () => Reflect.defineProperty(a)); say('Reflect.defineProperty(a, list)', () => Reflect.defineProperty(a, A[16])); say('Reflect.defineProperty(object, a)', () => Reflect.defineProperty(A[19], a)); }
say('Reflect.defineProperty()', () => Reflect.defineProperty());
console.log(out.length + " calls, " + failures + " threw");
let h = 0; for (const l of out) for (let i = 0; i < l.length; i++) h = (h * 31 + l.charCodeAt(i)) | 0;
console.log("hash " + h);
console.log(out.join("\n"));
