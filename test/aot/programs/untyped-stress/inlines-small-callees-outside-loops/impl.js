function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

(function () {
function tiny(a, b, c) { return (a + b) * c; }
function little(a, b, c) { return (a + b) * c - a + b; }
function middling(a, b, c) { return (a + b) * c - a + b * c; }
function once(x) { return tiny(x, 1, 2) + little(x, 1, 2) + middling(x, 1, 2); }
function again(x) { return tiny(x, 3, 4) + little(x, 3, 4) + middling(x, 3, 4); }
check(once(5), 12 + 8 + 9, "callees of three sizes, called outside a loop");
check(again(6), 36 + 33 + 42, "callees of three sizes, their second site");
})();
console.log("passed");
