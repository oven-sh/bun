function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? text(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

declare global {
  interface Function {
    describe(): string;
    arity: number;
    note: string;
  }
}

function plain(a: number, b: number): number {
  return a + b;
}

const arrow = (a: number): number => a;

class Thing {
  method(): number {
    return 1;
  }
  static make(): Thing {
    return new Thing();
  }
}

function arityOf(f: Function): number {
  return f.arity;
}

function describeOf(f: Function): string {
  return f.describe();
}

show("typeof the method", () => [typeof plain.describe, typeof arrow.describe, typeof Thing.describe]);
show("called on a function", () => plain.describe());
show("called on an arrow", () => arrow.describe());
show("called on a class", () => Thing.describe());
show("called on a method", () => new Thing().method.describe());
show("called on a static method", () => Thing.make.describe());
show("called on a built-in", () => Math.max.describe());
show("called on a bound one", () => plain.bind(null).describe());
show("through a function", () => describeOf(plain));
show("the number", () => [plain.arity, arrow.arity, Thing.arity, Math.max.arity]);
show("the number plus one", () => plain.arity + 1);
show("the number beside the real one", () => [arityOf(plain), plain.length, arityOf(plain) + plain.length]);
show("the text", () => [plain.note, typeof plain.note]);
show("the length of the text", () => plain.note.length);
show("keys", () => [Object.keys(plain), Object.keys(Thing)]);
show("in", () => ["arity" in plain, "length" in plain]);

plain.arity = 2;
plain.note = "stored";
show("after a store on one", () => [plain.arity, arityOf(plain), plain.note.length, Object.keys(plain)]);
show("the others have none", () => [arityOf(arrow), arityOf(Thing), arrow.note]);
show("it still runs", () => [plain(1, 2), arrow(3), new Thing().method()]);

let sum = 0;
for (let i = 0; i < 2000; i++) sum += arityOf(plain);
show("2000 reads where it is", () => sum);
show("one where it is not", () => [arityOf(arrow), arityOf(arrow) + 1]);

export {};
