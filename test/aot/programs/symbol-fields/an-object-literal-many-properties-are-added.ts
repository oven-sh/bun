// An interface declares fields under symbols, and an object literal with computed keys fills them. After two hundred more properties, some of them under symbols, the fields are still read and listed in their places.
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
function weight(this: Body): number {
  return this[kMass] * 2;
}
function make(mass: number, label: string): Body {
  return { [kMass]: mass, plain: 1, [kLabel]: label, weight };
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
const added: symbol[] = [];
for (let index = 0; index < 100; index++) {
  first["name" + index] = index;
  added.push(Symbol("added" + index));
  first[added[index]] = index;
}
const all = Reflect.ownKeys(first);
console.log(
  all.length,
  all.slice(0, 3).map(nameOf).join(),
  nameOf(all[all.length - 100 - 2]),
  nameOf(all[all.length - 100 - 1]),
  nameOf(all[all.length - 1]),
  first[added[99]],
);
console.log(measure(world));
for (let index = 0; index < 100; index++) delete first["name" + index];
console.log(measure(world), Object.keys(first).join(), Object.getOwnPropertySymbols(first).length);
