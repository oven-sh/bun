// A record type that `any` is held to also admits objects that were not created as that type: a record of another type that was given the properties later, a Proxy, an object that inherits
// them. Such an object is read by name, and what the read yields is held to the type of the property. That may again be such an object, of any of these kinds.
interface Item { id: number; weight: number; label: string; next: Item | null }
interface Crate { id: number; depth: number }
function hide(value: unknown): any { return value }
function make(i: number, next: Item | null = null): Item { return { id: i + 0.5, weight: i + 1.5, label: "item" + i, next } }
function makeCrate(i: number): Crate { return { id: i + 0.25, depth: i + 2.25 } }
function depthOf(crate: Crate): number { return crate.id + crate.depth }
// What the text does not show to be a Proxy or an heir leaves the type as it is.
const HiddenProxy: any = hide(Proxy), hiddenObject: any = hide(Object);
function grown(i: number, next: Item | null = null): Item {
  const crate = makeCrate(i);
  depthOf(crate);
  const open = hide(crate);
  open.weight = i + 3.25; open.label = "crate" + i; open.next = null;
  const item: Item = open;
  item.next = next;
  return item;
}
function proxied(i: number, next: Item | null = null): Item { return new HiddenProxy(make(i, next), {}) }
function heir(i: number, next: Item | null = null): Item { return hiddenObject.create(make(i, next)) }
function labelOfNext(item: Item): string { const next = item.next; return next === null ? "end" : next.label + " " + next.id }
function labelAt(items: Item[], index: number): string { const item = items[index]; return item.label + " " + item.weight }
function isNext(item: Item, next: Item): boolean { return item.next === next }
const kept = { labelOfNext, labelAt, isNext };
(globalThis as { kept?: unknown }).kept = kept;
const makers = [make, grown, proxied, heir];
const lines: string[] = [];
function say(what: string, run: () => unknown): void {
  let said: string;
  try { said = String(run()) } catch (error) { said = "throws " + (error as Error).name }
  lines.push(what + ": " + said);
}
for (let turn = 0; turn < 3; turn++) {
  for (const outer of makers) {
    for (const inner of makers) {
      if (outer === grown && inner === proxied)
        continue;
      say(turn + " " + outer.name + " holds " + inner.name, () => labelOfNext(outer(turn, inner(turn + 1))));
      say(turn + " " + outer.name + " holds the very " + inner.name, () => { const next = inner(turn + 1); return isNext(outer(turn, next), next) });
    }
    say(turn + " an array from elsewhere holds " + outer.name, () => labelAt(hide([outer(turn)]), 0));
    say(turn + " an array holds " + outer.name, () => labelAt([outer(turn)], 0));
  }
}
console.log(lines.join("\n"));
