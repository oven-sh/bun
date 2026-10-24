// An object literal with `__proto__: null` and one made by Object.create(null) hold properties under the symbol.
export {};

const kMass = Symbol("mass");
interface Bare {
  [kMass]: number;
}
const literal: Bare = { __proto__: null, [kMass]: 1 } as Bare;
const created: Bare = Object.create(null);
created[kMass] = 2;
function read(bare: Bare): number {
  return bare[kMass];
}
let total = 0;
for (let round = 0; round < 300; round++) total += read(literal) * 10 + read(created);
console.log(
  total,
  Object.getPrototypeOf(literal),
  Reflect.ownKeys(literal).length,
  Reflect.ownKeys(created).length,
  kMass in literal,
);
