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

class Gauge {
  level = 0;
  limit: number | null = null;
  extra: number | undefined = undefined;
  maybe?: number;
  read(): string {
    return [this.level, this.limit, this.extra, this.maybe].map(show).join(" ");
  }
  sum(): number {
    return this.level + (this.limit ?? 1000) + (this.extra ?? 2000) + (this.maybe ?? 3000);
  }
  has(): string {
    return [this.limit === null, this.extra === undefined, this.maybe === undefined, "maybe" in this, "extra" in this].join(" ");
  }
}

function set(g: Gauge, n: number): void {
  g.level = n;
  g.limit = n;
  g.extra = n;
  g.maybe = n;
}

attempt("honest", () => {
  const g = new Gauge();
  const before = g.read() + " / " + g.sum() + " / " + g.has();
  set(g, 5);
  return [before, g.read(), g.sum(), g.has()];
});
let warm = 0;
const busy = new Gauge();
for (let i = 0; i < 2000; i++) {
  set(busy, i & 1023);
  warm += busy.sum();
}
console.log("2000 honest rounds", warm);

const lowest = -2147483648;
for (const n of [lowest, lowest + 1, lowest + 2, lowest + 3, lowest + 4, lowest + 5, lowest - 1, 2147483647, 2147483648, -0, 0.5, NaN, Infinity]) {
  attempt("stored " + show(n), () => {
    const g = new Gauge();
    set(g, n);
    return [g.read(), g.sum(), g.has(), JSON.stringify(g)];
  });
  attempt("reached by counting " + show(n), () => {
    const g = new Gauge();
    set(g, n + 1);
    g.level -= 1;
    g.level += 0;
    if (g.limit !== null) g.limit--;
    return [g.level, g.limit, Object.is(g.level, n)];
  });
}

attempt("from a number to null, undefined and back", () => {
  const g = new Gauge();
  const seen: string[] = [];
  set(g, 7);
  seen.push(g.read());
  g.limit = null;
  g.extra = undefined;
  g.maybe = undefined;
  seen.push(g.read() + " " + g.has());
  delete g.maybe;
  seen.push(g.read() + " " + g.has());
  set(g, lowest + 2);
  seen.push(g.read() + " " + g.has());
  return seen;
});
attempt("in a literal", () => {
  const o: { a: number; b: number | null; c?: number } = { a: lowest + 1, b: lowest + 3, c: lowest + 2 };
  return [o.a, o.b, o.c, o.a + 1, JSON.stringify(o), o.b === null, o.c === undefined];
});
attempt("in a list", () => {
  const list: (number | null | undefined)[] = [lowest, lowest + 1, lowest + 2, lowest + 3, null, undefined];
  return [list, list.indexOf(null), list.indexOf(undefined), list.includes(lowest + 2), list.filter(v => v == null).length];
});
attempt("computed by bit operations", () => {
  const g = new Gauge();
  g.level = (1 << 31) | 1;
  g.limit = (1 << 31) + 2;
  g.extra = ~2147483644;
  return [g.read(), g.has()];
});
