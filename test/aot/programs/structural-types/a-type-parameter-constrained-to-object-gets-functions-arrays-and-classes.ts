function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    if (list.length > 40) return "array of " + list.length + " with keys " + Object.keys(list).join();
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  for (const [key, member] of Object.entries(value)) parts.push(key + ": " + show(member));
  return "{" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

function keysOf<T extends object>(o: T): string[] {
  return Object.keys(o);
}

function countMembers<T extends object>(o: T): number {
  let count = 0;
  for (const key in o) if (key.length > 0) count++;
  return count;
}

function label<T extends object>(o: T, text: string): T & { label: string } {
  return Object.assign(o, { label: text });
}

function copy<T extends object>(o: T): T {
  return { ...o };
}

const seen = new WeakMap<object, number>();
function visit<T extends object>(o: T): number {
  const count = (seen.get(o) ?? 0) + 1;
  seen.set(o, count);
  return count;
}

function kind<T extends object>(o: T): string {
  return typeof o + " " + Array.isArray(o) + " " + (o instanceof Function) + " " + Object.prototype.toString.call(o);
}

class Point {
  static origin = 0;
  x = 1;
  static make(): Point {
    return new Point();
  }
}

function named(a: number, b: number): number {
  return a + b;
}

function study<T extends object>(title: string, make: () => T): void {
  console.log(title);
  attempt("  kind", () => kind(make()));
  attempt("  keys", () => keysOf(make()));
  attempt("  members", () => countMembers(make()));
  attempt("  a copy's keys", () => keysOf(copy(make())));
  attempt("  a copy's kind", () => kind(copy(make())));
  attempt("  labeled", () => {
    const labeled = label(make(), "tag");
    return [labeled.label, labeled.label.length, keysOf(labeled), typeof labeled];
  });
  attempt("  visited twice", () => {
    const o = make();
    return [visit(o), visit(o)];
  });
}

let total = 0;
for (let i = 0; i < 2000; i++) total += keysOf({ a: i, b: i }).length + countMembers({ a: i }) + label({ a: i }, "t").label.length + copy({ a: i }).a + visit({ a: i });
console.log("2000 honest rounds: " + total);

study("a literal", () => ({ a: 1, b: "two" }));
study("an instance", () => new Point());
study("a function", () => function (a: number): number {
  return a;
});
study("an arrow function", () => (): number => 1);
study("a bound function", () => named.bind(null, 1));
study("a class", () => class Local {
  static count = 3;
  y = 2;
});
study("an array", () => [10, 20]);
study("an array with a hole", () => new Array<number>(2));
study("a typed array", () => new Uint8Array(2));
study("a map", () => new Map([[1, 2]]));
study("a date", () => new Date(0));
study("a pattern", () => /a/g);
study("a string object", () => new String("ab"));
study("a number object", () => new Number(5));
study("a promise", () => Promise.resolve(1));
study("an error", () => new RangeError("r"));
study("an object without a prototype", (): object => Object.create(null));
attempt("a labeled function is still called", () => label((n: number) => n + 1, "inc")(1));
attempt("a labeled array is still summed", () => label([1, 2, 3], "list").reduce((a, b) => a + b, 0));
attempt("a labeled class is still constructed", () => new (label(Point, "class"))().x + Point.make().x);
attempt("the label stays on the class", () => keysOf(Point));

export {};
