function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

type Described = { description?: string };

function descriptionOf(item: Described): string | undefined {
  return item.description;
}

function descriptionOrDefault(item: Described): string {
  return item.description ?? "none";
}

function lengthOfDescription(item: Described): number {
  return item.description === undefined ? -1 : item.description.length;
}

function chained(item: Described): string | undefined {
  return item.description?.toUpperCase();
}

function kindOf(item: Described): string {
  return typeof item;
}

function hasIt(item: Described): boolean {
  return "description" in item;
}

function copy(item: Described): Described {
  return { ...item };
}

function pattern({ description = "by default" }: Described): string {
  return description;
}

class Label {
  constructor(public item: Described) {}
  text(): string {
    return typeof this.item + ":" + this.item.description;
  }
}

const values: [string, Described][] = [
  ["an empty literal", {}],
  ["a literal", { description: "literal" }],
  ["a literal with undefined", { description: undefined }],
  ["a symbol", Symbol("mark")],
  ["a symbol with an empty description", Symbol("")],
  ["a symbol without a description", Symbol()],
  ["a registered symbol", Symbol.for("shared")],
  ["a well-known symbol", Symbol.iterator],
];

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest: Described = i % 2 === 0 ? { description: "d" + i } : {};
  warm += (descriptionOf(honest) ?? "").length + descriptionOrDefault(honest).length + lengthOfDescription(honest) + (chained(honest) ?? "").length;
  warm += kindOf(honest).length + (hasIt(honest) ? 1 : 0) + Object.keys(copy(honest)).length + pattern(honest).length + new Label(honest).text().length;
}
console.log("after 2000 literals", warm);

for (const [name, value] of values) {
  attempt(name + ": read", () => descriptionOf(value));
  attempt(name + ": or a default", () => descriptionOrDefault(value));
  attempt(name + ": its length", () => lengthOfDescription(value));
  attempt(name + ": chained", () => chained(value));
  attempt(name + ": typeof", () => kindOf(value));
  attempt(name + ": in", () => hasIt(value));
  attempt(name + ": spread", () => copy(value));
  attempt(name + ": a pattern with a default", () => pattern(value));
  attempt(name + ": in a field", () => new Label(value).text());
  attempt(name + ": JSON", () => JSON.stringify(value));
  attempt(name + ": keys", () => Object.keys(value));
}
attempt("elements", () => {
  const items: Described[] = [{ description: "a" }, Symbol("b"), {}, Symbol()];
  return items.map(item => item.description);
});
attempt("the same symbol twice", () => {
  const items: Described[] = [Symbol.for("x"), Symbol.for("x"), Symbol("x")];
  return [items[0] === items[1], items[0] === items[2], items.indexOf(items[2])];
});
