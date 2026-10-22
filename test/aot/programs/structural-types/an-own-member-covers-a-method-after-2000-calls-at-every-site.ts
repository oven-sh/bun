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

class Holder {
  point: Point;
  constructor(point: Point) {
    this.point = point;
  }
  ask(): number {
    return this.point.norm();
  }
}

function byParameter(p: Point): number {
  return p.norm();
}

function byElement(list: Point[], index: number): number {
  return list[index].norm();
}

const target = new Point(3, 4);
const other = new Point(1, 2);
const holder = new Holder(target);
const list = [other, target];
const captured = (): number => target.norm();

function round(): number {
  const local = target;
  return target.norm() + local.norm() + byParameter(target) + holder.ask() + byElement(list, 1) + captured();
}

function honestRound(): number {
  return other.norm() + byParameter(other) + byElement(list, 0);
}

function warm(label: string): void {
  let sum = 0;
  for (let i = 0; i < 2000; i++) sum += round() + honestRound();
  console.log(label + ": 2000 rounds " + sum + ", one round " + round() + ", an honest round " + honestRound());
}

warm("the method");

target.norm = () => 1;
warm("an own arrow");

target.norm = function () {
  return this.y;
};
warm("an own function");

const view: { norm?: () => number } = target;
delete view.norm;
warm("uncovered");

let flips = "";
for (let i = 0; i < 8; i++) {
  if (i % 2 === 0) target.norm = () => i;
  else delete view.norm;
  flips += round() + " ";
}
console.log("covered and uncovered in turn: " + flips);
warm("at the end");

export {};
