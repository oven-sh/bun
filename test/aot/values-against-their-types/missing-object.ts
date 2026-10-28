declare const process: { argv: string[] };
interface P { v: number; }
const ps: P[] = [{ v: 1 }];
function v(a: P[], i: number): number { try { return a[i].v; } catch (e) { return -1; } }
console.log(v(ps, Number(process.argv[2] ?? 0)));
export {};
