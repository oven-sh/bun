const map: any = new Map([["a", 1]]);
console.log(
  map.getOrInsert("a", 5),
  map.getOrInsert("b", 6),
  map.getOrInsertComputed("c", (key: string) => key + "!"),
  map.getOrInsertComputed("c", () => "never"),
  [...map].join(";"),
);
const key = {};
const weak: any = new WeakMap();
console.log(
  weak.getOrInsert(key, 1),
  weak.getOrInsert(key, 2),
  weak.getOrInsertComputed({}, () => 3),
);
