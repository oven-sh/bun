// What only a plain object, a Map, a Set, their tables or a rope holds on to survives collections: few and many properties, properties deleted, numbered properties, tables from empty to very large, keys that are no strings, ropes of two and three parts and parts of strings.
const shell = globalThis as any;
const collect: (full: boolean) => void = shell.Bun ? (full: boolean) => shell.Bun.gc(full) : (full: boolean) => (full ? shell.fullGC() : shell.edenGC());
type Leaf = { tag: string; n: number };
let made = 0;
function leaf(tag: string): Leaf {
  return { tag: tag + ":" + made, n: made++ };
}
function sumOf(value: unknown, depth = 0): number {
  if (depth > 6 || value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") return value.length + value.charCodeAt(value.length >> 1);
  if (typeof value !== "object") return 1;
  let sum = 0;
  if (value instanceof Map) {
    for (const [key, held] of value) sum += sumOf(key, depth + 1) + sumOf(held, depth + 1);
    return sum + value.size;
  }
  if (value instanceof Set) {
    for (const held of value) sum += sumOf(held, depth + 1);
    return sum + value.size;
  }
  if (Array.isArray(value)) {
    for (const held of value) sum += sumOf(held, depth + 1);
    return sum;
  }
  for (const key of Object.keys(value)) sum += key.length + sumOf((value as Record<string, unknown>)[key], depth + 1);
  return sum;
}

function plain(count: number): Record<string, unknown> {
  const object: Record<string, unknown> = {};
  for (let i = 0; i < count; i++) object["p" + i] = i % 3 ? leaf("plain") : "text " + i;
  return object;
}
function parsed(count: number): unknown {
  let text = "{";
  for (let i = 0; i < count; i++) text += (i ? "," : "") + '"k' + i + '":{"a":' + i + ',"b":"v' + i + '","c":[' + i + ",{}]}";
  return JSON.parse(text + "}");
}
function withHoles(count: number): Record<string, unknown> {
  const object = plain(count);
  for (let i = 0; i < count; i += 2) delete object["p" + i];
  object.last = leaf("last");
  return object;
}
function numbered(count: number): Record<string, unknown> {
  const object = plain(3);
  for (let i = 0; i < count; i++) object[i * 7] = leaf("numbered");
  return object;
}
function table(count: number): Map<string, Leaf> {
  const map = new Map<string, Leaf>();
  for (let i = 0; i < count; i++) map.set("key " + i, leaf("map"));
  return map;
}
function mixedKeys(count: number): Map<unknown, unknown> {
  const map = new Map<unknown, unknown>();
  for (let i = 0; i < count; i++) map.set(i % 3 === 0 ? i : i % 3 === 1 ? "s" + i : leaf("key"), i % 2 ? leaf("value") : i / 2);
  return map;
}
function names(count: number): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < count; i++) set.add("name " + i + " " + made);
  return set;
}
function numbersIn(count: number): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < count; i++) map.set("n" + i, i + 0.25);
  return map;
}
function mapWithProperties(count: number): Map<string, Leaf> {
  const map = table(count);
  (map as unknown as Record<string, unknown>).extra = leaf("property of a map");
  (map as unknown as Record<string, unknown>).more = plain(2);
  return map;
}
function ropes(count: number): string[] {
  const list: string[] = [];
  const long = "0123456789abcdefghijklmnopqrstuvwxyz".repeat(8);
  for (let i = 0; i < count; i++) {
    const a = "left part number " + i;
    const b = long.substring(i % 40, (i % 40) + 60);
    list.push(a + b);
    list.push(a + b + " and a third part " + i);
    list.push(long.slice(i % 100, (i % 100) + 50));
    list.push((a + b).substring(5, 40));
    list.push(((a + b) + (b + a)) + ((a + a) + (b + b)));
  }
  return list;
}

const kept: unknown[] = [];
for (let round = 0; round < 8; round++) {
  for (const count of [0, 1, 2, 5, 6, 7, 20, 70, 300]) {
    kept.push(plain(count), parsed(count), withHoles(count), numbered(count % 50), table(count), mixedKeys(count), names(count), numbersIn(count), mapWithProperties(count % 30));
  }
  kept.push(ropes(60), table(5000), names(9000), mixedKeys(3000));
  for (let i = 0; i < 20000; i++) leaf("garbage");
  collect(round % 2 === 0);
  if (round % 3 === 2) kept.splice(0, kept.length >> 1);
  for (let i = 0; i < 20000; i++) plain(2);
  collect(true);
  let sum = 0;
  for (const value of kept) sum = (sum + sumOf(value)) % 1000000007;
  console.log(round, kept.length, sum);
}
