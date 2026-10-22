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

const enum Fast {
  Zero,
  One,
  Two = One + One,
  Text = "text",
  Negative = -1,
  Big = 2 ** 31,
  Shifted = 1 << 31,
  Fraction = 1 / 4,
  MinusZero = -0,
  Glued = `a${"b"}`,
}

enum Slow {
  Zero,
  One,
  Two = One + One,
  Text = "text",
  Negative = -1,
  Big = 2 ** 31,
  Shifted = 1 << 31,
  Fraction = 1 / 4,
  Nothing = 0 / 0,
  Endless = 1 / 0,
  MinusZero = -0,
  Glued = `a${"b"}`,
}

function fastName(f: Fast): string {
  switch (f) {
    case Fast.Zero:
      return "zero";
    case Fast.One:
      return "one";
    case Fast.Two:
      return "two";
    case Fast.Text:
      return "text";
    default:
      return "other " + f;
  }
}

function fastMath(f: Fast.One | Fast.Two): number {
  return f * 10;
}

attempt("const enum values", () => [Fast.Zero, Fast.One, Fast.Two, Fast.Text, Fast.Negative, Fast.Big, Fast.Shifted, Fast.Fraction, Fast.MinusZero, Fast.Glued]);
attempt("plain enum values", () => [Slow.Zero, Slow.One, Slow.Two, Slow.Text, Slow.Negative, Slow.Big, Slow.Shifted, Slow.Fraction, Slow.Nothing, Slow.Endless, Slow.MinusZero, Slow.Glued]);
attempt("by a quoted name", () => [Fast["Two"], Slow["Two"], Fast["Text"], Slow["Text"]]);
attempt("plain enum keys", () => Object.keys(Slow));
attempt("plain enum reverse", () => [Slow[0], Slow[1], Slow[2], Slow[-1], Slow[2147483648], Slow[-2147483648], Slow[0.25], Slow[NaN], Slow[Infinity]]);
attempt("one over minus zero", () => [1 / Fast.MinusZero, 1 / Slow.MinusZero, Object.is(Fast.MinusZero, -0), Object.is(Slow.MinusZero, -0)]);
attempt("names", () => [fastName(Fast.Zero), fastName(Fast.Two), fastName(Fast.Text), fastName(Fast.Big), fastName(Fast.MinusZero)]);
attempt("math", () => [fastMath(Fast.One), fastMath(Fast.Two), Fast.Big + 1, Fast.Shifted - 1, Fast.Big | 0, Fast.Fraction * 4]);
attempt("typeof", () => [typeof Fast.One, typeof Fast.Text, typeof Slow.One, typeof Slow, typeof Slow.Text]);
attempt("as keys", () => {
  const table = { [Fast.One]: "one", [Fast.Text]: "text", [Fast.Negative]: "negative", [Fast.Fraction]: "fraction" };
  return [Object.keys(table), table[Fast.One], table[Fast.Text], table[Fast.Negative]];
});
attempt("a number outside a const enum", () => {
  const n: number = 77;
  const f: Fast = n;
  return fastName(f);
});
attempt("a number typed as one member of a const enum", () => {
  const n: number = 77;
  const f: Fast.One = n;
  return [f, fastMath(f), f === Fast.One];
});
attempt("compared with each other through numbers", () => {
  const a: number = Fast.Two;
  const b: number = Slow.Two;
  return [a === b, Slow.Nothing === Slow.Nothing, Object.is(Slow.Nothing, NaN), Slow.Endless > Fast.Big];
});
let warm = 0;
for (let i = 0; i < 2000; i++) warm += fastMath(i & 1 ? Fast.One : Fast.Two) + fastName(Fast.Two).length + Slow.Two + Fast.Negative;
console.log("2000 rounds", warm);
attempt("the plain enum's object is stored to through an alias", () => {
  const open: { One: number; Text: string } = Slow;
  open.One = 100;
  open.Text = "changed";
  const read: { readonly One: number; readonly Text: string } = Slow;
  return [Slow.One, Slow.Text, read.One, read.Text, Slow[1], Slow[100], Object.keys(Slow).length];
});
