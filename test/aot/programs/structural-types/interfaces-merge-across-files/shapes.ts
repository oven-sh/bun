export class Point {
  x = 1;
  y = 2;
  sum(): number {
    return this.x + this.y;
  }
}

export class Dog {
  legs = 4;
}

export function makePoint(): Point {
  return new Point();
}
