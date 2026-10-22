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
  Blue = 5,
}
enum Way {
  Up = "UP",
  Down = "DOWN",
}
enum Mixed {
  No = 0,
  Yes = "YES",
}

for (const text of ["0", "1", "5", "5.0", "50e-1"]) expect("value", "a color given " + text, () => JSON.parse<Color>(text));
for (const text of ["2", "3", "4", "6", "-1", "0.5", "999", "1e400", '"Red"', '"0"', "null", "true", "[0]"]) expect("TypeError", "a color given " + text, () => JSON.parse<Color>(text));
for (const text of ['"UP"', '"DOWN"', '"\\u0055P"']) expect("value", "a way given " + text, () => JSON.parse<Way>(text));
for (const text of ['"Up"', '"up"', '"UP "', '""', "0", "null", '["UP"]']) expect("TypeError", "a way given " + text, () => JSON.parse<Way>(text));
for (const text of ["0", '"YES"']) expect("value", "mixed given " + text, () => JSON.parse<Mixed>(text));
for (const text of ["1", '"No"', '"0"', '"yes"', "false"]) expect("TypeError", "mixed given " + text, () => JSON.parse<Mixed>(text));
expect("TypeError", "one member given another", () => JSON.parse<Color.Red>("1"));
expect("TypeError", "a flag that is no member", () => JSON.parse<{ color: Color }>('{"color":3}'));
for (const text of ['"a"', '"b"']) expect("value", "a or b given " + text, () => JSON.parse<"a" | "b">(text));
for (const text of ['"c"', '"A"', '"ab"', '""', "null", "1"]) expect("TypeError", "a or b given " + text, () => JSON.parse<"a" | "b">(text));
for (const text of ["3", "1.5", '"1"', "true", "null"]) expect("TypeError", "1 or 2 given " + text, () => JSON.parse<1 | 2>(text));
expect("TypeError", "true given false", () => JSON.parse<true>("false"));
expect("TypeError", "false given null", () => JSON.parse<false>("null"));
expect("TypeError", "null given false", () => JSON.parse<null>("false"));
expect("TypeError", "null given 0", () => JSON.parse<null>("0"));
expect("TypeError", "null given an empty text", () => JSON.parse<null>('""'));
for (const text of ['"id-"', '"id-x"', '"ID-1"', '" id-1"', '"id-1x"', '"id-Infinity"', '"id-NaN"', '"1"', "1", "null"]) expect("TypeError", "an id given " + text, () => JSON.parse<`id-${number}`>(text));
for (const text of ['"id-15"', '"id--1.5"', '"id-1e3"', '"id-0x10"']) expect("value", "an id given " + text, () => JSON.parse<`id-${number}`>(text));
