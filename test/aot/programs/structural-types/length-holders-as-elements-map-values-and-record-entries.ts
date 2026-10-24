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

function total(items: HasLength[]): number {
  let sum = 0;
  for (let i = 0; i < items.length; i++) sum += items[i].length;
  return sum;
}

function totalByForOf(items: HasLength[]): number {
  let sum = 0;
  for (const item of items) sum += item.length;
  return sum;
}

function kinds(items: HasLength[]): string {
  return items.map(item => typeof item).join();
}

function totalOfMap(items: Map<string, HasLength>): number {
  let sum = 0;
  for (const item of items.values()) sum += item.length;
  return sum;
}

function lookUp(items: Map<string, HasLength>, key: string): number {
  const found = items.get(key);
  return found === undefined ? -1 : found.length;
}

function totalOfSet(items: Set<HasLength>): number {
  let sum = 0;
  items.forEach(item => {
    sum += item.length;
  });
  return sum;
}

function totalOfRecord(items: Record<string, HasLength>): number {
  let sum = 0;
  for (const key in items) sum += items[key].length;
  return sum;
}

function secondOfPair(pair: [number, HasLength]): number {
  return pair[0] + pair[1].length;
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest: HasLength[] = [{ length: i }, { length: 1 }];
  warm += total(honest) + totalByForOf(honest) + kinds(honest).length + secondOfPair([i, { length: i }]);
  warm += totalOfMap(new Map([["a", { length: i }]])) + totalOfSet(new Set([{ length: i }])) + totalOfRecord({ a: { length: i } });
}
console.log("after 2000 honest containers", warm);

const mixed: HasLength[] = [{ length: 1 }, "ab", [1, 2, 3], total, new Uint8Array(5), "", { length: 6 }];
attempt("total of mixed elements", () => total(mixed));
attempt("total by for-of", () => totalByForOf(mixed));
attempt("kinds", () => kinds(mixed));
attempt("only strings", () => [total(["a", "bc", "def"]), kinds(["a", "bc", "def"])]);
attempt("a string pushed after literals", () => {
  const items: HasLength[] = [];
  for (let i = 0; i < 100; i++) items.push({ length: 1 });
  items.push("four");
  items[50] = "fifty";
  return [total(items), typeof items[50], typeof items[100], items.indexOf("four"), items.includes("fifty")];
});
attempt("sorted by length", () => [...mixed].sort((a, b) => a.length - b.length).map(item => typeof item + item.length));
attempt("found", () => mixed.find(item => item.length === 2));
attempt("filtered", () => mixed.filter(item => item.length > 2).map(item => typeof item));
attempt("reduced", () => mixed.reduce((sum, item) => sum + item.length, 0));

const byName = new Map<string, HasLength>([
  ["literal", { length: 1 }],
  ["string", "ab"],
  ["array", [1, 2, 3]],
  ["function", lookUp],
]);
attempt("total of map values", () => totalOfMap(byName));
for (const key of ["literal", "string", "array", "function", "missing"]) attempt("map value " + key, () => lookUp(byName, key));
attempt("set", () => totalOfSet(new Set<HasLength>(["ab", "ab", "a" + "b", { length: 10 }, [1]])));
attempt("record", () => totalOfRecord({ a: "xyz", b: { length: 10 }, c: [] }));
attempt("pair with a string", () => secondOfPair([1, "ab"]));
attempt("pair with a function", () => secondOfPair([1, secondOfPair]));
attempt("honest again", () => [total([{ length: 4 }]), totalOfMap(new Map([["a", { length: 5 }]])), secondOfPair([1, { length: 6 }])]);
