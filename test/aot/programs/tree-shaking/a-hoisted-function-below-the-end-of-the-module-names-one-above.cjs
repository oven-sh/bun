// `above` is declared above the return of the module and named only by `below`, which stands below it: in code that never runs as statements, yet is hoisted and called.
function above() {
  return "above";
}
const constantAbove = () => "constant above";
class ClassAbove {
  method() {
    return "class above";
  }
}

console.log(below());
return;

function below() {
  return [above(), constantAbove(), new ClassAbove().method()].join(", ");
}
