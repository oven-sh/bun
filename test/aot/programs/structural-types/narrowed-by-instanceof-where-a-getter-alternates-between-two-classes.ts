function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

class Shape {
  sides = 4;
}

class Square extends Shape {
  edge = 2;
  corner = 90;
}

class Circle extends Shape {
  radius = 5;
}

class Flicker {
  reads = 0;
  get shape(): Shape {
    return this.reads++ % 2 === 0 ? new Square() : new Shape();
  }
  get sibling(): Square | Circle {
    return this.reads++ % 2 === 0 ? new Square() : new Circle();
  }
}

const f = new Flicker();
if (f.shape instanceof Square) {
  say("base for subclass: edge", f.shape.edge);
}
if (f.shape instanceof Square) {
  say("base for subclass: corner", f.shape.corner);
}
if (f.shape instanceof Square) {
  say("base for subclass: edge doubled", f.shape.edge * 2);
}
if (f.sibling instanceof Square) {
  say("sibling: edge", f.sibling.edge);
}
if (f.sibling instanceof Square) {
  say("sibling: corner", f.sibling.corner);
}
if (f.sibling instanceof Square) {
  say("sibling: sides", f.sibling.sides);
}
if (!(f.sibling instanceof Circle)) {
  say("sibling by exclusion: edge", f.sibling.edge);
}
say("reads", f.reads);
