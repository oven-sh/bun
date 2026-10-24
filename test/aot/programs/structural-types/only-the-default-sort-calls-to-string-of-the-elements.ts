class Ranked {
  constructor(public rank: number) {}
  toString(): string {
    return String(100 - this.rank);
  }
}

console.log(
  [new Ranked(1), new Ranked(3), new Ranked(2)]
    .sort()
    .map(r => r.rank)
    .join(),
);

export {};
