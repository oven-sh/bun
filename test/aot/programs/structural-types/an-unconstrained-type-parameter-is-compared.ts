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

const log: string[] = [];

function less<T>(a: T, b: T): boolean {
  return a < b;
}

function atMost<T>(a: T, b: T): boolean {
  return a <= b;
}

function largest<T>(list: T[]): T {
  let best = list[0];
  for (let i = 1; i < list.length; i++) if (list[i] > best) best = list[i];
  return best;
}

function order<T>(a: T, b: T): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

class Version {
  major: number;
  constructor(major: number) {
    this.major = major;
  }
  valueOf(): number {
    log.push("valueOf " + this.major);
    return this.major;
  }
}

class Label {
  text: string;
  constructor(text: string) {
    this.text = text;
  }
  toString(): string {
    log.push("toString " + this.text);
    return this.text;
  }
}

function study<T>(title: string, a: T, b: T): void {
  log.length = 0;
  attempt(title, () => [less(a, b), less(b, a), atMost(a, b), atMost(b, a), order(a, b), log.join()]);
}

let count = 0;
for (let i = 0; i < 2000; i++) count += (less(i, 1000) ? 1 : 0) + order(i, 1000) + largest([i, 3, 5]);
console.log("2000 rounds with integers: " + count);

study("integers", 1, 2);
study("fractions", 0.5, 0.25);
study("zero and minus zero", 0, -0);
study("a number and not a number", 1, NaN);
study("infinities", -Infinity, Infinity);
study("strings", "10", "9");
study("strings: a prefix", "ab", "abc");
study("strings: upper and lower case", "Z", "a");
study("big integers", 10n, 9n);
study("booleans", false, true);
study("null and null", null, null);
study("undefined and undefined", undefined, undefined);
study("objects with valueOf", new Version(1), new Version(2));
study("objects with toString", new Label("10"), new Label("9"));
study("plain objects", { a: 1 }, { a: 2 });
study("lists", [10], [9]);
study("lists of two", [1, 2], [1, 10]);
study("dates", new Date(1), new Date(2));
study<number | string>("a number and a string of digits", 10, "9");
study<number | string>("a number and a word", 10, "ten");
study<number | bigint>("a number and a big integer", 1.5, 2n);
study<string | bigint>("a string and a big integer", "3", 2n);
study<number | null>("a number and null", -1, null);
study<number | undefined>("a number and undefined", 1, undefined);
study<number | Version>("a number and an object with valueOf", 1, new Version(2));
study<string | Label>("a string and an object with toString", "10", new Label("9"));
study<symbol | number>("a symbol and a number", Symbol("s"), 1);
attempt("largest", () => [largest([1, 3, 2]), largest([0.5, 0.25]), largest(["10", "9"]), largest<number | string>([10, "9", 8]), largest([1n, 3n]), largest<number>([]), largest([NaN, 1]), largest([1, NaN])]);
attempt("sorted by order", () => [[3, 1, 2].toSorted(order), ["b", "a"].toSorted(order), [10, 9, 1].toSorted(order), ["10", "9", "1"].toSorted(order)]);

export {};
