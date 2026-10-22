function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : text(error));
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": " + failure(error));
  }
}

function toInt(digits: string, radix: number = 10): number {
  let result = 0;
  for (let i = 0; i < digits.length; i++) {
    const digit = digits.charCodeAt(i) - 48;
    if (digit >= radix) return NaN;
    result = result * radix + digit;
  }
  return result;
}

function round(n: number, places: number = 0): number {
  const scale = 10 ** places;
  return Math.round(n * scale) / scale;
}

function pad(word: string, width: number = 3, fill: string = "0"): string {
  let out = word;
  while (out.length < width) out = fill + out;
  return out + "/" + typeof width + "/" + typeof fill;
}

function clamp(n: number, low: number = 0, high: number = 10): string {
  return text(n < low ? low : n > high ? high : n) + " low " + text(low) + " high " + (typeof high === "number" ? text(high) : typeof high);
}

function label(item: string, prefix: string | number = "#"): string {
  return typeof prefix + " " + prefix + item;
}

function add(a: number, b: number = 100): number {
  return a + b;
}

attempt("honest toInt", () => [toInt("10"), toInt("10", 2), toInt("10", 16)]);
attempt("map toInt", () => ["10", "10", "10", "10"].map(toInt));
attempt("map parseInt, for comparison", () => ["10", "10", "10", "10"].map(parseInt));
attempt("honest round", () => [round(1.256), round(1.256, 1), round(1.256, 2)]);
attempt("map round", () => [1.256, 1.256, 1.256].map(round));
attempt("map label", () => ["a", "b"].map(label));
attempt("map add", () => [1, 2, 3].map(add));
attempt("reduce add", () => [1, 2, 3].reduce(add));
attempt("reduce add with a start", () => [1, 2, 3].reduce(add, 0));
attempt("Array.from add", () => Array.from([1, 2, 3], add));
attempt("Array.from a length, add", () => Array.from({ length: 3 }, (_, i) => i).map(add));
attempt("flatMap add", () => [1, 2].flatMap(add));
attempt("typed array map add", () => Array.from(new Int8Array([1, 2, 3]).map(add)));
attempt("find by add", () => [-100, -1, 5].find(add));
attempt("findIndex by add", () => [-100, -1, 5].findIndex(add));
attempt("filter by add", () => [-100, -1, 5].filter(add));
attempt("a set's forEach gives the value twice", () => {
  const out: number[] = [];
  new Set([1, 2]).forEach((a, b) => out.push(add(a, b)));
  return out;
});

const padShort: (word: string, width?: number) => string = pad;
const clampShort: (n: number, low?: number) => string = clamp;
attempt("honest pad", () => [pad("7"), pad("7", 2), pad("7", 2, "x")]);
attempt("map pad: the list arrives as the fill", () => ["7", "8", "9", "1"].map(padShort));
attempt("honest clamp", () => [clamp(50), clamp(-5), clamp(5, 6), clamp(5, 0, 3)]);
attempt("map clamp: the list arrives as the upper bound", () => [50, -5, 1].map(clampShort));

let warm = 0;
for (let i = 0; i < 2000; i++) warm += add(i & 3) + toInt("12") + round(0.5);
console.log("2000 honest calls: " + warm);
attempt("map add after them", () => [1, 2, 3].map(add));
attempt("map toInt after them", () => ["11", "11", "11"].map(toInt));

attempt("replace with pad", () => "a-b".replace("-", padShort));
attempt("sort with add as the comparator", () => [3, 1, 2].toSorted(add));
