import type { Schema } from "bun";

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

type Whole = number & Schema.Int;
type AtLeastOne = number & Schema.Min<1>;
type AtMostTen = number & Schema.Max<10>;
type AboveZero = number & Schema.Above<0>;
type BelowOne = number & Schema.Below<1>;
type AtLeastZero = number & Schema.Min<0>;
type ByFive = number & Schema.MultipleOf<5>;
type Quantity = number & Schema.Int & Schema.Min<1> & Schema.Max<1000>;

function rows(label: string, parse: (text: string) => unknown, accepted: string[], refused: string[]): void {
  for (const text of accepted) expect("value", label + " given " + text, () => parse(text));
  for (const text of refused) expect("TypeError", label + " given " + text, () => parse(text));
}

rows("a whole number", text => JSON.parse<Whole>(text), ["0", "-0", "1", "-1", "1.0", "1e3", "1e21", "9007199254740993", "2147483648", "100e-2"], ["0.5", "-0.5", "1e-7", "5e-324", "1.0000000001", "1e400", '"1"', "null"]);
rows("at least 1", text => JSON.parse<AtLeastOne>(text), ["1", "1.0", "1.0000000000000002", "2", "1e308"], ["0.9999999999999999", "0", "-1", "-0", "1e400", "-1e400"]);
rows("at most 10", text => JSON.parse<AtMostTen>(text), ["10", "10.0", "9.999999999999998", "-1e308", "0"], ["10.000000000000002", "11", "1e400", "-1e400"]);
rows("above 0", text => JSON.parse<AboveZero>(text), ["5e-324", "1", "0.1"], ["0", "-0", "0.0", "1e-400", "-5e-324", "-1"]);
rows("below 1", text => JSON.parse<BelowOne>(text), ["0.9999999999999999", "0", "-5"], ["1", "1.0", "1.0000000000000002", "2"]);
rows("at least 0", text => JSON.parse<AtLeastZero>(text), ["0", "-0", "-1e-400", "5e-324"], ["-5e-324", "-1"]);
rows("a multiple of 5", text => JSON.parse<ByFive>(text), ["0", "-0", "5", "-5", "10", "1e21", "5.0"], ["1", "4.999999999999999", "5.000000000000001", "2.5", "-3"]);
rows("a quantity", text => JSON.parse<Quantity>(text), ["1", "1000", "1e3", "999"], ["0", "1001", "1.5", "999.5", "-1", "1e400"]);
rows("a quantity in a member", text => JSON.parse<{ q: Quantity }>('{"q":' + text + "}"), ["1", "1000"], ["0", "1001", "1.5", "null", '"1"']);
rows("quantities in a list", text => JSON.parse<Quantity[]>("[1," + text + ",1000]"), ["2"], ["0", "1001", "2.5"]);
