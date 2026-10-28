function callee(a, b, c, d, e, f) { return a + b + c + d + e + f; }
noInline(callee);
function fewer(a, b, c, d, e, f, g, h) { return callee(1, 2, 3, 4, 5, 6); }
noInline(fewer);
function more() { return callee(1, 2, 3, 4, 5, 6); }
noInline(more);
function outer() {
    let x = { v: 1 }, y = { v: 2 }, z = { v: 3 };
    let r = fewer(0) + more() + fewer() + more(1, 2, 3, 4, 5, 6, 7, 8, 9);
    return x.v + y.v + z.v + r;
}
noInline(outer);
for (let i = 0; i < 1000; ++i) {
    if (outer() !== 90)
        throw new Error("bad result " + outer());
}
let getter = { get x() { return callee(1, 2, 3, 4, 5, 6); } };
for (let i = 0; i < 1000; ++i) {
    if (getter.x !== 21)
        throw new Error("bad result from the getter");
}
console.log("passed");
