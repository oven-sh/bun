const show = (x: unknown) => typeof x + ":" + String(x);
export function insideANamespace(x: number) { return "insideANamespace " + show(x); }
