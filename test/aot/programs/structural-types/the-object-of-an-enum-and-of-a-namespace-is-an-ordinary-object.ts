function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

enum Color {
  Red,
  Green,
}

enum Word {
  Yes = "yes",
  No = "no",
}

namespace Limits {
  export const depth = 3;
  export let width = 4;
  export function area(): number {
    return depth * width;
  }
}

function colorValue(): number {
  return Color.Green + 1;
}

function wordValue(): string {
  return Word.Yes + "!";
}

function limitValue(): number {
  return Limits.depth + Limits.width;
}

attempt("before", () => [colorValue(), wordValue(), limitValue(), Limits.area(), Color[1], Object.keys(Color), Object.keys(Word), Object.keys(Limits)]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += colorValue() + wordValue().length + limitValue() + Limits.area();
console.log("2000 rounds", warm);

const openColor: { Red: number; Green: number } = Color;
const openWord: { Yes: string } = Word;
const openLimits: { depth: number; width: number; area: () => number } = Limits;

attempt("a member of a numeric enum is stored to", () => {
  openColor.Green = 50;
  const seen: { readonly Green: number } = Color;
  return [Color.Green, colorValue(), seen.Green, Color[1], Color[50]];
});
attempt("a member of a string enum is stored to", () => {
  openWord.Yes = "maybe";
  const seen: { readonly Yes: string } = Word;
  return [Word.Yes, wordValue(), seen.Yes];
});
attempt("an exported const of a namespace is stored to", () => {
  openLimits.depth = 30;
  return [Limits.depth, limitValue(), Limits.area()];
});
attempt("an exported let of a namespace is stored to", () => {
  openLimits.width = 40;
  return [Limits.width, limitValue(), Limits.area()];
});
attempt("an exported function of a namespace is replaced", () => {
  openLimits.area = () => -1;
  return Limits.area();
});
attempt("the let is stored to by name", () => {
  Limits.width = 5;
  return [Limits.width, openLimits.width, limitValue()];
});
attempt("read by a computed name", () => {
  const names: ("Red" | "Green")[] = ["Red", "Green"];
  return names.map(n => Color[n]);
});
attempt("a member is deleted through an optional view", () => {
  const optional: { Red?: number } = Color;
  delete optional.Red;
  const seen: { readonly Red?: number } = Color;
  return [Color.Red, seen.Red, "Red" in Color, Object.keys(Color)];
});
attempt("frozen", () => {
  Object.freeze(Color);
  openColor.Green = 7;
  return Color.Green;
});
attempt("handed to a function that takes an object", () => {
  const count = (o: object): number => Object.keys(o).length;
  const values = (o: Record<string, string | number>): (string | number)[] => Object.values(o);
  return [count(Color), count(Word), count(Limits), values(Word)];
});
