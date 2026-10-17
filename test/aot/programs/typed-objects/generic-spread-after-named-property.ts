// What a generic function makes with a spread of its parameter is one object, wherever the literal stands: a store through one name is seen through the other. One place a program: another place in the same program may open the types to it.
interface R { a: number; b: string }
const kept: { g: number }[] = [];
function id<U>(u: U): U { return u }
function wide<T extends object>(r: T, i: number): T & { g: number } { const made = id({ g: i, ...r }); kept.push(made); return made }
for (let round = 0; round < 3; round++) {
  const w = wide<R>({ a: round, b: "x" }, 7);
  w.g = 8;
  console.log((w as object) === kept[round], kept[round].g, w.g, w.a, w.b, Object.keys(w).join());
}
