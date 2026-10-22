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

interface Meter {
  same(v: number | string | null | undefined | boolean | bigint): number;
  plusOne(v: number | string | null | undefined | boolean | bigint): number;
  twice(v: number | string | null | undefined | boolean | bigint): number;
  whole(v: number | string | null | undefined | boolean | bigint): number;
  unsigned(v: number | string | null | undefined | boolean | bigint): number;
  negated(v: number | string | null | undefined | boolean | bigint): number;
  fixed(v: number | string | null | undefined | boolean | bigint): string;
  below(v: number | string | null | undefined | boolean | bigint): boolean;
  isFive(v: number | string | null | undefined | boolean | bigint): boolean;
  truthy(v: number | string | null | undefined | boolean | bigint): string;
  root(v: number | string | null | undefined | boolean | bigint): number;
  next(v: number | string | null | undefined | boolean | bigint): number;
  keep(v: number | string | null | undefined | boolean | bigint): void;
  index(v: number | string | null | undefined | boolean | bigint): string;
}

class NumberMeter implements Meter {
  last: number = 0;
  all: number[] = [];
  same(n: number): number {
    return n;
  }
  plusOne(n: number): number {
    return n + 1;
  }
  twice(n: number): number {
    return n * 2;
  }
  whole(n: number): number {
    return n | 0;
  }
  unsigned(n: number): number {
    return n >>> 0;
  }
  negated(n: number): number {
    return -n;
  }
  fixed(n: number): string {
    return n.toFixed(1);
  }
  below(n: number): boolean {
    return n < 10;
  }
  isFive(n: number): boolean {
    return n === 5;
  }
  truthy(n: number): string {
    return n ? "yes" : "no";
  }
  root(n: number): number {
    return Math.sqrt(n);
  }
  next(n: number): number {
    n++;
    return n;
  }
  keep(n: number): void {
    this.last = n;
    this.all.push(n);
  }
  index(n: number): string {
    return "abcdefgh"[n];
  }
}

const own = new NumberMeter();
const meter: Meter = own;
const values: [string, number | string | null | undefined | boolean | bigint][] = [
  ["5", 5],
  ["2.5", 2.5],
  ["-0", -0],
  ["NaN", NaN],
  ["'5'", "5"],
  ["'text'", "text"],
  ["''", ""],
  ["null", null],
  ["undefined", undefined],
  ["true", true],
  ["7n", 7n],
];

for (const [label, value] of values) {
  show(label + " same", () => meter.same(value));
  show(label + " plusOne", () => meter.plusOne(value));
  show(label + " twice", () => meter.twice(value));
  show(label + " whole", () => meter.whole(value));
  show(label + " unsigned", () => meter.unsigned(value));
  show(label + " negated", () => meter.negated(value));
  show(label + " fixed", () => meter.fixed(value));
  show(label + " below", () => meter.below(value));
  show(label + " isFive", () => meter.isFive(value));
  show(label + " truthy", () => meter.truthy(value));
  show(label + " root", () => meter.root(value));
  show(label + " next", () => meter.next(value));
  show(label + " index", () => meter.index(value));
  show(label + " keep", () => meter.keep(value));
  show(label + " kept", () => own.last);
  show(label + " kept plus one", () => own.last + 1);
}
show("all kept", () => own.all.map(n => typeof n).join());
show("sum of all but the last", () => {
  let sum = 0;
  for (let i = 0; i < own.all.length - 1; i++) sum += own.all[i];
  return sum;
});
