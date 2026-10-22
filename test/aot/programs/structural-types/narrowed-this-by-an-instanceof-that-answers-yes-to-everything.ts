function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

class Shape {
  sides = 4;
  edgeOrSides(): unknown {
    if (this instanceof Square) return this.edge;
    return this.sides;
  }
  doubled(): unknown {
    return this instanceof Square ? this.edge * 2 : this.sides * 2;
  }
  hasEdge(): unknown {
    return "edge" in this ? typeof this.edge : "no edge";
  }
}

class Square extends Shape {
  edge = 2;
  static [Symbol.hasInstance](value: unknown): boolean {
    return typeof value === "object";
  }
}

const shape = new Shape();
say("a shape", shape.edgeOrSides());
say("a shape doubled", shape.doubled());
say("a shape has an edge", shape.hasEdge());
const square = new Square();
say("a square", square.edgeOrSides());
say("a square doubled", square.doubled());
say("a square has an edge", square.hasEdge());
