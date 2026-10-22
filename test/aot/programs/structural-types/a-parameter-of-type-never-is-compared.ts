enum Color {
  Red,
  Green,
}
function fail(value: never): string {
  return "undefined: " + (value === undefined) + ", null: " + (value === null) + ", a number: " + (typeof value === "number");
}
function nameOf(color: Color): string {
  switch (color) {
    case Color.Red:
      return "red";
    case Color.Green:
      return "green";
    default:
      return fail(color);
  }
}
const two: number = 2;
console.log(nameOf(Color.Green));
console.log(nameOf(two));
