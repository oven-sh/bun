declare const process: { argv: string[] };
const table: number[][] = [[1, 2, 3], [4, 5]];
function rowLength(t: number[][], i: number): string { const row: number[] = t[i]; try { return "ok " + row.length; } catch (e) { return "caught " + typeof row; } }
const which = Number(process.argv[2] ?? 0);
console.log(rowLength(table, which));
export {};
