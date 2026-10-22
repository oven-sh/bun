// A record type that `any` is held to also admits objects that were not created as that type: a record of another type that was given the properties later, a Proxy, an object that inherits
// them, an object with accessors. Compiled code tests the shape of such a receiver. An object that was created as the type stays one for good, so one test covers the accesses that follow it,
// calls between them included. Whatever fails the test is served by name from there on: every trap, getter and setter runs once, in the order of the source.
// IRT= 1 readsAroundCall TypeTest v[0-9]+ testedType=L[0-9]+!
// IRT= 1 storesAroundCall TypeTest v[0-9]+ testedType=L[0-9]+!
// IRT= 2 twoReceivers TypeTest v[0-9]+ testedType=L[0-9]+!
// IRT= 1 walk TypeTest v[0-9]+ testedType=L[0-9]+!
// IRT= 1 caught TypeTest v[0-9]+ testedType=L[0-9]+!
// IRT= 1 whileMaking TypeTest v[0-9]+ testedType=L[0-9]+!
// IRT= 1 ofNothing TypeTest v[0-9]+ testedType=L[0-9]+!
// IRT= 2 throughNext TypeTest v[0-9]+ testedType=L[0-9]+!
// IRT= 1 inClosure TypeTest v[0-9]+ testedType=L[0-9]+!
// IRT= 2 deep TypeTest v[0-9]+ testedType=L[0-9]+!
// IRT= 2 farApart TypeTest v[0-9]+ testedType=L[0-9]+!
// IRT= 0 readsLoose TypeTest v[0-9]+ testedType=L[0-9]+!
interface Item { id: number; weight: number; label: string; next: Item | null }
interface Crate { id: number; depth: number }
interface Wider extends Item { extra?: number; more?: string }
function hide(value: unknown): any { return value }
function make(i: number, next: Item | null = null): Item { return { id: i + 0.5, weight: i + 1.5, label: "item" + i, next } }
function makeWider(i: number): Wider { return { id: i + 0.5, weight: i + 1.5, label: "wider" + i, next: null, extra: i + 5.5, more: "more" } }
function makeCrate(i: number): Crate { return { id: i + 0.25, depth: i + 2.25 } }
function depthOf(crate: Crate): number { return crate.id + crate.depth }
// What the text does not show to be a Proxy or an heir leaves the type as it is.
const HiddenProxy: any = hide(Proxy), hiddenObject: any = hide(Object);

let log: string[] = [];
function grown(i: number, next: Item | null = null): Item {
  const crate = makeCrate(i);
  depthOf(crate);
  const open = hide(crate);
  open.weight = i + 3.25; open.label = "crate" + i; open.next = next;
  return open;
}
function proxied(i: number, next: Item | null = null): Item {
  return new HiddenProxy(make(i, next), {
    get(target: any, key: string | symbol, receiver: any) { log.push("get " + String(key)); return Reflect.get(target, key, receiver) },
    set(target: any, key: string | symbol, value: any, receiver: any) { log.push("set " + String(key)); return Reflect.set(target, key, value, receiver) },
  });
}
function heir(i: number, next: Item | null = null): Item { return hiddenObject.create(make(i, next)) }
function withAccessors(i: number, next: Item | null = null): Item {
  const made: any = hiddenObject.create(hiddenObject.prototype);
  const held: { [name: string]: unknown } = { id: i + 0.75, weight: i + 1.75, label: "accessors" + i, next };
  for (const name of ["id", "weight", "label", "next"])
    hiddenObject.defineProperty(made, name, { get() { log.push("get " + name); return held[name] }, set(value: unknown) { log.push("set " + name); held[name] = value }, enumerable: true, configurable: true });
  return made;
}
const makers: { [name: string]: (i: number, next?: Item | null) => Item } = { make, makeWider, grown, proxied, heir, withAccessors };

type Visit = (item: any) => unknown;
const visits: { [name: string]: Visit } = {
  nothing: () => 0,
  stores: item => { item.id = 90.5; item.weight = 91.5; return 1 },
  storesLabel: item => { item.label = "changed"; return 2 },
  unlinks: item => { item.next = null; return 3 },
  throws: () => { throw new RangeError("visit") },
  reparents: item => { hiddenObject.setPrototypeOf(item, hide({ weight: 55.5, label: "inherited", id: 56.5 })); return 4 },
  freezes: item => { hiddenObject.freeze(item); return 5 },
  widens: item => { const wider: Wider = item; wider.extra = 6.5; wider.more = "given"; return wider.extra + wider.more },
};

function readsAroundCall(item: Item, visit: Visit): string { const before = item.id; const got = visit(item); return before + " " + got + " " + item.id + " " + item.weight + " " + item.label }
function storesAroundCall(item: Item, visit: Visit): string { item.id = 7.5; visit(item); item.weight = 8.5; visit(item); return item.id + " " + item.weight }
function twoReceivers(a: Item, b: Item, visit: Visit): string { const first = a.id + b.id; visit(a); const second = a.weight + b.weight; visit(b); return first + " " + second + " " + a.label + b.label }
function walk(first: Item | null, visit: Visit): string {
  let sum = 0, labels = "";
  for (let item = first; item !== null; item = item.next) { sum += item.id; visit(item); sum += item.weight; labels += item.label + "," }
  return sum + " " + labels;
}
function inBranches(item: Item, visit: Visit, which: number): string {
  let text = "" + item.id;
  if (which === 0) { visit(item); text += item.weight } else if (which === 1) text += item.label; else { text += visit(item); text += item.label + item.weight }
  return text + " " + item.id;
}
function caught(item: Item, visit: Visit): string {
  let text = item.label;
  try { visit(item); text += item.id } catch (error) { text += (error as Error).name + item.weight } finally { text += item.label }
  return text + item.id;
}
function whileMaking(item: Item, visit: Visit): string { const made = { first: item.id, second: visit(item), third: item.weight, fourth: [item.label, visit(item), item.id] }; return JSON.stringify(made) }
function ofNothing(item: Item | null | undefined, visit: Visit): string { const got = visit(item); return got + " " + item!.id + item!.weight }
function throughNext(item: Item, visit: Visit): string { const next = item.next; if (next === null) return "end " + item.id; const before = next.id; visit(next); visit(item); return before + " " + next.id + " " + next.label + " " + item.id }
function inClosure(item: Item, visit: Visit): string { const read = () => item.id + item.weight; const before = read(); visit(item); return before + " " + read() + " " + item.label }
async function aroundAwait(item: Item, visit: Visit): Promise<string> { const before = item.id; await null; visit(item); const middle = item.id; await null; return before + " " + middle + " " + item.weight + item.label }
function* aroundYield(item: Item, visit: Visit): Generator<string> { yield "" + item.id; visit(item); yield item.id + " " + item.weight; yield item.label }
function deep(item: Item, visit: Visit, depth: number): string { const before = item.id; const below = depth ? deep(item.next ?? item, visit, depth - 1) : String(visit(item)); return before + ":" + item.id + ":" + item.label + "(" + below + ")" }

// What lies between two accesses is there twice, once for each answer of the test. Where that is more than the test saves, the accesses behind it have a test of their own.
function farApart(item: Item, visit: Visit): string { const before = item.id + item.weight; visit(item); visit(item); visit(item); visit(item); visit(item); visit(item); visit(item); visit(item); visit(item); visit(item); visit(item); visit(item); visit(item); visit(item); visit(item); visit(item); visit(item); visit(item); visit(item); visit(item); visit(item); visit(item); visit(item); visit(item); visit(item); visit(item); visit(item); visit(item); visit(item); visit(item); visit(item); visit(item); visit(item); visit(item); visit(item); visit(item); visit(item); visit(item); visit(item); visit(item); visit(item); visit(item); visit(item); visit(item); visit(item); visit(item); visit(item); visit(item); return before + " " + item.label + item.id }
// The text shows a Proxy that is taken for a Loose, so an object that was created as one may be made to stop being one: every access asks anew.
interface Loose { id: number; weight: number }
function makeLoose(i: number): Loose { return { id: i + 0.5, weight: i + 1.5 } }
function proxiedLoose(i: number): Loose { return new Proxy(makeLoose(i), {}) }
function readsLoose(loose: Loose, visit: Visit): string { const before = loose.id; visit(loose); return before + " " + loose.id + " " + loose.weight }

const kept = { farApart, readsLoose, readsAroundCall, storesAroundCall, twoReceivers, walk, inBranches, caught, whileMaking, ofNothing, throughNext, inClosure, aroundAwait, aroundYield, deep };
(globalThis as { kept?: unknown }).kept = kept;
const byTable: { [name: string]: (...rest: any[]) => unknown } = kept;

const lines: string[] = [];
function say(what: string, run: () => unknown): void {
  log = [];
  let said: string;
  try { said = String(run()) } catch (error) { said = "throws " + (error as Error).name }
  lines.push(what + ": " + said + (log.length ? " [" + log.join(" ") + "]" : ""));
}

async function main(): Promise<void> {
  for (let turn = 0; turn < 3; turn++) {
    for (const makerName in makers) {
      const maker = makers[makerName];
      for (const visitName in visits) {
        const visit = visits[visitName], what = turn + " " + makerName + " " + visitName + " ";
        say(what + "reads", () => readsAroundCall(maker(turn), visit));
        say(what + "stores", () => storesAroundCall(maker(turn), visit));
        say(what + "far apart", () => farApart(maker(turn), visit));
        if (visitName !== "widens") say(what + "loose", () => readsLoose(makeLoose(turn), visit) + " | " + readsLoose(proxiedLoose(turn), visit));
        say(what + "first of two", () => twoReceivers(maker(turn), make(turn + 1), visit));
        say(what + "second of two", () => twoReceivers(make(turn + 1), maker(turn), visit));
        say(what + "walk, at the head", () => walk(maker(turn, make(turn + 1, make(turn + 2))), visit));
        say(what + "walk, in the middle", () => walk(make(turn, maker(turn + 1, make(turn + 2))), visit));
        say(what + "walk, at the end", () => walk(make(turn, make(turn + 1, maker(turn + 2))), visit));
        for (let which = 0; which < 3; which++)
          say(what + "branch " + which, () => inBranches(maker(turn), visit, which));
        say(what + "caught", () => caught(maker(turn), visit));
        say(what + "while making", () => whileMaking(maker(turn), visit));
        say(what + "may be nothing", () => ofNothing(maker(turn), visit));
        say(what + "through next", () => throughNext(make(turn, maker(turn + 1)), visit) + " | " + throughNext(maker(turn, make(turn + 1)), visit) + " | " + throughNext(maker(turn), visit));
        say(what + "in a closure", () => inClosure(maker(turn), visit));
        say(what + "deep", () => deep(make(turn, maker(turn + 1, make(turn + 2))), visit, 2));
        say(what + "yields", () => [...aroundYield(maker(turn), visit)].join(" / "));
        say(what + "reads, by the table", () => byTable.readsAroundCall(maker(turn), visit));
        say(what + "walk, by the table", () => byTable.walk(make(turn, maker(turn + 1, make(turn + 2))), visit));
        log = [];
        let awaited: string;
        try { awaited = await aroundAwait(maker(turn), visit) } catch (error) { awaited = "throws " + (error as Error).name }
        lines.push(what + "awaits: " + awaited + (log.length ? " [" + log.join(" ") + "]" : ""));
      }
    }
    say(turn + " null", () => ofNothing(null, visits.nothing));
    say(turn + " undefined", () => ofNothing(undefined, visits.nothing));
    const same = grown(turn);
    say(turn + " identity", () => { const held = make(turn, same); return (held.next === same) + " " + (hide(held).next === hide(same)) + " " + depthOf(hide(same)) });
  }
  console.log(lines.join("\n"));
}
main();
