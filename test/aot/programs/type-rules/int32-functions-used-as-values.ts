// A function with an `int32` parameter can be used as a value: stored, bound, passed as a callback. The build accepts that, although it does not see every call of such a value, and nothing tests the argument when the program runs. Every argument here is an int32, and `boundToFraction` is never called. type-rules/int32-checked-at-run-time has the calls with other numbers.
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
console.log(table.half(4), other(3), new made(2).line, bound(6), methods.third(9), replaced(5), half.apply(null, [8]));
