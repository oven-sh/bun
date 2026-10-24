// Maps and sets with string keys do what a list of pairs does, through a long random sequence of operations, with keys in every internal representation.
declare const console: { log(...values: unknown[]): void };
const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun.gc(true));

let seed = 12345;
function random(below: number): number {
  seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
  return (seed >>> 8) % below;
}

class Item {
  constructor(public label: string, public rank: number) {}
}

// The same text each time, as another string each time.
const wide = "Ā";
function flat(text: string): string {
  return text.split("").join("");
}
function rope(text: string): string {
  const at = text.length >> 1;
  return flat(text.slice(0, at)) + flat(text.slice(at));
}
function part(text: string): string {
  return ("<<" + text + ">>").slice(2, 2 + text.length);
}
function partOfWide(text: string): string {
  return (wide + text + wide).slice(1, 1 + text.length);
}
function flatWide(text: string): string {
  return (text + wide).split("").slice(0, -1).join("");
}
function represented(text: string, how: number): string {
  switch (how) {
    case 0: return text;
    case 1: return flat(text);
    case 2: return rope(text);
    case 3: return part(text);
    case 4: return partOfWide(text);
    case 5: return flatWide(text);
    default: return `${text}`;
  }
}

const pool: string[] = [];
for (let i = 0; i < 700; i++) pool.push("k" + i);
for (let length = 0; length < 140; length += length < 20 ? 1 : 7) pool.push("x".repeat(length) + (length % 3 ? "" : "y"));
pool.push("", "a", "b", "0", "1", "-0", "NaN", "undefined", "null", "__proto__", "constructor", "get", "size", "é", "éè", "Ā", "Āā", "😀", "a\u0000b", "a\u0000c");

class Model {
  keys: string[] = [];
  values: Item[] = [];
  find(key: string): number {
    for (let i = 0; i < this.keys.length; i++) if (this.keys[i] === key) return i;
    return -1;
  }
}

let wrong = 0;
let checksum = 0;
function mix(value: number): void {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}
function fail(what: string): void {
  if (wrong++ < 10) console.log("wrong:", what);
}

function compare(map: Map<string, Item>, set: Set<string>, model: Model): void {
  if (map.size !== model.keys.length) fail("size of the map " + map.size + " " + model.keys.length);
  if (set.size !== model.keys.length) fail("size of the set " + set.size + " " + model.keys.length);
  let i = 0;
  for (const [key, value] of map) {
    if (key !== model.keys[i] || value !== model.values[i]) fail("order of the map at " + i);
    i++;
  }
  if (i !== model.keys.length) fail("entries of the map " + i);
  i = 0;
  for (const key of set) {
    if (key !== model.keys[i]) fail("order of the set at " + i);
    i++;
  }
  if (i !== model.keys.length) fail("entries of the set " + i);
}

function run(rounds: number, keysInUse: number, from: number): void {
  const map = new Map<string, Item>();
  const set = new Set<string>();
  const model = new Model();
  for (let round = 0; round < rounds; round++) {
    const text = pool[from + random(keysInUse)]!;
    const key = represented(text, random(7));
    const at = model.find(text);
    const what = random(100);
    if (what < 35) {
      const found = map.get(key);
      if (found !== (at < 0 ? undefined : model.values[at])) fail("get " + JSON.stringify(text));
      mix(found ? found.rank : -1);
    } else if (what < 45) {
      if (map.has(key) !== at >= 0) fail("has " + JSON.stringify(text));
      if (set.has(key) !== at >= 0) fail("has of the set " + JSON.stringify(text));
    } else if (what < 80) {
      const item = new Item(text, round);
      if (map.set(key, item) !== map) fail("set yields the map");
      if (set.add(key) !== set) fail("add yields the set");
      if (at < 0) {
        model.keys.push(text);
        model.values.push(item);
      } else model.values[at] = item;
    } else if (what < 97) {
      if (map.delete(key) !== at >= 0) fail("delete " + JSON.stringify(text));
      if (set.delete(key) !== at >= 0) fail("delete of the set " + JSON.stringify(text));
      if (at >= 0) {
        model.keys.splice(at, 1);
        model.values.splice(at, 1);
      }
    } else if (what < 98 && random(8) === 0) {
      map.clear();
      set.clear();
      model.keys.length = 0;
      model.values.length = 0;
    } else compare(map, set, model);
    if (key.length !== text.length || key !== text) fail("the key is as it was");
    if (round % 5000 === 4999) collect();
  }
  compare(map, set, model);
  mix(map.size);
}

for (const keysInUse of [1, 2, 3, 4, 5, 6, 8, 9, 10, 12, 16, 24, 40, 100, 200, 260, 400, 700]) run(6000, keysInUse, 0);
run(20000, pool.length, 0);
run(20000, pool.length - 700, 700);
console.log("wrong", wrong, "checksum", checksum);
