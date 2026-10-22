// A RegExp literal that must be a new object at every evaluation (`g`, `y`, or an object that escapes) is allocated without a call into the runtime once its pattern exists. Every evaluation still gives an object of its own: `lastIndex` 0, writable, extensible, no property of an earlier one.
// Only the jsc shell with --aotCountsPath=<path> can count: there `few calls` is false if the 30,000 evaluations enter operationAOTNewRegExpLiteral more than 1,000 times (an empty free list enters it). Elsewhere the program checks the answers alone.
const count: (name: string) => number = (globalThis as any).aotOperationCount ?? (() => 0);
const literalCalls = () => count("operationAOTNewRegExpLiteral");

function sumOfNumbers(text: string) {
  const digits = /\d+/g;
  let sum = 0;
  for (let match = digits.exec(text); match; match = digits.exec(text)) sum += Number(match[0]);
  return sum;
}
function wordLength(text: string) {
  const word = /[a-z]+/y;
  return word.test(text) ? word.lastIndex : -1;
}
function create(): RegExp {
  return /a(b)?/i;
}

const texts = ["12 and 30", "none", "7", "cab 1 2 3 4"];
const recent: RegExp[] = [];
function evaluateEach(turn: number) {
  const text = texts[turn % texts.length];
  const created = create();
  recent[turn % 8] = created;
  return sumOfNumbers(text) + wordLength(text) + (created.test(text) ? 1 : 0) + created.lastIndex;
}
let warmUp = 0;
for (let turn = 0; turn < 8; turn++) warmUp += evaluateEach(turn);
const before = literalCalls();
let total = 0;
for (let turn = 0; turn < 10000; turn++) total += evaluateEach(turn);
console.log(warmUp, total, new Set(recent).size, "few calls", literalCalls() - before < 1000);

const first = create();
const second = create();
console.log(first === second, first.source, first.flags, first.lastIndex, first instanceof RegExp, Object.getPrototypeOf(first) === RegExp.prototype);
(first as any).mine = 1;
first.lastIndex = 5;
Object.freeze(first);
const third = create();
console.log((third as any).mine, third.lastIndex, Object.isFrozen(third), Object.isExtensible(third), Object.getOwnPropertyDescriptor(third, "lastIndex")!.writable);
third.lastIndex = 3;
console.log(first.lastIndex, third.lastIndex, create().lastIndex, JSON.stringify(third.exec("xAB")), JSON.stringify(first.exec("xa")));

const held: RegExp[] = [];
for (let index = 0; index < 10000; index++) {
  const pattern = create();
  pattern.lastIndex = index;
  held.push(pattern);
  sumOfNumbers("1 22 333");
}
let intact = 0;
for (let index = 0; index < held.length; index++) {
  const pattern = held[index];
  if (pattern.lastIndex === index && pattern.source === "a(b)?" && pattern.exec("xAB")![1] === "B") intact++;
}
console.log(intact, new Set(held).size);
