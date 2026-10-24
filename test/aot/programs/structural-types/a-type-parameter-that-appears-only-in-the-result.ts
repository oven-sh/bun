function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

interface Point {
  x: number;
  y: number;
}

function parse<T>(text: string): T {
  return JSON.parse(text);
}

function blank<T>(): T {
  return Object.create(null);
}

function member<T>(o: object, key: string): T {
  return Reflect.get(o, key);
}

function firstOf<T>(list: unknown[]): T {
  const found = list.find((v): v is T => true);
  if (found === undefined) throw new RangeError("empty");
  return found;
}

function sum(p: Point): number {
  return p.x + p.y;
}

function half(n: number): number {
  return n / 2;
}

function total(list: number[]): number {
  let result = 0;
  for (let i = 0; i < list.length; i++) result += list[i];
  return result;
}

attempt("honest", () => [sum(parse<Point>('{"x":1,"y":2}')), half(parse<number>("4")), total(parse<number[]>("[1,2]")), half(member<number>({ n: 4 }, "n")), half(firstOf<number>([4]))]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += sum(parse<Point>('{"x":1,"y":' + i + "}")) + half(parse<number>(String(i))) + half(member<number>({ n: i }, "n")) + half(firstOf<number>([i]));
console.log("2000 honest rounds", warm);

for (const text of ['{"x":"1","y":2}', '{"y":2}', "{}", "[1,2]", "5", '"xy"', "null", '{"y":2,"x":1,"z":3}']) {
  attempt("parse<Point> " + text, () => sum(parse<Point>(text)));
  attempt("parse<Point> kept " + text, () => {
    const p: Point = parse(text);
    return [p.x, p.y];
  });
}
for (const text of ['"4"', "null", "[4]", "{}", "true", "-0", "1e400"]) {
  attempt("parse<number> " + text, () => half(parse<number>(text)));
  attempt("parse<number> plus one " + text, () => parse<number>(text) + 1);
}
for (const text of ['["1","2"]', '"12"', '{"length":1,"0":5}', "null", "[1,null]", "[[1]]"]) attempt("parse<number[]> " + text, () => total(parse<number[]>(text)));
attempt("the type argument is inferred from where it goes", () => {
  const n: number = parse('"text"');
  const s: string = parse("5");
  const f: () => number = parse("null");
  return [n + 1, typeof s, typeof f];
});
attempt("inferred, then called", () => {
  const f: () => number = parse("5");
  return f();
});
attempt("inferred, then a method", () => {
  const s: string = parse("5");
  return s.toUpperCase();
});
attempt("blank<Point>", () => [sum(blank<Point>()), Object.keys(blank<Point>()), Object.getPrototypeOf(blank<Point>())]);
attempt("blank<Point> in a template", () => `${blank<Point>()}`);
attempt("blank<number[]>", () => total(blank<number[]>()));
attempt("blank<() => number>", () => blank<() => number>()());
attempt("member of another type", () => [half(member<number>({ n: "8" }, "n")), half(member<number>({}, "n")), member<number>({ n: null }, "n") + 1]);
attempt("member that is inherited", () => typeof member<number>({}, "toString"));
attempt("firstOf of another type", () => [half(firstOf<number>(["8"])), firstOf<number>(["8"]) + 1, sum(firstOf<Point>([5]))]);
attempt("firstOf null", () => sum(firstOf<Point>([null])));
attempt("honest again", () => [sum(parse<Point>('{"x":1,"y":2}')), half(parse<number>("4")), total(parse<number[]>("[1,2]"))]);
