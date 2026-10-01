const show = (x: unknown) => typeof x + ":" + String(x);
export function askedForByName(x: number) { return "askedForByName " + show(x); }
export function askedForByNameToo(x: number) { return "askedForByNameToo " + show(x); }
export function notAskedFor(x: number) { return "notAskedFor " + show(x); }
