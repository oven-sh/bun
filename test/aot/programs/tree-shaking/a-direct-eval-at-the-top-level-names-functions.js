// The text given to eval is the only place that names these functions, a class and a function constant of the module.
function declared() {
  return "declared, " + calledByDeclared();
}
function calledByDeclared() {
  return "called by declared";
}
const constant = () => "constant";
class Klass {
  method() {
    return "method";
  }
}

console.log(eval("declared()"));
console.log(eval("cons" + "tant()"));
console.log(eval("new Klass().method()"));
