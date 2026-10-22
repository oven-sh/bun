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

function byLocal(make: () => Point): number {
  const local = make();
  return local.norm();
}

function byElement(list: Point[]): number {
  return list[0].norm();
}

function capture(p: Point): () => number {
  return () => p.norm();
}

const changed = new Point(3, 4);
const honest = new Point(1, 2);
const changedHolder = new Holder(changed);
const honestHolder = new Holder(honest);
const changedList = [changed];
const honestList = [honest];
const changedCapture = capture(changed);
const honestCapture = capture(honest);

function everywhere(label: string): void {
  console.log(label + ", the changed one, directly: " + changed.norm());
  console.log(label + ", the changed one, a parameter: " + byParameter(changed));
  console.log(label + ", the changed one, a local: " + byLocal(() => changed));
  console.log(label + ", the changed one, a field: " + changedHolder.ask());
  console.log(label + ", the changed one, an element: " + byElement(changedList));
  console.log(label + ", the changed one, captured: " + changedCapture());
  console.log(label + ", the honest one: " + [honest.norm(), byParameter(honest), byLocal(() => honest), honestHolder.ask(), byElement(honestList), honestCapture()].join(" "));
  console.log(label + ", own " + Object.hasOwn(changed, "norm") + ", keys " + Object.keys(changed).join() + ", json " + JSON.stringify(changed));
}

everywhere("before");

changed.norm = () => 5;
everywhere("an arrow");

changed.norm = function () {
  return this.x + 1000;
};
everywhere("a function that reads this");

const view: { norm?: () => number } = changed;
delete view.norm;
everywhere("uncovered");

changed.norm = Point.prototype.norm;
everywhere("the method itself as an own member");

changed.x = 10;
everywhere("after a store to x");

delete view.norm;
everywhere("uncovered again");

export {};
