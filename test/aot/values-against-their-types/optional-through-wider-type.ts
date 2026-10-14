declare const process: { argv: string[] };
const p = { a: 1 };
const q: {} = p;
const r: { a?: number[] } = process.argv[2] === "1" ? q : { a: [1, 2] };
function len(o: { a?: number[] }): string { try { return o.a ? String(o.a.length) : "none"; } catch (e) { return "caught"; } }
console.log(len(r));
export {};
