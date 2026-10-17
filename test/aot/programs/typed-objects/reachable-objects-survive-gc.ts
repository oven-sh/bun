// Every kind of reference the garbage collector follows keeps its target alive: fields of typed objects, elements and named properties of arrays, strings, maps and closures.
const shell = globalThis as any;
const collect: (full: boolean) => void = shell.Bun ? (full: boolean) => shell.Bun.gc(full) : (full: boolean) => (full ? shell.fullGC() : shell.edenGC());
type Leaf = { id: number; label: string };
type Pair = { left: Leaf | undefined; right: Leaf | null; anything: unknown; count: number };
type Wide = {
  a?: Leaf; b?: Leaf; c?: Leaf; d?: Leaf; e?: Leaf; f?: Leaf; g?: Leaf; h?: Leaf;
  i?: Leaf; j?: Leaf; k?: Leaf; l?: Leaf; m?: Leaf; n?: Leaf; o?: Leaf; p?: Leaf;
};
interface List extends Array<Leaf> {
  owner?: Leaf;
  note?: string;
  position?: number;
  more?: Leaf[];
  last?: Leaf;
}
class Holder {
  first: Leaf;
  list: List;
  table = new Map<string, Leaf>();
  names = new Set<string>();
  next: Holder | undefined;
  read: () => number;
  constructor(seed: number, next: Holder | undefined) {
    this.first = leaf(seed);
    this.list = listOf(seed);
    this.next = next;
    const captured = leaf(seed + 7);
    this.read = () => captured.id + captured.label.length;
  }
}

let made = 0;
function leaf(seed: number): Leaf {
  made++;
  return { id: seed, label: "leaf " + seed };
}

function listOf(seed: number): List {
  const list: List = [];
  for (let i = 0; i < seed % 9; i++) list.push(leaf(seed * 10 + i));
  if (seed % 2) list.owner = leaf(seed + 1);
  if (seed % 3 === 0) list.note = "note " + seed + " of " + (seed % 9);
  if (seed % 5 === 0) {
    list.position = seed;
    list.more = [leaf(seed + 2), leaf(seed + 3)];
    list.last = leaf(seed + 4);
  }
  return list;
}

function pairOf(seed: number): Pair {
  return {
    left: seed % 2 ? leaf(seed) : undefined,
    right: seed % 3 ? leaf(seed + 1) : null,
    anything: seed % 4 === 0 ? leaf(seed + 2) : seed % 4 === 1 ? "text " + seed : seed % 4 === 2 ? [leaf(seed + 3)] : seed / 2,
    count: seed,
  };
}

function wideOf(seed: number): Wide {
  const wide: Wide = {};
  const names = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p"] as const;
  for (let i = 0; i < names.length; i++) {
    if ((seed >> (i % 7)) & 1) wide[names[i]] = leaf(seed + i);
  }
  return wide;
}

function sumLeaf(value: Leaf | undefined | null): number {
  return value ? value.id + value.label.length : 1;
}

function sumList(list: List): number {
  let sum = list.length;
  for (const item of list) sum += sumLeaf(item);
  sum += sumLeaf(list.owner) + (list.note ? list.note.length : 2) + (list.position ?? 3) + sumLeaf(list.last);
  if (list.more) for (const item of list.more) sum += sumLeaf(item);
  return sum;
}

function sumAnything(value: unknown): number {
  if (typeof value === "string") return value.length;
  if (typeof value === "number") return value;
  if (Array.isArray(value)) return sumLeaf(value[0] as Leaf);
  return sumLeaf(value as Leaf);
}

function sumWide(wide: Wide): number {
  return (
    sumLeaf(wide.a) + sumLeaf(wide.b) + sumLeaf(wide.c) + sumLeaf(wide.d) + sumLeaf(wide.e) + sumLeaf(wide.f) + sumLeaf(wide.g) + sumLeaf(wide.h) +
    sumLeaf(wide.i) + sumLeaf(wide.j) + sumLeaf(wide.k) + sumLeaf(wide.l) + sumLeaf(wide.m) + sumLeaf(wide.n) + sumLeaf(wide.o) + sumLeaf(wide.p)
  );
}

function garbage(rounds: number): number {
  let length = 0;
  for (let i = 0; i < rounds; i++) {
    const pair = pairOf(i);
    const list = listOf(i);
    length += sumList(list) + pair.count + ("dropped " + i).length;
  }
  return length;
}

let chain: Holder | undefined;
const pairs: Pair[] = [];
const wides: Wide[] = [];
const large: (Leaf | undefined)[] = new Array(40000);
const ropes: string[] = [];
const extended: (Leaf & { [name: string]: unknown })[] = [];
const loose: any[] = [];

for (let round = 0; round < 6; round++) {
  for (let i = 0; i < 1500; i++) {
    const seed = round * 1500 + i;
    chain = new Holder(seed, chain);
    chain.table.set("key " + seed, leaf(seed + 5));
    chain.table.set("other " + (seed % 11), leaf(seed + 6));
    chain.names.add("name " + (seed % 13));
    pairs.push(pairOf(seed));
    wides.push(wideOf(seed));
    large[(seed * 7) % large.length] = leaf(seed);
    if (seed % 50 === 0) {
      let rope = "";
      for (let k = 0; k < 20; k++) rope = rope + "piece " + (seed + k) + ";";
      ropes.push(rope);
      ropes.push(rope.substring(3, 40));
      const open = leaf(seed) as Leaf & { [name: string]: unknown };
      open["extra " + (seed % 3)] = leaf(seed + 8);
      extended.push(open);
      const untyped: any = leaf(seed);
      untyped.added = leaf(seed + 9);
      untyped["also " + (seed % 4)] = "text " + seed;
      loose.push(untyped);
    }
  }
  const dropped = garbage(4000);
  if (round % 2) collect(true);
  else collect(false);
  for (let i = 0; i < pairs.length; i += 3) pairs[i].left = leaf(i);
  for (let holder = chain, i = 0; holder && i < 400; holder = holder.next, i++) holder.list.owner = leaf(i);
  collect(true);

  let sum = dropped;
  for (let holder = chain; holder; holder = holder.next) {
    sum += sumLeaf(holder.first) + sumList(holder.list) + holder.read() + holder.names.size;
    for (const [key, value] of holder.table) sum += key.length + sumLeaf(value);
    for (const name of holder.names) sum += name.length;
  }
  for (const pair of pairs) sum += sumLeaf(pair.left) + sumLeaf(pair.right) + sumAnything(pair.anything) + pair.count;
  for (const wide of wides) sum += sumWide(wide);
  for (const item of large) sum += sumLeaf(item);
  for (const rope of ropes) sum += rope.length + rope.charCodeAt(rope.length - 2);
  for (const open of extended) for (const name in open) sum += name.length + (typeof open[name] === "object" ? sumLeaf(open[name] as Leaf) : 0);
  for (const untyped of loose) for (const name of Object.keys(untyped)) sum += name.length + (name === "added" ? sumLeaf(untyped[name]) : String(untyped[name]).length);
  console.log(round, sum, made);
}
