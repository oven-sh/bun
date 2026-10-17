function recurse(n) { return recurse(n + 1) + 1; }
function manyParameters(a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p) { return manyParameters(a) + 1; }
let object = { get overflow() { return recurse(0); }, get overflowInArityCheck() { return manyParameters(0); } };
function check(f) {
    let a = 1, b = 2, c = 3, d = 4, e = 5, g = 6, h = 7, i = 8;
    let caught = 0;
    try { f(); } catch (error) { if (error instanceof RangeError) caught = 1; }
    if (a + b + c + d + e + g + h + i + caught !== 37)
        throw new Error("bad state after a stack overflow");
}
for (let i = 0; i < 20; ++i) {
    check(() => object.overflow);
    check(() => object.overflowInArityCheck);
    check(() => [3, 2, 1].sort(() => recurse(0)));
    check(() => "abc".replace(/b/, () => manyParameters(0)));
    check(() => [1].map(() => recurse(0)));
    check(() => Reflect.apply(manyParameters, null, []));
    check(() => JSON.stringify({ toJSON() { return recurse(0); } }));
}
console.log("passed");
