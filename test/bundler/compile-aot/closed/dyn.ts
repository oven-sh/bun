import { numbersFromBoth, aStringFromTheOther, aStringFromHere, intsHereDoublesThere, anArrowOfBoth } from "./pure";
import { onlyImported, importedAndPassedAString, arrow } from "./lib";
import { throughStar } from "./star";
const show = (x: unknown) => typeof x + ":" + String(x);
export function byDynamicImport(x: number) { return "byDynamicImport " + show(x); }
export function calledHereWithNumbers(x: number) { return "calledHereWithNumbers " + show(x); }
export const here = calledHereWithNumbers(1) + calledHereWithNumbers(2.5);
export const shared = onlyImported(3) + importedAndPassedAString(4) + arrow(5) + throughStar(6);
const attempt = (f: () => string) => { try { return f(); } catch (e: any) { return "threw " + e?.name; } };
export const pure = [() => numbersFromBoth(1.5), () => aStringFromTheOther("s" as any), () => aStringFromHere(2), () => intsHereDoublesThere(0.25), () => anArrowOfBoth(1, "y")].map(attempt).join();
