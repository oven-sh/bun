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
  interface Array<T> {
    last(): T;
    second: T;
    total: number;
  }
}

function lastOf(list: number[]): number {
  return list.last();
}

function secondOf(list: number[]): number {
  return list.second;
}

function lengthOf(list: number[]): number {
  return list.length;
}

const log: string[] = [];
function made(): number[] {
  log.push("the list was made");
  return [1, 2, 3];
}

const numbers = [1, 2, 3];
const words = ["a", "b"];
show("typeof the method", () => typeof numbers.last);
show("read", () => numbers.last);
show("called", () => numbers.last());
show("called on a fresh list", () => [4, 5].last());
show("called on what a call returns", () => made().last());
show("the log", () => log.join());
show("called if there", () => numbers.last?.());
show("its result used", () => numbers.last() + 1);
show("on strings", () => words.last().length);
show("on an empty list", () => {
  const none: number[] = [];
  return none.last();
});
show("through a function", () => lastOf(numbers));
show("the member", () => numbers.second);
show("the member plus one", () => numbers.second + 1);
show("the member through a function", () => secondOf(numbers));
show("the member of strings", () => words.second);
show("the length of that", () => words.second.length);
show("the number", () => [numbers.total, numbers.total + 1, typeof numbers.total]);
show("in", () => ["last" in numbers, "second" in numbers, "length" in numbers]);
show("on the prototype", () => "last" in Array.prototype);
show("keys", () => Object.keys(numbers));
show("what every list really has still works", () => [numbers.at(-1), lengthOf(numbers), numbers.slice(-1), numbers.indexOf(3)]);

let failures = 0;
let sum = 0;
for (let i = 0; i < 2000; i++) {
  sum += lengthOf(numbers);
  try {
    sum += lastOf(numbers);
  } catch {
    failures++;
  }
}
show("2000 rounds", () => [sum, failures]);

export {};
