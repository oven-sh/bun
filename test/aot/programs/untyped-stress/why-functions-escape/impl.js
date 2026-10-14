const aotRemarks = () => null, isAOTCompiled = () => false, aotFunctionsNamed = () => [], aotOperationCount = () => 0, aotTypeCoverage = () => null, aotSetFamily = () => undefined, aotFamilyOf = () => 0, aotHasDepartedFamily = () => false;
function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
const isCompiled = !!aotRemarks("check");
const isSealed = !Object.isExtensible(Function.prototype);
function causesOf(name) {
    let remarks = aotRemarks(name);
    if (!remarks && isCompiled)
        throw new Error("no remarks for " + name);
    return remarks ? remarks.filter(remark => remark.startsWith("function-escapes")) : undefined;
}
function escapesBecause(name, ...reasons) {
    let causes = causesOf(name);
    for (let reason of causes ? reasons : []) {
        if (!causes.includes("function-escapes:" + reason))
            throw new Error(name + " does not escape because of " + reason + ": " + causes.join(" "));
    }
}
function doesNotEscapeBecause(name, ...reasons) {
    let causes = causesOf(name);
    for (let reason of causes ? reasons : []) {
        if (causes.some(cause => cause === "function-escapes:" + reason || cause.startsWith("function-escapes:" + reason + ":")))
            throw new Error(name + " escapes because of " + reason + ": " + causes.join(" "));
    }
}
function escapesOnlyThroughProperties(name, expected) {
    let causes = causesOf(name);
    if (causes && causes.includes("function-escapes-only-through-properties") !== expected)
        throw new Error(name + ": " + causes.join(" "));
}
function doesNotEscape(...names) {
    for (let name of names) {
        let causes = causesOf(name);
        if (causes && causes.length)
            throw new Error(name + " escapes: " + causes.join(" "));
        if (causes && !aotRemarks(name).includes("function-does-not-escape"))
            throw new Error(name + " has neither remark");
    }
}
let kept;
function keep(value) { kept = value; return value; }
noInline(keep);

function onlyCalled() {
    function sumOnlyCalled(n) { return n <= 0 ? 0 : n + sumOnlyCalled(n - 1); }
    return sumOnlyCalled(4) + sumOnlyCalled.length;
}
check(onlyCalled(), 11, "a function that is only called");
doesNotEscape("sumOnlyCalled");

function isStoredInProperty(o) {
    function sumStored(n) { return n <= 0 ? 0 : n + sumStored(n - 1); }
    o.sum = sumStored;
    return sumStored(4);
}
check(isStoredInProperty({ }), 10, "a function stored in a property");
escapesBecause("sumStored", "stored-in-property");
doesNotEscapeBecause("sumStored", "property-written", "property-read", "passed-to-unknown-call", "returned");
escapesOnlyThroughProperties("sumStored", false);

function isStoredInElement(list, i) {
    function sumInElement(n) { return n <= 0 ? 0 : n + sumInElement(n - 1); }
    list[i] = sumInElement;
    return sumInElement(4);
}
check(isStoredInElement([], 0), 10, "a function stored in an element");
escapesBecause("sumInElement", "stored-in-property");

function isPassed() {
    function sumPassed(n) { return n <= 0 ? 0 : n + sumPassed(n - 1); }
    keep(sumPassed);
    return sumPassed(4);
}
check(isPassed(), 10, "a function passed to a function that is not known");
escapesBecause("sumPassed", "passed-to-unknown-call");
doesNotEscapeBecause("sumPassed", "stored-in-property", "returned", "constructed");

function isReturned() {
    function sumReturned(n) { return n <= 0 ? 0 : n + sumReturned(n - 1); }
    sumReturned(4);
    return sumReturned;
}
check(isReturned()(4), 10, "a function that is returned");
escapesBecause("sumReturned", "returned");

function isConstructed() {
    function sumConstructed(n) { return n <= 0 ? 0 : n + sumConstructed(n - 1); }
    new sumConstructed(0);
    return sumConstructed(4);
}
check(isConstructed(), 10, "a function that is constructed");
escapesBecause("sumConstructed", "constructed");
doesNotEscapeBecause("sumConstructed", "passed-to-unknown-call");

function hasItsPrototypeRead() {
    function sumWithPrototype(n) { return n <= 0 ? 0 : n + sumWithPrototype(n - 1); }
    sumWithPrototype.prototype.method = 1;
    return sumWithPrototype(4);
}
check(hasItsPrototypeRead(), 10, "a function whose prototype is read");
escapesBecause("sumWithPrototype", "prototype");
doesNotEscapeBecause("sumWithPrototype", "property-read", "property-written");
escapesOnlyThroughProperties("sumWithPrototype", false);

function isLeftOfInstanceof() {
    function sumLeft(n) { return n <= 0 ? 0 : n + sumLeft(n - 1); }
    return sumLeft(4) + (sumLeft instanceof Function ? 1 : 0);
}
check(isLeftOfInstanceof(), 11, "a function left of instanceof");
escapesBecause("sumLeft", "instanceof");
doesNotEscapeBecause("sumLeft", "right-of-instanceof");

function isRightOfInstanceof(value) {
    function sumRight(n) { return n <= 0 ? 0 : n + sumRight(n - 1); }
    return sumRight(4) + (value instanceof sumRight ? " yes" : " no");
}
function arrowIsRightOfInstanceof(value) {
    const sumArrowRight = n => n <= 0 ? 0 : n + sumArrowRight(n - 1);
    return sumArrowRight(4) + (value instanceof sumArrowRight ? " yes" : " no");
}
function thrownBy(f, ...parameters) {
    try {
        f(...parameters);
    } catch (error) {
        return error.constructor.name;
    }
    return "nothing";
}
check(isRightOfInstanceof({ }), "10 no", "a function right of instanceof");
check(thrownBy(arrowIsRightOfInstanceof, { }), "TypeError", "an arrow function right of instanceof");
doesNotEscape("sumRight");
if (!isSealed)
    escapesBecause("sumArrowRight", "right-of-instanceof");

function hasProperties() {
    function sumWithProperties(n) { return n <= 0 ? 0 : n + sumWithProperties(n - 1); }
    sumWithProperties.displayName = "sum";
    return sumWithProperties(4) + sumWithProperties.displayName + sumWithProperties.other;
}
check(hasProperties(), "10sumundefined", "a function with properties");
if (isSealed)
    doesNotEscape("sumWithProperties");
else {
    escapesBecause("sumWithProperties", "property-written:displayName", "property-read:displayName", "property-read:other");
    doesNotEscapeBecause("sumWithProperties", "stored-in-property", "prototype");
    escapesOnlyThroughProperties("sumWithProperties", true);
}

function hasPropertiesAndIsPassed() {
    function sumWithBoth(n) { return n <= 0 ? 0 : n + sumWithBoth(n - 1); }
    sumWithBoth.displayName = "sum";
    keep(sumWithBoth);
    return sumWithBoth(4);
}
check(hasPropertiesAndIsPassed(), 10, "a function with a property that is also passed");
escapesBecause("sumWithBoth", "passed-to-unknown-call");
if (!isSealed)
    escapesBecause("sumWithBoth", "property-written:displayName");
escapesOnlyThroughProperties("sumWithBoth", false);

function changesItsChain() {
    function sumReparented(n) { return n <= 0 ? 0 : n + sumReparented(n - 1); }
    sumReparented.__proto__ = null;
    return sumReparented(4);
}
check(changesItsChain(), 10, "a function that gets another prototype");
escapesBecause("sumReparented", "property-written:__proto__");

function isReadByValue(key) {
    function sumByValue(n) { return n <= 0 ? 0 : n + sumByValue(n - 1); }
    return sumByValue(4) + String(sumByValue[key]);
}
check(isReadByValue("nothing"), "10undefined", "a function that is read by value");
escapesBecause("sumByValue", "used-by:op_get_by_val");

function isMerged(which) {
    function sumFirst(n) { return n <= 0 ? 0 : n + sumFirst(n - 1); }
    function sumSecond(n) { return n <= 0 ? 1 : n + sumSecond(n - 1); }
    let either = which ? sumFirst : sumSecond;
    return either(4);
}
check(isMerged(true) + isMerged(false), 21, "one of two functions");
escapesBecause("sumFirst", "merged-in-phi");
escapesBecause("sumSecond", "merged-in-phi");
console.log("passed");
