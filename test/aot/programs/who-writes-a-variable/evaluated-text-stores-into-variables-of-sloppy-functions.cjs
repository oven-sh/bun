// Text handed to a direct eval assigns, declares and hides the variables, parameters and functions around the call.
function a() { let x = 1; const g = () => x; eval("x = 2"); return g(); }
function b(s) { let x = 1; const g = () => x; eval(s); return g(); }
function c(s) { var x = 1; eval(s); return x; }
function d(s) { let x = 1; function inner() { return eval(s); } inner(); return x; }
function e(s) { let x = 1; const inner = () => eval(s); inner(); return x; }
function f(x, s) { eval(s); return typeof x; }
function g(s) { const r = []; for (let i = 0; i < 3; i++) { r.push(() => i); eval(s); } return r.map(h => h()); }
function h(eval, s) { let x = 1; eval(s); return x; }
function i(s) { let x = 1; (eval)(s); return x; }
function j(s) { let x = 1; try { (0, eval)(s); } catch (e) { return [x, e.name]; } return [x, typeof globalThis.x]; }
function k(s) { let x = 1; with ({ eval }) { eval(s); } return x; }
function l(s) { let x = 1; try { throw 5; } catch (err) { eval(s); return [x, err]; } }
function m(s, y = eval(s)) { return [typeof x, y]; }
function n(s) { let x = 1; class C { f = eval(s); } new C(); return x; }
function o(s) { let x = 1; const gen = (function* () { yield eval(s); yield x; })(); gen.next(); return gen.next().value; }
async function p(s) { let x = 1; await null; eval(s); await null; return x; }
function q(s) { let x = 1; const e2 = eval; e2("var zz = 1"); eval?.(s.replace("x", "globalThis.yy")); return [x, globalThis.yy]; }
console.log(a(), b("x = 3"), c("var x = 4"), d("x = 5"), e("x = 6"), f(1, "function x() {}"), f(1, "var x = 'a'"));
console.log(JSON.stringify(g("i++")), h(eval, "x = 7"), h(s => 0, "x = 7"), i("x = 8"), JSON.stringify(j("x = 9")), k("x = 10"), JSON.stringify(l("x = 11; err = 12")));
console.log(JSON.stringify(m("var x = 1; 13")), n("x = 14"), o("x = 15"), JSON.stringify(q("x = 16")));
p("x = 17").then(v => console.log(v));
let top = 1; function readTop() { return top; } eval("top = 2"); console.log(readTop());
function viaTop(s) { eval(s); } viaTop("top = 3"); console.log(readTop());
function declared() { return 1; } function callDeclared() { return declared(); } eval("declared = function () { return 2; }"); console.log(callDeclared());
function shadow(s) { eval(s); return top; } console.log(shadow("var top = 'shadow'"), top);
function shadowFn(s) { eval(s); return declared(); } console.log(shadowFn("function declared() { return 'inner'; }"), declared());
