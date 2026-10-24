// An interface declares fields under symbols, and an object literal with computed keys fills them. Names come in front of symbols, and each kind in the order of the stores. Object.keys, for-in and JSON.stringify skip the symbols.
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
console.log(JSON.stringify(world[1]), Object.entries(world[1]).length, Object.values(world[1]).length);
console.log(
  kMass in world[1],
  Object.hasOwn(world[1], kLabel),
  kNote in world[1],
  Object.hasOwn(world[1], kNote),
  world[1].propertyIsEnumerable(kMass),
);
const described = Object.getOwnPropertyDescriptor(world[1], kMass)!;
console.log(
  described.value,
  described.writable,
  described.enumerable,
  described.configurable,
  Object.getOwnPropertyDescriptor(world[1], kNote),
);
