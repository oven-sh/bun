class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  clone(): Point {
    return new Point(this.x, this.y);
  }
  norm(): number {
    return this.x * this.x + this.y * this.y;
  }
}

class Labeled extends Point {
  label = "labeled";
  norm(): number {
    return -1;
  }
}

function use(p: Point): string {
  const c = p.clone();
  return c.x + " " + c.y + " " + c.norm() + " " + (c instanceof Point) + " " + (c === p) + " " + Object.keys(c).join() + " " + JSON.stringify(c) + " " + Object.is(c.y, -0);
}

function store(p: Point): string {
  const c = p.clone();
  try {
    c.x = 50;
    c.y += 0.5;
  } catch (error) {
    return "threw " + (error instanceof Error ? error.constructor.name : typeof error) + " " + c.x + " " + c.y;
  }
  return c.x + " " + c.y + " " + p.x + " " + p.y;
}

function total(p: Point, rounds: number): number {
  let sum = 0;
  for (let i = 0; i < rounds; i++) {
    const c = p.clone();
    sum += c.x + c.y;
  }
  return sum;
}

const replacements: [string, (this: Point) => Point][] = [
  [
    "a subclass",
    function () {
      return new Labeled(this.x, this.y);
    },
  ],
  [
    "a literal with its members in another order",
    function () {
      return { norm: () => -2, y: this.y, extra: "extra", x: this.x, clone: this.clone };
    },
  ],
  [
    "the receiver itself",
    function () {
      return this;
    },
  ],
  [
    "a frozen point",
    function () {
      return Object.freeze(new Point(this.x, this.y));
    },
  ],
  [
    "a proxy of a point",
    function () {
      return new Proxy(new Point(this.x, this.y), {});
    },
  ],
  [
    "a literal with getters",
    function () {
      const source = this;
      return {
        get x() {
          return source.x * 100;
        },
        set x(value: number) {},
        get y() {
          return source.y * 100;
        },
        set y(value: number) {},
        norm: () => -3,
        clone: source.clone,
      };
    },
  ],
  [
    "a point with fractions",
    function () {
      return new Point(this.x + 0.25, -0);
    },
  ],
];

function round(label: string): void {
  console.log(label + ": " + use(new Point(3, 4)) + " | " + store(new Point(3, 4)) + " | " + total(new Point(3, 4), 3));
}

const original = Point.prototype.clone;
let warm = 0;
for (let i = 0; i < 2000; i++) warm += use(new Point(i, 1)).length + total(new Point(i, 1), 2);
console.log("2000 honest: " + warm);
round("the method");
for (const [label, replacement] of replacements) {
  round("never installed: " + label);
}
round("put back");

export {};
