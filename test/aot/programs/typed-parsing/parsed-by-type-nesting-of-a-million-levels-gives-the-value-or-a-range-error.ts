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

type Nest = Nest[];
interface Chain {
  next: Chain | null;
}

function levels(nest: Nest): number {
  let count = 1;
  for (let at = nest; at.length > 0; at = at[0]) count++;
  return count;
}
function links(chain: Chain): number {
  let count = 0;
  for (let at: Chain | null = chain; at !== null; at = at.next) count++;
  return count;
}
function either(label: string, wanted: number, run: () => number): void {
  let got: string;
  try {
    const value = run();
    got = value === wanted ? "the value or a RangeError" : "another value: " + value;
  } catch (error) {
    got = error instanceof RangeError ? "the value or a RangeError" : error instanceof Error ? error.constructor.name : typeof error;
  }
  console.log(label, "->", got);
}

for (const depth of [10_000, 100_000, 1_000_000]) {
  either(depth + " lists", depth, () => levels(JSON.parse<Nest>("[".repeat(depth) + "]".repeat(depth))));
  either(depth + " objects", depth, () => links(JSON.parse<Chain>('{"next":'.repeat(depth) + "null" + "}".repeat(depth))));
  attempt(depth + " lists that are never closed", () => JSON.parse<Nest>("[".repeat(depth)));
  attempt("afterwards", () => [levels(JSON.parse<Nest>("[[[]]]")), links(JSON.parse<Chain>('{"next":{"next":null}}'))]);
}
