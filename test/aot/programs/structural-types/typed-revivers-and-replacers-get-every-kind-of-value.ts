interface Point {
  x: number;
  y: number;
}

const log: string[] = [];

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  let line: string;
  try {
    line = label + " -> " + show(run());
  } catch (error) {
    line = label + " threw " + (error instanceof Error ? error.constructor.name : typeof error);
  }
  console.log(log.length > 0 ? line + " | " + log.join(" ") : line);
}

function doubled(key: string, value: number): number {
  log.push(key + ":" + typeof value);
  return value * 2;
}

function plusOne(key: string, value: number): number {
  return value + 1;
}

function shout(key: string, value: string): string {
  return value + "!";
}

function sizes(key: string, value: string): number {
  return value.length;
}

function holderOf(this: Point, key: string, value: number): number {
  log.push(typeof this.x + " " + Object.keys(this).join());
  return value;
}

function sum(p: Point): number {
  return p.x + p.y;
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += JSON.parse("3", doubled) + JSON.parse("3", plusOne);
console.log("2000 honest rounds: " + warm);

for (const text of ["3", '"3"', "true", "null", "[1,2]", '["a",2]', '{"a":1}', '{"a":"b","c":[1]}', "[[1]]", "{}"]) {
  attempt("a reviver that doubles numbers, " + text, () => JSON.stringify(JSON.parse(text, doubled)));
  attempt("a reviver that adds one, " + text, () => JSON.stringify(JSON.parse(text, plusOne)));
  attempt("a reviver that joins texts, " + text, () => JSON.stringify(JSON.parse(text, shout)));
  attempt("a reviver that measures texts, " + text, () => JSON.stringify(JSON.parse(text, sizes)));
}
attempt("this of a reviver", () => JSON.parse('{"x":1,"y":2}', holderOf));
attempt("this of a reviver, a list", () => JSON.parse("[1]", holderOf));

attempt("a reviver makes getters for a point", () => {
  const p: Point = JSON.parse('{"x":1,"y":2}', (key, value) =>
    key === ""
      ? Object.defineProperty(value, "x", {
          get() {
            log.push("x");
            return "got";
          },
        })
      : value,
  );
  return [p.x, sum(p), Object.keys(p).join()];
});
attempt("a reviver makes a proxy for a point", () => {
  const p: Point = JSON.parse('{"x":1,"y":2}', (key, value) =>
    key === ""
      ? new Proxy(value, {
          get(target, name, receiver) {
            log.push("get " + String(name));
            return Reflect.get(target, name, receiver);
          },
        })
      : value,
  );
  return [p.x, sum(p)];
});
attempt("a reviver drops a member of a point", () => {
  const p: Point = JSON.parse('{"x":1,"y":2}', (key, value) => (key === "x" ? undefined : value));
  return [p.x, sum(p), "x" in p, Object.keys(p).join()];
});
attempt("a reviver makes functions", () => {
  const f: (n: number) => number = JSON.parse('"n"', () => (n: number) => n + "!");
  return [f(1), f(1) + 1];
});
attempt("a reviver changes the holder while it is walked", () => {
  const p: Point = JSON.parse('{"x":1,"y":2}', function (key, value) {
    if (key === "x") this.y = "changed";
    return value;
  });
  return [p.x, p.y, sum(p)];
});

const data = { n: 1, s: "a", list: [1, "b"], inner: { n: 2 }, none: null, yes: true };
attempt("a replacer that doubles numbers", () => JSON.stringify(data, doubled));
attempt("a replacer that adds one", () => JSON.stringify(data, plusOne));
attempt("a replacer that joins texts", () => JSON.stringify(data, shout));
attempt("a replacer that measures texts", () => JSON.stringify(data, sizes));
attempt("a replacer over a number", () => [JSON.stringify(3, doubled), JSON.stringify(3, plusOne)]);
attempt("this of a replacer", () => JSON.stringify({ x: 1, y: 2 }, holderOf));

class Money {
  constructor(public cents: number) {}
  toJSON(key: number): number {
    log.push(typeof key + " " + show(key));
    return this.cents + key;
  }
}
attempt("toJSON declares a number for its key", () => JSON.stringify({ price: new Money(5), list: [new Money(6)] }));
attempt("toJSON at the top", () => JSON.stringify(new Money(7)));
attempt("toJSON called honestly", () => new Money(1).toJSON(2));

attempt("what stringify returns for a function", () => {
  const text: string = JSON.stringify(() => 1);
  return [typeof text, text + "!"];
});
attempt("what stringify returns for undefined, its length", () => {
  const text: string = JSON.stringify(undefined);
  return text.length;
});

export {};
