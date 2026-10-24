class Box<T> {
  value: T;
  constructor(value: T) {
    this.value = value;
  }
  get(): T {
    return this.value;
  }
  map<U>(f: (value: T) => U): Box<U> {
    return new Box(f(this.value));
  }
}

function text(value: unknown): string {
  return typeof value + " " + (typeof value === "number" && Object.is(value, -0) ? "-0" : typeof value === "object" ? JSON.stringify(value) : String(value));
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + text(body()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function numberOf(b: Box<number>): number {
  return b.get();
}

function plusOne(b: Box<number>): number {
  return b.get() + 1;
}

function times(b: Box<number>): number {
  return b.get() * 2;
}

function upper(b: Box<string>): string {
  return b.get().toUpperCase();
}

function lengthOf(b: Box<string>): number {
  return b.get().length;
}

function firstOf(b: Box<number[]>): number {
  return b.get()[0];
}

function nameOf(b: Box<{ name: string }>): string {
  return b.get().name;
}

function round(label: string): void {
  attempt(label + ", a number", () => numberOf(new Box(5)));
  attempt(label + ", plus one", () => plusOne(new Box(5)));
  attempt(label + ", times two", () => times(new Box(5)));
  attempt(label + ", stored in a list of numbers", () => {
    const list: number[] = [1];
    list.push(numberOf(new Box(5)));
    return list;
  });
  attempt(label + ", a string in capitals", () => upper(new Box("text")));
  attempt(label + ", the length of a string", () => lengthOf(new Box("text")));
  attempt(label + ", the first of a list", () => firstOf(new Box([7, 8])));
  attempt(label + ", the name of an object", () => nameOf(new Box({ name: "n" })));
  attempt(label + ", after map", () => plusOne(new Box("abc").map(s => s.length)));
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += plusOne(new Box(i)) + lengthOf(new Box("ab")) + firstOf(new Box([i]));
console.log("2000 honest: " + warm);
round("the method");

const original = Box.prototype.get;

Box.prototype.get = () => "a string";
round("always a string");

Box.prototype.get = () => 0.5;
round("always a fraction");

Box.prototype.get = () => undefined;
round("always undefined");

Box.prototype.get = () => null;
round("always null");

Box.prototype.get = () => [1, 2];
round("always a list");

Box.prototype.get = function () {
  return { name: this.value };
};
round("an object around the value");

Box.prototype.get = original;
round("restored");

export {};
