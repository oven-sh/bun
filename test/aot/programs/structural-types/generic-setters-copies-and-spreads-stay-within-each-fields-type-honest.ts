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

interface Point {
  x: number;
  y: number;
  name: string;
}

class Account {
  balance = 100;
  rate = 0.25;
  owner = "ann";
  interest(): number {
    return this.balance * this.rate;
  }
}

function set<T, K extends keyof T>(target: T, key: K, value: T[K]): void {
  target[key] = value;
}

function get<T, K extends keyof T>(target: T, key: K): T[K] {
  return target[key];
}

function copyKeys<T>(target: T, source: T, keys: (keyof T)[]): void {
  for (const key of keys) target[key] = source[key];
}

function merge<T>(full: T, change: Partial<T>): T {
  return { ...full, ...change };
}

class Store<T> {
  constructor(private state: T) {}
  set<K extends keyof T>(key: K, value: T[K]): void {
    this.state[key] = value;
  }
  get<K extends keyof T>(key: K): T[K] {
    return this.state[key];
  }
}

function length(p: Point): number {
  return Math.sqrt(p.x * p.x + p.y * p.y);
}

const p: Point = { x: 0, y: 0, name: "p" };
const account = new Account();
const store = new Store<Point>({ x: 0, y: 0, name: "s" });
let total = 0;
let width = 0;
for (let i = 0; i < 20000; i++) {
  set(p, "x", i);
  set(p, "y", i / 2);
  set(p, "name", "n" + (i % 10));
  set(account, "balance", account.balance + 1);
  set(account, "rate", (i % 8) / 8);
  store.set("x", i);
  store.set("name", "s" + (i % 10));
  copyKeys(p, { x: i + 1, y: 1.5, name: "c" }, ["x", "y"]);
  const merged = merge(p, { x: 3 });
  total += length(p) + get(p, "x") + get(p, "y") + account.interest() + store.get("x") + merged.x + merged.y;
  width += get(p, "name").length + store.get("name").length + merged.name.length;
}
console.log("total " + Math.round(total));
console.log("width " + width);
console.log(JSON.stringify(p) + " " + JSON.stringify(account) + " " + store.get("x") + " " + store.get("name"));
console.log(typeof p.x + " " + typeof p.y + " " + typeof p.name + " " + typeof account.balance + " " + typeof account.rate + " " + typeof account.owner);

export {};
