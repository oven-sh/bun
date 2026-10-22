function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : text(error));
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": " + failure(error));
  }
}

function lengths(a: string, b: string): string {
  return "a " + text(a) + ", b " + text(b) + ", lengths " + (a.length + b.length);
}

function joined(a: string, b: string): string {
  return "a " + text(a) + ", b " + text(b) + ", joined " + (a + b);
}

function sum(a: number, b: number, c: number): string {
  return [a, b, c].map(text).join(", ") + ", sum " + text(a + b + c) + ", whole " + text((a + b + c) | 0);
}

class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  norm(): number {
    return Math.abs(this.x) + Math.abs(this.y);
  }
}

function distance(from: Point, to: Point): string {
  return text(from) + " " + text(to) + " " + text(to.norm() - from.norm());
}

const looseLengths: (...parts: string[]) => string = lengths;
const looseJoined: (...parts: string[]) => string = joined;
const looseSum: (...parts: number[]) => string = sum;
const looseDistance: (...points: Point[]) => string = distance;
const LoosePoint: new (...parts: number[]) => Point = Point;

attempt("honest lengths", () => lengths("ab", "c"));
attempt("lengths of none", () => looseLengths());
attempt("lengths of one", () => looseLengths("ab"));
attempt("lengths of two", () => looseLengths("ab", "c"));
attempt("lengths of three", () => looseLengths("ab", "c", "d"));
attempt("lengths of a list", () => looseLengths(...["x"]));
attempt("lengths of an empty list", () => looseLengths(...[]));

attempt("joined of none", () => looseJoined());
attempt("joined of one", () => looseJoined("ab"));

attempt("honest sum", () => sum(1, 2, 3));
attempt("sum of none", () => looseSum());
attempt("sum of two", () => looseSum(1, 2));
attempt("sum of three", () => looseSum(1, 2, 3));
const list: number[] = [1, 2, 3];
attempt("sum of a list", () => looseSum(...list));
list.pop();
attempt("sum of the list after a pop", () => looseSum(...list));
attempt("sum of holes", () => looseSum(...new Array<number>(3)));

attempt("honest distance", () => distance(new Point(0, 0), new Point(1, 2)));
attempt("distance of one", () => looseDistance(new Point(1, 2)));
attempt("distance of none", () => looseDistance());

attempt("honest point", () => new Point(1, 2));
attempt("a point of one", () => {
  const p = new LoosePoint(1);
  return [p, Object.keys(p).join(), text(p.y), text(p.norm())];
});
attempt("a point of none", () => {
  const p = new LoosePoint();
  return [p, Object.keys(p).join(), text(p.x), text(p.norm())];
});

let warm = 0;
for (let i = 0; i < 2000; i++) warm += sum(i, 1, 2).length + lengths("a", "b").length;
console.log("2000 honest calls: " + warm);
attempt("sum of one after them", () => looseSum(5));
attempt("lengths of one after them", () => looseLengths("z"));
attempt("honest again", () => sum(1, 2, 3));

function callAll(functions: ((...parts: number[]) => string)[], ...parts: number[]): string[] {
  return functions.map(f => f(...parts));
}
attempt("in a list of functions", () => callAll([sum, looseSum, (...all) => "rest " + all.length], 1));

class Shape {
  scale(by: number, around: Point): string {
    return text(by) + " " + text(around) + " " + text(around.x * by);
  }
}
interface Scalable {
  scale(...given: never[]): string;
}
const scalable: Scalable = new Shape();
attempt("a method behind a rest of never", () => scalable.scale());
