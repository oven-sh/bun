declare const process: { argv: string[] };
class C { xs: number[] = [1, 2]; size(): number { try { return this.xs.length; } catch (e) { return -1; } } }
const bare: C = Object.create(C.prototype);
console.log((process.argv[2] === "1" ? bare : new C()).size());
export {};
