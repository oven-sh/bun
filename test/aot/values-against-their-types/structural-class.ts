declare const process: { argv: string[] };
class C { xs: number[] = [1, 2]; size(): number { return this.xs.length; } }
const other: C = { xs: [1, 2, 3], size() { return 7; } };
function ask(o: C): string { return o.size() + ":" + o.xs.length; }
console.log(ask(process.argv[2] === "1" ? other : new C()));
export {};
