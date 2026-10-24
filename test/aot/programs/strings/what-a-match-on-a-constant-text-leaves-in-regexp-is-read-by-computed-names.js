// replace, match and search on constant texts leave their last match in RegExp, and it is read by a computed name, by Reflect.get, by the getter itself and by text made at run time.
function f() { return "abc".replace(/(b)/, "x"); }
console.log(f());
const k = "$" + (Date.now() > 0 ? 1 : 2);
console.log(RegExp[k], RegExp["last" + "Match"], RegExp.lastParen);
function g() { return "hello world".match(/o (w)/)[1]; }
console.log(g(), Reflect.get(RegExp, "$1"), Object.getOwnPropertyDescriptor(RegExp, "$1").get.call(RegExp));
function h() { return "zzz".search(/(z)z/); }
console.log(h(), new Function("return RegExp.$1 + RegExp.leftContext + '|' + RegExp.rightContext")());
