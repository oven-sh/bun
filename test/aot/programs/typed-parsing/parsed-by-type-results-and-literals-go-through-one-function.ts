function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  const parent = Object.getPrototypeOf(value);
  const mark = parent === Object.prototype ? "" : parent === null ? "without a prototype " : "with another prototype ";
  return mark + "{" + Object.entries(value).map(([key, held]) => JSON.stringify(key) + ": " + show(held)).join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

interface Point {
  x: number;
  y: number;
}
class Dot implements Point {
  constructor(
    public x: number,
    public y: number,
  ) {}
}

function norm(point: Point): number {
  return point.x * point.x + point.y * point.y;
}
function move(point: Point, by: number): Point {
  point.x += by;
  point.y -= by;
  return point;
}
function keys(point: Point): string {
  return Object.keys(point).join();
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += norm({ x: i, y: 1 }) + norm(new Dot(1, i)) + move({ x: i, y: i }, 1).x;
console.log("2000 honest literals and instances", warm);

const texts = ['{"x":3,"y":4}', '{"y":4,"x":3}', '{"x":0.5,"y":-0}', '{"w":0,"x":3,"y":4}', '{"x":3,"w":0,"y":4}', '{"x":3,"y":4,"z":5}', '{"y":1e21,"z":{},"x":1e-7}', '{"0":1,"x":3,"y":4}'];
for (const text of texts) {
  attempt(text, () => {
    const point = JSON.parse<Point>(text);
    return [norm(point), keys(point), move(point, 1), keys(point), JSON.stringify(point)];
  });
}
attempt("in one list with literals and instances", () => {
  const points: Point[] = [{ x: 1, y: 2 }, JSON.parse<Point>('{"y":2,"x":1}'), new Dot(1, 2), JSON.parse<Point>('{"z":0,"x":1,"y":2}'), { y: 2, x: 1 }];
  return [points.map(norm), points.map(keys), points.map(point => move(point, 0.5).x)];
});
attempt("a list that was parsed, then pushed to", () => {
  const points = JSON.parse<Point[]>('[{"x":1,"y":1},{"y":2,"x":2}]');
  points.push({ x: 3, y: 3 }, new Dot(4, 4));
  return [points.map(norm), points.map(keys)];
});
attempt("parsed 2000 times, each third with other keys", () => {
  let sum = 0;
  for (let i = 0; i < 2000; i++) sum += norm(JSON.parse<Point>(i % 3 === 0 ? '{"x":1,"y":2}' : i % 3 === 1 ? '{"y":2,"x":1}' : '{"k' + i + '":0,"x":1,"y":2}'));
  return sum;
});
attempt("honest again", () => [norm({ x: 3, y: 4 }), norm(new Dot(3, 4)), keys(new Dot(0, 0))]);
