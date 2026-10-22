console.log("strict: " + (function (this: unknown) {
  return this === undefined;
})());

interface Point {
  x: number;
  y: number;
}

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
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

function sum(p: Point): number {
  return p.x + p.y;
}

const library = require("./library.cjs");
const { three, point, step } = require("./library.cjs");

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const n: number = library.make("number");
  const p: Point = library.make("point");
  warm += plusOne(n) + sum(p);
}
console.log("2000 honest rounds: " + warm);

attempt("a number", () => {
  const n: number = library.three;
  const m: number = three;
  return [n + 1, plusOne(m), typeof n, [10, 20, 30, 40][n]];
});
attempt("a point", () => {
  const p: Point = library.point;
  const q: Point = point;
  return [p.x + p.y, sum(q), Object.keys(p).join(), p === q];
});
attempt("a function", () => {
  const f: (n: number) => number = step;
  return [f(1), f(1) + 1, [1, 2].map(f)];
});
attempt("a list", () => {
  const list: number[] = library.list;
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return [total, list.length, Array.isArray(list)];
});
attempt("a list, iterated", () => {
  const list: number[] = library.list;
  let total = 0;
  for (const n of list) total += n;
  return total;
});
for (const kind of ["number", "text", "nothing", "list", "point", "texts", "unknown"]) {
  attempt("made: " + kind + ", as a number", () => {
    const n: number = library.make(kind);
    return [n + 1, plusOne(n)];
  });
  attempt("made: " + kind + ", as a point", () => {
    const p: Point = library.make(kind);
    return [p.x, sum(p)];
  });
}
attempt("a class", () => {
  const p: Point = new library.Pixel("1", 2);
  return [sum(p), Object.keys(p).join()];
});
attempt("a typed callback", () => library.callBack(plusOne));
attempt("a typed callback that reads this", () =>
  library.callBack(function (this: Point, n: number) {
    return typeof this + " " + (n + 1);
  }),
);
attempt("an export that is not there", () => {
  const n: number = library.absent;
  return [n, n + 1];
});
attempt("a module that is a function", () => {
  const f: (n: number) => number = require("./replaced.cjs");
  return [f(1), f(1) + 1, require("./replaced.cjs").extra];
});
attempt("a built-in module", () => {
  const separator: number = require("node:path").posix.sep;
  return [separator + 1, typeof separator];
});
attempt("a json-like module cache", () => {
  const again = require("./library.cjs");
  again.three = 3;
  const n: number = library.three;
  return [n + 1, again === library];
});
