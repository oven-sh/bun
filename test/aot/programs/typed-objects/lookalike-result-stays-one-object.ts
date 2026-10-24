// An object that was not created as the record type it is used as is read by name, and what the read yields is held to the type of the property. Whatever that is, a record, nothing, a plain
// object from elsewhere, a frozen one, one with accessors, another such object, two reads yield one and the same object, and a store through it is seen by whoever else holds it.
interface Item { id: number; weight: number; label: string; next: Item | null }
interface Crate { id: number; depth: number }
function hide(value: unknown): any { return value }
function make(i: number, next: Item | null = null): Item { return { id: i + 0.5, weight: i + 1.5, label: "item" + i, next } }
function makeCrate(i: number): Crate { return { id: i + 0.25, depth: i + 2.25 } }
function depthOf(crate: Crate): number { return crate.id + crate.depth }
const HiddenProxy: any = hide(Proxy), hiddenObject: any = hide(Object), hiddenJSON: any = hide(JSON);

const holders: { [name: string]: (next: any) => any } = {
  grown(next) { const crate = makeCrate(1); depthOf(crate); const open = hide(crate); open.weight = 3.25; open.label = "crate"; open.next = next; return open },
  proxied(next) { const target = hide(make(2)); target.next = next; return new HiddenProxy(target, {}) },
  heir(next) { const parent = hide(make(3)); parent.next = next; return hiddenObject.create(parent) },
  withAccessor(next) { return hiddenObject.defineProperty(hiddenJSON.parse('{"id":4.5,"weight":5.5,"label":"accessor"}'), "next", { get() { return next }, enumerable: true, configurable: true }) },
};
const yields: { [name: string]: () => any } = {
  nothing: () => null,
  record: () => make(10),
  parsed: () => hiddenJSON.parse('{"id":11.5,"weight":12.5,"label":"parsed","next":null}'),
  parsedInAnotherOrder: () => hiddenJSON.parse('{"next":null,"label":"other order","extra":true,"weight":13.5,"id":14.5}'),
  frozen: () => hiddenObject.freeze(hiddenJSON.parse('{"id":15.5,"weight":16.5,"label":"frozen","next":null}')),
  heirOfRecord: () => hiddenObject.create(make(17)),
  crate: () => { const crate = makeCrate(18); depthOf(crate); const open = hide(crate); open.weight = 19.25; open.label = "inner crate"; open.next = null; return open },
};

function describe(item: Item): string {
  const first = item.next, second = item.next;
  if (first === null || second === null)
    return "nothing " + (first === second);
  let stored: string;
  try { first.weight = 99.5; stored = "stored" } catch (error) { stored = (error as Error).name }
  return (first === second) + " " + stored + " " + second.weight + " " + second.label + " " + second.id;
}
function labels(item: Item): string { let text = ""; for (let at: Item | null = item; at !== null; at = at.next) text += at.label + ";"; return text }
const kept = { describe, labels };
(globalThis as { kept?: unknown }).kept = kept;

const lines: string[] = [];
for (let turn = 0; turn < 3; turn++) {
  for (const holderName in holders) {
    for (const yieldName in yields) {
      const yielded = yields[yieldName](), holder = holders[holderName](yielded);
      let said: string;
      try { said = describe(holder) + " | " + labels(holder) + " | " + (holder.next === yielded) + " " + (yielded === null ? "-" : yielded.weight) } catch (error) { said = "throws " + (error as Error).name }
      lines.push(turn + " " + holderName + " yields " + yieldName + ": " + said);
    }
  }
}
console.log(lines.join("\n"));
