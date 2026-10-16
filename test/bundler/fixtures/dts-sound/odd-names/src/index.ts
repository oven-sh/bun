import { first, Unit } from "./a";
import { second } from "./b";
export { Unit };
export function total(unit: Unit = Unit.in): number {
  return first() + second() + unit;
}
