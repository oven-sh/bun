// A variable that can change is no `int32` by what it is given first. A constant that is written `-0` has the type `0` for TypeScript, with or without the type written: narrowing/negative-zero-under-the-literal-type-zero-goes-into-an-int32 runs those.
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
