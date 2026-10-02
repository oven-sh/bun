const show = (x: unknown) => typeof x + ":" + String(x);
export function numbersFromBoth(x: number) { return "numbersFromBoth " + show(x); }
export function aStringFromTheOther(x: number) { return "aStringFromTheOther " + show(x); }
export function aStringFromHere(x: number) { return "aStringFromHere " + show(x); }
export function intsHereDoublesThere(x: number) { return "intsHereDoublesThere " + show(x * 2); }
export const anArrowOfBoth = (x: number, y?: string) => "anArrowOfBoth " + show(x) + show(y);
