declare const process: { argv: string[] };
const m = new Map<string, number[]>([["a", [1, 2]]]);
function len(k: string): number { try { return m.get(k)!.length; } catch (e) { return -1; } }
console.log(len(process.argv[2] === "1" ? "zz" : "a"));
export {};
