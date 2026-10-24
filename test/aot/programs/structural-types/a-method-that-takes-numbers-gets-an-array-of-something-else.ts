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

type Loose = (number | string | undefined | null | boolean | number[] | { valueOf(): number })[];

interface Stats {
  sum(list: Loose): number;
  sumOf(list: Loose): number;
  reduced(list: Loose): number;
  doubled(list: Loose): number[];
  whole(list: Loose): number[];
  largest(list: Loose): number;
  sorted(list: Loose): number[];
  sortedByValue(list: Loose): number[];
  first(list: Loose): number;
  firstFixed(list: Loose): string;
  hasTwo(list: Loose): boolean;
  grown(list: Loose): number;
  toFloats(list: Loose): number[];
  kinds(list: Loose): string;
}

class NumberStats implements Stats {
  sum(list: number[]): number {
    let total = 0;
    for (let i = 0; i < list.length; i++) total += list[i];
    return total;
  }
  sumOf(list: number[]): number {
    let total = 0;
    for (const n of list) total += n;
    return total;
  }
  reduced(list: number[]): number {
    return list.reduce((a, b) => a + b, 0);
  }
  doubled(list: number[]): number[] {
    return list.map(n => n * 2);
  }
  whole(list: number[]): number[] {
    return list.map(n => n | 0);
  }
  largest(list: number[]): number {
    return Math.max(...list);
  }
  sorted(list: number[]): number[] {
    return [...list].sort();
  }
  sortedByValue(list: number[]): number[] {
    return [...list].sort((a, b) => a - b);
  }
  first(list: number[]): number {
    return list[0];
  }
  firstFixed(list: number[]): string {
    return list[0].toFixed(1);
  }
  hasTwo(list: number[]): boolean {
    return list.includes(2);
  }
  grown(list: number[]): number {
    const copy = list.slice();
    copy.push(1.5);
    return copy[copy.length - 1] + copy.length;
  }
  toFloats(list: number[]): number[] {
    return Array.from(new Float64Array(list));
  }
  kinds(list: number[]): string {
    return list.map(n => typeof n).join();
  }
}

const stats: Stats = new NumberStats();
const holes: number[] = [1, 2, 3];
delete holes[1];
const lists: [string, Loose][] = [
  ["whole numbers", [3, 1, 2]],
  ["fractions", [1.5, 0.5, 2]],
  ["strings", ["3", "1", "2"]],
  ["words", ["b", "a"]],
  ["mixed", [1, "2", 3]],
  ["undefined inside", [1, undefined, 3]],
  ["null inside", [1, null, 3]],
  ["booleans", [true, false]],
  ["nested", [[1], [2, 3]]],
  ["objects", [{ valueOf: () => 4 }, { valueOf: () => 2 }]],
  ["holes", holes],
  ["empty", []],
  ["whole numbers again", [3, 1, 2]],
];

function list(values: unknown[]): string {
  return values.map(v => typeof v + ":" + (Object.is(v, -0) ? "-0" : String(v))).join(" ");
}

for (const [label, values] of lists) {
  show(label + " sum", () => stats.sum(values));
  show(label + " sumOf", () => stats.sumOf(values));
  show(label + " reduced", () => stats.reduced(values));
  show(label + " doubled", () => list(stats.doubled(values)));
  show(label + " whole", () => list(stats.whole(values)));
  show(label + " largest", () => stats.largest(values));
  show(label + " sorted", () => list(stats.sorted(values)));
  show(label + " sortedByValue", () => list(stats.sortedByValue(values)));
  show(label + " first", () => stats.first(values));
  show(label + " firstFixed", () => stats.firstFixed(values));
  show(label + " hasTwo", () => stats.hasTwo(values));
  show(label + " grown", () => stats.grown(values));
  show(label + " toFloats", () => list(stats.toFloats(values)));
  show(label + " kinds", () => stats.kinds(values));
}
