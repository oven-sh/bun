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

enum Level {
  Low,
  High,
}

interface Wide {
  pick(v: boolean | number | string | null | object): string;
  not(v: boolean | number | string | null | object): boolean;
  isTrue(v: boolean | number | string | null | object): boolean;
  and(v: boolean | number | string | null | object): unknown;
  count(v: boolean | number | string | null | object): number;
  big(v: bigint | number | string): bigint;
  bigCompare(v: bigint | number | string): boolean;
  word(v: string): string;
  digit(v: number): string;
  level(v: number): string;
  pair(v: (number | string)[]): string;
}

class Narrow implements Wide {
  pick(flag: boolean): string {
    return flag ? "yes" : "no";
  }
  not(flag: boolean): boolean {
    return !flag;
  }
  isTrue(flag: boolean): boolean {
    return flag === true;
  }
  and(flag: boolean): unknown {
    return flag && "second";
  }
  count(flag: boolean): number {
    return Number(flag) + 1;
  }
  big(n: bigint): bigint {
    return n + 1n;
  }
  bigCompare(n: bigint): boolean {
    return n > 1n;
  }
  word(w: "on" | "off"): string {
    switch (w) {
      case "on":
        return "it is on";
      case "off":
        return "it is off";
    }
  }
  digit(d: 0 | 1): string {
    if (d === 0) return "zero";
    if (d === 1) return "one";
    const never: never = d;
    return "never: " + typeof never + " " + never;
  }
  level(l: Level): string {
    switch (l) {
      case Level.Low:
        return "low";
      case Level.High:
        return "high";
    }
  }
  pair(p: [number, string]): string {
    const [n, s] = p;
    return typeof n + " " + typeof s + " " + (n + 1) + " " + p.length;
  }
}

const wide: Wide = new Narrow();
const flags: [string, boolean | number | string | null | object][] = [
  ["true", true],
  ["false", false],
  ["1", 1],
  ["0", 0],
  ["NaN", NaN],
  ["'false'", "false"],
  ["''", ""],
  ["null", null],
  ["{}", {}],
  ["[]", []],
];
for (const [label, flag] of flags) {
  show(label + " pick", () => wide.pick(flag));
  show(label + " not", () => wide.not(flag));
  show(label + " isTrue", () => wide.isTrue(flag));
  show(label + " and", () => wide.and(flag));
  show(label + " count", () => wide.count(flag));
}
show("big 5n", () => wide.big(5n));
show("big 5", () => wide.big(5));
show("big '5'", () => wide.big("5"));
show("bigCompare 5n", () => wide.bigCompare(5n));
show("bigCompare 5", () => wide.bigCompare(5));
show("bigCompare '5'", () => wide.bigCompare("5"));
show("bigCompare 'x'", () => wide.bigCompare("x"));
show("word on", () => wide.word("on"));
show("word off", () => wide.word("off"));
show("word other", () => wide.word("other"));
show("word other: length", () => wide.word("other").length);
show("digit 0", () => wide.digit(0));
show("digit -0", () => wide.digit(-0));
show("digit 1", () => wide.digit(1));
show("digit 2", () => wide.digit(2));
show("digit 0.5", () => wide.digit(0.5));
show("level 0", () => wide.level(0));
show("level 1", () => wide.level(1));
show("level 2", () => wide.level(2));
show("level 2: upper case", () => wide.level(2).toUpperCase());
show("pair honest", () => wide.pair([1, "a"]));
show("pair swapped", () => wide.pair(["a", 1]));
show("pair short", () => wide.pair([1]));
show("pair empty", () => wide.pair([]));
show("pair long", () => wide.pair([1, "a", 2, "b"]));
