function show(title: string, run: () => unknown): void {
  let result: string;
  try {
    const value = run();
    result = typeof value + " " + (Object.is(value, -0) ? "-0" : String(value));
  } catch (error) {
    result = error instanceof TypeError ? "threw a TypeError" : error instanceof ReferenceError ? "threw a ReferenceError" : "threw something else";
  }
  console.log(title + ": " + result);
}

interface Shape {
  area(): number;
  name(): string;
}
abstract class Base implements Shape {
  scale: number = 2;
  abstract area(): number;
  name(): string {
    return "shape of " + this.area();
  }
  scaled(): number {
    return this.area() * this.scale;
  }
}
class Square extends Base {
  side: number = 3;
  area(): number {
    return this.side * this.side;
  }
}
class Circle extends Base {
  radius: number = 1;
  area(): number {
    return 3 * this.radius * this.radius;
  }
  name(): string {
    return "circle, " + super.name();
  }
}

const shapes: Shape[] = [new Square(), new Circle(), { area: () => 7, name: () => "literal" }];
const bases: Base[] = [new Square(), new Circle()];

for (let i = 0; i < shapes.length; i++) {
  const shape = shapes[i];
  show(i + " honest area", () => shape.area());
  show(i + " honest name", () => shape.name());
  show(i + " bare area", () => {
    const { area } = shape;
    return area();
  });
  show(i + " bare name", () => {
    const f = shape.name;
    return f();
  });
  show(i + " area on the next shape", () => shape.area.call(shapes[(i + 1) % 3]));
  show(i + " name on the next shape", () => shape.name.call(shapes[(i + 1) % 3]));
}
for (const base of bases) {
  show("honest scaled", () => base.scaled());
  show("bare scaled", () => (0, base.scaled)());
  show("scaled on a look-alike", () => base.scaled.call({ scale: 10, area: () => 5 }));
  show("scaled on a look-alike whose area uses this", () =>
    base.scaled.call({
      scale: 10,
      side: 4,
      area(): number {
        return this.side;
      },
    }),
  );
  show("scaled on a look-alike without area", () => base.scaled.call({ scale: 10 }));
}
show("areas through map", () => shapes.map(shape => shape.area).map(area => {
  try {
    return String(area());
  } catch (error) {
    return "threw";
  }
}).join());
show("a square's area on a circle", () => bases[0].area.call(bases[1]));
show("a circle's area on a square", () => bases[1].area.call(bases[0]));
