// In a sloppy function a store into the arguments object, by an operation or by a built-in, changes the parameter that a closure has captured.
function w(o, v) { o[0] = v; }
function a(p) { arguments[0] = 2; return p; }
function b(p) { const g = () => p; arguments[0] = 2; return g(); }
function c(p) { const g = () => p; w(arguments, 3); return g(); }
function d(p) { const g = () => p; Array.prototype.fill.call(arguments, 4); return g(); }
function e(p) { const g = () => p; Object.assign(arguments, [5]); return g(); }
function f(p) { const g = () => p; Reflect.set(arguments, 0, 6); return g(); }
function h(p) { const g = () => p; Object.defineProperty(arguments, 0, { value: 7 }); return g(); }
function i(p) { const g = () => p; delete arguments[0]; arguments[0] = 8; return g(); }
function j(p, q) { const g = () => [p, q]; Array.prototype.reverse.call(arguments); return g(); }
function k(p, q) { const g = () => [p, q]; Array.prototype.sort.call(arguments); return g(); }
function l(p, q) { const g = () => [p, q]; Array.prototype.shift.call(arguments); return g(); }
function m(p, q) { const g = () => [p, q]; Array.prototype.copyWithin.call(arguments, 0, 1); return g(); }
function n(p) { const g = () => p; const s = v => { p = v; }; s(9); return [g(), arguments[0]]; }
function o(p) { const g = () => p; Object.defineProperty(arguments, 0, { writable: false }); arguments[0] = 10; p = 11; return [g(), arguments[0]]; }
function q(p) { const g = () => p; Object.freeze(arguments); p = 12; return [g(), arguments[0]]; }
function r(p) { const g = () => p; const k2 = "0"; arguments[k2] = 13; return g(); }
function s(p) { const g = () => p; for (const key in arguments) arguments[key] = 14; return g(); }
function t(p) { const g = () => p; new Proxy(arguments, {})[0] = 15; return g(); }
function u(p) { const g = () => p; Array.prototype.splice.call(arguments, 0, 1, 16); return g(); }
function v(p) { const g = () => p; [arguments[0]] = [17]; return g(); }
function x(p) { const g = () => p; ({ z: arguments[0] } = { z: 18 }); return g(); }
function y(p) { const g = () => p; arguments[0]++; return g(); }
function z(p) { const g = () => p; with (arguments) { length = 0; } arguments[0] = 19; return g(); }
function aa(p) { let sum = 0; for (let i2 = 0; i2 < 5; i2++) { arguments[0] = i2; sum += p; } return sum; }
function bb(p) { "use strict"; const g = () => p; arguments[0] = 20; return g(); }
function cc(p = 1) { const g = () => p; arguments[0] = 21; return g(); }
function dd(p) { const g = () => p; JSON.parse("[22]", function (key, val) { if (key === "0") w(dd.args, val); return val; }); return g(); }
function ee(p) { dd.args = arguments; return dd.call(null, 0), p; }
for (const fn of [a, b, c, d, e, f, h, i, n, o, q, r, s, t, u, v, x, y, z, aa, bb, cc]) console.log(fn.name, JSON.stringify(fn(1)));
for (const fn of [j, k, l, m]) console.log(fn.name, JSON.stringify(fn(2, 1)));
console.log(ee(1));
