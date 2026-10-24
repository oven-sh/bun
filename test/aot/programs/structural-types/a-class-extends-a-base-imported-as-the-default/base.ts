export default class Base {
  x = 1;
  y: number;
  constructor(y: number = 2) {
    this.y = y;
  }
  sum(): number {
    return this.x + this.y;
  }
}
