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
  Blue,
}

function nameOf(c: Color): string {
  switch (c) {
    case Color.Red:
      return "red";
    case Color.Green:
      return "green";
    case Color.Blue:
      return "blue";
  }
}

function reverse(c: Color): string {
  return Color[c];
}

function fromTable(c: Color): number {
  const table: Record<Color, number> = { [Color.Red]: 10, [Color.Green]: 20, [Color.Blue]: 30 };
  return table[c] + 1;
}

function fromList(c: Color): string {
  return ["r", "g", "b"][c].toUpperCase();
}

function next(c: Color): Color {
  return c + 1;
}

function isRed(c: Color): boolean {
  return c === Color.Red;
}

function notRedNotGreen(c: Color): string {
  if (c === Color.Red) return "red";
  if (c === Color.Green) return "green";
  const rest: Color.Blue = c;
  return "blue " + rest;
}

function masked(c: Color): number {
  return c & 3;
}

function asColor(n: number): Color {
  return n;
}

attempt("honest", () => [nameOf(Color.Red), nameOf(Color.Blue), reverse(Color.Green), fromTable(Color.Blue), fromList(Color.Red), next(Color.Red), isRed(Color.Red), notRedNotGreen(Color.Blue), masked(Color.Blue)]);
let warm = 0;
for (let i = 0; i < 2000; i++) {
  const c = asColor(i % 3);
  warm += nameOf(c).length + reverse(c).length + fromTable(c) + fromList(c).length + next(c) + masked(c);
}
console.log("2000 honest rounds", warm);

const numbers: number[] = [3, 999, -1, 0.5, 1.5, -0, NaN, Infinity, 2147483648, -2147483649, 4294967296, 1e21];
for (const n of numbers) {
  const c: Color = n;
  const label = Object.is(n, -0) ? "-0" : String(n);
  attempt(label + " name", () => nameOf(c));
  attempt(label + " name length", () => nameOf(c).length);
  attempt(label + " reverse", () => reverse(c));
  attempt(label + " fromTable", () => fromTable(c));
  attempt(label + " fromList", () => fromList(c));
  attempt(label + " next", () => next(c));
  attempt(label + " isRed", () => isRed(c));
  attempt(label + " notRedNotGreen", () => notRedNotGreen(c));
  attempt(label + " masked", () => masked(c));
}

attempt("next of the last member", () => nameOf(next(Color.Blue)));
attempt("arithmetic stays an enum", () => {
  let c: Color = Color.Red;
  c++;
  c += 5;
  c *= 0.5;
  return [c, nameOf(c)];
});
attempt("in a field", () => {
  class Pixel {
    color: Color = Color.Red;
    label(): string {
      return nameOf(this.color) + "!";
    }
  }
  const p = new Pixel();
  const n: number = 7;
  p.color = n;
  return p.label();
});
attempt("in elements", () => {
  const n: number = 7;
  const list: Color[] = [Color.Red, n, Color.Blue];
  return list.map(nameOf);
});
attempt("as a key of a map", () => {
  const m = new Map<Color, string>([[Color.Red, "r"]]);
  const zero: number = -0;
  const c: Color = zero;
  return [m.get(c), m.has(c)];
});
attempt("a number typed as one member", () => {
  const n: number = 2;
  const red: Color.Red = n;
  return [red, red === Color.Red, nameOf(red)];
});
attempt("honest again", () => [nameOf(Color.Red), reverse(Color.Green), fromTable(Color.Blue), fromList(Color.Red)]);
