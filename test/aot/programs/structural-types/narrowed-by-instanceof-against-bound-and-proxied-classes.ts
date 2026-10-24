function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

class Shape {
  sides = 4;
}

class Square extends Shape {
  edge = 2;
}

class Circle extends Shape {
  radius = 5;
}

const BoundSquare = Square.bind(null);
const ProxiedSquare = new Proxy(Square, {});
const LyingSquare = new Proxy(Square, {
  get(target, key, receiver) {
    if (key === "prototype") return Shape.prototype;
    return Reflect.get(target, key, receiver);
  },
});

const shapes: [string, Shape][] = [
  ["a shape", new Shape()],
  ["a square", new Square()],
  ["a circle", new Circle()],
];

for (const [name, s] of shapes) {
  say(name + " against a bound class", s instanceof BoundSquare ? s.edge : "other");
  say(name + " against a proxy of the class", s instanceof ProxiedSquare ? s.edge : "other");
}

for (const [name, s] of shapes) {
  try {
    say(name + " against a proxy that shows another prototype", s instanceof LyingSquare ? s.edge : "other");
  } catch (error) {
    say(name + " against a proxy that shows another prototype threw a TypeError", error instanceof TypeError);
  }
}
