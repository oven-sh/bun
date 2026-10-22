function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

class Point {
  x = 1;
  y = 2.5;
  label = "point";
  sum(): number {
    return this.x + this.y;
  }
  describe(): string {
    return this.label + " " + this.x + " " + this.y;
  }
}

function bare(): Point {
  return Object.create(Point.prototype);
}

function sum(p: Point): number {
  return p.x + p.y;
}

function labelLength(p: Point): number {
  return p.label.length;
}

function fill(p: Point, x: number, y: number, label: string): Point {
  p.x = x;
  p.y = y;
  p.label = label;
  return p;
}

function fillBackwards(p: Point, x: number, y: number, label: string): Point {
  p.label = label;
  p.y = y;
  p.x = x;
  return p;
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = new Point();
  warm += sum(honest) + labelLength(honest) + honest.sum() + honest.describe().length + sum(fill(new Point(), i, 1, "l")) + sum(fillBackwards(new Point(), i, 1, "l"));
}
console.log("after 2000 honest points", warm);

attempt("nothing is there", () => {
  const p = bare();
  return [p.x, p.y, p.label, Object.keys(p), "x" in p, p instanceof Point];
});
attempt("the sum of nothing", () => [sum(bare()), bare().sum()]);
attempt("the length of no label", () => labelLength(bare()));
attempt("described", () => bare().describe());
attempt("filled in the order of the class", () => {
  const p = fill(bare(), 3, 4, "filled");
  return [sum(p), p.sum(), labelLength(p), Object.keys(p), JSON.stringify(p)];
});
attempt("filled backwards", () => {
  const p = fillBackwards(bare(), 3, 4, "filled");
  return [sum(p), p.sum(), labelLength(p), Object.keys(p), JSON.stringify(p)];
});
attempt("only y is filled", () => {
  const p = bare();
  p.y = 4;
  return [sum(p), Object.keys(p), p.describe()];
});
attempt("x++ on nothing", () => {
  const p = bare();
  p.x++;
  return [p.x, Object.keys(p)];
});
attempt("label += on nothing", () => {
  const p = bare();
  p.label += "!";
  return p.label;
});
attempt("another member comes first", () => {
  const p: Point & { extra?: number } = bare();
  p.extra = 9;
  fill(p, 3, 4, "late");
  return [sum(p), Object.keys(p)];
});
attempt("made with descriptors", () => {
  const p: Point = Object.create(Point.prototype, {
    y: { value: 4, writable: false, enumerable: true, configurable: false },
    x: { get: () => 3, enumerable: false, configurable: true },
  });
  return [sum(p), p.sum(), Object.keys(p), p.label];
});
attempt("a store to a member that cannot be written", () => {
  const p: Point = Object.create(Point.prototype, { y: { value: 4, writable: false } });
  p.y = 5;
  return p.y;
});
attempt("a store to a member that only has a getter", () => {
  const p: Point = Object.create(Point.prototype, { x: { get: () => 3 } });
  p.x = 5;
  return p.x;
});
attempt("among honest points", () => [new Point(), bare(), fill(bare(), 3, 4, "f"), new Point()].map(sum));
attempt("honest again", () => [sum(new Point()), new Point().describe()]);
