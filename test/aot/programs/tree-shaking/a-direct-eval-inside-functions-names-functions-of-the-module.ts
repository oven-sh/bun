// eval is called inside a function, an arrow function, a method, a default value, a static block and a nested function. Each text names a function of the module that nothing else names.
function a() { return "from a function"; } function b() { return "from an arrow function"; } function c() { return "from a method"; }
function d() { return "from a default value"; } function e() { return "from a static block"; } function f() { return "from a nested function"; }
function g() { return "from a parenthesized eval"; } function h() { return "from a spread argument"; } function i() { return "from an optional call"; }

function inFunction() { return eval("a()"); }
const inArrow = () => eval("b()");
class Holder {
  static fromBlock: string;
  static { Holder.fromBlock = eval("e()"); }
  method() { return eval("c()"); }
}
function inDefault(value = eval("d()")) { return value; }
function outer() {
  return (function () { return (() => eval("f()"))(); })();
}
console.log(inFunction(), inArrow(), new Holder().method(), inDefault(), Holder.fromBlock, outer());
console.log((eval)("g()"), eval(...["h()"]));
