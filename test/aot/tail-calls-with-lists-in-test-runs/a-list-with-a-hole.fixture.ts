import { expect, test } from "bun:test";
let last: unknown[] = [];
function step(n: number, hole: number | undefined, acc: number): number {
  if (n === 0) return acc + (hole === undefined ? 0 : 1000);
  const list = [n - 1, , acc + 1] as [number, number | undefined, number];
  last = list;
  return step.apply(null, list);
}
test("a list with a hole, a million deep", () => {
  expect(step(1000000, undefined, 0)).toBe(1000000);
  console.log(last.length, 1 in last);
});
