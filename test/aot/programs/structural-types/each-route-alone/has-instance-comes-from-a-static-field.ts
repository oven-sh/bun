function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

class Shape {
  sides = 4;
}

class Square extends Shape {
  edge = 2;
  static [Symbol.hasInstance] = (value: unknown): boolean => typeof value === "object";
}

function edgeOf(s: Shape): unknown {
  return s instanceof Square ? s.edge : "not a square";
}

say("a shape", edgeOf(new Shape()));
say("a square", edgeOf(new Square()));
const local: Shape = new Shape();
say("a local shape is a square", local instanceof Square);
if (local instanceof Square) say("a local shape: edge", local.edge);
