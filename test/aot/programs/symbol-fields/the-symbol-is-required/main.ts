// The symbols hang on the exports object of a CommonJS module and are taken out of it by destructuring.
const { kMass, kLabel, read } = require("./keys.cjs");

class Body {
  [key: symbol]: unknown;
  constructor(mass: number, label: string) {
    this[kMass] = mass;
    this[kLabel] = label;
  }
}
const bodies = [new Body(1, "a"), new Body(2, "bb")];
let total = 0;
for (let round = 0; round < 300; round++) for (const body of bodies) total += (body[kMass] as number) + read(body);
console.log(
  total,
  bodies[1][kLabel],
  Reflect.ownKeys(bodies[0]).map(String).join(),
  require("./keys.cjs").kMass === kMass,
);
