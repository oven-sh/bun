class Point {
  x = 3;
  norm(): number {
    return this.x * this.x;
  }
  get half(): number {
    return this.x / 2;
  }
}

class Other {
  x = 0;
  norm(): number {
    return -100;
  }
  get half(): number {
    return -50;
  }
}

function normOf(p: Point): string {
  return p.norm() + " " + p.half;
}

const p = new Point();
const honest = new Point();

function round(label: string): void {
  console.log(label + ": " + p.norm() + " " + p.half + " | " + normOf(p) + " | honest " + normOf(honest) + " | " + (p instanceof Point));
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += normOf(p).length + normOf(honest).length;
console.log("2000 honest: " + warm);
round("before");

const near: Point = Object.create(Point.prototype);
Object.setPrototypeOf(p, near);
round("an empty link under the instance");

near.norm = () => -1;
round("the link gets the method");

Reflect.deleteProperty(near, "norm");
round("and loses it");

Object.defineProperty(near, "half", { get: () => -2, configurable: true });
round("the link gets the getter");

Reflect.deleteProperty(near, "half");
round("and loses it");

const far: Point = Object.create(Point.prototype);
Object.setPrototypeOf(near, far);
round("a second empty link above the first");

far.norm = () => -3;
round("the second link gets the method");

near.norm = () => -4;
round("the first one too");

Reflect.deleteProperty(near, "norm");
Reflect.deleteProperty(far, "norm");
round("both lose it");

Object.setPrototypeOf(far, Other.prototype);
round("the second link hangs under another class");

Object.setPrototypeOf(far, Point.prototype);
round("and back");

Object.setPrototypeOf(p, Point.prototype);
round("the instance hangs under its class again");

near.norm = () => -5;
round("a store to the link that is no longer used");

class Sub extends Point {}

function subNorm(s: Sub): string {
  return s.norm() + " " + s.half;
}

const s = new Sub();
for (let i = 0; i < 2000; i++) warm += subNorm(s).length;
const between: Point = Object.create(Point.prototype);
Object.setPrototypeOf(Sub.prototype, between);
console.log("an empty link above a subclass's prototype: " + subNorm(s) + " | " + normOf(s));
between.norm = () => -6;
console.log("it gets the method: " + subNorm(s) + " | " + normOf(s) + " | " + subNorm(new Sub()) + " | honest " + normOf(honest));
Reflect.deleteProperty(between, "norm");
console.log("and loses it: " + subNorm(s) + " | " + normOf(s));

export {};
