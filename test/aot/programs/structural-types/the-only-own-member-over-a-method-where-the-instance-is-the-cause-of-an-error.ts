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

const p = new Point(3, 4);
const q = new Point(1, 2);

const carrier = new Error("carrier", { cause: p });

function patch(replacement: () => number): void {
  const cause = carrier.cause;
  if (typeof cause === "object" && cause !== null && "norm" in cause) cause.norm = replacement;
}

function report(label: string): void {
  console.log(label + ": " + p.norm() + " " + normOf(p) + " " + p.twice() + " | " + q.norm() + " " + normOf(q) + " " + q.twice() + " | " + Object.hasOwn(p, "norm") + " " + Object.keys(p).join());
}

let sum = 0;
for (let i = 0; i < 2000; i++) sum += normOf(p) + p.norm() + p.twice() + normOf(q);
console.log("2000 honest rounds: " + sum);
report("before");
patch(minus);
report("covered by a function");
patch(five);
report("covered by an arrow");
Reflect.deleteProperty(p, "norm");
report("uncovered");
patch(five);
report("covered again");

export {};
