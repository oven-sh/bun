// A Map or Set that a loop over an array fills with one entry per turn behaves like any other: order, size, duplicates, deletions, growth after the loop and iteration during it.
const shell = globalThis as any;
const collect: (full: boolean) => void = shell.Bun ? (full: boolean) => shell.Bun.gc(full) : (full: boolean) => (full ? shell.fullGC() : shell.edenGC());
type Item = { name: string; rank: number };

function items(count: number, distinct: number): Item[] {
  const list: Item[] = [];
  for (let i = 0; i < count; i++) list.push({ name: "n" + (i % distinct), rank: i });
  return list;
}

function byName(list: Item[]): Map<string, Item> {
  const table = new Map<string, Item>();
  for (const item of list) table.set(item.name, item);
  return table;
}

function ranks(list: Item[]): Map<string, number> {
  const table = new Map<string, number>();
  for (let i = 0; i < list.length; i++) table.set(list[i].name, list[i].rank / 2);
  return table;
}

function names(list: Item[]): Set<string> {
  const set = new Set<string>();
  for (const item of list) set.add(item.name);
  return set;
}

function mixed(list: Item[]): Map<string, Item | number | undefined> {
  const table = new Map<string, Item | number | undefined>();
  for (const item of list) table.set(item.name, item.rank % 3 === 0 ? item : item.rank % 3 === 1 ? item.rank : undefined);
  return table;
}

function describe(table: Map<string, unknown>): string {
  let text = table.size + ":";
  let sum = 0;
  for (const [key, value] of table) {
    sum = (sum * 31 + key.length + (typeof value === "number" ? value * 2 : value ? (value as Item).rank : 7)) % 1000003;
    if (table.size <= 6) text += key + ",";
  }
  return text + sum;
}

for (const count of [0, 1, 2, 3, 4, 5, 7, 8, 9, 12, 13, 16, 17, 31, 32, 33, 63, 64, 65, 100, 255, 256, 257, 1000, 5000]) {
  for (const distinct of [1, 3, 8, 9, 1 << 20]) {
    const list = items(count, distinct);
    const table = byName(list);
    const set = names(list);
    let joined = 0;
    for (const name of set) joined = (joined * 7 + name.length) % 10007;
    console.log(count, distinct, describe(table), describe(ranks(list)), describe(mixed(list)), set.size, joined);
  }
}

function filledTwice(first: Item[], second: Item[]): Map<string, Item> {
  const table = new Map<string, Item>();
  for (const item of first) table.set(item.name, item);
  for (const item of second) table.set("second " + item.name, item);
  table.set("last", first[0] ?? second[0]);
  return table;
}
console.log(describe(filledTwice(items(10, 100), items(30, 100))), describe(filledTwice(items(0, 1), items(5, 2))), describe(filledTwice(items(40, 7), items(1, 1))));

function deletingOnTheWay(list: Item[]): Map<string, Item> {
  const table = new Map<string, Item>();
  for (let i = 0; i < list.length; i++) {
    table.set(list[i].name, list[i]);
    if (i % 3 === 2) table.delete(list[i - 1].name);
    if (i === 20) table.clear();
  }
  return table;
}
console.log(describe(deletingOnTheWay(items(19, 1000))), describe(deletingOnTheWay(items(50, 1000))), describe(deletingOnTheWay(items(50, 4))));

function growingList(list: Item[]): Map<string, Item> {
  const table = new Map<string, Item>();
  for (const item of list) {
    table.set(item.name, item);
    if (list.length < 40) list.push({ name: "pushed " + list.length, rank: list.length });
  }
  return table;
}
console.log(describe(growingList(items(3, 100))), describe(growingList(items(39, 100))));

function shrinkingList(list: Item[]): Map<string, Item> {
  const table = new Map<string, Item>();
  for (let i = 0; i < list.length; i++) {
    table.set(list[i].name, list[i]);
    if (i % 2) list.pop();
  }
  return table;
}
console.log(describe(shrinkingList(items(30, 100))));

function iteratedWhileFilled(list: Item[]): string {
  const table = new Map<string, Item>();
  table.set("first", { name: "first", rank: -1 });
  const walk = table.entries();
  let seen = "";
  for (const item of list) {
    table.set(item.name, item);
    const step = walk.next();
    if (!step.done) seen += step.value[0] + ";";
  }
  for (const [key] of walk) seen += "(" + key + ")";
  return seen.length + " " + seen.slice(0, 60);
}
console.log(iteratedWhileFilled(items(4, 100)), iteratedWhileFilled(items(25, 100)), iteratedWhileFilled(items(25, 3)));

function otherKeys(list: Item[]): number {
  const table = new Map<string, Item>();
  (table as Map<unknown, Item>).set(42, list[0]);
  for (const item of list) table.set(item.name, item);
  return table.size;
}
console.log(otherKeys(items(30, 100)), otherKeys(items(3, 100)));

function sharedTable(table: Map<string, Item>, list: Item[]) {
  for (const item of list) table.set(item.name + "!", item);
}
const shared = byName(items(6, 100));
for (let round = 0; round < 5; round++) sharedTable(shared, items(round * 9, 1000));
console.log(describe(shared));

const kept: Map<string, Item>[] = [];
for (let round = 0; round < 3000; round++) kept.push(byName(items(round % 37, 1000)));
collect(true);
let total = 0;
for (const table of kept) for (const [key, value] of table) total += key.length + value.rank;
console.log(total);
