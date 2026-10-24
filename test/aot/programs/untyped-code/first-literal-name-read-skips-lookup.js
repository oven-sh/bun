// Objects that still have the shape their literal or their constructor gave them are read by name: names that are their own, names that are nowhere, names that only a prototype has.
function point(i) { return { x: i, y: i + 1, z: i + 2 }; }
function pair(i) { return { first: i, second: "s" + i }; }
function wide(i) { return { a: i, b: i, c: i, d: i, e: i, f: i, g: i, h: i, i: i, j: i }; }
function Made(i) { this.left = i; this.right = i + 1; }
class Built { constructor(i) { this.top = i; this.bottom = i + 1; } }
function sumOfPoint(o, turns) { let s = 0; for (let i = 0; i < turns; i++) s += o.x + o.y + o.z; return s; }
function textOfPair(o, turns) { let s = ""; for (let i = 0; i < turns; i++) s = o.first + o.second; return s; }
function sumOfWide(o, turns) { let s = 0; for (let i = 0; i < turns; i++) s += o.a + o.e + o.j; return s; }
function sumOfMade(o, turns) { let s = 0; for (let i = 0; i < turns; i++) s += o.left + o.right; return s; }
function sumOfBuilt(o, turns) { let s = 0; for (let i = 0; i < turns; i++) s += o.top + o.bottom; return s; }
function absentOn(o, turns) { let n = 0; for (let i = 0; i < turns; i++) n += o.nowhere === undefined && o.then === undefined ? 1 : 0; return n; }
console.log(sumOfPoint(point(1), 100), textOfPair(pair(2), 100), sumOfWide(wide(3), 100));
console.log(absentOn(point(1), 100), absentOn(pair(2), 100), absentOn(wide(3), 100));
console.log(sumOfMade(new Made(4), 100), sumOfBuilt(new Built(5), 100), absentOn(new Made(4), 100), absentOn(new Built(5), 100));

// What the compiler wrote down says nothing of these.
function named(o, turns) { let seen; for (let i = 0; i < turns; i++) seen = [typeof o.toString, typeof o.constructor, typeof o.hasOwnProperty, typeof o.valueOf, o.x, o.nowhere].join(); return seen; }
console.log(named(point(1), 50));
console.log(named({ __proto__: null, x: 1 }, 50));
console.log(named({ __proto__: { nowhere: "inherited", x: "hidden" }, x: 2 }, 50));
console.log(named({ __proto__: { nowhere: "inherited", x: "shown" }, y: 2 }, 50));
const moved = point(3);
console.log(named(moved, 50));
Object.setPrototypeOf(moved, { nowhere: "after the move" });
console.log(named(moved, 50), named(point(4), 50));
const grown = point(5);
grown.nowhere = "added";
console.log(named(grown, 50), named(point(6), 50));
const shrunk = point(7);
delete shrunk.x;
console.log(named(shrunk, 50), named(point(8), 50));
const redefined = point(9);
Object.defineProperty(redefined, "x", { get() { return "from a getter"; } });
console.log(named(redefined, 50), named(point(10), 50));
const frozen = Object.freeze(point(11));
console.log(named(frozen, 50), sumOfPoint(frozen, 50));
Made.prototype.nowhere = "on the prototype of a function";
Built.prototype.nowhere = "on the prototype of a class";
function nowhereOf(o, turns) { let seen; for (let i = 0; i < turns; i++) seen = o.nowhere; return seen; }
console.log(nowhereOf(new Made(1), 50), "|", nowhereOf(new Built(1), 50), "|", nowhereOf(point(1), 50));
function half(flag) { const o = { early: 1, late: undefined }; if (flag) o.late = 2; return o; }
function lates(o, turns) { let seen; for (let i = 0; i < turns; i++) seen = o.late; return seen; }
console.log(lates(half(false), 50), lates(half(true), 50));
