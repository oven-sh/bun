import { expect, test } from "bun:test";
type Make = (n: number, acc: number) => ArrayLike<number>;
function ring(make: Make): number {
  function spin(n: number, acc: number): number { return n === 0 ? acc : Reflect.apply(spin, null, make(n - 1, acc + 1)); }
  return spin(300000, 0);
}
test("an object with a length", () => {
  expect(ring((n, acc) => ({ length: 2, 0: n, 1: acc }))).toBe(300000);
});
test("a view of numbers", () => {
  expect(ring((n, acc) => Float64Array.of(n, acc))).toBe(300000);
});
test("a list", () => {
  expect(ring((n, acc) => [n, acc])).toBe(300000);
});
