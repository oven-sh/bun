export function first(n) {
  return n + "1";
}

export function second(n) {
  return [n];
}

export class Fourth {
  constructor(n) {
    this.n = n;
  }
  get() {
    return "fourth " + this.n;
  }
}
