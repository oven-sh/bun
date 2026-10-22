class Point {
  constructor(
    public x: number,
    public y: number,
  ) {}
  norm(): number {
    return Math.abs(this.x) + Math.abs(this.y);
  }
}

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
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

function plusOne(n: number): number {
  return n + 1;
}

function isThree(n: number): boolean {
  return n === 3;
}

function size(s: string): number {
  return s.length;
}

function not(b: boolean): boolean {
  return !b;
}

const table = [10, 20, 30, 40];

let warm = 0;
for (let i = 0; i < 2000; i++) warm += plusOne(i) + size("ab") + (isThree(i) ? 1 : 0) + (not(false) ? 1 : 0) + new Point(i, 1).norm();
console.log("2000 honest rounds: " + warm);

attempt("a boxed number in a variable", () => {
  const n: number = Object(3);
  return [typeof n, n + 1, n * 2, n === 3, n == 3, table[n], `${n}`, n.toFixed(1), JSON.stringify(n)];
});
attempt("a boxed number as a parameter", () => [plusOne(Object(3)), isThree(Object(3)), isThree(3)]);
attempt("two boxes of one number", () => {
  const a: number = Object(3);
  const b: number = Object(3);
  return [a === b, a == b, a <= b, a >= b, Object.is(a, b)];
});
attempt("a boxed number in a list, a set and a map", () => {
  const list: number[] = [3, Object(3)];
  const set = new Set<number>(list);
  const map = new Map<number, string>([[Object(3), "boxed"]]);
  return [list.indexOf(3), list.lastIndexOf(3), list.includes(Object(3)), set.size, set.has(3), map.get(3), list.map(plusOne)];
});
attempt("a boxed number is updated", () => {
  let n: number = Object(3);
  n++;
  return [n, typeof n];
});
attempt("a boxed zero is truthy", () => {
  const n: number = Object(0);
  return [n ? "truthy" : "falsy", !n, n || 5, n && 5];
});
attempt("a boxed text", () => {
  const s: string = Object("ab");
  return [typeof s, s.length, size(s), s + "!", s === "ab", s == "ab", s[0], Object.keys(s), JSON.stringify(s), s ? "truthy" : "falsy"];
});
attempt("a boxed empty text is truthy", () => {
  const s: string = Object("");
  return [s ? "truthy" : "falsy", s || "fallback", size(s)];
});
attempt("a boxed text as a key and in a switch", () => {
  const s: string = Object("a");
  const counts: Record<string, number> = { a: 1 };
  switch (s) {
    case "a":
      return ["matched", counts[s]];
    default:
      return ["not matched", counts[s]];
  }
});
attempt("a boxed false", () => {
  const b: boolean = Object(false);
  return [typeof b, b ? "truthy" : "falsy", not(b), b === false, b == false];
});
attempt("a boxed bigint", () => {
  const b: bigint = Object(3n);
  return [typeof b, b + 1n, b === 3n, b == 3n];
});
attempt("Object(null) and Object(undefined)", () => {
  const p: Point = Object(null);
  const q: Point = Object(undefined);
  return [typeof p, p.x, Object.keys(q), p === q];
});
attempt("Object(null), a method", () => {
  const p: Point = Object(null);
  return p.norm();
});
attempt("Object(a point) is the point", () => {
  const p = new Point(1, 2);
  const q: Point = Object(p);
  return [p === q, q.norm()];
});
attempt("the prototype of a point as a point", () => {
  const p: Point = Object.getPrototypeOf(new Point(1, 2));
  return [p.x, p.y, typeof p.norm, p.norm(), p instanceof Point, Object.keys(p)];
});
attempt("the prototype of a number as a number", () => {
  const n: number = Object.getPrototypeOf(3);
  return [typeof n, n + 1, plusOne(n)];
});
attempt("the prototype of a literal as a number", () => {
  const n: number = Object.getPrototypeOf({});
  return [typeof n, n + 1];
});
attempt("the prototype of a bare object as a point", () => {
  const p: Point = Object.getPrototypeOf(Object.create(null));
  return p === null ? "null" : p.x;
});
attempt("what setPrototypeOf returns as a point", () => {
  const p: Point = Object.setPrototypeOf({ x: "1", y: 2 }, Point.prototype);
  return [p.x, p.norm(), p instanceof Point, p.x + p.y];
});
attempt("what setPrototypeOf returns for a number", () => {
  const n: number = Object.setPrototypeOf(3, null);
  return [typeof n, n + 1];
});
attempt("the constructor member is called", () => {
  const p = new Point(1, 2);
  const made: Point = Reflect.construct(p.constructor, ["3", null]);
  return [made.x, made.y, made.norm(), made instanceof Point];
});
attempt("the constructor member of a number makes a number", () => {
  const three = 3;
  const n: number = three.constructor("4");
  const boxed: number = Reflect.construct(three.constructor, ["4"]);
  return [n, typeof n, n + 1, typeof boxed, boxed + 1];
});
attempt("the constructor member of a function makes a function from text", () => {
  const f: () => number = plusOne.constructor("return 'made'");
  return [f(), f() + 1];
});

console.log("honest again: " + [plusOne(1), size("ab"), isThree(3), not(true)].join(" "));

export {};
