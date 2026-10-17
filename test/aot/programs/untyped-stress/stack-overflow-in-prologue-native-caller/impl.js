let depth = 0;
let nativeSawIt = 0;

function viaSort() {
    depth++;
    let threw = false;
    try {
        [2, 1].sort(comparator);
    } catch (e) {
        if (!(e instanceof RangeError))
            throw e;
        threw = true;
        nativeSawIt++;
    }
    if (threw)
        throw new RangeError("passed on");
    return depth;
}
function comparator(a, b) { viaSort(); return a - b; }

function viaStringify(a, b, c, d) {
    const before = a + b * 2 + c * 3 + d * 4;
    let result;
    try {
        result = JSON.stringify({ get x() { return viaStringify(a + 1, b + 1, c + 1, d + 1); } });
    } catch (e) {
        if (!(e instanceof RangeError))
            throw e;
        result = "overflow";
    }
    if (a + b * 2 + c * 3 + d * 4 !== before)
        throw new Error("locals changed at depth " + a);
    return result.length;
}

for (let padding = 0; padding < 48; padding++) {
    depth = 0;
    nativeSawIt = 0;
    const pad = new Function("f", "a".repeat(1) + ", " + Array.from({ length: padding }, (_, i) => "p" + i).join(", ") + (padding ? ", " : "") + "z", "return f();");
    let caught = false;
    try {
        pad(viaSort);
    } catch (e) {
        if (!(e instanceof RangeError))
            throw e;
        caught = true;
    }
    if (!caught)
        throw new Error("did not overflow");
    if (nativeSawIt < depth - 2)
        throw new Error("padding " + padding + ": " + nativeSawIt + " of " + depth + " levels saw the exception");
    if (typeof pad(() => viaStringify(1, 2, 3, 4)) !== "number")
        throw new Error("bad result");
}
console.log("passed");
