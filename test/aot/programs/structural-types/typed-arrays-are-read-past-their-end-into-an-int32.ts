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

function fromInt32(list: Int32Array, index: int32): int32 {
  return list[index];
}
function fromInt16(list: Int16Array, index: int32): int32 {
  return list[index];
}
function fromInt8(list: Int8Array, index: int32): int32 {
  return list[index];
}
function fromUint8(list: Uint8Array, index: int32): int32 {
  return list[index];
}
function fromUint16(list: Uint16Array, index: int32): int32 {
  return list[index];
}
function fromClamped(list: Uint8ClampedArray, index: int32): int32 {
  return list[index];
}
function sum(list: Int32Array, count: int32): int32 {
  let total: int32 = 0;
  for (let i: int32 = 0; i < count; i++) total = (total + list[i]) | 0;
  return total;
}
function plainSum(list: Int32Array, count: int32): number {
  let total = 0;
  for (let i: int32 = 0; i < count; i++) total += list[i];
  return total;
}

const ints = new Int32Array([1, -2, 2147483647]);
let rounds = 0;
for (let i = 0; i < 2000; i++) rounds += fromInt32(ints, (i % 3) | 0) + sum(ints, 2);
console.log("2000 honest rounds", rounds);

const places: int32[] = [3, -1, 1000, 2147483647, -2147483648];
for (const index of places) {
  attempt("Int32Array at " + index, () => uses(fromInt32(ints, index)));
  attempt("Int16Array at " + index, () => uses(fromInt16(new Int16Array(3), index)));
  attempt("Int8Array at " + index, () => uses(fromInt8(new Int8Array(3), index)));
  attempt("Uint8Array at " + index, () => uses(fromUint8(new Uint8Array(3), index)));
  attempt("Uint16Array at " + index, () => uses(fromUint16(new Uint16Array(3), index)));
  attempt("Uint8ClampedArray at " + index, () => uses(fromClamped(new Uint8ClampedArray(3), index)));
}
attempt("summed past the end", () => [sum(ints, 5), plainSum(ints, 5)]);
attempt("of an empty array", () => uses(fromInt32(new Int32Array(0), 0)));
attempt("after the buffer was handed over", () => {
  const list = new Int32Array([5, 6]);
  const moved = list.buffer.transfer();
  return [moved.byteLength, list.length, uses(fromInt32(list, 0))];
});
attempt("after the buffer shrank", () => {
  const buffer = new ArrayBuffer(8, { maxByteLength: 16 });
  const list = new Int32Array(buffer);
  list[1] = 9;
  const before = fromInt32(list, 1);
  buffer.resize(4);
  return [before, list.length, uses(fromInt32(list, 1))];
});
attempt("a Buffer", () => uses(fromUint8(Buffer.from([1, 2]), 2)));
attempt("honest again", () => [fromInt32(ints, 2), sum(ints, 3)]);
