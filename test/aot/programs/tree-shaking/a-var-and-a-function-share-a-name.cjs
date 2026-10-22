// `var f;` beside `function f` leaves the function. `var g = ..` beside `function g` replaces it when the statement runs, and until then the function is what a call finds.
var kept;
function kept() {
  return "kept the function";
}
console.log(kept());

console.log(replaced());
var replaced = function () {
  return "the replacement, " + helperOfReplacement();
};
function replaced() {
  return "the declaration, " + helperOfDeclaration();
}
console.log(replaced());

function helperOfDeclaration() {
  return "helper of the declaration";
}
function helperOfReplacement() {
  return "helper of the replacement";
}
