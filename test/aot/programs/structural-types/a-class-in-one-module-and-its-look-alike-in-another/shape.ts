export class Shape {
  sides = 4;
  name = "shape";
  area(): number {
    return this.sides * 10;
  }
  get summary(): string {
    return this.name + " with " + this.sides;
  }
  static is(value: Shape): boolean {
    return value instanceof Shape;
  }
}

export function describe(s: Shape): string {
  return [s.name, s.sides, s.area(), s.summary, s instanceof Shape, Shape.is(s), s.constructor.name].join(" ");
}

export function grow(s: Shape): number {
  s.sides += 1;
  return s.area();
}

export function warm(): number {
  let total = 0;
  const s = new Shape();
  for (let i = 0; i < 2000; i++) total += describe(s).length + grow(s);
  return total;
}
