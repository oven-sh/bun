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

type Entry = [number, string, boolean];

function use(entry: Entry): string {
  return entry[0] + 1 + " " + entry[1].toUpperCase() + " " + (entry[2] ? "yes" : "no");
}

function kinds(entry: Entry): string {
  const [a, b, c] = entry;
  return typeof a + " " + typeof b + " " + typeof c;
}

function report(title: string, entry: Entry, removed: unknown): void {
  console.log(title + ": " + show(entry) + " length " + entry.length + ", removed " + show(removed));
  attempt("  kinds", () => kinds(entry));
  attempt("  used", () => use(entry));
  attempt("  [2] === true", () => entry[2] === true);
  attempt("  [0] | 0", () => entry[0] | 0);
}

function fresh(): Entry {
  return [1, "a", true];
}

let total = 0;
for (let i = 0; i < 2000; i++) total += use([i, "n", i % 2 === 0]).length + kinds([i, "n", false]).length;
console.log("2000 honest rounds: " + total);

const a = fresh();
report("the first is removed", a, a.splice(0, 1));
const b = fresh();
report("the middle is removed", b, b.splice(1, 1));
const c = fresh();
report("all are removed", c, c.splice(0));
const d = fresh();
report("a string is inserted in front", d, d.splice(0, 0, "front"));
const e = fresh();
report("the first is replaced by a boolean", e, e.splice(0, 1, false));
const f = fresh();
report("all three are replaced the other way around", f, f.splice(0, 3, true, "a", 1));
const g = fresh();
report("from the end", g, g.splice(-1, 1, 0.5));
const h = fresh();
report("a start past the end", h, h.splice(9, 1, "appended"));
const i = fresh();
report("nothing happens", i, i.splice(1, 0));
const j = fresh();
report("a fractional start and count", j, j.splice(1.9, 1.9));
const k = fresh();
report("toSpliced leaves it alone", k, k.toSpliced(0, 2));

export {};
