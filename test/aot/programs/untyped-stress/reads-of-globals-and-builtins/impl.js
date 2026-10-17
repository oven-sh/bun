function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
globalThis.added = 7;

(function () {
    let local = 3;
    function readsAdded() { return added; }
    function readsBoth() { return added + (globalThis === undefined ? 1 : 0); }
    function readsBuiltin() { return JSON; }
    function readsVariable() { return local; }
    check(readsAdded(), 7, "a property added to the global object");
    check(readsBoth(), 7, "two globals");
    check(readsBuiltin(), JSON, "a built-in");
    check(readsVariable(), 3, "a variable");
})();
console.log("passed");
