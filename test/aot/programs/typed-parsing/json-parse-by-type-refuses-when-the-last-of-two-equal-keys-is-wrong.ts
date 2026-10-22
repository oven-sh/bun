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

interface Pair {
  a: number;
  b: string;
}

expect("value", "the last one fits", () => JSON.parse<Pair>('{"a":"x","b":"b","a":1}'));
expect("TypeError", "the last one is a text", () => JSON.parse<Pair>('{"a":1,"b":"b","a":"x"}'));
expect("TypeError", "the last one is null", () => JSON.parse<Pair>('{"a":1,"a":null,"b":"b"}'));
expect("TypeError", "the last one is an object", () => JSON.parse<Pair>('{"a":1,"b":"b","a":{"a":1}}'));
expect("TypeError", "the last one is written with an escape", () => JSON.parse<Pair>('{"a":1,"b":"b","\\u0061":"x"}'));
expect("TypeError", "both members, both wrong at last", () => JSON.parse<Pair>('{"a":1,"b":"b","b":2,"a":"x"}'));
expect("TypeError", "after a thousand that fit", () => JSON.parse<Pair>('{"b":"b",' + '"a":1,'.repeat(1000) + '"a":true}'));
expect("TypeError", "in a nested object", () => JSON.parse<{ p: Pair }>('{"p":{"a":1,"b":"b"},"p":{"a":1}}'));
expect("TypeError", "in an element", () => JSON.parse<Pair[]>('[{"a":1,"b":"b"},{"a":1,"b":"b","b":null}]'));
expect("TypeError", "an optional member", () => JSON.parse<{ o?: number }>('{"o":1,"o":"x"}'));
expect("TypeError", "in a table", () => JSON.parse<Record<string, number>>('{"k":1,"k":"x"}'));
expect("value", "in a table, the last one fits", () => JSON.parse<Record<string, number>>('{"k":"x","k":1}'));
