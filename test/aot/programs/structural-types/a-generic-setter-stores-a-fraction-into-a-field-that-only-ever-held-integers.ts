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

class Counter {
  count = 0;
  step = 1;
  limit = 100;
  next(): number {
    return this.count + this.step;
  }
  left(): number {
    return this.limit - this.count;
  }
  slot(): number {
    return this.count % 8;
  }
  bits(): number {
    return this.count | this.step;
  }
}

function set<T, K extends keyof T>(target: T, key: K, value: T[K]): void {
  target[key] = value;
}

function add<K extends string>(target: Record<K, number>, key: K, amount: number): void {
  target[key] += amount;
}

function report(title: string, c: Counter): void {
  console.log(title + ": " + show(c.count) + " " + show(c.step) + " " + show(c.limit) + " " + JSON.stringify(c));
  attempt("  next", () => c.next());
  attempt("  left", () => c.left());
  attempt("  slot", () => c.slot());
  attempt("  bits", () => c.bits());
  attempt("  count / 2", () => c.count / 2);
  attempt("  1 / count", () => 1 / c.count);
  attempt("  count === (count | 0)", () => c.count === (c.count | 0));
}

const c = new Counter();
let total = 0;
for (let i = 0; i < 2000; i++) {
  set(c, "count", i);
  set(c, "step", (i % 3) + 1);
  add(c, "limit", 1);
  total += c.next() + c.left() + c.slot() + c.bits();
}
console.log("2000 rounds with integers: " + total);
report("integers", c);

const values = [0.5, -0.5, 2 ** 31, 2 ** 31 - 1, -(2 ** 31), -(2 ** 31) - 1, 2 ** 32, 2 ** 53, -0, NaN, Infinity, -Infinity, 1e300, 5e-324, 1.0000000000000002];
for (const value of values) {
  set(c, "count", value);
  report("count = " + show(value), c);
}

set(c, "count", 2147483647);
add(c, "count", 1);
report("one more than the largest 32-bit integer", c);
set(c, "count", -2147483648);
add(c, "count", -1);
report("one less than the smallest", c);
set(c, "count", 1);
add(c, "count", 0.1);
report("a tenth is added", c);
set(c, "count", 0);
set(c, "step", -0);
report("a step of minus zero", c);
const parsed: number = JSON.parse("2.75");
set(c, "count", parsed);
report("a parsed fraction", c);
set(c, "count", 5);
set(c, "step", 1);
report("integers again", c);

export {};
