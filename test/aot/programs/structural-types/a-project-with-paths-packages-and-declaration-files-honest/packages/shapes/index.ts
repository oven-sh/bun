export interface Point {
  x: number;
  y: number;
}

export class Pixel implements Point {
  constructor(
    public x: number,
    public y: number,
  ) {}
  sum(): number {
    return this.x + this.y;
  }
}

export function sum(p: Point): number {
  return p.x + p.y;
}
