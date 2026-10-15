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

    shouldBe(JSON.stringify(first0(1)), '{"alpha":1,"beta":2,"gamma":3}', "the first literal of a shape");
    shouldBe(JSON.stringify(first1(1)), '{"delta":1,"epsilon":2}', "the first literal of a second shape");
    shouldBe(JSON.stringify(first2(1)), '{"zeta":1,"eta":2,"theta":3,"iota":4}', "the first literal of a third shape");

    shouldBe(JSON.stringify(first0(5)), '{"alpha":5,"beta":6,"gamma":7}', "the second literal of a shape");
    shouldBe(JSON.stringify(first1(5)), '{"delta":5,"epsilon":6}', "the second literal of a second shape");
    shouldBe(JSON.stringify(first2(5)), '{"zeta":5,"eta":6,"theta":7,"iota":8}', "the second literal of a third shape");
    shouldBe(JSON.stringify(sameShapeAsFirst0(5)), '{"alpha":-5,"beta":-5,"gamma":-5}', "the first literal of another site with a shape that exists");

    shouldBe(JSON.stringify(otherOrder(5)), '{"gamma":5,"beta":5,"alpha":5}', "the same names in another order");
    shouldBe(JSON.stringify(otherOrder(6)), '{"gamma":6,"beta":6,"alpha":6}', "the same names in another order, again");

    for (let i = 0; i < 200; ++i) {
        shouldBe(first0(i).gamma, i + 2, "a literal of a function that is no longer cold");
        shouldBe(sameShapeAsFirst0(i).alpha, -i, "a literal of another site that is no longer cold");
    }
    for (let i = 0; i < 200; ++i) {
        shouldBe(first0(i).beta, i + 1, "a literal of a warm function");
        shouldBe(Object.keys(first2(i)).join(), "zeta,eta,theta,iota", "the keys of a literal of a warm function");
    }
})();
console.log("passed");
