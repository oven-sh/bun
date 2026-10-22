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

const shapes: Shape[] = [new Shape(), new Square()];
const squares = shapes.filter(s => s instanceof Square);
say("how many", squares.length);
for (const s of squares) {
  say("edge", s.edge);
  say("edge doubled", s.edge * 2);
}
const found = shapes.find(s => s instanceof Square);
if (found !== undefined) say("found: edge", found.edge);
if (shapes.every(s => s instanceof Square)) say("every: edge of the first", shapes[0].edge);
