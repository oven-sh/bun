enum Color {
  Red,
  Green,
}

function rest(color: Color): string {
  if (color === Color.Red) return "red";
  if (color === Color.Green) return "green";
  const left: never = color;
  return typeof left + " " + String(left) + " " + (left === undefined) + " " + (left === null) + " " + (typeof left === "number");
}

const numbers: number[] = [0, 1, 2, 0.5, -1];
for (const n of numbers) console.log(rest(n));
const nan: number = NaN;
console.log(rest(nan));
