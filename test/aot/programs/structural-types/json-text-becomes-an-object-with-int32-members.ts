import type { int32 } from "bun";

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return "{" + Object.entries(value).map(([key, held]) => key + ": " + show(held)).join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

class Cell {
  held: int32 = 0;
  next: int32 = 7;
}

function uses(v: int32): unknown[] {
  const cell = new Cell();
  cell.held = v;
  const pair: int32[] = [v, 1];
  return [typeof v, v, v + 1, v - 1, v * 2, v / 2, v % 2, -v, 1 / v, v | 0, v >>> 0, v >> 1, v << 1, ~v, v & 3, v === v, v === 0, v < 1, v >= 1, !v, String(v), cell.held, cell.next, pair[0], cell.held + pair[0], Math.abs(v), Math.floor(v), [10, 20, 30][v]];
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += uses(i | 0).length + uses(-i | 0).length;
console.log("4000 honest uses", warm);

const odd: number[] = JSON.parse("[1.5, -0, 2147483648, -2147483649, 1e21, 3]");
odd.push(NaN, Infinity);

interface Point {
  x: int32;
  y?: int32;
}
interface Line {
  from: Point;
  to: Point;
  marks: int32[];
}

function xOf(point: Point): int32 {
  return point.x;
}
function yOf(point: Point): int32 {
  return point.y ?? -1;
}
function span(line: Line): int32 {
  return (line.to.x - line.from.x) | 0;
}
function plainSpan(line: Line): number {
  return line.to.x - line.from.x;
}

let rounds = 0;
for (let i = 0; i < 2000; i++) rounds += xOf({ x: i | 0 }) + yOf({ x: 1, y: 2 });
console.log("2000 honest rounds", rounds);

const texts = ['{"x":1.5}', '{"x":-0}', '{"x":2147483648}', '{"x":1e400}', '{"x":"7"}', '{"x":null}', '{"x":true}', '{"x":[3]}', '{"x":{}}', "{}", '{"y":1.5,"x":4}', '{"x":4,"y":null}', '{"x":4,"y":"8"}', '{"x":3}'];
for (const text of texts) {
  attempt(text + " x", () => {
    const point: Point = JSON.parse(text);
    return uses(xOf(point));
  });
  attempt(text + " y", () => {
    const point: Point = JSON.parse(text);
    return [uses(yOf(point)), Object.keys(point), JSON.stringify(point)];
  });
}
attempt("nested", () => {
  const line: Line = JSON.parse('{"from":{"x":0.25},"to":{"x":2147483648},"marks":[1.5,null,"2"]}');
  const mark: int32 = line.marks[0];
  const none: int32 = line.marks[1];
  const text: int32 = line.marks[2];
  return [span(line), plainSpan(line), uses(mark), uses(none), uses(text)];
});
attempt("honest again", () => [xOf(JSON.parse('{"x":9}')), yOf({ x: 1 })]);
