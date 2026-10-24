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

interface Item {
  id: number;
  name: string;
}
const good = '{"id":1,"name":"n"}';

expect("value", "a reviver that changes nothing", () => JSON.parse<Item>(good, (_, value) => value));
expect("TypeError", "a number becomes a text", () => JSON.parse<Item>(good, (key, value) => (key === "id" ? String(value) : value)));
expect("TypeError", "a member is removed", () => JSON.parse<Item>(good, (key, value) => (key === "name" ? undefined : value)));
expect("TypeError", "the whole value becomes undefined", () => JSON.parse<Item>(good, (key, value) => (key === "" ? undefined : value)));
expect("TypeError", "the whole value becomes null", () => JSON.parse<Item>(good, (key, value) => (key === "" ? null : value)));
expect("TypeError", "the whole value becomes a list", () => JSON.parse<Item>(good, (key, value) => (key === "" ? [value] : value)));
expect("TypeError", "a number becomes NaN", () => JSON.parse<Item>(good, (key, value) => (key === "id" ? NaN : value)));
expect("TypeError", "a number becomes infinite", () => JSON.parse<Item>(good, (key, value) => (key === "id" ? Infinity : value)));
expect("TypeError", "a number becomes a bigint", () => JSON.parse<Item>(good, (key, value) => (key === "id" ? 1n : value)));
expect("TypeError", "a text becomes a symbol", () => JSON.parse<Item>(good, (key, value) => (key === "name" ? Symbol("n") : value)));
expect("TypeError", "a text becomes a function", () => JSON.parse<Item>(good, (key, value) => (key === "name" ? () => "n" : value)));
expect("TypeError", "a number becomes a Number object", () => JSON.parse<Item>(good, (key, value) => (key === "id" ? new Number(1) : value)));
expect("TypeError", "a text becomes a String object", () => JSON.parse<Item>(good, (key, value) => (key === "name" ? new String("n") : value)));
expect("value", "a wrong text is put right", () => JSON.parse<Item>('{"id":"1","name":2}', (key, value) => (key === "id" ? 1 : key === "name" ? "n" : value)));
expect("RangeError", "the error of the reviver goes through", () =>
  JSON.parse<Item>(good, () => {
    throw new RangeError("stop");
  }),
);
expect("SyntaxError", "broken text never reaches the reviver", () => JSON.parse<Item>(good + "}", () => 1));
