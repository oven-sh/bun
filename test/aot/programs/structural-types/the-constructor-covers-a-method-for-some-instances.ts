class Point {
  x: number;
  y: number;
  constructor(x: number, y: number, flat: boolean = false) {
    this.x = x;
    this.y = y;
    if (flat) this.norm = () => 0;
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

function describe(p: Point): string {
  return p.norm() + " " + normOf(p) + " " + p.twice() + " own " + Object.hasOwn(p, "norm") + " keys " + Object.keys(p).join();
}

console.log("round: " + describe(new Point(3, 4)));
console.log("flat: " + describe(new Point(3, 4, true)));
console.log("round again: " + describe(new Point(1, 1)));

const points: Point[] = [];
for (let i = 0; i < 2000; i++) points.push(new Point(1, 1, i % 500 === 499));
let sum = 0;
for (const p of points) sum += normOf(p) + p.twice();
console.log("2000 points, four of them flat: " + sum);

class Bound {
  name: string;
  constructor(name: string) {
    this.name = name;
    this.hello = this.hello.bind(this);
  }
  hello(): string {
    return "hello from " + this.name;
  }
}

function helloOf(b: Bound): string {
  return b.hello();
}

const b = new Bound("b");
const taken = b.hello;
console.log("bound in the constructor: " + b.hello() + " | " + helloOf(b) + " | " + taken() + " | own " + Object.hasOwn(b, "hello") + " | " + b.hello.name);
console.log("called for another: " + b.hello.call(new Bound("c")) + " | " + Bound.prototype.hello.call(new Bound("c")));
Bound.prototype.hello = () => "patched";
console.log("the prototype patched afterwards: " + helloOf(b) + " | " + helloOf(new Bound("d")));

export {};
