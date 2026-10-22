console.log("only-the-type ran");

import type { Dog } from "./dog";

export function describe(dog: Dog): string {
  return dog.name + " has " + dog.legs + " legs";
}

export function isDogByShape(value: unknown): value is Dog {
  return typeof value === "object" && value !== null && "bark" in value;
}
