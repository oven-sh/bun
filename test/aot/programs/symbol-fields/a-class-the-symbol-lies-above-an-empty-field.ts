// A class declares fields under symbols. While the optional field is empty a read finds what lies under the symbol above the object. A store makes the field, a deletion uncovers what lies above again.
export {};

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
const above = Object.getPrototypeOf(world[0]);
console.log(world[0][kNote], measure(world));
above[kNote] = "above";
console.log(world[0][kNote], Object.hasOwn(world[0], kNote), kNote in world[0], measure(world), keysOf(world[0]));
world[0][kNote] = "own";
console.log(world[0][kNote], world[1][kNote], Object.hasOwn(world[0], kNote), keysOf(world[0]));
delete world[0][kNote];
console.log(world[0][kNote], keysOf(world[0]));
Object.defineProperty(above, kNote, {
  set(value) {
    console.log("setter", value);
  },
  configurable: true,
});
world[1][kNote] = "caught";
console.log(world[1][kNote], Object.hasOwn(world[1], kNote), measure(world));
delete above[kNote];
console.log(measure(world));
