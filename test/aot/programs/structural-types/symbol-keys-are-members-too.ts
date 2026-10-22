const id: unique symbol = Symbol("id");
const note: unique symbol = Symbol("note");

interface Tagged {
  [id]: number;
  name: string;
}

interface Noted extends Tagged {
  [note]?: string;
}

const log: string[] = [];

function read(t: Tagged): string {
  return t.name + "#" + t[id];
}

function listing(t: Tagged): string {
  const walked: string[] = [];
  for (const key in t) walked.push(key);
  const copy = { ...t };
  return [
    "keys " + Object.keys(t).join(),
    "for-in " + walked.join(),
    "json " + JSON.stringify(t),
    "symbols " + Object.getOwnPropertySymbols(t).map(String).join(),
    "own keys " + Reflect.ownKeys(t).map(String).join(),
    "copy " + Reflect.ownKeys(copy).map(String).join() + " " + copy[id],
    "assign " + Reflect.ownKeys(Object.assign({}, t)).map(String).join(),
    "has " + (id in t) + " " + Object.hasOwn(t, id),
  ].join("; ");
}

function bump(t: Tagged): number {
  t[id] += 1;
  return t[id];
}

class Entity {
  [id] = 10;
  name = "entity";
}

class Derived {
  name = "derived";
  get [id](): number {
    log.push("get id");
    return 20;
  }
  set [id](value: number) {
    log.push("set id " + value);
  }
}

const first: Tagged = { [id]: 1, name: "symbol first" };
const lastKey: Tagged = { name: "symbol last", [id]: 2 };
const extra = { [note]: "noted", name: "two symbols", [id]: 3, other: true };
const hidden: Tagged = Object.defineProperty({ name: "hidden", [id]: 4 }, id, { enumerable: false });
const inherited: Tagged = Object.assign(Object.create({ [id]: 5 }), { name: "inherited" });

const table: Tagged[] = [first, lastKey, extra, hidden, inherited, new Entity(), new Derived()];

for (const t of table) {
  console.log(read(t) + " | " + listing(t) + " [" + log.join() + "]");
  log.length = 0;
}

for (const t of table) {
  console.log(t.name + ", bumped: " + bump(t) + " [" + log.join() + "]");
  log.length = 0;
}

const noted: Noted = extra;
console.log("an optional symbol key: " + noted[note] + " " + (note in noted) + " " + (note in first));
delete noted[note];
console.log("deleted: " + noted[note] + " " + (note in noted) + " " + Reflect.ownKeys(noted).map(String).join());

const sameDescription = Symbol("id");
const confusing = { [sameDescription]: -1, [id]: 6, name: "two symbols that print alike" };
console.log(read(confusing) + " " + Object.getOwnPropertySymbols(confusing).length);

let total = 0;
for (let i = 0; i < 2000; i++) total += first[id] + read(first).length;
console.log("2000 honest: " + total);
console.log("then: " + table.map(read).join());
log.length = 0;

interface Money {
  amount: number;
  [Symbol.toPrimitive](hint: string): number | string;
}

const hints: string[] = [];
const price: Money = {
  amount: 5,
  [Symbol.toPrimitive](hint) {
    hints.push(hint);
    return hint === "string" ? "five" : this.amount;
  },
};
console.log("conversions: " + `${price}` + " " + String(price) + " " + Number(price) + " " + [price].join() + " " + hints.join());

interface Bag {
  items: string[];
  [Symbol.iterator](): Iterator<string>;
  readonly [Symbol.toStringTag]: string;
}

const bag: Bag = {
  items: ["a", "b"],
  [Symbol.iterator]() {
    return [...this.items].reverse()[Symbol.iterator]();
  },
  [Symbol.toStringTag]: "Bag",
};
console.log("iterated: " + [...bag].join() + " " + Array.from(bag).join() + " " + Object.prototype.toString.call(bag) + " " + JSON.stringify(bag));

export {};
