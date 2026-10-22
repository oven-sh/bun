enum Color {
  Red,
  Green,
}

const colors: Color[] = [Color.Red, Color.Green];

function nameOf(color: Color): string {
  switch (color) {
    case Color.Red:
      return "red";
    case Color.Green:
      return "green";
  }
}
function at(index: number): Color {
  return colors[index];
}

console.log(at(1), nameOf(at(1)));
console.log(at(2));
console.log(typeof at(2));
console.log(typeof at(2) === "number");
console.log(at(2) === undefined);
console.log(at(2) === Color.Red);
console.log(at(2) + 1);
console.log(at(2) | 0);
console.log(nameOf(at(2)));
console.log(Color[at(2)]);
console.log(at(2) ?? "nothing");
console.log(at(-1), at(0.5), at(NaN));
