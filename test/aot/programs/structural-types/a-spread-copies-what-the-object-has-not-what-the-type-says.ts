interface Point {
  x: number;
  y: number;
}

const log: string[] = [];
const tag = Symbol("tag");

function copy(p: Point): Point {
  return { ...p };
}

function copyAndReplace(p: Point): Point {
  return { ...p, y: -1 };
}

const defaults = { x: 0, y: 0 };

function copyOverDefaults(p: Point): Point {
  return { ...defaults, ...p };
}

function describe(p: Point): string {
  const symbols = Object.getOwnPropertySymbols(p).length;
  return JSON.stringify(p) + " keys " + Object.keys(p).join() + " symbols " + symbols + " x " + p.x + " y " + p.y;
}

class Pair {
  x = 1;
  y = 2;
  sum(): number {
    return this.x + this.y;
  }
}

class Computed {
  get x(): number {
    log.push("get x of the prototype");
    return 31;
  }
  y = 32;
}

const extras = { w: 0, x: 11, y: 12, z: 13 };
const flipped = { y: 22, x: 21 };
const withGetters = {
  get y(): number {
    log.push("get y");
    return 42;
  },
  get x(): number {
    log.push("get x");
    return 41;
  },
};
const hidden = Object.defineProperty({ x: 51, y: 52 }, "x", { enumerable: false });
const inherited: Point = Object.create({ x: 61, y: 62 });
const halfInherited: Point = Object.assign(Object.create({ x: 71 }), { y: 72 });
const withSymbol = { x: 81, [tag]: "tagged", y: 82 };
const frozen = Object.freeze({ y: 92, x: 91 });

const table: [string, Point][] = [
  ["honest", { x: 1, y: 2 }],
  ["extras", extras],
  ["other order", flipped],
  ["own getters", withGetters],
  ["x is not enumerable", hidden],
  ["both inherited", inherited],
  ["x inherited", halfInherited],
  ["a symbol key", withSymbol],
  ["frozen", frozen],
  ["an instance of a class", new Pair()],
  ["a getter on the prototype", new Computed()],
];

for (const [name, p] of table) {
  console.log(name + ", copy: " + describe(copy(p)));
  console.log(name + ", replaced: " + describe(copyAndReplace(p)));
  console.log(name + ", over defaults: " + describe(copyOverDefaults(p)));
  console.log(name + ", getters ran: " + log.join(", "));
  log.length = 0;
}

const copyOfGetters = copy(withGetters);
const descriptor = Object.getOwnPropertyDescriptor(copyOfGetters, "x");
console.log("a copied getter is a plain member: " + (descriptor !== undefined && "value" in descriptor));
log.length = 0;

const copyOfFrozen = copy(frozen);
copyOfFrozen.x = 5;
console.log("a copy of a frozen object can be stored to: " + copyOfFrozen.x + " " + Object.isFrozen(copyOfFrozen));

const copyOfInstance = copy(new Pair());
console.log("a copy of an instance is a plain object: " + (copyOfInstance instanceof Pair) + " " + ("sum" in copyOfInstance));
console.log("its prototype is Object.prototype: " + (Object.getPrototypeOf(copyOfInstance) === Object.prototype));

const local: Point = extras;
const localCopy = { ...local };
console.log("local: " + JSON.stringify(localCopy));
const merged = { ...local, ...flipped };
console.log("two spreads: " + JSON.stringify(merged));
const mergedBack = { ...flipped, ...local };
console.log("two spreads, the other way: " + JSON.stringify(mergedBack));
