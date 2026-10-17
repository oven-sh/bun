// `<`, `<=`, `>` and `>=` on strings of lengths 0, 7, 8, 9, 16 and 17 that differ at every position.
declare const $vm: any;
const narrow = (text: string): string => text.split("").join("");
function typed(a: string, b: string): number { return (a < b ? 1 : 0) + (a <= b ? 2 : 0) + (a > b ? 4 : 0) + (a >= b ? 8 : 0); }
function any(a: any, b: any): number { return (a < b ? 1 : 0) + (a <= b ? 2 : 0) + (a > b ? 4 : 0) + (a >= b ? 8 : 0); }
const base = "abcdefghijklmnopq", out: number[] = [];
for (const m of [0, 7, 8, 9, 16, 17]) for (const n of [0, 7, 8, 9, 16, 17]) out.push(typed(narrow(base.slice(0, m)), narrow(base.slice(0, n))), any(narrow(base.slice(0, m)), narrow(base.slice(0, n))));
for (let at = 0; at < 17; at++) for (const unit of ["\u0000", "`", "z", "\u007f", "\u0080", "ÿ"]) for (const against of ["\u007f", "\u0080", "ÿ", base[at]!]) {
  const a = narrow(base.slice(0, at) + unit + base.slice(at + 1)), b = narrow(base.slice(0, at) + against + base.slice(at + 1));
  out.push(typed(a, b), any(b, a));
}
console.log(out.join(""));
