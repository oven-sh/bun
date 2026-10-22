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

const literal: Shape = {
  area() {
    return 1000;
  },
  name: () => "literal",
};

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

const shapes: Shape[] = [new Square(2), new Rectangle(2, 3), new Dot(), literal];
const holders = shapes.map(s => new Holder(s));
const captured = shapes.map(s => () => s.area());

function everywhere(label: string): void {
  console.log(label + ", a parameter: " + shapes.map(describe).join(", "));
  console.log(label + ", a field: " + holders.map(h => h.ask()).join(", "));
  console.log(label + ", captured: " + captured.map(f => f()).join(", ") + ", total " + total(shapes));
  console.log(label + ", new ones: " + [new Square(3), new Rectangle(3, 4), new Dot()].map(describe).join(", "));
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += total(shapes) + describe(shapes[i % 4]).length;
console.log("2000 honest: " + warm);
everywhere("before");

const original = Rectangle.prototype.area;
Rectangle.prototype.area = function () {
  return -(this.width + this.height);
};
everywhere("the rectangle's area replaced");

Dot.prototype.name = () => "a dot, renamed";
everywhere("the dot's name replaced too");

shapes[0].area = () => 0.5;
everywhere("one square covers its area through the interface");

literal.area = () => 2000;
everywhere("the literal's method replaced");

Rectangle.prototype.area = original;
Reflect.deleteProperty(shapes[0], "area");
everywhere("the rectangle and the square restored");

function squareOnly(s: Square): number {
  return s.area();
}

const typedSquare = new Square(4);
const asShape: Shape = typedSquare;
console.log("typed as its class: " + squareOnly(typedSquare));
asShape.area = () => -4;
console.log("covered through the interface, called through the class: " + squareOnly(typedSquare) + " " + typedSquare.area() + " " + squareOnly(new Square(4)));

export {};
