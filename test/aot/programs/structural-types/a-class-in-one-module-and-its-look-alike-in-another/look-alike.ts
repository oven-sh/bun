export class Shape {
  name = "look-alike";
  hidden = "hidden";
  sides = 3;
  area(): number {
    return this.sides * -10;
  }
  get summary(): string {
    return "not the same " + this.name;
  }
  static is(): boolean {
    return true;
  }
}

export const literal = {
  summary: "a literal",
  area: () => 0,
  sides: 0,
  name: "literal",
};
