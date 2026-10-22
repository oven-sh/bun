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

interface Sized {
  length: number;
}
interface First {
  0: number;
}
type Table = Record<string, number>;

expect("value", "an object with a length", () => JSON.parse<Sized>('{"length":2}'));
expect("TypeError", "a list where a length is declared", () => JSON.parse<Sized>("[1,2]"));
expect("TypeError", "a text where a length is declared", () => JSON.parse<Sized>('"ab"'));
expect("value", "an object with an index", () => JSON.parse<First>('{"0":1}'));
expect("TypeError", "a list where an index is declared", () => JSON.parse<First>("[1]"));
expect("value", "a table", () => JSON.parse<Table>('{"0":1,"1":2}'));
expect("TypeError", "a list for a table", () => JSON.parse<Table>("[1,2]"));
expect("TypeError", "an empty list for a table", () => JSON.parse<Table>("[]"));
expect("TypeError", "an empty list for an empty object type", () => JSON.parse<{}>("[]"));
expect("TypeError", "a number for an empty object type", () => JSON.parse<{}>("1"));
expect("value", "an empty object for an empty object type", () => JSON.parse<{}>("{}"));
expect("value", "a list for object", () => JSON.parse<object>("[1]"));
expect("TypeError", "null for object", () => JSON.parse<object>("null"));
expect("TypeError", "a text for object", () => JSON.parse<object>('"o"'));
expect("TypeError", "an object with indexes and a length for a list", () => JSON.parse<number[]>('{"0":1,"1":2,"length":2}'));
expect("TypeError", "an empty object for a list", () => JSON.parse<number[]>("{}"));
expect("TypeError", "an object for a pair", () => JSON.parse<[number, number]>('{"0":1,"1":2,"length":2}'));
expect("TypeError", "null for a list", () => JSON.parse<number[]>("null"));
expect("TypeError", "a text for a list of texts", () => JSON.parse<string[]>('"ab"'));
expect("TypeError", "a list in a list of numbers", () => JSON.parse<number[]>("[1,[2]]"));
expect("TypeError", "a number in a list of lists", () => JSON.parse<number[][]>("[[1],2]"));
expect("TypeError", "null in a list of numbers", () => JSON.parse<number[]>("[1,null,3]"));
expect("TypeError", "the last of many is a text", () => JSON.parse<number[]>("[" + "1,".repeat(5000) + '"2"]'));
expect("TypeError", "a list of objects holds a list", () => JSON.parse<{ a: number }[]>('[{"a":1},[]]'));
expect("TypeError", "a list of objects holds null", () => JSON.parse<{ a: number }[]>('[{"a":1},null]'));
