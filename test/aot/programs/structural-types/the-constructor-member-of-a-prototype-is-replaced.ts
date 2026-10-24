class Point {
  x = 1;
  static label = "point class";
  again(): object {
    return Reflect.construct(this.constructor, []);
  }
}

class Other {
  y = 2;
  static label = "other class";
}

class Sub extends Point {
  z = 3;
}

function nameOf(p: Point): string {
  return p.constructor.name;
}

function isItsClass(p: Point): boolean {
  return p.constructor === Point;
}

function facts(p: Point): string {
  return nameOf(p) + " " + isItsClass(p) + " " + (p instanceof Point) + " own " + Object.hasOwn(p, "constructor") + " again " + JSON.stringify(p.again()) + " " + p.again().constructor.name;
}

const p = new Point();
const s = new Sub();
let warm = 0;
for (let i = 0; i < 2000; i++) warm += nameOf(p).length + (isItsClass(p) ? 1 : 0) + nameOf(s).length;
console.log("2000 honest: " + warm);
console.log("before: " + facts(p) + " | " + facts(s));

Point.prototype.constructor = Other;
console.log("replaced on the prototype: " + facts(p) + " | " + facts(new Point()) + " | the subclass " + facts(s));

Point.prototype.constructor = Point;
console.log("put back: " + facts(p));

p.constructor = Other;
console.log("an own member: " + facts(p) + " | another " + facts(new Point()) + " | keys " + Object.keys(p).join());

Reflect.deleteProperty(p, "constructor");
console.log("removed: " + facts(p));

Reflect.deleteProperty(Sub.prototype, "constructor");
console.log("deleted from the subclass's prototype: " + facts(s));

Reflect.deleteProperty(Point.prototype, "constructor");
console.log("deleted from both: " + nameOf(p) + " " + nameOf(s) + " " + isItsClass(p) + " " + (p instanceof Point));

Object.defineProperty(Point.prototype, "constructor", { value: Point, writable: true, configurable: true });
Object.defineProperty(Sub.prototype, "constructor", { value: Sub, writable: true, configurable: true });
console.log("restored: " + facts(p) + " | " + facts(s));

export {};
