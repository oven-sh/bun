class CountingSet extends Set<number> {
  name = "counting";
  adds = 100;
  flag = true;
  add(value: number): this {
    this.adds++;
    return super.add(value * (this.flag ? 10 : 1) + this.name.length);
  }
}

class CountingMap extends Map<string, number> {
  stores = 100;
  set(key: string, value: number): this {
    this.stores++;
    return super.set(key, value * 10);
  }
}

function include(s: Set<number>, value: number): string {
  return [...s.add(value)].join();
}

function put(m: Map<string, number>, key: string, value: number): string {
  m.set(key, value);
  return key + "=" + m.get(key) + " size " + m.size;
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += include(new CountingSet(), i).length + put(new CountingMap(), "k", i).length + include(new Set(), i).length + put(new Map(), "k", i).length;
console.log("2000 rounds: " + warm);

const set = new CountingSet();
console.log("a set subclass: " + include(set, 1) + " | " + include(set, 2) + " | adds " + set.adds + " | keys " + Object.keys(set).join());
const map = new CountingMap();
console.log("a map subclass: " + put(map, "a", 1) + " | " + put(map, "b", 2) + " | stores " + map.stores);
console.log("plain ones at the same sites: " + include(new Set([9]), 3) + " | " + put(new Map(), "c", 3));

export {};
