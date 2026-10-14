declare const process: { argv: string[] };
interface O { xs?: number[]; }
const o: O = { xs: [1, 2] };
function clear(x: O): void { if (process.argv[2] === "1") x.xs = undefined; }
function f(x: O): number { try { if (x.xs) { clear(x); return x.xs.length; } return 0; } catch (e) { return -1; } }
console.log(f(o));
export {};
