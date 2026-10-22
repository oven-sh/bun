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

type Shape = { kind: "circle"; radius: number } | { kind: "square"; side: number };
type Result = { ok: true; value: number } | { ok: false; error: string };
type Level = { level: 1; a: string } | { level: 2; b: string };

expect("value", "a circle", () => JSON.parse<Shape>('{"kind":"circle","radius":1}'));
expect("TypeError", "an unknown tag", () => JSON.parse<Shape>('{"kind":"triangle","radius":1,"side":1}'));
expect("TypeError", "no tag", () => JSON.parse<Shape>('{"radius":1,"side":1}'));
expect("TypeError", "a tag in other letters", () => JSON.parse<Shape>('{"kind":"Circle","radius":1}'));
expect("TypeError", "a tag with a space", () => JSON.parse<Shape>('{"kind":"circle ","radius":1}'));
expect("TypeError", "an empty tag", () => JSON.parse<Shape>('{"kind":"","radius":1}'));
expect("TypeError", "null as the tag", () => JSON.parse<Shape>('{"kind":null,"radius":1}'));
expect("TypeError", "a list as the tag", () => JSON.parse<Shape>('{"kind":["circle"],"radius":1}'));
expect("TypeError", "a circle with the members of a square", () => JSON.parse<Shape>('{"kind":"circle","side":1}'));
expect("TypeError", "a square with the members of a circle", () => JSON.parse<Shape>('{"radius":1,"kind":"square"}'));
expect("TypeError", "two tags, the last one decides", () => JSON.parse<Shape>('{"kind":"circle","radius":1,"kind":"square"}'));
expect("value", "two tags, the last one fits", () => JSON.parse<Shape>('{"kind":"square","radius":1,"kind":"circle"}'));
expect("TypeError", "the member is of another kind", () => JSON.parse<Shape>('{"kind":"circle","radius":"1"}'));
expect("TypeError", "the tag is in __proto__", () => JSON.parse<Shape>('{"__proto__":{"kind":"circle"},"radius":1}'));
expect("TypeError", "one bad shape among many", () => JSON.parse<Shape[]>("[" + '{"kind":"circle","radius":1},'.repeat(500) + '{"kind":"square","radius":1}]'));
expect("TypeError", "ok is true and there is only an error", () => JSON.parse<Result>('{"ok":true,"error":"e"}'));
expect("TypeError", "ok is 1", () => JSON.parse<Result>('{"ok":1,"value":1}'));
expect("TypeError", "ok is a text", () => JSON.parse<Result>('{"ok":"true","value":1}'));
expect("TypeError", "ok is null", () => JSON.parse<Result>('{"ok":null,"error":"e"}'));
expect("TypeError", "level 3", () => JSON.parse<Level>('{"level":3,"a":"a","b":"b"}'));
expect("TypeError", "level 1.5", () => JSON.parse<Level>('{"level":1.5,"a":"a","b":"b"}'));
expect("TypeError", "level as a text", () => JSON.parse<Level>('{"level":"1","a":"a"}'));
expect("TypeError", "level 1 with the member of level 2", () => JSON.parse<Level>('{"level":1,"b":"b"}'));
expect("value", "level 2", () => JSON.parse<Level>('{"b":"b","level":2}'));
