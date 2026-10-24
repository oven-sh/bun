// A function that returns a fresh object hands its fields back in registers, and its caller reads them from the call. Where one test of a receiver's shape splits the caller into a fast and a slow copy, the call stands in both, and what follows the last access to the receiver is shared: the fields are then read behind the place where the two copies meet.
interface Item { id: number; weight: number; label: string; next: Item | null }
interface Crate { id: number; depth: number }
type Found = { x: number; y: number };
function hide(value: unknown): any { return value }
function make(i: number): Item { return { id: i + 0.5, weight: i + 1.5, label: "item" + i, next: null } }
function makeCrate(i: number): Crate { return { id: i + 0.25, depth: i + 2.25 } }
function grown(i: number): Item { const open = hide(makeCrate(i)); open.weight = i + 3.25; open.label = "crate" + i; open.next = null; return open }
let noise = 0;
function pad(k: number): void { for (let i = 0; i < 3; i++) noise = (noise * 31 + k + i) % 1000003 }
function pads(): void { pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); pad(7); pad(8); pad(9); pad(10); pad(11); pad(12) }
function maybe(i: number): Found | undefined { pads(); pads(); if (Math.floor(i) % 3 === 0) return undefined; return { x: i, y: noise } }
function always(i: number): Found { pads(); pads(); return { x: i * 2, y: noise } }
function readsAtOnce(item: Item): number {
  const found = maybe(item.id);
  if (found) return found.x + found.y;
  return item.weight + item.label.length;
}
function readsBehindALoop(item: Item): number {
  const found = maybe(item.id);
  if (found) {
    for (let i = 0; i < 4; i++) pad(i);
    return found.y - found.x + noise;
  }
  return item.weight + item.label.length;
}
function readsWhatIsAlwaysThere(item: Item): number {
  const found = always(item.id);
  if (found.x > 7) return found.x + found.y;
  return item.weight + item.label.length + found.y;
}
function storesBefore(item: Item): number {
  item.weight = item.id + 1;
  const found = maybe(item.weight);
  if (found) return found.x * 2 + found.y;
  return item.weight + item.label.length;
}
const kept: { [name: string]: (item: Item) => number } = { readsAtOnce, readsBehindALoop, readsWhatIsAlwaysThere, storesBefore };
for (const name in kept) {
  for (const create of [make, grown]) {
    const results: number[] = [];
    for (let i = 0; i < 7; i++) results.push(kept[name]!(create(i)));
    console.log(name, create.name, results.join(" "));
  }
}
