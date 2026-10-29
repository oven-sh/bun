// `"" + x`, `x + ""`, templates and `String(x)` on values whose type is a union of primitives.
const values: any[] = ["", "a", "text", "€", "a" + Math.random().toString().slice(0, 0) + "b", 0, -0, 1, -1, 7, 255, 256, 65535, 2147483647, -2147483648, 2147483648, -2147483649, 4294967296, 9007199254740991, 1e21, 1e-7, 0.1, 1.5, -1.5, NaN, Infinity, -Infinity, 5.0, 10n, -10n, 10n ** 30n, true, false, null, undefined];
function stringOrNumber(x: string | number): string[] { return ["" + x, x + "", `${x}`, `<${x}>`, String(x), "k" + x + "k"]; }
function withBigInt(x: string | number | bigint): string[] { return ["" + x, x + "", `${x}`, `<${x}>`, String(x)]; }
function withBoolean(x: string | boolean): string[] { return ["" + x, x + "", `${x}`, String(x)]; }
function withNil(x: string | number | null | undefined): string[] { return ["" + x, x + "", `${x}`, String(x)]; }
function all(x: string | number | bigint | boolean | null | undefined): string[] { return ["" + x, x + "", `${x}`, String(x)]; }
function withSymbol(x: string | symbol): string { try { return `${x as any}`; } catch (e: any) { return e.name + ": " + e.message; } }
function anything(x: any): string[] { return ["" + x, x + "", `${x}`, String(x)]; }
function narrowed(x: unknown): string { return ("string" === typeof x && "" !== x) || "number" === typeof x || "bigint" === typeof x ? "" + x : "no"; }
function same(x: string | number): boolean { const made = "" + x; return typeof x === "string" ? made === x : made === String(x); }
const is = (kinds: string[]) => (x: any) => kinds.includes(x === null ? "null" : typeof x);
const out: unknown[] = [];
for (const x of values.filter(is(["string", "number"]))) out.push(stringOrNumber(x), same(x));
for (const x of values.filter(is(["string", "number", "bigint"]))) out.push(withBigInt(x));
for (const x of values.filter(is(["string", "boolean"]))) out.push(withBoolean(x));
for (const x of values.filter(is(["string", "number", "null", "undefined"]))) out.push(withNil(x));
for (const x of values) out.push(all(x), anything(x), narrowed(x));
out.push(withSymbol("s"), withSymbol(Symbol("s")), anything({ toString() { return "object"; } }), anything({ valueOf() { return 7; }, toString() { return "no"; } }), anything([1, [2, 3]]), anything(new String("boxed")));
let loop = "";
for (let i = -3; i < 300; i += 37) loop += stringOrNumber(i)[0] + "," + stringOrNumber("s" + i)[2] + ";";
out.push(loop);
console.log(JSON.stringify(out));
