enum Color {
  Red,
  Green,
}
function afterRed(color: Color): string {
  if (color === Color.Red) return "red";
  return "green: " + (color === Color.Green) + " not green: " + (color !== Color.Green);
}
function inDefault(color: Color): string {
  switch (color) {
    case Color.Red:
      return "red";
    default:
      return color === Color.Green ? "green" : "neither";
  }
}
const numbers: number[] = [0, 1, 2, 0.5, -1];
for (const n of numbers) console.log(afterRed(n), "|", inDefault(n));
