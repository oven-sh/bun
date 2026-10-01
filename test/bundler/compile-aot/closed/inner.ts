const show = (x: unknown) => typeof x + ":" + String(x);
export function throughStar(x: number) { return "throughStar " + show(x); }
export function renamedInside(x: number) { return "renamedInside " + show(x); }
