class Rope {
  meters = 3;
  length(): number {
    return this.meters;
  }
  name(): string {
    return "rope";
  }
  call(): string {
    return "called";
  }
  apply(): string {
    return "applied";
  }
  bind(): string {
    return "bound";
  }
  push(n: number): number {
    return this.meters + n;
  }
  get size(): number {
    return this.meters * 2;
  }
  has(n: number): boolean {
    return n === this.meters;
  }
  at(i: number): number {
    return i;
  }
  static length = 7;
  static name = "a static name";
  static of(): string {
    return "static of";
  }
}

class Chain {
  links = 4;
  get length(): number {
    return this.links;
  }
  get name(): string {
    return "chain";
  }
}

function ropeFacts(r: Rope): string {
  return [r.length(), r.name(), r.call(), r.apply(), r.bind(), r.push(1), r.size, r.has(3), r.at(5)].join(" ");
}

function chainFacts(c: Chain): string {
  return c.length + " " + c.name;
}

function lengthOf(value: { length: number }): number {
  return value.length;
}

function staticFacts(): string {
  return Rope.length + " " + Rope.name + " " + Rope.of();
}

const r = new Rope();
const c = new Chain();

function round(label: string): void {
  console.log(label + ": " + ropeFacts(r) + " | " + chainFacts(c) + " " + lengthOf(c) + " " + lengthOf([1]) + " " + lengthOf("ab") + " | " + staticFacts());
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += ropeFacts(r).length + chainFacts(c).length + lengthOf(c) + staticFacts().length;
console.log("2000 honest: " + warm);
round("before");

export {};
