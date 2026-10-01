import { aValue, hoisted } from "./cycleA";
export const early = hoisted();
export let tdz = "no error";
try { void aValue; } catch (e) { tdz = (e as Error).constructor.name; }
export const bValue = "B";
export function readA(): string { return aValue; }
