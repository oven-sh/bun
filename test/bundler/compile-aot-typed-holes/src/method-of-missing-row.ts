declare const process: { argv: string[] };
const t: number[][] = [[1]];
function add(a: number[][], i: number): number { try { return a[i].push(7); } catch (e) { return -1; } }
console.log(add(t, Number(process.argv[2] ?? 0)));
export {};
