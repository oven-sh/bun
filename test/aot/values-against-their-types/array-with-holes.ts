declare const process: { argv: string[] };
const t: number[][] = new Array<number[]>(3);
t[0] = [1, 2];
function len(a: number[][], i: number): number { try { return a[i].length; } catch (e) { return -1; } }
console.log(len(t, Number(process.argv[2] ?? 0)));
export {};
