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

type Entry = [number, string, number];

function use(entry: Entry): string {
  return entry[0] + entry[2] + " " + entry[1].toUpperCase();
}

function report(title: string, entry: Entry): void {
  console.log(title + ": " + show(entry) + " " + typeof entry[0] + " " + typeof entry[1] + " " + typeof entry[2]);
  attempt("  used", () => use(entry));
  attempt("  [0] + [2]", () => entry[0] + entry[2]);
  attempt("  [0] * [2]", () => entry[0] * entry[2]);
  attempt("  [1].length", () => entry[1].length);
}

function fresh(): Entry {
  return [1, "a", 2.5];
}

let total = 0;
for (let i = 0; i < 2000; i++) total += use([i, "n", 0.5]).length;
console.log("2000 honest rounds: " + total);

report("filled with a string", fresh().fill("x"));
report("filled with a number", fresh().fill(7));
report("filled with a string from 2 on", fresh().fill("x", 2));
report("filled with a number at 1 only", fresh().fill(7, 1, 2));
report("filled from -1 on", fresh().fill("end", -1));
report("filled nowhere", fresh().fill("x", 3));
report("the second is copied to the front", fresh().copyWithin(0, 1, 2));
report("the first is copied to the middle", fresh().copyWithin(1, 0, 1));
report("everything moves one to the left", fresh().copyWithin(0, 1));
report("everything moves one to the right", fresh().copyWithin(1, 0));

const kept = fresh();
const same = kept.fill("kept");
console.log("fill returns the same list: " + Object.is(kept, same));
report("seen through the first name", kept);

export {};
