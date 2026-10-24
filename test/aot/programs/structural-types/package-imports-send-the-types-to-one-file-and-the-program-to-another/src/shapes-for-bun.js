export class Square {
  constructor(side) {
    this.cached = side * side;
    this.side = String(side);
  }
  area() {
    return this.cached;
  }
}
export const built = "bun";
