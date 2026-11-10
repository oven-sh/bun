const list = [3, 1, 2, 1];
console.log(
  [...list].sort().join(),
  [...list].reverse().join(),
  list.slice(1).join(),
  list.indexOf(1),
  list.includes(2),
  list.concat([4]).join(),
  list.join("-"),
  [...list].splice(1, 2).join(),
  [...list].fill(0, 1).join(),
  list.at(-1),
  list.flatMap(value => [value, value]).length,
);
console.log(
  list.map(value => value * 2).join(),
  list.filter(value => value > 1).join(),
  list.find(value => value > 1),
  list.findLast(value => value > 1),
  list.findIndex(value => value > 5),
  list.reduce((a, b) => a + b),
  list.reduceRight((a, b) => a - b),
  list.some(value => value > 2),
  list.every(value => value > 0),
  [...list.entries()].length,
  [...list.keys()].length,
);
const stack = [1];
console.log(
  stack.push(2),
  stack.pop(),
  stack.unshift(0),
  stack.shift(),
  stack.length,
  Array.from("ab").join(),
  Array.of(1, 2).join(),
  Array.isArray(stack),
  String(list),
  list.toString(),
  new Uint8Array([3, 1, 2, 1]).lastIndexOf(1),
  new Uint8Array([1, 2]).toReversed().join(),
  new Uint8Array([2, 1]).toSorted().join(),
  new Uint8Array([1, 2]).with(0, 5).join(),
  new Uint8Array([1, 2, 3]).copyWithin(0, 2).join(),
);
Bun.gc(true);
