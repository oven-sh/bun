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

type Wide = string | number | null | undefined | string[] | { length: number };

interface Reader {
  same(v: Wide): string;
  size(v: Wide): number;
  first(v: Wide): string;
  code(v: Wide): number;
  upper(v: Wide): string;
  joined(v: Wide): string;
  template(v: Wide): string;
  slice(v: Wide): string;
  has(v: Wide): boolean;
  equal(v: Wide): boolean;
  before(v: Wide): boolean;
  letters(v: Wide): string;
  keep(v: Wide): void;
  asKey(v: Wide): number;
}

const table: Record<string, number> = { abc: 1, "5": 2, undefined: 3, null: 4, "a,b": 5 };

class StringReader implements Reader {
  last: string = "";
  all: string[] = [];
  same(s: string): string {
    return s;
  }
  size(s: string): number {
    return s.length;
  }
  first(s: string): string {
    return s[0];
  }
  code(s: string): number {
    return s.charCodeAt(0);
  }
  upper(s: string): string {
    return s.toUpperCase();
  }
  joined(s: string): string {
    return s + "!";
  }
  template(s: string): string {
    return `<${s}>`;
  }
  slice(s: string): string {
    return s.slice(1);
  }
  has(s: string): boolean {
    return s.includes("b");
  }
  equal(s: string): boolean {
    return s === "abc";
  }
  before(s: string): boolean {
    return s < "b";
  }
  letters(s: string): string {
    let out = "";
    for (const letter of s) out += "[" + letter + "]";
    return out;
  }
  keep(s: string): void {
    this.last = s;
    this.all.push(s);
  }
  asKey(s: string): number {
    return table[s];
  }
}

const own = new StringReader();
const reader: Reader = own;
const values: [string, Wide][] = [
  ["'abc'", "abc"],
  ["''", ""],
  ["5", 5],
  ["NaN", NaN],
  ["null", null],
  ["undefined", undefined],
  ["['a','b']", ["a", "b"]],
  ["{length:2}", { length: 2 }],
];

for (const [label, value] of values) {
  show(label + " same", () => reader.same(value));
  show(label + " size", () => reader.size(value));
  show(label + " first", () => reader.first(value));
  show(label + " code", () => reader.code(value));
  show(label + " upper", () => reader.upper(value));
  show(label + " joined", () => reader.joined(value));
  show(label + " template", () => reader.template(value));
  show(label + " slice", () => reader.slice(value));
  show(label + " has", () => reader.has(value));
  show(label + " equal", () => reader.equal(value));
  show(label + " before", () => reader.before(value));
  show(label + " letters", () => reader.letters(value));
  show(label + " asKey", () => reader.asKey(value));
  show(label + " keep", () => reader.keep(value));
  show(label + " kept", () => own.last);
  show(label + " kept length", () => own.last.length);
}
show("all kept", () => own.all.map(s => typeof s).join());
show("all kept joined", () => own.all.join("|"));
