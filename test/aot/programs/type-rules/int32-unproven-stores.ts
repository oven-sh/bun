// A value stored into an `int32` that is not one by proof stops the build, and the message says what was found and what to write. type-rules/int32-checked-at-run-time has the flows that the build does not see.
import type { int32 } from "bun";

const given: number[] = JSON.parse("[3, 1.5]");
const loose: any = JSON.parse("4");
const list = [1, 2];
const text = "text";

class Cursor {
  line: int32 = 0;
  column: int32 = given[0];
  constructor(public start: int32 = given[1]) {}
  move(by: int32): int32 {
    this.line += by;
    return this.line + by;
  }
}
interface Point {
  x: int32;
  y?: int32;
}

function add(a: int32, b: int32): int32 { return a + b; }
function subtract(a: int32, b: int32): int32 { return a - b; }
function times(a: int32, b: int32): int32 { return a * b; }
function half(a: int32): int32 { return a / 2; }
function negative(a: int32): int32 { return -a; }
function rest(a: int32, b: int32): int32 { return a % b; }
function power(a: int32): int32 { return a ** 2; }
function unsigned(a: int32): int32 { return a >>> 0; }
function code(i: int32): int32 { return text.charCodeAt(i); }
function size(): int32 { return list.length; }
function floor(n: number): int32 { return Math.floor(n); }
function plain(n: number): int32 { return n; }
function inclusive(to: int32): int32 { let last: int32 = 0; for (let i: int32 = 0; i <= to; i++) last = i; return last; }
function byTwo(to: int32): int32 { let last: int32 = 0; for (let i: int32 = 0; i < to; i += 2) last = i; return last; }
function counted(to: int32): int32 { let turns: int32 = 0; for (let i: int32 = 0; i < to; i++) turns++; return turns; }
function testedAfter(to: int32): int32 { let i: int32 = 0; do i++; while (i < to); return i; }
function reassigned(to: int32, jump: int32): int32 { let last: int32 = 0; for (let i: int32 = 0; i < to; i++) { if (i === 2) i = jump; last = i; } return last; }

let kept: int32 = given[0];
kept = loose;
kept = given[1] + 1;
kept += 1;
kept -= given[0];
kept *= 3;
kept /= 2;
kept >>>= 0;
kept--;
[kept] = given;
({ kept } = { kept: 1 });
for (kept of given) {}
const cursor = new Cursor(given[0]);
cursor.line = given[0];
cursor["column"] = given[1];
cursor.line++;
cursor.move(given[1]);
add(1, given[0]);
add(...(given as [number, number]));
const point: Point = { x: given[0], y: loose };
console.log(kept, cursor, point, subtract(1, 2), times(1, 2), half(1), negative(1), rest(1, 2), power(1), unsigned(1), code(1), size(), floor(1), plain(1), inclusive(1), byTwo(1), counted(1), testedAfter(1), reassigned(1, 2));
