const aotRemarks = () => null, isAOTCompiled = () => false, aotFunctionsNamed = () => [], aotOperationCount = () => 0, aotTypeCoverage = () => null, aotSetFamily = () => undefined, aotFamilyOf = () => 0, aotHasDepartedFamily = () => false;

function shouldBe(actual, expected, what)
{
    if (actual !== expected)
        throw new Error(what + ": " + actual + " instead of " + expected);
}

(function () {
    function first0(x) { return { alpha: x, beta: x + 1, gamma: x + 2 }; }
    function first1(x) { return { delta: x, epsilon: x + 1 }; }
    function first2(x) { return { zeta: x, eta: x + 1, theta: x + 2, iota: x + 3 }; }
    function sameShapeAsFirst0(x) { return { alpha: -x, beta: -x, gamma: -x }; }
    function otherOrder(x) { return { gamma: x, beta: x, alpha: x }; }

    const counts = typeof aotOperationCount === "function" && isAOTCompiled(first0) && aotOperationCount("operationAOTNewObjectLiteral") !== null;
    function arrivals(detail) { return counts ? aotOperationCount("operationAOTNewObjectLiteral" + detail) : 0; }

    let all = arrivals("");
    let known = arrivals(":known-shape");
    shouldBe(JSON.stringify(first0(1)), '{"alpha":1,"beta":2,"gamma":3}', "the first literal of a shape");
    shouldBe(JSON.stringify(first1(1)), '{"delta":1,"epsilon":2}', "the first literal of a second shape");
    shouldBe(JSON.stringify(first2(1)), '{"zeta":1,"eta":2,"theta":3,"iota":4}', "the first literal of a third shape");
    if (counts) {
        shouldBe(arrivals("") - all, 3, "the first literal of a function that starts cold is made in C++");
        shouldBe(arrivals(":known-shape") - known, 0, "a shape that nobody has made yet is not known");
    }

    all = arrivals("");
    known = arrivals(":known-shape");
    shouldBe(JSON.stringify(first0(5)), '{"alpha":5,"beta":6,"gamma":7}', "the second literal of a shape");
    shouldBe(JSON.stringify(first1(5)), '{"delta":5,"epsilon":6}', "the second literal of a second shape");
    shouldBe(JSON.stringify(first2(5)), '{"zeta":5,"eta":6,"theta":7,"iota":8}', "the second literal of a third shape");
    shouldBe(JSON.stringify(sameShapeAsFirst0(5)), '{"alpha":-5,"beta":-5,"gamma":-5}', "the first literal of another site with a shape that exists");
    if (counts)
        shouldBe(arrivals(":known-shape") - known, arrivals("") - all, "a literal that is made in C++ takes the structure of its shape if that exists");

    shouldBe(JSON.stringify(otherOrder(5)), '{"gamma":5,"beta":5,"alpha":5}', "the same names in another order");
    shouldBe(JSON.stringify(otherOrder(6)), '{"gamma":6,"beta":6,"alpha":6}', "the same names in another order, again");

    for (let i = 0; i < 200; ++i) {
        shouldBe(first0(i).gamma, i + 2, "a literal of a function that is no longer cold");
        shouldBe(sameShapeAsFirst0(i).alpha, -i, "a literal of another site that is no longer cold");
    }
    all = arrivals("");
    for (let i = 0; i < 200; ++i) {
        shouldBe(first0(i).beta, i + 1, "a literal of a warm function");
        shouldBe(Object.keys(first2(i)).join(), "zeta,eta,theta,iota", "the keys of a literal of a warm function");
    }
    if (counts)
        shouldBe(arrivals("") - all <= 4, true, "literals of warm functions are not made in C++");
})();
console.log("passed");
