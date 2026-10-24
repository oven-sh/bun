const log: string[] = [];

class CountingMap extends Map<string, number> {
  stores = 100;
  set(key: string, value: number): this {
    log.push("set " + key + " with stores " + this.stores);
    this.stores++;
    return super.set(key, value * 10);
  }
}

class CountingSet extends Set<number> {
  adds = 100;
  add(value: number): this {
    log.push("add " + value + " with adds " + this.adds);
    return super.add(-value);
  }
}

class QuietMap extends Map<string, number> {}

function line(label: string, value: unknown): void {
  console.log(label + ": " + String(value) + " [" + log.join(", ") + "]");
  log.length = 0;
}

function put(m: Map<string, number>, key: string, value: number): string {
  m.set(key, value);
  return key + "=" + m.get(key) + " size " + m.size;
}

function include(s: Set<number>, value: number): string {
  return [...s.add(value)].join();
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += put(new Map(), "k", i).length + include(new Set(), i).length;
line("2000 honest", warm);

const made = new CountingMap([
  ["a", 1],
  ["b", 2],
]);
line("a map subclass made from entries", [...made].join(";") + " stores " + made.stores);
line("a typed store", put(made, "c", 3) + " stores " + made.stores);
line("an empty one", put(new CountingMap(), "d", 4));
line("a plain map at the same site", put(new Map(), "e", 5));
line("a subclass that overrides nothing", put(new QuietMap([["f", 6]]), "g", 7));

const set = new CountingSet([1, 2]);
line("a set subclass made from values", [...set].join() + " adds " + set.adds);
line("a typed add", include(set, 3));
line("a plain set at the same site", include(new Set([9]), 3));

const original = CountingMap.prototype.set;
CountingMap.prototype.set = function (key, value) {
  log.push("patched set " + key);
  Map.prototype.set.call(this, key, -value);
  return this;
};
line("the override replaced, made from entries", [...new CountingMap([["h", 8]])].join(";"));
line("a typed store", put(made, "i", 9));
CountingMap.prototype.set = original;

Reflect.deleteProperty(CountingMap.prototype, "set");
line("the override deleted, made from entries", [...new CountingMap([["j", 10]])].join(";"));
line("a typed store", put(made, "k", 11));
CountingMap.prototype.set = original;
line("restored", put(made, "l", 12));

QuietMap.prototype.set = function (key, value) {
  log.push("added set " + key);
  Map.prototype.set.call(this, key, value + 0.5);
  return this;
};
line("an override added to the quiet subclass", [...new QuietMap([["m", 13]])].join(";") + " | " + put(new QuietMap(), "n", 14));
line("a plain map at the end", put(new Map(), "o", 15));

export {};
