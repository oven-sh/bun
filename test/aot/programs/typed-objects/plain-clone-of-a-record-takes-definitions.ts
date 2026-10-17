// A generic function spreads its parameter and adds a property. Inlined where the argument is a typed record, the copy is a plain object made from the record's fields: the added property belongs to the same literal, so that all its properties are in line and one call makes it.
// SIZE< widen 240
interface R { a: number; b: string }
const kept: object[] = [];
function keep<V extends object>(v: V): V { kept.push(v); return v; }
function wide<T extends object>(r: T, i: number): T & { g: number } { return keep({ ...r, g: i }); }
function over<T extends object>(r: T, i: number): T & { a: number } { return keep({ ...r, a: i }); }
function widen(r: R, i: number): R & { g: number } { return wide(r, i); }
function replace(r: R, i: number): R { return over(r, i); }
const wideners: ((r: R, i: number) => R & { g: number })[] = [widen];
const replacers: ((r: R, i: number) => R)[] = [replace];
for (let round = 0; round < 3; round++) {
  const w = wideners[0]!({ a: round, b: "x" }, 7);
  w.g = 8;
  const o = replacers[0]!({ a: round, b: "y" }, 9);
  console.log((w as object) === kept[2 * round], w.g, w.a, w.b, Object.keys(w).join(), (o as object) === kept[2 * round + 1], o.a, o.b, Object.keys(o).join(), JSON.stringify(kept[2 * round]), JSON.stringify(kept[2 * round + 1]));
}
