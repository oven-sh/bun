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
  scaled(k: number): number {
    return this.norm() * k;
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

function byElement(list: Point[]): number {
  let total = 0;
  for (const each of list) total += each.norm();
  return total;
}

function byResult(make: () => Point): number {
  return make().norm();
}

const old = new Point(3, 4);
const holder = new Holder(old);
const list = [old, new Point(1, 0)];
const captured = (): number => old.norm();

function everywhere(label: string): void {
  const local = old;
  console.log(label + ", directly: " + old.norm());
  console.log(label + ", a local: " + local.norm());
  console.log(label + ", a parameter: " + byParameter(old));
  console.log(label + ", a field: " + holder.ask());
  console.log(label + ", elements: " + byElement(list));
  console.log(label + ", captured: " + captured());
  console.log(label + ", a result: " + byResult(() => new Point(2, 2)));
  console.log(label + ", from another method: " + old.scaled(10));
  console.log(label + ", a new instance: " + new Point(5, 0).norm());
}

function warm(): number {
  let sum = 0;
  for (let i = 0; i < 2000; i++) sum += old.norm() + byParameter(old) + holder.ask() + byElement(list) + captured() + byResult(() => old) + old.scaled(2);
  return sum;
}

console.log("2000 rounds: " + warm());
everywhere("before");

const original = Point.prototype.norm;
Point.prototype.norm = function () {
  return this.x + this.y;
};
everywhere("replaced");
console.log("2000 rounds: " + warm());

Point.prototype.norm = () => -1;
everywhere("replaced by an arrow");

Point.prototype.norm = original;
everywhere("put back");
console.log("2000 rounds: " + warm());

export {};
