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

type NotEmpty = string & Schema.MinLength<1>;
type Short = string & Schema.MaxLength<3>;
type Lower = string & Schema.Pattern<"^[a-z]+$">;
type SomeItems = number[] & Schema.MinItems<1>;
type FewItems = number[] & Schema.MaxItems<2>;

function rows(label: string, parse: (text: string) => unknown, accepted: string[], refused: string[]): void {
  for (const text of accepted) expect("value", label + " given " + text, () => parse(text));
  for (const text of refused) expect("TypeError", label + " given " + text, () => parse(text));
}

rows("not empty", text => JSON.parse<NotEmpty>(text), ['"a"', '" "', '"\\u0000"', '"\\ud800"'], ['""', "null", "1", "[]"]);
rows("at most 3", text => JSON.parse<Short>(text), ['""', '"abc"', '"\\u0061\\u0062\\u0063"', '"日本語"', '"\\n\\n\\n"'], ['"abcd"', '"\\u0061\\u0062\\u0063\\u0064"', '"日本語語"', '"    "']);
rows("lower case", text => JSON.parse<Lower>(text), ['"a"', '"abc"', '"\\u0061"'], ['""', '"A"', '"a1"', '"a b"', '"a\\nb"', '"é"', '"a\\u0000"', '" a"']);
rows("some items", text => JSON.parse<SomeItems>(text), ["[1]", "[1,2,3]"], ["[]", "null", "{}", '["a"]']);
rows("few items", text => JSON.parse<FewItems>(text), ["[]", "[1]", "[1,2]"], ["[1,2,3]", "[1,2,null]"]);
rows("an email", text => JSON.parse<string & Schema.Format<"email">>(text), ['"a@example.com"'], ['""', '"a"', '"a@"', '"@example.com"', '"a b@example.com"', "1"]);
rows("a uuid", text => JSON.parse<string & Schema.Format<"uuid">>(text), ['"123e4567-e89b-42d3-a456-426614174000"'], ['""', '"123e4567-e89b-42d3-a456-42661417400"', '"123e4567e89b42d3a456426614174000"', '"123e4567-e89b-42d3-a456-42661417400g"']);
rows("an ipv4 address", text => JSON.parse<string & Schema.Format<"ipv4">>(text), ['"1.2.3.4"', '"255.255.255.255"'], ['""', '"1.2.3"', '"1.2.3.256"', '"1.2.3.4.5"', '"a.b.c.d"', '" 1.2.3.4"']);
rows("a date", text => JSON.parse<string & Schema.Format<"date">>(text), ['"2026-01-31"', '"2024-02-29"'], ['""', '"2026-1-31"', '"2026-13-01"', '"2026-02-30"', '"2026-01-31T00:00:00Z"', '"31-01-2026"']);
rows("a date and time", text => JSON.parse<string & Schema.Format<"date-time">>(text), ['"2026-01-31T10:20:30Z"'], ['""', '"2026-01-31"', '"2026-01-31 10:20:30"', '"2026-01-31T25:00:00Z"', '"yesterday"']);
rows("a date in a member", text => JSON.parse<{ at: string & Schema.Format<"date"> }>('{"at":' + text + "}"), ['"2026-01-31"'], ["1769817600000", "null", '"now"']);
