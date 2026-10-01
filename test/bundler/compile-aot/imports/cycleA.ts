import { bValue, readA } from "./cycleB";
export const aValue = "A:" + bValue;
export function hoisted(): string { return "hoisted"; }
export function tryReadA(): string { return readA(); }
