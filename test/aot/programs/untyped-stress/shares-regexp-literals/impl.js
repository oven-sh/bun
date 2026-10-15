function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function identity(x) { return x; }
noInline(identity);

function replacesOnce(x) { return ("" + x).replace(/b+/, "-"); }
function replacesEvery(x) { return ("" + x).replace(/b/g, "-"); }
function replacesAll(x) { return ("" + x).replaceAll(/b/g, "+"); }
function replacesWithFunction(x) { return ("" + x).replace(/(b)(c)?/g, (all, first, second, offset) => offset + first + (second || "")); }
function matchesOnce(x) { const found = ("" + x).match(/b(c)/); return found ? found[1] + found.index : "none"; }
function matchesEvery(x) { const found = ("" + x).match(/b/g); return found ? found.length : 0; }
function searches(x) { return ("" + x).search(/c/g); }
function splits(x) { return ("" + x).split(/b+/).join("|"); }
function twoInARow(x) { return ("" + x).replace(/a/g, "1").replace(/c/g, "3"); }
for (const f of [replacesOnce, replacesEvery, replacesAll, replacesWithFunction, matchesOnce, matchesEvery, searches, splits, twoInARow]) {
    noInline(f);
}

function receiverIsUnknown(x) { return x.replace(/b/, "-"); }
function keptInVariable(x) { const re = /b/g; const first = ("" + x).replace(re, "-"); return first + re.lastIndex; }
function usedTwice(x) { const re = /b/; return ("" + x).replace(re, "-") + ("" + x).search(re); }
function sticky(x) { return ("" + x).replace(/b/y, "-"); }
function passedOn(x) { return identity(/b/).test("" + x); }
function secondArgument(x) { return ("" + x).replace("b", /c/); }
function returned() { return /b/g; }
for (const f of [receiverIsUnknown, keptInVariable, usedTwice, sticky, passedOn, secondArgument, returned]) {
    noInline(f);
}

function reentrant(x, depth) {
    return ("" + x).replace(/b/g, () => depth ? "[" + reentrant(x, depth - 1) + "]" : "-");
}
function throwsInside(x, fail) {
    return ("" + x).replace(/b/g, (all, offset) => { if (fail && offset > 1) throw new Error("stop"); return "-"; });
}
noInline(reentrant);
noInline(throwsInside);
const keeper = { seen: [], replace(re, by) { this.seen.push(re); return "kept"; } };
for (let round = 0; round < 60; round++) {
    check(replacesOnce("abbc"), "a-c", "replace");
    check(replacesEvery("abcb"), "a-c-", "replace, global");
    check(replacesAll("abcb"), "a+c+", "replaceAll");
    check(replacesWithFunction("abcab"), "a1bca4b", "replace with a function");
    check(matchesOnce("abc") + matchesOnce("ab"), "c1none", "match");
    check(matchesEvery("abcb") + matchesEvery("x"), 2, "match, global");
    check(searches("abc") + searches("ab"), 1, "search");
    check(splits("abbcbd"), "a|c|d", "split");
    check(twoInARow("abcabc"), "1b31b3", "two literals in one expression");
    check(receiverIsUnknown("abc") + receiverIsUnknown(keeper), "a-ckept", "a receiver that may be anything");
    check(keptInVariable("abcb"), "a-c-0", "a literal that is kept in a variable");
    check(usedTwice("abc"), "a-c1", "a literal that is used twice");
    check(sticky("bab") + sticky("abb"), "-ababb", "a sticky expression");
    check(passedOn("abc"), true, "a literal that is passed on");
    check(secondArgument("abc"), "a/c/c", "a literal that is what to replace by");
    check(returned() === returned(), false, "a literal that is returned");
    check(reentrant("bab", 2), "[[-a-]a[-a-]]a[[-a-]a[-a-]]", "the same literal inside its own callback");
    let message = "none";
    try { throwsInside("abcb", true); } catch (error) { message = error.message; }
    check(message + throwsInside("abcb", false), "stopa-c-", "after an exception in the callback");
    if (round % 16 === 0)
        gc();
}
check(keeper.seen.length, 60, "the method of the object ran");
check(new Set(keeper.seen).size, 60, "and was given a new object each time");
console.log("passed");
