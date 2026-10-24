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
type Wide = [number, string, () => number, { id: number }];

function set<T, K extends keyof T>(target: T, key: K, value: T[K]): void {
  target[key] = value;
}

function swap<T, K extends keyof T>(target: T, a: K, b: K): void {
  const kept = target[a];
  target[a] = target[b];
  target[b] = kept;
}

function use(entry: Entry): string {
  return entry[0] + 1 + " " + entry[1].toUpperCase();
}

function destructured(entry: Entry): string {
  const [count, name] = entry;
  return count * 2 + " " + name.length;
}

const yes: boolean = process.argv.length > 0;

function report(title: string, entry: Entry): void {
  console.log(title + ": " + show(entry) + " " + typeof entry[0] + " " + typeof entry[1] + " length " + entry.length);
  attempt("  used", () => use(entry));
  attempt("  destructured", () => destructured(entry));
  attempt("  [0].toFixed(1)", () => entry[0].toFixed(1));
  attempt("  [1].length", () => entry[1].length);
}

let total = 0;
for (let i = 0; i < 2000; i++) {
  const entry: Entry = [0, "a"];
  set(entry, 0, i);
  set(entry, 1, "n" + i);
  total += use(entry).length + destructured(entry).length;
}
console.log("2000 honest rounds: " + total);

const a: Entry = [1, "a"];
set(a, yes ? 0 : 1, "text");
report("a string in the first place", a);
set(a, yes ? 1 : 0, 2);
report("a number in the second place", a);

const b: Entry = [1, "b"];
swap(b, 0, 1);
report("the places are exchanged", b);
swap(b, 0, 1);
report("and back", b);

const c: Entry = [1, "c"];
set(c, yes ? "0" : "1", "by a string key");
report("the key is a string of digits", c);

const d: Entry = [1, "d"];
set(d, yes ? "length" : 0, 1);
report("the length or the first place: the length", d);

const w: Wide = [1, "w", () => 2, { id: 3 }];
swap(w, 0, 2);
swap(w, 1, 3);
console.log("four places, exchanged in pairs: " + typeof w[0] + " " + typeof w[1] + " " + typeof w[2] + " " + typeof w[3]);
attempt("  [0] + 1", () => typeof (w[0] + 1));
attempt("  [1].length", () => w[1].length);
attempt("  [2]()", () => w[2]());
attempt("  [3].id", () => w[3].id);

export {};
