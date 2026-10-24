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

interface Item {
  count: number;
  price: number;
  name: string;
}

function update<T, K extends keyof T>(target: T, key: K, change: (old: T[K]) => T[K]): void {
  target[key] = change(target[key]);
}

function mapValues<T>(target: T, keys: (keyof T)[], change: (old: T[keyof T]) => T[keyof T]): void {
  for (const key of keys) target[key] = change(target[key]);
}

const all: (keyof Item)[] = ["name", "price", "count"];

function cost(item: Item): number {
  return item.count * item.price;
}

function report(title: string, item: Item): void {
  console.log(title + ": " + typeof item.count + " " + show(item.count) + ", " + typeof item.price + " " + show(item.price) + ", " + typeof item.name + " " + show(item.name) + ", " + JSON.stringify(item));
  attempt("  cost", () => cost(item));
  attempt("  count + 1", () => item.count + 1);
  attempt("  name.toUpperCase()", () => item.name.toUpperCase());
}

const yes: boolean = process.argv.length > 0;
const turn = (old: number | string): number | string => (typeof old === "number" ? "was " + old : old.length);

const item: Item = { count: 2, price: 1.5, name: "nut" };
let total = 0;
for (let i = 0; i < 2000; i++) {
  update(item, "count", old => old + 1);
  update(item, "price", old => old + 0.25);
  update(item, "name", old => (old.length > 5 ? "n" : old + "t"));
  total += cost(item) + item.name.length;
}
console.log("2000 honest rounds: " + total);
report("honest", item);

update(item, yes ? "count" : "name", turn);
report("the count is turned into a string", item);
update(item, yes ? "name" : "count", turn);
report("the name is turned into a number", item);
update(item, yes ? "count" : "name", turn);
update(item, yes ? "name" : "count", turn);
report("both are turned back: other values", item);

const second: Item = { count: 2, price: 1.5, name: "nut" };
mapValues(second, all, turn);
report("every member is turned", second);
mapValues(second, all, turn);
report("and again", second);
mapValues(second, all, old => old);
report("every member is stored as it is", second);
mapValues(second, all, () => 0);
report("every member is zero", second);
mapValues(second, all, () => "");
report("every member is empty", second);

export {};
