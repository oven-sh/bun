export function plusOne(n) {
  return n + 1;
}

export function origin() {
  return { x: 0, y: 0 };
}

export class Counter {
  constructor(start) {
    this.n = start;
  }
  next() {
    return ++this.n;
  }
}

export const limit = 10;
