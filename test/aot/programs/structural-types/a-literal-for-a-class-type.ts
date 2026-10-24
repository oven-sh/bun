class Point {
  x = 1;
  double(): number {
    return this.x * 2;
  }
}

function use(p: Point): string {
  return p.double() + " " + p.x + " " + (p instanceof Point);
}

const fake: Point = { x: 5, double: () => -1 };
console.log(use(new Point()));
console.log(use(fake));
console.log(use(new Point()));

export {};
