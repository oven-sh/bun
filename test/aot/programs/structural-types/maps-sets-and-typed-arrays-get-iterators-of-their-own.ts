const log: string[] = [];

class Backwards extends Map<string, number> {
  *[Symbol.iterator](): Generator<[string, number], undefined, unknown> {
    log.push("map subclass iterator");
    yield* [...super.entries()].reverse();
    return undefined;
  }
}

class Doubled extends Set<number> {
  *[Symbol.iterator](): Generator<number, undefined, unknown> {
    log.push("set subclass iterator");
    for (const n of super.values()) yield n * 2;
    return undefined;
  }
}

class Skipping extends Uint8Array {
  *[Symbol.iterator](): Generator<number, undefined, unknown> {
    log.push("typed array subclass iterator");
    for (let i = 0; i < this.length; i += 2) yield this[i];
    return undefined;
  }
}

function mapText(m: Map<string, number>): string {
  const seen: string[] = [];
  for (const [key, value] of m) seen.push(key + value);
  return seen.join() + " | " + [...m].join(";") + " | " + [...new Map(m).keys()].join() + " | " + Array.from(m).length + " | " + [...m.entries()].join(";");
}

function setText(s: Set<number>): string {
  let total = 0;
  for (const n of s) total += n;
  return total + " | " + [...s].join() + " | " + [...new Set(s)].join() + " | " + Math.max(...s) + " | " + [...s.values()].join();
}

function bytesText(b: Uint8Array): string {
  let total = 0;
  for (const n of b) total += n;
  let byIndex = 0;
  for (let i = 0; i < b.length; i++) byIndex += b[i];
  return total + " | " + byIndex + " | " + [...b].join() + " | " + Array.from(b).join() + " | " + new Uint8Array(b).join() + " | " + b.join();
}

function line(label: string, value: string): void {
  console.log(label + ": " + value + " [" + log.length + (log.length ? " " + log[0] : "") + "]");
  log.length = 0;
}

function* oneEntry(): Generator<[string, number], undefined, unknown> {
  log.push("own map iterator");
  yield ["own", 0];
  return undefined;
}

function* oneNumber(): Generator<number, undefined, unknown> {
  log.push("own iterator");
  yield 77;
  return undefined;
}

const entries: [string, number][] = [
  ["a", 1],
  ["b", 2],
];
let warm = 0;
for (let i = 0; i < 2000; i++) warm += mapText(new Map(entries)).length + setText(new Set([1, 2])).length + bytesText(Uint8Array.of(1, 2, 3)).length;
line("2000 honest", String(warm));

line("a map", mapText(new Map(entries)));
line("a map subclass", mapText(new Backwards(entries)));
const ownMap = new Map(entries);
ownMap[Symbol.iterator] = oneEntry;
line("a map with its own iterator", mapText(ownMap));
Reflect.deleteProperty(ownMap, Symbol.iterator);
line("removed", mapText(ownMap));
const ownEntries = new Map(entries);
ownEntries.entries = oneEntry;
line("a map with its own entries method", mapText(ownEntries));

line("a set", setText(new Set([1, 2])));
line("a set subclass", setText(new Doubled([1, 2])));
const ownSet = new Set([1, 2]);
ownSet[Symbol.iterator] = oneNumber;
line("a set with its own iterator", setText(ownSet));
Reflect.deleteProperty(ownSet, Symbol.iterator);
line("removed", setText(ownSet));

line("a typed array", bytesText(Uint8Array.of(1, 2, 3)));
line("a typed array subclass", bytesText(Skipping.of(1, 2, 3)));
const ownBytes = Uint8Array.of(1, 2, 3);
ownBytes[Symbol.iterator] = oneNumber;
line("a typed array with its own iterator", bytesText(ownBytes));
Reflect.deleteProperty(ownBytes, Symbol.iterator);
line("removed", bytesText(ownBytes));

class Likes {
  size = 2;
  has(n: number): boolean {
    log.push("has " + n);
    return n === 1;
  }
  keys(): Iterator<number> {
    log.push("keys");
    return [1, 5].values();
  }
}

const base = new Set([1, 2, 3]);
line("union with a set-like object", [...base.union(new Likes())].join());
line("intersection", [...base.intersection(new Likes())].join());
line("difference", [...base.difference(new Likes())].join());
line("is a subset", String(base.isSubsetOf(new Likes())));
line("union with a subclass that has its own iterator", [...base.union(new Doubled([9]))].join());

export {};
