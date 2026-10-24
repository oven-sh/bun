import type { int32 } from "bun";

const list: int32[] = [1, 2, 3];
const wide: number[] = list;

function sum(values: int32[]): int32 {
  let total: int32 = 0;
  for (const value of values) total = (total + value) | 0;
  return total;
}
function plainSum(values: int32[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}
function last(values: int32[]): int32 {
  return values[values.length - 1];
}

console.log(sum(list), plainSum(list), last(list));
wide.push(0.5);
console.log(sum(list), plainSum(list), last(list), last(list) + 1, last(list) | 0);
wide.push(2 ** 31);
console.log(sum(list), plainSum(list), last(list), last(list) + 1, last(list) | 0);
wide.push(-0);
console.log(sum(list), plainSum(list), Object.is(last(list), -0), 1 / last(list));
wide.push(NaN);
console.log(sum(list), plainSum(list), last(list), last(list) === last(list));
console.log(list.join());
const half: int32 = list[3];
console.log(list.indexOf(half), list.includes(half), list.indexOf(2), list.includes(list[6]), list.indexOf(list[6]));
