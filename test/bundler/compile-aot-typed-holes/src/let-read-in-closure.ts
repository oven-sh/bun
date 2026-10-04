declare const process: { argv: string[] };
let x: number[];
function r(): number { try { return x.length; } catch (e) { return -1; } }
if (process.argv[2] === "1") console.log(r());
x = [1, 2];
console.log(r());
export {};
