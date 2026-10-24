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

const numbers = [10, 20, 30, 40];
const strings = ["a", "b", "c", "d"];

function half(list: number[], i: number): number {
  return list[i / 2];
}

function middle(list: number[]): number {
  return list[list.length / 2];
}

function middleOfStrings(list: string[]): string {
  return list[(list.length - 1) / 2];
}

function timesZero(list: number[], n: number): number {
  return list[n * 0];
}

function remainder(list: number[], n: number): number {
  return list[n % list.length];
}

function scaled(list: number[], ratio: number): number {
  return list[ratio * list.length];
}

function floored(list: number[], ratio: number): number {
  return list[Math.floor(ratio * list.length)];
}

function truncated(list: number[], x: number): number {
  return list[x | 0];
}

function unsigned(list: number[], x: number): number {
  return list[x >>> 0];
}

function added(list: number[], i: number, offset: number): number {
  return list[i + offset];
}

function parsed(list: number[], text: string): number {
  return list[Number(text)];
}

function divided(list: number[], a: number, b: number): number {
  return list[a / b];
}

let total = 0;
for (let i = 0; i < 2000; i++) total += half(numbers, (i % 2) * 2) + middle(numbers) + timesZero(numbers, i) + remainder(numbers, i) + floored(numbers, (i % 4) / 4) + truncated(numbers, i % 4) + added(numbers, i % 2, 1);
console.log("2000 honest rounds: " + total);

attempt("i / 2", () => [0, 1, 2, 3, 4, 7, 8, -1].map(i => half(numbers, i)));
attempt("the middle", () => [middle([1, 2]), middle([1, 2, 3]), middle([]), middle([1])]);
attempt("the middle of strings", () => [middleOfStrings(["a", "b", "c"]), typeof middleOfStrings(["a", "b"]), typeof middleOfStrings([])]);
attempt("the middle of strings: a method", () => middleOfStrings(["a", "b"]).toUpperCase());
attempt("n * 0", () => [timesZero(numbers, 5), timesZero(numbers, -5), timesZero(numbers, Infinity), timesZero(numbers, NaN)]);
attempt("n % length", () => [5, -1, -4, 4.5, NaN, Infinity, -0].map(n => remainder(numbers, n)));
attempt("n % the length of an empty list", () => typeof remainder([], 1));
attempt("ratio * length", () => [0, 0.25, 0.3, 0.5, 0.999, 1, -0.25].map(ratio => scaled(numbers, ratio)));
attempt("floored", () => [0, 0.3, 0.999, 1, -0.1, NaN].map(ratio => floored(numbers, ratio)));
attempt("x | 0", () => [1.9, -0.9, -1.1, NaN, 2 ** 32 + 1, 2 ** 31, Infinity].map(x => truncated(numbers, x)));
attempt("x >>> 0", () => [1.9, -0.9, -1, 2 ** 32 + 2, NaN].map(x => unsigned(numbers, x)));
attempt("i + offset", () => [added(numbers, 1, 1), added(numbers, 2147483647, 1), added(numbers, 2147483647, -2147483646), added(numbers, -2147483648, -1), added(numbers, 0.5, 0.5), added(numbers, 0.1, 0.2), added(numbers, 1e16, 1)]);
attempt("parsed", () => ["1", "1.0", "01", " 1 ", "1e0", "0x1", "", "one", "-0", "1.5"].map(text => parsed(numbers, text)));
attempt("a / b", () => [divided(numbers, 4, 2), divided(numbers, 1, 3), divided(numbers, 0, -1), divided(numbers, 1, 0), divided(numbers, 0, 0), divided(numbers, 6, 4)]);
attempt("stores", () => {
  const list = [1, 2, 3];
  const odd: number[] = [1 / 2, 3 * 0.5, -1 * 0, 0 / 0, 4 / 2];
  for (const key of odd) list[key] = 9;
  return [show(list), Object.keys(list)];
});
attempt("an index that overflows in a loop", () => {
  const seen: string[] = [];
  for (let i = 2147483645; i < 2147483650; i++) seen.push(typeof numbers[i] + " " + typeof numbers[i - 2147483645]);
  return seen;
});
attempt("an index that counts down past zero", () => {
  const seen: string[] = [];
  for (let i = 1; i >= -2; i--) seen.push(typeof strings[i]);
  return seen;
});
attempt("an index that steps by a half", () => {
  const seen: string[] = [];
  for (let i = 0; i < 2; i += 0.5) seen.push(show(strings[i]));
  return seen;
});
attempt("an index that steps by a tenth", () => {
  const seen: string[] = [];
  for (let i = 0; i <= 1; i += 0.1) seen.push(typeof strings[i * 10]);
  return seen;
});

export {};
