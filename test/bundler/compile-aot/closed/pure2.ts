const show = (x: unknown) => typeof x + ":" + String(x);
export function viaNamedReexport(x: number) { return "viaNamedReexport " + show(x); }
export function notReexported(x: number) { return "notReexported " + show(x); }
export function renamedOnTheWay(x: number) { return "renamedOnTheWay " + show(x); }
