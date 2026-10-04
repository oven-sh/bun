declare const process: { argv: string[] };
const x: number[] = JSON.parse(process.argv[2] === "1" ? "5" : "[1,2]");
function len(a: number[]): string { try { return String(a.length); } catch (e) { return "caught"; } }
console.log(len(x));
export {};
