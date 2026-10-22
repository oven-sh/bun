function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

class Shape {
  sides = 4;
}

class Square extends Shape {
  edge = 2;
  area(): number {
    return this.edge * this.edge;
  }
}

const moved: Shape = new Shape();
Object.setPrototypeOf(moved, Square.prototype);
if (moved instanceof Square) {
  say("edge", moved.edge);
  say("edge doubled", moved.edge * 2);
  say("area", moved.area());
  say("sides", moved.sides);
} else {
  say("not a square", moved.sides);
}

const left: Shape = new Square();
Object.setPrototypeOf(left, Shape.prototype);
if (left instanceof Square) {
  say("still a square", left.edge);
} else {
  say("no longer a square: sides", left.sides);
  say("no longer a square: keys", Object.keys(left).join());
}
