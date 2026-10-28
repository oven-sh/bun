function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function lengthOf(a) { return a.length; }
function lengthInLoop(a) { let n = 0; for (let i = 0; i < a.length; i++) n++; return n; }
const types = [Uint8Array, Float64Array, Int32Array];
for (let round = 0; round < 30; round++) {
    const type = types[round % types.length];
    // A structure that only this array has. That its length is the built-in one is found out and remembered.
    let shortLived = new type(2);
    shortLived["only" + round] = 1;
    for (let i = 0; i < 3; i++) {
        check(lengthOf(shortLived), 2, "the length of an array with a property of its own");
        check(lengthInLoop(shortLived), 2, "a loop over an array with a property of its own");
    }
    shortLived = null;
    fullGC();
    // Many new structures, one of which is where that one was.
    for (let i = 0; i < 400; i++) {
        const other = new type(2);
        Object.setPrototypeOf(other, { marker: i });
        check(lengthOf(other), undefined, "the length of an array that no longer inherits it, round " + round);
        check(lengthInLoop(other), 0, "a loop over an array that no longer inherits its length, round " + round);
    }
}
console.log("passed");
