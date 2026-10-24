function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    if (list.length > 40) return "array of " + list.length + " with keys " + Object.keys(list).join();
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  for (const [key, member] of Object.entries(value)) parts.push(key + ": " + show(member));
  return "{" + parts.join(", ") + "}";
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

type Entry = [number, string];

function lengthOf(entry: Entry): number {
  return entry.length;
}

function isAPair(entry: Entry): boolean {
  return entry.length === 2;
}

function use(entry: Entry): string {
  const [count, name] = entry;
  return count + 1 + name.toUpperCase();
}

function rest(entry: Entry): unknown[] {
  const [, ...others] = entry;
  return others;
}

function walk(entry: Entry): string {
  let text = "";
  for (const member of entry) text += typeof member === "number" ? member + 1 : member.toUpperCase();
  return text;
}

function byIndex(entry: Entry): string {
  let text = "";
  for (let i = 0; i < entry.length; i++) text += typeof entry[i] + " ";
  return text;
}

function counted(count: number, name: string): string {
  return arguments.length + " " + count + " " + name;
}

function report(title: string, entry: Entry): void {
  console.log(title + ": " + show(entry) + " " + JSON.stringify(entry));
  attempt("  length", () => [lengthOf(entry), isAPair(entry), entry.length]);
  attempt("  used", () => use(entry));
  attempt("  the rest", () => rest(entry));
  attempt("  walked", () => walk(entry));
  attempt("  by index", () => byIndex(entry));
  attempt("  spread into a list", () => [...entry]);
  attempt("  spread into a call", () => counted(...entry));
  attempt("  the last one", () => entry[entry.length - 1]);
  attempt("  at(-1)", () => entry.at(-1));
}

let total = 0;
for (let i = 0; i < 2000; i++) {
  const entry: Entry = [i, "n"];
  total += lengthOf(entry) + use(entry).length + walk(entry).length + (isAPair(entry) ? 1 : 0);
}
console.log("2000 honest rounds: " + total);

const entry: Entry = [1, "a"];
report("before", entry);
console.log("push returns " + entry.push(2));
report("a number is pushed", entry);
console.log("push returns " + entry.push("b", "c"));
report("two strings are pushed", entry);
console.log("unshift returns " + entry.unshift("first"));
report("a string is put in front", entry);
console.log("unshift returns " + entry.unshift(0.5));
report("a fraction is put in front of that", entry);

export {};
