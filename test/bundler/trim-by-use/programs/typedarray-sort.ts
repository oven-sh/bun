const bytes = new Uint8Array([3, 1, 2, 255, 0]);
console.log(
  bytes.toSorted().join(),
  bytes.toSorted((a, b) => b - a).join(),
  bytes.join(),
  bytes.sort().join(),
  bytes.sort((a, b) => b - a).join(),
  Buffer.from([2, 1]).sort().join(),
);
const many = new Uint8Array(5000).map((_, index) => (index * 7919) % 251);
console.log(many.sort()[0], many[4999], many.toSorted((a, b) => b - a)[0]);
