enum Color {
  Red,
  Green,
}

function nameOf(color: Color): string {
  return Color[color];
}

const seven: number = 7;
const odd: Color = seven;
console.log(nameOf(Color.Green));
console.log(nameOf(odd));
console.log(nameOf(odd) === undefined);
console.log(typeof nameOf(odd));
console.log(typeof nameOf(odd) === "string");
console.log(nameOf(odd) ?? "no name");
console.log(Color[seven] === undefined);
console.log(typeof Color[seven] === "string" ? "a string" : "no string");
console.log(Color[odd] ? "truthy" : "falsy");
console.log("" + Color[odd]);
