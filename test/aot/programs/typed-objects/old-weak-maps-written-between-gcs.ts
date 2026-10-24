// A weak map or set that has survived collections and is then written to, or is left alone for many collections, answers as it should.
const shell = globalThis as any;
const collect: (full: boolean) => void = shell.Bun ? (full: boolean) => shell.Bun.gc(full) : (full: boolean) => (full ? shell.fullGC() : shell.edenGC());
type Key = { id: number };
type Value = { of: number; text: string };
const keys: Key[] = [];
for (let i = 0; i < 400; i++) keys.push({ id: i });
const quiet = new WeakMap<Key, Value>();
const busy = new WeakMap<Key, Value>();
const members = new WeakSet<Key>();
for (const key of keys) {
  quiet.set(key, { of: key.id, text: "q" + key.id });
  if (key.id % 2) members.add(key);
}
function churn(n: number): number {
  let t = 0;
  for (let i = 0; i < n; i++) t += ("c" + i).length + [i, i].length;
  return t;
}
function sumOf(map: WeakMap<Key, Value>): string {
  let count = 0;
  let sum = 0;
  let text = 0;
  for (const key of keys) {
    const value = map.get(key);
    if (!value) continue;
    count++;
    sum += value.of;
    text += value.text.length;
  }
  return count + ":" + sum + ":" + text;
}
collect(true);
collect(false);
const lines: string[] = [];
for (let round = 0; round < 16; round++) {
  const t = churn(2000);
  if (round % 4 !== 3) {
    for (let i = round; i < keys.length; i += 16) busy.set(keys[i], { of: i + round, text: "b" + round + "_" + i });
    const fresh: Key = { id: 1000 + round };
    busy.set(fresh, { of: -1, text: "gone" });
    members.add(fresh);
  }
  if (round === 5) for (let i = 0; i < keys.length; i += 3) busy.delete(keys[i]);
  if (round === 9) for (let i = 0; i < 40; i++) busy.set(keys[i], { of: 7, text: "again" + i });
  if (round === 11) {
    quiet.set(keys[3], { of: 3000, text: "late" });
    members.delete(keys[1]);
    members.add(keys[2]);
  }
  collect(round % 6 === 5);
  if (round % 2) collect(false);
  let inSet = 0;
  for (const key of keys) if (members.has(key)) inSet++;
  lines.push(round + " " + t + " " + sumOf(quiet) + " " + sumOf(busy) + " " + inSet);
}
keys.length = 200;
collect(true);
collect(false);
lines.push("half " + sumOf(quiet) + " " + sumOf(busy));
console.log(lines.join("\n"));
