// Every use stands above the declaration: a call at the top level, a class that extends the result of a call, a default export, a property of an object.
console.log(declaredLast());
const table = { entry: declaredInTable };
console.log(table.entry());
class Derived extends makeBase() {}
console.log(new Derived().hello());

function makeBase() {
  return class {
    hello() {
      return greeting();
    }
  };
}
function greeting() {
  return "hello from the base";
}
function declaredInTable() {
  return "declared in table";
}
function declaredLast() {
  return "declared last";
}
