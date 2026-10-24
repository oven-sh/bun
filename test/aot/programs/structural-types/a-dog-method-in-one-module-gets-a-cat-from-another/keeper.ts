import { Animal, Dog } from "./animals.ts";

export interface Keeper {
  legsOf(a: Animal): number;
  tagOf(a: Animal): string;
  ownerName(a: Animal): string;
  speak(a: Animal): string;
}

export class DogKeeper implements Keeper {
  legsOf(d: Dog): number {
    return d.legs;
  }
  tagOf(d: Dog): string {
    return d.tag;
  }
  ownerName(d: Dog): string {
    return d.owner.first;
  }
  speak(d: Dog): string {
    return d.bark();
  }
}

export const dogKeeper = new DogKeeper();
export const keeper: Keeper = dogKeeper;
