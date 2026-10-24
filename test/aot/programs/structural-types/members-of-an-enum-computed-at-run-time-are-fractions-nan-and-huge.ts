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

const given: number[] = JSON.parse("[0.5, null, 2147483648, 9007199254740993, -1]");

function at(index: number): number {
  return given[index] ?? NaN;
}

enum Base {
  Two = 2,
}

enum Made {
  Half = at(0),
  Nothing = at(1),
  Wide = at(2),
  Huge = at(3),
  Zero = at(4) * 0,
  Length = "abc".length,
  FromOther = Base.Two * at(0),
  Last = Math.sqrt(at(4)),
}

function plusOne(made: Made): number {
  return made + 1;
}
function whole(made: Made): number {
  return made | 0;
}
function nameOf(made: Made): string {
  return Made[made];
}
function isHalf(made: Made): boolean {
  return made === Made.Half;
}

class Holder {
  made: Made = Made.Length;
  list: Made[] = [];
  put(made: Made): this {
    this.made = made;
    this.list.push(made);
    return this;
  }
  sum(): number {
    let sum = 0;
    for (const made of this.list) sum += made;
    return sum + this.made;
  }
}

attempt("keys", () => Object.keys(Made));
attempt("entries", () => Object.entries(Made));

const members: [string, Made][] = [
  ["half", Made.Half],
  ["nothing", Made.Nothing],
  ["wide", Made.Wide],
  ["huge", Made.Huge],
  ["zero", Made.Zero],
  ["length", Made.Length],
  ["from other", Made.FromOther],
  ["last", Made.Last],
];

let warm = 0;
for (let i = 0; i < 2000; i++) warm += plusOne(Made.Length) + whole(Made.Length) + nameOf(Made.Length).length + new Holder().put(Made.Length).sum();
console.log("2000 rounds with the integer", warm);

for (const [label, made] of members) {
  attempt(label, () => [made, typeof made, plusOne(made), whole(made), nameOf(made), isHalf(made), 1 / made]);
  attempt(label + " held", () => {
    const holder = new Holder().put(Made.Length).put(made);
    return [holder.made, holder.list, holder.sum(), JSON.stringify(holder)];
  });
}
attempt("all in one list", () => {
  const holder = new Holder();
  for (const [, made] of members) holder.put(made);
  return [holder.list, holder.list.map(whole), holder.list.indexOf(Made.Nothing), holder.list.includes(Made.Nothing), holder.list.indexOf(Made.Zero)];
});
