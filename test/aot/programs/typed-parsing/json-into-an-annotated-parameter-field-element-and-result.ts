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

function norm(point: Point): number {
  return point.x * point.x + point.y * point.y;
}
function parsePoint(text: string): Point {
  return JSON.parse(text);
}
class Holder {
  point: Point;
  constructor(text: string) {
    this.point = JSON.parse(text);
  }
  norm(): number {
    return norm(this.point);
  }
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += norm({ x: i, y: 1 }) + norm(parsePoint('{"x":1,"y":2}')) + new Holder('{"x":2,"y":1}').norm();
console.log("2000 honest rounds", warm);

const texts = ['{"x":"3","y":4}', '{"x":3}', "{}", '{"y":4,"x":null}', "[3,4]", '"xy"', "7", "null", "true", '{"x":{"valueOf":1},"y":1}', '{"x":[2],"y":[3]}', '{"x":1e400,"y":-0}', '{"X":3,"Y":4}'];
for (const text of texts) {
  attempt(text + " as an argument", () => norm(JSON.parse(text)));
  attempt(text + " as a result", () => norm(parsePoint(text)));
  attempt(text + " in a field", () => new Holder(text).norm());
  attempt(text + " in an element", () => {
    const points: Point[] = [{ x: 1, y: 1 }, JSON.parse(text)];
    return points.map(norm);
  });
  attempt(text + " in a captured variable", () => {
    const point: Point = JSON.parse(text);
    const later = (): number => norm(point);
    return later();
  });
  attempt(text + " the whole list is parsed", () => {
    const points: Point[] = JSON.parse("[" + text + "]");
    let sum = 0;
    for (const point of points) sum += norm(point);
    return sum;
  });
}
const fromResponse: Point = await new Response('{"x":"3","y":4}').json();
attempt("out of a response", () => [norm(fromResponse), fromResponse]);
const fromRequest: Point = await new Request("http://localhost/", { method: "POST", body: "[1,2]" }).json();
attempt("out of a request", () => [norm(fromRequest), fromRequest]);
const fromBlob: Point = await new Blob(['{"y":2}']).json();
attempt("out of a blob", () => [norm(fromBlob), fromBlob]);
attempt("honest again", () => [norm(parsePoint('{"x":3,"y":4}')), new Holder('{"y":4,"x":3}').norm()]);

export {};
