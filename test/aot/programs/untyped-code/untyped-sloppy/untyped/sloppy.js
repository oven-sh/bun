function aliased(a) { arguments[0] = "changed"; return a; }
function aliasedByCallee(a) { change(arguments); return a; }
function change(list) { list[0] = "changed"; }
function implicit() { undeclared = 5; var n = undeclared; return n; }
function evaluated() { var e = 0; eval("e = 'changed'"); return e; }
function redeclared() { var r = 1; var r = "s"; return r; }
function functionInBlock() { var before = typeof inner; { function inner() { } } return before + typeof inner; }
function parameterAndVar(p) { var p; return p; }
function parameterAndFunction(p) { function p() { } return typeof p; }
function each(f) { try { return String(f(3)); } catch (e) { return e.constructor.name; } }
module.exports = { run() { return [aliased, aliasedByCallee, implicit, evaluated, redeclared, functionInBlock, parameterAndVar, parameterAndFunction].map(each).join(); }, direct() { return [aliased(1), aliasedByCallee(1), parameterAndVar(3), parameterAndFunction(3)].join(); } };
