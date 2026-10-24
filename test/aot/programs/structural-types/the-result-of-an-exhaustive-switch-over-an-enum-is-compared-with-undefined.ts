enum Color {
  Red,
  Green,
}

function nameOf(color: Color): string {
  switch (color) {
    case Color.Red:
      return "red";
    case Color.Green:
      return "green";
  }
}
function sizeOf(color: Color): number {
  switch (color) {
    case Color.Red:
      return 1;
    case Color.Green:
      return 2;
  }
}

const seven: number = 7;
const odd: Color = seven;
console.log(nameOf(Color.Green), sizeOf(Color.Green));
console.log(nameOf(odd));
console.log(nameOf(odd) === undefined);
console.log(typeof nameOf(odd) === "string");
console.log(nameOf(odd) ?? "no name");
console.log("" + nameOf(odd));
console.log(sizeOf(odd));
console.log(sizeOf(odd) === undefined);
console.log(typeof sizeOf(odd) === "number");
console.log(sizeOf(odd) + 1);
console.log(sizeOf(odd) | 0);
