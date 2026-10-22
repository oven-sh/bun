import { Animal, Cat } from "./animals.ts";
import type { Keeper } from "./keeper.ts";

export function makeImpostor(): Animal {
  return new Cat("tom");
}

export function tryAll(keeper: Keeper, a: Animal): string[] {
  const out: string[] = [];
  const uses: [string, () => unknown][] = [
    ["legsOf", () => keeper.legsOf(a)],
    ["legsOf + 1", () => keeper.legsOf(a) + 1],
    ["tagOf", () => keeper.tagOf(a)],
    ["ownerName", () => keeper.ownerName(a)],
    ["speak", () => keeper.speak(a)],
  ];
  for (const [label, use] of uses) {
    try {
      const value = use();
      out.push(label + ": " + typeof value + " " + String(value));
    } catch (error) {
      out.push(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
    }
  }
  return out;
}
