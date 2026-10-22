function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return "{" + Object.entries(value).map(([key, held]) => key + ": " + show(held)).join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

enum Fruit {
  Apple,
  Pear,
  Plum = 7,
  Twin = 7,
  Minus = -3,
  Half = 0.5,
  Huge = 2 ** 31,
}

function nameOf(fruit: Fruit): string {
  return Fruit[fruit];
}
function lengthOf(fruit: Fruit): number {
  return Fruit[fruit].length;
}
function byNumber(n: number): string {
  return Fruit[n];
}
function shout(n: number): string {
  return Fruit[n].toUpperCase();
}
function joined(n: number): string {
  return "<" + Fruit[n] + ">";
}
function there(n: number): boolean {
  return Fruit[n] !== undefined;
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += nameOf(i % 2).length + lengthOf(i % 2) + byNumber(7).length + shout(i % 2).length;
console.log("2000 honest rounds", warm);

attempt("keys", () => Object.keys(Fruit));
attempt("entries", () => Object.entries(Fruit));
attempt("members", () => [Fruit.Apple, Fruit.Pear, Fruit.Plum, Fruit.Twin, Fruit.Minus, Fruit.Half, Fruit.Huge]);
attempt("names of members", () => [Fruit[Fruit.Apple], Fruit[Fruit.Plum], Fruit[Fruit.Twin], Fruit[Fruit.Minus], Fruit[Fruit.Half], Fruit[Fruit.Huge]]);

const numbers: number[] = [0, 1, 2, 7, -3, 0.5, -0, 1.5, NaN, Infinity, 2 ** 31, 2 ** 31 + 1, -(2 ** 31), 2 ** 53, 999];
for (const n of numbers) {
  const label = show(n);
  const fruit: Fruit = n;
  attempt(label + " name", () => nameOf(fruit));
  attempt(label + " length", () => lengthOf(fruit));
  attempt(label + " by number", () => [byNumber(n), typeof byNumber(n), there(n), joined(n)]);
  attempt(label + " shouted", () => shout(n));
}
attempt("names kept in typed places", () => {
  const names: string[] = numbers.map(byNumber);
  let total = "";
  for (const name of names) total += name + ";";
  return [names, total];
});
