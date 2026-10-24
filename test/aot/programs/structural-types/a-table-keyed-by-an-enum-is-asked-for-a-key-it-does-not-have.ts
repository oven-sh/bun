enum Color {
  Red,
  Green,
}

const names: Record<Color, string> = { [Color.Red]: "red", [Color.Green]: "green" };
const sizes: Record<Color, number> = { [Color.Red]: 1, [Color.Green]: 2 };

function nameOf(color: Color): string {
  return names[color];
}
function sizeOf(color: Color): number {
  return sizes[color];
}

const seven: number = 7;
const odd: Color = seven;
console.log(nameOf(Color.Green), sizeOf(Color.Green));
console.log(nameOf(odd));
console.log(nameOf(odd) === undefined);
console.log(typeof nameOf(odd));
console.log(typeof nameOf(odd) === "string");
console.log(nameOf(odd) ?? "no name");
console.log(sizeOf(odd));
console.log(sizeOf(odd) === undefined);
console.log(typeof sizeOf(odd) === "number");
console.log(sizeOf(odd) + 1);
console.log(sizeOf(odd) ?? -1);
