// Records and objects of classes that get another prototype and properties their type does not name, in either order: `v instanceof Known` follows the prototype.
class Known {
  x = 1;
}
class Heir extends Known {
  y = 2;
}
class Other {
  z = 3;
}
class Moved {
  w = 4;
}
interface Row {
  lonely: number;
}
const makeRow = (n: number): Row => ({ lonely: n });
function alter(value: object, parent: object | null) {
  Object.setPrototypeOf(value, parent);
}
function extend(value: any, name: string, stored: number) {
  value[name] = stored;
}
function shrink(value: any, name: string) {
  delete value[name];
}
const isKnown = [(v: any) => v instanceof Known][0]!;
const isHeir = [(v: any) => v instanceof Heir][0]!;
const isOther = [(v: any) => v instanceof Other][0]!;
const isMoved = [(v: any) => v instanceof Moved][0]!;
const typedIsKnown = (v: Row | Known | Other) => v instanceof Known;
function narrow(v: Row | Known | Other): string {
  if (v instanceof Heir) return "heir";
  if (v instanceof Known) return "known";
  if (v instanceof Other) return "other";
  return "row " + v.lonely;
}
function inLoop(values: any[]) {
  let known = 0, heir = 0, other = 0, moved = 0;
  for (let i = 0; i < values.length; i++) {
    if (values[i] instanceof Known) known++;
    if (values[i] instanceof Heir) heir++;
    if (values[i] instanceof Other) other++;
    if (values[i] instanceof Moved) moved++;
  }
  return [known, heir, other, moved].join("/");
}
const say = (label: string, v: Row | Known | Other) => console.log(label, [isKnown(v), isHeir(v), isOther(v), isMoved(v), typedIsKnown(v)].map(Number).join(""), narrow(v), inLoop([v, v]));
const sayOfMoved = (label: string, v: Moved) => console.log(label, [isKnown(v), isHeir(v), isOther(v), isMoved(v)].map(Number).join(""), inLoop([v, v]));
const parents: [string, object | null][] = [
  ["Known.prototype", Known.prototype],
  ["Heir.prototype", Heir.prototype],
  ["an object of Other", new Other()],
  ["a plain object", { inherited: 1 }],
  ["Object.prototype", Object.prototype],
  ["null", null],
];
const all: any[] = [];
for (const [name, parent] of parents) {
  const first = makeRow(1);
  alter(first, parent);
  say("altered: " + name, first);
  extend(first, "extra", 5);
  say("altered, extended: " + name, first);
  const second = makeRow(2);
  extend(second, "extra", 6);
  say("extended", second);
  alter(second, parent);
  say("extended, altered: " + name, second);
  const third = makeRow(3);
  alter(third, parent);
  for (let i = 0; i < 100; i++) extend(third, "p" + i, i);
  say("altered, a hundred more: " + name, third);
  for (let i = 0; i < 100; i++) shrink(third, "p" + i);
  say("and none again: " + name, third);
  alter(third, Object.prototype);
  say("and back under Object.prototype", third);
  console.log(first.lonely, (first as any).extra, second.lonely, (second as any).extra, third.lonely);
  all.push(first, second, third);
}
const kept = makeRow(7);
say("kept", kept);
extend(kept, "extra", 1);
say("kept, extended", kept);
const moved = new Moved();
sayOfMoved("an object of Moved", moved);
extend(moved, "extra", 1);
sayOfMoved("extended", moved);
alter(moved, Known.prototype);
sayOfMoved("under Known.prototype", moved);
alter(moved, Moved.prototype);
sayOfMoved("back under Moved.prototype", moved);
sayOfMoved("another object of Moved", new Moved());
all.push(kept, moved, new Moved(), new Known(), new Heir(), new Other(), makeRow(8));
console.log("in a loop", inLoop(all));
let yes = 0;
for (let turn = 0; turn < 300; turn++) {
  for (let i = 0; i < all.length; i++) {
    if (isKnown(all[i])) yes++;
    if (isOther(all[i])) yes += 1000;
    if (!isMoved(all[i]) && all[i] !== moved && narrow(all[i]) === "known") yes += 1000000;
  }
}
console.log("many", yes);
