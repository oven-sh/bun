// The build has to see every call of a function that has an `int32` parameter, so such a function cannot be used as a value.
import type { int32 } from "bun";

function half(n: int32): number { return n / 2; }
const twice = (n: int32): number => n * 2;
class Cursor {
  constructor(public line: int32) {}
}
const table = { half };
const other = twice;
const made = Cursor;
const bound = half.bind(null);
const boundToFraction = half.bind(null, [1.5][0]);
const mapped = [1, 2].map(half);
const inline = [1, 2].map((n: int32) => n + 1);
const methods = { third(n: int32): number { return n / 3; } };
let replaced = (n: int32): number => n;
console.log(table, other, made, bound, boundToFraction, mapped, inline, methods, replaced, half.call(null, 1), half(2), twice(2), new Cursor(1) instanceof Cursor);
