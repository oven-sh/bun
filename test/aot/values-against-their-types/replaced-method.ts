declare const process: { argv: string[] };
class C { xs: number[] = [1, 2]; size(): number { return this.xs.length; } }
const c = new C();
if (process.argv[2] === "1") c.size = function () { return 42; };
if (process.argv[2] === "2") C.prototype.size = function () { return 43; };
function ask(o: C): number { return o.size(); }
console.log(ask(c));
export {};
