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

function longest<T extends HasLength>(a: T, b: T): T {
  return a.length >= b.length ? a : b;
}

function lengths<T extends HasLength>(items: T[]): number[] {
  const result: number[] = [];
  for (const item of items) result.push(item.length);
  return result;
}

function describe<T extends HasLength>(item: T): string {
  return typeof item + " of " + item.length;
}

function withLength<T extends HasLength>(item: T): { item: T; size: number } {
  return { item, size: item.length };
}

class Measured<T extends HasLength> {
  constructor(public item: T) {}
  get size(): number {
    return this.item.length;
  }
  replace(next: T): T {
    const old = this.item;
    this.item = next;
    return old;
  }
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  warm += longest({ length: i }, { length: 5 }).length + lengths([{ length: i }])[0] + describe({ length: i }).length;
  warm += withLength({ length: i }).size + new Measured({ length: i }).size;
}
console.log("after 2000 literals", warm);

attempt("longest of two strings", () => longest("abc", "de"));
attempt("longest of two strings, upper case", () => longest("abc", "de").toUpperCase());
attempt("longest of two arrays", () => longest([1], [2, 3]));
attempt("longest of two functions", () => longest<HasLength>(describe, longest));
attempt("longest of a string and an array", () => longest<HasLength>("abcd", [1, 2, 3]));
attempt("longest of an array and a string", () => longest<HasLength>([1, 2, 3, 4, 5], "abcd"));
attempt("longest of a literal and a string", () => longest<HasLength>({ length: 2 }, "abc"));
attempt("longest of two empty strings", () => longest("", ""));
attempt("lengths of strings", () => lengths(["a", "", "abc"]));
attempt("lengths of a mix", () => lengths<HasLength>(["ab", [1], lengths, { length: 9 }, new Uint16Array(3)]));
attempt("describe a string", () => describe("hello"));
attempt("describe an array", () => describe([1, 2]));
attempt("describe a function", () => describe(describe));
attempt("describe a typed array", () => describe(new Float32Array(2)));
attempt("with length: a string", () => withLength("hello"));
attempt("with length: the string comes back", () => withLength("hello").item.charCodeAt(0));
attempt("measured string", () => {
  const measured = new Measured("hello");
  const before = measured.size;
  const old = measured.replace("hi");
  return [before, old, measured.size, measured.item.toUpperCase()];
});
attempt("measured holder gets each kind", () => {
  const measured = new Measured<HasLength>({ length: 1 });
  const seen: unknown[] = [measured.size];
  for (const next of ["ab", [1, 2, 3], longest, { length: 4 }, ""] satisfies HasLength[]) {
    measured.replace(next);
    seen.push(typeof measured.item, measured.size);
  }
  return seen;
});
attempt("a literal again", () => [longest({ length: 1 }, { length: 2 }), describe({ length: 3 })]);
