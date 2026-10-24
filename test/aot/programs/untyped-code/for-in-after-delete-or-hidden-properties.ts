// `for..in` over ordinary objects whose properties do not lie one behind the other from the first slot on: one was deleted, some are named by symbols, some are not enumerable, some are accessors. The keys, their order and the values read under them are those of plain Bun, also where the loop changes the object, and listing the keys of such a shape takes no work anew each time.
declare const aotOperationCount: undefined | ((name: string) => number);
const counted = typeof aotOperationCount === "function" ? aotOperationCount : null;
const entered = () => counted ? counted("operationAOTForInKeys") + counted("operationAOTHasEnumerableProperty") : 0;
const mark = Symbol("mark");
const words = ["alpha", "beta", "gamma", "delta"];
function list(o: any): string { const seen: string[] = []; for (const k in o) seen.push(k + "=" + String(o[k])); return seen.join(); }
function sum(o: any): number { let n = 0; for (const k in o) n += o[k]; return n; }
const makers: [string, () => any][] = [
  ["deleted in the middle", () => { const o: any = { __proto__: null }; o[words[0]] = 1; o[words[1]] = 2; o[words[2]] = 3; delete o[words[1]]; return o; }],
  ["deleted first", () => { const o: any = {}; o.alpha = 1; o.beta = 2; o.gamma = 3; delete o.alpha; return o; }],
  ["deleted last", () => { const o: any = {}; o.alpha = 1; o.beta = 2; o.gamma = 3; delete o.gamma; return o; }],
  ["deleted and added again", () => { const o: any = {}; o.alpha = 1; o.beta = 2; delete o.alpha; o.alpha = 4; return o; }],
  ["deleted and another added", () => { const o: any = {}; o.alpha = 1; o.beta = 2; delete o.alpha; o.delta = 5; o.gamma = 6; return o; }],
  ["a symbol first", () => { const o: any = {}; o[mark] = 100; o.alpha = 1; o.beta = 2; return o; }],
  ["a symbol between", () => { const o: any = {}; o.alpha = 1; o[mark] = 100; o.beta = 2; return o; }],
  ["one that is not enumerable", () => { const o: any = {}; o.alpha = 1; Object.defineProperty(o, "hidden", { value: 100, enumerable: false, writable: true, configurable: true }); o.beta = 2; return o; }],
  ["an accessor", () => { const o: any = {}; o.alpha = 1; Object.defineProperty(o, "beta", { get() { return this.alpha + 1; }, enumerable: true, configurable: true }); o.gamma = 3; return o; }],
  ["inherits enumerable ones", () => { const o: any = Object.create({ inherited: 7, alpha: 8 }); o.alpha = 1; o.beta = 2; delete o.beta; o.gamma = 3; return o; }],
  ["all deleted", () => { const o: any = {}; o.alpha = 1; delete o.alpha; return o; }],
  ["out of line", () => { const o: any = {}; for (let i = 0; i < 12; i++) o["p" + i] = i; delete o.p3; delete o.p10; return o; }],
  ["with elements", () => { const o: any = {}; o.alpha = 1; o[1] = 10; o.beta = 2; delete o.alpha; return o; }],
  ["elements with a hole in front", () => ({ 1: 10, alpha: 1, beta: 2 })],
  ["elements without a hole", () => ({ 0: 10, 1: 11, alpha: 1, beta: 2 })],
  ["elements and a symbol", () => { const o: any = { 2: 10, alpha: 1 }; o[mark] = 100; o.beta = 2; return o; }],
  ["an element far out", () => { const o: any = { alpha: 1, beta: 2 }; o[100000] = 10; return o; }],
  ["an array with names", () => { const o: any = [10, , 12]; o.alpha = 1; o.beta = 2; delete o.alpha; return o; }],
  ["a function with names", () => { const o: any = function () {}; o.alpha = 1; o.beta = 2; delete o.alpha; return o; }],
];
for (const [name, make] of makers) console.log(name + ":", list(make()), "|", list(make()), "|", sum(make()), Object.keys(make()).join());
for (const [name, make] of makers) {
  const o = make(), seen: string[] = [];
  let step = 0;
  for (const k in o) { seen.push(k); if (step++ === 0) { delete o.gamma; delete o.p5; delete o[1]; o.late = 9; o[3] = 13; } }
  console.log(name + ", changed in the loop:", seen.join(), "|", list(o));
}
for (const [, make] of makers) for (let i = 0; i < 3; i++) sum(make());
const before = entered();
let total = 0;
for (let i = 0; i < 2000; i++) for (let m = 0; m < 9; m++) total += sum(makers[m][1]());
console.log(total, counted ? entered() - before < 200 : true);
