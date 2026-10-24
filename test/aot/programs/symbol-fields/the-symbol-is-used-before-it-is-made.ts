// A function that names the symbol runs before the declaration has run: a ReferenceError, and nothing is stored.
export {};

class Body {
  declare [kMass]: number;
  fill(mass: number): this {
    this[kMass] = mass;
    return this;
  }
}
const early = new Body();
try {
  early.fill(1);
  console.log("stored");
} catch (error) {
  console.log((error as Error).name, Reflect.ownKeys(early).length);
}
const kMass = Symbol("mass");
console.log(early.fill(2)[kMass], Reflect.ownKeys(early).length);
