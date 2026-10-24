function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  const parent = Object.getPrototypeOf(value);
  const mark = parent === Object.prototype ? "" : parent === null ? "without a prototype " : "with another prototype ";
  return mark + "{" + Object.entries(value).map(([key, held]) => JSON.stringify(key) + ": " + show(held)).join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

function expect(documented: "value" | "TypeError" | "SyntaxError" | "RangeError", label: string, run: () => unknown): void {
  let got: string;
  try {
    got = "value " + show(run());
  } catch (error) {
    got = error instanceof Error ? error.constructor.name : typeof error;
  }
  console.log(label + ": documented " + documented + ", got " + got);
}

enum Color {
  Red,
  Green,
}

const values = ["1", '"text"', "true", "null", "[]", "{}", "[1]", '{"a":1}'];
const rows: [string, string[], (text: string) => unknown][] = [
  ["number", ["1"], text => JSON.parse<{ m: number }>(text)],
  ["string", ['"text"'], text => JSON.parse<{ m: string }>(text)],
  ["boolean", ["true"], text => JSON.parse<{ m: boolean }>(text)],
  ["null", ["null"], text => JSON.parse<{ m: null }>(text)],
  ["a list of numbers", ["[]", "[1]"], text => JSON.parse<{ m: number[] }>(text)],
  ["a list of strings", ["[]"], text => JSON.parse<{ m: string[] }>(text)],
  ["an object with a", ['{"a":1}'], text => JSON.parse<{ m: { a: number } }>(text)],
  ["an object with an optional a", ["{}", '{"a":1}'], text => JSON.parse<{ m: { a?: number } }>(text)],
  ["an empty object type", ["{}", '{"a":1}'], text => JSON.parse<{ m: {} }>(text)],
  ["object", ["[]", "{}", "[1]", '{"a":1}'], text => JSON.parse<{ m: object }>(text)],
  ["a table of numbers", ["{}", '{"a":1}'], text => JSON.parse<{ m: Record<string, number> }>(text)],
  ["a pair", [], text => JSON.parse<{ m: [number, number] }>(text)],
  ["a tuple of one", ["[1]"], text => JSON.parse<{ m: [number] }>(text)],
  ["an enum", ["1"], text => JSON.parse<{ m: Color }>(text)],
  ["the literal 1", ["1"], text => JSON.parse<{ m: 1 }>(text)],
  ["the literal text", ['"text"'], text => JSON.parse<{ m: "text" }>(text)],
  ["the literal true", ["true"], text => JSON.parse<{ m: true }>(text)],
  ["number or null", ["1", "null"], text => JSON.parse<{ m: number | null }>(text)],
  ["string or a list of numbers", ['"text"', "[]", "[1]"], text => JSON.parse<{ m: string | number[] }>(text)],
  ["an optional number", ["1"], text => JSON.parse<{ m?: number }>(text)],
  ["unknown", values, text => JSON.parse<{ m: unknown }>(text)],
];

for (const [label, accepted, parse] of rows) {
  for (const value of values) expect(accepted.includes(value) ? "value" : "TypeError", label + " given " + value, () => parse('{"m":' + value + "}"));
}
