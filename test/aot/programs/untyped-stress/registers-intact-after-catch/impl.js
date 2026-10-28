function shouldBe(actual, expected, what) {
    if (actual !== expected)
        throw new Error(what + ": expected " + expected + " but got " + actual);
}

function thrower(o, n) {
    let s = o.a + o.b + o.c;
    if (n & 1)
        throw s;
    return s;
}

function deeper(o, n) {
    let s = o.c + o.a;
    return s + thrower(o, n) + o.b;
}

function catcher(callee, o, n) {
    try {
        return callee(o, n);
    } catch (e) {
        return e;
    }
}

function outer(o, n) {
    let s = o.a;
    s += catcher(deeper, o, n);
    s += o.b;
    s += catcher(deeper, o, n + 1);
    s += o.c;
    return s;
}

noInline(thrower);
noInline(deeper);
noInline(catcher);
noInline(outer);

for (let i = 0; i < 20000; i++) {
    let c = 3 + (i & 3);
    let sum = 3 + c;
    shouldBe(outer({ a: 1, b: 2, c }, i), sum + sum + (c + 1 + sum + 2), "outer at " + i);
}
console.log("passed");
