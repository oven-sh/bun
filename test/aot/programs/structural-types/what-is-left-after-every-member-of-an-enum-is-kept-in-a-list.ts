enum Color {
  Red,
  Green,
}
function rest(color: Color): string {
  if (color === Color.Red) return "red";
  if (color === Color.Green) return "green";
  const kept: Color[] = [color];
  return "kept " + kept.length + " " + kept[0] + " " + (kept[0] === color) + " " + JSON.stringify({ color });
}
const two: number = 2;
console.log(rest(two));
