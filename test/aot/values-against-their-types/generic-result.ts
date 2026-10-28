declare const process: { argv: string[] };
function parse<T>(s: string): T { return JSON.parse(s); }
function f(s: string): string { try { return String(parse<number[]>(s).length); } catch (e) { return "caught"; } }
console.log(f(process.argv[2] === "1" ? "null" : "[1,2]"));
export {};
