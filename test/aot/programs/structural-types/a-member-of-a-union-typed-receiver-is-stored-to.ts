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

type Holder = { v: number; twice(): number } | { v: string; size(): number };

function numberHolder(): Holder {
  const h: { v: number; twice(): number } = {
    v: 2,
    twice() {
      return this.v * 2;
    },
  };
  return h;
}

function textHolder(): Holder {
  const h: { v: string; size(): number } = {
    v: "ab",
    size() {
      return this.v.length;
    },
  };
  return h;
}

function use(h: Holder): number {
  return "twice" in h ? h.twice() : h.size();
}

function putText(h: Holder): void {
  h.v = "text";
}

function putNumber(h: Holder): void {
  h.v = 7;
}

class Meter {
  amount: number = 1;
  next(): number {
    return this.amount + 1;
  }
}

class Label {
  amount: string = "one";
  next(): number {
    return this.amount.length;
  }
}

function relabel(x: Meter | Label): void {
  x.amount = "relabeled";
}

function remeasure(x: Meter | Label): void {
  x.amount = 5;
}

attempt("honest", () => [use(numberHolder()), use(textHolder()), new Meter().next(), new Label().next()]);
let warm = 0;
for (let i = 0; i < 2000; i++) {
  const n = numberHolder();
  putNumber(n);
  const t = textHolder();
  putText(t);
  const m = new Meter();
  remeasure(m);
  warm += use(n) + use(t) + m.next();
}
console.log("2000 honest rounds", warm);

attempt("text in the number holder", () => {
  const h = numberHolder();
  putText(h);
  return [use(h), h.v];
});
attempt("a number in the text holder", () => {
  const h = textHolder();
  putNumber(h);
  return [use(h), h.v];
});
attempt("text in the meter", () => {
  const m = new Meter();
  relabel(m);
  return [m.next(), m.amount, typeof m.amount, m.amount + 1];
});
attempt("a number in the label", () => {
  const l = new Label();
  remeasure(l);
  return [l.next(), l.amount, typeof l.amount];
});
attempt("a number in the label, then a string method", () => {
  const l = new Label();
  remeasure(l);
  return l.amount.toUpperCase();
});
attempt("in a loop over both kinds", () => {
  const all: (Meter | Label)[] = [new Meter(), new Label(), new Meter()];
  for (const x of all) relabel(x);
  return all.map(x => x.next());
});
attempt("after narrowing the store is checked, before it is not", () => {
  const m = new Meter();
  const both: Meter | Label = m;
  const wide: Meter | Label = [both, new Label()][0];
  wide.amount = "wide";
  return m.amount + 1;
});
attempt("honest again", () => [use(numberHolder()), use(textHolder()), new Meter().next(), new Label().next()]);
