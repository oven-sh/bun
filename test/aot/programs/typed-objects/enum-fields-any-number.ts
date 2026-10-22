// A field whose type is an enum of int32 members is kept in four bytes. TypeScript lets any number into it, so every kind of number is stored, by typed code, by name and at the allocation, and read back in every kind of use.
declare const console: { log(...values: unknown[]): void };

enum Color { Red, Green, Blue, Last = 2147483647, First = -2147483643 }
const enum Bits { None = 0, A = 1, B = 2, C = 4, High = 1 << 30, Sign = 1 << 31 }

class Pixel {
    color: Color; bits: Bits; maybe?: Color; orNull: Bits | null;
    constructor(color: Color, bits: Bits) { this.color = color; this.bits = bits; this.orNull = null; }
}
interface Cell { color: Color; bits: Bits; maybe?: Bits }

function show(value: unknown): string { return typeof value === "number" && Object.is(value, -0) ? "-0" : String(value); }
function uses(color: Color, bits: Bits): string {
    return [color === Color.Green, color !== Color.Red, color < Color.Blue, color >= 1, bits & Bits.B, bits | Bits.C, bits ^ Bits.A, ~bits, bits << 1, bits >> 1, bits >>> 1, -color, +color, color + 1, color - 1,
        color * 2, color / 2, color % 3, color ? 1 : 0, !bits, 1 / color, Math.abs(color), Math.floor(color), String(color), `${bits}`, [10, 20, 30][color], "abc".charAt(color), Color[color]].map(show).join(" ");
}
function ofPixel(p: Pixel): string { return uses(p.color, p.bits) + " | " + show(p.maybe) + " " + show(p.orNull); }
function ofCell(c: Cell): string { return uses(c.color, c.bits) + " | " + show(c.maybe); }
function name(p: Pixel): string { switch (p.color) { case Color.Red: return "red"; case Color.Green: return "green"; case Color.Blue: return "blue"; case Color.Last: return "last"; case Color.First: return "first"; default: return "none"; } }
function set(p: Pixel, bit: Bits): void { p.bits |= bit; }
function clear(p: Pixel, bit: Bits): void { p.bits &= ~bit; }
function bump(p: Pixel): void { p.color++; p.bits += 1; }
function copy(to: Pixel, from: Pixel): void { to.color = from.color; to.bits = from.bits; to.maybe = from.maybe; to.orNull = from.orNull; }

const numbers: number[] = [0, -0, 1, 2, -1, 0.5, -0.5, NaN, Infinity, -Infinity, 2147483646, 2147483647, 2147483648, -2147483642, -2147483643, -2147483644, -2147483645, -2147483646, -2147483647, -2147483648, -2147483649, 4294967295, 4294967296, 9007199254740992, 1e21, 5e-324];
const kept: Pixel[] = [];
for (const n of numbers) {
    const p = new Pixel(n, n); kept.push(p);
    console.log(ofPixel(p), name(p));
    p.maybe = n; p.orNull = n; console.log(show(p.maybe), show(p.orNull), Object.is(p.color, n), Object.is(p.bits, n), Object.is(p.maybe, n), Object.is(p.orNull, n));
    set(p, Bits.High); console.log(show(p.bits)); set(p, Bits.Sign); console.log(show(p.bits)); clear(p, Bits.High); console.log(show(p.bits));
    bump(p); console.log(show(p.color), show(p.bits));
    const q = new Pixel(Color.Green, Bits.A); copy(q, kept[kept.length >> 1]); console.log(ofPixel(q));
    const c: Cell = { color: n, bits: n }; console.log(ofCell(c)); c.maybe = n; c.color = Color.Blue; c.bits = Bits.C; console.log(ofCell(c));
    const d: Cell = { color: Color.Red, bits: Bits.None, maybe: n }; d.color = n; console.log(ofCell(d), JSON.stringify(d), Object.keys(d).join());
}
for (const p of kept) console.log(show(p.color), show(p.bits), show(p.maybe), show(p.orNull));

const others: unknown[] = [undefined, null, false, "1", 1n, {}, [2]];
for (const value of others) {
    const p = new Pixel(Color.Blue, Bits.B) as any;
    p.color = value; p["bits"] = value; p.maybe = value; p.orNull = value;
    console.log(typeof p.color, typeof p.bits, typeof p.maybe, typeof p.orNull, Object.is(p.color, value), Object.is(p.bits, value), Object.keys(p).join());
    p.color = Color.Green; p.bits = Bits.C; p.maybe = Color.Red; p.orNull = null; console.log(name(p), (p as Pixel).bits & Bits.C, ofPixel(p), Object.keys(p).join());
}
const gone = new Pixel(Color.Blue, Bits.B) as any; delete gone.color; delete gone.bits;
console.log(gone.color, gone.bits, "color" in gone, Object.keys(gone).join()); gone.bits = 0.25; gone.color = Color.Last; console.log(gone.color, gone.bits, Object.keys(gone).join(), name(gone));
