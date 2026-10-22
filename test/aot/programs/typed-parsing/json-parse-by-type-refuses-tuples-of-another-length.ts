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

type Pair = [number, string];

expect("value", "a pair", () => JSON.parse<Pair>('[1,"a"]'));
expect("TypeError", "empty", () => JSON.parse<Pair>("[]"));
expect("TypeError", "too short", () => JSON.parse<Pair>("[1]"));
expect("TypeError", "too long", () => JSON.parse<Pair>('[1,"a",2]'));
expect("TypeError", "too long by null", () => JSON.parse<Pair>('[1,"a",null]'));
expect("TypeError", "the other way round", () => JSON.parse<Pair>('["a",1]'));
expect("TypeError", "null for the first", () => JSON.parse<Pair>('[null,"a"]'));
expect("TypeError", "a pair in a list", () => JSON.parse<Pair>('[[1,"a"]]'));
expect("value", "the empty tuple", () => JSON.parse<[]>("[]"));
expect("TypeError", "one element for the empty tuple", () => JSON.parse<[]>("[1]"));
expect("TypeError", "a short pair among pairs", () => JSON.parse<Pair[]>('[[1,"a"],[2],[3,"c"]]'));
expect("TypeError", "a long pair in a member", () => JSON.parse<{ at: [number, number] }>('{"at":[1,2,3]}'));
expect("TypeError", "a read-only pair that is too long", () => JSON.parse<readonly [number, number]>("[1,2,3]"));
expect("TypeError", "very long", () => JSON.parse<[number, number]>("[" + "1,".repeat(10000) + "1]"));
