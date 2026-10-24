import type { int32 } from "bun";

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

interface Reading {
  n: number;
}
interface Cell {
  v: int32;
}

for (const spelling of ["1e400", "-1e400", "1e309", "1.7976931348623159e308", "9".repeat(400)]) {
  expect("TypeError", "number given " + spelling.slice(0, 30), () => JSON.parse<Reading>('{"n":' + spelling + "}"));
  expect("TypeError", "number alone given " + spelling.slice(0, 30), () => JSON.parse<number>(spelling));
  expect("TypeError", "in a list " + spelling.slice(0, 30), () => JSON.parse<number[]>("[1," + spelling + "]"));
  expect("value", "unknown given " + spelling.slice(0, 30), () => JSON.parse<{ n: unknown }>('{"n":' + spelling + "}"));
}
expect("value", "the largest number", () => JSON.parse<Reading>('{"n":1.7976931348623157e308}'));

for (const spelling of ["0", "1", "-1", "2147483647", "-2147483648", "1.0", "1e9", "2147483647.0"]) expect("value", "int32 given " + spelling, () => JSON.parse<Cell>('{"v":' + spelling + "}"));
for (const spelling of ["0.5", "-0.5", "1.5", "2147483648", "-2147483649", "2147483647.5", "1e10", "1e21", "1e400", "4294967296", "9007199254740993", "1e-7", "5e-324", '"1"', "null", "true", "[1]"]) {
  expect("TypeError", "int32 given " + spelling, () => JSON.parse<Cell>('{"v":' + spelling + "}"));
  expect("TypeError", "int32 in a list given " + spelling, () => JSON.parse<int32[]>("[1," + spelling + "]"));
}
expect("TypeError", "int32 is missing", () => JSON.parse<Cell>("{}"));
