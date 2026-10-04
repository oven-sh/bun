import { makePair, readsAll, readsTwo } from "untyped";

class Closed {
  third: number;
  first: number;
  second: string;
  constructor(first: number, second: string, third: number) {
    this.third = third;
    this.first = first;
    this.second = second;
  }
  sum(): number {
    return this.first + this.third;
  }
}
interface Open {
  second: string;
  first: number;
  third?: number;
}
interface SameOrder {
  first: number;
  second: string;
  third: number;
}
function makeOpen(first: number, second: string): Open {
  return { second, first };
}
function makeSameOrder(first: number, second: string, third: number): SameOrder {
  return { first, second, third };
}
function sumOfSameOrder(o: SameOrder): number {
  return o.first + o.third;
}
const out: string[] = [];
for (let round = 0; round < 4; ++round) {
  const closed = new Closed(1, "two", 3);
  const open = makeOpen(4, "five");
  const sameOrder = makeSameOrder(6, "seven", 8);
  const filled = makeOpen(9, "ten");
  filled.third = 11;
  for (const o of [makePair(0, "pair", 0.5), closed, open, sameOrder, filled, makePair("a", "b", "c")]) {
    out.push(readsAll(o), readsTwo(o));
  }
  out.push(String(closed.sum()), String(sumOfSameOrder(sameOrder)), String(filled.third));
}
console.log(out.join(" "));
