export const used = "used";
export const unused = "unused";
const local = "renamed and used";
const localUnused = "renamed and unused";
export { local as renamedUsed, localUnused as unusedRenamed };
export class UsedClass { name() { return "UsedClass"; } }
export class UnusedClass { name() { return "UnusedClass"; } }
export const importedAndNeverRead = { a: 1 };
const inner = "reached through another constant";
export const usedThroughOther = { inner };
export const viaBarrel = "through a barrel";
export const unusedObject = { list: [1, 2, 3], nested: { deep: true } };
export let unusedLet = 1;
export var unusedVar = 2;
export const unusedArrow = () => unused;
export default { name: "a default export nobody reads" };
