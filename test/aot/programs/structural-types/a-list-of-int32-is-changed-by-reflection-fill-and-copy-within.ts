import type { int32 } from "bun";

const list: int32[] = [1, 2, 3];
function sum(values: int32[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}
function at(index: int32): int32 {
  return list[index];
}
console.log(sum(list), at(1));
Reflect.set(list, 1, 2.5);
console.log(sum(list), at(1), at(1) | 0, at(1) + 1);
Object.defineProperty(list, 0, { value: "one", writable: true, enumerable: true, configurable: true });
console.log(sum(list), at(0), typeof at(0));
Reflect.deleteProperty(list, 2);
console.log(sum(list), at(2), at(2) === undefined, 2 in list);
Reflect.set(list, "length", 5);
console.log(list.length, sum(list), at(4));
list.fill(0.5, 3);
console.log(sum(list.slice(3)), at(3), at(4));
list.copyWithin(0, 3);
console.log(at(0), at(1), list.join());
