declare const process: { argv: string[] };
const m: Record<string, number[]> = { a: [1, 2] };
function len(r: Record<string, number[]>, k: string): number { try { return r[k].length; } catch (e) { return -1; } }
console.log(len(m, process.argv[2] === "1" ? "zz" : "a"));
export {};
