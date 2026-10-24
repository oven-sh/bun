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

class Reading {
  zero = -0;
  odd = NaN;
  huge = Infinity;
  small = 5e-324;
  whole = 2 ** 53;
  missing: number | undefined = undefined;
  none: number | null = null;
  when = new Date(86400000);
  tags = new Set<string>(["a"]);
  byName = new Map<string, number>([["a", 1]]);
  bytes = new Uint8Array([1, 2]);
  holes: number[] = [1, 2, 3];
  pattern = /x/g;
  text = "line\n \ud800";
  nested = { deep: { deeper: [1, { deepest: true }] } };
  double(): number {
    return this.whole * 2;
  }
}

function roundTrip(reading: Reading): Reading {
  return JSON.parse(JSON.stringify(reading));
}

function year(reading: Reading): number {
  return reading.when.getUTCFullYear();
}

function hasTag(reading: Reading): boolean {
  return reading.tags.has("a");
}

function byName(reading: Reading): number | undefined {
  return reading.byName.get("a");
}

function sumBytes(reading: Reading): number {
  let sum = 0;
  for (let i = 0; i < reading.bytes.length; i++) sum += reading.bytes[i];
  return sum;
}

function oddPlusOne(reading: Reading): number {
  return reading.odd + 1;
}

let warm = 0;
for (let i = 0; i < 1000; i++) {
  const honest = new Reading();
  warm += year(honest) + (hasTag(honest) ? 1 : 0) + (byName(honest) ?? 0) + sumBytes(honest) + honest.double();
}
console.log("after 1000 honest readings", warm);

const source = new Reading();
delete source.holes[1];
const copy = roundTrip(source);

attempt("keys", () => Object.keys(copy));
attempt("-0", () => [copy.zero, Object.is(copy.zero, -0), 1 / copy.zero]);
attempt("NaN", () => [copy.odd, typeof copy.odd, oddPlusOne(copy), copy.odd === null]);
attempt("Infinity", () => [copy.huge, copy.huge + 1]);
attempt("the smallest and a large number", () => [copy.small, copy.whole, copy.whole === source.whole]);
attempt("undefined and null", () => ["missing" in copy, copy.missing, copy.none]);
attempt("the date", () => [typeof copy.when, String(copy.when)]);
attempt("the year of the date", () => year(copy));
attempt("the set", () => [typeof copy.tags, Object.keys(copy.tags)]);
attempt("a question to the set", () => hasTag(copy));
attempt("a question to the map", () => byName(copy));
attempt("the bytes", () => [Object.keys(copy.bytes), copy.bytes.length, sumBytes(copy), copy.bytes[0]]);
attempt("the hole", () => [1 in copy.holes, copy.holes, copy.holes[1] + 1]);
attempt("the pattern", () => [typeof copy.pattern, Object.keys(copy.pattern)]);
attempt("a test with the pattern", () => copy.pattern.test("x"));
attempt("the text", () => [copy.text === source.text, copy.text.length]);
attempt("what is nested", () => JSON.stringify(copy.nested));
attempt("its method", () => copy.double());
attempt("a bigint stops it", () => JSON.stringify({ big: 1n }));
attempt("a cycle stops it", () => {
  const cycle: { self?: unknown } = {};
  cycle.self = cycle;
  return JSON.stringify(cycle);
});
attempt("toJSON decides", () => {
  class Money {
    cents = 150;
    toJSON(): string {
      return "1.50";
    }
  }
  const back: Money = JSON.parse(JSON.stringify(new Money()));
  return [typeof back, back.cents];
});
attempt("a reviver rebuilds the instance", () => {
  const rebuilt: Reading = JSON.parse(JSON.stringify({ whole: 4 }), (key, value) => (key === "" ? Object.assign(new Reading(), value) : value));
  return [rebuilt.double(), rebuilt instanceof Reading, year(rebuilt)];
});
attempt("__proto__ in the text is an own member", () => {
  const parsed: Reading = JSON.parse('{ "__proto__": { "whole": 7 }, "zero": 1 }');
  return [parsed.whole, parsed.zero, Object.keys(parsed), Object.getPrototypeOf(parsed) === Object.prototype];
});
