import { Base } from "./base";

export class Derived extends Base {
  name = "derived";
  viaSuper() { return "Derived, then " + super.viaSuper(); }
}
