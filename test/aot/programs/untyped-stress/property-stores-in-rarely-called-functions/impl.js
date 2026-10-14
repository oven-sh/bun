const aotRemarks = () => null, isAOTCompiled = () => false, aotFunctionsNamed = () => [], aotOperationCount = () => 0, aotTypeCoverage = () => null, aotSetFamily = () => undefined, aotFamilyOf = () => 0, aotHasDepartedFamily = () => false;
function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function replaces(o, v) { o.x = v; }
function replacesOutOfLine(o, v) { o.x = v; }
function replacesInPrototype(o, v) { o.x = v; }
function adds(o, v) { o.x = v; }
function storesToTwo(o, v) { o.x = v; }
function callsSetter(o, v) { o.x = v; }
function marksPrototype(o, v) { o.marker = v; }

const countsOperations = typeof aotOperationCount === "function" && aotOperationCount("operationAOTPutById") !== null && isAOTCompiled(replaces) && (aotRemarks("replaces") || []).includes("calls:PutById");
function operationsDuring(f) {
    if (!countsOperations) {
        f();
        return -1;
    }
    const before = aotOperationCount("operationAOTPutById");
    f();
    return aotOperationCount("operationAOTPutById") - before;
}
function checkOperations(actual, atLeast, atMost, what) {
    if (actual >= 0 && (actual < atLeast || actual > atMost))
        throw new Error(what + ": " + actual + " calls of the operation, not " + atLeast + " to " + atMost);
}

let unique = 0;
function ordinary(name, withX) {
    const result = {};
    result[name] = 0;
    if (withX)
        result.x = -1;
    return result;
}
const changingPrototype = {};
function forgetMegamorphicCache() {
    marksPrototype(Object.create(changingPrototype), 1);
    changingPrototype["changed" + unique++] = 1;
}
const warmUp = 40;

{
    const o = ordinary("replaced", true);
    checkOperations(operationsDuring(() => {
        for (let i = 0; i < warmUp; i++) {
            replaces(o, i);
            check(o.x, i, "a property that is replaced");
        }
    }), 2, 3, "the first stores of a function that starts cold");
    checkOperations(operationsDuring(() => {
        for (let i = 0; i < 1000; i++)
            replaces(o, i);
    }), 0, 0, "later stores");
    forgetMegamorphicCache();
    checkOperations(operationsDuring(() => {
        for (let i = 0; i < 100; i++) {
            replaces(o, i);
            check(o.x, i, "a property that is replaced after a prototype has changed");
        }
    }), 0, 0, "stores through the site's own slot after a prototype has changed");
}

{
    const o = {};
    for (let i = 0; i < 6; i++)
        o["inline" + i] = i;
    o.x = -1;
    checkOperations(operationsDuring(() => {
        for (let i = 0; i < warmUp; i++) {
            replacesOutOfLine(o, i);
            check(o.x, i, "a property outside the object that is replaced");
        }
    }), 2, 3, "the first stores to a property outside the object");
    forgetMegamorphicCache();
    checkOperations(operationsDuring(() => {
        for (let i = 0; i < 100; i++) {
            replacesOutOfLine(o, i);
            check(o.x + "," + o.inline5, i + ",5", "a property outside the object after a prototype has changed");
        }
    }), 0, 0, "stores to a property outside the object after a prototype has changed");
}

{
    const prototype = ordinary("prototype", true);
    const inheriting = Object.create(prototype);
    checkOperations(operationsDuring(() => {
        for (let i = 0; i < warmUp; i++) {
            replacesInPrototype(prototype, i);
            check(inheriting.x, i, "a property of a prototype that is replaced");
        }
    }), 2, 3, "the first stores to a prototype");
    forgetMegamorphicCache();
    checkOperations(operationsDuring(() => {
        for (let i = 0; i < 100; i++) {
            replacesInPrototype(prototype, i);
            check(inheriting.x, i, "a property of a prototype after another prototype has changed");
        }
    }), 1, 2, "stores to a prototype, which get no slot, after another prototype has changed");
}

{
    const name = "added";
    checkOperations(operationsDuring(() => {
        for (let i = 0; i < warmUp; i++) {
            const o = ordinary(name, false);
            adds(o, i);
            check(Object.keys(o).join() + o.x, name + ",x" + i, "a property that is added");
        }
    }), 2, 3, "the first additions of a function that starts cold");
    forgetMegamorphicCache();
    checkOperations(operationsDuring(() => {
        for (let i = 0; i < 100; i++) {
            const o = ordinary(name, false);
            adds(o, i);
            check(Object.keys(o).join() + o.x, name + ",x" + i, "a property that is added after a prototype has changed");
        }
    }), 0, 0, "additions through the site's own slot after a prototype has changed");
}

{
    const first = ordinary("first", true);
    const second = ordinary("second", true);
    for (let i = 0; i < warmUp; i++) {
        storesToTwo(first, i);
        storesToTwo(second, -i);
        check(first.x + "," + second.x, i + "," + -i, "a property of two objects");
    }
    checkOperations(operationsDuring(() => {
        for (let i = 0; i < 100; i++) {
            storesToTwo(first, i);
            storesToTwo(second, -i);
        }
    }), 0, 0, "stores to two structures once both are known");
    forgetMegamorphicCache();
    checkOperations(operationsDuring(() => {
        for (let i = 0; i < 100; i++) {
            storesToTwo(first, i);
            storesToTwo(second, -i);
            check(first.x + "," + second.x, i + "," + -i, "a property of two objects after a prototype has changed");
        }
    }), 1, 2, "stores to two structures at a site with one slot after a prototype has changed");
}

{
    let received = 0;
    const leaf = Object.create({ set x(v) { received += v; } });
    checkOperations(operationsDuring(() => {
        for (let i = 0; i < warmUp; i++)
            callsSetter(leaf, 1);
    }), 1, 2, "the first calls of an inherited setter");
    checkOperations(operationsDuring(() => {
        for (let i = 0; i < 1000; i++)
            callsSetter(leaf, 1);
    }), 0, 0, "later calls of an inherited setter");
    check(received, warmUp + 1000, "what the setter has received");
}
console.log("passed");
