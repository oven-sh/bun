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

function countWords(words: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const word of words) counts[word] = (counts[word] || 0) + 1;
  return counts;
}

function lookUp(table: Record<string, number>, key: string): number {
  return table[key];
}

function plusOne(table: Record<string, number>, key: string): number {
  return table[key] + 1;
}

function has(table: Record<string, number>, key: string): boolean {
  return table[key] !== undefined;
}

function widthOf(table: Record<string, string>, key: string): number {
  return table[key].length;
}

function run(table: Record<string, () => number>, key: string): number {
  return table[key]();
}

let total = 0;
const warm: Record<string, number> = { a: 1, b: 2 };
for (let i = 0; i < 2000; i++) total += lookUp(warm, i % 2 === 0 ? "a" : "b") + plusOne(warm, "a") + (has(warm, "b") ? 1 : 0);
console.log("2000 honest rounds: " + total);

const table: Record<string, number> = { a: 1 };
const names = ["a", "missing", "constructor", "toString", "valueOf", "hasOwnProperty", "__proto__", "__defineGetter__", "isPrototypeOf", "", "0", "length"];
for (const name of names) {
  attempt("numbers[" + show(name) + "]", () => [typeof lookUp(table, name), has(table, name), name in table, Object.hasOwn(table, name)]);
  attempt("numbers[" + show(name) + "] + 1", () => typeof plusOne(table, name));
  attempt("numbers[" + show(name) + "] * 2", () => lookUp(table, name) * 2);
}
attempt("by a literal name", () => [typeof table.constructor, typeof table.toString, typeof table.missing, typeof table["__proto__"]]);
attempt("missing + 1", () => table.missing + 1);
attempt("missing.toFixed", () => table.missing.toFixed(1));

const texts: Record<string, string> = { a: "text" };
for (const name of ["a", "missing", "constructor", "toString", "__proto__"]) attempt("the width of strings[" + show(name) + "]", () => widthOf(texts, name));

const functions: Record<string, () => number> = { a: () => 1 };
for (const name of ["a", "missing", "__proto__"]) attempt("functions[" + show(name) + "]()", () => run(functions, name));
attempt("functions['valueOf']() gives the record", () => typeof run(functions, "valueOf"));
attempt("functions['toString']()", () => typeof run(functions, "toString"));
attempt("functions['constructor']()", () => typeof run(functions, "constructor"));

attempt("words are counted", () => countWords(["a", "b", "a"]));
attempt("words that every object inherits: kinds", () => Object.entries(countWords(["constructor", "a", "constructor", "valueOf"])).map(([word, count]) => word + " " + typeof count));
attempt("the word __proto__", () => {
  const counts = countWords(["__proto__", "__proto__"]);
  return [Object.keys(counts), typeof counts["__proto__"], Object.getPrototypeOf(counts) === Object.prototype];
});

const bare: Record<string, number> = Object.create(null);
bare.a = 1;
for (const name of ["a", "constructor", "__proto__"]) attempt("without a prototype: [" + show(name) + "]", () => [typeof lookUp(bare, name), plusOne(bare, name)]);

export {};
