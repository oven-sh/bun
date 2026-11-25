import { expect, test } from "bun:test";
function step(n: number, hole: number | undefined, acc: number): number {
  if (n === 0) return acc + (hole === undefined ? 0 : 1000);
  const list: number[] = [n - 1];
  list[200000] = 0;
  list.length = 3;
  list[2] = acc + 1;
  return step.apply(null, list as [number, number | undefined, number]);
}
test("a sparse list, two hundred thousand deep", () => {
  expect(step(200000, undefined, 0)).toBe(200000);
});
