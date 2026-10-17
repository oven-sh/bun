// Records whose prototype is replaced, some by the prototype of a class: `v instanceof Known` follows the prototype, not the layout. Objects of classes are answered as ever.
class Known {
  x = 1;
}
class Heir extends Known {
  y = 2;
}
class Other {
  z = 3;
}
interface Row {
  lonely: number;
}
interface Pair {
  left: number;
  right: string;
}
const makeRow = (n: number): Row => ({ lonely: n });
const makePair = (n: number): Pair => ({ left: n, right: "r" + n });
const makeKept = (n: number) => ({ kept: n, also: n + 1 });
function alter(row: Row | Pair, parent: object | null) {
  Object.setPrototypeOf(row, parent);
}
const isKnown = [(v: any) => v instanceof Known][0]!;
const isHeir = [(v: any) => v instanceof Heir][0]!;
const isOther = [(v: any) => v instanceof Other][0]!;
const typedIsKnown = (v: Row | Pair | Known | Other) => v instanceof Known;
function inLoop(values: any[]) {
  let known = 0, heir = 0, other = 0;
  for (let i = 0; i < values.length; i++) {
    if (values[i] instanceof Known) known++;
    if (values[i] instanceof Heir) heir++;
    if (values[i] instanceof Other) other++;
  }
  return known + "/" + heir + "/" + other;
}
const parents: [string, object | null][] = [
  ["Known.prototype", Known.prototype],
  ["Heir.prototype", Heir.prototype],
  ["Other.prototype", Other.prototype],
  ["an object of Heir", new Heir()],
  ["an object under Known.prototype", Object.create(Known.prototype)],
  ["a plain object", { inherited: 1 }],
  ["Object.prototype", Object.prototype],
  ["null", null],
];
const all: any[] = [];
for (const [name, parent] of parents) {
  const row = makeRow(1), pair = makePair(2);
  console.log("before " + name + ": " + [isKnown(row), isHeir(row), isOther(row), isKnown(pair), typedIsKnown(row), typedIsKnown(pair)].join(" "));
  alter(row, parent);
  alter(pair, parent);
  console.log("under " + name + ": " + [isKnown(row), isHeir(row), isOther(row), isKnown(pair), isHeir(pair), isOther(pair), typedIsKnown(row), typedIsKnown(pair)].join(" "), row.lonely, pair.right);
  all.push(row, pair);
}
all.push(makeRow(3), makePair(4), makeKept(5), new Known(), new Heir(), new Other(), JSON.parse("{}"), "text", 7, null);
console.log("in a loop", inLoop(all));
let yes = 0;
for (let turn = 0; turn < 200; turn++) {
  for (let i = 0; i < all.length; i++) {
    if (isKnown(all[i])) yes++;
    if (isHeir(all[i])) yes += 100;
    if (isOther(all[i])) yes += 10000;
  }
}
console.log("many", yes);
const moved = makeRow(9);
const answers: boolean[] = [];
for (const [, parent] of [...parents, ...parents.slice().reverse()]) {
  alter(moved, parent);
  answers.push(isKnown(moved), isOther(moved));
}
console.log("moved", answers.map(Number).join(""));
alter(all[0], Other.prototype);
console.log("at last", isKnown(all[0]), isOther(all[0]), inLoop(all));
