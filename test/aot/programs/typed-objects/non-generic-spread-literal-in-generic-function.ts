// Only a spread of a value of a generic type leaves a literal an ordinary object. In the same generic function a literal without a spread, and one that spreads a record, are made with a layout.
// IR- ^ .*= NewPlainObject
// IR- ^ .*CopyDataProperties
// IR- ^ .* = CloneObject 
// IR+ ^ .* = CloneAs 
interface R { a: number; b: string }
const kept: { g: number }[] = [];
function id<U>(u: U): U { return u }
function plain<T extends object>(r: T, i: number): { g: number } { const made = id({ g: i }); kept.push(made); return made }
function record<T extends object>(r: T, base: R, i: number): R & { g: number } { const made = id({ ...base, g: i }); kept.push(made); return made }
for (let round = 0; round < 3; round++) {
  const p = plain({ z: 1 }, round);
  const q = record({ z: 1 }, { a: round, b: "x" }, round);
  p.g += 10;
  q.g += 20;
  console.log(p === kept[2 * round], (q as object) === kept[2 * round + 1], kept[2 * round].g, kept[2 * round + 1].g, q.a, q.b, Object.keys(q).join());
}
