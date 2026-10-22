// (0, eval), eval?.(), an alias of eval, globalThis.eval and new Function run their text in the global scope, where the functions of a module are not. After `globalThis.shared = hidden` they find it under that name.
function hidden() {
  return "hidden";
}

console.log((0, eval)("typeof hidden"));
console.log(eval?.("typeof hidden"));
const alias = eval;
console.log(alias("typeof hidden"));
console.log(globalThis.eval("typeof hidden"));
console.log(new Function("return typeof hidden")());
console.log(Function("return typeof hidden")());

globalThis.shared = hidden;
console.log((0, eval)("shared()"), new Function("return shared()")());
