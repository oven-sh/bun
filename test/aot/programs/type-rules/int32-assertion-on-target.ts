// `as int32` on a target that is only written is no flow into an `int32`: the build accepts it, nothing is tested there, and the program prints what plain Bun prints.
import type { int32 } from "bun";

const given: number[] = JSON.parse("[1.5, 2.5]");
let kept: int32 = 7;
let n: number = 0;
(n as int32) = 2;
console.log(n, kept);
(n as int32) = given[0];
kept = n | 0;
console.log(n, kept);
((n as int32) as number) = given[1];
console.log(n, kept);
