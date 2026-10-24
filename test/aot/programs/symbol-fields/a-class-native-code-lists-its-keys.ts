// A class declares fields under symbols. Built-ins that walk the own properties of an object see the fields under symbols, or skip them, as they do for any object.
import { isDeepStrictEqual } from "node:util";

const kMass = Symbol("mass");
const kLabel = Symbol("label");
const kNote = Symbol("note");

class Body {
  [kMass]: number;
  plain: number;
  [kLabel]: string;
  declare [kNote]?: string;
  constructor(mass: number, label: string) {
    this[kMass] = mass;
    this.plain = 1;
    this[kLabel] = label;
  }
  weight(): number {
    return this[kMass] * 2;
  }
}
function make(mass: number, label: string): Body {
  return new Body(mass, label);
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
const descriptors = Object.getOwnPropertyDescriptors(world[0]);
console.log(keysOf(descriptors), (descriptors as any)[kMass].value);
console.log(keysOf(Object.defineProperties({}, descriptors)), keysOf(Object.create(null, descriptors)));
console.log(
  isDeepStrictEqual(make(1, "a"), make(1, "a")),
  isDeepStrictEqual(make(1, "a"), make(2, "a")),
  Bun.deepEquals(make(1, "a"), make(1, "a")),
  Bun.deepEquals(make(1, "a"), make(2, "a"), true),
);
console.log(
  Object.fromEntries(Reflect.ownKeys(world[1]).map(key => [key, typeof (world[1] as any)[key]]))[kLabel as any],
  Object.entries(world[1]).join(),
);
const target = new Proxy(world[2], {
  ownKeys(object) {
    return Reflect.ownKeys(object).reverse();
  },
  get(object, key, receiver) {
    return typeof key === "symbol" && key !== kLabel ? 9 : Reflect.get(object, key, receiver);
  },
});
console.log(keysOf(target), measure([target]), keysOf({ ...target }));
