export class Counter {
  n = 1;
  half(a: number): number {
    return a > 100 ? this.half(a - 1) : a / 2;
  }
}
