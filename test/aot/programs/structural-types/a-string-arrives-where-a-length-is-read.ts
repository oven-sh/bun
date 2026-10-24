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

type HasLength = { length: number };

function lengthOf(item: HasLength): number {
  return item.length;
}

function lengthThreeTimes(item: HasLength): number {
  let total = 0;
  for (let i = 0; i < 3; i++) total += item.length;
  return total;
}

function halfTheLength(item: HasLength): number {
  return item.length / 2;
}

function letterAtTheLength(item: HasLength): string {
  return "abcdefghijklmnop".charAt(item.length);
}

function kindOf(item: HasLength): string {
  return typeof item;
}

const visitors: [string, () => HasLength][] = [
  ["a literal", () => ({ length: 7 })],
  ["a literal with more members", () => ({ before: "x", length: 8, after: "y" })],
  ["a string", () => "hello"],
  ["an empty string", () => ""],
  ["a string put together at run time", () => "ab".repeat(3) + String(visitors.length)],
  ["a string of wide characters", () => "你好"],
  ["an array", () => [1, 2, 3]],
  ["an empty array", () => []],
  ["a function", () => function (a: number, b: number) { return a + b; }],
  ["an arrow function", () => (a: number) => a],
  ["a class", () => class { constructor(a: number, b: number, c: number) {} }],
  ["a typed array", () => new Uint8Array(4)],
  ["a typed array of doubles", () => new Float64Array(6)],
  ["a String object", () => new String("boxed")],
  ["a buffer", () => Buffer.from("abc")],
];

let warm = 0;
for (let i = 0; i < 2000; i++) {
  warm += lengthOf({ length: i }) + lengthThreeTimes({ length: i }) + halfTheLength({ length: i });
  warm += letterAtTheLength({ length: i & 7 }).length + kindOf({ length: i }).length;
}
console.log("after 2000 literals", warm);

for (const [name, make] of visitors) {
  attempt(name + ": length", () => lengthOf(make()));
  attempt(name + ": three times", () => lengthThreeTimes(make()));
  attempt(name + ": half", () => halfTheLength(make()));
  attempt(name + ": letter", () => letterAtTheLength(make()));
  attempt(name + ": typeof", () => kindOf(make()));
  attempt("a literal again", () => lengthOf({ length: 1 }));
}
