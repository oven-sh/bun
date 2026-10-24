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

const weights = new WeakMap<HasLength, number>();
const seen = new WeakSet<HasLength>();

function remember(item: HasLength, weight: number): number | undefined {
  weights.set(item, weight);
  return weights.get(item);
}

function recall(item: HasLength): number | undefined {
  return weights.get(item);
}

function known(item: HasLength): boolean {
  return weights.has(item);
}

function forget(item: HasLength): boolean {
  return weights.delete(item);
}

function mark(item: HasLength): boolean {
  seen.add(item);
  return seen.has(item);
}

function marked(item: HasLength): boolean {
  return seen.has(item);
}

function weakly(item: HasLength): number | undefined {
  return new WeakRef(item).deref()?.length;
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = { length: i };
  warm += (remember(honest, i) ?? 0) + (recall(honest) ?? 0) + (known(honest) ? 1 : 0) + (forget(honest) ? 1 : 0) + (mark(honest) ? 1 : 0) + (marked(honest) ? 1 : 0) + (weakly(honest) ?? 0);
}
console.log("after 2000 literals", warm);

const values: [string, HasLength][] = [
  ["literal", { length: 1 }],
  ["string", "abc"],
  ["empty string", ""],
  ["array", [1]],
  ["function", remember],
  ["String object", new String("abc")],
];
for (const [name, value] of values) {
  attempt(name + ": get before", () => recall(value));
  attempt(name + ": has before", () => known(value));
  attempt(name + ": delete before", () => forget(value));
  attempt(name + ": set", () => remember(value, 5));
  attempt(name + ": get after", () => recall(value));
  attempt(name + ": has after", () => known(value));
  attempt(name + ": add", () => mark(value));
  attempt(name + ": marked", () => marked(value));
  attempt(name + ": WeakRef", () => weakly(value));
}

function keyed(key: {} & object, value: number): number | undefined {
  return new WeakMap<object, number>([[key, value]]).get(key);
}
attempt("an object key", () => keyed({}, 1));
attempt("made from entries with a string key", () => new WeakMap<HasLength, number>([[{ length: 1 }, 1], ["abc", 2]]).has("abc"));
attempt("made from members with a string", () => new WeakSet<HasLength>([[1], "abc"]).has("abc"));
attempt("a symbol under a description", () => {
  const notes = new WeakMap<{ description?: string }, string>();
  const local = Symbol("local");
  notes.set(local, "kept");
  return notes.get(local);
});
attempt("a registered symbol under a description", () => {
  const notes = new WeakMap<{ description?: string }, string>();
  notes.set(Symbol.for("registered"), "kept");
  return notes.get(Symbol.for("registered"));
});
