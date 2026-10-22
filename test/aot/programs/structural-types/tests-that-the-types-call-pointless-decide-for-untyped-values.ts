interface Point {
  x: number;
  y: number;
}

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function aNumber(n: number): string {
  if (n === undefined) return "undefined";
  if (n === null) return "null";
  if (typeof n !== "number") return "typeof says " + typeof n;
  if (n !== n) return "not a number";
  return "number " + (n + 1);
}

function aNumberLoosely(n: number): unknown {
  return [n == null, n ?? "fallback", !n, !!n, n ? "truthy" : "falsy", typeof n === "number", Number.isInteger(n), Number.isNaN(n)];
}

function aText(s: string): string {
  if (s === undefined) return "undefined";
  if (s === null) return "null";
  if (typeof s !== "string") return "typeof says " + typeof s;
  return "text " + s.length;
}

function aTextLoosely(s: string): unknown {
  return [s == null, s ?? "fallback", !s, s || "empty", s?.length, typeof s === "string"];
}

function aPoint(p: Point): string {
  if (p === undefined) return "undefined";
  if (p === null) return "null";
  if (typeof p !== "object") return "typeof says " + typeof p;
  if (p.x === undefined) return "no x";
  if (typeof p.y !== "number") return "y is " + typeof p.y;
  return "point " + (p.x + p.y);
}

function aPointLoosely(p: Point): unknown {
  return [p == null, p?.x, p?.y ?? "no y", !p, typeof p, p instanceof Object, Array.isArray(p)];
}

function aList(list: number[]): string {
  if (!list) return "nothing";
  if (!Array.isArray(list)) return "no list: " + typeof list;
  if (list.length === undefined) return "no length";
  return "list of " + list.length;
}

function aFunction(f: () => number): string {
  if (!f) return "nothing";
  if (typeof f !== "function") return "typeof says " + typeof f;
  return "function " + (f() + 1);
}

function aTruth(b: boolean): string {
  if (b === true) return "true";
  if (b === false) return "false";
  return "neither: " + typeof b + " " + (b ? "truthy" : "falsy");
}

class Holder {
  n: number;
  p: Point;
  constructor(text: string) {
    const data = JSON.parse(text);
    this.n = data.n;
    this.p = data.p;
  }
  describe(): unknown {
    return [this.n === undefined, this.n === null, typeof this.n, this.p === undefined, this.p === null, typeof this.p, this.p?.x ?? "no x"];
  }
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  warm += aNumber(i).length + aText("ab").length + aPoint({ x: i, y: 1 }).length + aList([i]).length + aFunction(() => i).length + aTruth(i % 2 === 0).length;
  warm += new Holder('{"n":1,"p":{"x":1,"y":2}}').n;
}
console.log("2000 honest rounds: " + warm);

const texts = ["1", "0", "-0", '"1"', '""', "true", "false", "null", "[]", "[1]", "{}", '{"x":1}', '{"x":1,"y":"2"}', '{"x":1,"y":2}', '{"length":1}'];
for (const text of texts) {
  attempt("a number is " + text, () => aNumber(JSON.parse(text)));
  attempt("a number, loosely, is " + text, () => aNumberLoosely(JSON.parse(text)));
  attempt("a text is " + text, () => aText(JSON.parse(text)));
  attempt("a text, loosely, is " + text, () => aTextLoosely(JSON.parse(text)));
  attempt("a point is " + text, () => aPoint(JSON.parse(text)));
  attempt("a point, loosely, is " + text, () => aPointLoosely(JSON.parse(text)));
  attempt("a list is " + text, () => aList(JSON.parse(text)));
  attempt("a function is " + text, () => aFunction(JSON.parse(text)));
  attempt("a truth is " + text, () => aTruth(JSON.parse(text)));
}

const missing = JSON.parse("{}").nothing;
attempt("undefined everywhere", () => [aNumber(missing), aText(missing), aPoint(missing), aList(missing), aFunction(missing), aTruth(missing)]);
attempt("undefined, loosely", () => [aNumberLoosely(missing), aTextLoosely(missing), aPointLoosely(missing)]);

for (const text of ['{"n":1,"p":{"x":1,"y":2}}', "{}", '{"n":null,"p":null}', '{"n":"1","p":"xy"}', '{"n":[1],"p":[1]}']) attempt("fields from " + text, () => new Holder(text).describe());

export {};
