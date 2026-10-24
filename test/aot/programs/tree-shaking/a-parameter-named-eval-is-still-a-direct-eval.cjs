// Outside strict mode a parameter or a variable may be named eval. A call of that name is a direct eval whenever the value is the real eval, so its text sees the functions of the module.
function seenThroughParameter() {
  return "seen through a parameter";
}
function seenThroughVariable() {
  return "seen through a variable";
}
function seenUnderWith() {
  return "seen under with";
}

function byParameter(eval) {
  return eval("seenThroughParameter()");
}
console.log(byParameter(globalThis.eval));

function byVariable() {
  var eval = globalThis.eval;
  return eval("seenThroughVariable()");
}
console.log(byVariable());

function underWith(scope) {
  with (scope) return eval("seenUnderWith()");
}
console.log(underWith({ eval: globalThis.eval }));
