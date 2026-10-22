// An interface declares fields under symbols, and a function that is called with `new` stores them. A frozen object takes no store under a symbol, a sealed one takes stores to the fields it has, and one that cannot be extended takes no field that was still empty.
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
Object.freeze(world[0]);
Object.seal(world[1]);
Object.preventExtensions(world[2]);
const results: string[] = [];
for (const body of world) {
  for (const store of [() => (body[kMass] = 30), () => (body[kNote] = "late"), () => delete (body as any)[kLabel]]) {
    try {
      results.push(String(store()));
    } catch (error) {
      results.push((error as Error).name);
    }
  }
}
console.log(results.join(), Object.isFrozen(world[0]), Object.isSealed(world[1]), Object.isExtensible(world[2]));
console.log(measure(world), world.map(keysOf).join(" ; "));
