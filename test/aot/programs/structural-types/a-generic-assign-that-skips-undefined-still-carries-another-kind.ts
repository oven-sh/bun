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

interface Profile {
  age: number;
  score: number;
  nick: string;
}

function assignDefined<T extends object>(target: T, ...sources: Partial<T>[]): T {
  for (const source of sources) {
    for (const key in source) {
      const value = source[key];
      if (value !== undefined) target[key] = value;
    }
  }
  return target;
}

function report(title: string, p: Profile): void {
  console.log(title + ": " + typeof p.age + " " + show(p.age) + ", " + typeof p.score + " " + show(p.score) + ", " + typeof p.nick + " " + show(p.nick) + ", keys " + Object.keys(p).join() + ", " + JSON.stringify(p));
  attempt("  age + 1", () => p.age + 1);
  attempt("  score * 2", () => p.score * 2);
  attempt("  nick.toUpperCase()", () => p.nick.toUpperCase());
}

const p: Profile = { age: 1, score: 0.5, nick: "p" };
let total = 0;
for (let i = 0; i < 2000; i++) {
  assignDefined(p, { age: i }, { score: i / 2, nick: undefined }, {});
  total += p.age + p.score + p.nick.length;
}
console.log("2000 honest rounds: " + total);
report("honest", p);

const form = { age: 40, score: "high", nick: null };
const ageOnly: { age: number } = form;
assignDefined<Profile>(p, ageOnly);
report("a source that shows its age only", p);

const q: Profile = { age: 1, score: 0.5, nick: "q" };
const empty: {} = { age: "old", nick: 5 };
assignDefined<Profile>(q, empty);
report("a source that shows nothing", q);

const r: Profile = { age: 1, score: 0.5, nick: "r" };
const text: {} = "ab";
assignDefined<Profile>(r, text);
report("a source that is a string", r);

const s: Profile = { age: 1, score: 0.5, nick: "s" };
const list: {} = [7, 8];
assignDefined<Profile>(s, list);
report("a source that is a list", s);

export {};
