import { fromB, hoistedOfB, usedOnlyByA } from "./b.js";
export const seenByA = [];
export const fromA = "from a";
export const unusedOfA = { fromB };
export function hoistedOfA() { return "hoisted of a"; }
export const usedOnlyByB = "a constant of a that only b uses";
seenByA.push(fromB, hoistedOfB(), usedOnlyByA);
export const tableOfA = { b: fromB };
const localUnused = [fromA];
