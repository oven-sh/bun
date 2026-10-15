function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
(function () {
    function makeWithoutParameters() { return () => 7; }
    function makeWithParameter() { return x => x + 1; }
    function makeWithCapture(captured) { return () => captured; }
    function makeWithCaptureAndParameters(captured) { return (x, y) => captured + x + y; }
    for (let round = 0; round < 12; round++) {
        for (let i = 0; i < 50; i++) {
            check(makeWithoutParameters()(), 7, "a closure without parameters");
            check(makeWithParameter()(i), i + 1, "a closure with a parameter");
            check(makeWithCapture(i)(), i, "a closure that holds a value");
            check(makeWithCaptureAndParameters(i)(1, 2), i + 3, "a closure that holds a value and has parameters");
        }
        if (round & 1)
            fullGC();
        else
            edenGC();
    }
    check(makeWithoutParameters().name, "", "the name of a closure made from a remembered allocation");
    check(makeWithoutParameters().length, 0, "the length of a closure without parameters");
    check(makeWithCaptureAndParameters(0).length, 2, "the length of a closure with parameters");
})();
console.log("passed");
