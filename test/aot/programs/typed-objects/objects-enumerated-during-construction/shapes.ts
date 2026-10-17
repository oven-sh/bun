import { hook } from "./untyped.js";
export class Base {
  first = 1;
  constructor(storesEarly: boolean) {
    hook(this, storesEarly);
  }
}
export class Derived extends Base {
  a: number | undefined = 1;
  b: string | undefined = "x";
  declare c?: number;
  constructor(storesEarly: boolean) {
    super(storesEarly);
    hook(this, false);
  }
}
