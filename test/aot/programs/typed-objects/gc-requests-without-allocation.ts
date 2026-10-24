// A collection may be asked for at any time: right behind another one with nothing allocated in between, behind stores that only rearrange old objects, behind a single allocation. What is reachable stays, whatever the order.
const shell = globalThis as any;
const collect: (full: boolean) => void = shell.Bun ? (full: boolean) => shell.Bun.gc(full) : (full: boolean) => (full ? shell.fullGC() : shell.edenGC());
type Node = { id: number; name: string; next: Node | null; list: Node[] };
const kept: Node[] = [];
for (let i = 0; i < 20000; i++) kept.push({ id: i, name: "n" + i, next: null, list: [] });
function check(label: string): void {
  let sum = 0;
  for (const node of kept) {
    sum += node.id + node.name.length + node.list.length;
    if (node.next) sum += node.next.id;
    for (const other of node.list) sum += other.name.length;
  }
  console.log(label, kept.length, sum);
}
collect(true);
for (let i = 0; i < 200; i++) collect(false);
check("nothing allocated");
for (let round = 0; round < 50; round++) {
  for (let i = round; i < kept.length; i += 50) kept[i].next = kept[(i * 7 + round) % kept.length];
  collect(false);
  collect(false);
}
check("old objects rearranged");
for (let round = 0; round < 60; round++) {
  const fresh: Node = { id: 100000 + round, name: "fresh" + round, next: kept[round], list: [] };
  kept[round * 11].next = fresh;
  collect(false);
  collect(false);
  collect(false);
  kept[round * 13].list.push(fresh);
  collect(false);
}
check("one allocation at a time");
const weak = new WeakMap<Node, Node>();
const map = new Map<string, Node>();
for (let round = 0; round < 40; round++) {
  weak.set(kept[round], { id: round, name: "w" + round, next: null, list: [] });
  collect(false);
  collect(false);
  map.set("k" + round, weak.get(kept[round])!);
  collect(false);
  if (round % 10 === 9) {
    collect(true);
    collect(false);
    collect(true);
    collect(true);
  }
}
let names = 0;
for (let round = 0; round < 40; round++) names += weak.get(kept[round])!.name.length + map.get("k" + round)!.id;
console.log("weak map and map", names);
let text = "";
for (let round = 0; round < 30; round++) {
  text += String(round * 1.5);
  collect(false);
  collect(false);
}
console.log("strings", text.length, text.slice(-12));
const buffers: Uint8Array[] = [];
for (let round = 0; round < 20; round++) {
  buffers.push(new Uint8Array(100000).fill(round));
  collect(false);
  collect(false);
}
console.log("buffers", buffers.reduce((sum, b) => sum + b[99999] + b.length, 0));
await new Promise<void>((resolve) => setTimeout(resolve, 5));
collect(false);
collect(false);
check("behind a timer");
