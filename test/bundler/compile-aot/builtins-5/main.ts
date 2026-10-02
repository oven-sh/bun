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

function onNumber_toPrecision(r: number, a: any, b: any) { return (r as any).toPrecision(a, b); }
function onNumber_toPrecision0(r: number) { return (r as any).toPrecision(); }
for (const r of [0, 1.5, -7, NaN, 1e21, 255]) { say('Number.toPrecision()', () => onNumber_toPrecision0(r)); for (const a of A) { say('Number.toPrecision(a)', () => onNumber_toPrecision(r, a, undefined)); say('Number.toPrecision(a, s)', () => onNumber_toPrecision(r, a, A[9])); say('Number.toPrecision(1, a)', () => onNumber_toPrecision(r, 1, a)); } }
function onNumber_toExponential(r: number, a: any, b: any) { return (r as any).toExponential(a, b); }
function onNumber_toExponential0(r: number) { return (r as any).toExponential(); }
for (const r of [0, 1.5, -7, NaN, 1e21, 255]) { say('Number.toExponential()', () => onNumber_toExponential0(r)); for (const a of A) { say('Number.toExponential(a)', () => onNumber_toExponential(r, a, undefined)); say('Number.toExponential(a, s)', () => onNumber_toExponential(r, a, A[9])); say('Number.toExponential(1, a)', () => onNumber_toExponential(r, 1, a)); } }
function onNumber_toLocaleString(r: number, a: any, b: any) { return (r as any).toLocaleString(a, b); }
function onNumber_toLocaleString0(r: number) { return (r as any).toLocaleString(); }
for (const r of [0, 1.5, -7, NaN, 1e21, 255]) { say('Number.toLocaleString()', () => onNumber_toLocaleString0(r)); for (const a of A) { say('Number.toLocaleString(a)', () => onNumber_toLocaleString(r, a, undefined)); say('Number.toLocaleString(a, s)', () => onNumber_toLocaleString(r, a, A[9])); say('Number.toLocaleString(1, a)', () => onNumber_toLocaleString(r, 1, a)); } }
function onNumber_valueOf(r: number, a: any, b: any) { return (r as any).valueOf(a, b); }
function onNumber_valueOf0(r: number) { return (r as any).valueOf(); }
for (const r of [0, 1.5, -7, NaN, 1e21, 255]) { say('Number.valueOf()', () => onNumber_valueOf0(r)); for (const a of A) { say('Number.valueOf(a)', () => onNumber_valueOf(r, a, undefined)); say('Number.valueOf(a, s)', () => onNumber_valueOf(r, a, A[9])); say('Number.valueOf(1, a)', () => onNumber_valueOf(r, 1, a)); } }
function onBoolean_toString(r: boolean, a: any, b: any) { return (r as any).toString(a, b); }
function onBoolean_toString0(r: boolean) { return (r as any).toString(); }
for (const r of [true, false]) { say('Boolean.toString()', () => onBoolean_toString0(r)); for (const a of A) { say('Boolean.toString(a)', () => onBoolean_toString(r, a, undefined)); say('Boolean.toString(a, s)', () => onBoolean_toString(r, a, A[9])); say('Boolean.toString(1, a)', () => onBoolean_toString(r, 1, a)); } }
function onBoolean_valueOf(r: boolean, a: any, b: any) { return (r as any).valueOf(a, b); }
function onBoolean_valueOf0(r: boolean) { return (r as any).valueOf(); }
for (const r of [true, false]) { say('Boolean.valueOf()', () => onBoolean_valueOf0(r)); for (const a of A) { say('Boolean.valueOf(a)', () => onBoolean_valueOf(r, a, undefined)); say('Boolean.valueOf(a, s)', () => onBoolean_valueOf(r, a, A[9])); say('Boolean.valueOf(1, a)', () => onBoolean_valueOf(r, 1, a)); } }
function onSymbol_toString(r: symbol, a: any, b: any) { return (r as any).toString(a, b); }
function onSymbol_toString0(r: symbol) { return (r as any).toString(); }
for (const r of [Symbol("d"), Symbol.iterator]) { say('Symbol.toString()', () => onSymbol_toString0(r)); for (const a of A) { say('Symbol.toString(a)', () => onSymbol_toString(r, a, undefined)); say('Symbol.toString(a, s)', () => onSymbol_toString(r, a, A[9])); say('Symbol.toString(1, a)', () => onSymbol_toString(r, 1, a)); } }
function onSymbol_valueOf(r: symbol, a: any, b: any) { return (r as any).valueOf(a, b); }
function onSymbol_valueOf0(r: symbol) { return (r as any).valueOf(); }
for (const r of [Symbol("d"), Symbol.iterator]) { say('Symbol.valueOf()', () => onSymbol_valueOf0(r)); for (const a of A) { say('Symbol.valueOf(a)', () => onSymbol_valueOf(r, a, undefined)); say('Symbol.valueOf(a, s)', () => onSymbol_valueOf(r, a, A[9])); say('Symbol.valueOf(1, a)', () => onSymbol_valueOf(r, 1, a)); } }
function onBigInt_toString(r: bigint, a: any, b: any) { return (r as any).toString(a, b); }
function onBigInt_toString0(r: bigint) { return (r as any).toString(); }
for (const r of [0n, -12345678901234567890n]) { say('BigInt.toString()', () => onBigInt_toString0(r)); for (const a of A) { say('BigInt.toString(a)', () => onBigInt_toString(r, a, undefined)); say('BigInt.toString(a, s)', () => onBigInt_toString(r, a, A[9])); say('BigInt.toString(1, a)', () => onBigInt_toString(r, 1, a)); } }
function onBigInt_toLocaleString(r: bigint, a: any, b: any) { return (r as any).toLocaleString(a, b); }
function onBigInt_toLocaleString0(r: bigint) { return (r as any).toLocaleString(); }
for (const r of [0n, -12345678901234567890n]) { say('BigInt.toLocaleString()', () => onBigInt_toLocaleString0(r)); for (const a of A) { say('BigInt.toLocaleString(a)', () => onBigInt_toLocaleString(r, a, undefined)); say('BigInt.toLocaleString(a, s)', () => onBigInt_toLocaleString(r, a, A[9])); say('BigInt.toLocaleString(1, a)', () => onBigInt_toLocaleString(r, 1, a)); } }
function onBigInt_valueOf(r: bigint, a: any, b: any) { return (r as any).valueOf(a, b); }
function onBigInt_valueOf0(r: bigint) { return (r as any).valueOf(); }
for (const r of [0n, -12345678901234567890n]) { say('BigInt.valueOf()', () => onBigInt_valueOf0(r)); for (const a of A) { say('BigInt.valueOf(a)', () => onBigInt_valueOf(r, a, undefined)); say('BigInt.valueOf(a, s)', () => onBigInt_valueOf(r, a, A[9])); say('BigInt.valueOf(1, a)', () => onBigInt_valueOf(r, 1, a)); } }
say('new Object()', () => new Object());
for (const a of A) { say('new Object(a)', () => new (Object as any)(a)); say('new Object(a, a)', () => new (Object as any)(a, a)); }
say('new Array()', () => new Array());
for (const a of A) { say('new Array(a)', () => new (Array as any)(a)); say('new Array(a, a)', () => new (Array as any)(a, a)); }
say('new Function()', () => new Function());
for (const a of A) { say('new Function(a)', () => new (Function as any)(a)); say('new Function(a, a)', () => new (Function as any)(a, a)); }
say('new Map()', () => new Map());
for (const a of A) { say('new Map(a)', () => new (Map as any)(a)); say('new Map(a, a)', () => new (Map as any)(a, a)); }
say('new Set()', () => new Set());
for (const a of A) { say('new Set(a)', () => new (Set as any)(a)); say('new Set(a, a)', () => new (Set as any)(a, a)); }
say('new WeakMap()', () => new WeakMap());
for (const a of A) { say('new WeakMap(a)', () => new (WeakMap as any)(a)); say('new WeakMap(a, a)', () => new (WeakMap as any)(a, a)); }
say('new WeakSet()', () => new WeakSet());
for (const a of A) { say('new WeakSet(a)', () => new (WeakSet as any)(a)); say('new WeakSet(a, a)', () => new (WeakSet as any)(a, a)); }
say('new WeakRef()', () => new WeakRef());
for (const a of A) { say('new WeakRef(a)', () => new (WeakRef as any)(a)); say('new WeakRef(a, a)', () => new (WeakRef as any)(a, a)); }
say('new RegExp()', () => new RegExp());
for (const a of A) { say('new RegExp(a)', () => new (RegExp as any)(a)); say('new RegExp(a, a)', () => new (RegExp as any)(a, a)); }
say('new Promise()', () => new Promise());
for (const a of A) { say('new Promise(a)', () => new (Promise as any)(a)); say('new Promise(a, a)', () => new (Promise as any)(a, a)); }
say('new Date()', () => new Date());
for (const a of A) { say('new Date(a)', () => new (Date as any)(a)); say('new Date(a, a)', () => new (Date as any)(a, a)); }
say('new Error()', () => new Error());
for (const a of A) { say('new Error(a)', () => new (Error as any)(a)); say('new Error(a, a)', () => new (Error as any)(a, a)); }
say('new TypeError()', () => new TypeError());
for (const a of A) { say('new TypeError(a)', () => new (TypeError as any)(a)); say('new TypeError(a, a)', () => new (TypeError as any)(a, a)); }
say('new RangeError()', () => new RangeError());
for (const a of A) { say('new RangeError(a)', () => new (RangeError as any)(a)); say('new RangeError(a, a)', () => new (RangeError as any)(a, a)); }
say('new SyntaxError()', () => new SyntaxError());
for (const a of A) { say('new SyntaxError(a)', () => new (SyntaxError as any)(a)); say('new SyntaxError(a, a)', () => new (SyntaxError as any)(a, a)); }
say('new ReferenceError()', () => new ReferenceError());
for (const a of A) { say('new ReferenceError(a)', () => new (ReferenceError as any)(a)); say('new ReferenceError(a, a)', () => new (ReferenceError as any)(a, a)); }
say('new EvalError()', () => new EvalError());
for (const a of A) { say('new EvalError(a)', () => new (EvalError as any)(a)); say('new EvalError(a, a)', () => new (EvalError as any)(a, a)); }
say('new URIError()', () => new URIError());
for (const a of A) { say('new URIError(a)', () => new (URIError as any)(a)); say('new URIError(a, a)', () => new (URIError as any)(a, a)); }
say('new AggregateError()', () => new AggregateError());
for (const a of A) { say('new AggregateError(a)', () => new (AggregateError as any)(a)); say('new AggregateError(a, a)', () => new (AggregateError as any)(a, a)); }
say('new ArrayBuffer()', () => new ArrayBuffer());
for (const a of A) { say('new ArrayBuffer(a)', () => new (ArrayBuffer as any)(a)); say('new ArrayBuffer(a, a)', () => new (ArrayBuffer as any)(a, a)); }
say('new SharedArrayBuffer()', () => new SharedArrayBuffer());
for (const a of A) { say('new SharedArrayBuffer(a)', () => new (SharedArrayBuffer as any)(a)); say('new SharedArrayBuffer(a, a)', () => new (SharedArrayBuffer as any)(a, a)); }
say('new DataView()', () => new DataView());
for (const a of A) { say('new DataView(a)', () => new (DataView as any)(a)); say('new DataView(a, a)', () => new (DataView as any)(a, a)); }
say('new String()', () => new String());
for (const a of A) { say('new String(a)', () => new (String as any)(a)); say('new String(a, a)', () => new (String as any)(a, a)); }
say('new Number()', () => new Number());
for (const a of A) { say('new Number(a)', () => new (Number as any)(a)); say('new Number(a, a)', () => new (Number as any)(a, a)); }
say('new Boolean()', () => new Boolean());
for (const a of A) { say('new Boolean(a)', () => new (Boolean as any)(a)); say('new Boolean(a, a)', () => new (Boolean as any)(a, a)); }
class Sub extends Map { get(k: any) { return "overridden"; } }
say("a subclass", () => new Sub().get(1));
say("Reflect.construct", () => Reflect.construct(Map, [], Sub));
console.log(out.length + " calls, " + failures + " threw");
let h = 0; for (const l of out) for (let i = 0; i < l.length; i++) h = (h * 31 + l.charCodeAt(i)) | 0;
console.log("hash " + h);
console.log(out.join("\n"));
