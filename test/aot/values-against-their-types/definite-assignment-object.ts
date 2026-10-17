declare const process: { argv: string[] };
class L { v: number = 3; next!: L; f(): number { try { return this.next.v; } catch (e) { return -1; } } }
const l = new L();
if (process.argv[2] !== "1") l.next = new L();
console.log(l.f());
export {};
