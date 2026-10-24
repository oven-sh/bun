// A closure in a default value does not see the `var` of the body: the parameters have a scope of their own. So `pick` and `other` there are the functions of the module, which nothing else names.
function pick() {
  return "the function of the module";
}
function other() {
  return "the other function of the module";
}

function withVar(read = () => pick()) {
  var pick = () => "the variable of the body";
  return read() + " / " + pick();
}

function withFunction(read = () => other()) {
  function other() {
    return "the function of the body";
  }
  return read() + " / " + other();
}

console.log(withVar());
console.log(withFunction());
