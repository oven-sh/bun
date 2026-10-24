// Under `with (scope)` a name belongs to the object if the object has it, and else to the scopes around. Here: a function of the module that the object does not have, one that it has, and one that it gets in between.
function notInScope() {
  return "the function of the module";
}
function shadowed() {
  return "the function of the module, shadowed";
}
function addedLater() {
  return "the function of the module, before the object had one";
}
function calledByNobodyElse() {
  return "named only under with, inside a function";
}

const scope = { shadowed: () => "the property of the object" };
with (scope) {
  console.log(notInScope());
  console.log(shadowed());
  console.log(addedLater());
  scope.addedLater = () => "the property that was added";
  console.log(addedLater());
}

function inner(object) {
  with (object) return calledByNobodyElse();
}
console.log(inner({}));
