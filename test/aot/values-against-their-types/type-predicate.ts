declare const process: { argv: string[] };
function isRow(x: unknown): x is number[] { return true; }
function f(v: unknown): string { try { if (isRow(v)) return String(v.length); return "no"; } catch (e) { return "caught"; } }
console.log(f(process.argv[2] === "1" ? undefined : [1, 2]));
export {};
