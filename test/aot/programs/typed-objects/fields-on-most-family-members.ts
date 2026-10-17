// A family of record types. Most members have `marks`, `owner`, `label`, `ratio` and `done`; two members have none of them.
// Code reads them behind written casts from every member, whatever the object really is.

interface Item { kind: number; id: number; }
interface Owner { name: string; }
interface Box extends Item { marks: number; owner: Owner | undefined; label: string; ratio: number; done: boolean; width: number; }
interface Bag extends Item { marks: number; owner: Owner | undefined; label: string; ratio: number; done: boolean; depth: number; }
interface Jar extends Item { marks: number; owner: Owner | undefined; label: string; ratio: number; done: boolean; lid?: string; }
interface Tin extends Item { marks: number; owner: Owner | undefined; label: string; ratio: number; done: boolean; }
interface Peg extends Item { length: number; }
interface Pin extends Item { sharp: boolean; }
type Marked = Box | Bag | Jar | Tin;

const lines: string[] = [];
function say(...parts: unknown[]) { lines.push(parts.map(part => typeof part === "object" && part !== null ? JSON.stringify(part) : Object.is(part, -0) ? "-0" : String(part)).join(" ")); }

let nextId = 1;
const ann: Owner = { name: "ann" };
function makeItem(kind: number): Item { const item: Item = { kind, id: nextId++ }; return item; }
function fill(item: Marked, marks: number) { item.marks = marks; item.owner = marks % 2 ? ann : undefined; item.label = "l" + marks; item.ratio = marks / 4; item.done = marks % 3 === 0; }
function makeBox(marks: number): Box { const box = makeItem(1) as Box; fill(box, marks); box.width = 2; return box; }
function makeBag(marks: number): Bag { const bag = makeItem(2) as Bag; fill(bag, marks); bag.depth = 3; return bag; }
function makeJar(marks: number): Jar { const jar = makeItem(3) as Jar; fill(jar, marks); return jar; }
function makeTin(marks: number): Tin { const tin: Tin = { kind: 4, id: nextId++, marks, owner: ann, label: "tin", ratio: 0.5, done: true }; return tin; }
function makePeg(length: number): Peg { const peg = makeItem(5) as Peg; peg.length = length; return peg; }
function makePin(sharp: boolean): Pin { const pin = makeItem(6) as Pin; pin.sharp = sharp; return pin; }

function marksOf(item: Item): number { return item.kind <= 4 ? (item as Marked).marks : 0; }
function marksWhatever(item: Item): number | undefined { return (item as Marked).marks; }
function ownerWhatever(item: Item): Owner | undefined { return (item as Marked).owner; }
function labelWhatever(item: Item): string | undefined { return (item as Marked).label; }
function ratioWhatever(item: Item): number | undefined { return (item as Marked).ratio; }
function doneWhatever(item: Item): boolean | undefined { return (item as Marked).done; }
function show(what: string, item: Item) {
    say(what, item.kind, marksOf(item), marksWhatever(item), ownerWhatever(item)?.name, labelWhatever(item), ratioWhatever(item), doneWhatever(item));
}

const items: Item[] = [makeBox(1), makeBag(2), makeJar(3), makeTin(4), makePeg(5), makePin(true), makeItem(7), makeBox(-1073741825), makeBag(2147483647), makeJar(0)];
for (const item of items) show("made", item);

let sum = 0;
for (let round = 0; round < 300; round++) for (let i = 0; i < items.length; i++) sum += marksOf(items[i]) & 0xff;
say("sum", sum);

// A bare item that has not become anything yet, then becomes a member that has the fields, one by one.
const late = makeItem(7);
show("bare", late);
const lateBox = late as Box;
show("cast", late);
lateBox.marks = 9;
show("marks", late);
lateBox.owner = ann; lateBox.label = "late"; lateBox.ratio = -0; lateBox.done = false;
show("filled", late);
say("keys", Object.keys(late).join(), JSON.stringify(late));

// Numbers of every form.
for (const value of [0, -0, 1.5, NaN, Infinity, -1073741824, -1073741825, 1073741824, 2147483648, -2147483649, 1e300]) {
    const box = makeBox(1);
    box.marks = value; box.ratio = value;
    say("number", marksWhatever(box), ratioWhatever(box), marksOf(box) | 0);
}

// Members without the fields are given properties of those names by code that knows nothing of their types.
function poke(target: object, key: string, value: unknown) { (target as Record<string, unknown>)[key] = value; }
function peek(target: object, key: string): unknown { return (target as Record<string, unknown>)[key]; }
function drop(target: object, key: string) { return Reflect.deleteProperty(target, key); }
const peg = makePeg(1);
show("peg", peg);
say("in", "marks" in peg, Object.hasOwn(peg, "marks"), peek(peg, "marks"));
poke(peg, "marks", 77);
show("peg number", peg);
say("in", "marks" in peg, Object.hasOwn(peg, "marks"), Object.keys(peg).join());
poke(peg, "label", "named"); poke(peg, "owner", ann); poke(peg, "ratio", 2.5); poke(peg, "done", true);
show("peg all", peg);
say("keys", Object.keys(peg).join(), JSON.stringify(peg));
say("dropped", drop(peg, "marks"));
show("peg deleted", peg);
say("in", "marks" in peg, Object.keys(peg).join());
const pin = makePin(false);
Object.defineProperty(pin, "marks", { value: 5, writable: true, enumerable: false, configurable: true });
show("pin hidden", pin);
say("keys", Object.keys(pin).join(), JSON.stringify(pin));
const copy = { ...makePeg(3) };
say("copy", Object.keys(copy).join(), JSON.stringify(copy), JSON.stringify({ ...makeBox(3) }));
const assigned = makePin(true);
Object.assign(assigned, { marks: 12 });
show("assigned", assigned);
say("entries", JSON.stringify(Object.entries(makePeg(2))), JSON.stringify(Object.entries(makeTin(2))));
for (const key in makePin(true)) say("for in", key);
const jar = makeJar(5);
jar.lid = "tight";
say("dropped", drop(jar, "lid"), jar.lid, Object.keys(jar).join());
show("jar without lid", jar);

// Stores through the cast.
const target = makeItem(3);
(target as Jar).marks = 4;
(target as Jar).lid = "on";
show("stored", target);
say("keys", Object.keys(target).join());
const pegSeenAsJar = makePeg(6) as Item as Jar;
pegSeenAsJar.marks = 31;
show("stored to a peg", pegSeenAsJar);
say("keys", Object.keys(pegSeenAsJar).join(), (pegSeenAsJar as Item as Peg).length);

// A second family. One member without the field is written out as it is, so its objects have no room to spare.
interface Leaf { tag: number; }
interface Oak extends Leaf { rings: number; bark: string; }
interface Elm extends Leaf { rings: number; bark: string; }
interface Ash extends Leaf { rings: number; bark: string; }
interface Fir extends Leaf { cones: number; }
function makeLeaf(tag: number): Leaf { const leaf: Leaf = { tag }; return leaf; }
function makeOak(rings: number): Oak { const oak = makeLeaf(1) as Oak; oak.rings = rings; oak.bark = "rough"; return oak; }
function makeElm(rings: number): Elm { const elm = makeLeaf(2) as Elm; elm.rings = rings; elm.bark = "grey"; return elm; }
function makeAsh(rings: number): Ash { const ash = makeLeaf(3) as Ash; ash.rings = rings; ash.bark = "pale"; return ash; }
function makeFir(cones: number): Fir { const fir: Fir = { tag: 4, cones }; return fir; }
function ringsWhatever(leaf: Leaf): number | undefined { return (leaf as Oak | Elm | Ash).rings; }
function barkWhatever(leaf: Leaf): string | undefined { return (leaf as Oak | Elm | Ash).bark; }
const leaves: Leaf[] = [makeOak(10), makeElm(20.5), makeAsh(-3), makeFir(7), makeLeaf(5)];
for (const leaf of leaves) say("leaf", leaf.tag, ringsWhatever(leaf), barkWhatever(leaf), Object.keys(leaf).join());
const fir = makeFir(1);
poke(fir, "rings", 99);
say("fir", ringsWhatever(fir), barkWhatever(fir), Object.keys(fir).join());

console.log(lines.join("\n"));
