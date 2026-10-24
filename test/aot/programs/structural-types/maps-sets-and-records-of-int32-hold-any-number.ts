import type { int32 } from "bun";

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return "{" + Object.entries(value).map(([key, held]) => key + ": " + show(held)).join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

class Cell {
  held: int32 = 0;
  next: int32 = 7;
}

function uses(v: int32): unknown[] {
  const cell = new Cell();
  cell.held = v;
  const pair: int32[] = [v, 1];
  return [typeof v, v, v + 1, v - 1, v * 2, v / 2, v % 2, -v, 1 / v, v | 0, v >>> 0, v >> 1, v << 1, ~v, v & 3, v === v, v === 0, v < 1, v >= 1, !v, String(v), cell.held, cell.next, pair[0], cell.held + pair[0], Math.abs(v), Math.floor(v), [10, 20, 30][v]];
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += uses(i | 0).length + uses(-i | 0).length;
console.log("4000 honest uses", warm);

const odd: number[] = JSON.parse("[1.5, -0, 2147483648, -2147483649, 1e21, 3]");
odd.push(NaN, Infinity);

function fromMap(map: Map<string, int32>, key: string): int32 {
  return map.get(key) ?? -1;
}
function sumOfMap(map: Map<string, int32>): int32 {
  let sum: int32 = 0;
  for (const v of map.values()) sum = (sum + v) | 0;
  return sum;
}
function firstOfSet(set: Set<int32>): int32 {
  for (const v of set) return v;
  return -1;
}
function fromRecord(record: Record<string, int32>, key: string): int32 {
  return record[key];
}
function keyOfMap(map: Map<int32, string>): int32 {
  for (const key of map.keys()) return key;
  return -1;
}

for (const n of odd) {
  const label = show(n);
  attempt(label + " a map of numbers under another name", () => {
    const map: Map<string, int32> = new Map<string, number>([["a", n]]);
    return [uses(fromMap(map, "a")), sumOfMap(map)];
  });
  attempt(label + " set into a map", () => {
    const map = new Map<string, int32>();
    map.set("a", n);
    return uses(fromMap(map, "a"));
  });
  attempt(label + " added to a set", () => {
    const set = new Set<int32>();
    set.add(n);
    return [uses(firstOfSet(set)), set.has(0), set.has(n)];
  });
  attempt(label + " the key of a map", () => {
    const map = new Map<int32, string>([[n, "a"]]);
    return [uses(keyOfMap(map)), map.get(0), map.get(n)];
  });
  attempt(label + " stored in a record", () => {
    const record: Record<string, int32> = {};
    record.a = n;
    return uses(fromRecord(record, "a"));
  });
}
attempt("a key that is not in the record", () => uses(fromRecord({ a: 1 }, "b")));
attempt("a key that every object inherits", () => {
  const v: int32 = fromRecord({ a: 1 }, "constructor");
  const held: unknown = v;
  return [typeof v, held === Object];
});
attempt("honest again", () => [fromMap(new Map([["a", 1]]), "a"), fromRecord({ a: 2 }, "a"), firstOfSet(new Set([3]))]);
