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

function head(list: int32[]): int32 {
  return list[0];
}
function tail(list: int32[]): int32 {
  return list[list.length - 1];
}

for (const n of odd) {
  const label = show(n);
  attempt(label + " pushed", () => {
    const list: int32[] = [1, 2];
    list.push(n);
    return [list, uses(tail(list))];
  });
  attempt(label + " stored", () => {
    const list: int32[] = [1, 2];
    list[0] = n;
    return [list, uses(head(list))];
  });
  attempt(label + " filled", () => {
    const list: int32[] = [1, 2];
    list.fill(n);
    return [list, uses(head(list))];
  });
  attempt(label + " unshifted", () => {
    const list: int32[] = [1, 2];
    list.unshift(n);
    return [list, uses(head(list))];
  });
  attempt(label + " spliced in", () => {
    const list: int32[] = [1, 2];
    list.splice(0, 1, n);
    return [list, uses(head(list))];
  });
  attempt(label + " joined on", () => {
    const list: int32[] = [1, 2];
    const longer: int32[] = list.concat(n, [n]);
    return [longer, uses(tail(longer))];
  });
  attempt(label + " replaced in a copy", () => {
    const list: int32[] = [1, 2];
    const copy: int32[] = list.with(0, n);
    return [copy, uses(head(copy))];
  });
}
attempt("after 2000 honest pushes", () => {
  const list: int32[] = [];
  for (let i = 0; i < 2000; i++) list.push(i | 0);
  list.push(odd[0]);
  let sum = 0;
  for (const v of list) sum += v;
  return [sum, uses(tail(list))];
});
