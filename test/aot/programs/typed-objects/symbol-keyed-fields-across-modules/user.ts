import { kShared as kAlias, type Tagged } from "./symbols";
export function readAlias(value: Tagged): number {
  return value[kAlias];
}
export class Holder implements Tagged {
  [kAlias]: number = 4;
}
