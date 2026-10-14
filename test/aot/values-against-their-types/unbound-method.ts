declare const process: { argv: string[] };
class C { xs: number[] = [1, 2]; size(): number { try { return this.xs.length; } catch (e) { return -1; } } }
const c = new C();
const f = c.size;
console.log(process.argv[2] === "1" ? f() : c.size());
export {};
