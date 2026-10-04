declare const process: { argv: string[] };
class B { items!: number[]; size(): number { try { return this.items.length; } catch (e) { return -1; } } }
const b = new B();
if (process.argv[2] !== "1") b.items = [1, 2];
console.log(b.size());
export {};
