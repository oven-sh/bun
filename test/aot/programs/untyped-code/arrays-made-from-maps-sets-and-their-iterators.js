function show(label, value) {
  console.log(label, JSON.stringify(value));
}

function filled(count, make) {
  const set = new Set();
  for (let i = 0; i < count; ++i) set.add(make(i));
  return set;
}

for (const count of [0, 1, 4, 9, 300]) {
  const integers = filled(count, i => i * 3);
  const doubles = filled(count, i => i + 0.5);
  const strings = filled(count, i => "s" + i);
  const mixed = filled(count, i => (i % 3 === 0 ? i : i % 3 === 1 ? "m" + i : i / 4));
  for (const set of [integers, doubles, strings, mixed]) {
    const list = Array.from(set);
    const spread = [...set];
    show("set " + count, [list.length, list.slice(0, 3), list.slice(-2), spread.length, spread.join() === list.join()]);
    show("set iterators " + count, [Array.from(set.values()).join() === list.join(), Array.from(set.keys()).join() === list.join(), Array.from(set.entries()).length]);
  }

  const map = new Map();
  for (let i = 0; i < count; ++i) map.set("k" + i, i % 2 ? i : i + 0.25);
  show("map " + count, [Array.from(map.keys()).slice(-2), Array.from(map.values()).slice(-2), Array.from(map).slice(-1), [...map.values()].length]);
}

{
  const set = new Set([1, 2, 3, 4, 5]);
  const started = set.values();
  started.next();
  started.next();
  set.delete(1);
  set.delete(4);
  for (let i = 10; i < 80; ++i) set.add(i);
  const rest = Array.from(started);
  show("started", [rest.length, rest.slice(0, 4), started.next().done]);
  set.add("later");
  show("finished stays finished", [Array.from(started), started.next().done, [...started]]);
}

{
  const map = new Map([["a", 1], ["b", 2], ["c", 3]]);
  const keys = map.keys();
  const values = map.values();
  keys.next();
  values.next();
  map.clear();
  map.set("x", 1.5);
  map.set("y", 2.5);
  show("cleared", [Array.from(keys), Array.from(values), map.size]);
  const empty = new Map().keys();
  show("empty", [Array.from(empty), Array.from(new Set().values()), Array.from(new Set())]);
}

{
  const a = filled(40, i => i);
  const b = filled(40, i => i * 2);
  const methods = ["union", "intersection", "difference", "symmetricDifference"];
  for (const name of methods) show(name, [...a[name](b)].slice(-5).concat(a[name](b).size));
  show("relations", [a.isSubsetOf(b), a.isSupersetOf(new Set([1, 39])), a.isDisjointFrom(new Set([40, 41])), new Set([2, 4]).isSubsetOf(b)]);

  const growing = new Set([1, 2, 3]);
  const setLike = {
    size: 100,
    has(value) {
      if (value < 40) growing.add(value + 10);
      return value % 2 === 0;
    },
    keys() {
      return [][Symbol.iterator]();
    },
  };
  show("changes in a callback", [[...growing.intersection(setLike)], growing.size, growing.isSubsetOf(setLike)]);
}

{
  const set = filled(12, i => "v" + i);
  const map = new Map([...set].map((value, index) => [value, index]));
  const setCopy = new Set(set);
  const mapCopy = new Map(map);
  set.delete("v0");
  map.delete("v0");
  show("copies", [setCopy.size, mapCopy.size, set.size, map.size, setCopy.has("v0"), mapCopy.get("v0")]);
  show("from iterators", [new Set(map.keys()).size, new Set(map.values()).has(11), new Map(map.entries()).get("v11"), new Set(set.values()).size]);
  show("grouped", [...Map.groupBy(setCopy, value => value.length)].map(([key, list]) => [key, list.length]));
}

{
  const map = new Map();
  const seen = [map.getOrInsert("a", 1), map.getOrInsert("a", 2)];
  seen.push(
    map.getOrInsertComputed("b", key => {
      for (let i = 0; i < 50; ++i) map.set(key + i, i);
      return "computed";
    }),
  );
  seen.push(map.getOrInsertComputed("b", () => "never"), map.size, map.get("b49"));
  try {
    map.getOrInsertComputed("c", () => {
      throw new Error("from the callback");
    });
  } catch (error) {
    seen.push(error.message, map.has("c"));
  }
  show("getOrInsert", seen);
}

{
  const set = new Set(["a", "b", "c"]);
  const seen = [];
  set.forEach(value => {
    seen.push(value);
    if (value === "a") set.delete("b");
    if (seen.length < 30) set.add(value + seen.length);
  });
  show("forEach", [seen.length, seen.slice(0, 5), set.size]);
  show("arguments", [Math.max(...new Set([3, 9, 4])), String.fromCharCode(...new Set([104, 105]))]);
}
