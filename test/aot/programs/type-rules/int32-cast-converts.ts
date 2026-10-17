// `value as int32` converts under --aot, as every `as` between primitives does: it is `value | 0`. Plain Bun leaves the value as it is, so `| 0`, which is the same in both, is what the compiler's messages ask for.
import type { int32 } from "bun";

type Lane = int32;
interface Update { lane: Lane }
const given: any = JSON.parse('[7.9, -1.5, 4294967297, null, "12", 5, -0, 1e21, true]');
const numbers: number[] = JSON.parse("[7.9, -1.5, 2147483648, 5]");
function cast(n: number): int32 { return (n as int32); }
function sum(a: int32, b: int32): int32 { return ((a + b) as int32); }
function update(lane: unknown): Update { return { lane: (lane as Lane) }; }
function truthy(n: number): string { return (n as int32) ? "yes" : "no"; }
const list: unknown[] = [];
for (let i = 0; i < 9; i++) list.push((given[i] as int32));
console.log(list.join(" "));
console.log(cast(numbers[0]), cast(numbers[1]), cast(numbers[2]), cast(numbers[3]), cast(NaN), cast(Infinity), Object.is(cast(-0), 0));
console.log(sum(2147483647, 1), sum(-2147483648, -1), sum(1, 2));
console.log(update(given[0]).lane, update(given[4]).lane, update(undefined).lane, truthy(0.5), truthy(1.5), truthy(-0.5));
console.log((numbers[0] as int32), ((numbers[0] as int32) as number), (numbers[9] as int32));
