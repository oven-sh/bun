// The block of a switch hoists the functions of all its cases. `taken` calls `declaredInAnotherCase`, which stands under a case that never matches and behind a return. Plain Bun leaves the function where it is written and throws a ReferenceError, so the output is stored.
function helper() {
  return "helper";
}

function choose(n) {
  switch (n) {
    case 1:
      return declaredInAnotherCase();
    case 2:
      return "two";
      function declaredInAnotherCase() {
        return "declared in another case, " + helper();
      }
  }
}

console.log(choose(1));
