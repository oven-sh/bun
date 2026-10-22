class Point {
  x = 3;
  norm(): number {
    return this.x * this.x;
  }
  twice(): number {
    return this.norm() * 2;
  }
}

class Locked {
  x = 3;
  norm(): number {
    return this.x * this.x;
  }
}

class Sealed {
  x = 3;
  norm(): number {
    return this.x * this.x;
  }
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function cover(target: { norm(): number }): string {
  target.norm = () => -1;
  return "stored";
}

function normOf(p: Point): number {
  return p.norm();
}

const before = new Point();
attempt("before the freeze, an instance covers the method", () => cover(before) + " " + normOf(before) + " own " + Object.hasOwn(before, "norm"));

Object.freeze(Point.prototype);
const p = new Point();
attempt("frozen, a plain store on an instance", () => {
  p.norm = () => -1;
  return "stored";
});
attempt("what runs", () => p.norm() + " " + normOf(p) + " " + p.twice() + " own " + Object.hasOwn(p, "norm"));
attempt("frozen, through a parameter", () => cover(p));
attempt("frozen, Reflect.set", () => Reflect.set(p, "norm", () => -1));
attempt("frozen, Object.assign", () => Object.assign(p, { norm: () => -1 }).norm());
attempt("what runs", () => p.norm() + " own " + Object.hasOwn(p, "norm"));
attempt("frozen, a definition still works", () => {
  Object.defineProperty(p, "norm", { value: () => -2, configurable: true, writable: true });
  return p.norm() + " " + normOf(p) + " " + p.twice();
});
attempt("and then a store works too", () => cover(p) + " " + normOf(p));
attempt("frozen, a store on the prototype", () => {
  Point.prototype.norm = () => -3;
  return "stored";
});
attempt("the one that covered it earlier", () => normOf(before));
attempt("a new instance", () => normOf(new Point()));

Object.defineProperty(Locked.prototype, "norm", { writable: false });
const l = new Locked();
attempt("one member made read-only, a store on an instance", () => cover(l));
attempt("what runs", () => l.norm() + " own " + Object.hasOwn(l, "norm"));
Object.defineProperty(Locked.prototype, "norm", { writable: true });
attempt("made writable again", () => cover(l) + " " + l.norm() + " own " + Object.hasOwn(l, "norm"));

Object.seal(Sealed.prototype);
const s = new Sealed();
attempt("sealed, a store on an instance", () => cover(s) + " " + s.norm());
attempt("sealed, a store on the prototype", () => cover(Sealed.prototype) + " " + new Sealed().norm());
attempt("sealed, a delete on the prototype", () => Reflect.deleteProperty(Sealed.prototype, "norm") + " " + new Sealed().norm());

const fixed = Object.preventExtensions(new Locked());
attempt("an instance that cannot grow", () => cover(fixed));
attempt("what runs", () => fixed.norm() + " own " + Object.hasOwn(fixed, "norm"));

export {};
