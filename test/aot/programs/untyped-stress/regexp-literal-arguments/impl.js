function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

function replacesLiteral(text) { let s = "" + text; let r = s.replace(/a/g, "b"); return r ? r : "empty"; }
function replacesAllLiteral(text) { let s = "" + text; let r = s.replaceAll(/a/g, ""); return r ? r : "empty"; }
function replacesWithCallback(text) { let s = "" + text; let r = s.replace(/[ab]/g, found => found === "a" ? "" : 7); return r ? r : "empty"; }
function splitsAtLiteral(text) { let s = "" + text; return s.split(/,\s*/).length; }
function searchesLiteral(text) { let s = "" + text; return s.search(/b+/) >= 0 ? "found" : "missing"; }
function replacesNamedLiteral(text) { let s = "" + text; const pattern = /a/; let r = s.replace(pattern, "b"); return r ? r : "empty"; }
function replacesInLoop(text, count) { let s = "" + text; const pattern = /a/g; let total = 0; for (let i = 0; i < count; ++i) total += s.replace(pattern, "bb").length; return total; }
function replacesLiteralInLoop(text, count) { let s = "" + text; let total = 0; for (let i = 0; i < count; ++i) total += s.replace(/a/g, "bb").length; return total; }
const typed = [replacesLiteral, replacesAllLiteral, replacesWithCallback, splitsAtLiteral, searchesLiteral, replacesNamedLiteral, replacesInLoop, replacesLiteralInLoop];
for (let f of typed)
    noInline(f);

check([replacesLiteral("banana"), replacesLiteral(""), replacesLiteral("xyz")].join(), "bbnbnb,empty,xyz", "replace with a literal");
check([replacesAllLiteral("banana"), replacesAllLiteral("aaa")].join(), "bnn,empty", "replaceAll with a literal");
check([replacesWithCallback("abc"), replacesWithCallback("aa")].join(), "7c,empty", "replace with a literal and a function");
check([splitsAtLiteral("a, b,c"), splitsAtLiteral(""), splitsAtLiteral("abc")].join(), "3,1,1", "split at a literal");
check([searchesLiteral("abc"), searchesLiteral("xyz"), searchesLiteral("")].join(), "found,missing,missing", "search for a literal");
check(replacesNamedLiteral("aa"), "ba", "replace with a literal in a variable");
check(replacesInLoop("aba", 3), 15, "replace with the same literal several times");
check(replacesLiteralInLoop("aba", 3), 15, "replace with a literal in a loop");

function touch(pattern) { pattern[Symbol.replace] = function () { return 42; }; }
noInline(touch);
function ownReplace() { const pattern = /b/; pattern[Symbol.replace] = function () { return 42; }; const r = "abc".replace(pattern, "y"); return r === 42; }
function ownReplaceAndSum() { const pattern = /b/; pattern[Symbol.replace] = function () { return 42; }; return "abc".replace(pattern, "y") + "!"; }
function ownReplaceForAll() { const pattern = /b/g; pattern[Symbol.replace] = function () { return null; }; const r = "abc".replaceAll(pattern, "y"); return r === null; }
function ownSplit() { const pattern = /b/; pattern[Symbol.split] = function () { return "not an array"; }; const r = "abc".split(pattern); return typeof r === "string" ? r === "not an array" : "object"; }
function ownSearch() { const pattern = /b/; pattern[Symbol.search] = function () { return "nowhere"; }; const r = "abc".search(pattern); return r === "nowhere"; }
function ownExec() { const pattern = /b/; pattern.exec = function () { return { index: "somewhere" }; }; const r = "abc".search(pattern); return r === "somewhere"; }
function otherPrototype() { const pattern = /b/; Object.setPrototypeOf(pattern, { [Symbol.replace]() { return 42; } }); const r = "abc".replace(pattern, "y"); return r === 42; }
function changedElsewhere() { const pattern = /b/; touch(pattern); const r = "abc".replace(pattern, "y"); return r === 42; }
function changedByClosure() { const pattern = /b/; const change = () => { pattern[Symbol.replace] = function () { return 42; }; }; change(); const r = "abc".replace(pattern, "y"); return r === 42; }
function changedByArgument() { const pattern = /b/; const r = "abc".replace(pattern, (touch(pattern), "y")); return r === 42; }
function changedBetweenCalls() { const pattern = /b/; const first = "abc".replace(pattern, "y"); touch(pattern); const second = "abc".replace(pattern, "y"); return first + second; }
function changedInLoop(count) { const pattern = /b/; let results = []; for (let i = 0; i < count; ++i) { results.push("abc".replace(pattern, "y")); touch(pattern); } return results.join(); }
function changedLastIndex() { const pattern = /b/g; pattern.lastIndex = { valueOf() { return 0; } }; const r = "abc".replace(pattern, "y"); return r ? r : "empty"; }
function usedTwiceInCall() { const pattern = /b/; const r = "abc".replace(pattern, pattern); return r ? r : "empty"; }
function oneOfTwoLiterals(which) { const pattern = which === 0 ? /a/ : /b/; const r = "abc".replace(pattern, "y"); return r ? r : "empty"; }
function anyPattern(pattern) { const r = "abc".replace(pattern, "y"); return r ? r : "empty"; }
const untyped = [ownReplace, ownReplaceAndSum, ownReplaceForAll, ownSplit, ownSearch, ownExec, otherPrototype, changedElsewhere, changedByClosure, changedByArgument, changedBetweenCalls, changedInLoop, changedLastIndex, usedTwiceInCall, oneOfTwoLiterals, anyPattern];
for (let f of untyped)
    noInline(f);

check(ownReplace(), true, "an own Symbol.replace");
check(ownReplaceAndSum(), "42!", "the result of an own Symbol.replace in a sum");
check(ownReplaceForAll(), true, "an own Symbol.replace and replaceAll");
check(ownSplit(), true, "an own Symbol.split");
check(ownSearch(), true, "an own Symbol.search");
check(ownExec(), true, "an own exec");
check(otherPrototype(), true, "another prototype");
check(changedElsewhere(), true, "a literal that another function changed");
check(changedByClosure(), true, "a literal that a closure changed");
check(changedByArgument(), true, "a literal that the next argument changed");
check(changedBetweenCalls(), "ayc42", "a literal that was changed between two calls");
check(changedInLoop(3), "ayc,42,42", "a literal that a loop changes");
check(changedLastIndex(), "ayc", "a lastIndex that is an object");
check(usedTwiceInCall(), "a/b/c", "a literal that is both arguments");
check(oneOfTwoLiterals(0) + oneOfTwoLiterals(1), "ybcayc", "one of two literals");
check([anyPattern(/b/), anyPattern("b"), anyPattern({ [Symbol.replace]() { return 0; } }), anyPattern({ toString() { return "c"; } })].join(), "ayc,ayc,empty,aby", "any pattern");
console.log("passed");
