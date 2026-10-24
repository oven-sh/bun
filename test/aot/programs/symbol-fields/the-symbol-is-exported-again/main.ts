// The symbol reaches this module three ways: through `export { .. } from`, through `export *` and under another name. All three name one field.
import { kMass } from "./named.ts";
import { kMass as kStar } from "./star.ts";
import { kWeight } from "./renamed.ts";

class Body {
  [kMass]: number;
  constructor(mass: number) {
    this[kMass] = mass;
  }
}
const body = new Body(4);
let total = 0;
for (let round = 0; round < 300; round++) total += body[kMass] + body[kStar] * 10 + body[kWeight] * 100;
body[kWeight] = 5;
console.log(total, body[kMass], kMass === kStar, kStar === kWeight, Reflect.ownKeys(body).length);
