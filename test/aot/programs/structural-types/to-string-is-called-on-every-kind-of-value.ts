function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

type Printable = { toString(): string };

class Point {
  constructor(private x: number, private y: number) {}
  toString(): string {
    return "(" + this.x + ", " + this.y + ")";
  }
}

function byMethod(value: Printable): string {
  return value.toString();
}

function byTemplate(value: Printable): string {
  return `<${value}>`;
}

function byConcatenation(value: Printable): string {
  return "" + value;
}

function byString(value: Printable): string {
  return String(value);
}

function byJoin(value: Printable): string {
  return [value, value].join("|");
}

function lengthOfText(value: Printable): number {
  let total = 0;
  for (let i = 0; i < 2; i++) total += value.toString().length;
  return total;
}

function kindOf(value: Printable): string {
  return typeof value;
}

const plain = { a: 1 };
const values: [string, Printable][] = [
  ["a literal", { toString: () => "literal" }],
  ["a point", new Point(1, 2)],
  ["a plain object", plain],
  ["7", 7],
  ["-0", -0],
  ["0.1 + 0.2", 0.1 + 0.2],
  ["NaN", NaN],
  ["1e21", 1e21],
  ["a string", "text"],
  ["an empty string", ""],
  ["true", true],
  ["false", false],
  ["a symbol", Symbol("mark")],
  ["a bigint", 12345678901234567890n],
  ["a small bigint", 0n],
  ["a built-in function", Math.max],
  ["an array", [1, [2, 3]]],
  ["an empty array", []],
  ["a regular expression", /a+b/gi],
  ["an error", new RangeError("too far")],
  ["a Number object", new Number(3)],
];

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest: Printable = { toString: () => "n" + i };
  warm += byMethod(honest).length + byTemplate(honest).length + byConcatenation(honest).length + byString(honest).length;
  warm += byJoin(honest).length + lengthOfText(honest) + kindOf(honest).length;
}
console.log("after 2000 literals", warm);

for (const [name, value] of values) {
  attempt(name + ": method", () => byMethod(value));
  attempt(name + ": template", () => byTemplate(value));
  attempt(name + ": concatenation", () => byConcatenation(value));
  attempt(name + ": String()", () => byString(value));
  attempt(name + ": join", () => byJoin(value));
  attempt(name + ": length of the text", () => lengthOfText(value));
  attempt(name + ": typeof", () => kindOf(value));
}

type WithRadix = { toString(radix?: number): string };
function inHex(value: WithRadix): string {
  return value.toString(16);
}
attempt("hex of a literal", () => inHex({ toString: radix => "radix " + radix }));
attempt("hex of 255", () => inHex(255));
attempt("hex of 0.5", () => inHex(0.5));
attempt("hex of -255", () => inHex(-255));
attempt("hex of a bigint", () => inHex(2n ** 70n));
attempt("radix 1", () => {
  const value: WithRadix = 5;
  return value.toString(1);
});
