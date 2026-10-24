// Maps and sets with string keys are added to, deleted from, cleared and grown while they are iterated over, in every way of iterating.
declare const console: { log(...values: unknown[]): void };
function filled(count: number): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < count; i++) map.set("k" + i, i);
  return map;
}
function keysOf(map: Map<string, number>): string {
  return [...map.keys()].join(" ");
}

for (const count of [0, 1, 3, 4, 5, 8, 9, 12, 30, 260]) {
  // Added during iteration: the new entries are visited.
  {
    const map = filled(count);
    let visited = 0;
    for (const [key, value] of map) {
      visited++;
      if (value < count && visited <= count) map.set("new" + key, value + 1000);
    }
    console.log(count, "added in for-of", visited, map.size);
  }
  {
    const map = filled(count);
    let visited = 0;
    map.forEach((value, key) => {
      visited++;
      if (value < count) map.set("new" + key, value + 1000);
    });
    console.log(count, "added in forEach", visited, map.size);
  }
  // Deleted before and after the current entry.
  {
    const map = filled(count);
    const seen: string[] = [];
    for (const key of map.keys()) {
      seen.push(key);
      const n = Number(key.slice(1));
      map.delete("k" + (n + 1));
      if (n % 4 === 0) map.delete(key);
      if (n % 6 === 0) map.delete("k" + (n - 2));
    }
    console.log(count, "deleted", seen.length, seen.slice(0, 8).join(" "), "|", keysOf(map).slice(0, 60));
  }
  // Deleted and added again: it goes to the end and is visited again.
  {
    const map = filled(count);
    let visited = 0;
    for (const [key, value] of map) {
      if (++visited > 3 * count + 3) break;
      if (value < 2 * count && value % 2 === 0) {
        map.delete(key);
        map.set(key, value + count + (count % 2) + 1);
      }
    }
    console.log(count, "moved to the end", visited, keysOf(map).slice(0, 60));
  }
  // Cleared, then filled again.
  {
    const map = filled(count);
    const seen: string[] = [];
    let cleared = false;
    for (const key of map.keys()) {
      seen.push(key);
      if (!cleared && seen.length === (count >> 1) + 1) {
        cleared = true;
        map.clear();
        map.set("after", 1);
        map.set("k0", 2);
      }
    }
    console.log(count, "cleared", seen.length, seen.slice(-3).join(" "), keysOf(map));
  }
  // An iterator by hand that outlives growth, deletion of everything, and a clear.
  {
    const map = filled(count);
    const iterator = map.entries();
    const first = iterator.next();
    for (let i = 0; i < 300; i++) map.set("more" + i, i);
    const second = iterator.next();
    for (const key of [...map.keys()]) if (key !== "more299") map.delete(key);
    const third = iterator.next();
    const fourth = iterator.next();
    map.set("late", 1);
    const fifth = iterator.next();
    console.log(count, "by hand", JSON.stringify([first, second, third, fourth, fifth]));
  }
  {
    const set = new Set<string>(filled(count).keys());
    const values = set.values();
    const out: string[] = [];
    for (let step = values.next(), n = 0; !step.done && n < 600; step = values.next(), n++) {
      out.push(step.value);
      if (n < 5) set.add("x" + n);
      if (n === 2) set.delete("x0");
      if (n === 3) set.add("x0");
    }
    console.log(count, "set", out.length, out.slice(-6).join(" "));
  }
  // Two iterations at once over one map.
  {
    const map = filled(count);
    let pairs = 0;
    for (const a of map.keys()) {
      for (const b of map.keys()) {
        pairs++;
        if (a === "k1" && b === "k2") map.delete("k3");
      }
    }
    console.log(count, "nested", pairs);
  }
}

// Order after deletions and additions, through the sizes at which a table changes its form.
{
  const map = new Map<string, number>();
  const log: string[] = [];
  for (let i = 0; i < 600; i++) {
    map.set("k" + i, i);
    if (i % 3 === 2) map.delete("k" + (i - 2));
    if (i % 7 === 6) map.set("k" + (i - 6), -i);
    if ([3, 4, 7, 8, 9, 15, 16, 17, 100, 253, 254, 255, 256, 257, 400, 599].includes(i)) log.push(i + ":" + map.size + ":" + [...map].slice(-3).join("/"));
  }
  console.log(log.join(" "));
  let sum = 0;
  for (const [key, value] of map) sum = (sum * 31 + value + key.length) | 0;
  console.log("order", sum);
}

// Spread, Array.from and copies.
{
  const map = filled(10);
  map.delete("k4");
  map.set("k4", 44);
  console.log([...map].join(";"), Array.from(map.values()).join(), JSON.stringify(Object.fromEntries(map)));
  const copy = new Map(map);
  copy.set("own", 1);
  map.delete("k0");
  console.log(copy.size, map.size, copy.get("k0"), map.get("own"), keysOf(copy));
  const grouped = Map.groupBy(["one", "two", "three", "four"], word => "length" + word.length);
  console.log([...grouped].join(";"), grouped.get("length3")!.length);
  const a = new Set<string>(["a", "b", "c"]), b = new Set<string>(["b", "c", "d"]);
  console.log([...a.union(b)].join(), [...a.intersection(b)].join(), [...a.difference(b)].join(), a.isSubsetOf(b), a.isDisjointFrom(new Set<string>(["z"])));
}
