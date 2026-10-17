// What is reachable only through several rounds of marking constraints (a weak map's value is alive once its key is, and may itself be the next key), and what hangs on roots that change between collections, is all there afterwards.
const shell = globalThis as any;
const collect: (full: boolean) => void = shell.Bun ? (full: boolean) => shell.Bun.gc(full) : (full: boolean) => (full ? shell.fullGC() : shell.edenGC());
type Link = { id: number; tag: string };
type Holder = { first: Link; note: string };

const chain = new WeakMap<Link, Link>();
const crossA = new WeakMap<Link, Link>();
const crossB = new WeakMap<Link, Link>();
let latest: Link = { id: -1, tag: "none" };
let latestList: Link[] = [];
let latestText = "";
const holders: Holder[] = [];

function makeChain(length: number, seed: number): Link {
  const first: Link = { id: seed, tag: "c" + seed };
  let last = first;
  for (let i = 1; i < length; i++) {
    const next: Link = { id: seed + i, tag: "c" + (seed + i) };
    chain.set(last, next);
    last = next;
  }
  return first;
}

function makeCrossed(length: number, seed: number): Link {
  const first: Link = { id: seed, tag: "x" + seed };
  let last = first;
  for (let i = 1; i < length; i++) {
    const next: Link = { id: seed + i, tag: "x" + (seed + i) };
    (i % 2 ? crossA : crossB).set(last, next);
    last = next;
  }
  return first;
}

function walk(first: Link, ...maps: WeakMap<Link, Link>[]): string {
  let count = 0;
  let sum = 0;
  let text = 0;
  for (let at: Link | undefined = first; at; ) {
    count++;
    sum += at.id;
    text += at.tag.length;
    let next: Link | undefined;
    for (const map of maps) next ??= map.get(at);
    at = next;
  }
  return count + ":" + sum + ":" + text;
}

function garbage(n: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) {
    const o = { a: i, b: "g" + i, c: [i, i + 1] };
    total += o.b.length + o.c.length + String(i * 1.5).length + String(i + 2000).length;
  }
  return total;
}

const lines: string[] = [];
for (let round = 0; round < 12; round++) {
  const a = makeChain(3 + round * 5, round * 1000);
  const b = makeCrossed(4 + round * 3, round * 1000 + 500);
  holders.push({ first: a, note: "chain " + round }, { first: b, note: "crossed " + round });
  latest = { id: round, tag: "latest" + round };
  latestList = [latest, { id: round + 1, tag: "list" + round }];
  latestText = "text " + round + " " + (round * 0.25);
  const made = garbage(3000);
  collect(round % 3 === 2);
  chain.set(latest, latestList[1]);
  collect(false);
  lines.push(round + " " + made + " " + latest.tag + " " + latestList.map((l) => l.tag).join(",") + " " + latestText + " " + walk(latest, chain));
}
for (const holder of holders) lines.push(holder.note + " " + walk(holder.first, chain, crossA, crossB));

let resolved = 0;
async function later(n: number): Promise<number> {
  const kept: Link = { id: n, tag: "kept" + n };
  await null;
  collect(n % 2 === 0);
  await null;
  resolved++;
  return kept.id + kept.tag.length;
}
const results = await Promise.all([later(1), later(2), later(3), later(4)]);
lines.push("later " + results.join(",") + " " + resolved);
console.log(lines.join("\n"));
