class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  norm(): number {
    return this.x * this.x + this.y * this.y;
  }
}

class Swapped {
  y: number;
  x: number;
  extra = "extra";
  constructor(x: number, y: number) {
    this.y = y;
    this.x = x;
  }
  norm(): number {
    return -1;
  }
}

class Raised extends Point {
  z = 9;
  norm(): number {
    return super.norm() + 100;
  }
}

class Factory {
  static Kind: new (x: number, y: number) => Point = Point;
  Kind: new (x: number, y: number) => Point = Point;
  make(x: number, y: number): Point {
    return new this.Kind(x, y);
  }
  static make(x: number, y: number): Point {
    return new Factory.Kind(x, y);
  }
  static makeThis(x: number, y: number): Point {
    return new this.Kind(x, y);
  }
}

function describe(p: Point): string {
  return p.constructor.name + " " + p.x + " " + p.y + " " + p.norm() + " " + (p instanceof Point) + " " + Object.keys(p).join() + " " + JSON.stringify(p);
}

function makeWith(f: Factory): string {
  return describe(f.make(1, 2));
}

const f = new Factory();
const other = new Factory();

function round(label: string): void {
  console.log(label + ", a field: " + makeWith(f) + " | the other " + makeWith(other));
  console.log(label + ", a static member: " + describe(Factory.make(1, 2)) + " | " + describe(Factory.makeThis(1, 2)));
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += f.make(i, 1).norm() + Factory.make(i, 1).x + Factory.makeThis(1, i).y;
console.log("2000 honest: " + warm);
round("the class itself");

export {};
