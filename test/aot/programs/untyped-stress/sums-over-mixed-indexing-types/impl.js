function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

const kept = [];
function keep(o) { kept.push(o); return o; }
function build(...pairs) {
    let o = {};
    for (let [name, value] of pairs)
        o[name] = value;
    return keep(o);
}
function Item(tag, key, child, flags) {
    this.tag = tag;
    this.key = key;
    this.child = child;
    this.flags = flags;
}
const makeItem = which => keep(new Item(which, which + 1, which + 2, which + 3));

function sumsArrayOnly(x, y, z, array) {
    let total = x.tag + y.key + z.child;
    for (let i = 0; i < array.length; ++i)
        total += array[i];
    return total;
}
function sumsArrayAndFlags(x, y, z, array) {
    let total = x.tag + y.key;
    for (let i = 0; i < array.length; ++i)
        total += array[i] + z.flags;
    return total;
}
function sumsInTwoLoops(x, y, z, array) {
    let total = x.tag + y.key;
    for (let i = 0; i < array.length; ++i)
        total += array[i] + z.flags;
    for (let i = 0; i < array.length; ++i)
        total += array[i];
    return total;
}
function sumsInNestedLoops(x, y, z, array) {
    let total = x.tag + y.key;
    for (let i = 0; i < array.length; ++i) {
        total += z.flags;
        for (let j = 0; j < array.length; ++j)
            total += array[j];
    }
    return total;
}
function skipsOddElements(x, y, z, array) {
    let total = x.tag + y.key;
    for (let i = 0; i < array.length; ++i) {
        if (array[i] & 1)
            continue;
        total += array[i] + z.flags;
    }
    return total;
}
function sumsWithCalls(x, y, z, array) {
    let total = x.tag + y.key;
    for (let i = 0; i < array.length; ++i)
        total += keep(array)[i] + z.flags;
    return total;
}
noInline(keep);
for (let f of [sumsArrayOnly, sumsArrayAndFlags, sumsInTwoLoops, sumsInNestedLoops, skipsOddElements, sumsWithCalls])
    noInline(f);

let array = [1, 2, 3, 4];
for (let i = 0; i < 200; ++i) {
    let x = makeItem(i), y = makeItem(10), z = makeItem(20);
    check(sumsArrayOnly(x, y, z, array), i + 11 + 22 + 10, "sumsArrayOnly");
    check(sumsArrayAndFlags(x, y, z, array), i + 11 + 10 + 4 * 23, "sumsArrayAndFlags");
    check(sumsInTwoLoops(x, y, z, array), i + 11 + 20 + 4 * 23, "sumsInTwoLoops");
    check(sumsInNestedLoops(x, y, z, array), i + 11 + 4 * 23 + 40, "sumsInNestedLoops");
    check(skipsOddElements(x, y, z, array), i + 11 + 6 + 2 * 23, "skipsOddElements");
    check(sumsWithCalls(x, y, z, array), i + 11 + 10 + 4 * 23, "sumsWithCalls");
    kept.length = 0;
}

let odd = build(["other", 0], ["flags", 100]);
check(sumsArrayAndFlags(makeItem(0), makeItem(10), odd, array), 0 + 11 + 10 + 400, "a receiver that fails inside the loop");
check(skipsOddElements(makeItem(0), makeItem(10), odd, array), 0 + 11 + 6 + 200, "a receiver that fails behind the continue");
check(sumsWithCalls(makeItem(0), makeItem(10), odd, array), 0 + 11 + 10 + 400, "a receiver that fails inside a loop with calls");
console.log("passed");
