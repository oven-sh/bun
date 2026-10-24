function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

let calls = 0;
function counted(n: number): number {
  calls++;
  return n;
}

enum Size {
  Small = "ab".length,
  Medium = Small * 2,
  Large = counted(10),
  Huge = Math.floor(99.9),
  Odd = counted(0.5),
  Missing = counted(NaN),
  Negative = -counted(0),
}

enum Flags {
  None = 0,
  Read = 1 << 0,
  Write = 1 << 1,
  All = Read | Write,
  High = 1 << 31,
  Top = 1 << 30,
}

enum Mixed {
  No = 0,
  Yes = "YES",
  Count = "abc".length,
}

enum Gaps {
  A = 5,
  B,
  C = 1,
  D,
  E = D,
}

function sizeName(s: Size): string {
  return Size[s];
}

function sizePlus(s: Size): number {
  return s + 1;
}

function can(f: Flags, wanted: Flags): boolean {
  return (f & wanted) === wanted;
}

attempt("values", () => [Size.Small, Size.Medium, Size.Large, Size.Huge, Size.Odd, Size.Missing, Size.Negative, calls]);
attempt("keys", () => Object.keys(Size));
attempt("reverse", () => [Size[2], Size[4], Size[10], Size[99], Size[0.5], Size[NaN], Size[0], Size[-0]]);
attempt("names", () => [sizeName(Size.Small), sizeName(Size.Odd), sizeName(Size.Missing), sizeName(Size.Negative)]);
attempt("plus one", () => [sizePlus(Size.Small), sizePlus(Size.Odd), sizePlus(Size.Missing), sizePlus(Size.Negative)]);
attempt("one over the negative member", () => 1 / Size.Negative);
attempt("any literal is a Size", () => {
  const s: Size = 12345;
  return [sizeName(s), sizePlus(s)];
});
attempt("flags", () => [Flags.None, Flags.Read, Flags.Write, Flags.All, Flags.High, Flags.Top, Flags.High | Flags.Top, Flags.High >>> 0, Flags.Top * 2, Flags.Top + Flags.Top]);
attempt("flag tests", () => [can(Flags.All, Flags.Read), can(Flags.Read, Flags.All), can(Flags.High, Flags.High), can(Flags.Read | Flags.High, Flags.High), can(Flags.None, Flags.None)]);
attempt("flag names", () => [Flags[3], Flags[Flags.High], Flags[Flags.Read | Flags.Top], Flags[-2147483648], Flags[2147483648]]);
attempt("flag keys", () => Object.keys(Flags));
attempt("mixed", () => [Mixed.No, Mixed.Yes, Mixed.Count, Mixed[0], Mixed[3], Object.keys(Mixed)]);
attempt("gaps", () => [Gaps.A, Gaps.B, Gaps.C, Gaps.D, Gaps.E, Gaps[2], Gaps[6], Object.keys(Gaps)]);
attempt("the initializers ran once", () => calls);

let warm = 0;
for (let i = 0; i < 2000; i++) warm += sizePlus(Size.Large) + sizeName(Size.Huge).length + (can(Flags.All, Flags.Write) ? 1 : 0) + Size.Medium + Flags.Top;
console.log("2000 rounds", warm);

attempt("an enum declared twice", () => {
  enum Part {
    A = 1,
  }
  enum Part {
    B = 2,
  }
  return [Part.A, Part.B, Object.keys(Part)];
});
attempt("an enum in a function is made anew each time", () => {
  const make = (base: number) => {
    enum Local {
      First = base,
      Second = base * 2,
    }
    return Local;
  };
  const a = make(1);
  const b = make(10);
  return [a.First, a.Second, b.First, b.Second, a === b, a[1], b[10]];
});
attempt("iterated", () => {
  const seen: string[] = [];
  for (const key in Gaps) seen.push(key);
  return [seen, Object.values(Gaps), Object.entries(Mixed).length];
});
