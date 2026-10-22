// A class declares fields under symbols. Object.defineProperty turns the field into a getter and a setter. Every later read and store runs them.
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
let reads = 0;
let stored: unknown = "nothing";
Object.defineProperty(first, kMass, {
  get() {
    reads++;
    return 50;
  },
  set(value) {
    stored = value;
  },
  configurable: true,
  enumerable: false,
});
console.log(measure(world), reads, keysOf(first), JSON.stringify({ ...first }), ({ ...first } as any)[kMass]);
world[0][kMass] = 7;
console.log(stored, world[0][kMass], world[0].weight(), reads);
Object.defineProperty(first, kMass, { value: 8, writable: true, enumerable: true });
console.log(measure(world), reads, keysOf(first));
