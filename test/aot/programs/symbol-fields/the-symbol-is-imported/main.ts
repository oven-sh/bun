// The symbols are made in another module and imported by name. A class here has fields under them, and the other module reads those fields.
import { kLabel, kMass, describe } from "./keys.ts";

class Body {
  [kMass]: number;
  [kLabel]: string;
  constructor(mass: number, label: string) {
    this[kMass] = mass;
    this[kLabel] = label;
  }
}
const bodies = [new Body(1, "a"), new Body(2, "bb")];
let total = 0;
for (let round = 0; round < 300; round++) for (const body of bodies) total += body[kMass] + body[kLabel].length;
console.log(total, bodies.map(describe).join(), Object.getOwnPropertySymbols(bodies[0]).map(String).join());
