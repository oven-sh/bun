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
}

interface Target {
  norm(): number;
}

function normOf(p: Point): number {
  return p.norm();
}

function minus(this: Point): number {
  return -this.x;
}

const five = (): number => 5;

const original = Point.prototype.norm;
const p = new Point(3, 4);

function later(target: Target, replacement: () => number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(
      (arrived: Target) => {
        arrived.norm = replacement;
        resolve();
      },
      0,
      target,
    );
  });
}

function report(label: string): void {
  console.log(label + ": " + p.norm() + " " + normOf(p) + " " + p.twice() + " " + new Point(1, 1).norm() + " " + (Point.prototype.norm === original) + " " + Object.hasOwn(p, "norm"));
}

let sum = 0;
for (let i = 0; i < 2000; i++) sum += normOf(p) + p.norm() + p.twice();
console.log("2000 honest rounds: " + sum);
report("before");
await later(Point.prototype, minus);
report("replaced by a function");
await later(Point.prototype, five);
report("replaced by an arrow");
await later(Point.prototype, original);
report("put back");

export {};
