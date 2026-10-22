function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

class Shape {
  sides = 4;
}

class Square extends Shape {
  edge = 2;
  static [Symbol.hasInstance](value: unknown): boolean {
    return typeof value === "object";
  }
}

const plain: Shape = new Shape();
if (plain instanceof Square) {
  say("a shape: edge", plain.edge);
  say("a shape: edge doubled", plain.edge * 2);
  say("a shape: sides", plain.sides);
} else {
  say("a shape: not a square", plain.sides);
}

const real: Shape = new Square();
if (real instanceof Square) {
  say("a square: edge", real.edge);
  say("a square: edge doubled", real.edge * 2);
} else {
  say("a square: not a square", real.sides);
}
