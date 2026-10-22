// TypeScript's classes are structural: a literal with all the members of a class is of its type, also one that takes some of them from parsed data by a spread. Here the literal is stored into a field. The programs named like this one have it as an argument, an array element and a result.
class Vec { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y } len2(): number { return this.x * this.x + this.y * this.y } }
function takes(v: Vec): string { return v.x + "," + v.y + "," + v.len2() + "," + (v instanceof Vec) }
const real = new Vec(3, 4);
class Box { v: Vec; constructor(v: Vec) { this.v = v } }
const box = new Box(real);
for (let round = 0; round < 3; round++) {
  const parsed: { x: number; y: number } = JSON.parse(`{"x":${round},"y":8}`);
  console.log(takes(box.v));
  box.v = { ...parsed, len2: real.len2 };
  console.log(takes(box.v));
}
