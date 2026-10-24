// Symbol() and Symbol(undefined) have no description, Symbol("") has an empty one. Each names a field of its own.
export {};

const kBare = Symbol();
const kUndefined = Symbol(undefined);
const kEmpty = Symbol("");
class Three {
  [kBare] = 1;
  [kUndefined] = 2;
  [kEmpty] = 3;
  sum(): number {
    return this[kBare] * 100 + this[kUndefined] * 10 + this[kEmpty];
  }
}
let total = 0;
const three = new Three();
for (let round = 0; round < 300; round++) total += three.sum();
console.log(
  total,
  Object.getOwnPropertySymbols(three)
    .map(key => typeof key.description + String(key))
    .join(),
);
