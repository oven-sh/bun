declare const process: { argv: string[] };
const rows: number[][] = [[1, 2, 3]];
const wider: (number[] | string)[] = rows;
if (process.argv[2] === "1") wider.push("abcde");
function last(t: number[][]): number { try { return t[t.length - 1].length; } catch (e) { return -1; } }
console.log(last(rows));
export {};
