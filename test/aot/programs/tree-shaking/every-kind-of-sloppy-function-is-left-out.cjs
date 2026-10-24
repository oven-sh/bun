// The same for what only code outside strict mode may write: arguments that follow the parameters, callee and caller, a function in a block, a labeled function, delete of a name, a store to a name nobody declared, a parameter named eval, `this` that is the global object, and an old-style constructor with a prototype. Nothing calls them.
function usesCallee() { return arguments.callee.name + usesCallee.caller; }
function mappedArguments(a) { arguments[0] = 2; return a; }
function inBlock() { { function inner() { return 1; } } return inner(); }
function deletesName() { var x = 1; return delete x; }
function globalThisValue() { return this === globalThis; }
function assignsUndeclared() { undeclaredVariable = 1; return undeclaredVariable; }
function labeledFunction() { label: function inner() {} return typeof inner; }
function Old(name) { this.name = name; }
function evalAsName(eval) { return eval; }
var viaVar = function () { return 1; };
const constant = function () { return arguments.length; };

function used() { return "used"; }
console.log(used());
