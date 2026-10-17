function underFreshSymbols() { const a = Symbol("a"), b = Symbol("b"), c = Symbol("c"); const o = {}; o[a] = 1; o[b] = 2; o[c] = 3; return o; }
const first = Symbol("first"), second = Symbol("second"), third = Symbol("third");
function underTheSameSymbols(i) { const o = {}; o[first] = i; o[second] = 2; o[third] = 3; return o; }
function underWellKnownSymbols(i) { const o = {}; o[Symbol.toStringTag] = "Tagged"; o[Symbol.toPrimitive] = () => i; return o; }
function mixed(i) { const key = Symbol("key"); const o = {}; o.name = i; o[key] = 2; o.last = 3; return o; }
function measure(make) {
  const sizes = []; let sum = 0;
  for (let round = 0; round < 6; round++) {
    for (let i = 0; i < 30000; i++) { const o = make(i); sum += Object.getOwnPropertySymbols(o).length + Object.keys(o).length; }
    sizes.push(fullGC());
  }
  const grown = sizes[5] - sizes[1];
  return sum + " " + (grown < 1500000 ? "the heap stays as it is" : "THE HEAP GROWS BY " + Math.round(grown / 4 / 30000) + " BYTES AN OBJECT");
}
console.log("fresh symbols: " + measure(underFreshSymbols));
console.log("the same symbols: " + measure(underTheSameSymbols));
console.log("well-known symbols: " + measure(underWellKnownSymbols));
console.log("a fresh symbol between names: " + measure(mixed));
const kept = underTheSameSymbols(7), tagged = underWellKnownSymbols(8);
console.log([kept[first], kept[second], kept[third], String(tagged), +tagged, Object.getOwnPropertySymbols(kept).map(String).join()].join(" "));
