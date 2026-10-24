interface Point {
  x: number;
  y: number;
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function setX(p: Point, value: number): number {
  p.x = value;
  return p.x;
}

function setY(p: Point, value: number): number {
  p.y = value;
  return p.y;
}

function lockX(p: Point): Point {
  return Object.defineProperty(p, "x", { writable: false });
}

const locked = lockX({ x: 1, y: 2 });
attempt("the locked member", () => setX(locked, 5));
attempt("the other member", () => setY(locked, 6));
console.log("holds: " + JSON.stringify(locked) + " frozen " + Object.isFrozen(locked) + " sealed " + Object.isSealed(locked));

const flipped = lockX({ y: 2, x: 1 });
attempt("another order, the locked member", () => setX(flipped, 5));
attempt("another order, the other member", () => setY(flipped, 6));
console.log("holds: " + JSON.stringify(flipped));

attempt("still configurable, so it can be redefined", () => JSON.stringify(Object.defineProperty(locked, "x", { value: 7 })));
attempt("and still not stored to", () => setX(locked, 8));
attempt("unlocked again", () => setX(Object.defineProperty(locked, "x", { writable: true }), 9));

const valueOnly: Point = Object.defineProperty({ x: 0, y: 2 }, "x", { value: 1, writable: false, configurable: false });
attempt("not configurable either", () => setX(valueOnly, 5));
attempt("redefining it", () => JSON.stringify(Object.defineProperty(valueOnly, "x", { value: 7 })));
attempt("deleting it", () => Reflect.deleteProperty(valueOnly, "x"));

const base = lockX({ x: 1, y: 2 });
const child: Point = Object.create(base);
attempt("inherited and not writable", () => setX(child, 5));
attempt("inherited and writable", () => setY(child, 6));
console.log("the child holds: " + JSON.stringify(child) + " reads " + child.x + "," + child.y);
attempt("defineProperty gets around it", () => Object.defineProperty(child, "x", { value: 7, writable: true, enumerable: true, configurable: true }).x);
attempt("and then a store works", () => setX(child, 8));

class Pair {
  x = 1;
  y = 2;
}
Object.defineProperty(Pair.prototype, "x", { value: -1, writable: false });
attempt("a field is defined over a locked member of the prototype", () => new Pair().x);
attempt("and can be stored to", () => setX(new Pair(), 5));

class Assigned {
  x: number;
  y: number;
  constructor() {
    this.x = 1;
    this.y = 2;
  }
}
attempt("declared fields, then assigned", () => JSON.stringify(new Assigned()));

const open: Point = { x: 0, y: 0 };
for (let i = 0; i < 2000; i++) setX(open, i);
console.log("2000 honest: " + open.x);
attempt("then a locked one", () => setX(lockX({ x: 1, y: 2 }), 5));
attempt("then an inherited locked one", () => setX(Object.create(base), 5));
attempt("then the open one", () => setX(open, 5));

const locking: Point = { x: 0, y: 0 };
attempt("locked in the middle of a loop", () => {
  for (let i = 1; i <= 2000; i++) {
    locking.x = i;
    locking.y = i;
    if (i === 700) lockX(locking);
  }
  return "finished";
});
console.log("stopped at: " + JSON.stringify(locking));

class Holder {
  constructor(public point: Point) {}
  shift(): string {
    this.point.y++;
    this.point.x++;
    return "shifted";
  }
}
const held = lockX({ x: 1, y: 2 });
attempt("through a field", () => new Holder(held).shift());
console.log("the first store happened: " + JSON.stringify(held));

export {};
