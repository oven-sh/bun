(function () {
function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
let log = [];
function note(value) { log.push(value); }

function testsUndefined(c) {
    for (let i = 0; i < 2; i++) { }
    if (undefined) {
        for (let i = 0; i < 2; i++) {
            const reads = () => c[1];
            note(reads());
        }
    }
    return log.length;
}
check(testsUndefined([1, 2]), 0, "a closure that is made and called where undefined is true");

function testsNull(c) {
    if (null) {
        const reads = () => c[0];
        return reads();
    }
    return "skipped";
}
check(testsNull([1, 2]), "skipped", "where null is true");

function testsNotUndefined(c) {
    if (!undefined) {
        const reads = () => c[1];
        return reads();
    }
    return "skipped";
}
check(testsNotUndefined([1, 2]), 2, "where undefined is false");

function testsBoth(c, which) {
    const inDeadBranch = () => c[0];
    const inLiveBranch = () => c[1];
    let result = 0;
    for (let i = 0; i < 3; i++) {
        if (undefined)
            result += inDeadBranch();
        else
            result += inLiveBranch();
    }
    return result;
}
check(testsBoth([100, 2]), 6, "one closure for each branch");

function typeOf(flag) { return typeof flag; }
function hasDefault(flag = false) { return typeOf(flag); }
check(hasDefault(), "boolean", "the default");
check(hasDefault(undefined), "boolean", "the default for undefined");
check(hasDefault(true), "boolean", "an argument");

function addsOne(value) { return value + 1; }
function isAlwaysCalledWithout(value = 7) { return addsOne(value); }
check(isAlwaysCalledWithout(), 8, "a parameter that is never passed");
check(isAlwaysCalledWithout(), 8, "a parameter that is never passed, again");

function isAlwaysCalledWith(value = 7) { return addsOne(value); }
check(isAlwaysCalledWith(1), 2, "a parameter that is always passed");
check(isAlwaysCalledWith(2.5), 3.5, "a parameter that is always passed, again");

let assignedLater;
function callsAssignedLater(x) { return assignedLater(x); }
let threw = false;
try {
    callsAssignedLater({ });
} catch (error) {
    threw = error instanceof TypeError;
}
check(threw, true, "a call of a variable that is still undefined");
assignedLater = x => x.value;
check(callsAssignedLater({ value: 5 }), 5, "once it holds a function");

let neverAssigned;
function callsNeverAssigned(x) { return neverAssigned(x); }
threw = false;
try {
    callsNeverAssigned({ });
} catch (error) {
    threw = error instanceof TypeError;
}
check(threw, true, "a call of a variable that never holds a function");
})();
console.log("passed");
