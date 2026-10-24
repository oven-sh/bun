// Keys of maps, sets and plain objects are concatenated from numbers and strings right where they are used, and equal the same strings from elsewhere.
declare const console: { log(...values: unknown[]): void };
const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun.gc(true));
class Node {
  constructor(public id: number, public name: string, public weight: number, public next: number | undefined) {}
}
function pairKey(a: Node, b: Node): string {
  return a.id + "," + b.id;
}
function listKey(nodes: Node[]): string {
  let result = "";
  for (let i = 0; i < nodes.length; i++) {
    if (result.length) result += ",";
    result += nodes[i]!.id;
  }
  return result;
}
function runsKey(nodes: Node[]): string {
  let result = "";
  let i = 0;
  while (i < nodes.length) {
    const start = nodes[i]!.id;
    let count = 1;
    while (i + count < nodes.length && nodes[i + count]!.id === start + count) count++;
    if (result.length) result += ",";
    result += start;
    if (count > 1) result += ":" + count;
    i += count;
  }
  return result;
}
// The same text, made in a way the compiler does not look through.
function plainly(parts: unknown[]): string {
  return parts.map(part => String(part)).join("").split("").join("");
}

const ids = [0, 1, 7, 9, 10, 11, 99, 100, 101, 999, 1000, 1001, 9999, 10000, 65535, 99999, 100000, 999999, 1000000, 9999999, 10000000, 99999999, 100000000, 999999999, 1000000000, 2147483647, -1, -9, -10, -99, -100, -2147483648, -2147483647];
const nodes = ids.map((id, i) => new Node(id, "n" + i, id / 2, i % 3 ? id : undefined));
let wrong = 0;
function check(made: string, parts: unknown[]): void {
  const expected = plainly(parts);
  if (made !== expected || made.length !== expected.length) {
    if (wrong++ < 10) console.log("wrong text", JSON.stringify(made), JSON.stringify(expected));
  }
}

// Pairs of integers.
{
  const byPair = new Map<string, number>();
  const seen = new Set<string>();
  const record: Record<string, number> = {};
  let n = 0;
  for (const a of nodes) {
    for (const b of nodes) {
      const key = pairKey(a, b);
      check(key, [a.id, ",", b.id]);
      byPair.set(key, n);
      seen.add(a.id + ":" + b.id);
      record[a.id + "_" + b.id] = n;
      n++;
    }
  }
  let sum = 0;
  n = 0;
  for (const a of nodes) {
    for (const b of nodes) {
      if (byPair.get(a.id + "," + b.id) !== n) wrong++;
      if (byPair.get(plainly([a.id, ",", b.id])) !== n) wrong++;
      if (!byPair.has(a.id + "," + b.id) || byPair.has(a.id + ";" + b.id) || byPair.has(a.id + "," + b.id + ",")) wrong++;
      if (!seen.has(a.id + ":" + b.id) || !seen.has(plainly([a.id, ":", b.id])) || seen.has(a.id + ":" + b.id + "x")) wrong++;
      if (record[a.id + "_" + b.id] !== n || record[plainly([a.id, "_", b.id])] !== n) wrong++;
      sum = (sum + n * (a.id + "," + b.id).length) | 0;
      n++;
    }
    if (n % 300 === 0) collect();
  }
  console.log("pairs", byPair.size, seen.size, Object.keys(record).length, sum, wrong);
}

// Numbers that are not integers, or may be absent.
{
  const values = [0, -0, 0.5, -0.5, 1.5, 1e21, 1e-7, 123456789012, 2 ** 31, 2 ** 32, -(2 ** 31) - 1, 2 ** 53, NaN, Infinity, -Infinity, 1 / 3, 4294967295, 0.1 + 0.2];
  const map = new Map<string, number>();
  values.forEach((value, i) => {
    const node = new Node(i, "v", value, i % 2 ? value : undefined);
    const key = node.weight + "|" + node.next + "|" + node.id;
    check(key, [value, "|", i % 2 ? value : undefined, "|", i]);
    map.set(key, i);
    if (map.get(node.weight + "|" + node.next + "|" + node.id) !== i) wrong++;
    if (map.get(plainly([value, "|", i % 2 ? value : undefined, "|", i])) !== i) wrong++;
  });
  console.log("numbers", [...map.keys()].join(" "), wrong);
}

// Lists, by a loop.
{
  const cache = new Map<string, number>();
  for (let from = 0; from < nodes.length; from++) {
    for (let count = 0; count < 14 && from + count <= nodes.length; count++) {
      const list = nodes.slice(from, from + count);
      const key = listKey(list);
      check(key, [list.map(node => node.id).join(",")]);
      if (!cache.has(key)) cache.set(key, cache.size);
      if (cache.get(listKey(list)) === undefined) wrong++;
    }
  }
  const consecutive: Node[] = [];
  for (let i = 0; i < 40; i++) consecutive.push(new Node(i < 10 ? i : i < 20 ? i + 5 : i * 3, "c", 0, undefined));
  console.log("lists", cache.size, runsKey(consecutive), runsKey([]), JSON.stringify(listKey([])), listKey([nodes[3]!]), wrong);
  const single = new Map<string, number>();
  for (const node of nodes) single.set(listKey([node]), node.id);
  for (const node of nodes) if (single.get(String(node.id)) !== node.id || single.get("" + node.id) !== node.id || single.get(`${node.id}`) !== node.id) wrong++;
  console.log("one number", single.size, wrong);
}

// Strings among the parts: empty, long, ropes, parts of others, with characters beyond Latin-1.
{
  const texts = ["", "a", "ab", "name", "x".repeat(15), "x".repeat(16), "x".repeat(17), "x".repeat(40), "x".repeat(63), "x".repeat(64), "x".repeat(65), "x".repeat(200), "é", "Ā", "aĀb", "😀", "left" + nodes.length + "right", "0123456789".slice(2, 7), ("Ā" + "plain").slice(1)];
  const map = new Map<string, number>();
  let n = 0;
  for (const text of texts) {
    for (const node of nodes.slice(0, 12)) {
      const key = text + "#" + node.id;
      const other = node.id + text;
      const both = text + node.id + text;
      check(key, [text, "#", node.id]);
      check(other, [node.id, text]);
      check(both, [text, node.id, text]);
      map.set(key, n).set(other, n + 1).set(both, n + 2);
      if (map.get(text + "#" + node.id) !== n || map.get(plainly([text, "#", node.id])) !== n) wrong++;
      if (map.get(text + node.id + text) !== n + 2 || map.get(plainly([text, node.id, text])) !== n + 2) wrong++;
      n += 3;
    }
  }
  const empty = "";
  const only = "only";
  console.log("strings", map.size, wrong, (empty + only + empty) === only, map.get(empty + only + empty), (empty + empty).length);
}

// Keys of every length, so that every way of hashing is taken, found again as flat strings, ropes and parts of strings.
{
  const map = new Map<string, number>();
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let long = "";
  for (let i = 0; i < 12; i++) long += alphabet;
  for (let length = 0; length <= 200; length++) map.set(long.slice(0, length).split("").join(""), length);
  for (let length = 0; length <= 200; length++) {
    if (map.get(long.slice(0, length)) !== length) wrong++;
    if (map.get(long.substring(0, length >> 1) + long.substring(length >> 1, length)) !== length) wrong++;
    if (length && map.get(long.slice(1, length + 1)) !== undefined) wrong++;
    if (map.get(("Ā" + long).slice(1, length + 1)) !== length) wrong++;
  }
  console.log("lengths", map.size, wrong);
}

// Creating a key does not keep it alive, and the same key can be created again.
{
  const map = new Map<string, number>();
  for (let round = 0; round < 6; round++) {
    for (let i = 0; i < 20000; i++) {
      const a = nodes[i % nodes.length]!;
      const key = a.id + "/" + i;
      if (round === 0) map.set(key, i);
      else if (map.get(key) !== i) wrong++;
    }
    collect();
  }
  console.log("collected", map.size, wrong);
}
