function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
let kept = [];
function keeps(o) { kept.push(o); return o; }
noInline(keeps);

function picksOfTwo(c, a, b) { const o = c ? { x: a, y: 1 } : { x: b, y: 2 }; return o.x + ":" + o.y; }
function picksOfThree(k, a) { let o; if (k === 0) o = { v: a, w: "zero" }; else if (k === 1) o = { v: a * 2.5, w: "one" }; else o = { v: -0, w: "other" }; return o.w + 1 / o.v; }
function readsOne(c, a) { const o = c ? { used: a, unused: keeps({ a }) } : { used: -a, unused: null }; return o.used; }
function readsAbsent(c) { const o = c ? { x: 1 } : { x: 2 }; return String(o.missing) + o.x; }
function testsForNull(c) { const o = c ? { x: 1 } : { x: 2 }; if (o == null) return "null"; return o?.x; }
function destructures(c, a) { const { p, q } = c ? { p: a, q: "left" } : { p: a + 1, q: "right" }; return q + p; }
function carriesThroughLoop(n) { let o = { count: 0, last: "none" }; for (let i = 0; i < n; ++i) o = { count: o.count + i, last: "i" + i }; return o.count + o.last; }
function nests(c, a) { const o = c ? { inner: { z: a }, tag: 1 } : { inner: { z: -a }, tag: 2 }; return o.inner.z * o.tag; }
function evaluatesInOrder(c) { let order = []; const note = v => (order.push(v), v); const o = c ? { a: note(1), b: note(2) } : { a: note(3), b: note(4) }; return order.join() + ":" + o.b + o.a; }

check(picksOfTwo(true, "a", "b"), "a:1", "the first of two");
check(picksOfTwo(false, "a", "b"), "b:2", "the second of two");
check(picksOfTwo(true, 1.5, {}), "1.5:1", "a number");
check(picksOfThree(0, 4), "zero0.25", "the first of three");
check(picksOfThree(1, 4), "one0.1", "the second of three");
check(picksOfThree(2, 4), "other-Infinity", "negative zero stays negative zero");
check(readsOne(true, 5), 5, "one property is read");
check(kept.length, 1, "the value of a property that is not read is still evaluated");
check(readsOne(false, 5), -5, "one property is read");
check(readsAbsent(true), "undefined1", "a property that neither has");
check(testsForNull(false), 2, "tests for null");
check(destructures(true, 1), "left1", "destructuring");
check(destructures(false, 1), "right2", "destructuring");
check(carriesThroughLoop(0), "0none", "no iteration");
check(carriesThroughLoop(4), "6i3", "four iterations");
check(nests(true, 3), 3, "nested literals");
check(nests(false, 3), -6, "nested literals");
check(evaluatesInOrder(true), "1,2:21", "order of evaluation");
check(evaluatesInOrder(false), "3,4:43", "order of evaluation");

function otherNames(c) { const o = c ? { x: 1, y: 2 } : { x: 1, z: 2 }; return o.x; }
function otherOrder(c) { const o = c ? { x: 1, y: 2 } : { y: 2, x: 1 }; return o.x + Object.keys(c ? { x: 1, y: 2 } : { y: 2, x: 1 }).join(); }
function oneIsGiven(c, given) { const o = c ? { x: 1 } : given; return o.x; }
function oneIsShared(c) { const first = { x: 1 }; const o = c ? first : { x: 2 }; return o.x + first.x; }
function isReturned(c) { const o = c ? { x: 1 } : { x: 2 }; return o; }
function isPassed(c) { const o = c ? { x: 1 } : { x: 2 }; return keeps(o).x; }
function isWritten(c) { const o = c ? { x: 1 } : { x: 2 }; o.x += 10; return o.x; }
function isCompared(c, other) { const o = c ? { x: 1 } : { x: 2 }; return o === other; }
function isCaptured(c) { const o = c ? { x: 1 } : { x: 2 }; return () => o.x; }
function isEnumerated(c) { const o = c ? { x: 1 } : { x: 2 }; let names = ""; for (let name in o) names += name; return names; }
function readsInherited(c) { const o = c ? { x: 1 } : { x: 2 }; return typeof o.toString; }
function readsByValue(c, key) { const o = c ? { x: 1 } : { x: 2 }; return o[key]; }
function hasGetter(c) { const o = c ? { get x() { return 1; } } : { get x() { return 2; } }; return o.x; }
check(otherNames(true) + otherNames(false), 2, "other names");
check(otherOrder(true), "1x,y", "another order");
check(otherOrder(false), "1y,x", "another order");
check(oneIsGiven(false, { x: 7 }), 7, "one is given");
check(oneIsShared(true), 2, "one has another user");
check(isReturned(false).x, 2, "returned");
check(isPassed(true), 1, "passed");
check(isWritten(false), 12, "written");
check(isCompared(true, {}), false, "compared");
check(isCaptured(false)(), 2, "captured");
check(isEnumerated(true), "x", "enumerated");
check(readsInherited(true), "function", "an inherited property");
check(readsByValue(false, "x"), 2, "read by value");
check(hasGetter(false), 2, "a getter");
console.log("passed");
