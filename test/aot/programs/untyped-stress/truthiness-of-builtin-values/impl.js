const failures = [];

function check(actual, expected, what)
{
    if (!Object.is(actual, expected))
        failures.push(what + ": " + String(actual) + " instead of " + String(expected));
}

function test()
{
    function emptyName() { return Function.prototype.name ? "truthy" : "falsy"; }
    function notEmptyName() { return !Function.prototype.name; }
    function emptyNameOr() { return Function.prototype.name || "other"; }
    function emptyNameAnd() { return Function.prototype.name && "other"; }
    function ifEmptyName() { if (Function.prototype.name) return "truthy"; return "falsy"; }
    function whileEmptyName() { var n = 0; while (Function.prototype.name) { if (++n > 3) break; } return n; }
    function emptyNameIsUndefined() { return typeof Function.prototype.name === "undefined"; }
    function emptyNameEqualsNull() { return Function.prototype.name == null; }
    function emptyNameOrElse() { return Function.prototype.name ?? "other"; }
    function tagOfMath() { return Math[Symbol.toStringTag] ? "truthy" : "falsy"; }
    function tagOfJSON() { return JSON[Symbol.toStringTag] ? "truthy" : "falsy"; }
    function iterator() { return Symbol.iterator ? "truthy" : "falsy"; }
    function nan() { return Number.NaN ? "truthy" : "falsy"; }
    function epsilon() { return Number.EPSILON ? "truthy" : "falsy"; }
    function lengthOfStrings() { return String.prototype.length ? "truthy" : "falsy"; }
    function lengthOfArrays() { return Array.prototype.length ? "truthy" : "falsy"; }
    function lengthOfRandom() { return Math.random.length ? "truthy" : "falsy"; }
    function aFunction() { return Math.floor ? "truthy" : "falsy"; }
    function anObject() { return Math ? "truthy" : "falsy"; }
    function aPrototype() { return Array.prototype ? "truthy" : "falsy"; }
    function aConstructor() { return Map ? "truthy" : "falsy"; }
    function truthinessOfAnything(x) { return x ? "truthy" : "falsy"; }

    for (let i = 0; i < 20; ++i) {
        check(emptyName(), "falsy", "the name of Function.prototype");
        check(notEmptyName(), true, "its negation");
        check(emptyNameOr(), "other", "|| after it");
        check(emptyNameAnd(), "", "&& after it");
        check(ifEmptyName(), "falsy", "if");
        check(whileEmptyName(), 0, "while");
        check(emptyNameIsUndefined(), false, "typeof");
        check(emptyNameEqualsNull(), false, "== null");
        check(emptyNameOrElse(), "", "?? after it");
        check(tagOfMath(), "truthy", "the tag of Math");
        check(tagOfJSON(), "truthy", "the tag of JSON");
        check(iterator(), "truthy", "a symbol");
        check(nan(), "falsy", "NaN");
        check(epsilon(), "truthy", "a small number");
        check(lengthOfStrings(), "falsy", "the length of String.prototype");
        check(lengthOfArrays(), "falsy", "the length of Array.prototype");
        check(lengthOfRandom(), "falsy", "the length of a function without parameters");
        check(aFunction(), "truthy", "a function");
        check(anObject(), "truthy", "an object");
        check(aPrototype(), "truthy", "a prototype");
        check(aConstructor(), "truthy", "a constructor");
        check([0, "s", "", null].map(x => truthinessOfAnything(x)).join(), "falsy,truthy,falsy,falsy", "anything");
    }
}
test();
if (failures.length)
    throw new Error(failures.length + " failures:\n" + [...new Set(failures)].join("\n"));
console.log("passed");
