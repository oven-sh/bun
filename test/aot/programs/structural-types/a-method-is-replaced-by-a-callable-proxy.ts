const log: string[] = [];

class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  plus(dx: number, dy: number): number {
    return this.x + dx + this.y + dy;
  }
  static origin(): Point {
    return new Point(0, 0);
  }
}

function plusOf(p: Point): number {
  return p.plus(1, 2);
}

function line(label: string, value: unknown): void {
  console.log(label + ": " + String(value) + " [" + log.join(", ") + "]");
  log.length = 0;
}

const original = Point.prototype.plus;
const originalOrigin = Point.origin;

const logging = new Proxy(original, {
  apply(target, receiver, args) {
    log.push("apply with " + args.length + " arguments, this is a point: " + (receiver instanceof Point));
    return Reflect.apply(target, receiver, args) + 1000;
  },
  get(target, key, receiver) {
    log.push("get " + String(key));
    return Reflect.get(target, key, receiver);
  },
});

const silent = new Proxy(original, {});

const p = new Point(3, 4);
const q = new Point(1, 1);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += plusOf(p) + p.plus(0, 0) + plusOf(q);
line("2000 honest", warm);

p.plus = logging;
line("own proxy, directly", p.plus(1, 2));
line("own proxy, through a function", plusOf(p));
line("own proxy, call", p.plus.call(q, 1, 2));
line("own proxy, apply", p.plus.apply(q, [1, 2]));
line("own proxy, bind", p.plus.bind(q)(1, 2));
line("own proxy, name and length", p.plus.name + " " + p.plus.length);
line("typeof", typeof p.plus);
line("the other point", plusOf(q));

p.plus = silent;
line("a proxy without traps", p.plus(1, 2) + " " + plusOf(p));

Reflect.deleteProperty(p, "plus");
line("uncovered", plusOf(p));

Point.prototype.plus = logging;
line("on the prototype", p.plus(1, 2) + " " + plusOf(q) + " " + new Point(0, 0).plus(0, 0));
Point.prototype.plus = original;
line("put back", plusOf(p));

Point.origin = new Proxy(originalOrigin, {
  apply(target, receiver, args) {
    log.push("apply, this is the class: " + (receiver === Point));
    const made = Reflect.apply(target, receiver, args);
    made.x = 9;
    return made;
  },
});
line("a static method", JSON.stringify(Point.origin()));
Point.origin = originalOrigin;
line("put back", JSON.stringify(Point.origin()));

const { proxy, revoke } = Proxy.revocable(original, {});
p.plus = proxy;
line("revocable", plusOf(p));
revoke();
try {
  line("revoked", plusOf(p));
} catch (error) {
  line("revoked, threw", error instanceof Error ? error.constructor.name : typeof error);
}
line("revoked, typeof", typeof p.plus);
line("the other point at the end", plusOf(q));

export {};
