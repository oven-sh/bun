// Map, Set and WeakMap: counts by key, unique values, an intersection, a cache that drops its oldest key, and iteration by `for of`, spread and forEach.
function countBy(items, keyOf) {
  const counts = new Map();
  for (const item of items) {
    const key = keyOf(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function unique(items) {
  return [...new Set(items)];
}

function intersect(a, b) {
  const out = new Set();
  for (const value of a) if (b.has(value)) out.add(value);
  return out;
}

class Cache {
  constructor(limit) {
    this.limit = limit;
    this.entries = new Map();
  }
  get(key) {
    const entries = this.entries;
    if (!entries.has(key)) return undefined;
    const value = entries.get(key);
    entries.delete(key);
    entries.set(key, value);
    return value;
  }
  set(key, value) {
    const entries = this.entries;
    if (entries.has(key)) entries.delete(key);
    else if (entries.size >= this.limit) entries.delete(entries.keys().next().value);
    entries.set(key, value);
  }
}

function run(rounds) {
  const words = [];
  for (let i = 0; i < 300; i++) words.push("k" + ((i * 11) % 70));
  const objects = words.slice(0, 40).map(word => ({ word }));
  const seen = new WeakMap();
  const cache = new Cache(32);
  let total = 0;
  for (let round = 0; round < rounds; round++) {
    const counts = countBy(words, word => word);
    for (const [word, count] of counts) total += word.length + count;
    total += unique(words).length + countBy(words, word => word.length).size;
    total += intersect(new Set(words.slice(0, 100)), new Set(words.slice(50, 150))).size;
    for (const object of objects) {
      seen.set(object, (seen.get(object) || 0) + 1);
      total += seen.get(object) & 1;
    }
    for (let i = 0; i < 200; i++) {
      const key = (i * 7 + round) % 48;
      if (cache.get(key) === undefined) cache.set(key, key * 2);
      else total++;
    }
    counts.forEach((count, word) => {
      if (count > 4) total += word.charCodeAt(1);
    });
  }
  return total;
}

console.log(run(2500));
