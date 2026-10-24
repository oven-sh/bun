export const version = 1;

export class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  norm(): number {
    return Math.abs(this.x) + Math.abs(this.y);
  }
  plus(other: Point): Point {
    return new Point(this.x + other.x, this.y + other.y);
  }
}

export function isPoint(value: unknown): value is Point {
  return value instanceof Point;
}
