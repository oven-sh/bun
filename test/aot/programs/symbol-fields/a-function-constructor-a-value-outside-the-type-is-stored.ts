// An interface declares fields under symbols, and a function that is called with `new` stores them. A string, undefined, an object and a symbol are stored into the number field through `any`. Each is what the next read answers.
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
for (const value of ["text", undefined, null, { valueOf: () => 6 }, 2.5, -0, 2 ** 40, 7n, kLabel]) {
  first[kMass] = value;
  let answer: string;
  try {
    answer = measure(world);
  } catch (error) {
    answer = (error as Error).name;
  }
  console.log(typeof world[0][kMass], Object.is(world[0][kMass], value), answer);
}
first[kLabel] = 5;
console.log(measure(world), keysOf(first));
