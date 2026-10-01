// Code run by direct eval sees the top-level variables of the chunk and what the chunk imports, from any file.
import { seenByEval, notSeenByEval } from "./pure7";
export function evaluate(code: string) { return eval(code); }
export function callsBoth() { return seenByEval(1) + notSeenByEval(2); }
