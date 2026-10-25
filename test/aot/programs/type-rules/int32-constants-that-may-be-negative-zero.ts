// A constant is an `int32` by its declaration only if it is written `0`. `-0`, a constant whose type is written, and a variable that can change are not.
import type { int32 } from "bun";

const negative = -0;
const written: 0 = -0;
let changes = 0;
function take(n: int32): number {
  return 1 / n;
}
function readsNegative() {
  return take(negative);
}
function readsWritten() {
  return take(written);
}
function readsChanging() {
  return take(changes);
}
changes = -0;

console.log(readsNegative(), readsWritten(), readsChanging());
