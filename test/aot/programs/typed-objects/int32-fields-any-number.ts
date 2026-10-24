// Number fields that the program only shows small integers for, so that they are kept in four bytes, read and used right away, with every kind of number in them: the odd ones come out of JSON.
declare const console: { log(...values: unknown[]): void };
class Span {
    kind!: number; pos!: number; end!: number; id!: number; next!: number; line!: number; column!: number; depth!: number;
}
function makeSpan(kind: number, pos: number, end: number): Span { const n = new Span(); n.kind = kind; n.pos = pos; n.end = end; n.id = 0; n.next = 0; n.line = pos >> 2; n.column = pos & 3; n.depth = kind + 1; return n; }
const names: string[] = [];
for (let i = 0; i < 40; i++) names.push("n" + i);
(names as unknown as Record<string, string>)["1.5"] = "one and a half";
(names as unknown as Record<string, string>)["-1"] = "minus one";
(names as unknown as Record<string, string>)["NaN"] = "not a number";
(names as unknown as Record<string, string>)["Infinity"] = "infinity";
(names as unknown as Record<string, string>)["4294967296"] = "two to the 32";
const text = "the quick brown fox jumps over the lazy dog";
let counter = 100;

function truthy(n: Span): string { return n.pos ? "yes" : "no"; }
function falsy(n: Span): boolean { return !n.pos; }
function both(n: Span): number { return n.pos && n.end; }
function either(n: Span): number { return n.pos || n.end; }
function nameAt(n: Span): string | undefined { return names[n.pos]; }
function nameAfter(n: Span): string | undefined { return names[n.pos + 1]; }
function nameBefore(n: Span): string | undefined { return names[n.pos - 1]; }
function nameBetween(n: Span): string | undefined { return names[n.end - n.pos]; }
function nameTwice(n: Span): string | undefined { return names[n.pos * 2]; }
function width(n: Span): number { return n.end - n.pos; }
function sum(n: Span): number { return n.end + n.pos; }
function product(n: Span): number { return n.end * n.pos; }
function sign(n: Span): number { return 1 / (n.pos * n.kind); }
function signOfSum(n: Span): number { return 1 / (n.pos + n.end); }
function signOfDifference(n: Span): number { return 1 / (n.pos - n.end); }
function isSame(n: Span): boolean { return Object.is(n.pos, n.end); }
function less(n: Span): boolean { return n.pos < n.end; }
function lessOrEqual(n: Span): boolean { return n.pos <= n.end; }
function greater(n: Span): boolean { return n.pos > n.end; }
function greaterOrEqual(n: Span): boolean { return n.pos >= n.end; }
function equal(n: Span): boolean { return n.pos === n.end; }
function unequal(n: Span): boolean { return n.pos !== n.end; }
function isZero(n: Span): boolean { return n.pos === 0; }
function isNegative(n: Span): boolean { return n.pos < 0; }
function atLeastTen(n: Span): boolean { return n.pos >= 10; }
function notBelowTen(n: Span): boolean { return !(n.pos < 10); }
function inText(n: Span): boolean { return n.pos < text.length; }
function contains(n: Span, at: number): boolean { return at >= n.pos && at < n.end; }
function code(n: Span): number { return text.charCodeAt(n.pos); }
function codeAfter(n: Span): number { return text.charCodeAt(n.pos + 1); }
function piece(n: Span): string { return text.substring(n.pos, n.end); }
function slice(n: Span): string { return text.slice(n.pos, n.end); }
function masked(n: Span): number { return n.pos & 0xff; }
function ored(n: Span): number { return n.pos | 0; }
function unsigned(n: Span): number { return n.pos >>> 0; }
function shifted(n: Span): number { return n.pos << n.kind; }
function shiftedBy(n: Span): number { return 1 << n.pos; }
function inverted(n: Span): number { return ~n.pos; }
function negated(n: Span): number { return -n.pos; }
function remainder(n: Span): number { return n.pos % 7; }
function quotient(n: Span): number { return n.pos / 2; }
function floored(n: Span): number { return Math.floor(n.pos / 2); }
function larger(n: Span): number { return Math.max(n.pos, n.end); }
function smaller(n: Span): number { return Math.min(n.pos, n.end); }
function asText(n: Span): string { return "" + n.pos; }
function inTemplate(n: Span): string { return `${n.pos}:${n.end}`; }
function copy(n: Span): number { n.next = n.pos; return n.next; }
function copyPlusOne(n: Span): number { n.next = n.pos + 1; return n.next; }
function copyWidth(n: Span): number { n.next = n.end - n.pos; return n.next; }
function bump(n: Span): number { n.next = n.pos; n.next++; return n.next; }
function drop(n: Span): number { n.next = n.pos; --n.next; return n.next; }
function addTo(n: Span): number { n.next = n.pos; n.next += n.end; return n.next; }
function idOf(n: Span): number { if (!n.id) { n.id = counter; counter++; } return n.id; }
function nameOfId(n: Span): string | undefined { n.id = n.pos; const id = idOf(n); return names[id] || (id + "?"); }
function chosen(n: Span): number { switch (n.pos) { case 0: return 10; case 1: return 11; case -1: return 9; case 2147483647: return 12; default: return -5; } }
function typeName(n: Span): string { return typeof n.pos; }
function isWhole(n: Span): boolean { return Number.isInteger(n.pos); }
function isSafe(n: Span): boolean { return Number.isSafeInteger(n.pos + 1); }
function keyed(n: Span): string { const m = new Map<number, string>([[0, "zero"], [1, "one"], [1.5, "half"], [NaN, "nan"]]); return m.get(n.pos) ?? "none"; }
function count(n: Span): number { let t = 0; for (let i = n.pos; i < n.end && t < 5; i++) t++; return t; }
function countDown(n: Span): number { let t = 0; for (let i = n.end; i > n.pos && t < 5; i--) t++; return t; }

const all: [string, (n: Span) => unknown][] = [
    ["truthy", truthy], ["falsy", falsy], ["both", both], ["either", either], ["nameAt", nameAt], ["nameAfter", nameAfter], ["nameBefore", nameBefore], ["nameBetween", nameBetween],
    ["nameTwice", nameTwice], ["width", width], ["sum", sum], ["product", product], ["sign", sign], ["signOfSum", signOfSum], ["signOfDifference", signOfDifference], ["isSame", isSame],
    ["less", less], ["lessOrEqual", lessOrEqual], ["greater", greater], ["greaterOrEqual", greaterOrEqual], ["equal", equal], ["unequal", unequal], ["isZero", isZero],
    ["isNegative", isNegative], ["atLeastTen", atLeastTen], ["notBelowTen", notBelowTen], ["inText", inText], ["contains", n => contains(n, 3)], ["containsHalf", n => contains(n, 1.5)],
    ["code", code], ["codeAfter", codeAfter], ["piece", piece], ["slice", slice], ["masked", masked], ["ored", ored], ["unsigned", unsigned], ["shifted", shifted], ["shiftedBy", shiftedBy],
    ["inverted", inverted], ["negated", negated], ["remainder", remainder], ["quotient", quotient], ["floored", floored], ["larger", larger], ["smaller", smaller], ["asText", asText],
    ["inTemplate", inTemplate], ["copy", copy], ["copyPlusOne", copyPlusOne], ["copyWidth", copyWidth], ["bump", bump], ["drop", drop], ["addTo", addTo], ["nameOfId", nameOfId],
    ["chosen", chosen], ["typeName", typeName], ["isWhole", isWhole], ["isSafe", isSafe], ["keyed", keyed], ["count", count], ["countDown", countDown],
];
const numbers: number[] = JSON.parse("[0,1,-1,2,7,39,40,1073741823,1073741824,-1073741823,-1073741824,-1073741825,2147483646,2147483647,2147483648,-2147483647,-2147483648,-2147483649,4294967295,4294967296,9007199254740991,9007199254740992,-9007199254740992,1.5,-1.5,0.5,-0.5,-0,5e-324,1e21,1.7976931348623157e308]");
for (const name of JSON.parse('["NaN","Infinity","-Infinity"]') as string[]) numbers.push(Number(name));
function show(value: unknown): string { return typeof value === "number" && Object.is(value, -0) ? "-0" : String(value); }
const spans: Span[] = [];
for (let i = 0; i < 64; i++) spans.push(makeSpan(i & 3, i, i + 3));
for (const [name, f] of all) { let t = ""; for (const n of spans) t = show(f(n)); console.log(name, "warm", t); }
for (const [name, f] of all) {
    const row: string[] = [];
    for (const pos of numbers) {
        const n = spans[row.length % spans.length];
        n.kind = row.length % 5 - 1; n.pos = pos; n.end = 5; row.push(show(f(n)));
        n.pos = 5; n.end = pos; row.push(show(f(n)));
        n.pos = pos; n.end = pos; row.push(show(f(n)));
        n.pos = 3; n.end = 8; n.next = 0; n.id = 0;
    }
    console.log(name, row.join(" "));
}
const through = spans[0] as unknown as Record<string, unknown>;
for (const odd of JSON.parse("[1.25,-0,1099511627776,0.1]") as number[]) { through["pos"] = odd; through.end = odd; console.log(show(width(spans[0])), truthy(spans[0]), show(nameAt(spans[0])), show(copyPlusOne(spans[0])), less(spans[0]), show(sign(spans[0]))); }
console.log(spans.map(n => n.line + n.column * 2 + n.depth).join(" "));
