import { calledBack, plain } from "./noobject";
export function far1(x: number) { return plain(x, 100); }
export function far2(x: number) { return far1(x) + inner(x); }
function inner(x: number) { return x + secret; }
let secret = 7;
export function mutual(x: number) { return calledBack(x) + inner(x); }
