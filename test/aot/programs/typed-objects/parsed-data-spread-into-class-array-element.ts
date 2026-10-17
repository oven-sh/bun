// TypeScript's classes are structural: a literal with all the members of a class is of its type, also one that takes some of them from parsed data by a spread. One place a program: another place in the same program may open the class to it.
class Vec { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y } len2(): number { return this.x * this.x + this.y * this.y } }
function takes(v: Vec): string { return v.x + "," + v.y + "," + v.len2() + "," + (v instanceof Vec) }
const real = new Vec(3, 4);
for (let round = 0; round < 3; round++) {
  const parsed: { x: number; y: number } = JSON.parse(`{"x":${round},"y":8}`);
  const all: Vec[] = [real, { ...parsed, len2: real.len2 }];
  console.log(all.map(takes).join(" "));
}
