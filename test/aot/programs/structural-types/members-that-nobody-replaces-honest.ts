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
  get sum(): number {
    return this.x + this.y;
  }
  static origin(): Point {
    return new Point(0, 0);
  }
}

class Raised extends Point {
  norm(): number {
    return super.norm() + 100;
  }
}

class Holder {
  point: Point;
  scale: (n: number) => number;
  constructor(point: Point, factor: number) {
    this.point = point;
    this.scale = n => n * factor;
  }
  ask(): number {
    return this.scale(this.point.norm());
  }
}

function byParameter(p: Point): number {
  return p.norm();
}

function byElement(list: Point[]): number {
  let total = 0;
  for (const p of list) total += p.norm();
  return total;
}

function isRaised(p: Point): boolean {
  return p instanceof Raised;
}

const p = new Point(3, 4);
const raised = new Raised(1, 1);
const holder = new Holder(p, 2);
const list = [p, new Point(1, 0), raised];
const captured = (): number => p.norm();

function round(): number {
  const local = p;
  return p.norm() + local.norm() + byParameter(p) + holder.ask() + byElement(list) + captured() + p.twice() + p.sum + Point.origin().norm() + byParameter(raised) + (isRaised(raised) ? 1 : 0) + (isRaised(p) ? 1 : 0);
}

let sum = 0;
for (let i = 0; i < 2000; i++) sum += round();
console.log("2000 rounds: " + sum);
console.log("directly: " + p.norm());
console.log("a parameter: " + byParameter(p));
console.log("a field: " + holder.ask());
console.log("elements: " + byElement(list));
console.log("captured: " + captured());
console.log("from another method: " + p.twice());
console.log("a getter: " + p.sum);
console.log("a static method: " + JSON.stringify(Point.origin()));
console.log("a subclass through super: " + byParameter(raised) + " " + raised.twice());
console.log("instanceof: " + isRaised(raised) + " " + isRaised(p));
console.log("in a template: " + `${p.norm()} ${[...list.map(byParameter)]}`);

export {};
