// `Array.from(arguments)`: a new array of what was passed, however the function uses `arguments` beside it; and the forms that are something else.
const show = value => JSON.stringify(value, (key, held) => held === undefined ? "undefined" : typeof held === "function" ? "function" : held);
function plain() { return Array.from(arguments); }
function withParameters(a, b) { return Array.from(arguments); }
function twice() { const one = Array.from(arguments), two = Array.from(arguments); one.push("pushed"); return [one, two, one === two]; }
function thenLength() { const list = Array.from(arguments); return [list, arguments.length, arguments[0]]; }
function mapped() { return Array.from(arguments, (value, index) => value + ":" + index); }
function mappedWithThis() { return Array.from(arguments, function (value) { return this.prefix + value; }, { prefix: ">" }); }
function undefinedMap() { return Array.from(arguments, undefined); }
function changedFirst() { arguments[0] = "changed"; return Array.from(arguments); }
function shortened() { arguments.length = 1; return Array.from(arguments); }
function ownIterator() { arguments[Symbol.iterator] = function* () { yield "mine"; }; return Array.from(arguments); }
function noIterator() { arguments[Symbol.iterator] = undefined; return Array.from(arguments); }
function escapes(keep) { keep.push(arguments); return Array.from(arguments); }
function viaAlias() { const args = arguments; return Array.from(args); }
function inArrow() { return (() => Array.from(arguments))(); }
function otherThis() { return Array.from.call(function (n) { this.made = "by another constructor"; }, arguments); }
function detached() { const from = Array.from; return from(arguments); }
function shadowed(Array) { return Array.from(arguments); }
function inLoop() { const out = []; for (let i = 0; i < 2; i++) out.push(Array.from(arguments)); return out; }
function inTry() { try { return Array.from(arguments); } finally { arguments.length; } }
function spreadIt() { return Math.max(...Array.from(arguments)); }
function sloppyLike(a) { a = "stored"; return Array.from(arguments); }
class Sub extends Array { static make() { return Sub.from(arguments); } }
for (const list of [[], [1], [1, 2, 3], [undefined, null], [1.5, "x", { a: 1 }], Array.from({ length: 70 }, (_, i) => i)]) {
  for (const [name, f] of Object.entries({ plain, withParameters, twice, thenLength, mapped, mappedWithThis, undefinedMap, changedFirst, shortened, ownIterator, noIterator, viaAlias, inArrow, otherThis, detached, inLoop, inTry, sloppyLike }))
    console.log(name, list.length, show(f(...list)), Array.isArray(f(...list)));
  const keep = []; console.log("escapes", show(escapes(keep, ...list).slice(1)), Object.prototype.toString.call(keep[0]), keep[0].length);
}
console.log(show(shadowed({ from(list) { return "shadowed " + list.length; } }, 1)), spreadIt(3, 9, 4), Sub.make(1, 2) instanceof Sub, show(Sub.make(1, 2)), plain(1) !== plain(1));
const holes = plain.apply(null, [, 1, , ]); console.log(show(holes), 0 in holes, holes.length);
let sum = 0; for (let i = 0; i < 100000; i++) sum += plain(i, i + 1, i + 2)[2]; console.log(sum);
