// One statement declares several names. Of each statement some are used, some are not, and some have an initializer that does something. What is used has its value, and what does something does it, in the order written.
const log: string[] = [];
function effect(name: string) { log.push(name); return name; }

const used1 = 1, unused1 = 2, used2 = used1 + 1;
const unused2 = "a", does1 = effect("first"), unused3 = [1, 2], does2 = effect("second");
let unusedLet = 1, usedLet = 2, noInitializer: number | undefined;
var unusedVar = { a: 1 }, usedVar = { b: 2 };
const first = () => second(), second = () => "second is reached through first", third = () => "nobody calls third";
const chainA = 1, chainB = chainA + 1, chainC = chainB + 1, chainUnused = chainC + 1;
export const exportedUnused = 1, exportedDoes = effect("third"), exportedUsed = 3;
const { a, b } = { a: "a of a pattern", b: "b of a pattern" };
const [x, y] = ["x of a pattern", "y of a pattern"];
const { unusedP, unusedQ } = { unusedP: 1, unusedQ: 2 };
const [unusedR] = [1];
const { deep: { inner } } = { deep: { inner: "inner of a nested pattern" } };

console.log(used1, used2, usedLet, noInitializer, usedVar.b, first(), chainC, exportedUsed);
console.log(a, x, inner);
console.log(log.join());
