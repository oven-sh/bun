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

type Closed = { id: number; name?: string } & Schema.Strict;
type Outer = { inner: { x: number }; list: { y: number }[] } & Schema.Strict;
type Deep = { inner: { x: number }; list: { y: number }[] } & Schema.DeepStrict;

expect("value", "only declared keys", () => JSON.parse<Closed>('{"id":1,"name":"n"}'));
expect("value", "without the optional key", () => JSON.parse<Closed>('{"id":1}'));
expect("value", "a declared key twice", () => JSON.parse<Closed>('{"id":0,"id":1}'));
expect("value", "a declared key written with an escape", () => JSON.parse<Closed>('{"\\u0069d":1}'));
expect("TypeError", "one more key", () => JSON.parse<Closed>('{"id":1,"more":0}'));
expect("TypeError", "one more key first", () => JSON.parse<Closed>('{"more":0,"id":1}'));
expect("TypeError", "a key named __proto__", () => JSON.parse<Closed>('{"id":1,"__proto__":{}}'));
expect("TypeError", "a key named __proto__ that is null", () => JSON.parse<Closed>('{"id":1,"__proto__":null}'));
expect("TypeError", "a key named constructor", () => JSON.parse<Closed>('{"id":1,"constructor":1}'));
expect("TypeError", "a key named toString", () => JSON.parse<Closed>('{"id":1,"toString":1}'));
expect("TypeError", "an empty key", () => JSON.parse<Closed>('{"id":1,"":1}'));
expect("TypeError", "an index", () => JSON.parse<Closed>('{"id":1,"0":1}'));
expect("TypeError", "a key in other letters", () => JSON.parse<Closed>('{"id":1,"Id":1}'));
expect("TypeError", "a key with a space", () => JSON.parse<Closed>('{"id":1,"id ":1}'));
expect("TypeError", "a key whose value is null", () => JSON.parse<Closed>('{"id":1,"more":null}'));
expect("value", "strict outside only: more keys inside", () => JSON.parse<Outer>('{"inner":{"x":1,"more":0},"list":[{"y":1,"more":0}]}'));
expect("TypeError", "strict outside only: more keys outside", () => JSON.parse<Outer>('{"inner":{"x":1},"list":[],"more":0}'));
expect("value", "strict throughout: only declared keys", () => JSON.parse<Deep>('{"inner":{"x":1},"list":[{"y":1}]}'));
expect("TypeError", "strict throughout: more keys in a member", () => JSON.parse<Deep>('{"inner":{"x":1,"more":0},"list":[]}'));
expect("TypeError", "strict throughout: more keys in an element", () => JSON.parse<Deep>('{"inner":{"x":1},"list":[{"y":1},{"y":2,"more":0}]}'));
expect("TypeError", "strict throughout: more keys outside", () => JSON.parse<Deep>('{"inner":{"x":1},"list":[],"more":0}'));
