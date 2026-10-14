const aotRemarks = () => null, isAOTCompiled = () => false, aotFunctionsNamed = () => [], aotOperationCount = () => 0, aotTypeCoverage = () => null, aotSetFamily = () => undefined, aotFamilyOf = () => 0, aotHasDepartedFamily = () => false;
//@ runDefault("--compileMainScriptAheadOfTime=1")
function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function applies(name, remark) {
    let all = aotRemarks(name);
    if (all && !all.includes(remark))
        throw new Error(remark + " does not apply to " + name + ": " + all.join(" "));
}
function doesNotApply(name, remark) {
    let all = aotRemarks(name);
    if (all && all.includes(remark))
        throw new Error(remark + " applies to " + name);
}
(function () {
    "use strict";
    function assignsToGlobal(o) { o.a = 1; o.b = 2; shadowedLater = (o.c = 3, o.d = 4, 5); }
    globalThis.shadowedLater = 0;
    assignsToGlobal({});
    check(globalThis.shadowedLater, 5, "the global property is assigned to");
    globalThis.shadowedLater = 0;
    assignsToGlobal({ set a(x) { loadString("let shadowedLater = 'lexical';"); } });
    check(globalThis.shadowedLater, 0, "the setter of the first store declared a lexical binding, so the property is left alone");
    check(loadString("shadowedLater"), 5, "and the binding is assigned to");
    doesNotApply("assignsToGlobal", "property-run:4");

    function assignsToMissingGlobal(o) { o.a = 1; o.b = 2; definedLater = (o.c = 3, o.d = 4, 5); }
    let threw = false;
    try { assignsToMissingGlobal({}); } catch (e) { threw = e instanceof ReferenceError; }
    check(threw, true, "an assignment to a name that does not exist");
    assignsToMissingGlobal({ set b(x) { globalThis.definedLater = 0; } });
    check(globalThis.definedLater, 5, "the setter of the second store made the property");

    var outer = 0;
    function assignsToClosureVariable(o) { o.a = 1; o.b = 2; outer = (o.c = 3, o.d = 4, 5); }
    const log = [];
    assignsToClosureVariable({ set a(x) { log.push("a:" + outer); }, set d(x) { log.push("d:" + outer); } });
    check(log.join(), "a:0,d:0", "setters see the variable before the assignment");
    check(outer, 5, "the variable is assigned to");
    applies("assignsToClosureVariable", "property-run:4");

    function storesOnly(o, v) { o.a = v; o.b = v; o.c = v; o.d = v; }
    storesOnly({}, 1);
    applies("storesOnly", "property-run:4");
})();
console.log("passed");
