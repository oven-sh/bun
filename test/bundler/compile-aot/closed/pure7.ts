const show = (x: unknown) => typeof x + ":" + String(x);
export function seenByEval(x: number) { return "seenByEval " + show(x); }
export function notSeenByEval(x: number) { return "notSeenByEval " + show(x); }
