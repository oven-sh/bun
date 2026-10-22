// Evacuating Auxiliary blocks after each full collection must move only real butterflies: offset 8 of a compiled object or a slim closure is not a butterfly pointer.
const count = 2000;
const rounds = 3;
const bagSize = 12;

class Leaf {
  weight: number;
  constructor(weight: number) {
    this.weight = weight;
  }
}

class Wide {
  seed: number;
  n0?: number; n1?: number; n2?: number; n3?: number; n4?: number; n5?: number; n6?: number; n7?: number;
  s0?: string; s1?: string; s2?: string; s3?: string; s4?: string; s5?: string; s6?: string; s7?: string;
  l0?: Leaf; l1?: Leaf; l2?: Leaf; l3?: Leaf; l4?: Leaf; l5?: Leaf; l6?: Leaf; l7?: Leaf;
  constructor(seed: number) {
    this.seed = seed;
  }
  fill() {
    const seed = this.seed;
    this.n0 = seed + 0.5; this.n1 = seed + 1.5; this.n2 = seed + 2.5; this.n3 = seed + 3.5;
    this.n4 = seed + 4.5; this.n5 = seed + 5.5; this.n6 = seed + 6.5; this.n7 = seed + 7.5;
    this.s0 = String(seed); this.s1 = String(seed + 1); this.s2 = String(seed + 2); this.s3 = String(seed + 3);
    this.s4 = String(seed + 4); this.s5 = String(seed + 5); this.s6 = String(seed + 6); this.s7 = String(seed + 7);
    this.l0 = new Leaf(seed); this.l1 = new Leaf(seed + 1); this.l2 = new Leaf(seed + 2); this.l3 = new Leaf(seed + 3);
    this.l4 = new Leaf(seed + 4); this.l5 = new Leaf(seed + 5); this.l6 = new Leaf(seed + 6); this.l7 = new Leaf(seed + 7);
  }
  checksum(): number {
    if (this.n0 === undefined) return this.seed;
    const numbers = this.n0 + this.n1! + this.n2! + this.n3! + this.n4! + this.n5! + this.n6! + this.n7!;
    const strings = Number(this.s0) + Number(this.s1) + Number(this.s2) + Number(this.s3) + Number(this.s4) + Number(this.s5) + Number(this.s6) + Number(this.s7);
    const leaves = this.l0!.weight + this.l1!.weight + this.l2!.weight + this.l3!.weight + this.l4!.weight + this.l5!.weight + this.l6!.weight + this.l7!.weight;
    return numbers + strings + leaves;
  }
}

function createWide(seed: number): Wide {
  const wide = new Wide(seed);
  if (seed % 8) wide.fill();
  return wide;
}

function createReader(seed: number): () => number {
  const leaf = new Leaf(seed);
  return () => leaf.weight;
}

function createTaggedReader(seed: number): any {
  const leaf = new Leaf(seed);
  const reader: any = () => leaf.weight;
  reader.tag = seed;
  reader.label = String(seed + 1);
  return reader;
}

function createBag(seed: number): any {
  const bag: any = {};
  for (let i = 0; i < bagSize; i++) bag["p" + i] = seed + i;
  return bag;
}

function bagChecksum(bag: any): number {
  let total = 0;
  for (let i = 0; i < bagSize; i++) total += bag["p" + i];
  return total;
}

function createList(seed: number): any {
  const list: any = [seed, seed + 1, seed + 2];
  list.label = String(seed + 3);
  list.total = 3 * seed + 3;
  return list;
}

function populate<T>(values: T[], create: (seed: number) => T, firstSeed: number) {
  for (let i = 0; i < count; i++) values.push(create(firstSeed + i));
}

function keepEveryTenth<T>(values: T[]): T[] {
  return values.filter((_, index) => index % 10 === 0);
}

function sum<T>(values: T[], checksum: (value: T) => number): number {
  let total = 0;
  for (const value of values) total += checksum(value);
  return total;
}

let wides: Wide[] = [];
let readers: (() => number)[] = [];
let taggedReaders: any[] = [];
let bags: any[] = [];
let lists: any[] = [];

for (let round = 0; round <= rounds; round++) {
  if (round > 0) {
    wides = keepEveryTenth(wides);
    readers = keepEveryTenth(readers);
    taggedReaders = keepEveryTenth(taggedReaders);
    bags = keepEveryTenth(bags);
    lists = keepEveryTenth(lists);
    Bun.gc(true);
  }
  const firstSeed = round * count;
  populate(wides, createWide, firstSeed);
  populate(readers, createReader, firstSeed);
  populate(taggedReaders, createTaggedReader, firstSeed);
  populate(bags, createBag, firstSeed);
  populate(lists, createList, firstSeed);
}

console.log("class instances", wides.length, sum(wides, wide => wide.checksum()));
console.log("called closures", readers.length, sum(readers, reader => reader()));
console.log("closures with properties", taggedReaders.length, sum(taggedReaders, reader => reader() + reader.tag + Number(reader.label)));
console.log("plain objects", bags.length, sum(bags, bagChecksum));
console.log("arrays with named properties", lists.length, sum(lists, list => list[0] + list[1] + list[2] + list.total + Number(list.label)));
