// The symbol is read from the namespace object of its module at each use, and once into a constant that is declared with its type.
import * as keys from "./keys.ts";

const kMass: typeof keys.kMass = keys.kMass;
class Body {
  [keys.kMass]: number;
  [keys.kLabel]: string;
  constructor(mass: number, label: string) {
    this[keys.kMass] = mass;
    this[keys.kLabel] = label;
  }
}
const body = new Body(3, "ccc");
let total = 0;
for (let round = 0; round < 300; round++) total += body[kMass] + body[keys.kMass] * 10 + body[keys.kLabel].length * 100;
const { kLabel } = keys;
console.log(total, body[kLabel], kMass === keys.kMass, Reflect.ownKeys(body).map(String).join());
