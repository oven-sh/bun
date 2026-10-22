import { Point } from "shapes-v2";

export function make(x: number, y: number): Point {
  return new Point(x, y);
}

export function normOf(p: Point): number {
  return p.norm();
}

export function labelOf(p: Point): string {
  return p.label + "!";
}
