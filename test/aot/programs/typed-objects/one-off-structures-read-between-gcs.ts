// Objects whose keys come out of the data have shapes that never come again. They pass the same sites as objects whose shapes come again at every round, and collections run in between. Every read must see the object it was given.
const shell = globalThis as any;
const collect: (full: boolean) => void = shell.Bun ? (full: boolean) => shell.Bun.gc(full) : (full: boolean) => (full ? shell.fullGC() : shell.edenGC());

function describe(value: any): number {
  let n = 0;
  if (value.then) n += 1;
  if (value.length) n += value.length;
  if (value.kind) n += value.kind.length;
  if (value.id) n += value.id & 7;
  if (value.extra) n += value.extra.id & 3;
  return n;
}
function unique(id: number): Record<string, unknown> {
  const bag: Record<string, unknown> = {};
  bag["a" + id] = id;
  bag["b" + id] = id + 1;
  if (id % 3 === 0) bag["c" + id] = id + 2;
  bag.kind = "bag";
  bag.id = id;
  return bag;
}
function recurring(id: number): Record<string, unknown> {
  const record: Record<string, unknown> = { kind: "record", id };
  if (id % 2) record.length = id % 5;
  if (id % 4 === 0) record.extra = { id: id + 1, kind: "extra" };
  return record;
}
function withoutPrototype(id: number): Record<string, unknown> {
  const bare: Record<string, unknown> = Object.create(null);
  bare.kind = "bare";
  bare.id = id;
  if (id % 2) bare["k" + (id % 3)] = id;
  return bare;
}

const kept: Record<string, unknown>[] = [];
let total = 0;
let wrong = 0;
for (let round = 0; round < 120; round++) {
  for (let i = 0; i < 150; i++) {
    const id = round * 150 + i + 1;
    const bag = unique(id);
    const record = recurring(id);
    const bare = withoutPrototype(id);
    total += describe(bag) + describe(record) + describe(bare);
    if (bag["a" + id] !== id || bag["b" + id] !== id + 1 || Object.keys(bag).length !== (id % 3 === 0 ? 5 : 4)) wrong++;
    if (record.id !== id || bare.id !== id) wrong++;
    if (i === round) kept.push(bag, record, bare);
  }
  collect(round % 40 === 39);
  for (let i = 0; i < kept.length; i += 3) {
    const id = kept[i].id as number;
    if (kept[i]["a" + id] !== id || kept[i + 1].id !== id || kept[i + 2].kind !== "bare") wrong++;
    total += describe(kept[i]) + describe(kept[i + 1]) + describe(kept[i + 2]);
  }
}
console.log(total, wrong, kept.length);
