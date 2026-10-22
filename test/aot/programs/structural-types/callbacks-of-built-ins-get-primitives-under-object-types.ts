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

function byLength(a: HasLength, b: HasLength): number {
  return a.length - b.length;
}

function lengthOf(item: HasLength): number {
  return item.length;
}

function isLong(item: HasLength): boolean {
  return item.length > 2;
}

function addLength(sum: number, item: HasLength): number {
  return sum + item.length;
}

function label(item: HasLength, index: number): string {
  return index + ":" + typeof item + ":" + item.length;
}

function literals(count: number): HasLength[] {
  const items: HasLength[] = [];
  for (let i = 0; i < count; i++) items.push({ length: (i * 7) % 5 });
  return items;
}

let warm = 0;
for (let i = 0; i < 300; i++) {
  const honest = literals(8);
  warm += honest.sort(byLength)[7].length + honest.map(lengthOf)[0] + honest.filter(isLong).length + honest.reduce(addLength, 0) + honest.map(label).length;
}
console.log("after 300 arrays of literals", warm);

const mixed = (): HasLength[] => ["hello", { length: 1 }, [1, 2, 3, 4], "", byLength, new Uint8Array(3), "ab"];
const strings = (): string[] => ["ccc", "a", "", "bb"];

attempt("sort a mix", () => mixed().sort(byLength).map(label));
attempt("sort strings", () => strings().sort(byLength));
attempt("toSorted", () => mixed().toSorted(byLength).map(lengthOf));
attempt("map a mix", () => mixed().map(lengthOf));
attempt("map strings", () => strings().map(lengthOf));
attempt("filter a mix", () => mixed().filter(isLong).map(label));
attempt("filter strings", () => strings().filter(isLong));
attempt("reduce a mix", () => mixed().reduce(addLength, 0));
attempt("reduceRight strings", () => strings().reduceRight(addLength, 0));
attempt("find", () => [mixed().find(isLong), strings().find(isLong)]);
attempt("findLast", () => [typeof mixed().findLast(isLong), strings().findLast(isLong)]);
attempt("findIndex", () => [mixed().findIndex(isLong), strings().findIndex(isLong), strings().findLastIndex(isLong)]);
attempt("some and every", () => [mixed().some(isLong), mixed().every(isLong), strings().some(isLong), ["abc", "abcd"].every(isLong)]);
attempt("flatMap", () => mixed().flatMap(item => [item.length, typeof item]));
attempt("forEach", () => {
  const seen: string[] = [];
  mixed().forEach((item, index) => seen.push(label(item, index)));
  return seen;
});
attempt("Array.from", () => [Array.from(strings(), lengthOf), Array.from("abc", lengthOf), Array.from(new Set<HasLength>(["ab", [1]]), lengthOf)]);
attempt("a map's forEach", () => {
  const seen: string[] = [];
  new Map<HasLength, HasLength>([["key", "value!"], [[1], { length: 9 }]]).forEach((value, key) => seen.push(label(key, 0) + " " + label(value, 1)));
  return seen;
});
attempt("a set's forEach", () => {
  const seen: number[] = [];
  new Set<HasLength>(["abc", { length: 1 }]).forEach(item => seen.push(lengthOf(item)));
  return seen;
});
attempt("replace", () => "a bb ccc".replace(/\w+/g, word => String(lengthOf(word))));
attempt("Object.groupBy", () => Object.keys(Object.groupBy(mixed(), item => (isLong(item) ? "long" : "short"))));
attempt("JSON.stringify with a replacer", () => JSON.stringify({ a: "xyz", b: [1, 2] }, (key, value: HasLength) => (key === "" ? value : lengthOf(value))));
attempt("literals again", () => literals(5).sort(byLength).map(lengthOf));
