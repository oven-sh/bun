declare const process: { argv: string[] };
class Stack extends Array<number> { top(): number { return this[this.length - 1]; } }
const s = new Stack(); s.push(1, 2, 3);
function len(a: number[]): number { return a.length; }
console.log(len(process.argv[2] === "1" ? s : [1]));
export {};
