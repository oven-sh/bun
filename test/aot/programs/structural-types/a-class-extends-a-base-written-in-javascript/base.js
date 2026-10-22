export class Base {
  x = 1;
  constructor(y = 2) {
    this.y = y;
  }
  sum() {
    return this.x + this.y;
  }
}
