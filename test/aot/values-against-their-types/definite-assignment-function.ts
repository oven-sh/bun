declare const process: { argv: string[] };
class F { cb!: () => number; f(): number { try { return this.cb(); } catch (e) { return -1; } } }
const f = new F();
if (process.argv[2] !== "1") f.cb = () => 5;
console.log(f.f());
export {};
