// Old objects are stored to between collections, from one of them to thousands: each keeps what was stored into it, however many the engine has to remember.
const shell = globalThis as any;
const collect: (full: boolean) => void = shell.Bun ? (full: boolean) => shell.Bun.gc(full) : (full: boolean) => (full ? shell.fullGC() : shell.edenGC());
class Item {
  constructor(
    public id: number,
    public text: string,
  ) {}
}
class Holder {
  value: Item | null = null;
  other: Item | null = null;
  constructor(public id: number) {}
}

const holders: Holder[] = [];
for (let i = 0; i < 5000; i++) holders.push(new Holder(i));
collect(true);

function store(holder: Holder, id: number): void {
  holder.value = new Item(id, "t" + (id % 13));
  if (id % 3 === 0) holder.other = new Item(id + 1, "o" + (id % 7));
}

const counts = [1, 2, 509, 510, 511, 1019, 1020, 1021, 1531, 3000, 5000];
let wrong = 0;
let checked = 0;
let junk = 0;
for (let round = 0; round < 66; round++) {
  const count = counts[round % counts.length];
  const base = (round + 1) * 100000;
  for (let i = 0; i < count; i++) store(holders[(i * 7 + round) % holders.length], base + i);
  if (round % 4 === 1) {
    collect(false);
    for (let i = 0; i < count; i += 2) store(holders[(i * 7 + round) % holders.length], base + i);
  }
  for (let i = 0; i < 4000; i++) junk += new Item(i, "junk" + (i % 11)).text.length;
  collect(round % 6 === 5);
  for (let i = 0; i < 4000; i++) junk += new Item(i, "more" + (i % 5)).text.length;
  if (round % 5 === 2) collect(false);
  for (let i = 0; i < count; i++) {
    const holder = holders[(i * 7 + round) % holders.length];
    const id = base + i;
    checked++;
    if (holder.value === null || holder.value.id !== id || holder.value.text !== "t" + (id % 13)) wrong++;
    if (id % 3 === 0 && (holder.other === null || holder.other.id !== id + 1 || holder.other.text !== "o" + (id % 7))) wrong++;
  }
}
let kept = 0;
for (const holder of holders) if (holder.value !== null) kept += holder.value.id % 1000;
console.log(checked, wrong, kept, junk);
