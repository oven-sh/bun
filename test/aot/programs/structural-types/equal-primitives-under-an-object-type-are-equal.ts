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

function same(a: HasLength, b: HasLength): boolean {
  return a === b;
}

function different(a: HasLength, b: HasLength): boolean {
  return a !== b;
}

function looselySame(a: HasLength, b: HasLength): boolean {
  return a == b;
}

function sameAnything(a: {}, b: {}): boolean {
  return a === b;
}

function looselySameAnything(a: {}, b: {}): boolean {
  return a == b;
}

function sameValue(a: {}, b: {}): boolean {
  return Object.is(a, b);
}

function whichCase(value: {}, first: {}, second: {}): string {
  switch (value) {
    case first:
      return "first";
    case second:
      return "second";
    default:
      return "neither";
  }
}

function glue(a: string, b: string): string {
  return a + b;
}

let warm = 0;
const one = { length: 1 };
for (let i = 0; i < 2000; i++) {
  const other = { length: 1 };
  warm += (same(one, one) ? 1 : 0) + (same(one, other) ? 1 : 0) + (different(one, other) ? 1 : 0) + (looselySame(one, other) ? 1 : 0);
  warm += (sameAnything(one, other) ? 1 : 0) + (looselySameAnything(one, one) ? 1 : 0) + (sameValue(one, other) ? 1 : 0) + whichCase(one, other, one).length;
}
console.log("after 2000 pairs of objects", warm);

const half = 0.5;
const pairs: [string, {}, {}][] = [
  ["two literals", { a: 1 }, { a: 1 }],
  ["a string and the same text glued", "hello", glue("hel", "lo")],
  ["two glued strings", glue("a", "bc"), glue("ab", "c")],
  ["a long glued string", "x".repeat(40), glue("x".repeat(20), "x".repeat(20))],
  ["empty strings", "", glue("", "")],
  ["a string and a String object", "ab", new String("ab")],
  ["two String objects", new String("ab"), new String("ab")],
  ["1 and 0.5 + 0.5", 1, half + half],
  ["0 and -0", 0, -0],
  ["NaN and NaN", NaN, NaN],
  ["NaN and 0 / 0", NaN, (half - half) / (half - half)],
  ["2 ** 31 twice", 2 ** 31, 2147483647 + 1],
  ["1 and true", 1, true],
  ["1 and the text 1", 1, "1"],
  ["0 and an empty string", 0, ""],
  ["two equal bigints", 2n ** 70n, 2n ** 69n * 2n],
  ["two small bigints", 5n, 2n + 3n],
  ["a bigint and a number", 5n, 5],
  ["two symbols of one description", Symbol("s"), Symbol("s")],
  ["a registered symbol twice", Symbol.for("s"), Symbol.for("s")],
  ["true and true", true, !false],
  ["an array and its text", [1, 2], "1,2"],
];
for (const [name, a, b] of pairs) {
  attempt(name + ": ===", () => sameAnything(a, b));
  attempt(name + ": ==", () => looselySameAnything(a, b));
  attempt(name + ": Object.is", () => sameValue(a, b));
  attempt(name + ": switch", () => whichCase(a, {}, b));
}

attempt("strings as length holders", () => [same("ab", glue("a", "b")), different("ab", glue("a", "b")), looselySame("ab", glue("a", "b")), same("ab", "ba")]);
attempt("a string and a String object as length holders", () => [same("ab", new String("ab")), looselySame("ab", new String("ab"))]);
attempt("an array and a string as length holders", () => [same(["a"], "a"), looselySame(["a"], "a")]);

const items: {}[] = [glue("a", "b"), half + half, NaN, -0, 2n ** 70n, one];
attempt("indexOf", () => [items.indexOf("ab"), items.indexOf(1), items.indexOf(NaN), items.indexOf(0), items.indexOf(2n ** 70n), items.indexOf(one), items.indexOf({ length: 1 })]);
attempt("includes", () => [items.includes("ab"), items.includes(1), items.includes(NaN), items.includes(0), items.includes(2n ** 70n), items.includes({ length: 1 })]);
attempt("keys of a map", () => {
  const map = new Map<{}, string>(items.map((item, index) => [item, "at " + index]));
  return [map.get("ab"), map.get(1), map.get(NaN), map.get(0), map.get(2n ** 70n), map.get(one), map.get({ length: 1 }), map.size];
});
attempt("members of a set", () => {
  const set = new Set<{}>([...items, "ab", 1, NaN, 0, 2n ** 70n, one, { length: 1 }]);
  return set.size;
});
