import { fromA, hoistedOfA, usedOnlyByB } from "./a.js";
export const seenByB = [];
export const fromB = "from b";
export const unusedOfB = { hoistedOfA };
export function hoistedOfB() { return "hoisted of b"; }
export const usedOnlyByA = "a constant of b that only a uses";
seenByB.push(hoistedOfA());
try {
  seenByB.push(fromA);
} catch (error) {
  seenByB.push(error.name + " for fromA");
}
try {
  seenByB.push(usedOnlyByB);
} catch (error) {
  seenByB.push(error.name + " for usedOnlyByB");
}
export const readLater = () => fromA + usedOnlyByB;
