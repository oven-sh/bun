// Each call of the function makes another symbol, so the one place in the text stands for many keys. What is stored under one is not found under another.
export {};

function makeKey(): symbol {
  return Symbol("made");
}
const first = makeKey();
const second = makeKey();
const holder: Record<symbol, number> = {};
holder[first] = 1;
holder[second] = 2;
function read(object: Record<symbol, number>, key: symbol): number {
  return object[key];
}
let total = 0;
for (let round = 0; round < 300; round++) total += read(holder, first) * 10 + read(holder, second);
console.log(total, first === second, Object.getOwnPropertySymbols(holder).length, holder[makeKey()]);
function tagged(value: number) {
  const key = Symbol("inner");
  const object = { [key]: value, key };
  return object;
}
const one = tagged(1);
const two = tagged(2);
console.log(
  (one as any)[one.key],
  (two as any)[two.key],
  (one as any)[two.key],
  (two as any)[one.key],
  one.key === two.key,
);
