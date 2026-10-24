function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function readsMinusOne(a) { let last; for (let i = 0; i < a.length; i++) last = a[-1]; return last; }
function readsMinimum(a) { let last; for (let i = 0; i < a.length; i++) last = a[-2147483648]; return last; }
function readsMaximum(a) { let last; for (let i = 0; i < a.length; i++) last = a[2147483647]; return last; }
function readsLarge(a) { let last; for (let i = 0; i < a.length; i++) last = a[536870912]; return last; }
function writesMinusOne(a) { for (let i = 0; i < a.length; i++) a[-1] = i; return a[-1]; }
function writesLarge(a) { for (let i = 0, n = a.length; i < n; i++) a[1073741824] = i; return a[1073741824]; }
const typedArrays = [Uint8Array, Int8Array, Uint16Array, Int16Array, Int32Array, Uint32Array, Float32Array, Float64Array, Uint8ClampedArray];
for (let round = 0; round < 3; round++) {
    for (const f of [readsMinusOne, readsMinimum, readsMaximum, readsLarge]) {
        check(f([1, 2, 3]), undefined, f.name + " of an array");
        check(f([1.5, 2.5]), undefined, f.name + " of an array of doubles");
        check(f("abc"), undefined, f.name + " of a string");
        for (const type of typedArrays)
            check(f(new type(3)), undefined, f.name + " of a " + type.name);
    }
    const named = [1, 2, 3];
    named[-1] = "named";
    check(readsMinusOne(named), "named", "a property whose name is a negative number");
    check(writesMinusOne([1, 2, 3]), 2, "writesMinusOne of an array");
    check(writesLarge({ length: 2 }), 1, "writesLarge of an array-like");
    for (const type of typedArrays) {
        check(writesMinusOne(new type(3)), undefined, "writesMinusOne of a " + type.name);
        check(writesLarge(new type(3)), undefined, "writesLarge of a " + type.name);
    }
}
console.log("passed");
