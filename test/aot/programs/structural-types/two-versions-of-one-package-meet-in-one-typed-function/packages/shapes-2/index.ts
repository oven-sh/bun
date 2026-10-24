export const version = 2;

export class Point {
  label = "v2";
  y: number;
  x: number;
  constructor(x: number, y: number) {
    this.y = y;
    this.x = x;
  }
  norm(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }
  plus(other: Point): Point {
    return new Point(this.x + other.x, this.y + other.y);
  }
}

export function isPoint(value: unknown): value is Point {
  return value instanceof Point;
}
