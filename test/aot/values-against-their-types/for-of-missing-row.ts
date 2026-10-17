declare const process: { argv: string[] };
const t: number[][] = [[1, 2]];
function sum(a: number[][], i: number): number { let s = 0; try { for (const x of a[i]) s += x; } catch (e) { return -1; } return s; }
console.log(sum(t, Number(process.argv[2] ?? 0)));
export {};
