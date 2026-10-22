// What `Math.min`, `Math.max`, `Math.abs`, `Math.sign` and a rounded quotient return is an `int32` by proof where the operands limit it, and so is a counter that several cases of a `switch` advance under the test of a loop. type-rules/int32-unproven-stores has what is not.
import type { int32 } from "bun";

function least(a: int32, b: int32): int32 { return Math.min(a, b); }
function greatest(a: int32, b: int32): int32 { return Math.max(a, b, 0); }
function below(a: int32): int32 { return Math.min(a, 7) + 1; }
function size(a: int32): int32 { return Math.abs((a & 255) - 128); }
function sign(a: int32): int32 { return Math.sign(a); }
function half(a: int32): int32 { return Math.floor(a / 2); }
function third(a: int32): int32 { return Math.trunc((a & 1023) / 3); }
function thirdUp(a: int32): int32 { return Math.ceil((a & 1023) / 3); }
function quarter(a: int32): int32 { return Math.round((a & 1023) / 4); }
function negativeThird(a: int32): int32 { return Math.trunc(-((a & 1023) + 3) / 3); }
function middle(a: int32, b: int32): int32 { const sum = (a & 65535) + (b & 65535); return Math.floor(sum / 2); }
function eitherHalf(a: int32, b: int32): int32 { return Math.floor(a > 0 ? a / 2 : b / 3); }
function scaled(a: int32): int32 { return ((a & 255) - 128) * 3; }
function lastBelowHalf(to: int32): int32 { let last: int32 = -1; for (let i: int32 = 0; i < to / 2; i++) last = i; return last; }
function steps(from: int32, to: int32): int32 {
  let turns: int32 = 0;
  let i: int32 = from;
  while (i < to) {
    switch (i & 3) {
      case 0: i++; break;
      case 1: if (turns > 100) return turns;
      case 2: i++; break;
      default: i = (i + 5) | 0; break;
    }
    turns = (turns + 1) | 0;
  }
  return turns;
}

const given: number[] = JSON.parse("[-2147483648, -1025, -7, -1, 0, 1, 7, 1026, 2147483647]");
for (const n of given) {
  console.log(least(n | 0, 5), greatest(n | 0, -5), below(n | 0), size(n | 0), sign(n | 0), half(n | 0), scaled(n | 0));
  console.log(third(n | 0), thirdUp(n | 0), quarter(n | 0), negativeThird(n | 0), middle(n | 0, 9), eitherHalf(n | 0, -n | 0));
}
console.log(lastBelowHalf(7), lastBelowHalf(8), lastBelowHalf(0), lastBelowHalf(-3), steps(0, 40), steps(-9, 9), steps(5, 5), steps(2147483644, 2147483645));
