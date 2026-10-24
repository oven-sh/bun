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

function setBoth(p: Point): string {
  p.y = -2;
  p.x = -1;
  return "stored";
}

function make(): Point {
  return Object.freeze({ x: 1, y: 2 });
}

class Holder {
  point: Point;
  constructor(point: Point) {
    this.point = point;
  }
  move(): number {
    this.point.x += 10;
    return this.point.x;
  }
}

const local: Point = Object.freeze({ x: 1, y: 2 });
attempt("local", () => {
  local.x = 5;
  return local.x;
});
console.log("local afterwards: " + JSON.stringify(local));

attempt("parameter", () => setX(local, 6));
attempt("two stores, the first one throws", () => setBoth(local));
console.log("afterwards: " + JSON.stringify(local));
attempt("result", () => {
  const made = make();
  made.y = 7;
  return made.y;
});
attempt("result stored to at once", () => (make().x = 8));
attempt("field", () => new Holder(local).move());
const list: Point[] = [{ x: 0, y: 0 }, local, { x: 0, y: 0 }];
attempt("element", () => (list[1].x = 9));
attempt("every element", () => {
  for (const p of list) p.y = 3;
  return "all stored";
});
console.log("the array afterwards: " + JSON.stringify(list));
const captured = () => {
  local.y = 10;
};
attempt("captured", captured);
attempt("Object.assign", () => JSON.stringify(Object.assign(local, { x: 11 })));
attempt("Reflect.set answers", () => Reflect.set(local, "x", 12));
attempt("defineProperty", () => JSON.stringify(Object.defineProperty(local, "x", { value: 13 })));
attempt("defineProperty with the same value", () => JSON.stringify(Object.defineProperty(local, "x", { value: 1 })));
attempt("setPrototypeOf", () => JSON.stringify(Object.setPrototypeOf(local, null)));
console.log("still: " + JSON.stringify(local) + " " + Object.isFrozen(local));

const frozenLater = { x: 1, y: 2 };
attempt("before it is frozen", () => setX(frozenLater, 2));
Object.freeze(frozenLater);
attempt("after it is frozen", () => setX(frozenLater, 3));
console.log("holds: " + JSON.stringify(frozenLater));

class Pair {
  x = 1;
  y = 2;
  constructor(freeze: boolean) {
    if (freeze) Object.freeze(this);
  }
  shift(): number {
    this.x++;
    return this.x;
  }
}

attempt("an open instance", () => new Pair(false).shift());
attempt("a frozen instance's own method", () => new Pair(true).shift());
attempt("a frozen instance as a Point", () => setX(new Pair(true), 4));

const shallow: { inner: Point; name: string } = Object.freeze({ inner: { x: 1, y: 2 }, name: "outer" });
attempt("a member of a member", () => setX(shallow.inner, 5));
attempt("the member itself", () => {
  shallow.inner = { x: 0, y: 0 };
  return "replaced";
});
console.log("shallow: " + JSON.stringify(shallow));

export {};
