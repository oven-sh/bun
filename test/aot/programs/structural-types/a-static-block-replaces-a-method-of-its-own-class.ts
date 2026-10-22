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
  twice(): number {
    return this.norm() * 2;
  }
  static zero(): Point {
    return new Point(0, 0);
  }
  static written = Point.prototype.norm;
  static writtenZero = Point.zero;
  static {
    this.prototype.norm = function () {
      return -this.x;
    };
    this.zero = () => new Point(7, 7);
  }
}

function normOf(p: Point): number {
  return p.norm();
}

const p = new Point(3, 4);
let sum = 0;
for (let i = 0; i < 2000; i++) sum += normOf(p) + p.norm() + p.twice() + Point.zero().x;
console.log("2000 rounds: " + sum);
console.log("what runs: " + p.norm() + " " + normOf(p) + " " + p.twice() + " " + JSON.stringify(Point.zero()));
console.log("what was written: " + Point.written.call(p) + " " + JSON.stringify(Point.writtenZero()));
console.log("the same: " + (Point.prototype.norm === Point.written) + " " + (Point.zero === Point.writtenZero));
Point.prototype.norm = Point.written;
Point.zero = Point.writtenZero;
console.log("put back: " + p.norm() + " " + normOf(p) + " " + p.twice() + " " + JSON.stringify(Point.zero()));

export {};
