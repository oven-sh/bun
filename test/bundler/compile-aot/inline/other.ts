export function fromOther(a: number, b: number) { return a * 10 + b; }
export function throwsInOther(what: string): never { throw new RangeError("other: " + what); }
export function callsBack(n: number) { return helperOfOther(n) + 1; }
function helperOfOther(n: number) { return n * 3; }
export let counter = 0;
export function bumps() { counter++; return counter; }
