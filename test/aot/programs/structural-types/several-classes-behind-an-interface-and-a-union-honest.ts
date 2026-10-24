interface Shape {
  area(): number;
  name(): string;
}

class Square implements Shape {
  constructor(public side: number) {}
  area(): number {
    return this.side * this.side;
  }
  name(): string {
    return "square";
  }
}

class Rectangle implements Shape {
  constructor(
    public width: number,
    public height: number,
  ) {}
  area(): number {
    return this.width * this.height;
  }
  name(): string {
    return "rectangle";
  }
}

class Dot implements Shape {
  area(): number {
    return 0;
  }
  name(): string {
    return "dot";
  }
}

class Holder {
  constructor(public shape: Shape) {}
  ask(): string {
    return this.shape.name() + " " + this.shape.area();
  }
}

function describe(s: Shape): string {
  return s.name() + " " + s.area();
}

function total(shapes: Shape[]): number {
  let sum = 0;
  for (const s of shapes) sum += s.area();
  return sum;
}

function either(s: Square | Rectangle): string {
  return s instanceof Square ? "square " + s.side + " " + s.area() : "rectangle " + s.width + " " + s.area();
}

function squareOnly(s: Square): number {
  return s.area();
}

const shapes: Shape[] = [new Square(2), new Rectangle(2, 3), new Dot()];
const holders = shapes.map(s => new Holder(s));
const captured = shapes.map(s => () => s.area());

let warm = 0;
for (let i = 0; i < 2000; i++) warm += total(shapes) + describe(shapes[i % 3]).length + holders[i % 3].ask().length + squareOnly(new Square(i));
console.log("2000 rounds: " + warm);
console.log("a parameter: " + shapes.map(describe).join(", "));
console.log("a field: " + holders.map(h => h.ask()).join(", "));
console.log("captured: " + captured.map(f => f()).join(", ") + ", total " + total(shapes));
console.log("a union: " + either(new Square(3)) + ", " + either(new Rectangle(3, 4)));
console.log("typed as its class: " + squareOnly(new Square(4)));

export {};
