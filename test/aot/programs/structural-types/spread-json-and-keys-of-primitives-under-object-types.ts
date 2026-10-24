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

function spread(item: HasLength): HasLength {
  return { ...item };
}

function spreadWithMore(item: HasLength): { first: number; length: number; last: number } {
  return { first: 1, ...item, last: 2 };
}

function spreadThenOverride(item: HasLength): HasLength {
  return { ...item, length: -1 };
}

function lengthOfSpread(item: HasLength): number {
  const copy = { ...item };
  return copy.length;
}

function json(item: HasLength): string {
  return JSON.stringify(item);
}

function jsonInside(item: HasLength): string {
  return JSON.stringify({ item, list: [item] });
}

function keys(item: HasLength): string[] {
  return Object.keys(item);
}

function entries(item: HasLength): [string, unknown][] {
  return Object.entries(item);
}

function rest(item: HasLength): {} {
  const { length, ...others } = item;
  return { length, others };
}

const makers: [string, () => HasLength][] = [
  ["literal", () => ({ length: 2 })],
  ["wider literal", () => ({ z: 1, length: 2, a: 3 })],
  ["string", () => "ab"],
  ["empty string", () => ""],
  ["array", () => [7, 8]],
  ["function", () => spread],
  ["typed array", () => new Uint8Array([5, 6])],
  ["String object", () => new String("ab")],
  ["function with members", () => Object.assign((a: number) => a, { extra: true })],
];

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = { length: i };
  warm += spread(honest).length + spreadWithMore(honest).length + spreadThenOverride(honest).length + lengthOfSpread(honest);
  warm += json(honest).length + jsonInside(honest).length + keys(honest).length + entries(honest).length + Object.keys(rest(honest)).length;
}
console.log("after 2000 literals", warm);

for (const [name, make] of makers) {
  attempt(name + ": spread", () => spread(make()));
  attempt(name + ": spread between members", () => spreadWithMore(make()));
  attempt(name + ": keys of that", () => Object.keys(spreadWithMore(make())));
  attempt(name + ": spread, then length", () => spreadThenOverride(make()));
  attempt(name + ": the length of the spread", () => lengthOfSpread(make()));
  attempt(name + ": JSON", () => json(make()));
  attempt(name + ": JSON inside", () => jsonInside(make()));
  attempt(name + ": keys", () => keys(make()));
  attempt(name + ": entries", () => entries(make()));
  attempt(name + ": rest", () => rest(make()));
}
