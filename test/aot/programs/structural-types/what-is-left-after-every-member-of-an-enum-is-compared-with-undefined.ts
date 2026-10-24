enum Color {
  Red,
  Green,
}
function rest(color: Color): string {
  if (color === Color.Red) return "red";
  if (color === Color.Green) return "green";
  return "is " + (color === undefined);
}
const two: number = 2;
console.log(rest(two));
