// int32 is a promise that the build proves. An object whose `x` is a number is assignable to Point for TypeScript, so once one is taken for a Point
// the build no longer knows that the `x` of a Point is an int32, and says so where the program relies on it.
import type { int32 } from "bun";
interface Point {
  x: int32;
  y: int32;
}
function xOf(point: Point): int32 {
  return point.x;
}
function assigned(n: number): Point {
  return Object.assign({ x: 1, y: 2 }, { x: n });
}
function widened(n: number): Point {
  const wide = { x: n, y: 2 };
  return wide;
}
console.log(xOf(assigned(1.5)), xOf(widened(2.5)));
