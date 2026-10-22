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

function first(entry: Entry): number {
  return entry[0] + 1;
}

function second(entry: Entry): string {
  return entry[1].toUpperCase();
}

function both(entry: Entry): string {
  const [count, name] = entry;
  return typeof count + " " + show(count) + ", " + typeof name + " " + show(name);
}

function withDefaults(entry: Entry): string {
  const [count = -1, name = "none"] = entry;
  return show(count) + " " + show(name);
}

function report(title: string, entry: Entry): void {
  console.log(title + ": " + show(entry) + " length " + lengthOf(entry) + " " + (entry.length === 2));
  attempt("  first + 1", () => first(entry));
  attempt("  second, upper case", () => second(entry));
  attempt("  both", () => both(entry));
  attempt("  with defaults", () => withDefaults(entry));
  attempt("  1 in it", () => 1 in entry);
  attempt("  typeof [1]", () => typeof entry[1]);
  attempt("  [1] + '!'", () => entry[1] + "!");
  attempt("  [0] * 2", () => entry[0] * 2);
}

let total = 0;
for (let i = 0; i < 2000; i++) {
  const entry: Entry = [i, "n"];
  total += lengthOf(entry) + first(entry) + second(entry).length + both(entry).length;
}
console.log("2000 honest rounds: " + total);

const popped: Entry = [1, "a"];
console.log("pop returns " + show(popped.pop()));
report("popped once", popped);
console.log("pop returns " + show(popped.pop()));
report("popped twice", popped);
console.log("pop returns " + show(popped.pop()));
report("popped three times", popped);

const shifted: Entry = [1, "a"];
console.log("shift returns " + show(shifted.shift()));
report("shifted once: the string is first", shifted);
console.log("shift returns " + show(shifted.shift()));
report("shifted twice", shifted);

const refilled: Entry = [1, "a"];
refilled.pop();
refilled.pop();
refilled.push("z");
refilled.push(26);
report("emptied and filled the other way around", refilled);

const restored: Entry = [1, "a"];
restored.pop();
restored.push("b");
report("popped and pushed honestly", restored);

export {};
