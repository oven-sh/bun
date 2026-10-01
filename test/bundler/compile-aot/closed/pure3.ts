const show = (x: unknown) => typeof x + ":" + String(x);
export function viaStarReexport(x: number) { return "viaStarReexport " + show(x); }
export function twoStarsAway(x: number) { return "twoStarsAway " + show(x); }
