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
type Letters = { [Symbol.iterator](): Iterator<string> };
type Indexed = { length: number; [index: number]: string };

function namesIn(item: HasLength): string[] {
  const names: string[] = [];
  for (const name in item) names.push(name);
  return names;
}

function each(letters: Letters): string[] {
  const seen: string[] = [];
  for (const letter of letters) seen.push(letter);
  return seen;
}

function spreadOut(letters: Letters): string[] {
  return [...letters];
}

function firstTwo(letters: Letters): (string | undefined)[] {
  const [first, second] = letters;
  return [first, second];
}

function byHand(letters: Letters): string[] {
  const seen: string[] = [];
  const iterator = letters[Symbol.iterator]();
  for (let step = iterator.next(); !step.done; step = iterator.next()) seen.push(step.value);
  return seen;
}

function* passOn(letters: Letters): Generator<string> {
  yield* letters;
}

function byIndex(items: Indexed): string {
  let text = "";
  for (let i = 0; i < items.length; i++) text += "[" + items[i] + "]";
  return text;
}

function pastTheEnd(items: Indexed): string {
  return typeof items[items.length] + " " + typeof items[-1];
}

function* abc(): Generator<string> {
  yield "a";
  yield "b";
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  warm += namesIn({ length: i }).length + each(["x", "y"]).length + spreadOut(["x"]).length + firstTwo(["x", "y"]).length;
  warm += byHand(["x"]).length + [...passOn(["x"])].length + byIndex(["x", "y"]).length + pastTheEnd(["x"]).length;
}
console.log("after 2000 honest calls", warm);

const holders: [string, HasLength][] = [
  ["literal", { length: 1 }],
  ["string", "abc"],
  ["empty string", ""],
  ["array", [1, 2]],
  ["function", namesIn],
  ["typed array", new Uint8Array(2)],
  ["String object", new String("ab")],
];
for (const [name, item] of holders) attempt("for-in over a " + name, () => namesIn(item));

const letters: [string, () => Letters][] = [
  ["array", () => ["a", "b", "c"]],
  ["string", () => "abc"],
  ["empty string", () => ""],
  ["one letter", () => "z"],
  ["string with a pair of surrogates", () => "a\u{1F600}b"],
  ["string with half a pair", () => "a\uD83Db"],
  ["set", () => new Set(["a", "b", "a"])],
  ["generator", abc],
  ["keys of a map", () => new Map([["k", 1]]).keys()],
  ["String object", () => new String("ab")],
];
for (const [name, make] of letters) {
  attempt("for-of over a " + name, () => each(make()));
  attempt("spread of a " + name, () => spreadOut(make()));
  attempt("first two of a " + name, () => firstTwo(make()));
  attempt("by hand over a " + name, () => byHand(make()));
  attempt("yield* of a " + name, () => [...passOn(make())]);
}

const indexed: [string, Indexed][] = [
  ["array", ["a", "b"]],
  ["string", "ab"],
  ["empty string", ""],
  ["string with a pair of surrogates", "\u{1F600}"],
  ["literal", { 0: "a", 1: "b", length: 2 }],
  ["literal with a missing index", { 0: "a", length: 2 }],
  ["String object", new String("ab")],
];
for (const [name, items] of indexed) {
  attempt("by index over a " + name, () => byIndex(items));
  attempt("past the end of a " + name, () => pastTheEnd(items));
}
