// TypeScript narrows `current` to number at the assignment and does not see that the call undoes it, so undefined reaches a parameter of type number.
let current: number | undefined = 3;
function clear(): void { current = undefined; }
function plusOne(n: number): number { return n + 1; }
function twice(n: number): number { return n * 2; }
function inText(n: number): string { return `${n + 1}`; }
function pick(n: number): number | undefined { return [10, 20, 30][n + 1]; }
function name(n: number): string { switch (n + 1) { case 0: return "zero"; case 4: return "four"; default: return "other"; } }
console.log((() => { current = 3; clear(); return plusOne(current); })());
console.log((() => { current = 3; clear(); return twice(current); })(), (() => { current = 3; clear(); return inText(current); })());
console.log((() => { current = 3; clear(); return pick(current); })(), (() => { current = 3; clear(); return name(current); })());
