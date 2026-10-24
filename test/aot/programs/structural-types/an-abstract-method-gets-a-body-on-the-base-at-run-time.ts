abstract class Shape {
  side = 2;
  abstract area(): number;
  abstract get label(): string;
  describe(): string {
    return this.label + " " + this.area();
  }
}

class Square extends Shape {
  area(): number {
    return this.side * this.side;
  }
  get label(): string {
    return "square";
  }
}

class Line extends Shape {
  area(): number {
    return 0;
  }
  get label(): string {
    return "line";
  }
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function areaOf(s: Shape): number {
  return s.area();
}

function squareArea(s: Square): number {
  return s.area();
}

const square = new Square();
const line = new Line();

function round(label: string): void {
  attempt(label, () => areaOf(square) + " " + squareArea(square) + " " + square.describe() + " | " + areaOf(line) + " " + line.describe() + " | on the base " + typeof Shape.prototype.area);
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += areaOf(square) + squareArea(square) + areaOf(line) + square.describe().length;
console.log("2000 honest: " + warm);
round("before");
Shape.prototype.area = function () { return -this.side; };
round("the base got a body, the subclasses still override it");
const squareAreaWritten = Square.prototype.area;
Reflect.deleteProperty(Square.prototype, "area");
round("the square's override deleted");
Reflect.deleteProperty(Shape.prototype, "area");
round("the base's body deleted too");
Square.prototype.area = squareAreaWritten;
round("the square's override stored again");
Reflect.deleteProperty(Line.prototype, "label");
round("the line's getter deleted and nothing above it");

export {};
