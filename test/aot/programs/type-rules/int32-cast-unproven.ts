// `value as int32` promises an `int32`, as an annotation does, and converts nothing: the build stops at a cast of a value that it cannot prove to be one. A cast proves nothing either: what it is stored into is reported too. `| 0` converts, in plain Bun as well, and is what the messages ask for. typed-objects/int32-proven-stores has the casts that the build accepts.
import type { int32 } from "bun";

type Lane = int32;
interface Update { lane: Lane }
const loose: any = JSON.parse('[7.9, "12"]');
const numbers: number[] = JSON.parse("[7.9, 5]");
function cast(n: number): number { return n as int32; }
function sum(a: int32, b: int32): number { return (a + b) as int32; }
function update(lane: unknown): Update { return { lane: lane as Lane }; }
function truthy(level: number): string { return (level as int32) ? "yes" : "no"; }
const list: unknown[] = [loose[0] as int32, 1.5 as int32, (numbers[0] as int32) as number];
let count: number = numbers[1];
(count as int32) += 1;
console.log(cast(numbers[0]), sum(1, 2), update(loose[1]).lane, truthy(0.5), list.join(" "), count);
