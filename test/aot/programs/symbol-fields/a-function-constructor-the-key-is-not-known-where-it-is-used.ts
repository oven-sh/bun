// An interface declares fields under symbols, and a function that is called with `new` stores them. A function gets the key as a value of type symbol, or as anything. It reads and stores the same fields as code that names the symbol.
export {};

const kMass = Symbol("mass");
const kLabel = Symbol("label");
const kNote = Symbol("note");

interface Body {
  [kMass]: number;
  plain: number;
  [kLabel]: string;
  [kNote]?: string;
  weight(): number;
}
function Body(this: Body, mass: number, label: string) {
  this[kMass] = mass;
  this.plain = 1;
  this[kLabel] = label;
}
Body.prototype.weight = function (this: Body): number {
  return this[kMass] * 2;
};
function make(mass: number, label: string): Body {
  return new (Body as any)(mass, label);
}

function measure(bodies: Body[]): string {
  let total = 0;
  let letters = 0;
  let notes = 0;
  try {
    for (let round = 0; round < 200; round++) {
      for (const body of bodies) {
        total += body.weight() + body[kMass] + body.plain;
        letters += body[kLabel].length;
        if (body[kNote] !== undefined) notes++;
      }
    }
  } catch (error) {
    return (error as Error).name;
  }
  return (
    (typeof total === "number" ? String(total) : typeof total + String(total).length) + "/" + letters + "/" + notes
  );
}
function nameOf(key: string | symbol): string {
  return typeof key === "symbol" ? "[" + String(key.description) + "]" : key;
}
function keysOf(object: object): string {
  const inLoop: string[] = [];
  for (const key in object) inLoop.push(key);
  return [
    Reflect.ownKeys(object).map(nameOf).join(),
    Object.getOwnPropertySymbols(object).map(nameOf).join(),
    Object.keys(object).join(),
    inLoop.join(),
  ].join(" | ");
}

const world: Body[] = [make(1, "a"), make(2, "bb"), make(3, "ccc"), make(4, "d")];
console.log(measure(world), keysOf(world[0]));
const first: any = world[0];
function readBy(object: any, key: any): unknown {
  return object[key];
}
function storeBy(object: any, key: symbol | string, value: unknown): void {
  object[key] = value;
}
const keys: (symbol | string)[] = [kMass, "plain", kLabel, kNote, Symbol("mass"), "mass", Symbol.iterator];
const seen: unknown[] = [];
for (let round = 0; round < 50; round++)
  for (const key of keys) seen[keys.indexOf(key)] = readBy(world[round % 4], key);
console.log(seen.map(String).join());
for (const key of keys) storeBy(world[0], key, 12);
console.log(world[0][kMass], world[0][kLabel], world[0][kNote], keysOf(world[0]), measure(world.slice(1)));
console.log(
  Reflect.get(world[1], kMass),
  Reflect.has(world[1], kLabel),
  Reflect.set(world[1], kMass, 21),
  world[1].weight(),
  Reflect.deleteProperty(world[1], kMass),
  world[1].weight(),
);
