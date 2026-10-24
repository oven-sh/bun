interface Point {
  x: number;
  y: number;
}

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function sumOfX(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) sum += points[i].x;
  return sum;
}

function count(points: Point[]): number {
  let n = 0;
  points.forEach(() => n++);
  return n;
}

function fill(points: Point[]): Point[] {
  for (let i = 0; i < points.length; i++) points[i] = { x: i, y: i };
  return points;
}

function total(numbers: number[]): number {
  let sum = 0;
  for (const n of numbers) sum += n;
  return sum;
}

console.log("honest callers: " + [sumOfX([{ x: 1, y: 2 }]), count([{ x: 1, y: 2 }]), sumOfX(fill([{ x: 5, y: 5 }])), total([1, 2])].join(" "));

attempt("Array(3) as points", () => {
  const points: Point[] = Array(3);
  return [points.length, count(points), 0 in points, points[0], points];
});
attempt("Array(3) as points, a member of an element", () => {
  const points: Point[] = Array(3);
  return sumOfX(points);
});
attempt("Array(3) as points, filled", () => {
  const points: Point[] = Array(3);
  return [sumOfX(fill(points)), count(points), points.map(p => p.y)];
});
attempt("new Array(3) as points, one stored", () => {
  const points: Point[] = new Array(3);
  points[1] = { x: 7, y: 8 };
  return [points.length, count(points), points[1].x, points.map(p => p.x), points.filter(() => true).length];
});
attempt("new Array() as points, pushed to", () => {
  const points: Point[] = new Array();
  points.push({ x: 1, y: 2 });
  return [sumOfX(points), points.length];
});
attempt("Array(a text) as points", () => {
  const length = JSON.parse('"3"');
  const points: Point[] = Array(length);
  return [points.length, points[0], typeof points[0]];
});
attempt("Array(a text) as points, a member", () => {
  const length = JSON.parse('"3"');
  const points: Point[] = Array(length);
  return sumOfX(points);
});
attempt("Array(1, 2) as points", () => {
  const points: Point[] = Array(JSON.parse("1"), JSON.parse("2"));
  return [points.length, sumOfX(points), points[0].x];
});
attempt("Array(a fraction)", () => {
  const points: Point[] = Array(JSON.parse("1.5"));
  return points.length;
});
attempt("Array(3) as numbers", () => {
  const numbers: number[] = Array(3);
  return [total(numbers), numbers[0], numbers[0] + 1, numbers.indexOf(0), numbers.includes(JSON.parse("{}").none), numbers.join()];
});
attempt("Array(3) as numbers, filled with a parsed value", () => {
  const numbers: number[] = Array(3).fill(JSON.parse('"1"'));
  return [total(numbers), numbers];
});
attempt("Array(3) as numbers, sorted and reversed", () => {
  const numbers: number[] = Array(3);
  numbers[2] = 5;
  numbers[0] = 9;
  return [numbers.slice().sort(), numbers.slice().reverse(), numbers.toSorted(), [...numbers]];
});
attempt("Array.from of a parsed list", () => {
  const points: Point[] = Array.from(JSON.parse('[{"x":"1","y":2},{"y":3},5,null]'));
  return [points.length, points[0].x + points[0].y, points[1].x, points[2].x];
});
attempt("Array.from of a parsed list, summed", () => sumOfX(Array.from(JSON.parse('[{"x":"1","y":2},{"y":3},5]'))));
attempt("Array.from of a parsed array-like", () => {
  const points: Point[] = Array.from(JSON.parse('{"length":2,"1":{"x":1,"y":2}}'));
  return [points.length, 0 in points, points[0], points[1].x];
});
attempt("Array.from of a parsed text", () => {
  const numbers: number[] = Array.from(JSON.parse('"12"'));
  return [total(numbers), numbers];
});
attempt("Array.from of a parsed number", () => {
  const numbers: number[] = Array.from(JSON.parse("12"));
  return [total(numbers), numbers];
});
attempt("Array.of parsed values", () => {
  const numbers: number[] = Array.of(JSON.parse('"1"'), JSON.parse("null"), 3);
  return [total(numbers), numbers];
});
attempt("concat onto new Array()", () => {
  const numbers: number[] = new Array().concat([1], "2", [[3]]);
  return [total(numbers), numbers, numbers.length];
});
attempt("a parsed list, flattened", () => {
  const numbers: number[] = JSON.parse('[1,["2",[3]]]').flat();
  return [total(numbers), numbers];
});
attempt("a length from parsed text", () => {
  const numbers: number[] = [1, 2, 3];
  numbers.length = JSON.parse('"1"');
  return [numbers, numbers.length, typeof numbers.length];
});
attempt("a length that is no length", () => {
  const numbers: number[] = [1, 2, 3];
  numbers.length = JSON.parse("1.5");
  return numbers;
});

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const points: Point[] = Array(2);
  warm += sumOfX(fill(points)) + count(points);
}
console.log("2000 rounds of Array(2), filled: " + warm);
attempt("and then not filled", () => {
  const points: Point[] = Array(2);
  return [count(points), sumOfX(points)];
});

export {};
