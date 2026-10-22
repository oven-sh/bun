interface Point {
  x: number;
  y: number;
}

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function";
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

function size(s: string): number {
  return s.length;
}

const counts: { [name: string]: number } = { a: 1, b: 2 };
const points: Record<string, Point> = { home: { x: 1, y: 2 } };
const steps: Record<string, (n: number) => number> = { up: n => n + 1 };
const byNumber: { [index: number]: string } = { 0: "zero", 1: "one" };
const settings: { [name: string]: string } = Object.create({ inherited: "from the prototype" });
settings.own = "own";

function countOf(name: string): number {
  return counts[name];
}

function pointOf(name: string): Point {
  return points[name];
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += plusOne(countOf("a")) + sum(pointOf("home")) + steps["up"](i) + size(byNumber[0]);
console.log("2000 honest rounds: " + warm);

for (const name of ["a", "missing", "constructor", "toString", "__proto__", "hasOwnProperty", "", "0"]) {
  attempt("a count under " + JSON.stringify(name), () => {
    const n = countOf(name);
    return [typeof n, n + 1, plusOne(n)];
  });
  attempt("a point under " + JSON.stringify(name), () => {
    const p = pointOf(name);
    return [typeof p, p.x, sum(p)];
  });
  attempt("a step under " + JSON.stringify(name), () => {
    const f = steps[name];
    return [typeof f, f(1)];
  });
  attempt("a count is updated under " + JSON.stringify(name), () => {
    const own: { [name: string]: number } = { a: 1 };
    own[name]++;
    own[name] += 1;
    return [own[name], Object.keys(own).join(), JSON.stringify(own)];
  });
}

for (const index of [0, 1, 2, -1, 0.5, NaN, -0, 2 ** 32]) {
  attempt("a text under the number " + show(index), () => {
    const s = byNumber[index];
    return [typeof s, s + "!"];
  });
  attempt("its size under the number " + show(index), () => size(byNumber[index]));
}

attempt("inherited settings", () => [settings.own, settings.inherited, settings.missing, Object.keys(settings).join(), size(settings.inherited)]);
attempt("a setting that is not there, its size", () => size(settings.missing));

attempt("the environment", () => {
  process.env.IMPOSTOR_NUMBER = "5";
  Reflect.set(process.env, "IMPOSTOR_STORED_NUMBER", 5);
  Reflect.set(process.env, "IMPOSTOR_STORED_NOTHING", undefined);
  Reflect.set(process.env, "IMPOSTOR_STORED_LIST", [1, 2]);
  const names = ["IMPOSTOR_NUMBER", "IMPOSTOR_STORED_NUMBER", "IMPOSTOR_STORED_NOTHING", "IMPOSTOR_STORED_LIST", "IMPOSTOR_MISSING"];
  return names.map(name => typeof process.env[name] + " " + process.env[name]);
});
attempt("the environment, deleted", () => {
  delete process.env.IMPOSTOR_NUMBER;
  return [typeof process.env.IMPOSTOR_NUMBER, "IMPOSTOR_NUMBER" in process.env, (process.env.IMPOSTOR_NUMBER ?? "gone") + "!"];
});
attempt("the environment as Bun has it", () => {
  Bun.env.IMPOSTOR_OTHER = "other";
  return [process.env.IMPOSTOR_OTHER, typeof Bun.env.IMPOSTOR_MISSING];
});

attempt("values of a record that holds more than its type says", () => {
  const wide = { a: 1, b: "two", c: null };
  const narrow: { a: number } = wide;
  const values: number[] = Object.values(narrow);
  let total = 0;
  for (const n of values) total += n;
  return [total, values.map(plusOne)];
});
attempt("entries of a record that holds more than its type says", () => {
  const wide = { a: 1, b: "two" };
  const narrow: { a: number } = wide;
  const seen: number[] = [];
  for (const [, n] of Object.entries(narrow)) seen.push(plusOne(n));
  return seen;
});

export {};
