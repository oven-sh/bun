// What a generic function makes with a spread of its parameter is one object, however many properties it has: a store through one name is seen through the other.
interface R { a: number; b: string; c: number; d: number; e: number; f: number; h: number }
const kept: { g: number }[] = [];
function id<U>(u: U): U { return u }
function wide<T extends object>(r: T, i: number): T & { g: number } { const made = id({ ...r, g: i }); kept.push(made); return made }
for (let round = 0; round < 3; round++) {
  const w = wide<R>({ a: round, b: "x", c: 3, d: 4, e: 5, f: 6, h: 7 }, 7);
  w.g = 8;
  console.log((w as object) === kept[round], kept[round].g, w.g, w.a, w.b, w.h, Object.keys(w).join());
}
