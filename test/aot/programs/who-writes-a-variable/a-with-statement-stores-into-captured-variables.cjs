// A name inside a with statement is a property of the object or a variable around it, whichever the object says at that moment.
function a() { let x = 1; const g = () => x; const o = {}; with (o) { x = 2; } return [g(), o.x]; }
function b() { let x = 1; const g = () => x; const o = { x: 5 }; with (o) { x = 2; } return [g(), o.x]; }
function c(o) { let x = 1; const g = () => x; with (o) { x = 2; } return [g(), o.x]; }
function d() { let x = 1; const g = () => x; const o = { get x() { return 9; }, set x(v) { this.y = v; } }; with (o) { x = 2; } return [g(), o.y]; }
function e() { var x = 1; const g = () => x; const o = { x: 3, [Symbol.unscopables]: { x: true } }; with (o) { x = 2; } return [g(), o.x]; }
function f() { let x = 1; const g = () => x; const p = new Proxy({}, { has(t, k) { return k === "x" ? (x = 7, false) : false; } }); with (p) { x = x + 1; } return g(); }
function h() { let x = 1; const g = () => x; const o = { x: 1 }; with (o) { delete o.x; x = 4; } return [g(), o.x]; }
function i() { let x = 1; const g = () => x; const o = { x: 1 }; with (o) { x = (delete o.x, 4); } return [g(), o.x]; }
function j() { let x = 1; const set = () => { with ({}) { x = 5; } }; for (let k = 0; k < 3; k++) set(); return x; }
function k() { let x = 1; with ({}) { var inner = function () { x++; }; } inner(); inner(); return x; }
for (const fn of [a, b, () => c({}), () => c({ x: 0 }), d, e, f, h, i, j, k]) console.log(JSON.stringify(fn()));
let top = 1; function readTop() { return top; }
with ({}) { top = 2; } console.log(readTop());
with ({ top: 0 }) { top = 3; } console.log(readTop());
