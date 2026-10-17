import { Base } from "./base.ts";
export class Heir extends Base {
  constructor(name) { super(name); }
}
export function viaValue(some, name) { return new some(name); }
