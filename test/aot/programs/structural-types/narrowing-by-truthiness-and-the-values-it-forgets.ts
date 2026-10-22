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

function orText(n: number): 0 | string {
  return n && "text";
}

function useOrText(n: number): number {
  const r = orText(n);
  return r === 0 ? -1 : r.length;
}

function emptyOr(s: string): "" | number {
  return s && s.length;
}

function lengthIfAny(s: string | null | undefined): number {
  if (s) return s.length;
  return -1;
}

function whatIsFalsy(v: number | string | null): string {
  if (!v) return v === null ? "null" : typeof v === "number" ? "number " + Object.is(v, 0) : "empty " + v.length;
  return "truthy";
}

function defaulted(n: number | undefined): number {
  return (n || 10) + 1;
}

function coalesced(n: number | undefined | null): number {
  return (n ?? 10) + 1;
}

function chained(o: { inner?: { n: number } | null }): number {
  return (o.inner?.n ?? -1) + 1;
}

function both(a: { n: number } | null, b: { n: number } | null): number {
  return a && b ? a.n + b.n : -1;
}

function bigOrNothing(b: bigint | undefined): string {
  return b ? "big " + (b + 1n) : "nothing " + typeof b;
}

attempt("honest", () => [orText(0), orText(1), useOrText(0), useOrText(1), emptyOr(""), emptyOr("ab"), lengthIfAny("ab"), lengthIfAny(null), whatIsFalsy(0), whatIsFalsy(""), whatIsFalsy(null), whatIsFalsy(1), defaulted(1), defaulted(undefined), coalesced(null), chained({}), chained({ inner: { n: 1 } }), both({ n: 1 }, { n: 2 })]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += useOrText(i) + lengthIfAny("ab") + defaulted(i) + coalesced(i) + chained({ inner: { n: i } }) + both({ n: i }, { n: 1 });
console.log("2000 honest rounds", warm);

attempt("NaN is typed 0: the value", () => orText(NaN));
attempt("NaN is typed 0: used", () => useOrText(NaN));
attempt("negative zero is typed 0: the value", () => orText(-0));
attempt("negative zero is typed 0: used", () => useOrText(-0));
attempt("NaN is typed 0: divided", () => {
  const r = orText(NaN);
  return typeof r === "number" ? 1 / r : r;
});
attempt("NaN is falsy", () => [whatIsFalsy(NaN), whatIsFalsy(-0), defaulted(NaN), defaulted(0), defaulted(-0), coalesced(NaN), coalesced(0)]);
attempt("zero as a bigint", () => [bigOrNothing(0n), bigOrNothing(1n), bigOrNothing(undefined)]);
attempt("an empty string", () => [lengthIfAny(""), emptyOr("")]);
attempt("a member tested and then cleared", () => {
  const o: { name: string | null } = { name: "abc" };
  const clear = () => {
    o.name = null;
  };
  if (o.name) {
    clear();
    return o.name.length;
  }
  return -1;
});
attempt("a member tested through a getter", () => {
  let reads = 0;
  const o: { readonly name: string | null } = {
    get name(): string | null {
      return reads++ === 0 ? "abc" : null;
    },
  };
  return o.name ? o.name.length : -1;
});
attempt("an optional chain over a getter", () => {
  let reads = 0;
  const o: { readonly inner?: { n: number } | null } = {
    get inner(): { n: number } | null {
      log.push("get-inner");
      return reads++ === 0 ? { n: 5 } : null;
    },
  };
  return [chained(o), chained(o)];
});
attempt("an object is always truthy, even a boxed false", () => {
  const check = (v: Boolean | null): string => (v ? "truthy " + v.valueOf() : "null");
  return [check(new Boolean(false)), check(false), check(null)];
});
attempt("in a loop condition", () => {
  const list: (number | undefined)[] = [3, 2, 0, 1];
  let sum = 0;
  for (let i = 0, v = list[0]; v; v = list[++i]) sum += v;
  return sum;
});
attempt("honest again", () => [orText(0), useOrText(1), lengthIfAny("ab"), whatIsFalsy(0), defaulted(1), coalesced(null), chained({})]);
