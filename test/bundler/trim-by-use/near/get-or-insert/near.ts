const map = new Map<unknown, unknown>([["a", 1]]);
if (!map.has("b")) map.set("b", 6);
console.log(
  map.get("a"),
  map.get("b"),
  map.get("c") ?? "none",
  map.size,
  map.delete("a"),
  [...map.keys()].join(),
  [...map.values()].join(),
  [...map.entries()].length,
);
map.forEach((value, key) => console.log(key, value));
const key = {};
const weak = new WeakMap([[key, 1]]);
console.log(
  weak.get(key),
  weak.has({}),
  weak.set({}, 2) === weak,
  weak.delete(key),
  Map.groupBy([1, 2, 3], value => value % 2).get(1)!.length,
  structuredClone(map).size,
);
map.clear();
console.log(map.size);
Bun.gc(true);
