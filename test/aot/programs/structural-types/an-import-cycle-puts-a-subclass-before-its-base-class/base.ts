import { describeDerived } from "./derived.ts";

export class Base {
  low: number = 1;
  describe(): string {
    return "base " + this.low;
  }
}

export function viaDerived(): string {
  return describeDerived();
}
