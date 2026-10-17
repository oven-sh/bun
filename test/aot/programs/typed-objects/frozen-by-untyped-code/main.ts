// Objects of classes and record types are frozen, sealed or made non-extensible by JavaScript that has no types and come back: typed code reads them as before, and its stores do what they do in plain Bun.
import sloppy from "./sloppy.cjs";
import { closed, frozen, same, sealed, store, storeX } from "./untyped.js";

class Item {
  owner: Item | undefined = undefined;
  x: number;
  label: string;
  extra?: number;
  #hidden = 0;
  constructor(x: number, label: string) {
    this.x = x;
    this.label = label;
  }
  move(by: number): number {
    this.x += by;
    return this.x;
  }
  touch(): number {
    return ++this.#hidden;
  }
  set scaled(value: number) {
    this.x = value * 2;
  }
}
class Crate extends Item {
  weight: number = 1;
  tags: string[] = [];
}
type Row = { id: number; name: string; note?: string; inner: { count: number } };

function attempt(what: string, f: () => unknown): void {
  let said: string;
  try {
    said = String(f());
  } catch (error) {
    said = "THROWS " + (error as Error).name;
  }
  console.log("  " + what + ": " + said);
}
function state(object: object): string {
  return [Object.isFrozen(object), Object.isSealed(object), Object.isExtensible(object)].join(" ");
}
function setOwner(item: Item, owner: Item): Item | undefined {
  item.owner = owner;
  return item.owner;
}
function setBoth(item: Item, x: number, label: string): string {
  item.x = x;
  item.label = label;
  return item.x + item.label;
}
function sum(items: Item[]): number {
  let total = 0;
  for (let round = 0; round < 3; round++) for (const item of items) total += (item.x ?? -1) + item.label.length + (item.owner === undefined ? 0 : item.owner.x) + (item.extra ?? 0);
  return total;
}

const shelf = new Item(100, "shelf");
const ways: [string, <T>(value: T) => T][] = [["untouched", same], ["frozen", frozen], ["sealed", sealed], ["not extensible", closed], ["frozen by typed code", value => Object.freeze(value)]];
const all: Item[] = [];
for (const [name, way] of ways) {
  for (const make of [() => new Item(1, "n"), () => new Crate(2, "l")]) {
    const item: Item = way(make());
    all.push(item);
    console.log(name, item.constructor.name, state(item));
    attempt("x", () => (item.x = 5));
    attempt("x again", () => item.x);
    attempt("owner through a function", () => setOwner(item, shelf)?.x);
    attempt("two stores", () => setBoth(item, 7, "m"));
    attempt("after two stores", () => item.x + item.label);
    attempt("a method that stores", () => item.move(1));
    attempt("a setter that stores", () => ((item.scaled = 4), item.x));
    attempt("a private field", () => item.touch());
    attempt("a field that is not there yet", () => (item.extra = 9));
    attempt("it reads", () => item.extra);
    attempt("delete", () => delete item.extra);
    attempt("by untyped code, by key", () => store(item, "x", 11));
    attempt("by untyped code, by name", () => storeX(item, 12));
    attempt("a new name by untyped code", () => store(item, "other", 13));
    attempt("by sloppy code", () => sloppy.storeSloppily(item, 14));
    attempt("a new name by sloppy code", () => sloppy.addSloppily(item, 15));
    attempt("Reflect.set", () => Reflect.set(item, "x", 16) + " " + item.x);
    attempt("defineProperty with the value it has", () => Object.defineProperty(item, "x", { value: item.x }).x);
    attempt("defineProperty with another value", () => Object.defineProperty(item, "x", { value: 17 }).x);
    attempt("Reflect.defineProperty", () => Reflect.defineProperty(item, "x", { value: 18 }) + " " + item.x);
    attempt("defineProperty of a new name", () => Object.keys(Object.defineProperty(item, "fresh", { value: 19, enumerable: true })).join());
    attempt("defineProperty of an accessor", () => Object.defineProperty(item, "label", { get: () => "got" }).label);
    attempt("another prototype", () => Object.getPrototypeOf(Object.setPrototypeOf(item, Object.getPrototypeOf(item))) === Object.getPrototypeOf(item));
    attempt("keys", () => Object.keys(item).join());
    attempt("descriptor", () => JSON.stringify(Object.getOwnPropertyDescriptor(item, "x")));
    attempt("JSON", () => JSON.stringify(item));
    attempt("delete by sloppy code", () => sloppy.deleteSloppily(item) + " " + item.x);
    attempt("a copy is free", () => {
      const copy = { ...item };
      copy.x = 21;
      return copy.x + " " + state(copy);
    });
    if (item instanceof Crate) {
      attempt("weight", () => (item.weight = 3));
      attempt("an array it holds", () => item.tags.push("t"));
    }
  }
  const row: Row = way({ id: 1, name: "r", inner: { count: 1 } });
  console.log(name, "record", state(row));
  attempt("id", () => (row.id = 2));
  attempt("note", () => (row.note = "n"));
  attempt("what it holds", () => ++row.inner.count);
  attempt("JSON", () => JSON.stringify(row));
}
console.log(sum(all));

const many: Item[] = [];
for (let i = 0; i < 3000; i++) many.push(i % 3 ? frozen(new Crate(i, "k")) : new Item(i, "j"));
let refused = 0;
for (const item of many) {
  try {
    setOwner(item, shelf);
  } catch {
    refused++;
  }
}
console.log(refused, sum(many));

class Shared {
  declare common: number;
  own = 1;
  grow(): number {
    return ++this.own;
  }
}
class Heir extends Shared {
  more = 2;
}
(Shared.prototype as any).common = 5;
const before = new Shared();
console.log("a frozen prototype", state(frozen(Shared.prototype)), state(Heir.prototype));
for (const made of [before, new Shared(), new Heir()]) {
  attempt("state", () => state(made));
  attempt("its own field", () => (made.own = 3));
  attempt("a method that stores", () => made.grow());
  attempt("a name the prototype holds", () => (made.common = 6));
  attempt("it reads", () => made.common + " " + Object.keys(made).join());
  attempt("that name by sloppy code", () => sloppy.putSloppily(made, "common", 7) + " " + store(made, "fine", 8));
  attempt("that name defined", () => Object.defineProperty(made, "common", { value: 9, writable: true }).common);
  attempt("and stored to", () => (made.common = 10));
}
attempt("a method replaced", () => ((Shared.prototype as any).grow = () => 0));
attempt("a method added", () => ((Shared.prototype as any).shrink = () => 0));
attempt("a method replaced in the subclass", () => (((Heir.prototype as any).grow = () => -1), new Heir().grow()));
attempt("the method of the class", () => new Shared().grow());
