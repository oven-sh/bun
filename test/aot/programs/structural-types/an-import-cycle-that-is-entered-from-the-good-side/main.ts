import { Derived, describeDerived } from "./derived.ts";
import { Base, viaDerived } from "./base.ts";

console.log("describeDerived: " + describeDerived());
console.log("viaDerived: " + viaDerived());
console.log("instanceof: " + (new Derived() instanceof Base));
console.log("keys: " + Object.keys(new Derived()).join());
