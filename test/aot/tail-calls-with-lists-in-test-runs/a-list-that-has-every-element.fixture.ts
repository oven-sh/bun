import { expect, test } from "bun:test";
let last: unknown[] = [];
function step(n: number, middle: number, acc: number): number {
  if (n === 0) return acc + middle;
  const list: [number, number, number] = [n - 1, 3, acc + 1];
  last = list;
  return step.apply(null, list);
}
test("a list that has every element, a million deep", () => {
  expect(step(1000000, 3, 0)).toBe(1000003);
  console.log(last.length);
});
