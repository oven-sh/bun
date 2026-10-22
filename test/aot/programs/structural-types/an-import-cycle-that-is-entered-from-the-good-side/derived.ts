import { Base } from "./base.ts";

export class Derived extends Base {
  high: number = 2;
  describe(): string {
    return super.describe() + " derived " + this.high;
  }
}

export function describeDerived(): string {
  return new Derived().describe();
}
