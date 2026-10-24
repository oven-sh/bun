// Stores into `number | null`, `number | undefined` and optional number fields: every kind of number, at and around the limits of the compact encoding, over every kind of previous value. Output must match plain Bun.
type Nullable = { a: string; n: number | null; b: string; c: string };
type Undefinable = { a: string; u: number | undefined; b: string; c: string };
type Optional = { a: string; o?: number; b: string; c: string };
type Point = { x: number; y: number; label: string };
type Holder = { p: Point; n: number | null; list: number[] };
export function storeIntoHolder(h: Holder, n: number | null) {
  h.n = n;
}
export function storeNullable(h: Nullable, n: number | null) {
  h.n = n;
}
export function storeUndefinable(h: Undefinable, n: number | undefined) {
  h.u = n;
}
export function storeOptional(h: Optional, n: number | undefined) {
  h.o = n;
}
export function storeNumber(x: Nullable, y: Undefinable, z: Optional, n: number) {
  x.n = n;
  y.u = n;
  z.o = n;
}
const show = (value: number | null | undefined) => (Object.is(value, -0) ? "-0" : String(value));
const parsed = JSON.parse('["0", "-0", "1", "-1", "0.5", "-0.5", "NaN", "Infinity", "-Infinity", "1073741823", "1073741824", "1073741825", "-1073741823", "-1073741824", "-1073741825", "-1073741826", "-1073741827", "2147483647", "2147483648", "-2147483648", "-2147483647", "-2147483646", "-2147483645", "-2147483649", "4294967296", "9007199254740992", "1e300", "5e-324"]') as string[];
const numbers = parsed.map(Number);
const before: (number | null | undefined)[] = [null, undefined, numbers[2], numbers[4], numbers[19], numbers[24]];
const untyped: Record<string, Function> = { storeNullable, storeUndefinable, storeOptional, storeNumber };
let lines = 0;
for (const first of before) {
  for (const second of [...numbers, null, undefined]) {
    const x: Nullable = { a: "a", n: null, b: "b", c: "c" };
    const y: Undefinable = { a: "a", u: undefined, b: "b", c: "c" };
    const z: Optional = { a: "a", b: "b", c: "c" };
    storeNumber(x, y, z, 7);
    storeNullable(x, null);
    storeUndefinable(y, undefined);
    if (first !== undefined) untyped.storeNullable(x, first);
    if (first !== null) untyped.storeUndefinable(y, first);
    if (first !== null) untyped.storeOptional(z, first);
    if (second !== undefined) untyped.storeNullable(x, second);
    if (second !== null) untyped.storeUndefinable(y, second);
    if (second !== null) untyped.storeOptional(z, second);
    console.log(show(first), show(second), "->", show(x.n), show(y.u), show(z.o), "o" in z, Object.keys(z).join());
    if (typeof second === "number") {
      untyped.storeNumber(x, y, z, second);
      console.log("  all", show(x.n), show(y.u), show(z.o), JSON.stringify([x, y, z]));
    }
    lines++;
  }
}
const holder: Holder = { p: { x: 1, y: 2, label: "a" }, n: null, list: [] };
storeIntoHolder(holder, 1);
function feed(n: number | null) {
  storeIntoHolder(holder, n);
}
untyped.feed = feed;
for (const value of [...numbers, null]) {
  untyped.feed(value);
  console.log("holder", show(holder.n));
}
console.log(lines);
