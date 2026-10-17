declare const process: { argv: string[] };
class S { s!: string; len(): number { try { return this.s.length; } catch (e) { return -1; } } }
const s = new S();
if (process.argv[2] !== "1") s.s = "abc";
console.log(s.len());
export {};
