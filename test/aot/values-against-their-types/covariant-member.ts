declare const process: { argv: string[] };
interface Narrow { xs: number[]; }
interface Wide { xs: number[] | string; }
const n: Narrow = { xs: [1, 2] };
const wd: Wide = n;
if (process.argv[2] === "1") { try { wd.xs = "abcde"; } catch (e) { console.log("the store throws"); } }
function len(o: Narrow): number { try { return o.xs.length; } catch (e) { return -1; } }
console.log(len(n));
export {};
