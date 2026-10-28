declare const process: { argv: string[] };
const table: number[][] = [[1, 2, 3], [4, 5]];
function rowLength(t: number[][], i: number): number { try { return t[i].length; } catch (e) { return -1; } }
const which = Number(process.argv[2] ?? 0);
console.log(rowLength(table, which));
export {};
