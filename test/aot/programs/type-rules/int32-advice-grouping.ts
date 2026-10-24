// What the message says to write keeps the grouping of the operand it is built from: `kept - (a + b)`, not `kept - a + b`.
import type { int32 } from "bun";

const given: number[] = JSON.parse("[3, 1.5]");
const a: number = given[0];
const b: number = given[1];
let kept: int32 = 0;
kept -= a + b;
console.log(kept);
