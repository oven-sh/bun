// A constant that is not an int32 cannot be stored into one: a fraction, a number out of range, -0, NaN.
import type { int32 } from "bun";

const LIMIT = 2147483647;
class Cursor {
  line: int32 = 0.5;
  constructor(public start: int32 = 1e10) {}
}
function take(n: int32): int32 { return n; }
function none(): int32 { return NaN; }
const over: int32 = LIMIT + 1;
const under: int32 = -2147483649;
const zero: int32 = -0;
const point: { x: int32 } = { x: 2 ** 31 };
console.log(new Cursor(), take(4294967296), none(), over, under, zero, point);
