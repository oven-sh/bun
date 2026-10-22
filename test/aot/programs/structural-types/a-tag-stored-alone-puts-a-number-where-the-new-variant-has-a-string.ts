function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return "{" + Object.entries(value).map(([key, held]) => key + ": " + show(held)).join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

interface Count {
  kind: "count";
  value: number;
}
interface Name {
  kind: "name";
  value: string;
}
interface Group {
  kind: "group";
  value: Count[];
}
type Entry = Count | Name | Group;

function size(entry: Entry): number {
  if (entry.kind === "count") return entry.value + 1;
  if (entry.kind === "name") return entry.value.length;
  return entry.value.length * 100;
}
function text(entry: Entry): string {
  switch (entry.kind) {
    case "count":
      return entry.value.toFixed(1);
    case "name":
      return entry.value.toUpperCase();
    case "group":
      return entry.value.map(count => count.value).join("+");
  }
}
function retag(entry: Entry, kind: Entry["kind"]): Entry {
  entry.kind = kind;
  return entry;
}

const makers: [string, () => Entry][] = [
  ["count", () => ({ kind: "count", value: 41 })],
  ["fraction", () => ({ kind: "count", value: 0.5 })],
  ["name", () => ({ kind: "name", value: "abc" })],
  ["group", () => ({ kind: "group", value: [{ kind: "count", value: 1 }, { kind: "count", value: 2 }] })],
];
const kinds: Entry["kind"][] = ["count", "name", "group"];

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const entry = makers[i % 4][1]();
  warm += size(entry) + text(entry).length;
}
console.log("2000 honest rounds", warm);

for (const [from, make] of makers) {
  for (const to of kinds) {
    attempt(from + " tagged " + to + ": size", () => size(retag(make(), to)));
    attempt(from + " tagged " + to + ": text", () => text(retag(make(), to)));
    attempt(from + " tagged " + to + ": json", () => JSON.stringify(retag(make(), to)));
  }
}
