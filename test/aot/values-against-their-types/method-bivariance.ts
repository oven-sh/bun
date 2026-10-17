declare const process: { argv: string[] };
interface H { h(x: number[] | undefined): number; }
class I implements H { h(x: number[]): number { try { return x.length; } catch (e) { return -1; } } }
const hh: H = new I();
console.log(hh.h(process.argv[2] === "1" ? undefined : [1, 2]));
export {};
