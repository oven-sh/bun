const list = [3, 1, 2, 1];
console.log(
  list.toSorted().join(),
  list.toReversed().join(),
  list.toSpliced(1, 2, 9).join(),
  list.with(0, 7).join(),
  list.lastIndexOf(1),
  [1, [2, [3, [4]]]].flat(2).length,
  [1, 2, 3, 4, 5].copyWithin(0, 3).join(),
  list.join(),
);
console.log(
  ["b", "a"].toSorted().join(),
  [1.5, 0.5].toSorted((a, b) => a - b).join(),
  [, 1].toReversed().length,
  Array.prototype.lastIndexOf.call({ length: 2, 0: "x", 1: "x" }, "x"),
);
