(function () {
function same(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
let object = { valueOf() { return 40; } };
let callable = function () { return 1; };
let values = [undefined, null, 5, 2.5, 0, -0, NaN, true, false, "text", "", object, callable];

function numberOrMissing(k) { return k === 0 ? undefined : k === 1 ? null : k === 2 ? 5 : k === 3 ? 2.5 : k === 4 ? 0 : k === 5 ? -0 : NaN; }

function notStrictlyUndefined(k) { let x = k === 0 ? undefined : k === 2 ? 5 : 2.5; if (x !== undefined) return x + 1; return -1; }
function notStrictlyUndefinedOf(x) { if (x !== undefined) return x + 1; return -1; }
function strictlyUndefined(k) { let x = k === 0 ? undefined : k === 2 ? 5 : 2.5; if (x === undefined) return -1; return x * 2; }
function strictlyUndefinedOf(x) { if (x === undefined) return -1; return x * 2; }
function notStrictlyNull(k) { let x = k === 1 ? null : k === 2 ? 5 : 2.5; if (x !== null) return x + 1; return -1; }
function notStrictlyNullOf(x) { if (x !== null) return x + 1; return -1; }
function notLooselyNull(k) { let x = k === 0 ? undefined : k === 1 ? null : k === 2 ? 5 : 2.5; if (x != null) return x + 1; return -1; }
function notLooselyNullOf(x) { if (x != null) return x + 1; return -1; }
function looselyNull(k) { let x = k === 0 ? undefined : k === 1 ? null : k === 2 ? 5 : 2.5; if (x == null) return -1; return x - 1; }
function looselyNullOf(x) { if (x == null) return -1; return x - 1; }
function coalesces(k) { let x = k === 0 ? undefined : k === 1 ? null : k === 2 ? 5 : k === 4 ? 0 : 2.5; return (x ?? 7) + 1; }
function coalescesOf(x) { return (x ?? 7) + 1; }
function truthy(k) { let x = k === 0 ? undefined : k === 1 ? null : k === 2 ? 5 : k === 4 ? 0 : k === 6 ? NaN : 2.5; if (x) return x + 1; return -1; }
function truthyOf(x) { if (x) return x + 1; return -1; }
function falsy(k) { let x = k === 0 ? undefined : k === 2 ? 5 : k === 4 ? 0 : 2.5; if (!x) return -1; return x + 1; }
function falsyOf(x) { if (!x) return -1; return x + 1; }
function and(k) { let x = k === 0 ? undefined : k === 2 ? 5 : k === 4 ? 0 : 2.5; return x && x + 1; }
function andOf(x) { return x && x + 1; }
function or(k) { let x = k === 0 ? undefined : k === 2 ? 5 : k === 4 ? 0 : 2.5; return (x || 9) + 1; }
function orOf(x) { return (x || 9) + 1; }
function conditional(k) { let x = k === 0 ? undefined : k === 2 ? 5 : 2.5; x = x === undefined ? 2 : x; return x * 3; }
function conditionalOf(x) { x = x === undefined ? 2 : x; return x * 3; }
for (let [narrowed, reference, kinds] of [
    [notStrictlyUndefined, notStrictlyUndefinedOf, [0, 2, 3]], [strictlyUndefined, strictlyUndefinedOf, [0, 2, 3]], [notStrictlyNull, notStrictlyNullOf, [1, 2, 3]],
    [notLooselyNull, notLooselyNullOf, [0, 1, 2, 3]], [looselyNull, looselyNullOf, [0, 1, 2, 3]], [coalesces, coalescesOf, [0, 1, 2, 3, 4]],
    [truthy, truthyOf, [0, 1, 2, 3, 4, 6]], [falsy, falsyOf, [0, 2, 3, 4]], [and, andOf, [0, 2, 3, 4]], [or, orOf, [0, 2, 3, 4]], [conditional, conditionalOf, [0, 2, 3]],
]) {
    for (let k of kinds)
        same(narrowed(k), reference(numberOrMissing(k)), narrowed.name + " of " + String(numberOrMissing(k)));
    for (let value of values)
        reference(value);
}

function typeofNumber(k) { let x = k === 0 ? "text" : k === 1 ? 5 : 2.5; if (typeof x === "number") return x + 1; return x.length; }
function typeofString(k) { let x = k === 0 ? "text" : k === 1 ? 5 : 2.5; if (typeof x === "string") return x.length; return x + 1; }
function typeofBoolean(k) { let x = k === 0 ? true : k === 1 ? 5 : 2.5; if (typeof x === "boolean") return x ? 100 : 200; return x + 1; }
function typeofUndefined(k) { let x = k === 0 ? undefined : k === 1 ? 5 : 2.5; if (typeof x === "undefined") return -1; return x + 1; }
function typeofObject(k) { let x = k === 0 ? null : k === 1 ? { v: 5 } : 2.5; if (typeof x === "object") return x ? x.v : -1; return x + 1; }
function typeofFunction(k) { let x = k === 0 ? () => 3 : k === 1 ? 5 : 2.5; if (typeof x === "function") return x(); return x + 1; }
same(typeofNumber(0), 4, "typeof number, a string"); same(typeofNumber(1), 6, "typeof number, an integer"); same(typeofNumber(2), 3.5, "typeof number, a double");
same(typeofString(0), 4, "typeof string, a string"); same(typeofString(1), 6, "typeof string, an integer"); same(typeofString(2), 3.5, "typeof string, a double");
same(typeofBoolean(0), 100, "typeof boolean, true"); same(typeofBoolean(1), 6, "typeof boolean, an integer"); same(typeofBoolean(2), 3.5, "typeof boolean, a double");
same(typeofUndefined(0), -1, "typeof undefined, undefined"); same(typeofUndefined(1), 6, "typeof undefined, an integer"); same(typeofUndefined(2), 3.5, "typeof undefined, a double");
same(typeofObject(0), -1, "typeof object, null"); same(typeofObject(1), 5, "typeof object, an object"); same(typeofObject(2), 3.5, "typeof object, a double");
same(typeofFunction(0), 3, "typeof function, a function"); same(typeofFunction(1), 6, "typeof function, an integer"); same(typeofFunction(2), 3.5, "typeof function, a double");

function stringOrMissing(k) { let x = k ? "text" : undefined; if (x !== undefined) return x.length; return -1; }
function objectOrMissing(k) { let x = k ? { v: 3 } : null; return x?.v; }
function arrayOrMissing(k) { let x = k ? [1, 2, 3] : undefined; if (!x) return 0; let s = 0; for (let i = 0; i < x.length; i++) s += x[i]; return s; }
same(stringOrMissing(1), 4, "a string"); same(stringOrMissing(0), -1, "no string");
same(objectOrMissing(1), 3, "an object"); same(objectOrMissing(0), undefined, "no object");
same(arrayOrMissing(1), 6, "an array"); same(arrayOrMissing(0), 0, "no array");

function afterTheJoin(k) { let x = k ? 5 : undefined; let seen = 0; if (x !== undefined) seen = x + 1; return seen + "," + x; }
same(afterTheJoin(1), "6,5", "after the join, a number"); same(afterTheJoin(0), "0,undefined", "after the join, undefined");
function otherBranch(k) { let x = k ? 5 : undefined; if (x !== undefined) return x + 1; return String(x); }
same(otherBranch(1), 6, "the branch that is narrowed"); same(otherBranch(0), "undefined", "the other branch");
function assignedInside(k) { let x = k ? 5 : undefined; if (x !== undefined) { x = k > 1 ? undefined : x; return String(x); } return "none"; }
same(assignedInside(1), "5", "assigned the same"); same(assignedInside(2), "undefined", "assigned undefined after the test"); same(assignedInside(0), "none", "not reached");
function loopInside(k, n) { let x = k ? 2 : undefined; let s = 0; if (x !== undefined) { for (let i = 0; i < n; i++) s += x * i; } return s; }
same(loopInside(1, 5), 20, "a loop where it is narrowed"); same(loopInside(0, 5), 0, "a loop that is not reached");
function testInsideLoop(n) { let s = 0; for (let i = 0; i < n; i++) { let x = i & 1 ? i : undefined; if (x !== undefined) s += x; else s -= 1; } return s; }
same(testInsideLoop(6), 6, "a test in a loop");
function changesInLoop(n) { let x = undefined; let s = 0; for (let i = 0; i < n; i++) { if (x !== undefined) s += x; x = i & 1 ? undefined : i; } return s; }
same(changesInLoop(6), 6, "a variable that a loop changes");
function nested(k) { let x = k === 0 ? undefined : k === 1 ? null : k === 2 ? 5 : "text"; if (x !== undefined) { if (x !== null) { if (typeof x === "number") return x + 1; return x.length; } return -2; } return -1; }
same(nested(0), -1, "nested, undefined"); same(nested(1), -2, "nested, null"); same(nested(2), 6, "nested, a number"); same(nested(3), 4, "nested, a string");
function returnsEarly(k) { let x = k === 0 ? undefined : k === 1 ? null : 5; if (x === undefined) return -1; if (x === null) return -2; return x + 1; }
same(returnsEarly(0), -1, "returns early, undefined"); same(returnsEarly(1), -2, "returns early, null"); same(returnsEarly(2), 6, "returns early, a number");
function catches(k) { let x = k ? 5 : undefined; try { if (x !== undefined) { if (k > 1) throw new Error("thrown"); return x + 1; } return -1; } catch { return String(x); } }
same(catches(1), 6, "in a try"); same(catches(2), "5", "in its catch"); same(catches(0), -1, "in a try, undefined");
function closesOver(k) { let x = k ? 5 : undefined; if (x !== undefined) return () => x + 1; return () => x; }
same(closesOver(1)(), 6, "a closure over it"); same(closesOver(0)(), undefined, "a closure over undefined");

function comparesWithNumber(k) { let x = k ? 5 : undefined; if (x === 5) return 1; return 0; }
function isNotUsedAfter(k) { let x = k ? 5 : undefined; if (x !== undefined) return 1; return 0; }
function testsParameter(x) { if (x !== undefined) return x + 1; return -1; }
same(comparesWithNumber(1), 1, "compared with a number"); same(isNotUsedAfter(0), 0, "not used after the test"); same(testsParameter("a"), "a1", "a parameter");

})();
console.log("passed");
