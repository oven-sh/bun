// Text evaluated at run time reads two fields of objects that compiled code made: a string, and a number that may be undefined. A read of the second may cost a few times a read of the first, not three times.
class Row { whole: number; fraction: number; flag: boolean; text: string; list: number[]; any: unknown; inner: { a: number }; maybe: number | undefined;
    constructor(i: number) { this.whole = i | 0; this.fraction = i + 0.5; this.flag = (i & 1) === 0; this.text = "t" + i; this.list = [i]; this.any = i & 1 ? "s" : i; this.inner = { a: i }; this.maybe = i & 1 ? undefined : i; } }
const rows = [new Row(1), new Row(2)];
const loop = (read: string) => new Function("rows", "n", `let t = 0; for (let i = 0; i < n; i++) { const r = rows[i & 1]; ${read} } return t;`);
const none = loop(""), text = loop("if (r.text === undefined) t++;"), maybe = loop("if (r.maybe === undefined) t++;");
function fastestOf(run: Function) { let fastest = Infinity; for (let turn = 0; turn < 5; turn++) { const began = performance.now(); run(rows, 400000); fastest = Math.min(fastest, performance.now() - began); } return fastest; }
const base = fastestOf(none), one = fastestOf(text) - base, other = fastestOf(maybe) - base;
console.log(other < Math.max(one, base / 20) * 3 ? "under three times a read of the string" : "over three times a read of the string");
