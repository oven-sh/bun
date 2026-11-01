const set = new Set([3, 1, 2, 3]);
set.add(4).add(1);
console.log(
  set.size,
  set.has(2),
  set.delete(2),
  set.has(2),
  [...set].join(","),
  [...set.keys()].length,
  [...set.values()].length,
  [...set.entries()].length,
);
let sum = 0;
set.forEach(value => (sum += value));
for (const value of set) sum += value;
console.log(
  sum,
  new Set("hello").size,
  new Set([NaN, NaN, 0, -0, "0"]).size,
  new Set(new Map([[1, 2]]).keys()).size,
  Object.prototype.toString.call(set),
  structuredClone(set).size,
);
const both = new Set([...set, ...new Set([9, 1])]);
const common = new Set([...set].filter(value => both.has(value)));
console.log(
  both.size,
  common.size,
  [...set].every(value => both.has(value)),
);
set.clear();
const map = new Map([[1, "a"]]);
const weak = new WeakSet([set]);
console.log(
  set.size,
  map.get(1),
  map.has(2),
  map.set(2, "b").size,
  map.delete(1),
  [...map].length,
  weak.has(set),
  weak.delete(set),
  Object.groupBy([1, 2, 3], value => (value % 2 ? "odd" : "even")).odd!.length,
);
Bun.gc(true);
