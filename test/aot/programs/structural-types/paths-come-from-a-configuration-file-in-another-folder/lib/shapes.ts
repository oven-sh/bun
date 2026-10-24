export interface Point {
  x: number;
  y: number;
}

export function sum(p: Point): number {
  return p.x + p.y;
}
