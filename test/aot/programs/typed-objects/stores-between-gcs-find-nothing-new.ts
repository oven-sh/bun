// A collection that is asked for while nothing has been allocated has nothing to find. Whatever the program stores around such collections is still seen by the next collection that has work.
const shell = globalThis as any;
const collect: (full: boolean) => void = shell.Bun ? (full: boolean) => shell.Bun.gc(full) : (full: boolean) => (full ? shell.fullGC() : shell.edenGC());
class Item {
  next: Item | null = null;
  other: Item | null = null;
  #hidden: Item | null = null;
  constructor(
    public id: number,
    public name: string,
  ) {}
  hide(item: Item | null): void {
    this.#hidden = item;
  }
  hidden(): Item | null {
    return this.#hidden;
  }
}

let current: Item | null = null;
let spare: Item | null = null;
const old: Item[] = [];
const slots: (Item | null)[] = new Array(4000).fill(null);
const byName = new Map<string, Item>();
const members = new Set<Item>();
const notes = new WeakMap<Item, Item>();
const readers: (() => Item | null)[] = [];
const writers: ((item: Item | null) => void)[] = [];
for (let i = 0; i < 4000; i++) {
  const item = new Item(i, "old" + i);
  old.push(item);
  if (i % 40 === 0) {
    let held: Item | null = null;
    readers.push(() => held);
    writers.push((value) => {
      held = value;
    });
  }
}
collect(true);
collect(false);
collect(false);

let wrong = 0;
let seen = 0;
function expect(item: Item | null, id: number, name: string): void {
  seen++;
  if (!item || item.id !== id || item.name !== name) wrong++;
}
function churn(round: number): number {
  let length = 0;
  for (let i = 0; i < 6000; i++) length += new Item(i, "junk" + ((i * 31 + round) % 977)).name.length;
  return length;
}

let churned = 0;
for (let round = 0; round < 40; round++) {
  for (let i = 0; i < old.length; i++) {
    old[i].next = old[(i * 7 + round) % old.length];
    slots[i] = old[(i * 3 + round) % old.length];
  }
  for (let i = 0; i < writers.length; i++) writers[i](old[(i + round) % old.length]);
  current = old[round];
  collect(false);
  collect(false);
  collect(false);
  for (let i = round % 3; i < old.length; i += 3) {
    old[i].next = new Item(-i - round, "next" + i);
    old[i].hide(new Item(i + round, "hidden" + i));
    slots[i] = new Item(i * 2 + round, "slot" + i);
  }
  for (let i = 0; i < writers.length; i++) writers[i](new Item(round * 1000 + i, "held" + i));
  current = new Item(round, "current" + round);
  byName.set("k" + round, new Item(round, "mapped" + round));
  members.add(new Item(round, "member" + round));
  notes.set(old[round], new Item(round, "note" + round));
  collect(false);
  spare = current;
  collect(false);
  collect(false);
  churned += churn(round);
  collect(false);
  collect(false);
  for (let i = round % 3; i < old.length; i += 3) {
    expect(old[i].next, -i - round, "next" + i);
    expect(old[i].hidden(), i + round, "hidden" + i);
    expect(slots[i], i * 2 + round, "slot" + i);
  }
  for (let i = 0; i < readers.length; i++) expect(readers[i](), round * 1000 + i, "held" + i);
  expect(current, round, "current" + round);
  expect(spare, round, "current" + round);
  expect(byName.get("k" + round) ?? null, round, "mapped" + round);
  expect(notes.get(old[round]) ?? null, round, "note" + round);
  if (round % 13 === 12) {
    collect(true);
    collect(false);
    collect(false);
  }
}
let inSet = 0;
for (const member of members) inSet += member.id + member.name.length;
console.log("stores", seen, wrong, churned, inSet, byName.size);

const references: WeakRef<Item>[] = [];
let finalized = 0;
const registry = new FinalizationRegistry<number>(() => {
  finalized++;
});
for (let i = 0; i < 200; i++) {
  references.push(new WeakRef(old[i * 5]));
  registry.register(old[i * 5], i);
}
for (let tick = 0; tick < 6; tick++) {
  await new Promise<void>((resolve) => setTimeout(resolve, 1));
  collect(false);
  collect(false);
  old[tick].other = old[tick + 1];
  collect(false);
}
let alive = 0;
for (let i = 0; i < references.length; i++) if (references[i].deref() === old[i * 5]) alive++;
console.log("weak references to what is alive", alive, finalized);

const pending: Promise<Item>[] = [];
for (let i = 0; i < 50; i++) {
  pending.push(
    new Promise<Item>((resolve) => {
      setTimeout(() => resolve(new Item(i, "late" + i)), 1 + (i % 3));
    }),
  );
}
collect(false);
collect(false);
collect(false);
let late = 0;
for (const item of await Promise.all(pending)) late += item.id + item.name.length;
collect(false);
collect(false);
console.log("promises", late);
