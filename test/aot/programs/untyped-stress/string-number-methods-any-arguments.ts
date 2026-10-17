// Methods of String.prototype and Number.prototype called with arguments of every kind of value, among them proxies, objects with Symbol.toPrimitive and values whose conversion throws.
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

function onString_startsWith(r: string, a: any, b: any) { return (r as any).startsWith(a, b); }
function onString_startsWith0(r: string) { return (r as any).startsWith(); }
for (const r of ["", "abc", "a,b,c", "  pad  ", "\ud800"]) { say('String.startsWith()', () => onString_startsWith0(r)); for (const a of A) { say('String.startsWith(a)', () => onString_startsWith(r, a, undefined)); say('String.startsWith(a, s)', () => onString_startsWith(r, a, A[9])); say('String.startsWith(1, a)', () => onString_startsWith(r, 1, a)); } }
function onString_substr(r: string, a: any, b: any) { return (r as any).substr(a, b); }
function onString_substr0(r: string) { return (r as any).substr(); }
for (const r of ["", "abc", "a,b,c", "  pad  ", "\ud800"]) { say('String.substr()', () => onString_substr0(r)); for (const a of A) { say('String.substr(a)', () => onString_substr(r, a, undefined)); say('String.substr(a, s)', () => onString_substr(r, a, A[9])); say('String.substr(1, a)', () => onString_substr(r, 1, a)); } }
function onString_substring(r: string, a: any, b: any) { return (r as any).substring(a, b); }
function onString_substring0(r: string) { return (r as any).substring(); }
for (const r of ["", "abc", "a,b,c", "  pad  ", "\ud800"]) { say('String.substring()', () => onString_substring0(r)); for (const a of A) { say('String.substring(a)', () => onString_substring(r, a, undefined)); say('String.substring(a, s)', () => onString_substring(r, a, A[9])); say('String.substring(1, a)', () => onString_substring(r, 1, a)); } }
function onString_toLocaleLowerCase(r: string, a: any, b: any) { return (r as any).toLocaleLowerCase(a, b); }
function onString_toLocaleLowerCase0(r: string) { return (r as any).toLocaleLowerCase(); }
for (const r of ["", "abc", "a,b,c", "  pad  ", "\ud800"]) { say('String.toLocaleLowerCase()', () => onString_toLocaleLowerCase0(r)); for (const a of A) { say('String.toLocaleLowerCase(a)', () => onString_toLocaleLowerCase(r, a, undefined)); say('String.toLocaleLowerCase(a, s)', () => onString_toLocaleLowerCase(r, a, A[9])); say('String.toLocaleLowerCase(1, a)', () => onString_toLocaleLowerCase(r, 1, a)); } }
function onString_toLocaleUpperCase(r: string, a: any, b: any) { return (r as any).toLocaleUpperCase(a, b); }
function onString_toLocaleUpperCase0(r: string) { return (r as any).toLocaleUpperCase(); }
for (const r of ["", "abc", "a,b,c", "  pad  ", "\ud800"]) { say('String.toLocaleUpperCase()', () => onString_toLocaleUpperCase0(r)); for (const a of A) { say('String.toLocaleUpperCase(a)', () => onString_toLocaleUpperCase(r, a, undefined)); say('String.toLocaleUpperCase(a, s)', () => onString_toLocaleUpperCase(r, a, A[9])); say('String.toLocaleUpperCase(1, a)', () => onString_toLocaleUpperCase(r, 1, a)); } }
function onString_toLowerCase(r: string, a: any, b: any) { return (r as any).toLowerCase(a, b); }
function onString_toLowerCase0(r: string) { return (r as any).toLowerCase(); }
for (const r of ["", "abc", "a,b,c", "  pad  ", "\ud800"]) { say('String.toLowerCase()', () => onString_toLowerCase0(r)); for (const a of A) { say('String.toLowerCase(a)', () => onString_toLowerCase(r, a, undefined)); say('String.toLowerCase(a, s)', () => onString_toLowerCase(r, a, A[9])); say('String.toLowerCase(1, a)', () => onString_toLowerCase(r, 1, a)); } }
function onString_toString(r: string, a: any, b: any) { return (r as any).toString(a, b); }
function onString_toString0(r: string) { return (r as any).toString(); }
for (const r of ["", "abc", "a,b,c", "  pad  ", "\ud800"]) { say('String.toString()', () => onString_toString0(r)); for (const a of A) { say('String.toString(a)', () => onString_toString(r, a, undefined)); say('String.toString(a, s)', () => onString_toString(r, a, A[9])); say('String.toString(1, a)', () => onString_toString(r, 1, a)); } }
function onString_toUpperCase(r: string, a: any, b: any) { return (r as any).toUpperCase(a, b); }
function onString_toUpperCase0(r: string) { return (r as any).toUpperCase(); }
for (const r of ["", "abc", "a,b,c", "  pad  ", "\ud800"]) { say('String.toUpperCase()', () => onString_toUpperCase0(r)); for (const a of A) { say('String.toUpperCase(a)', () => onString_toUpperCase(r, a, undefined)); say('String.toUpperCase(a, s)', () => onString_toUpperCase(r, a, A[9])); say('String.toUpperCase(1, a)', () => onString_toUpperCase(r, 1, a)); } }
function onString_toWellFormed(r: string, a: any, b: any) { return (r as any).toWellFormed(a, b); }
function onString_toWellFormed0(r: string) { return (r as any).toWellFormed(); }
for (const r of ["", "abc", "a,b,c", "  pad  ", "\ud800"]) { say('String.toWellFormed()', () => onString_toWellFormed0(r)); for (const a of A) { say('String.toWellFormed(a)', () => onString_toWellFormed(r, a, undefined)); say('String.toWellFormed(a, s)', () => onString_toWellFormed(r, a, A[9])); say('String.toWellFormed(1, a)', () => onString_toWellFormed(r, 1, a)); } }
function onString_trim(r: string, a: any, b: any) { return (r as any).trim(a, b); }
function onString_trim0(r: string) { return (r as any).trim(); }
for (const r of ["", "abc", "a,b,c", "  pad  ", "\ud800"]) { say('String.trim()', () => onString_trim0(r)); for (const a of A) { say('String.trim(a)', () => onString_trim(r, a, undefined)); say('String.trim(a, s)', () => onString_trim(r, a, A[9])); say('String.trim(1, a)', () => onString_trim(r, 1, a)); } }
function onString_trimEnd(r: string, a: any, b: any) { return (r as any).trimEnd(a, b); }
function onString_trimEnd0(r: string) { return (r as any).trimEnd(); }
for (const r of ["", "abc", "a,b,c", "  pad  ", "\ud800"]) { say('String.trimEnd()', () => onString_trimEnd0(r)); for (const a of A) { say('String.trimEnd(a)', () => onString_trimEnd(r, a, undefined)); say('String.trimEnd(a, s)', () => onString_trimEnd(r, a, A[9])); say('String.trimEnd(1, a)', () => onString_trimEnd(r, 1, a)); } }
function onString_trimStart(r: string, a: any, b: any) { return (r as any).trimStart(a, b); }
function onString_trimStart0(r: string) { return (r as any).trimStart(); }
for (const r of ["", "abc", "a,b,c", "  pad  ", "\ud800"]) { say('String.trimStart()', () => onString_trimStart0(r)); for (const a of A) { say('String.trimStart(a)', () => onString_trimStart(r, a, undefined)); say('String.trimStart(a, s)', () => onString_trimStart(r, a, A[9])); say('String.trimStart(1, a)', () => onString_trimStart(r, 1, a)); } }
function onString_trimLeft(r: string, a: any, b: any) { return (r as any).trimLeft(a, b); }
function onString_trimLeft0(r: string) { return (r as any).trimLeft(); }
for (const r of ["", "abc", "a,b,c", "  pad  ", "\ud800"]) { say('String.trimLeft()', () => onString_trimLeft0(r)); for (const a of A) { say('String.trimLeft(a)', () => onString_trimLeft(r, a, undefined)); say('String.trimLeft(a, s)', () => onString_trimLeft(r, a, A[9])); say('String.trimLeft(1, a)', () => onString_trimLeft(r, 1, a)); } }
function onString_trimRight(r: string, a: any, b: any) { return (r as any).trimRight(a, b); }
function onString_trimRight0(r: string) { return (r as any).trimRight(); }
for (const r of ["", "abc", "a,b,c", "  pad  ", "\ud800"]) { say('String.trimRight()', () => onString_trimRight0(r)); for (const a of A) { say('String.trimRight(a)', () => onString_trimRight(r, a, undefined)); say('String.trimRight(a, s)', () => onString_trimRight(r, a, A[9])); say('String.trimRight(1, a)', () => onString_trimRight(r, 1, a)); } }
function onString_valueOf(r: string, a: any, b: any) { return (r as any).valueOf(a, b); }
function onString_valueOf0(r: string) { return (r as any).valueOf(); }
for (const r of ["", "abc", "a,b,c", "  pad  ", "\ud800"]) { say('String.valueOf()', () => onString_valueOf0(r)); for (const a of A) { say('String.valueOf(a)', () => onString_valueOf(r, a, undefined)); say('String.valueOf(a, s)', () => onString_valueOf(r, a, A[9])); say('String.valueOf(1, a)', () => onString_valueOf(r, 1, a)); } }
function onString_replace(r: string, a: any, b: any) { return (r as any).replace(a, b); }
function onString_replace0(r: string) { return (r as any).replace(); }
for (const r of ["", "abc", "a,b,c", "  pad  ", "\ud800"]) { say('String.replace()', () => onString_replace0(r)); for (const a of A) { say('String.replace(a)', () => onString_replace(r, a, undefined)); say('String.replace(a, s)', () => onString_replace(r, a, A[9])); say('String.replace(1, a)', () => onString_replace(r, 1, a)); } }
function onString_replaceAll(r: string, a: any, b: any) { return (r as any).replaceAll(a, b); }
function onString_replaceAll0(r: string) { return (r as any).replaceAll(); }
for (const r of ["", "abc", "a,b,c", "  pad  ", "\ud800"]) { say('String.replaceAll()', () => onString_replaceAll0(r)); for (const a of A) { say('String.replaceAll(a)', () => onString_replaceAll(r, a, undefined)); say('String.replaceAll(a, s)', () => onString_replaceAll(r, a, A[9])); say('String.replaceAll(1, a)', () => onString_replaceAll(r, 1, a)); } }
function onString_split(r: string, a: any, b: any) { return (r as any).split(a, b); }
function onString_split0(r: string) { return (r as any).split(); }
for (const r of ["", "abc", "a,b,c", "  pad  ", "\ud800"]) { say('String.split()', () => onString_split0(r)); for (const a of A) { say('String.split(a)', () => onString_split(r, a, undefined)); say('String.split(a, s)', () => onString_split(r, a, A[9])); say('String.split(1, a)', () => onString_split(r, 1, a)); } }
function onString_search(r: string, a: any, b: any) { return (r as any).search(a, b); }
function onString_search0(r: string) { return (r as any).search(); }
for (const r of ["", "abc", "a,b,c", "  pad  ", "\ud800"]) { say('String.search()', () => onString_search0(r)); for (const a of A) { say('String.search(a)', () => onString_search(r, a, undefined)); say('String.search(a, s)', () => onString_search(r, a, A[9])); say('String.search(1, a)', () => onString_search(r, 1, a)); } }
function onNumber_toFixed(r: number, a: any, b: any) { return (r as any).toFixed(a, b); }
function onNumber_toFixed0(r: number) { return (r as any).toFixed(); }
for (const r of [0, 1.5, -7, NaN, 1e21, 255]) { say('Number.toFixed()', () => onNumber_toFixed0(r)); for (const a of A) { say('Number.toFixed(a)', () => onNumber_toFixed(r, a, undefined)); say('Number.toFixed(a, s)', () => onNumber_toFixed(r, a, A[9])); say('Number.toFixed(1, a)', () => onNumber_toFixed(r, 1, a)); } }
function onNumber_toString(r: number, a: any, b: any) { return (r as any).toString(a, b); }
function onNumber_toString0(r: number) { return (r as any).toString(); }
for (const r of [0, 1.5, -7, NaN, 1e21, 255]) { say('Number.toString()', () => onNumber_toString0(r)); for (const a of A) { say('Number.toString(a)', () => onNumber_toString(r, a, undefined)); say('Number.toString(a, s)', () => onNumber_toString(r, a, A[9])); say('Number.toString(1, a)', () => onNumber_toString(r, 1, a)); } }
console.log(out.length + " calls, " + failures + " threw");
let h = 0; for (const l of out) for (let i = 0; i < l.length; i++) h = (h * 31 + l.charCodeAt(i)) | 0;
console.log("hash " + h);
console.log(out.join("\n"));
