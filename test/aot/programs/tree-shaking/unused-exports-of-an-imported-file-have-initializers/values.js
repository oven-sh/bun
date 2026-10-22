export const log = [];
function effect(name) { log.push(name); return name; }

export const used = effect("used");
export const unusedCall = effect("an unused export with a call");
export const unusedMarked = /* @__PURE__ */ effect("an unused export with a call marked pure");
export const unusedPlain = 1;
export let unusedLet = effect("an unused let");
export var unusedVar = effect("an unused var");
export class UnusedClass { static field = effect("a static field of an unused exported class"); }
export default effect("an unused default export");
export const { unusedFromPattern = effect("a default in the pattern of an unused export") } = {};
