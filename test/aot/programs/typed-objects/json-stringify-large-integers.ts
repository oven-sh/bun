// Above 2 ** 53 a number prints the shortest digits that identify the double, not every digit of the integer.
interface Row { id: number }
const literal = (): string => JSON.stringify({ a: 2 ** 53, b: 2 ** 53 + 2, c: 2 ** 60, d: 1234567890123456789, e: -(2 ** 60), f: -1234567890123456789 });
const field = (row: Row): string => JSON.stringify(row);
const elements = (list: number[]): string => JSON.stringify(list);
const constantElements = (): string => JSON.stringify([2 ** 53, 2 ** 53 + 2, 2 ** 60, 1234567890123456789]);
const truncated = (value: number): string => JSON.stringify({ id: Math.trunc(value) });
const values = [2 ** 31, 2 ** 53 - 1, 2 ** 53, 2 ** 53 + 2, 2 ** 60, 2 ** 62 - 512, 2 ** 62, 1234567890123456789, 1e21];
let length = 0;
for (let round = 0; round < 2000; round++) {
  for (const value of values) length += field({ id: value }).length + field({ id: -value }).length + truncated(value).length;
  length += literal().length + elements(values).length + constantElements().length;
}
console.log(length);
console.log(literal());
console.log(elements(values));
console.log(constantElements());
for (const value of values) console.log(field({ id: value }), field({ id: -value }), truncated(value), truncated(-value));
