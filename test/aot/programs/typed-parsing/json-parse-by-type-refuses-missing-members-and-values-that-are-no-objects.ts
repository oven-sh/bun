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

interface User {
  id: number;
  name: string;
  extra?: boolean;
  anything: unknown;
  maybe: number | undefined;
}

const whole = '{"id":1,"name":"n","anything":0,"maybe":2}';
expect("value", "whole", () => JSON.parse<User>(whole));
expect("TypeError", "without id", () => JSON.parse<User>('{"name":"n","anything":0,"maybe":2}'));
expect("TypeError", "without name", () => JSON.parse<User>('{"id":1,"anything":0,"maybe":2}'));
expect("TypeError", "without the member of type unknown", () => JSON.parse<User>('{"id":1,"name":"n","maybe":2}'));
expect("TypeError", "without the member that may be undefined", () => JSON.parse<User>('{"id":1,"name":"n","anything":0}'));
expect("TypeError", "empty", () => JSON.parse<User>("{}"));
expect("TypeError", "only undeclared members", () => JSON.parse<User>('{"ID":1,"Name":"n","id ":1}'));
expect("TypeError", "the members one level too deep", () => JSON.parse<User>('{"user":' + whole + "}"));
expect("TypeError", "the members in __proto__", () => JSON.parse<User>('{"__proto__":' + whole + "}"));
expect("TypeError", "some of the members in __proto__", () => JSON.parse<User>('{"id":1,"__proto__":{"name":"n","anything":0,"maybe":2}}'));
expect("TypeError", "null for the optional member", () => JSON.parse<User>('{"id":1,"name":"n","anything":0,"maybe":2,"extra":null}'));
expect("TypeError", "null for the member that may be undefined", () => JSON.parse<User>('{"id":1,"name":"n","anything":0,"maybe":null}'));
expect("value", "null for the member of type unknown", () => JSON.parse<User>('{"id":1,"name":"n","anything":null,"maybe":2}'));
for (const text of ["null", "1", '"text"', "true", "[]", "[" + whole + "]", '"' + whole.replaceAll('"', '\\"') + '"']) expect("TypeError", "instead of the object: " + text, () => JSON.parse<User>(text));

interface Named {
  toString: string;
  constructor: number;
}
expect("value", "members named like inherited ones", () => JSON.parse<Named>('{"toString":"s","constructor":1}'));
expect("TypeError", "members named like inherited ones are missing", () => JSON.parse<Named>("{}"));
expect("TypeError", "one of them is missing", () => JSON.parse<Named>('{"toString":"s"}'));
