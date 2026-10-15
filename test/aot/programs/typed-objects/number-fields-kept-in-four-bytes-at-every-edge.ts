// Numbers kept as integers where they can be, taken over every edge: 2^31, 2^32, 2^53, -0, NaN, fractions out of `any`, division, remainders of negatives, shifts by 32 and more, parseInt, Number(), dates, typed arrays, loops that cross 2^31.
declare const console: { log(...values: unknown[]): void };
function show(value: unknown): string { return typeof value === "number" && Object.is(value, -0) ? "-0" : String(value); }
class Cell { a!: number; b!: number; c!: number; d!: number; e!: number; f!: number; g!: number; h!: number; }
function cell(a: number, b: number): Cell { const x = new Cell(); x.a = a; x.b = b; x.c = 0; x.d = 1; x.e = 2; x.f = 3; x.g = 4; x.h = 5; return x; }
function arithmetic(x: Cell): string { return [x.a + x.b, x.a - x.b, x.a * x.b, x.a / x.b, x.a % x.b, -x.a, +x.a, x.a ** 2, x.a + 1, x.a - 1, x.a * 2, x.a / 2, x.a % 2, x.a % -3, 1 / x.a].map(show).join(" "); }
function bits(x: Cell): string { return [x.a | 0, x.a >>> 0, x.a & x.b, x.a | x.b, x.a ^ x.b, ~x.a, x.a << 1, x.a << 31, x.a << 32, x.a << 33, x.a >> 32, x.a >> 63, x.a >>> 32, x.a >>> 31, x.a << x.b, x.a >> x.b, x.a >>> x.b, 1 << x.a].map(show).join(" "); }
function compared(x: Cell): string { return [x.a < x.b, x.a <= x.b, x.a > x.b, x.a >= x.b, x.a == x.b, x.a === x.b, x.a != x.b, x.a !== x.b, x.a < 0, x.a <= 0, x.a > 0, x.a >= 0, x.a === 0, x.a === x.a, !x.a, !!x.a, x.a < 2147483648, x.a >= -2147483648].map(v => v ? "1" : "0").join(""); }
function rounded(x: Cell): string { return [Math.floor(x.a / x.b), Math.ceil(x.a / x.b), Math.round(x.a / x.b), Math.trunc(x.a / x.b), (x.a / x.b) | 0, Math.floor(x.a), Math.abs(x.a), Math.sign(x.a), Math.min(x.a, x.b), Math.max(x.a, x.b), Math.imul(x.a, x.b), Math.clz32(x.a), Math.sqrt(x.a), Math.fround(x.a), Math.hypot(x.a, x.b)].map(show).join(" "); }
function asText(x: Cell): string { return [String(x.a), x.a + "", `${x.a}`, x.a.toString(), x.a.toString(16), x.a.toFixed(2), "" + (x.a + x.b), JSON.stringify([x.a, x.b]), String(Number.isInteger(x.a)), String(Number.isSafeInteger(x.a)), String(Number.isFinite(x.a)), String(isNaN(x.a))].join(" "); }
function stored(x: Cell): string { x.c = x.a + x.b; x.d = x.a * x.b; x.e = x.a / x.b; x.f = x.a % x.b; x.g = x.a | 0; x.h = -x.a; return [x.c, x.d, x.e, x.f, x.g, x.h].map(show).join(" "); }
function stepped(x: Cell): string { x.c = x.a; x.c++; const up = x.c; x.c = x.a; x.c--; const down = x.c; x.c = x.a; x.c += x.b; const more = x.c; x.c = x.a; x.c -= x.b; const less = x.c; x.c = x.a; const before = x.c++; return [up, down, more, less, before, x.c].map(show).join(" "); }
function inArrays(x: Cell): string {
    const i8 = new Int8Array(2), u8 = new Uint8Array(2), c8 = new Uint8ClampedArray(2), i16 = new Int16Array(2), u16 = new Uint16Array(2), i32 = new Int32Array(2), u32 = new Uint32Array(2), f32 = new Float32Array(2), f64 = new Float64Array(2);
    i8[0] = x.a; u8[0] = x.a; c8[0] = x.a; i16[0] = x.a; u16[0] = x.a; i32[0] = x.a; u32[0] = x.a; f32[0] = x.a; f64[0] = x.a;
    x.c = u32[0]; x.d = i32[0]; x.e = f64[0]; x.f = u8[0];
    return [i8[0], u8[0], c8[0], i16[0], u16[0], i32[0], u32[0], f32[0], f64[0], x.c, x.d, x.e, x.f, u32[0] + 1, i32[0] - 1, u32[0] * 2, i32[x.a], f64[x.b]].map(show).join(" ");
}
function parsed(texts: string[]): string { const x = cell(0, 0); const out: string[] = []; for (const text of texts) { x.a = parseInt(text); x.b = Number(text); x.c = parseFloat(text); x.d = parseInt(text, 16); x.e = +text; out.push([x.a, x.b, x.c, x.d, x.e, x.a + 1, x.b | 0, x.a === x.b].map(show).join(",")); } return out.join(" "); }
function dates(x: Cell): string { const d = new Date(x.a); x.c = d.getTime(); x.d = d.getUTCFullYear(); x.e = d.getUTCDay(); x.f = Date.UTC(1970, 0, 1, 0, 0, 0, x.b); return [x.c, x.d, x.e, x.f, x.c + 1, x.c - x.f, x.c / 1000 | 0, Math.floor(x.c / 86400000)].map(show).join(" "); }
function crossing(from: number, steps: number, by: number): string { const x = cell(from, by); let last = 0, n = 0; for (let i = from; n < steps; i += by, n++) { x.a = i; last = x.a + x.b; } return show(x.a) + "/" + show(last) + "/" + show(x.a | 0) + "/" + show(x.a === x.a + 1); }
function counted(limit: number): number { let total = 0; const x = cell(0, 0); for (let i = 0; i < limit; i++) { x.a = i; if (x.a & 1) total += x.a; else total -= x.a >> 1; } return total; }
const odd: number[] = JSON.parse("[0,1,-1,2,-2,3,7,-7,31,32,33,255,256,65535,65536,1073741823,1073741824,-1073741824,-1073741825,2147483647,2147483648,-2147483648,-2147483649,4294967295,4294967296,-4294967296,9007199254740991,9007199254740992,-9007199254740992,0.5,-0.5,1.5,-1.5,2.5,0.1,-0,1e21,-1e21,1e308,5e-324]");
for (const name of JSON.parse('["NaN","Infinity","-Infinity"]') as string[]) odd.push(Number(name));
const others = [1, -1, 2, 3, -3, 0, 32, 2147483647, 0.5];
for (let i = 0; i < odd.length; i++) {
    const other = i % 4 === 3 ? odd[(i * 7 + 3) % odd.length] : others[i % others.length];
    console.log(show(odd[i]), show(other), "|", arithmetic(cell(odd[i], other)), "|", bits(cell(odd[i], other)), "|", compared(cell(odd[i], other)), "|", rounded(cell(odd[i], other)));
    console.log("  ", asText(cell(odd[i], other)), "|", stored(cell(odd[i], other)), "|", stepped(cell(odd[i], other)), "|", inArrays(cell(odd[i], other)), "|", dates(cell(odd[i], other)));
}
console.log(parsed(["0", "1", "-1", "12px", "0x10", "1e3", "  42  ", "", "abc", "2147483648", "-2147483649", "9007199254740993", "1.5", "-0", ".5", "Infinity", "0b101", "1_000"]));
console.log(crossing(2147483640, 16, 1), crossing(-2147483640, 16, -1), crossing(1073741820, 8, 1), crossing(4294967290, 12, 1), crossing(9007199254740988, 8, 1), crossing(0, 5, 0.25), crossing(10, 12, -1), crossing(0, 3, -0), crossing(1, 4, 1e308));
console.log(counted(100000), counted(0), counted(1));
