function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

type Wide = number | string | null | undefined | boolean;

interface Counts {
  at(v: Wide): string;
  put(v: Wide): string;
  loop(v: Wide): number;
  down(v: Wide): number;
  fresh(v: Wide): number;
  repeat(v: Wide): string;
  slice(v: Wide): string;
  odd(v: Wide): number;
  shift(v: Wide): number;
  floor(v: Wide): number;
  char(v: Wide): string;
  clamp(v: Wide): number;
  typed(v: Wide): number;
}

const letters = ["a", "b", "c", "d"];

class NumberCounts implements Counts {
  at(i: number): string {
    return letters[i];
  }
  put(i: number): string {
    const copy = ["a", "b"];
    copy[i] = "z";
    return copy.length + " " + Object.keys(copy).join("+");
  }
  loop(n: number): number {
    let rounds = 0;
    for (let i = 0; i < n; i++) rounds++;
    return rounds;
  }
  down(n: number): number {
    let rounds = 0;
    while (n > 0 && rounds < 10) {
      n--;
      rounds++;
    }
    return rounds;
  }
  fresh(n: number): number {
    return new Array<number>(n).length;
  }
  repeat(n: number): string {
    return "x".repeat(n);
  }
  slice(n: number): string {
    return letters.slice(n).join("");
  }
  odd(n: number): number {
    return n % 2;
  }
  shift(n: number): number {
    return n << 1;
  }
  floor(n: number): number {
    return Math.floor(n);
  }
  char(n: number): string {
    return "abcd".charAt(n);
  }
  clamp(n: number): number {
    return Math.min(Math.max(n, 0), 3);
  }
  typed(n: number): number {
    return new Uint8Array([7, 8, 9])[n];
  }
}

const counts: Counts = new NumberCounts();
const values: [string, Wide][] = [
  ["2", 2],
  ["1.5", 1.5],
  ["-1", -1],
  ["-0", -0],
  ["NaN", NaN],
  ["2 ** 31", 2 ** 31],
  ["2 ** 32 + 1", 2 ** 32 + 1],
  ["'2'", "2"],
  ["'02'", "02"],
  ["'length'", "length"],
  ["''", ""],
  ["null", null],
  ["undefined", undefined],
  ["true", true],
  ["2 again", 2],
];

for (const [label, value] of values) {
  show(label + " at", () => counts.at(value));
  show(label + " put", () => counts.put(value));
  if (value !== 2 ** 31 && value !== 2 ** 32 + 1) show(label + " loop", () => counts.loop(value));
  show(label + " down", () => counts.down(value));
  if (value !== 2 ** 31) show(label + " fresh", () => counts.fresh(value));
  if (value !== 2 ** 31 && value !== 2 ** 32 + 1) show(label + " repeat", () => counts.repeat(value));
  show(label + " slice", () => counts.slice(value));
  show(label + " odd", () => counts.odd(value));
  show(label + " shift", () => counts.shift(value));
  show(label + " floor", () => counts.floor(value));
  show(label + " char", () => counts.char(value));
  show(label + " clamp", () => counts.clamp(value));
  show(label + " typed", () => counts.typed(value));
}
