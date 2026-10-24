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

type Wide = number[] | string | Set<number> | { length: number; 0: number } | Float64Array | null;

interface Summer {
  size(v: Wide): number;
  first(v: Wide): number;
  sum(v: Wide): number;
  sumOf(v: Wide): number;
  add(v: Wide): number;
  doubled(v: Wide): number[];
  spread(v: Wide): number[];
  head(v: Wide): number;
  put(v: Wide): void;
  isArray(v: Wide): boolean;
}

class ArraySummer implements Summer {
  size(list: number[]): number {
    return list.length;
  }
  first(list: number[]): number {
    return list[0];
  }
  sum(list: number[]): number {
    let sum = 0;
    for (let i = 0; i < list.length; i++) sum += list[i];
    return sum;
  }
  sumOf(list: number[]): number {
    let sum = 0;
    for (const n of list) sum += n;
    return sum;
  }
  add(list: number[]): number {
    return list.push(4);
  }
  doubled(list: number[]): number[] {
    return list.map(n => n * 2);
  }
  spread(list: number[]): number[] {
    return [...list, 99];
  }
  head(list: number[]): number {
    const [head] = list;
    return head;
  }
  put(list: number[]): void {
    list[1] = 50;
  }
  isArray(list: number[]): boolean {
    return Array.isArray(list);
  }
}

const summer: Summer = new ArraySummer();
const makers: [string, () => Wide][] = [
  ["array", () => [1, 2, 3]],
  ["string", () => "123"],
  ["set", () => new Set([1, 2, 3])],
  ["array-like", () => ({ length: 2, 0: 10, 1: 20 })],
  ["float64", () => new Float64Array([1.5, 2.5, 3.5])],
  ["null", () => null],
  ["array again", () => [4, 5, 6]],
];

for (const [label, make] of makers) {
  show(label + " size", () => summer.size(make()));
  show(label + " first", () => summer.first(make()));
  show(label + " sum", () => summer.sum(make()));
  show(label + " sumOf", () => summer.sumOf(make()));
  show(label + " add", () => summer.add(make()));
  show(label + " doubled", () => summer.doubled(make()));
  show(label + " spread", () => summer.spread(make()));
  show(label + " head", () => summer.head(make()));
  show(label + " isArray", () => summer.isArray(make()));
  show(label + " put", () => {
    const value = make();
    summer.put(value);
    return value instanceof Set ? [...value, Object.keys(value).join()] : value;
  });
}
