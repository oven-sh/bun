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

for (const a of A) { say('Reflect.deleteProperty(a)', () => Reflect.deleteProperty(a)); say('Reflect.deleteProperty(a, list)', () => Reflect.deleteProperty(a, A[16])); say('Reflect.deleteProperty(object, a)', () => Reflect.deleteProperty(A[19], a)); }
say('Reflect.deleteProperty()', () => Reflect.deleteProperty());
for (const a of A) { say('Reflect.isExtensible(a)', () => Reflect.isExtensible(a)); say('Reflect.isExtensible(a, list)', () => Reflect.isExtensible(a, A[16])); say('Reflect.isExtensible(object, a)', () => Reflect.isExtensible(A[19], a)); }
say('Reflect.isExtensible()', () => Reflect.isExtensible());
for (const a of A) { say('Reflect.preventExtensions(a)', () => Reflect.preventExtensions(a)); say('Reflect.preventExtensions(a, list)', () => Reflect.preventExtensions(a, A[16])); say('Reflect.preventExtensions(object, a)', () => Reflect.preventExtensions(A[19], a)); }
say('Reflect.preventExtensions()', () => Reflect.preventExtensions());
for (const a of A) { say('Reflect.setPrototypeOf(a)', () => Reflect.setPrototypeOf(a)); say('Reflect.setPrototypeOf(a, list)', () => Reflect.setPrototypeOf(a, A[16])); say('Reflect.setPrototypeOf(object, a)', () => Reflect.setPrototypeOf(A[19], a)); }
say('Reflect.setPrototypeOf()', () => Reflect.setPrototypeOf());
for (const a of A) { say('Reflect.ownKeys(a)', () => Reflect.ownKeys(a)); say('Reflect.ownKeys(a, list)', () => Reflect.ownKeys(a, A[16])); say('Reflect.ownKeys(object, a)', () => Reflect.ownKeys(A[19], a)); }
say('Reflect.ownKeys()', () => Reflect.ownKeys());
for (const a of A) { say('Reflect.getPrototypeOf(a)', () => Reflect.getPrototypeOf(a)); say('Reflect.getPrototypeOf(a, list)', () => Reflect.getPrototypeOf(a, A[16])); say('Reflect.getPrototypeOf(object, a)', () => Reflect.getPrototypeOf(A[19], a)); }
say('Reflect.getPrototypeOf()', () => Reflect.getPrototypeOf());
for (const a of A) { say('Reflect.getOwnPropertyDescriptor(a)', () => Reflect.getOwnPropertyDescriptor(a)); say('Reflect.getOwnPropertyDescriptor(a, list)', () => Reflect.getOwnPropertyDescriptor(a, A[16])); say('Reflect.getOwnPropertyDescriptor(object, a)', () => Reflect.getOwnPropertyDescriptor(A[19], a)); }
say('Reflect.getOwnPropertyDescriptor()', () => Reflect.getOwnPropertyDescriptor());
for (const a of A) { say('ArrayBuffer.isView(a)', () => ArrayBuffer.isView(a)); say('ArrayBuffer.isView(a, list)', () => ArrayBuffer.isView(a, A[16])); say('ArrayBuffer.isView(object, a)', () => ArrayBuffer.isView(A[19], a)); }
say('ArrayBuffer.isView()', () => ArrayBuffer.isView());
say("Array.from on another", () => Array.from.call(OtherArray, [1, 2]));
say("Array.of on another", () => Array.of.call(OtherArray, 1, 2));
say("Array.from on nothing", () => (0, Array.from)([1, 2]));
function onString_at(r: string, a: any, b: any) { return (r as any).at(a, b); }
function onString_at0(r: string) { return (r as any).at(); }
for (const r of ["", "abc", "a,b,c", "  pad  ", "\ud800"]) { say('String.at()', () => onString_at0(r)); for (const a of A) { say('String.at(a)', () => onString_at(r, a, undefined)); say('String.at(a, s)', () => onString_at(r, a, A[9])); say('String.at(1, a)', () => onString_at(r, 1, a)); } }
function onString_charAt(r: string, a: any, b: any) { return (r as any).charAt(a, b); }
function onString_charAt0(r: string) { return (r as any).charAt(); }
for (const r of ["", "abc", "a,b,c", "  pad  ", "\ud800"]) { say('String.charAt()', () => onString_charAt0(r)); for (const a of A) { say('String.charAt(a)', () => onString_charAt(r, a, undefined)); say('String.charAt(a, s)', () => onString_charAt(r, a, A[9])); say('String.charAt(1, a)', () => onString_charAt(r, 1, a)); } }
function onString_charCodeAt(r: string, a: any, b: any) { return (r as any).charCodeAt(a, b); }
function onString_charCodeAt0(r: string) { return (r as any).charCodeAt(); }
for (const r of ["", "abc", "a,b,c", "  pad  ", "\ud800"]) { say('String.charCodeAt()', () => onString_charCodeAt0(r)); for (const a of A) { say('String.charCodeAt(a)', () => onString_charCodeAt(r, a, undefined)); say('String.charCodeAt(a, s)', () => onString_charCodeAt(r, a, A[9])); say('String.charCodeAt(1, a)', () => onString_charCodeAt(r, 1, a)); } }
function onString_codePointAt(r: string, a: any, b: any) { return (r as any).codePointAt(a, b); }
function onString_codePointAt0(r: string) { return (r as any).codePointAt(); }
for (const r of ["", "abc", "a,b,c", "  pad  ", "\ud800"]) { say('String.codePointAt()', () => onString_codePointAt0(r)); for (const a of A) { say('String.codePointAt(a)', () => onString_codePointAt(r, a, undefined)); say('String.codePointAt(a, s)', () => onString_codePointAt(r, a, A[9])); say('String.codePointAt(1, a)', () => onString_codePointAt(r, 1, a)); } }
function onString_concat(r: string, a: any, b: any) { return (r as any).concat(a, b); }
function onString_concat0(r: string) { return (r as any).concat(); }
for (const r of ["", "abc", "a,b,c", "  pad  ", "\ud800"]) { say('String.concat()', () => onString_concat0(r)); for (const a of A) { say('String.concat(a)', () => onString_concat(r, a, undefined)); say('String.concat(a, s)', () => onString_concat(r, a, A[9])); say('String.concat(1, a)', () => onString_concat(r, 1, a)); } }
function onString_endsWith(r: string, a: any, b: any) { return (r as any).endsWith(a, b); }
function onString_endsWith0(r: string) { return (r as any).endsWith(); }
for (const r of ["", "abc", "a,b,c", "  pad  ", "\ud800"]) { say('String.endsWith()', () => onString_endsWith0(r)); for (const a of A) { say('String.endsWith(a)', () => onString_endsWith(r, a, undefined)); say('String.endsWith(a, s)', () => onString_endsWith(r, a, A[9])); say('String.endsWith(1, a)', () => onString_endsWith(r, 1, a)); } }
function onString_includes(r: string, a: any, b: any) { return (r as any).includes(a, b); }
function onString_includes0(r: string) { return (r as any).includes(); }
for (const r of ["", "abc", "a,b,c", "  pad  ", "\ud800"]) { say('String.includes()', () => onString_includes0(r)); for (const a of A) { say('String.includes(a)', () => onString_includes(r, a, undefined)); say('String.includes(a, s)', () => onString_includes(r, a, A[9])); say('String.includes(1, a)', () => onString_includes(r, 1, a)); } }
function onString_indexOf(r: string, a: any, b: any) { return (r as any).indexOf(a, b); }
function onString_indexOf0(r: string) { return (r as any).indexOf(); }
for (const r of ["", "abc", "a,b,c", "  pad  ", "\ud800"]) { say('String.indexOf()', () => onString_indexOf0(r)); for (const a of A) { say('String.indexOf(a)', () => onString_indexOf(r, a, undefined)); say('String.indexOf(a, s)', () => onString_indexOf(r, a, A[9])); say('String.indexOf(1, a)', () => onString_indexOf(r, 1, a)); } }
function onString_isWellFormed(r: string, a: any, b: any) { return (r as any).isWellFormed(a, b); }
function onString_isWellFormed0(r: string) { return (r as any).isWellFormed(); }
for (const r of ["", "abc", "a,b,c", "  pad  ", "\ud800"]) { say('String.isWellFormed()', () => onString_isWellFormed0(r)); for (const a of A) { say('String.isWellFormed(a)', () => onString_isWellFormed(r, a, undefined)); say('String.isWellFormed(a, s)', () => onString_isWellFormed(r, a, A[9])); say('String.isWellFormed(1, a)', () => onString_isWellFormed(r, 1, a)); } }
function onString_lastIndexOf(r: string, a: any, b: any) { return (r as any).lastIndexOf(a, b); }
function onString_lastIndexOf0(r: string) { return (r as any).lastIndexOf(); }
for (const r of ["", "abc", "a,b,c", "  pad  ", "\ud800"]) { say('String.lastIndexOf()', () => onString_lastIndexOf0(r)); for (const a of A) { say('String.lastIndexOf(a)', () => onString_lastIndexOf(r, a, undefined)); say('String.lastIndexOf(a, s)', () => onString_lastIndexOf(r, a, A[9])); say('String.lastIndexOf(1, a)', () => onString_lastIndexOf(r, 1, a)); } }
function onString_localeCompare(r: string, a: any, b: any) { return (r as any).localeCompare(a, b); }
function onString_localeCompare0(r: string) { return (r as any).localeCompare(); }
for (const r of ["", "abc", "a,b,c", "  pad  ", "\ud800"]) { say('String.localeCompare()', () => onString_localeCompare0(r)); for (const a of A) { say('String.localeCompare(a)', () => onString_localeCompare(r, a, undefined)); say('String.localeCompare(a, s)', () => onString_localeCompare(r, a, A[9])); say('String.localeCompare(1, a)', () => onString_localeCompare(r, 1, a)); } }
function onString_normalize(r: string, a: any, b: any) { return (r as any).normalize(a, b); }
function onString_normalize0(r: string) { return (r as any).normalize(); }
for (const r of ["", "abc", "a,b,c", "  pad  ", "\ud800"]) { say('String.normalize()', () => onString_normalize0(r)); for (const a of A) { say('String.normalize(a)', () => onString_normalize(r, a, undefined)); say('String.normalize(a, s)', () => onString_normalize(r, a, A[9])); say('String.normalize(1, a)', () => onString_normalize(r, 1, a)); } }
function onString_padEnd(r: string, a: any, b: any) { return (r as any).padEnd(a, b); }
function onString_padEnd0(r: string) { return (r as any).padEnd(); }
for (const r of ["", "abc", "a,b,c", "  pad  ", "\ud800"]) { say('String.padEnd()', () => onString_padEnd0(r)); for (const a of A) { say('String.padEnd(a)', () => onString_padEnd(r, a, undefined)); say('String.padEnd(a, s)', () => onString_padEnd(r, a, A[9])); say('String.padEnd(1, a)', () => onString_padEnd(r, 1, a)); } }
function onString_padStart(r: string, a: any, b: any) { return (r as any).padStart(a, b); }
function onString_padStart0(r: string) { return (r as any).padStart(); }
for (const r of ["", "abc", "a,b,c", "  pad  ", "\ud800"]) { say('String.padStart()', () => onString_padStart0(r)); for (const a of A) { say('String.padStart(a)', () => onString_padStart(r, a, undefined)); say('String.padStart(a, s)', () => onString_padStart(r, a, A[9])); say('String.padStart(1, a)', () => onString_padStart(r, 1, a)); } }
function onString_repeat(r: string, a: any, b: any) { return (r as any).repeat(a, b); }
function onString_repeat0(r: string) { return (r as any).repeat(); }
for (const r of ["", "abc", "a,b,c", "  pad  ", "\ud800"]) { say('String.repeat()', () => onString_repeat0(r)); for (const a of A) { say('String.repeat(a)', () => onString_repeat(r, a, undefined)); say('String.repeat(a, s)', () => onString_repeat(r, a, A[9])); say('String.repeat(1, a)', () => onString_repeat(r, 1, a)); } }
function onString_slice(r: string, a: any, b: any) { return (r as any).slice(a, b); }
function onString_slice0(r: string) { return (r as any).slice(); }
for (const r of ["", "abc", "a,b,c", "  pad  ", "\ud800"]) { say('String.slice()', () => onString_slice0(r)); for (const a of A) { say('String.slice(a)', () => onString_slice(r, a, undefined)); say('String.slice(a, s)', () => onString_slice(r, a, A[9])); say('String.slice(1, a)', () => onString_slice(r, 1, a)); } }
console.log(out.length + " calls, " + failures + " threw");
let h = 0; for (const l of out) for (let i = 0; i < l.length; i++) h = (h * 31 + l.charCodeAt(i)) | 0;
console.log("hash " + h);
console.log(out.join("\n"));
