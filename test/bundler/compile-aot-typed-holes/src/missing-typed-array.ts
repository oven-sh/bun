declare const process: { argv: string[] };
const f: Float64Array[] = [new Float64Array(3)];
function len(a: Float64Array[], i: number): number { try { return a[i].length; } catch (e) { return -1; } }
console.log(len(f, Number(process.argv[2] ?? 0)));
export {};
