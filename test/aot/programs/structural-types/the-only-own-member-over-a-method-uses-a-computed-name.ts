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

function normOf(p: Point): number {
  return p.norm();
}

function minus(this: Point): number {
  return -this.x;
}

const five = (): number => 5;

const key: "norm" | "twice" = ["no", "rm"].join("") === "norm" ? "norm" : "twice";

const p = new Point(3, 4);
const q = new Point(1, 2);

function report(label: string): void {
  console.log(label + ": " + p.norm() + " " + normOf(p) + " " + p.twice() + " | " + q.norm() + " " + normOf(q) + " " + q.twice() + " | " + Object.hasOwn(p, "norm") + " " + Object.keys(p).join());
}

let sum = 0;
for (let i = 0; i < 2000; i++) sum += normOf(p) + p.norm() + p.twice() + normOf(q);
console.log("2000 honest rounds: " + sum);
report("before");
p[key] = minus;
report("covered by a function");
p[key] = five;
report("covered by an arrow");
Reflect.deleteProperty(p, "norm");
report("uncovered");
p[key] = five;
report("covered again");
Reflect.deleteProperty(p, "norm");
report("uncovered again");

export {};
