// One call of Symbol in a loop at the top of the module makes a symbol in each round. An object holds a property under each of them.
export {};

const keys: symbol[] = [];
const holder: Record<symbol, number> = {};
for (let index = 0; index < 5; index++) {
  const key = Symbol("round");
  keys.push(key);
  holder[key] = index;
}
let last: symbol = keys[0];
for (const key of keys) last = key;
console.log(
  keys.map(key => holder[key]).join(),
  Object.getOwnPropertySymbols(holder).length,
  holder[last],
  new Set(keys).size,
);
let again = Symbol("again");
const early = again;
const both = { [again]: "early" } as Record<symbol, string>;
again = Symbol("again");
both[again] = "late";
console.log(both[early], both[again], early === again, Object.getOwnPropertySymbols(both).length);
