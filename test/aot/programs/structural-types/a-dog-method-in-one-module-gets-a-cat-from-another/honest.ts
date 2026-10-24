import { Dog } from "./animals.ts";
import { dogKeeper } from "./keeper.ts";

export function honest(d: Dog): string {
  return dogKeeper.legsOf(d) + " " + dogKeeper.tagOf(d) + " " + dogKeeper.ownerName(d) + " " + dogKeeper.speak(d);
}

export function honestLegs(count: number): number {
  const d = new Dog("loop");
  let sum = 0;
  for (let i = 0; i < count; i++) sum += dogKeeper.legsOf(d);
  return sum;
}
