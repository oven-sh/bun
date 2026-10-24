import { Point } from "./point.ts";

const original = Point.prototype.norm;

export function patch(): void {
  Point.prototype.norm = function () {
    return -this.x;
  };
}

export function restore(): void {
  Point.prototype.norm = original;
}
