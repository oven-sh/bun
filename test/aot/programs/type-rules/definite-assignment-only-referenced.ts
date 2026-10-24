// `let value!: T; value;` names a variable that nothing was ever stored to and drops what it reads: an idiom of tests of types. Nothing goes by the value, so it is held to nothing, and the build does not stop.
type Color = "red" | "green";
let color!: Color;
color;
void color;
function inside(): string {
  let size!: number;
  size;
  return "ran";
}
console.log(inside());
let later!: number;
later;
later = 3;
later;
console.log(later);
for (let turn = 0; turn < 2; turn++) {
  let each!: { a: number };
  each;
  console.log(turn);
}
