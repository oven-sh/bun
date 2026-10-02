import { seenByEval, notSeenByEval } from "./pure7";
export function evaluate(code: string) { return eval(code); }
export function callsBoth() { return seenByEval(1) + notSeenByEval(2); }
