function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
(function () {
function throughArrayMethods(array) {
    const addsOne = function (x) { try { return x + 1; } catch { return 0; } };
    const adds = function (sum, x) { try { return sum + x; } catch { return 0; } };
    let sum = 0;
    for (let i = 0; i < 100; i++)
        sum += addsOne(i) + adds(i, 1);
    return [sum, array.map(addsOne).join(), array.filter(addsOne).join(), array.some(addsOne), array.every(addsOne), array.find(addsOne), array.findIndex(addsOne), array.reduce(adds)].join(" ");
}
check(throughArrayMethods([1, 2, 3]), "10100 2,3,4 1,2,3 true true 1 0 6", "integers, as in the direct calls");
check(throughArrayMethods([1.5, 2.5]), "10100 2.5,3.5 1.5,2.5 true true 1.5 0 4", "doubles");
check(throughArrayMethods(["a", "b"]), "10100 a1,b1 a,b true true a 0 ab", "strings");
check(throughArrayMethods([undefined, null]), "10100 NaN,1  true false  1 NaN", "undefined and null");

function throughLiteral(value) {
    const addsOne = function (x) { try { return x + 1; } catch { return 0; } };
    let sum = 0;
    for (let i = 0; i < 100; i++)
        sum += addsOne(i);
    return sum + " " + ({ callback: addsOne }).callback(value);
}
check(throughLiteral(1), "5050 2", "an integer, as in the direct calls");
check(throughLiteral(1.5), "5050 2.5", "a double");
check(throughLiteral("a"), "5050 a1", "a string");
check(throughLiteral({ }), "5050 [object Object]1", "an object");
check(throughLiteral(undefined), "5050 NaN", "undefined");

function readsThisThroughLiteral(value) {
    const kindOfThis = function (x) { "use strict"; try { return typeof this + x; } catch { return 0; } };
    let text = "";
    for (let i = 0; i < 3; i++)
        text += kindOfThis(i);
    return text + " " + ({ callback: kindOfThis }).callback(value);
}
check(readsThisThroughLiteral(7), "undefined0undefined1undefined2 object7", "this is the literal there, and undefined in the direct calls");
})();
console.log("passed");
