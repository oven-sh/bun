declare const process: { argv: string[] };
interface P { xs: number[]; }
const p: P = { xs: [1, 2] };
if (process.argv[2] === "1") Object.defineProperty(p, "xs", { value: 5 });
function len(o: P): string { try { return String(o.xs.length); } catch (e) { return "caught"; } }
console.log(len(p));
export {};
