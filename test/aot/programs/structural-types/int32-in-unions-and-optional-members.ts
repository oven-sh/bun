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

function fromMixed(mixed: (int32 | string)[]): int32 {
  const v = mixed[0];
  return typeof v === "number" ? v : -1;
}
function fromOptional(holder: { y?: int32 }): int32 {
  return holder.y ?? -1;
}
function fromNullable(holder: { z: int32 | null }): int32 {
  return holder.z === null ? -1 : holder.z;
}
function fromEither(holder: { kind: "int"; value: int32 } | { kind: "text"; value: string }): int32 {
  return holder.kind === "int" ? holder.value : -1;
}
function truthy(holder: { t?: int32 }): int32 {
  return holder.t ? holder.t : -1;
}

let rounds = 0;
for (let i = 0; i < 2000; i++) rounds += fromMixed([i | 0, "a"]) + fromOptional({ y: i | 0 }) + fromOptional({}) + fromNullable({ z: null }) + fromEither({ kind: "int", value: i | 0 });
console.log("2000 honest rounds", rounds);

for (const n of odd) {
  const label = show(n);
  attempt(label + " beside texts in a list", () => uses(fromMixed([n, "a"])));
  attempt(label + " in a list of numbers and texts under another name", () => {
    const loose: (number | string)[] = [n];
    return uses(fromMixed(loose));
  });
  attempt(label + " in an optional member that is tested for truth", () => {
    const wide = { t: n };
    return uses(truthy(wide));
  });
  attempt(label + " in a member that may be null", () => {
    const wide = { z: n };
    return uses(fromNullable(wide));
  });
}
attempt("undefined is written out", () => {
  const holder: { y?: int32 } = { y: undefined };
  return [uses(fromOptional(holder)), "y" in holder, Object.keys(holder)];
});
attempt("the tag is stored alone", () => {
  const holder: { kind: "int"; value: int32 } | { kind: "text"; value: string } = { kind: "text", value: "seven" };
  const alias: { kind: "int" | "text" } = holder;
  alias.kind = "int";
  return uses(fromEither(holder));
});
