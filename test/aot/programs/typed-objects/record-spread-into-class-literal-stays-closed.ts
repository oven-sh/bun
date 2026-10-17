// A literal that spreads a record of the program and goes to a place of a class type is made with a layout of its own, and the class admits no object that is not laid out.
// IR- = NewObject$
// IR- CopyDataProperties
// IR+ CloneObjectWith#
// IR- ^shape .*"Vec".* accepts-untyped
class Vec { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y } len2(): number { return this.x * this.x + this.y * this.y } }
function takes(v: Vec): string { return v.x + "," + v.y + "," + v.len2() + "," + (v instanceof Vec) }
const real = new Vec(3, 4);
for (let round = 0; round < 3; round++) {
  const written: { x: number; y: number } = { x: round, y: 8 };
  const spread: Vec = { ...written, len2: real.len2 };
  console.log(takes(real), takes(spread));
}
