// Outside strict mode more things take a store: a class, a function declaration, a function's own name, a variable that a function in a block shares its name with. Nothing reads them. `delete` and `typeof` of a variable name it without reading its value.
const log = [];
function effect(name) { log.push(name); return name; }

class Klass {}
Klass = effect("a store to a class");
function declared() {}
declared = effect("a store to a function");
var shared = 1;
{
  function shared() {}
}
var sharedInArm = 1;
if (log.length) {
  function sharedInArm() {}
}
var deleted = 1;
log.push("delete of a variable: " + delete deleted);
var onlyTypeof = 1;
log.push("typeof of a variable: " + typeof onlyTypeof);
let onlyTypeofLet = "text";
log.push("typeof of a let: " + typeof onlyTypeofLet);
var twice = 1;
var twice = effect("a var declared twice");
var thenFunction = 1;
function thenFunction() {}
undeclared = effect("a store to a name nobody declared");

console.log(log.join("\n"));
