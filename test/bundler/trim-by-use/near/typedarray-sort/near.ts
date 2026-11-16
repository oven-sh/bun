const bytes = new Uint8Array([3, 1, 2, 255, 0]);
console.log(
  [...bytes].sort((a, b) => a - b).join(),
  [3, 1, 2].sort().join(),
  [3, 1, 2].toSorted().join(),
  ["b", "a"].sort().join(),
  Array.prototype.sort.call(new Uint8Array([2, 1])).join(),
  Array.from(bytes)
    .toSorted((a, b) => b - a)
    .join(),
);
console.log(
  bytes.map(value => value + 1).join(),
  bytes.filter(value => value > 1).join(),
  bytes.slice(1).join(),
  bytes.subarray(1).join(),
  bytes.indexOf(2),
  bytes.includes(3),
  bytes.join("-"),
  bytes.reverse().join(),
  bytes.toReversed().join(),
  bytes.fill(1, 0, 1).join(),
  bytes.find(value => value > 2),
  bytes.reduce((a, b) => a + b, 0),
  bytes.with(0, 9).join(),
  String(bytes),
  bytes.at(-1),
  [...bytes.keys()].length,
);
Bun.gc(true);
