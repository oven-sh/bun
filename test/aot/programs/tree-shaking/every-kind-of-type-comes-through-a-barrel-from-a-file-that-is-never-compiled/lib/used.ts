import type { Shape } from "./types";

console.log("used.ts is evaluated");
export function used(shape: Shape): number {
  return shape.size * 10;
}
