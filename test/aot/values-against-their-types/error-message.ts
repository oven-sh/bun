declare const process: { argv: string[] };
interface P { v: number; }
const ps: P[] = [{ v: 1 }];
const rows: number[][] = [[1]];
function a(x: P[], i: number): string { try { return String(x[i].v); } catch (e) { return (e as Error).constructor.name + ": " + (e as Error).message; } }
function b(x: number[][], i: number): string { try { return String(x[i].length); } catch (e) { return (e as Error).constructor.name + ": " + (e as Error).message; } }
const i = Number(process.argv[2] ?? 0);
console.log(a(ps, i)); console.log(b(rows, i));
export {};
