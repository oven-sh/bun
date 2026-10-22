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

type HasLength = { length: number };

function inTheParameter({ length }: HasLength): number {
  return length;
}

function renamed({ length: size }: HasLength): number {
  return size + 1;
}

function inTheBody(item: HasLength): number {
  const { length } = item;
  return length;
}

function withADefault({ length = -1 }: { length?: number }): number {
  return length;
}

function withRest(item: HasLength): [number, string[]] {
  const { length, ...others } = item;
  return [length, Object.keys(others)];
}

function assigned(item: HasLength): number {
  let length = 0;
  ({ length } = item);
  return length;
}

function nested({ item: { length } }: { item: HasLength }): number {
  return length;
}

function fromAList([first, second]: HasLength[]): number[] {
  return [first.length, second.length];
}

function inAForOf(items: HasLength[]): number {
  let total = 0;
  for (const { length } of items) total += length;
  return total;
}

function method({ toFixed }: { toFixed(digits: number): string }): string {
  return typeof toFixed + " " + toFixed.name;
}

function computed(item: HasLength, key: "length"): number {
  const { [key]: value } = item;
  return value;
}

const values: [string, HasLength][] = [
  ["literal", { length: 4 }],
  ["string", "hello"],
  ["empty string", ""],
  ["array", [1, 2]],
  ["function", inTheBody],
  ["typed array", new Uint8Array(3)],
];

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = { length: i };
  warm += inTheParameter(honest) + renamed(honest) + inTheBody(honest) + withADefault(honest) + withRest(honest)[0] + assigned(honest);
  warm += nested({ item: honest }) + fromAList([honest, honest])[1] + inAForOf([honest]) + computed(honest, "length");
}
console.log("after 2000 literals", warm);

for (const [name, value] of values) {
  attempt(name + ": in the parameter", () => inTheParameter(value));
  attempt(name + ": renamed", () => renamed(value));
  attempt(name + ": in the body", () => inTheBody(value));
  attempt(name + ": with rest", () => withRest(value));
  attempt(name + ": assigned", () => assigned(value));
  attempt(name + ": nested", () => nested({ item: value }));
  attempt(name + ": from a list", () => fromAList([value, { length: 0 }]));
  attempt(name + ": in a for-of", () => inAForOf([{ length: 1 }, value, value]));
  attempt(name + ": by a computed key", () => computed(value, "length"));
}
attempt("a default that is not needed", () => [withADefault("abc"), withADefault(""), withADefault([]), withADefault({}), withADefault({ length: undefined })]);
attempt("a method of a number", () => [method(1), method(0.5), method({ toFixed: () => "" })]);
attempt("an empty pattern", () => {
  const take = ({}: {}) => "taken";
  return [take(0), take(""), take(false), take({})];
});
