function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    if (list.length > 40) return "array of " + list.length + " with keys " + Object.keys(list).join();
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  for (const [key, member] of Object.entries(value)) parts.push(key + ": " + show(member));
  return "{" + parts.join(", ") + "}";
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

type Entry = [number, string];

function first(entry: Entry): number {
  return entry[0] + 1;
}

function second(entry: Entry): string {
  return entry[1].toUpperCase();
}

function both(entry: Entry): string {
  const [count, name] = entry;
  return count * 2 + " " + name.length;
}

function report(title: string, entry: Entry): void {
  console.log(title + ": " + show(entry) + " " + typeof entry[0] + " " + typeof entry[1]);
  attempt("  first + 1", () => first(entry));
  attempt("  second, upper case", () => second(entry));
  attempt("  both", () => both(entry));
  attempt("  [0].toFixed(1)", () => entry[0].toFixed(1));
  attempt("  [1].length", () => entry[1].length);
}

let total = 0;
for (let i = 0; i < 2000; i++) {
  const entry: Entry = [i, "n"];
  total += first(entry) + second(entry).length + both(entry).length;
}
console.log("2000 honest rounds: " + total);

const reversed: Entry = [1, "a"];
console.log("reverse returns the same list: " + Object.is(reversed.reverse(), reversed));
report("reversed", reversed);
reversed.reverse();
report("reversed back", reversed);

const sorted: Entry = [10, "1"];
sorted.sort();
report("sorted as texts: '1' comes before 10", sorted);

const stays: Entry = [1, "10"];
stays.sort();
report("sorted as texts: nothing moves", stays);

const compared: Entry = [5, "a"];
compared.sort((a, b) => (typeof a === "string" ? -1 : typeof b === "string" ? 1 : 0));
report("sorted with strings first", compared);

const copied: Entry = [1, "a"];
const other = copied.toReversed();
report("toReversed leaves it alone", copied);
console.log("what toReversed gives: " + show(other));

function flip(entry: Entry): Entry {
  entry.reverse();
  return entry;
}
report("reversed inside a function that returns it", flip([7, "g"]));

const fractions: [number, number] = [1, 0.5];
fractions.reverse();
console.log("an integer and a fraction change places: " + show(fractions) + " " + (fractions[0] + fractions[1]) + " " + (fractions[0] | 0) + " " + (fractions[1] | 0));

export {};
