export function farAdd(a: number, b: number) { return a + b; }
export function farArgs(a?: any, b?: any, c?: any) { return [a, b, c, arguments.length].join(); }
let calls = 0;
export function farCounts(a: number) { calls += a; return calls; }
export function farFirstFromNative(a: number, i: number) { return "far-first:" + a + ":" + i; }
export function farBack(n: number, acc: number) { return n ? nearAgain(n - 1, acc + 1) : acc; }
function nearAgain(n: number, acc: number) { return n ? farBack(n - 1, acc + 2) : acc; }
