import { Point } from "shapes-v1";

export function make(x: number, y: number): Point {
  return new Point(x, y);
}

export function normOf(p: Point): number {
  return p.norm();
}
