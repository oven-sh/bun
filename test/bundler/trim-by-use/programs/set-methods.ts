const odd = new Set([1, 3, 5, 7]);
const low = new Set([1, 2, 3]);
const list = (set: Set<number>) => [...set].join(",");
console.log(
  list(odd.union(low)),
  list(odd.intersection(low)),
  list(odd.difference(low)),
  list(odd.symmetricDifference(low)),
);
console.log(
  new Set([1, 3]).isSubsetOf(odd),
  odd.isSupersetOf(new Set([1, 3])),
  odd.isDisjointFrom(new Set([2, 4])),
  low.isSubsetOf(odd),
);
console.log(
  list(odd.union(new Map([[9, 9]]) as any)),
  list(low.intersection({ size: 1, has: (value: number) => value === 2, keys: () => [2][Symbol.iterator]() } as any)),
);
