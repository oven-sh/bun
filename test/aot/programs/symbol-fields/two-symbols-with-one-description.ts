// Two calls of Symbol with the same text make two symbols, and a class has a field under each.
export {};

const kFirst = Symbol("same");
const kSecond = Symbol("same");
class Pair {
  [kSecond]: number;
  [kFirst]: number;
  constructor(first: number, second: number) {
    this[kFirst] = first;
    this[kSecond] = second;
  }
  difference(): number {
    return this[kFirst] - this[kSecond];
  }
}
let total = 0;
const pairs = [new Pair(10, 1), new Pair(20, 2)];
for (let round = 0; round < 300; round++) for (const pair of pairs) total += pair.difference();
const symbols = Object.getOwnPropertySymbols(pairs[0]);
console.log(
  total,
  symbols.length,
  symbols[0] === kSecond,
  symbols[1] === kFirst,
  (kFirst as symbol) === kSecond,
  String(kFirst) === String(kSecond),
);
pairs[0][kFirst] = 0;
console.log(pairs[0][kFirst], pairs[0][kSecond], pairs[0].difference(), (pairs[0] as any)[Symbol("same")]);
