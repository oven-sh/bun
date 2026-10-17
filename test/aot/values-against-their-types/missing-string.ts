declare const process: { argv: string[] };
const s: string[] = ["abc"];
function len(a: string[], i: number): number { try { return a[i].length; } catch (e) { return -1; } }
console.log(len(s, Number(process.argv[2] ?? 0)));
export {};
