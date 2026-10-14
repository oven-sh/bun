declare const process: { argv: string[] };
const t: number[][] = [[5, 6]];
function f(a: number[][], i: number): string { let r: number[] = a[0]; try { r = a[i]; const n = r.length; return n + ":" + r[0]; } catch (e) { return "caught"; } }
console.log(f(t, Number(process.argv[2] ?? 0)));
export {};
