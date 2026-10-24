function plural(n: number) { return n === 1 ? "1 side" : n + " sides"; }

export class Shape {
  sides() { return 0; }
  describe() { return this.constructor.name + " has " + plural(this.sides()); }
}
export class Circle extends Shape {
  sides() { return 1; }
}
export class Marker {
  static [Symbol.hasInstance](value: unknown) { return accepts(value); }
}
function accepts(value: unknown) { return value instanceof Shape; }
export class Factory {
  static make() { return new Triangle(); }
}
class Triangle extends Shape {
  sides() { return 3; }
}
