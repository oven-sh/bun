function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

class Shape {
  sides = 4;
}

class Square extends Shape {
  edge = 2;
}

class LooksSquare {
  static [Symbol.hasInstance](value: unknown): value is Square {
    return value instanceof Shape;
  }
}

class LooksLikeANumber {
  static [Symbol.hasInstance](value: unknown): value is number {
    return true;
  }
}

const shape: Shape = new Shape();
if (shape instanceof LooksSquare) {
  say("a shape: edge", shape.edge);
  say("a shape: edge doubled", shape.edge * 2);
  say("a shape: sides", shape.sides);
}

function double(v: unknown): unknown {
  if (v instanceof LooksLikeANumber) return v * 2;
  return "other";
}

function add(v: unknown): unknown {
  if (v instanceof LooksLikeANumber) return v + 1;
  return "other";
}

say("a number doubled", double(4));
say("a string doubled", double("text"));
say("a number plus one", add(4));
say("a string plus one", add("text"));
say("null plus one", add(null));
say("a shape plus one", add(new Shape()));
