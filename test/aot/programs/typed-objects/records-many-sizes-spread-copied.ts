// A spread of a record copies all its fields at once, whatever its size: the copy has the same keys in the same order, is not frozen, and shares nothing with its source but what the fields refer to.
// CALLS+ copyPair CopyTypedObject16
// CALLS+ copyPoint CopyTypedObject32
// CALLS+ movePoint CopyTypedObject32
// CALLS+ copyWide CopyTypedObjectAnySize
// SIZE< copySix 120
// SIZE< copyEight 180
// SIZE< copyWide 130
type Pair = { a: number; b: number };
type Point = { x: number; y: number; z: number };
type Item = { name: string; next: Item | undefined; count: number; label?: string; done?: boolean };
type Six = { a: number; b: string; c: number; d: string; e: number; f: string };
type Eight = { a: number; b: number; c: number; d: number; e: number; f: number; g: number; h: string };
type Wide = {
  n0: number; s0: string; r0: Item | undefined; n1: number; s1: string; r1: Item | undefined; n2: number; s2: string; r2: Item | undefined;
  n3: number; s3: string; r3: Item | undefined; n4: number; s4: string; r4: Item | undefined; n5: number; s5: string; r5?: Item;
};

function copyPair(p: Pair): Pair { return { ...p }; }
function copyPoint(p: Point): Point { return { ...p }; }
function movePoint(p: Point, y: number): Point { return { ...p, y }; }
function copyItem(i: Item): Item { return { ...i }; }
function renameItem(i: Item, name: string): Item { return { ...i, name }; }
function labelItem(i: Item, label: string): Item { return { ...i, label }; }
function copySix(s: Six): Six { return { ...s }; }
function copyEight(e: Eight, h: string): Eight { return { ...e, h }; }
function copyWide(w: Wide): Wide { return { ...w }; }
function changeWide(w: Wide, n3: number, s5: string): Wide { return { ...w, n3, s5 }; }

function show(title: string, value: object) {
  console.log(title, JSON.stringify(value), Object.keys(value).join(), Object.isFrozen(value), Object.isSealed(value), Object.isExtensible(value));
}

const first: Item = { name: "first", next: undefined, count: 1 };
const second: Item = { name: "second", next: first, count: 2, label: "two" };
const third: Item = { done: true, count: 3, next: second, name: "third" };
const wide: Wide = {
  n0: 0.5, s0: "a", r0: first, n1: 1.5, s1: "b", r1: undefined, n2: 2.5, s2: "c", r2: second,
  n3: 3.5, s3: "d", r3: undefined, n4: 4.5, s4: "e", r4: third, n5: 5.5, s5: "f",
};

show("pair", copyPair({ a: 1, b: -0 }));
show("point", copyPoint({ x: 1, y: 2.5, z: NaN }));
show("moved", movePoint({ x: 1, y: 2, z: 3 }, 20));
for (const item of [first, second, third]) {
  const copy = copyItem(item);
  show("item", copy);
  console.log(copy !== item, copy.next === item.next, "label" in copy, "done" in copy);
  show("renamed", renameItem(item, "other"));
  show("labeled", labelItem(item, "new"));
  show("source", item);
}
show("six", copySix({ f: "f", e: 5, d: "d", c: 3, b: "b", a: 1 }));
show("eight", copyEight({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: "h" }, "H"));
show("wide", copyWide(wide));
show("changed", changeWide({ ...wide, r5: first }, -3.5, "F"));

const frozen: Point = Object.freeze({ x: 7, y: 8, z: 9 });
const thawed = copyPoint(frozen);
thawed.x = 70;
show("frozen", frozen);
show("thawed", thawed);
const sealed: Item = Object.seal({ name: "sealed", next: undefined, count: 4 });
const unsealed = labelItem(sealed, "open");
show("sealed", sealed);
show("unsealed", unsealed);
const closed: Pair = Object.preventExtensions({ a: 1, b: 2 });
const opened = copyPair(closed) as Pair & { c?: number };
opened.c = 3;
show("opened", opened);

const marked: Point = { x: 1, y: 2, z: 3 };
(marked as Point & { extra?: string }).extra = "more";
show("marked", copyPoint(marked));
show("marked and moved", movePoint(marked, 5));

const nothing = [undefined, null] as unknown as Point[];
for (const none of nothing) {
  try {
    show("nothing", copyPoint(none));
  } catch (error) {
    console.log("nothing", (error as Error).constructor.name);
  }
}

let kept: Item[] = [];
let sum = 0;
for (let round = 0; round < 60000; round++) {
  const item = renameItem(round & 1 ? second : third, "n" + (round & 7));
  const point = movePoint({ x: round, y: 0, z: -round }, round * 2);
  const other = changeWide(wide, round, "s");
  if (!(round % 997)) kept.push(item, copyItem(item));
  sum += point.x + point.y + point.z + other.n3 + other.n5 + item.count + item.name.length + (other.r4 === third ? 1 : 0);
}
console.log(sum, kept.length, kept.map(item => item.name + (item.label ?? "") + item.count + (item.next?.name ?? "")).join());
