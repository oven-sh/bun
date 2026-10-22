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

let text = "1";

function aNumber(): number {
  return JSON.parse(text);
}

const anArrow = (): number => JSON.parse(text);

function aPoint(): Point {
  return JSON.parse(text);
}

async function later(): Promise<number> {
  return JSON.parse(text);
}

function* yielded(): Generator<number, number, undefined> {
  yield JSON.parse(text);
  return JSON.parse(text);
}

class Source {
  get value(): number {
    return JSON.parse(text);
  }
  method(): number {
    return JSON.parse(text);
  }
  static make(): number {
    return JSON.parse(text);
  }
}

function withDefault(n: number = JSON.parse(text)): number {
  return n + 1;
}

function withDefaultPoint(p: Point = JSON.parse(text)): number {
  return p.x + p.y;
}

function withPattern({ x, y = JSON.parse(text) }: { x: number; y?: number }): number {
  return x + y;
}

function add(a: number, b: number): number {
  return a + b;
}

function addAll(...rest: number[]): number {
  let total = 0;
  for (const n of rest) total += n;
  return total;
}

function spreadIntoAdd(): number {
  const [a, b] = JSON.parse(text);
  return add(a, b);
}

function spreadIntoRest(): number {
  return addAll(...JSON.parse(text));
}

function spreadIntoAList(): number[] {
  return [0, ...JSON.parse(text)];
}

function spreadIntoALiteral(): Point {
  return { x: 1, y: 2, ...JSON.parse(text) };
}

const numbers = ["1", "1.5", "-0", '"1"', "true", "null", "[1]", "{}"];

let warm = 0;
for (let i = 0; i < 2000; i++) warm += aNumber() + anArrow() + new Source().value + new Source().method() + Source.make() + withDefault() + withPattern({ x: 1 });
console.log("2000 honest rounds: " + warm);

for (text of numbers) {
  attempt("a result " + text, () => [aNumber(), aNumber() + 1, typeof aNumber()]);
  attempt("an arrow's result " + text, () => [anArrow() + 1, [1, 2].map(anArrow)]);
  attempt("a getter " + text, () => [new Source().value + 1, typeof new Source().value]);
  attempt("a method " + text, () => new Source().method() + 1);
  attempt("a static method " + text, () => Source.make() + 1);
  attempt("a default " + text, () => [withDefault(), withDefault(undefined), withDefault(1)]);
  attempt("a default in a pattern " + text, () => [withPattern({ x: 1 }), withPattern({ x: 1, y: 1 })]);
  attempt("yielded and returned " + text, () => {
    const g = yielded();
    const first = g.next();
    const last = g.next();
    return [first.value + 1, last.value + 1, [...yielded()]];
  });
  const awaited = await later();
  attempt("awaited " + text, () => [awaited, awaited + 1, typeof awaited]);
}

for (text of ['{"x":1,"y":2}', '{"y":2,"x":1}', '{"x":"1","y":"2"}', '{"x":1}', "{}", "[1,2]", '"xy"', "5"]) {
  attempt("a point as a result " + text, () => [aPoint().x + aPoint().y, Object.keys(aPoint()).join()]);
  attempt("a point as a default " + text, () => [withDefaultPoint(), withDefaultPoint({ x: 1, y: 2 })]);
  attempt("spread into a literal " + text, () => {
    const p = spreadIntoALiteral();
    return [p.x + p.y, JSON.stringify(p)];
  });
}
text = "null";
attempt("a point as a result null", () => aPoint().x);
attempt("a point as a default null", () => withDefaultPoint());
attempt("spread into a literal null", () => JSON.stringify(spreadIntoALiteral()));

for (text of ["[1,2]", '["1",2]', "[1]", "[]", "[1,2,3]", '"12"', "[null,[2]]"]) {
  attempt("two operands " + text, spreadIntoAdd);
  attempt("rest operands " + text, spreadIntoRest);
  attempt("spread into a list " + text, () => [spreadIntoAList(), addAll(...spreadIntoAList())]);
}
text = "{}";
attempt("rest operands {}", spreadIntoRest);
attempt("spread into a list 5", () => ((text = "5"), spreadIntoAList()));

export {};
