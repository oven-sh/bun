const aotRemarks = () => null, isAOTCompiled = () => false, aotFunctionsNamed = () => [], aotOperationCount = () => 0, aotTypeCoverage = () => null, aotSetFamily = () => undefined, aotFamilyOf = () => 0, aotHasDepartedFamily = () => false;
//@ runDefault("--compileMainScriptAheadOfTime=1", "--useAOTInlining=0")
//@ runDefault("--compileMainScriptAheadOfTime=1")
function readsProperty(o) { return o.property; }
readsProperty({ property: 1 });
const usesDataStubs = (aotRemarks("readsProperty") || []).includes("calls:GetById");
(function () {
    function check(actual, expected, what) {
        if (!Object.is(actual, expected))
            throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
    }
    function matches(remark, pattern) { return remark === pattern || remark.startsWith(pattern + ":"); }
    function applies(name, ...patterns) {
        let remarks = aotRemarks(name);
        for (let pattern of remarks ? patterns : []) {
            if (!remarks.some(remark => matches(remark, pattern)))
                throw new Error(pattern + " does not apply to " + name + ": " + remarks.join(" "));
        }
    }
    function doesNotApply(name, ...patterns) {
        let remarks = aotRemarks(name);
        for (let pattern of remarks ? patterns : []) {
            if (remarks.some(remark => matches(remark, pattern)))
                throw new Error(pattern + " applies to " + name + ": " + remarks.join(" "));
        }
    }
    const isLowered = "lowered-builtin", isRepeated = "repeats-receiver-check-at-call";

    const never = function () { return null; };
    function shadowsExec(pattern) { pattern.exec = never; return "a"; }
    function testAfterCall(pattern) { return pattern.test(shadowsExec(pattern)); }
    function testAfterStore(pattern) { return pattern.test((pattern.exec = never, "a")); }
    function testAfterGetter(pattern, o) { return pattern.test(o.text); }
    function testAfterConversion(pattern, o) { return pattern.test("" + o); }
    function testAfterBranch(pattern, shadows) { return pattern.test(shadows ? (pattern.exec = never, "a") : "a"); }
    function testAfterNewPrototype(pattern) { return pattern.test((Object.setPrototypeOf(pattern, { __proto__: RegExp.prototype, exec: never }), "a")); }
    function testAfterDefinition(pattern) { return pattern.test((Object.defineProperty(pattern, "exec", { value: never }), "a")); }
    function testAfterShadowingTest(pattern) { return pattern.test((pattern.test = never, "a")); }
    function execAfterStore(pattern) { return pattern.exec((pattern.exec = never, "a")) !== null; }

    check(testAfterCall(/a/), false, "exec shadowed by a call in the argument");
    check(testAfterStore(/a/), false, "exec shadowed by a store in the argument");
    {
        const pattern = /a/;
        check(testAfterGetter(pattern, { get text() { pattern.exec = never; return "a"; } }), false, "exec shadowed by a getter");
        check(testAfterGetter(/a/, { text: "a" }), true, "a plain property as argument");
    }
    {
        const pattern = /a/;
        check(testAfterConversion(pattern, { toString() { pattern.exec = never; return "a"; } }), false, "exec shadowed by toString");
        check(testAfterConversion(/a/, "a"), true, "a string as argument");
    }
    check(testAfterBranch(/a/, true), false, "exec shadowed on one path");
    check(testAfterBranch(/a/, false), true, "exec not shadowed on the other path");
    check(testAfterNewPrototype(/a/), false, "another prototype");
    check(testAfterDefinition(/a/), false, "exec defined by the argument");
    check(testAfterShadowingTest(/a/), true, "the method was read before it was shadowed");
    check(execAfterStore(/a/), true, "exec was read before it was shadowed");
    for (let name of ["testAfterCall", "testAfterStore", "testAfterGetter", "testAfterConversion", "testAfterBranch", "testAfterNewPrototype", "testAfterDefinition", "testAfterShadowingTest", "execAfterStore"])
        applies(name, isLowered, isRepeated);

    class Other extends Array { }
    const withInheritedElement = () => ({ __proto__: Array.prototype, 1: "x" });
    function makesOther(array) { array.constructor = Other; return 0; }
    function sliceAfterStore(array) { return array.slice((array.constructor = Other, 0)) instanceof Other; }
    function sliceAfterCall(array) { return array.slice(makesOther(array)) instanceof Other; }
    function concatAfterStore(array) { return array.concat((array[Symbol.isConcatSpreadable] = false, 4)).length; }
    function concatAfterSpecies(array) { return array.concat((array.constructor = Other, 4)) instanceof Other; }
    function spliceAfterStore(array) { return array.splice((array.constructor = Other, 0), 1) instanceof Other; }
    function indexOfAfterNewPrototype(array) { return array.indexOf((Object.setPrototypeOf(array, withInheritedElement()), "x")); }
    function includesAfterNewPrototype(array) { return array.includes((Object.setPrototypeOf(array, withInheritedElement()), "x")); }
    function joinAfterNewPrototype(array) { return array.join((Object.setPrototypeOf(array, withInheritedElement()), "-")); }
    function atAfterNewPrototype(array) { return array.at((Object.setPrototypeOf(array, withInheritedElement()), 1)); }
    function unshiftAfterNewPrototype(array) { array.unshift((Object.setPrototypeOf(array, withInheritedElement()), 0)); return Object.keys(array).join() + "|" + array.join(); }
    function pushAfterNewPrototype(array) { array.push((Object.setPrototypeOf(array, withInheritedElement()), 7), 8); return array.join(); }

    check(sliceAfterStore([1, 2, 3]), true, "slice: constructor stored by the argument");
    check(sliceAfterCall([1, 2, 3]), true, "slice: constructor stored by a call in the argument");
    check(concatAfterStore([1, 2, 3]), 2, "concat: no longer spreadable");
    check(concatAfterSpecies([1, 2, 3]), true, "concat: constructor stored by the argument");
    check(spliceAfterStore([1, 2, 3]), true, "splice: constructor stored by the argument");
    check(indexOfAfterNewPrototype([1, , 3]), 1, "indexOf: an inherited element");
    check(includesAfterNewPrototype([1, , 3]), true, "includes: an inherited element");
    check(joinAfterNewPrototype([1, , 3]), "1-x-3", "join: an inherited element");
    check(atAfterNewPrototype([1, , 3]), "x", "at: an inherited element");
    check(unshiftAfterNewPrototype([1, , 3]), "0,1,2,3|0,1,x,3", "unshift: an inherited element");
    check(pushAfterNewPrototype([1, , 3]), "1,x,3,7,8", "push: an inherited element");
    for (let name of ["sliceAfterStore", "sliceAfterCall", "concatAfterStore", "concatAfterSpecies", "spliceAfterStore", "indexOfAfterNewPrototype", "includesAfterNewPrototype", "joinAfterNewPrototype", "atAfterNewPrototype", "unshiftAfterNewPrototype", "pushAfterNewPrototype"])
        applies(name, isLowered, isRepeated);

    function testsVariable(pattern, text) { return pattern.test(text); }
    function testsLiteral(pattern) { return pattern.test("a"); }
    function testsSum(pattern, text) { let s = "" + text; return pattern.test(s + "a"); }
    function slicesFromSum(array, i) { return array.slice((i | 0) + 1).length; }
    function findsVariable(array, x) { return array.indexOf(x); }
    function findsNewObject(array) { return array.includes({ }); }
    function concatsClosure(array) { return array.concat(function () { }).length; }
    function joinsWithCaptured(array) { return array.join(separator); }
    const separator = "+";
    check(testsVariable(/a/, "a"), true, "a variable");
    check(testsLiteral(/a/), true, "a literal");
    check(testsSum(/ba/, "b"), true, "a sum of strings");
    check(slicesFromSum([1, 2, 3], 0), 2, "a sum of numbers");
    check(findsVariable([1, 2, 3], 3), 2, "a variable");
    check(findsNewObject([1, 2, 3]), false, "a new object");
    check(concatsClosure([1, 2, 3]), 4, "a new function");
    check(joinsWithCaptured([1, 2, 3]), "1+2+3", "a captured variable");
    for (let name of ["testsVariable", "testsLiteral", "testsSum", "slicesFromSum", "findsVariable", "findsNewObject", "concatsClosure", "joinsWithCaptured"]) {
        applies(name, isLowered);
        doesNotApply(name, isRepeated);
    }

    function mapHasAfterStore(map) { return map.has((map.has = () => 42, 1)); }
    function mapGetAfterNewPrototype(map) { return map.get((Object.setPrototypeOf(map, null), 1)); }
    function setHasAfterNewPrototype(set) { return set.has((Object.setPrototypeOf(set, null), 1)); }
    function weakMapGetAfterStore(map, key) { return map.get((map.get = () => 42, key)); }
    function timeAfterStore(date) { return date.getTime((date.getTime = () => 42, 1)); }
    function sliceOfString(text, o) { let s = "" + text; return s.slice(o.start); }
    check(mapHasAfterStore(new Map([[1, 2]])), true, "Map.prototype.has was read before it was shadowed");
    check(mapGetAfterNewPrototype(new Map([[1, 2]])), 2, "Map.prototype.get was read before the prototype changed");
    check(setHasAfterNewPrototype(new Set([1])), true, "Set.prototype.has was read before the prototype changed");
    {
        const key = { };
        check(weakMapGetAfterStore(new WeakMap([[key, 2]]), key), 2, "WeakMap.prototype.get was read before it was shadowed");
    }
    check(timeAfterStore(new Date(5)), 5, "Date.prototype.getTime was read before it was shadowed");
    check(sliceOfString("abc", { start: 1 }), "bc", "a string cannot change");
    for (let name of ["mapHasAfterStore", "mapGetAfterNewPrototype", "setHasAfterNewPrototype", "weakMapGetAfterStore", "timeAfterStore", "sliceOfString"]) {
        if (usesDataStubs || !name.startsWith("map") && !name.startsWith("set"))
            applies(name, isLowered);
        doesNotApply(name, isRepeated);
    }
})();
console.log("passed");
