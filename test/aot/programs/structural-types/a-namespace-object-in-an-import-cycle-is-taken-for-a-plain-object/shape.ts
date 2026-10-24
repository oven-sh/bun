import { measure } from "./measure.ts";

export const width: number = 3;
export let height: number = 4;
export var depth: number = 5;
export function grow(): void {
  height += 1;
  depth += 1;
}
export const measuredAtLoad: string = measure("at the end of shape");
